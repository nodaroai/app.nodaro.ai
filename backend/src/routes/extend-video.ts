/**
 * Extend Video Route
 *
 * Continues a video with a new prompt.
 *
 * Providers:
 * - veo-extend: VEO 3.1 extend (POST /api/v1/veo/extend) — needs the source
 *   generation's KIE taskId
 * - runway-extend: Runway extend (POST /api/v1/runway/extend) — likewise
 * - ltx-2.3-pro: LTX 2.3 Pro extend, from a video URL
 * - seedance-2-5-extend / seedance-2-0-extend / kling-4-extend: Seedance 2.5 /
 *   Seedance 2.0 / Kling 4, from a video URL — the tail recipe
 *   (lib/extend-recipe.ts): the source's last seconds as the `@video_1`
 *   reference, then a stitch. Seedance 2.5 is charged per second sent and
 *   added (@nodaro/render-rules `seedance-extend-pricing.ts`), on the source
 *   the preHandler measures. The earlier id `seedance-2-extend` is retired:
 *   the app-wide hook (middleware/retired-video-provider.ts) runs it as
 *   `seedance-2-5-extend`.
 * - pixverse-v6-extend: PixVerse V6, from a video URL — a native extend
 *   (lib/extend-native.ts): the whole source in, the source with the new
 *   seconds joined on back, of which only the new seconds are stitched to it.
 */

import type { FastifyInstance, FastifyRequest } from "fastify"
import { z } from "zod"
import { safeUrlSchema } from "../lib/url-validator.js"
import { insertJob } from "../lib/insert-job.js"
import { applyPromptPolicies } from "../lib/prompt-policy.js"
import { supabase } from "../lib/supabase.js"
import { kieTaskOwnedByAnother } from "../lib/kie-task-ownership.js"
import { videoQueue } from "../lib/queue.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
import { extractWorkflowId, extractNodeId, extractForcePrivate } from "../lib/request-helpers.js"
import { extractMcpClient } from "../lib/extract-mcp-client.js"
import { buildJobInputData } from "../lib/job-input-data.js"
import { withResolvedModel } from "../lib/job-resolved-model.js"
import {
  EXTEND_VIDEO_PROVIDERS,
  PROMPT_HARD_CEILING,
  SEEDANCE_2_REF_LIMITS,
  SEEDANCE_2_5_REF_LIMITS,
  applyVideoNegativePrompt,
  canonicalVideoProvider,
  isCatalogExtendProvider,
  isPixverseExtendProvider,
} from "@nodaro/shared/models"
import { MODEL_CATALOG } from "@nodaro/shared/model-catalog"
import { LTX_EXTEND_PER_SECOND_CREDIT_ID, catalogExtendCreditId, ltxExtendDurationSec, pixverseExtendQuality } from "@nodaro/shared/credits"
import type { ConnectedReference, DescribedReference } from "@nodaro/shared/types"
import { connectedReferenceSchema, describedReferenceSchema, DESCRIBED_REFERENCE_LIMIT } from "../lib/connected-reference-schema.js"
import { isSeedanceExtendPricedBySecondsSent, seedanceExtendRateCreditId } from "@nodaro/render-rules"
import { EXTEND_REFERENCE_IMAGE_PROVIDERS, extendSourceTooShortMessage, isTailRecipeProvider, tailRecipeSeconds, TAIL_RECIPES } from "../lib/extend-recipe.js"
import { EXTEND_DURATION_MAX_SEC, EXTEND_DURATION_SECONDS, describeSeconds } from "../lib/extend-durations.js"
import { pixverseExtendPromptProblem, pixverseExtendSeconds } from "../lib/extend-native.js"
import { ltxExtendBaseCredits } from "../lib/ltx-extend-credits.js"
import { SEEDANCE_EXTEND_SOURCE_SEC_KEY, seedanceExtendBaseCredits } from "../lib/seedance-extend-credits.js"
import { probeVideoSource } from "../providers/video/ffmpeg-utils.js"
import { assembleVideoConnectedReferences } from "./generate-video.js"
import { formatZodError } from "../lib/zod-error.js"
import { sendInternalError } from "../lib/http-errors.js"

