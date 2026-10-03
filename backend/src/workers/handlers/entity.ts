import type { Job } from "bullmq"
import { config } from "../../lib/config.js"
import { generateImage, imageToVideo, videoToVideo } from "../../providers/index.js"
import { generateScript, type ScriptProvider } from "../../providers/script/script-generator.js"
import type { LlmAdvancedInput } from "../../lib/llm-advanced-mode.js"
import {
  commitJobCredits,
  shouldSaveJobResult,
  markJobCompleted,
  setJobProgress,
  type HandlerFn,
  type JobContext,
} from "../shared.js"
import { entityAttachSpecFrom, finalizeEntityJob } from "../../lib/entity-finalize.js"
import { makeOnTaskCreated } from "../../lib/reconcile/persistence.js"
import {
  providerKindForImageModel,
  providerKindForVideoModel,
} from "../../lib/reconcile/provider-kind.js"
import { clampAspectRatioToModel } from "../../lib/aspect-ratio.js"
import { entityImageRefCap } from "../../lib/entity-ref-cap.js"
import { applyPromptPolicies } from "../../lib/prompt-policy.js"

interface EntityImageJobData {
  jobId: string
  prompt: string
  sourceImageUrl?: string
  // Caller-assembled, pre-ranked multi-image reference set (the
  // `generate-character-asset` route via `assembleCharacterReferenceSet`). When
  // present it REPLACES the single-ref `[sourceImageUrl]` behavior, then gets
  // capped to the provider's `maxRefImages`. Deliberately DISTINCT from the DAG
  // payload's `referenceImageUrls` field (set by `payload-builder` for every
  // entity node type) which the worker intentionally does NOT read — activating
  // that would silently flip every entity DAG node onto wired refs. See design §4.
  assembledReferenceUrls?: string[]
  assetType?: string
  provider?: string
  // Character Studio auto-attach (best-effort). When set, after the image is
  // generated and stored on the jobs row, the result URL is also written
  // directly to the user's characters row — so closing the studio mid-job
  // doesn't orphan the result. See `lib/character-auto-attach.ts`.
  attachToCharacterId?: string
  // Opt-out of the portrait auto-attach while KEEPING the character linkage.
  // Set by `POST /v1/extension/reimagine`: its single job is a busy
  // full-scene image whose auto-attach as `source_image_url` would poison
  // the identity anchor every future variant reference set builds on. The
  // job still records `attachToCharacterId` for provenance/UI association.
  // Absent/false → existing behavior (count===1 portrait auto-attach).
  skipPortraitAttach?: boolean
  // `attachToColumn` is shared between the Character and Location auto-attach
  // paths — the Character path narrows via `resolveAssetColumn`, the Location
  // path narrows against `LOCATION_ATTACH_COLUMNS`. Typed `string` here so a
  // single field shape works for both.
  attachToColumn?: string
  attachName?: string
  // Location Studio auto-attach. Mirrors the Character fields but writes to
  // the `locations` table via the `append_location_asset` RPC (migration
  // 124). When `attachToLocationId` is set the worker performs a
  // belt-and-braces ownership re-query against `(id, user_id, deleted_at IS
  // NULL)` before firing the RPC, so a forged BullMQ payload can't attach to
  // someone else's location row.
  attachToLocationId?: string
  // Object Studio auto-attach. Mirrors the Character fields but writes to
  // the `objects` table via the `append_object_asset` RPC (migration 147).
  // When `attachToObjectId` is set the worker performs a belt-and-braces
  // ownership re-query against `(id, user_id, deleted_at IS NULL)` before
  // firing the RPC, so a forged BullMQ payload can't attach to someone
  // else's object row. For `logPrefix === "generate-object"` (main image)
  // the worker calls setObjectMainImage instead of attachAssetToObject.
  attachToObjectId?: string
  // Creature Studio auto-attach. Mirrors the Object fields but writes to
  // the `creatures` table via the `append_creature_asset` RPC (migration
  // 206). When `attachToCreatureId` is set the worker performs a
  // belt-and-braces ownership re-query against `(id, user_id, deleted_at IS
  // NULL)` before firing the RPC, so a forged BullMQ payload can't attach to
  // someone else's creature row. For `logPrefix === "generate-creature"`
  // (main image) the worker calls setCreatureMainImage instead of
  // attachAssetToCreature.
  attachToCreatureId?: string
  // Richer Character Studio fields that travel alongside the asset for
  // downstream prompt enrichment. Routes (later tasks) put these on
  // `job.data`; the worker only reads + forwards them.
  description?: string
  motionDescription?: string
  realLifeRefs?: string[]
  // Per-asset-type aspect-ratio (set by the route via
  // `resolveCharacterAspectRatio`). When present, takes precedence over the
  // handler's static `opts.aspectRatio` so each generation can pick a
  // framing that matches its asset type (portrait=3:4, poses=9:16, etc.).
  aspectRatio?: string
  // Credit-affecting output levers threaded from the generate-character /
  // generate-location (+ -asset) routes. Forwarded to the provider via
  // extraParams exactly like the generate-image worker — providers without
  // the lever ignore the param (the permissive-enum contract: priced at the
  // route, gated per-provider, never rejected here).
  resolution?: string
  quality?: string
  // W1-a: the subject is a MINOR. Route-computed (once, via `isMinorAge` over
  // the character row's / node's person value) rather than re-derived here —
  // the worker has no person value, only the assembled prompt. Drives the
  // minor-age-floor prompt policy below, which is what covers the free-text
  // path the catalog-level Layer 1 can't reach. Absent → identity.
  subjectMinor?: boolean
}

