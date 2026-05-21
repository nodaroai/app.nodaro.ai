import type { Job } from "bullmq"
import { generateImage, imageToVideo, videoToVideo } from "../../providers/index.js"
import { generateScript, type ScriptProvider } from "../../providers/script/script-generator.js"
import {
  commitJobCredits,
  shouldSaveJobResult,
  markJobCompleted,
  uploadImageMaybeWatermark,
  uploadVideoMaybeWatermark,
  setJobProgress,
  type HandlerFn,
  type JobContext,
} from "../shared.js"
import { makeOnTaskCreated } from "../../lib/reconcile/persistence.js"
import {
  providerKindForImageModel,
  providerKindForVideoModel,
} from "../../lib/reconcile/provider-kind.js"
import {
  attachAssetToCharacter,
  setCharacterPortrait,
  resolveAssetColumn,
  type CharacterAssetColumn,
} from "../../lib/character-auto-attach.js"
import { autoAttachLocationAsset } from "../../lib/location-auto-attach.js"
import { autoAttachObjectAsset, setObjectMainImage } from "../../lib/object-auto-attach.js"

interface EntityImageJobData {
  jobId: string
  prompt: string
  sourceImageUrl?: string
  assetType?: string
  provider?: string
  // Character Studio auto-attach (best-effort). When set, after the image is
  // generated and stored on the jobs row, the result URL is also written
  // directly to the user's characters row — so closing the studio mid-job
  // doesn't orphan the result. See `lib/character-auto-attach.ts`.
  attachToCharacterId?: string
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
}

function makeEntityImageHandler(
  logPrefix: string,
  opts?: { aspectRatio?: string; includeAssetType?: boolean },
): HandlerFn {
  return async function entityImageHandler(job: Job, ctx: JobContext) {
    const data = job.data as EntityImageJobData
    const {
      prompt,
      sourceImageUrl,
      assetType,
      provider,
      attachToCharacterId,
      attachToColumn,
      attachName,
      attachToLocationId,
      attachToObjectId,
      description,
      motionDescription,
      realLifeRefs,
      aspectRatio,
    } = data
    const resolvedProvider = provider ?? "nano-banana"

    if (opts?.includeAssetType) {
      console.log(`[worker] ${logPrefix} ${ctx.jobId} (type: ${assetType}, provider: ${resolvedProvider})`)
    } else {
      console.log(`[worker] ${logPrefix} ${ctx.jobId} (provider: ${resolvedProvider}): "${prompt}"`)
    }

    const referenceImageUrls = sourceImageUrl ? [sourceImageUrl] : undefined
    // Per-job aspect ratio (set by the route's `resolveCharacterAspectRatio`)
    // wins over the handler's static `opts.aspectRatio` so each character
    // asset can pick a framing that matches its asset type. Generate-face
    // still pins 1:1 via opts because faces are always square crops.
    const effectiveAspectRatio = aspectRatio ?? opts?.aspectRatio
    const extraParams = effectiveAspectRatio ? { aspect_ratio: effectiveAspectRatio } : undefined
    const onTaskCreated = makeOnTaskCreated(
      ctx.jobId,
      providerKindForImageModel(resolvedProvider),
    )
    const result = await generateImage(prompt, resolvedProvider, referenceImageUrls, extraParams, { onTaskCreated })
    await setJobProgress(job, ctx.jobId, 50)

    const r2Url = await uploadImageMaybeWatermark(result.url, ctx.jobId, ctx.jobUserId, ctx.shouldWatermark)
    await setJobProgress(job, ctx.jobId, 100)

    if (!await shouldSaveJobResult(ctx.jobId)) return

    const outputData: Record<string, unknown> = { imageUrl: r2Url }
    if (opts?.includeAssetType && assetType) {
      outputData.assetType = assetType
    }

    const ok = await markJobCompleted(ctx.jobId, {
      output_data: outputData,
      provider: result.providerUsed,
      provider_cost: result.cost,
      display_cost: result.displayCost,
    })
    if (!ok) return

    await commitJobCredits(ctx.usageLogId, ctx.jobId, result.cost)

    // Best-effort: write the result back onto the user's character row so the
    // Studio reflects it across page reloads (even if the user closed the tab
    // mid-generation). Logs and continues on failure — credits are already
    // committed and the job row holds the URL as the ultimate source.
    if (attachToCharacterId && ctx.jobUserId) {
      if (logPrefix === "generate-character") {
        // Portrait → source_image_url
        await setCharacterPortrait({ characterId: attachToCharacterId, userId: ctx.jobUserId, url: r2Url })
      } else if (attachToColumn && attachName) {
        const column: CharacterAssetColumn | null = resolveAssetColumn(attachToColumn)
        if (column) {
          await attachAssetToCharacter({
            characterId: attachToCharacterId,
            userId: ctx.jobUserId,
            column,
            item: {
              name: attachName,
              url: r2Url,
              description,
              motionDescription,
              realLifeRefs,
            },
          })
        }
      }
    }

    // Location Studio auto-attach. Mirrors the Character path but writes via
    // `append_location_asset` (migration 124). The helper re-verifies
    // `(id, user_id, deleted_at IS NULL)` so a forged BullMQ payload can't
    // attach to another user's row.
    await autoAttachLocationAsset({
      locationId: attachToLocationId,
      column: attachToColumn,
      name: attachName,
      userId: ctx.jobUserId,
      url: r2Url,
    })

    // Object Studio auto-attach. Mirrors the Character pattern: main-image
    // branch sets source_image_url; asset variant branch appends to a JSONB
    // column via the append_object_asset RPC (migration 147). The helpers
    // re-verify `(id, user_id, deleted_at IS NULL)` so a forged BullMQ
    // payload can't attach to another user's row OR an object that was
    // soft-deleted between route accept and worker pickup. Unlike the
    // Character branch, no explicit `resolveAssetColumn` call is needed
    // here — `autoAttachObjectAsset` narrows internally against
    // `OBJECT_ATTACH_COLUMN_SET`.
    if (attachToObjectId && ctx.jobUserId) {
      if (logPrefix === "generate-object") {
        // Main image (single-candidate) → source_image_url
        await setObjectMainImage({
          objectId: attachToObjectId,
          userId: ctx.jobUserId,
          url: r2Url,
        })
      } else if (attachToColumn && attachName) {
        // Asset variant → JSONB column (angles / materials / variations)
        await autoAttachObjectAsset({
          objectId: attachToObjectId,
          column: attachToColumn,
          name: attachName,
          userId: ctx.jobUserId,
          url: r2Url,
        })
      }
    }

    console.log(`[worker] Job ${ctx.jobId} completed: ${r2Url} (provider: ${result.providerUsed}, cost: $${result.cost?.toFixed(6) ?? "N/A"})`)
  }
}