// veo-extend and runway-extend continue an upstream generation and need its
// provider task id; LTX 2.3 Pro and the tail-recipe providers take a raw videoUrl. Both fields
// are optional at the schema level and required per provider by
// `extendRequestProblem`, so each provider's required input set is enforced
// precisely.
export const extendVideoBody = z.object({
  taskId: z.string().min(1).optional(),    // Required for veo-extend / runway-extend (the job output's providerTaskId)
  kieTaskId: z.string().min(1).optional(), // Deprecated alias of taskId, still accepted
  videoUrl: safeUrlSchema.optional(),       // Required for ltx-2.3-pro, the tail-recipe providers (Seedance, Kling 4) and PixVerse V6
  prompt: z.string().min(1).max(PROMPT_HARD_CEILING).optional(),    // Required for every provider but LTX
  negativePrompt: z.string().max(PROMPT_HARD_CEILING).optional(), // Always optional — injected into prompt as "Avoid: …" for non-native providers
  userPrompt: z.string().max(PROMPT_HARD_CEILING).optional(),
  provider: z.enum(EXTEND_VIDEO_PROVIDERS),
  model: z.enum(["fast", "quality"]).optional(), // VEO only
  seeds: z.number().int().min(10000).max(99999).optional(), // VEO only
  quality: z.enum(["720p", "1080p"]).optional(), // Runway only
  extendMode: z.enum(["start", "end"]).optional(), // LTX 2.3 Pro only
  // Seconds to add, one of the provider's own (`EXTEND_DURATION_SECONDS`):
  // Seedance 2.5 4–30, Seedance 2.0 4–15, Kling 4 3–30, PixVerse V6 1–15,
  // LTX / VEO / Runway 1–20.
  duration: z.number().int().min(1).max(EXTEND_DURATION_MAX_SEC).optional(),
  // Catalog extend providers only, one their catalog entry offers (Seedance:
  // 480p / 720p / 1080p; Kling 4: 720p / 1080p; PixVerse V6: 360p / 540p /
  // 720p / 1080p), checked per provider by `extendRequestProblem`.
  resolution: z.enum(["360p", "480p", "540p", "720p", "1080p"]).optional(),
  generateAudio: z.boolean().optional(), // Seedance and PixVerse V6 only (default true); Kling 4's sound is always on
  // Reference images for the extension (Seedance only — the other extend
  // transports have no reference path, and a ref they'd silently drop is
  // refused with a 400 instead). Wire ceiling mirrors generate-video (the
  // widest provider's cap); the actual budget is enforced at assembly.
  referenceImageUrls: z.array(safeUrlSchema).max(SEEDANCE_2_5_REF_LIMITS.images).optional(),
  // Structured references (parity with generate-video): assembled server-side
  // into referenceImageUrls + identity directives, so an entity chip travels
  // as a real reference instead of degrading to a name in the prompt.
  connectedReferences: z.array(connectedReferenceSchema).max(14).optional(),
  // References the caller NAMED and DESCRIBED but has no media for (parity with
  // generate-video). They carry no url, so — unlike `connectedReferences` — they
  // are NOT gated on the reference-capable transport: prose reaches every extend
  // provider. No rail captions here: this route has no `referenceVideoUrls` /
  // `referenceAudioUrls` array for a caption to be index-aligned with.
  describedReferences: z.array(describedReferenceSchema).max(DESCRIBED_REFERENCE_LIMIT).optional(),
})

/**
 * The model whose REFERENCE LIMITS this route's assembly caps derive from,
 * for both Seedance providers.
 *
 * Deliberately Seedance 2.0's, on Seedance 2.5 too: 2.0's 9/3/3 caps are a
 * strict subset of 2.5's 30/10/10, so the assembled prompt and reference list
 * are the same whichever provider runs — a widened cap would silently change
 * the prompt a user's saved node produces. The model a run GENERATES on is its
 * provider's (`TAIL_RECIPES[provider].genModel`).
 */
const EXTEND_REFERENCE_CAPS_MODEL = "seedance-2"

/**
 * Image-reference slots the Seedance 2.0 extend transport consumes on its own:
 * the source's last frame, which the shared seedance input resolver appends
 * into `reference_image_urls` as the anchor (bound as the opening frame by its
 * prompt suffix). User references must leave it a free seat or the assembly's
 * `@image_N` directives would number onto the anchor's seat. Seedance 2.5
 * sends no anchor (it declares the extension instead), and keeps the same cap
 * so the prompt and reference list a saved node assembles do not change.
 */