function makeEntityImageHandler(
  logPrefix: string,
  opts?: { aspectRatio?: string; includeAssetType?: boolean },
): HandlerFn {
  return async function entityImageHandler(job: Job, ctx: JobContext) {
    const data = job.data as EntityImageJobData
    const {
      prompt: promptRaw,
      sourceImageUrl,
      assembledReferenceUrls,
      assetType,
      provider,
      aspectRatio,
      resolution,
      quality,
      subjectMinor,
    } = data
    // SAI-2 / H5 — apply the deployment's prompt policy (e.g. SAI's modesty
    // clause) at the entity IMAGE chokepoint. All four person/scene entity types
    // (generate-character / -location / -object / -creature, main + assets) flow
    // through this ONE factory, from BOTH the DAG (payload-builder polices there
    // too — the policy is idempotent, so this is a no-op on those) AND the direct
    // single-node Run routes (which do NOT police — this is their only policing
    // point). Character Studio's "Create character" is the most person-centric
    // surface in the product and reached the provider with zero modesty text
    // before this. Inert on mainline (no policy registered = identity). Entity
    // generation carries no negative-prompt field, so the positive clause is the
    // enforcement.
    // W1-a rides in on `subjectMinor` (see the field's note): the minor-age
    // floor is the identity for every job that does not carry it.
    const prompt = applyPromptPolicies({
      prompt: promptRaw,
      negativePrompt: "",
      kind: "image",
      subjectMinor: subjectMinor === true,
    }).prompt
    const resolvedProvider = provider ?? "nano-banana"

    if (opts?.includeAssetType) {
      console.log(`[worker] ${logPrefix} ${ctx.jobId} (type: ${assetType}, provider: ${resolvedProvider})`)
    } else {
      console.log(`[worker] ${logPrefix} ${ctx.jobId} (provider: ${resolvedProvider}): "${prompt}"`)
    }

    // Prefer the caller-assembled multi-image reference set (character-asset
    // identity refs); else fall back to the single source image. Cap to the
    // provider's `maxRefImages` capability (null-safe for non-KIE / unknown
    // providers — see entityImageRefCap). The route reserves credits for this
    // same capped count, so reserved refs === sent refs.
    const baseRefs = assembledReferenceUrls?.length
      ? assembledReferenceUrls
      : sourceImageUrl
        ? [sourceImageUrl]
        : undefined
    const refCap = entityImageRefCap(resolvedProvider)
    const referenceImageUrls = baseRefs ? baseRefs.slice(0, refCap) : undefined
    // Per-job aspect ratio (set by the route's `resolveCharacterAspectRatio`)
    // wins over the handler's static `opts.aspectRatio` so each character
    // asset can pick a framing that matches its asset type. Generate-face
    // still pins 1:1 via opts because faces are always square crops.
    //
    // The smart-default ratio is chosen WITHOUT knowing the model (portrait →
    // 3:4), but not every model supports every ratio — Grok has no 3:4. Clamp
    // to the catalog-nearest ratio the chosen model actually supports so KIE
    // doesn't silently drop the lever. Data-driven (MODEL_CATALOG), so it's
    // correct for any current/future model without a per-provider table.
    const effectiveAspectRatio = clampAspectRatioToModel(
      aspectRatio ?? opts?.aspectRatio,
      resolvedProvider,
    )
    // Same extraParams contract as the generate-image worker: only set keys
    // ride through; providers that don't support a lever ignore it.
    const extraParams: Record<string, unknown> = {
      ...(effectiveAspectRatio && { aspect_ratio: effectiveAspectRatio }),
      ...(resolution && { resolution }),
      ...(quality && { quality }),
    }
    const hasExtraParams = Object.keys(extraParams).length > 0
    const onTaskCreated = makeOnTaskCreated(
      ctx.jobId,
      providerKindForImageModel(resolvedProvider),
    )
    const result = await generateImage(prompt, resolvedProvider, referenceImageUrls, hasExtraParams ? extraParams : undefined, { onTaskCreated })
    await setJobProgress(job, ctx.jobId, 50)

    // Upload → CAS-complete → commit credits → write the result back onto the
    // user's studio row, through the SHARED entity tail (`lib/entity-finalize.ts`).
    // The reconcile cron calls the same function with the same attach spec read
    // off `jobs.input_data`, which is what makes a worker that dies mid-flight
    // recoverable instead of refunded 90 minutes later.
    const r2Url = await finalizeEntityJob({
      jobId: ctx.jobId,
      jobType: logPrefix,
      userId: ctx.jobUserId,
      shouldWatermark: ctx.shouldWatermark,
      usageLogId: ctx.usageLogId,
      spec: entityAttachSpecFrom(data as unknown as Record<string, unknown>),
      result: {
        url: result.url,
        providerUsed: result.providerUsed,
        cost: result.cost,
        displayCost: result.displayCost,
      },
      afterUpload: () => setJobProgress(job, ctx.jobId, 100),
    })
    if (!r2Url) return

    console.log(`[worker] Job ${ctx.jobId} completed: ${r2Url} (provider: ${result.providerUsed}, cost: $${result.cost?.toFixed(6) ?? "N/A"})`)
  }
}