const handleGenerateScript: HandlerFn = async function handleGenerateScript(job, ctx) {
  const { prompt, sceneCount, tone, targetDuration, provider, llmModel } = job.data as {
    jobId: string
    prompt: string
    sceneCount?: number
    tone?: string
    targetDuration?: number
    provider?: ScriptProvider
    llmModel?: string
  }
  console.log(`[worker] generate-script ${ctx.jobId} (model: ${llmModel ?? provider ?? "default"})`)

  const script = await generateScript(prompt, sceneCount, tone, targetDuration, provider, llmModel)
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

  const r2Url = await uploadVideoMaybeWatermark(result.url, ctx.jobId, ctx.jobUserId, ctx.shouldWatermark)
  await setJobProgress(job, ctx.jobId, 100)

  if (!await shouldSaveJobResult(ctx.jobId)) return

  const ok = await markJobCompleted(ctx.jobId, {
    output_data: { videoUrl: r2Url },
    provider: result.providerUsed,
    provider_cost: result.cost,
    display_cost: result.displayCost,
  })
  if (!ok) return

  await commitJobCredits(ctx.usageLogId, ctx.jobId, result.cost)

  // Best-effort attach to characters.motions[]
  if (attachToCharacterId && attachName && ctx.jobUserId) {
    await attachAssetToCharacter({
      characterId: attachToCharacterId,
      userId: ctx.jobUserId,
      column: "motions",
      item: {
        name: attachName,
        url: r2Url,
        description,
        motionDescription,
        realLifeRefs,
      },
    })
  }

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

  const r2Url = await uploadVideoMaybeWatermark(result.url, ctx.jobId, ctx.jobUserId, ctx.shouldWatermark)
  await setJobProgress(job, ctx.jobId, 100)

  if (!await shouldSaveJobResult(ctx.jobId)) return

  const ok = await markJobCompleted(ctx.jobId, {
    output_data: { videoUrl: r2Url },
    provider: result.providerUsed,
    provider_cost: result.cost,
    display_cost: result.displayCost,
  })
  if (!ok) return

  await commitJobCredits(ctx.usageLogId, ctx.jobId, result.cost)

  // Best-effort attach to locations.atmosphere_motions (or whichever motion
  // column the route specified). The helper re-verifies (id, user_id,
  // deleted_at IS NULL) so a forged BullMQ payload can't bypass ownership.
  await autoAttachLocationAsset({
    locationId: attachToLocationId,
    column: attachToColumn,
    name: attachName,
    userId: ctx.jobUserId,
    url: r2Url,
  })

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

  const r2Url = await uploadVideoMaybeWatermark(result.url, ctx.jobId, ctx.jobUserId, ctx.shouldWatermark)
  await setJobProgress(job, ctx.jobId, 100)

  if (!await shouldSaveJobResult(ctx.jobId)) return

  const ok = await markJobCompleted(ctx.jobId, {
    output_data: { videoUrl: r2Url },
    provider: result.providerUsed,
    provider_cost: result.cost,
    display_cost: result.displayCost,
  })
  if (!ok) return

  await commitJobCredits(ctx.usageLogId, ctx.jobId, result.cost)

  // Best-effort attach to objects.motion_clips (or whichever motion column
  // the route specified — currently always "motion_clips"). The helper
  // re-verifies (id, user_id, deleted_at IS NULL) so a forged BullMQ payload
  // can't bypass ownership.
  await autoAttachObjectAsset({
    objectId: attachToObjectId,
    column: attachToColumn,
    name: attachName,
    userId: ctx.jobUserId,
    url: r2Url,
  })

  console.log(`[worker] Job ${ctx.jobId} completed: ${r2Url} (provider: ${result.providerUsed}, cost: $${result.cost?.toFixed(6) ?? "N/A"})`)
}

export const entityHandlers: Record<string, HandlerFn> = {
  "generate-character": makeEntityImageHandler("generate-character"),
  "generate-face": makeEntityImageHandler("generate-face", { aspectRatio: "1:1" }),
  "generate-character-asset": makeEntityImageHandler("generate-character-asset", { includeAssetType: true }),
  "generate-object": makeEntityImageHandler("generate-object"),
  "generate-object-asset": makeEntityImageHandler("generate-object-asset", { includeAssetType: true }),
  "generate-location": makeEntityImageHandler("generate-location"),
  "generate-location-asset": makeEntityImageHandler("generate-location-asset", { includeAssetType: true }),
  "generate-script": handleGenerateScript,
  "generate-character-motion": handleGenerateCharacterMotion,
  "generate-location-motion": handleGenerateLocationMotion,
  "generate-object-motion": handleGenerateObjectMotion,
}