const EXTEND_ANCHOR_IMAGE_SLOTS = 1

/**
 * Assemble the extend flow's user references through the SAME shared video
 * assembler generate-video uses, with two extend-specific facts pinned:
 * the provider is the underlying generation model (the caps source), and the
 * image budget reserves the anchor's seat. `referenceVideoCount: 1` because
 * the worker's cut of the source's end rides as `@video_1`. Pure; exported for tests.
 */
export function assembleExtendVideoReferences(args: {
  prompt: string | undefined
  referenceImageUrls?: string[]
  connectedReferences?: ConnectedReference[]
  describedReferences?: readonly DescribedReference[]
}): { prompt: string | undefined; referenceImageUrls: string[] | undefined } {
  return assembleVideoConnectedReferences({
    prompt: args.prompt,
    provider: EXTEND_REFERENCE_CAPS_MODEL,
    connectedReferences: args.connectedReferences ?? [],
    ...(args.describedReferences !== undefined ? { describedReferences: args.describedReferences } : {}),
    baseReferenceImageUrls: args.referenceImageUrls,
    imageCapOverride: SEEDANCE_2_REF_LIMITS.images - EXTEND_ANCHOR_IMAGE_SLOTS,
    referenceVideoCount: 1,
    referenceAudioCount: 0,
  })
}

// Resolve the credit identifier used by both the preHandler check and the
// downstream credit reservation. Keeping these in sync is critical — a
// divergence would charge the preHandler's price but reserve at a different
// price, which can let under-funded users through or over-charge paying ones.
// Exported so the three producers of a Seedance extend's id (here, the
// workflow payload builder, the workflow estimate) can be asserted equal in
// one test.
export function resolveExtendVideoIdentifier(body: Record<string, unknown> | undefined): string {
  // A retired id is priced as the provider it runs as. A request's was already
  // rewritten by the app-wide hook; a direct caller gets the same answer
  // rather than the retired id's own (Seedance 2.0) price row.
  const provider = canonicalVideoProvider(typeof body?.provider === "string" ? body.provider : "veo-extend")
  if (provider === "veo-extend" && body?.model === "quality") {
    return "veo-extend:quality"
  }
  // LTX 2.3 Pro extend is priced per second added: the per-second row, which
  // the guard and the workflow run multiply by the seconds
  // (ltxExtendBaseCredits).
  if (provider === "ltx-2.3-pro") return LTX_EXTEND_PER_SECOND_CREDIT_ID
  // Seedance 2.5 is charged per second sent and added: its resolution's
  // two-second row, which the guard multiplies by the run's units
  // (`seedanceExtendBaseCredits`, on the source the preHandler measured).
  if (isSeedanceExtendPricedBySecondsSent(provider)) return seedanceExtendRateCreditId(body?.resolution)
  // Every other catalog extend provider (Seedance 2.0, Kling 4, PixVerse V6)
  // on its own rows (per second added × resolution; PixVerse's `:audio` with
  // its sound on) — the one builder every surface prices such an extend with.
  if (isCatalogExtendProvider(provider)) {
    const duration = typeof body?.duration === "number" || typeof body?.duration === "string" ? body.duration : undefined
    const resolution = typeof body?.resolution === "string" ? body.resolution : undefined
    const generateAudio = typeof body?.generateAudio === "boolean" ? body.generateAudio : undefined
    return catalogExtendCreditId(provider, duration, resolution, generateAudio)
  }
  return provider
}

/**
 * The length of the source's picture the preHandler measured for a request,
 * by request: what its Seedance 2.5 price counts. Never read from the body, so
 * a caller cannot name the length it is charged for. No entry (the probe
 * failed, or a quote that never ran the preHandler): the whole 10-second
 * window is held, and the worker settles the run on the source it measures.
 */
const measuredSourcePictureSec = new WeakMap<FastifyRequest, number>()

/**
 * BASE credits of a Seedance 2.5 extend request (the guard marks them up once
 * at the rate row): the run's seconds sent and added at its resolution's
 * rate. Undefined for every other provider (its row prices it). Exported for tests.
 */