/**
 * True when nothing local can serve an LLM call and the cloud can.
 *
 * The LLM lane tries KIE, then Anthropic, then Gemini (lib/llm-client.ts), so
 * "keyless" here means none of the three — a install with any one of them
 * keeps its own path untouched.
 */
async function shouldRunLlmOnCloud(): Promise<boolean> {
  if (config.KIE_API_KEY || config.ANTHROPIC_API_KEY || config.GEMINI_API_KEY) return false
  const { isNodaroConnected } = await import("../../lib/nodaro-connect.js")
  return isNodaroConnected().catch(() => false)
}

const handleGenerateScript: HandlerFn = async function handleGenerateScript(job, ctx) {
  const { prompt, sceneCount, tone, targetDuration, styleGuide, provider, llmModel, reasoningEffort, advanced } = job.data as {
    jobId: string
    prompt: string
    sceneCount?: number
    tone?: string
    targetDuration?: number
    styleGuide?: string
    provider?: ScriptProvider
    llmModel?: string
    reasoningEffort?: string
    advanced?: LlmAdvancedInput
  }
  console.log(`[worker] generate-script ${ctx.jobId} (model: ${llmModel ?? provider ?? "default"})`)

  // A keyless install with a live connection runs the LLM on the cloud rather
  // than failing — the LLM lane never reaches the capability router, so the
  // handler is where this decision belongs. Any local LLM key still wins.
  const script = (await shouldRunLlmOnCloud())
    ? ((await (await import("../../providers/nodaro/run-on-cloud.js")).runJobOnCloud(
        "generate-script",
        job.data as Record<string, unknown>,
      )).script as Awaited<ReturnType<typeof generateScript>>)
    : await generateScript(prompt, sceneCount, tone, targetDuration, provider, llmModel, reasoningEffort, advanced, { styleGuide })
  await setJobProgress(job, ctx.jobId, 100)

  if (!await shouldSaveJobResult(ctx.jobId)) return

  const ok = await markJobCompleted(ctx.jobId, {
    output_data: { script },
  })
  if (!ok) return

  await commitJobCredits(ctx.usageLogId, ctx.jobId)
  console.log(`[worker] Job ${ctx.jobId} completed: "${script.title}" (${script.scenes.length} scenes)`)
}