export async function extendVideoComputeCredits(body: unknown, req: FastifyRequest): Promise<number | undefined> {
  const b = body as Record<string, unknown> | undefined
  const provider = canonicalVideoProvider(typeof b?.provider === "string" ? b.provider : "veo-extend")
  if (!isSeedanceExtendPricedBySecondsSent(provider)) return undefined
  return seedanceExtendBaseCredits({ duration: b?.duration, resolution: b?.resolution, sourcePictureSec: measuredSourcePictureSec.get(req) })
}

type ExtendVideoBody = z.infer<typeof extendVideoBody>

/**
 * What the schema cannot say, being the union of every provider's fields:
 * each provider's required inputs, the seconds it can add, and whether it
 * takes reference images. The refusal's message, or null for a valid request.
 */
function extendRequestProblem(data: ExtendVideoBody): string | null {
  const { provider, videoUrl, prompt, duration } = data
  if (provider === "ltx-2.3-pro") {
    if (!videoUrl) return "videoUrl is required for ltx-2.3-pro"
  } else if (isTailRecipeProvider(provider)) {
    // URL-based like LTX, but the continuation CONTENT is required — the
    // recipe wraps it in its prompt ("extend @video_1 as follows: …"); an
    // empty continuation has nothing to say.
    if (!videoUrl) return `videoUrl is required for ${provider}`
    if (!prompt) return `prompt (what happens next) is required for ${provider}`
  } else if (isPixverseExtendProvider(provider)) {
    // URL-based too; the prompt is sent as written, and PixVerse refuses one
    // under 3 characters — after the reservation, so it is refused here.
    if (!videoUrl) return `videoUrl is required for ${provider}`
    const promptProblem = pixverseExtendPromptProblem(prompt)
    if (promptProblem) return promptProblem
  } else {
    // veo-extend, runway-extend — KIE-based, require the task id from
    // upstream + a prompt.
    if (!(data.taskId ?? data.kieTaskId)) return `taskId (the source generation's providerTaskId) is required for ${provider}`
    if (!prompt) return "prompt is required for KIE-based extend providers"
  }
  const offered = EXTEND_DURATION_SECONDS[provider]
  if (duration !== undefined && !offered.includes(duration)) {
    return `duration must be ${describeSeconds(offered)} for ${provider}`
  }
  // A catalog extend provider renders only the resolutions its catalog entry
  // offers (Kling 4: no 480p; PixVerse V6: 360p / 540p / 720p / 1080p, no
  // 480p). Refused here rather than run, and priced, at another the caller did
  // not ask for.
  const resolutions = isCatalogExtendProvider(provider) ? MODEL_CATALOG[provider]?.resolutions ?? [] : []
  if (data.resolution !== undefined && resolutions.length > 0 && !resolutions.includes(data.resolution)) {
    return `resolution must be ${describeChoices(resolutions)} for ${provider}`
  }
  // Reference images ride ONLY the Seedance transport (i2v with a native
  // reference_image_urls array). The other extend providers have no reference
  // path at all — refuse instead of silently dropping, so a caller learns at
  // submit time rather than after a billed generation.
  const hasImageRefs = (data.referenceImageUrls?.length ?? 0) > 0 || (data.connectedReferences?.length ?? 0) > 0
  if (hasImageRefs && !(EXTEND_REFERENCE_IMAGE_PROVIDERS as readonly string[]).includes(provider)) {
    return `referenceImageUrls / connectedReferences are only supported by the Seedance extend providers (${EXTEND_REFERENCE_IMAGE_PROVIDERS.join(", ")})`
  }
  return null
}

/** "720p or 1080p", "480p, 720p or 1080p". */
function describeChoices(choices: readonly string[]): string {
  return choices.length > 1 ? `${choices.slice(0, -1).join(", ")} or ${choices[choices.length - 1]}` : (choices[0] ?? "")
}

/**
 * A request that named a retired id (the earlier `seedance-2-extend`, run as
 * the provider it became by the app-wide hook: `req.retiredVideoProvider`)
 * keeps the lengths the old id took. It accepted 1–20 s and snapped a length
 * under its 4 s floor up to it, where the providers it became refuse a length
 * outside their window — so its length is held in the window instead
 * (`tailRecipeSeconds`, the seconds the run is priced at and generates). A
 * request naming a current provider keeps the refusal.
 */