const handleGenerateCharacterMotion: HandlerFn = async function handleGenerateCharacterMotion(job, ctx) {
  const {
    prompt,
    sourceImageUrl,
    provider,
    attachToCharacterId,
    attachName,
    description,
    motionDescription,
    realLifeRefs,
    aspectRatio,
  } = job.data as {
    jobId: string
    prompt: string
    sourceImageUrl: string
    provider?: string
    attachToCharacterId?: string
    attachName?: string
    description?: string
    motionDescription?: string
    realLifeRefs?: string[]
    aspectRatio?: string
  }
  const resolvedProvider = provider ?? "kling"
  console.log(`[worker] generate-character-motion ${ctx.jobId} (provider: ${resolvedProvider}): "${prompt}"`)

  // Pass the resolved aspect ratio (default 9:16 for motions, overridden by
  // the character node toggle or an explicit `aspectRatio`) through the
  // image-to-video provider chain via `options.aspectRatio`.
  const onTaskCreated = makeOnTaskCreated(
    ctx.jobId,
    providerKindForVideoModel(resolvedProvider),
  )
  const result = await imageToVideo(
    sourceImageUrl,
    resolvedProvider,
    prompt,
    undefined,
    undefined,
    aspectRatio ? { aspectRatio } : undefined,
    { onTaskCreated },
  )
  await setJobProgress(job, ctx.jobId, 50)

  // Shared entity completion tail — see lib/entity-finalize.ts. The reconcile
  // cron runs this exact function with the attach spec read off
  // `jobs.input_data`, so a crashed worker's finished clip is recovered rather
  // than discarded. The attach COLUMN is the job type's own constant in that
  // table (it used to be a literal in this file / in the route's queue payload,
  // which the persisted row never saw).
  const r2Url = await finalizeEntityJob({
    jobId: ctx.jobId,
    jobType: "generate-character-motion",
    userId: ctx.jobUserId,
    shouldWatermark: ctx.shouldWatermark,
    usageLogId: ctx.usageLogId,
    spec: entityAttachSpecFrom(job.data as Record<string, unknown>),
    result: {
      url: result.url,
      providerUsed: result.providerUsed,
      cost: result.cost,
      displayCost: result.displayCost,
    },
    afterUpload: () => setJobProgress(job, ctx.jobId, 100),
  })
  if (!r2Url) return

  console.log(`[worker] Job ${ctx.jobId} completed: ${r2Url} (provider: ${result.providerUsed}, cost: $${result.cost?.toFixed(6) ?? "N/A"})`)
}

/**
 * Worker handler for `POST /v1/generate-location-motion` (image-to-video for
 * location atmosphere clips). Mirrors `handleGenerateCharacterMotion` minus
 * character-specific fields (motionDescription / realLifeRefs /
 * attachAssetToCharacter); locations have a single attach column
 * (`atmosphere_motions`) which the route sets so the worker doesn't need to
 * narrow it.
 *
 * Belt-and-braces ownership re-verification on the `locations` row before the
 * RPC fires: even though the route already verified ownership, the worker
 * re-checks `(id, user_id, deleted_at IS NULL)` so a forged BullMQ payload
 * can't trick a stale worker into attaching to another user's row OR a
 * location that was soft-deleted between route accept and worker pickup.
 *
 * Error policy: RPC failures are swallowed by `attachAssetToLocation` (the
 * job result is already on `jobs.output_data` and credits are committed —
 * throwing would orphan the generation). Ownership-check failure (no row)
 * silently skips attach but still completes the job + commits credits.
 */
const handleGenerateLocationMotion: HandlerFn = async function handleGenerateLocationMotion(job, ctx) {
  const {
    prompt,
    sourceImageUrl,
    refineFromVideoUrl,
    provider,
    aspectRatio,
    attachToLocationId,
    attachToColumn,
    attachName,
  } = job.data as {
    jobId: string
    prompt: string
    sourceImageUrl: string
    /** When set, refine this clip via video-to-video instead of running
     *  image-to-video from sourceImageUrl. */
    refineFromVideoUrl?: string
    provider?: string
    aspectRatio?: string
    attachToLocationId?: string
    attachToColumn?: string
    attachName?: string
  }
  const resolvedProvider = provider ?? "kling"
  const mode = refineFromVideoUrl ? "vid2vid-refine" : "img2vid"
  console.log(`[worker] generate-location-motion ${ctx.jobId} (provider: ${resolvedProvider}, mode: ${mode}): "${prompt}"`)

  const onTaskCreated = makeOnTaskCreated(
    ctx.jobId,
    providerKindForVideoModel(resolvedProvider),
  )

  const result = refineFromVideoUrl
    ? await videoToVideo(
        refineFromVideoUrl,
        resolvedProvider,
        prompt,
        aspectRatio ? { aspectRatio } : undefined,
        { onTaskCreated },
      )
    : await imageToVideo(
        sourceImageUrl,
        resolvedProvider,
        prompt,
        undefined,
        undefined,
        aspectRatio ? { aspectRatio } : undefined,
        { onTaskCreated },
      )
  await setJobProgress(job, ctx.jobId, 50)

  // Shared entity completion tail — see lib/entity-finalize.ts. The reconcile
  // cron runs this exact function with the attach spec read off
  // `jobs.input_data`, so a crashed worker's finished clip is recovered rather
  // than discarded. The attach COLUMN is the job type's own constant in that
  // table (it used to be a literal in this file / in the route's queue payload,
  // which the persisted row never saw).
  const r2Url = await finalizeEntityJob({
    jobId: ctx.jobId,
    jobType: "generate-location-motion",
    userId: ctx.jobUserId,
    shouldWatermark: ctx.shouldWatermark,
    usageLogId: ctx.usageLogId,
    spec: entityAttachSpecFrom(job.data as Record<string, unknown>),
    result: {
      url: result.url,
      providerUsed: result.providerUsed,
      cost: result.cost,
      displayCost: result.displayCost,
    },
    afterUpload: () => setJobProgress(job, ctx.jobId, 100),
  })
  if (!r2Url) return

  console.log(`[worker] Job ${ctx.jobId} completed: ${r2Url} (provider: ${result.providerUsed}, cost: $${result.cost?.toFixed(6) ?? "N/A"})`)
}

/**
 * Worker handler for `POST /v1/generate-object-motion` (image-to-video for
 * object motion clips: rotate, hover, spin, parallax). Mirrors
 * `handleGenerateLocationMotion` verbatim with location → object substitution.
 *
 * Default provider is `"kling-turbo"` (matches Phase B's
 * `OBJECT_MOTION_PROVIDERS[0]` and the route's Zod default).
 *
 * Belt-and-braces ownership re-verification inside `autoAttachObjectAsset`:
 * even though the route already verified ownership (spec Pass 3 F-30
 * pre-credit-reservation check), the worker helper re-checks
 * `(id, user_id, deleted_at IS NULL)` so a forged BullMQ payload can't trick
 * a stale worker into attaching to another user's row OR an object that
 * was soft-deleted between route accept and worker pickup.
 *
 * Error policy: RPC failures swallowed by `attachAssetToObject`. Ownership-
 * check failure (no row) silently skips attach but still completes the job
 * + commits credits.
 */