function retiredLengthInWindow(data: ExtendVideoBody, retiredId: string | undefined): ExtendVideoBody {
  if (retiredId === undefined || data.duration === undefined || !isTailRecipeProvider(data.provider)) return data
  const seconds = tailRecipeSeconds(data.provider, data.duration)
  return seconds === data.duration ? data : { ...data, duration: seconds }
}

/**
 * {@link checkExtendSource}'s answer. `pictureSec`: the length of the source's
 * picture, when it was measured (what a Seedance 2.5 run's price counts).
 */
export type ExtendSourceCheck = { ok: true; pictureSec?: number } | { ok: false; code: "video_too_short"; message: string }

/**
 * Whether a tail-recipe provider can continue `videoUrl`. The run sends the
 * last seconds of the source's PICTURE as its `@video_1` reference (all of a
 * picture shorter than the tail), and the model refuses a reference shorter
 * than its floor (`minSourceSec`, the floor the worker holds too: Seedance
 * 1.8 s, a little under its 2 s tail, so a nominal 2 s clip that probes a
 * frame short still runs; Kling 4 2 s, under its 3 s tail). A shorter picture
 * is refused here — before anything is reserved — instead of failing in the
 * worker after the reservation. The picture's length is the video stream's
 * own (`videoDurationSeconds`: the sound can run past the last frame), the
 * container's when the stream reports none. A source that can run answers
 * with that length (`pictureSec`).
 *
 * Best-effort, like the route's other source probes: a probe that fails (the
 * source unreachable from here, a timeout) answers ok with no length —
 * `onProbeError` hears why — and the worker measures the source again before
 * it generates. A provider with no tail, or a value that is no safe http(s)
 * URL (the probe reads local paths too), is not probed at all.
 */
export async function checkExtendSource(
  provider: string,
  videoUrl: string,
  onProbeError?: (err: unknown) => void,
): Promise<ExtendSourceCheck> {
  if (!isTailRecipeProvider(provider) || !safeUrlSchema.safeParse(videoUrl).success) return { ok: true }
  let pictureSec: number
  try {
    const probe = await probeVideoSource(videoUrl)
    pictureSec = probe.videoDurationSeconds ?? probe.durationSeconds
  } catch (err) {
    onProbeError?.(err)
    return { ok: true }
  }
  if (pictureSec >= TAIL_RECIPES[provider].minSourceSec) return { ok: true, pictureSec }
  return { ok: false, code: "video_too_short", message: extendSourceTooShortMessage(provider, pictureSec) }
}