const handleGenerateObjectMotion: HandlerFn = async function handleGenerateObjectMotion(job, ctx) {
  const {
    prompt,
    sourceImageUrl,
    refineFromVideoUrl,
    provider,
    duration,
    aspectRatio,
    attachToObjectId,
    attachToColumn,
    attachName,
  } = job.data as {
    jobId: string
    prompt: string
    sourceImageUrl: string
    /** When set, refine this clip via video-to-video instead of running
     *  image-to-video from sourceImageUrl. */
    refineFromVideoUrl?: string
    provider?: string
    /** Per-model clip duration (seconds), route-validated against the
     *  provider's allowed durations. Undefined → model default. */
    duration?: number
    aspectRatio?: string
    attachToObjectId?: string
    attachToColumn?: string
    attachName?: string
  }
  const resolvedProvider = provider ?? "kling-turbo"
  const mode = refineFromVideoUrl ? "vid2vid-refine" : "img2vid"
  console.log(`[worker] generate-object-motion ${ctx.jobId} (provider: ${resolvedProvider}, mode: ${mode}): "${prompt}"`)

  const onTaskCreated = makeOnTaskCreated(
    ctx.jobId,
    providerKindForVideoModel(resolvedProvider),
  )

  // Per-model clip duration (route-validated against the provider's allowed
  // durations). i2v takes it as the positional `duration` arg; v2v takes it via
  // ProviderOptions.duration (string). Undefined → the model's own default.
  const result = refineFromVideoUrl
    ? await videoToVideo(
        refineFromVideoUrl,
        resolvedProvider,
        prompt,
        aspectRatio || duration !== undefined
          ? { ...(aspectRatio ? { aspectRatio } : {}), ...(duration !== undefined ? { duration: String(duration) } : {}) }
          : undefined,
        { onTaskCreated },
      )
    : await imageToVideo(
        sourceImageUrl,
        resolvedProvider,
        prompt,
        duration,
        undefined,
        aspectRatio ? { aspectRatio } : undefined,
        { onTaskCreated },
      )
  await setJobProgress(job, ctx.jobId, 50)

  // Shared entity completion tail — see lib/entity-finalize.ts. The reconcile
  // cron runs this exact function with the attach spec read off
  // `jobs.input_data`, so a crashed worker's finished clip is recovered rather
  // than discarded. The attach COLUMN is the job type's own constant in that
  // table (it used to be a literal in this file / in the route's queue payload,
  // which the persisted row never saw).
  const r2Url = await finalizeEntityJob({
    jobId: ctx.jobId,
    jobType: "generate-object-motion",
    userId: ctx.jobUserId,
    shouldWatermark: ctx.shouldWatermark,
    usageLogId: ctx.usageLogId,
    spec: entityAttachSpecFrom(job.data as Record<string, unknown>),
    result: {
      url: result.url,
      providerUsed: result.providerUsed,
      cost: result.cost,
      displayCost: result.displayCost,
    },
    afterUpload: () => setJobProgress(job, ctx.jobId, 100),
  })
  if (!r2Url) return

  console.log(`[worker] Job ${ctx.jobId} completed: ${r2Url} (provider: ${result.providerUsed}, cost: $${result.cost?.toFixed(6) ?? "N/A"})`)
}

/**
 * Worker handler for `POST /v1/generate-creature-motion` (image-to-video for
 * creature motion clips: walk, idle, attack, etc.). Mirrors
 * `handleGenerateObjectMotion` verbatim with object → creature substitution.
 *
 * Default provider is `"kling-turbo"` (matches the object motion default and
 * the route's Zod default).
 *
 * Belt-and-braces ownership re-verification inside `autoAttachCreatureAsset`:
 * even though the route already verified ownership pre-credit-reservation, the
 * worker helper re-checks `(id, user_id, deleted_at IS NULL)` so a forged
 * BullMQ payload can't trick a stale worker into attaching to another user's
 * row OR a creature that was soft-deleted between route accept and worker
 * pickup.
 *
 * Error policy: RPC failures swallowed by `attachAssetToCreature`. Ownership-
 * check failure (no row) silently skips attach but still completes the job
 * + commits credits.
 */