export async function extendVideoRoutes(app: FastifyInstance) {
  // LTX 2.3 Pro extend is priced per second added, so its guard carries the
  // seconds (the reservation below then reserves exactly that amount); every
  // other provider keeps its row-priced guard, unchanged.
  const ltxExtendGuard = creditGuard(() => LTX_EXTEND_PER_SECOND_CREDIT_ID, {
    computeCredits: (body) => ltxExtendBaseCredits((body as Record<string, unknown> | undefined)?.duration),
  })
  // Seedance 2.5 is charged per second sent and added: its two-second row times
  // the run's units, on the source the preHandler measured (the whole 10 s
  // window when it could not). Every other provider (computeCredits answers
  // undefined) keeps its row-priced guard.
  const rowPricedGuard = creditGuard((req) => resolveExtendVideoIdentifier(req.body as Record<string, unknown> | undefined), {
    computeCredits: extendVideoComputeCredits,
  })

  app.post("/v1/extend-video", {
    // Everything that refuses a request is answered here, BEFORE the credit
    // guard: the schema and each provider's own rules, then (a tail recipe)
    // whether the source is long enough for the model to continue — so
    // nothing is checked against a balance, probed or reserved for a request
    // that cannot run. The source is probed only once its URL passed the schema.
    preHandler: async (req, reply) => {
      const parsed = extendVideoBody.safeParse(req.body)
      if (!parsed.success) {
        return reply.status(400).send({ error: { code: "validation_error", ...formatZodError(parsed.error) } })
      }
      // The snapped length replaces the body's, so the guard, the
      // reservation, the job and the queue all read the seconds that run.
      const data = retiredLengthInWindow(parsed.data, req.retiredVideoProvider)
      if (data !== parsed.data) req.body = { ...(req.body as Record<string, unknown>), duration: data.duration }
      const problem = extendRequestProblem(data)
      if (problem) {
        return reply.status(400).send({ error: { code: "validation_error", message: problem } })
      }
      const { provider, videoUrl, duration, resolution } = data
      if (isTailRecipeProvider(provider) && videoUrl && req.userId) {
        const source = await checkExtendSource(provider, videoUrl, (err) => {
          req.log.warn({ err, provider }, "extend-video: source ffprobe failed; the worker measures it again")
        })
        if (!source.ok) return reply.status(400).send({ error: { code: source.code, message: source.message } })
        if (source.pictureSec !== undefined) measuredSourcePictureSec.set(req, source.pictureSec)
      }
      // The free-credit video limits judge the provider the request RUNS, as
      // an extension (no extension on free credits). Left to themselves they
      // read the price row's name, and a row can be named for no catalog
      // model — LTX 2.3 Pro (`ltx-2.3-pro-extend:per-second`) extends under
      // its generation model's id — so an account that never paid would get
      // through. Every provider is marked alike.
      req.freeVideoRequest = { provider, duration: duration ?? null, resolution: resolution ?? null, videoSize: null, extend: true }
      await (provider === "ltx-2.3-pro" ? ltxExtendGuard : rowPricedGuard)(req, reply)
    },
  }, async (req, reply) => {
    // Validated in the preHandler; parsed again for its types.
    const parsed = extendVideoBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: "validation_error", ...formatZodError(parsed.error) },
      })
    }

    const { videoUrl, prompt, negativePrompt, provider, model, seeds, quality, extendMode, duration } = parsed.data
    const kieTaskId = parsed.data.taskId ?? parsed.data.kieTaskId
    const userId = req.userId

    if (!userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "Authentication required" },
      })
    }

    // IDOR guard: a kieTaskId references the caller's upstream generation. Reject
    // only if it demonstrably belongs to ANOTHER user (fail-open for untracked
    // ids so legit/older jobs without provider_task_id still extend).
    if (kieTaskId && (await kieTaskOwnedByAnother(kieTaskId, userId))) {
      return reply.status(403).send({
        error: { code: "forbidden", message: "You do not own the referenced task" },
      })
    }

    const hasImageRefs =
      (parsed.data.referenceImageUrls?.length ?? 0) > 0 ||
      (parsed.data.connectedReferences?.length ?? 0) > 0

    // Assembly (seedance only) rewrites the prompt — {image:N} tokens resolve,
    // entity chips gain identity directives — and produces the final capped
    // reference list. It must run BEFORE the negative injection so the
    // "Avoid: …" clause stays the prompt's last line.
    // Described references have no url, so they are NOT part of `hasImageRefs`
    // (which gates the transport refusal, `extendRequestProblem`) — but they still need assembling
    // or the names they describe would reach the model undescribed.
    const hasDescribedRefs = (parsed.data.describedReferences?.length ?? 0) > 0
    const assembled = hasImageRefs || hasDescribedRefs
      ? assembleExtendVideoReferences({
          prompt,
          referenceImageUrls: parsed.data.referenceImageUrls,
          connectedReferences: parsed.data.connectedReferences,
          describedReferences: parsed.data.describedReferences,
        })
      : undefined

    // B4b: deployment prompt policy between reference assembly and negative
    // injection — the policy's folded negative then rides the "Avoid: …"
    // clause below, which stays the prompt's last line. Only when a prompt
    // exists (LTX extends promptless). No policy registered = identity.
    const assembledPrompt = assembled?.prompt ?? prompt
    const policed = assembledPrompt
      ? applyPromptPolicies({ prompt: assembledPrompt, negativePrompt: negativePrompt ?? "", kind: "video" })
      : undefined

    // None of the current extend providers (veo-extend / runway-extend / ltx-2.3-pro)
    // support `negative_prompt` natively, so the helper appends "Avoid: …" to
    // the user prompt before it reaches the queue. LTX doesn't consume the
    // prompt at all — the negative is silently dropped for that provider,
    // matching its existing prompt-ignored behavior.
    const { prompt: effectivePrompt } = applyVideoNegativePrompt(
      policed ? policed.prompt : assembledPrompt,
      policed ? policed.negativePrompt || undefined : negativePrompt,
      provider,
    )

    const mcpClient = extractMcpClient(req.body)
    // job_type powers the reconcile cron's correct finalization path —
    // see lib/reconcile/replicate.ts (defaults to "generate-image" when
    // null, which mis-uploads videos as images for LTX prediction jobs).
    const { data: job, error } = await insertJob(req, {
        workflow_id: extractWorkflowId(req.body),
        node_id: extractNodeId(req.body),
        force_private: extractForcePrivate(req.body) || undefined,
        user_id: userId,
        job_type: "extend-video",
        status: "pending",
        input_data: withResolvedModel(buildJobInputData(parsed.data, "extend-video"), "extend-video"),
        ...(mcpClient ? { mcp_client: mcpClient } : {}),
      })

    if (error) {
      return sendInternalError(reply, req, error, "Failed to create job")
    }

    const reservation = await reserveCreditsForJob(
      req,
      reply,
      job.id,
      resolveExtendVideoIdentifier(req.body as Record<string, unknown> | undefined),
    )
    if (reply.sent) return
    const usageLogId = reservation?.usageLogId

    // Translate camelCase API params → snake_case worker payload to match the
    // shape the LTX worker handler reads (mirrors the orchestrator payload-
    // builder's emit shape for the same case).
    const queuePayload =
      provider === "ltx-2.3-pro"
        ? {
            jobId: job.id,
            provider,
            video: videoUrl,
            // The seconds the guard priced (default 6 when none was given).
            duration: ltxExtendDurationSec(duration),
            extend_mode: extendMode ?? "end",
            usageLogId,
          }
        : isTailRecipeProvider(provider)
        ? {
            jobId: job.id,
            provider,
            video: videoUrl,
            // effectivePrompt carries any negative as in-prompt "Avoid: …" —
            // the seedance-correct constraint placement (no native param) —
            // plus the assembled reference directives when refs are present.
            prompt: effectivePrompt,
            // The seconds the guard priced (the provider's catalog default
            // when none was given: 8 s on Seedance, 5 s on Kling 4), in its
            // window: what the worker generates.
            duration: tailRecipeSeconds(provider, duration),
            resolution: parsed.data.resolution,
            generateAudio: parsed.data.generateAudio,
            // Assembled + anchor-budgeted user refs; the worker forwards them
            // into the generation, where the shared resolver seats them FIRST
            // (@image_1…N) — on Seedance 2.0 the last-frame anchor after them.
            ...(assembled?.referenceImageUrls?.length
              ? { referenceImageUrls: assembled.referenceImageUrls }
              : {}),
            // Seedance 2.5: the source length the hold was priced on, so the
            // worker sends (and settles on) no more of the source than was
            // held, even if the link answers it a longer file.
            ...(isSeedanceExtendPricedBySecondsSent(canonicalVideoProvider(provider)) && measuredSourcePictureSec.has(req)
              ? { [SEEDANCE_EXTEND_SOURCE_SEC_KEY]: measuredSourcePictureSec.get(req) }
              : {}),
            usageLogId,
          }
        : isPixverseExtendProvider(provider)
        ? {
            jobId: job.id,
            provider,
            video: videoUrl,
            // The user's prompt as written (any negative as in-prompt
            // "Avoid: …": PixVerse takes no negative of its own).
            prompt: effectivePrompt,
            // The seconds, the quality and the sound the guard priced (5 s,
            // 720p, sound on when none was given): what the worker generates.
            duration: pixverseExtendSeconds(duration),
            resolution: pixverseExtendQuality(parsed.data.resolution),
            generateAudio: parsed.data.generateAudio !== false,
            usageLogId,
          }
        : {
            jobId: job.id,
            kieTaskId,
            prompt: effectivePrompt,
            provider,
            model,
            seeds,
            quality,
            usageLogId,
          }
    await videoQueue.add("extend-video", queuePayload)

    return { jobId: job.id }
  })
}