const handleGenerateCreatureMotion: HandlerFn = async function handleGenerateCreatureMotion(job, ctx) {
  const {
    prompt,
    sourceImageUrl,
    refineFromVideoUrl,
    provider,
    duration,
    aspectRatio,
    attachToCreatureId,
    attachToColumn,
    attachName,
  } = job.data as {
    jobId: string
    prompt: string
    sourceImageUrl: string
    /** When set, refine this clip via video-to-video instead of running
     *  image-to-video from sourceImageUrl. */
    refineFromVideoUrl?: string
    provider?: string
    /** Per-model clip duration (seconds), route-validated against the
     *  provider's allowed durations. Undefined → model default. */
    duration?: number
    aspectRatio?: string
    attachToCreatureId?: string
    attachToColumn?: string
    attachName?: string
  }
  const resolvedProvider = provider ?? "kling-turbo"
  const mode = refineFromVideoUrl ? "vid2vid-refine" : "img2vid"
  console.log(`[worker] generate-creature-motion ${ctx.jobId} (provider: ${resolvedProvider}, mode: ${mode}): "${prompt}"`)

  const onTaskCreated = makeOnTaskCreated(
    ctx.jobId,
    providerKindForVideoModel(resolvedProvider),
  )

  // Per-model clip duration (route-validated against the provider's allowed
  // durations). i2v takes it as the positional `duration` arg; v2v takes it via
  // ProviderOptions.duration (string). Undefined → the model's own default.
  const result = refineFromVideoUrl
    ? await videoToVideo(
        refineFromVideoUrl,
        resolvedProvider,
        prompt,
        aspectRatio || duration !== undefined
          ? { ...(aspectRatio ? { aspectRatio } : {}), ...(duration !== undefined ? { duration: String(duration) } : {}) }
          : undefined,
        { onTaskCreated },
      )
    : await imageToVideo(
        sourceImageUrl,
        resolvedProvider,
        prompt,
        duration,
        undefined,
        aspectRatio ? { aspectRatio } : undefined,
        { onTaskCreated },
      )
  await setJobProgress(job, ctx.jobId, 50)

  // Shared entity completion tail — see lib/entity-finalize.ts. The reconcile
  // cron runs this exact function with the attach spec read off
  // `jobs.input_data`, so a crashed worker's finished clip is recovered rather
  // than discarded. The attach COLUMN is the job type's own constant in that
  // table (it used to be a literal in this file / in the route's queue payload,
  // which the persisted row never saw).
  const r2Url = await finalizeEntityJob({
    jobId: ctx.jobId,
    jobType: "generate-creature-motion",
    userId: ctx.jobUserId,
    shouldWatermark: ctx.shouldWatermark,
    usageLogId: ctx.usageLogId,
    spec: entityAttachSpecFrom(job.data as Record<string, unknown>),
    result: {
      url: result.url,
      providerUsed: result.providerUsed,
      cost: result.cost,
      displayCost: result.displayCost,
    },
    afterUpload: () => setJobProgress(job, ctx.jobId, 100),
  })
  if (!r2Url) return

  console.log(`[worker] Job ${ctx.jobId} completed: ${r2Url} (provider: ${result.providerUsed}, cost: $${result.cost?.toFixed(6) ?? "N/A"})`)
}

export const entityHandlers: Record<string, HandlerFn> = {
  "generate-character": makeEntityImageHandler("generate-character"),
  "generate-face": makeEntityImageHandler("generate-face", { aspectRatio: "1:1" }),
  "generate-character-asset": makeEntityImageHandler("generate-character-asset", { includeAssetType: true }),
  "generate-object": makeEntityImageHandler("generate-object"),
  "generate-object-asset": makeEntityImageHandler("generate-object-asset", { includeAssetType: true }),
  "generate-creature": makeEntityImageHandler("generate-creature"),
  "generate-creature-asset": makeEntityImageHandler("generate-creature-asset", { includeAssetType: true }),
  "generate-location": makeEntityImageHandler("generate-location"),
  "generate-location-asset": makeEntityImageHandler("generate-location-asset", { includeAssetType: true }),
  "generate-script": handleGenerateScript,
  "generate-character-motion": handleGenerateCharacterMotion,
  "generate-location-motion": handleGenerateLocationMotion,
  "generate-object-motion": handleGenerateObjectMotion,
  "generate-creature-motion": handleGenerateCreatureMotion,
}
