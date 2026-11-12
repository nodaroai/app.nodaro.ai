/**
 * Video Upscale Route
 *
 * Upscales a video using:
 * - Topaz Video Upscale via Replicate (target resolution + fps; metered —
 *   holds its output-gigapixel ceiling, charged the units Replicate reports)
 * - VEO 1080p (taskId-based, from completed VEO generation)
 * - VEO 4K (taskId-based, from completed VEO generation)
 * - Seedance 2.5 HD (from draft): the 1080p finalize of a Seedance 2.5 DRAFT —
 *   the same take re-rendered at 1080p (taskId- or sourceJobId-based)
 * - Nodaro Video Upscale: any clip up to 60 s / 50 MB into a 1080p, 2K or 4K
 *   box, per second of the clip (measured before anything is held; the hold is
 *   the charge). A house model (lib/house-models.ts): accepted only where the
 *   deployment serves it and plans a run for the clip.
 *
 * Input:
 * - videoUrl: Source video to upscale — required for Topaz
 * - targetResolution: Topaz "720p" | "1080p" | "4k" (short side), default 1080p
 *   — any other value is a 400, for every provider but Nodaro Video Upscale;
 *   Nodaro Video Upscale "1080p" | "2k" | "4k" (an output box), default 1080p,
 *   and a value it does not take (720p) runs at its default
 *   (`nodaroVideoUpscaleTierOf`, from the catalog).
 * - targetFps: 15–60 — Topaz only, default the source's own rate
 * - upscaleFactor: "1", "2", or "4" — legacy Topaz lever, read only without a
 *   targetResolution (mapped over the source's short side)
 * - provider: "topaz" (default), "veo-1080p", "veo-4k", "seedance-2-5-hd" or "nodaro-video-upscale"
 * - taskId: Required for VEO providers (the original VEO job's providerTaskId; kieTaskId is a deprecated alias).
 *   For seedance-2-5-hd: the draft's providerTaskId (or pass sourceJobId).
 * - sourceJobId: seedance-2-5-hd only — the draft's job id.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { z } from "zod"
import { safeUrlSchema } from "../lib/url-validator.js"
import { CLIENT_CLOSED, clientGoneSignal } from "../lib/client-gone.js"
import { insertJob } from "../lib/insert-job.js"
import { mayUseChildJobAsSource } from "../lib/job-submission-context.js"
import { kieTaskOwnedByAnother } from "../lib/kie-task-ownership.js"
import { videoQueue } from "../lib/queue.js"
import { creditGuard, reserveCreditsForJob, type RoutePricing } from "../middleware/credit-guard.js"
import { extractWorkflowId, extractNodeId, extractForcePrivate } from "../lib/request-helpers.js"
import { extractMcpClient } from "../lib/extract-mcp-client.js"
import { buildJobInputData } from "../lib/job-input-data.js"
import { withResolvedModel } from "../lib/job-resolved-model.js"
import { SEEDANCE_DRAFT_FINALIZE_PROVIDER, VIDEO_UPSCALE_RESOLUTIONS } from "@nodaro/shared/model-catalog"
import {
  NODARO_VIDEO_UPSCALE_PROVIDER,
  TOPAZ_VIDEO_FPS_MAX,
  TOPAZ_VIDEO_FPS_MIN,
  TOPAZ_VIDEO_RESOLUTIONS,
  VIDEO_UPSCALE_PROVIDERS,
} from "@nodaro/shared/models"
import { nodaroVideoUpscaleCreditId, nodaroVideoUpscaleTierOf, TOPAZ_VIDEO_UNIT_CREDIT_ID } from "@nodaro/render-rules"
import { planTopazVideoUpscale, topazVideoHoldBaseCredits, TopazVideoSourceUnreadableError, TopazVideoTooLongError } from "../lib/topaz-video-plan.js"
import {
  isNodaroVideoUpscaleTryAgain,
  NODARO_VIDEO_UPSCALE_NOT_SERVED_CODE,
  NODARO_VIDEO_UPSCALE_NOT_SERVED_MESSAGE,
  nodaroVideoUpscaleBaseCredits,
  nodaroVideoUpscalePlanFields,
  nodaroVideoUpscaleRefusalOf,
  planNodaroVideoUpscale,
} from "../lib/nodaro-video-upscale-plan.js"
import { houseModelServed, planHouseModelRun } from "../lib/house-models.js"
import { linkImportRefusal } from "../lib/link-imports.js"
import { formatZodError } from "../lib/zod-error.js"
import { sendInternalError } from "../lib/http-errors.js"
import { jobRunModel } from "../lib/run-model.js"
import {
  resolveSeedanceDraftFinalize,
  seedanceDraftFinalizeBaseCredits,
  seedanceDraftFinalizeBilledSec,
} from "../lib/seedance-draft-finalize.js"

const isNodaroVideoUpscaleBody = (body: unknown): boolean =>
  (body as { provider?: unknown } | undefined)?.provider === NODARO_VIDEO_UPSCALE_PROVIDER

/**
 * The body's fields in their order (the order a 400 lists its issues in),
 * with the `targetResolution` values a provider's schema takes.
 */
function videoUpscaleFields<T extends readonly [string, ...string[]]>(targetResolutions: T) {
  return {
    videoUrl: safeUrlSchema.optional(),
    /** Legacy relative lever (Topaz): read only when `targetResolution` is absent. */
    upscaleFactor: z.enum(["1", "2", "4"]).optional(),
    targetResolution: z.enum(targetResolutions).optional(),
    targetFps: z.number().int().min(TOPAZ_VIDEO_FPS_MIN).max(TOPAZ_VIDEO_FPS_MAX).optional(),
    provider: z.enum(VIDEO_UPSCALE_PROVIDERS).default("topaz"),
    taskId: z.string().optional(),
    kieTaskId: z.string().optional(), // Deprecated alias of taskId, still accepted
    /** seedance-2-5-hd only: the draft's job id (alternative to taskId). */
    sourceJobId: z.string().optional(),
  }
}

/**
 * Every provider but Nodaro Video Upscale: the schema exactly as it was — the
 * same fields in the same order, Topaz's targets (another provider's 2k is a
 * 400), and the same rule and sentence for the source each provider names.
 */
const upscaleBody = z.object(videoUpscaleFields(TOPAZ_VIDEO_RESOLUTIONS)).refine(
  (data) => {
    // VEO providers require the source generation's task id
    if (data.provider === "veo-1080p" || data.provider === "veo-4k") {
      return !!(data.taskId ?? data.kieTaskId)
    }
    // The draft finalize names its draft by task id or job id
    if (data.provider === SEEDANCE_DRAFT_FINALIZE_PROVIDER) {
      return !!(data.taskId ?? data.kieTaskId ?? data.sourceJobId)
    }
    // Topaz requires videoUrl
    return !!data.videoUrl
  },
  {
    message: "VEO upscale requires taskId (the source generation's providerTaskId); Seedance 2.5 HD requires the draft's taskId or sourceJobId; Topaz requires videoUrl",
  }
)

/** Nodaro Video Upscale: any provider's target (one it does not take, such as 720p, runs at its default: `nodaroVideoUpscaleTierOf`), and its clip's link. */
const nodaroUpscaleBody = z.object(videoUpscaleFields(VIDEO_UPSCALE_RESOLUTIONS)).refine(
  (data) => !!data.videoUrl,
  { message: "Nodaro Video Upscale requires videoUrl" },
)

/**
 * The route's body: Nodaro Video Upscale's own schema for a request that
 * names it, and for every other request the schema it always had. A refusal
 * passes on each issue's path and message, in order — everything a 400's body
 * states (`formatZodError`) — so every other provider's 400 body is what it
 * was, its provider list aside (it now names nodaro-video-upscale too).
 */
export const videoUpscaleBody = z.unknown().transform((body, ctx) => {
  const parsed = (isNodaroVideoUpscaleBody(body) ? nodaroUpscaleBody : upscaleBody).safeParse(body)
  if (parsed.success) return parsed.data
  for (const issue of parsed.error.issues) ctx.addIssue({ code: "custom", message: issue.message, path: [...issue.path], input: issue.input })
  return z.NEVER
})

function upscaleCreditModel(provider: string): string {
  if (provider === "veo-1080p") return "veo-1080p"
  if (provider === "veo-4k") return "veo-4k"
  if (provider === SEEDANCE_DRAFT_FINALIZE_PROVIDER) return SEEDANCE_DRAFT_FINALIZE_PROVIDER
  // Topaz is held per unit: the unit's row × the units the clip's plan holds.
  return TOPAZ_VIDEO_UNIT_CREDIT_ID
}

const isTopazBody = (body: unknown): boolean => {
  const provider = (body as { provider?: unknown } | undefined)?.provider
  return provider === undefined || provider === "topaz"
}

/**
 * Topaz: measure the source and resolve the target BEFORE the credit guard
 * (every edition — the legacy factor and "same as source" need the clip's size
 * and rate), so the guard holds the plan's units and the worker renders the
 * target that was priced. An unreadable source is a 400 before anything is
 * reserved. Inert for every other provider.
 */
async function topazPlanPreHandler(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!isTopazBody(req.body)) return
  const body = req.body as Record<string, unknown>
  const videoUrl = typeof body.videoUrl === "string" ? body.videoUrl : undefined
  // No URL (or one Zod will refuse) → the handler answers the validation error.
  if (!videoUrl || !safeUrlSchema.safeParse(videoUrl).success) return
  try {
    req.topazVideoUpscale = await planTopazVideoUpscale(videoUrl, body)
  } catch (err) {
    if (err instanceof TopazVideoSourceUnreadableError || err instanceof TopazVideoTooLongError) {
      return reply.status(400).send({ error: { code: err.code, message: err.message } })
    }
    throw err
  }
}

/** The refusal of a Nodaro Video Upscale this deployment cannot run. */
const nodaroNotServed = { code: NODARO_VIDEO_UPSCALE_NOT_SERVED_CODE, message: NODARO_VIDEO_UPSCALE_NOT_SERVED_MESSAGE }

/**
 * Its status: 403, the status every door gives a model this deployment does
 * not offer (the credit guard's own `model_not_available`, which answers a
 * request this pre-check lets through — one with no usable link), so a
 * caller sees the same answer whichever check refuses it (decided 2026-11-12).
 */
const NOT_SERVED_STATUS = 403

/**
 * Nodaro Video Upscale's refusal by this deployment, BEFORE the credit guard
 * (every edition): one that does not serve it (`houseModelServed`) refuses it
 * first, in the model's own sentence, before anything is fetched or held. A
 * body with no usable link reaches the guard, whose model deny refuses it with
 * the same 403. Inert for every other provider.
 */
async function nodaroVideoUpscalePreHandler(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!isNodaroVideoUpscaleBody(req.body)) return
  const videoUrl = (req.body as Record<string, unknown>).videoUrl
  // No URL (or one Zod will refuse) → the guard's deny, else the handler's validation error.
  if (typeof videoUrl !== "string" || !safeUrlSchema.safeParse(videoUrl).success) return
  if (!houseModelServed(NODARO_VIDEO_UPSCALE_PROVIDER)) return reply.status(NOT_SERVED_STATUS).send({ error: nodaroNotServed })
}

/**
 * Nodaro Video Upscale's clip, run by the credit guard as its `beforePricing`
 * step: after the model deny, the app-token scope gate and the
 * Idempotency-Key dedup, and before the price is resolved and the balance
 * checked — so a request a cheaper gate refuses never fetches or stores
 * anything. The clip goes through the outside-input copy
 * (lib/outside-input-copy.ts): an outside clip is copied to our storage and
 * measured from the copy, a stored one sized from storage — a quote
 * (`req.quoteOnly`) checks the same and stores nothing — so a clip past 60 s
 * or 50 MB, one that cannot be read, or one this deployment refuses (its link
 * switch, its upload policy) is refused before anything is reserved, and so is
 * one the deployment plans no run for at this tier (`planHouseModelRun`). The
 * STORED clip's URL is written into the request here, so the job's stored
 * request and the worker's payload carry the same URL. The guard then holds
 * exactly the clip's price. A client that leaves mid-fetch stops the fetch.
 * Inert for every other provider.
 */
async function nodaroVideoUpscaleBeforePricing(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!isNodaroVideoUpscaleBody(req.body)) return
  const body = req.body as Record<string, unknown>
  const videoUrl = typeof body.videoUrl === "string" ? body.videoUrl : undefined
  // No URL (or one Zod will refuse) → the handler answers the validation error;
  // no user → the handler answers 401.
  if (!videoUrl || !safeUrlSchema.safeParse(videoUrl).success || !req.userId) return
  // Refused already, by the pre-check or the guard's deny; never fetched.
  if (!houseModelServed(NODARO_VIDEO_UPSCALE_PROVIDER)) return reply.status(NOT_SERVED_STATUS).send({ error: nodaroNotServed })
  // Copying an outside clip into our storage is an import: refused here where
  // the deployment turned links to outside content off (the copy asks again).
  const linkRefused = linkImportRefusal(videoUrl)
  if (linkRefused) return reply.status(403).send({ error: linkRefused })
  const quote = req.quoteOnly === true
  // The client going away aborts the clip's fetch and copy, so a disconnected
  // request stops downloading and frees the person's fetch slot.
  const signal = clientGoneSignal(reply)
  let plan: Awaited<ReturnType<typeof planNodaroVideoUpscale>>
  try {
    plan = await planNodaroVideoUpscale(videoUrl, body.targetResolution, { userId: req.userId, quote, signal })
  } catch (err) {
    // The client went away mid-fetch: the request ends here, nothing held (a
    // client's own disconnect is no server error to report — as the keyed
    // chat's wait answers it, lib/llm-chat-keyed.ts).
    if (signal.aborted) return reply.status(499).send({ error: CLIENT_CLOSED })
    const refusal = nodaroVideoUpscaleRefusalOf(err)
    if (!refusal) throw err
    // "Try again in a moment" (nothing about the clip is wrong: too many fetches
    // at once is a 429, as the media import's own cap answers; a slow or failed
    // step on our side a 503), the deployment's own refusals, or the clip's.
    const status = refusal.code === "input_busy" ? 429
      : isNodaroVideoUpscaleTryAgain(refusal) ? 503
      : refusal.code === "link_imports_disabled" ? 403
      : refusal.code === "upload_blocked" ? 422
      : 400
    return reply.status(status).send({ error: refusal })
  }
  if (!planHouseModelRun(NODARO_VIDEO_UPSCALE_PROVIDER, { videoUrl: plan.videoUrl, tier: plan.tier, billedSec: plan.billedSec })) {
    return reply.status(NOT_SERVED_STATUS).send({ error: nodaroNotServed })
  }
  // The stored clip from here on: what the job records, what the worker sends.
  if (!quote) body.videoUrl = plan.videoUrl
  req.nodaroVideoUpscale = plan
}

const isDraftFinalizeBody = (body: unknown): boolean =>
  (body as { provider?: unknown } | undefined)?.provider === SEEDANCE_DRAFT_FINALIZE_PROVIDER

/**
 * Seedance draft finalize: resolve and validate the draft BEFORE the credit
 * guard (every edition — this is input validation), so a wrong, foreign,
 * unfinished or non-draft source is refused with a coded 4xx before anything is
 * reserved, and the guard prices from the SOURCE job's length. Inert for every
 * other provider.
 */
async function seedanceDraftFinalizePreHandler(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!isDraftFinalizeBody(req.body)) return
  // No user → the handler answers 401; nothing to resolve against.
  if (!req.userId) return
  const body = req.body as Record<string, unknown>
  const str = (v: unknown) => (typeof v === "string" && v.length > 0 ? v : undefined)
  const resolved = await resolveSeedanceDraftFinalize({
    userId: req.userId,
    taskId: str(body.taskId) ?? str(body.kieTaskId),
    sourceJobId: str(body.sourceJobId),
    // Only a worker-side handler's own request may finalize a child job
    // (Cast Swap's Full Quality upscale of its edit child).
    allowChildSource: mayUseChildJobAsSource(req),
  })
  if (!resolved.ok) {
    return reply.status(resolved.status).send({ error: { code: resolved.code, message: resolved.message } })
  }
  req.seedanceDraftFinalize = resolved
}

const resolveCreditModel = (req: FastifyRequest): string => {
  if (req.nodaroVideoUpscale) return req.nodaroVideoUpscale.creditId
  if (req.seedanceDraftFinalize) return req.seedanceDraftFinalize.creditId
  const body = req.body as Record<string, unknown> | undefined
  const provider = (body?.provider as string | undefined) ?? "topaz"
  // Unreachable without a plan (the `beforePricing` step refuses first); priced
  // at the asked tier's row, never another provider's.
  if (provider === NODARO_VIDEO_UPSCALE_PROVIDER) return nodaroVideoUpscaleCreditId(nodaroVideoUpscaleTierOf(body?.targetResolution))
  return upscaleCreditModel(provider)
}

/**
 * Everything /v1/video-upscale prices a request with — registered as the
 * route's preHandlers and run as-is by `POST /v1/quote` (one copy). The seeded
 * row prices every upscale, including a finalize of a draft made without a
 * reference video (`seedance-2-5-hd:{N}s`, DB-first). A finalize of a
 * reference-video draft bills input + output seconds, which the per-second
 * `-ref` row cannot express alone (same as the generation lane).
 */
export const videoUpscalePricing: RoutePricing = {
  prechecks: [seedanceDraftFinalizePreHandler, topazPlanPreHandler, nodaroVideoUpscalePreHandler],
  modelResolver: resolveCreditModel,
  opts: {
    runModel: jobRunModel("video-upscale"),
    // Nodaro Video Upscale's clip is fetched, measured and planned only past every cheaper gate.
    beforePricing: nodaroVideoUpscaleBeforePricing,
    computeCredits: async (_body, req) => {
      if (req.topazVideoUpscale) return topazVideoHoldBaseCredits(req.topazVideoUpscale)
      // Nodaro Video Upscale: the tier's four-second row × billed seconds ÷ 4,
      // rounded up once — the hold IS the charge.
      if (req.nodaroVideoUpscale) return nodaroVideoUpscaleBaseCredits(req.nodaroVideoUpscale)
      if (!req.seedanceDraftFinalize?.hasRefVideo) return undefined
      const base = await seedanceDraftFinalizeBaseCredits(req.seedanceDraftFinalize)
      if (base === undefined) throw new Error("seedance draft finalize priced without a resolved reference-video draft")
      return base
    },
  },
}

export async function videoUpscaleRoutes(app: FastifyInstance) {
  app.post("/v1/video-upscale", {
    preHandler: [...videoUpscalePricing.prechecks, creditGuard(videoUpscalePricing.modelResolver, videoUpscalePricing.opts)],
  }, async (req, reply) => {
    const parsed = videoUpscaleBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: "validation_error", ...formatZodError(parsed.error) },
      })
    }

    const { videoUrl, upscaleFactor, provider } = parsed.data
    // Topaz: the target the preHandler measured and priced.
    const topaz = provider === "topaz" ? req.topazVideoUpscale : undefined
    if (provider === "topaz" && !topaz) {
      // Only reachable if the preHandler did not run (it always does on this route).
      return reply.status(400).send({
        error: { code: "video_unreadable", message: "Couldn't read the video to upscale." },
      })
    }
    const userId = req.userId

    if (!userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "Authentication required" },
      })
    }
    // Nodaro Video Upscale: the plan the guard's `beforePricing` step measured
    // and priced (it plans nothing without a user, so this comes after the 401).
    const nodaro = provider === NODARO_VIDEO_UPSCALE_PROVIDER ? req.nodaroVideoUpscale : undefined
    if (provider === NODARO_VIDEO_UPSCALE_PROVIDER && !nodaro) {
      // Only reachable if the guard's `beforePricing` step did not run (it always does on this route).
      return reply.status(400).send({
        error: { code: "video_unreadable", message: "Couldn't read the video to upscale." },
      })
    }

    // Seedance draft finalize: the preHandler resolved the draft (and refused
    // anything it may not finalize). The task sent is the DRAFT's own, read
    // from the validated source job — never the caller's string.
    const draft = provider === SEEDANCE_DRAFT_FINALIZE_PROVIDER ? req.seedanceDraftFinalize : undefined
    if (provider === SEEDANCE_DRAFT_FINALIZE_PROVIDER && !draft) {
      // Only reachable if the preHandler did not run (it always does on this route).
      return reply.status(400).send({
        error: { code: "draft_source_required", message: "Seedance 2.5 HD finalizes a Seedance 2.5 draft — pass the draft's taskId or sourceJobId." },
      })
    }
    const kieTaskId = draft ? draft.draftTaskId : parsed.data.taskId ?? parsed.data.kieTaskId

    // IDOR guard: reject a kieTaskId that demonstrably belongs to another user
    // (fail-open for untracked ids — see kie-task-ownership.ts). The draft
    // finalize was already checked fail-CLOSED by its preHandler.
    if (!draft && kieTaskId && (await kieTaskOwnedByAnother(kieTaskId, userId))) {
      return reply.status(403).send({
        error: { code: "forbidden", message: "You do not own the referenced task" },
      })
    }

    const creditModel = nodaro ? nodaro.creditId : draft ? draft.creditId : upscaleCreditModel(provider)
    const mcpClient = extractMcpClient(req.body)
    // The seconds the finalize's charge bills, so the worker records the
    // render's provider cost from them (queue only — never the job record).
    // Read before the job row and the hold: a failure here leaves neither.
    const draftBilledSec = draft ? await seedanceDraftFinalizeBilledSec(draft) : undefined

    const { data: job, error } = await insertJob(req, {
        workflow_id: extractWorkflowId(req.body),
        node_id: extractNodeId(req.body),
        force_private: extractForcePrivate(req.body) || undefined,
        user_id: userId,
        status: "pending",
        input_data: withResolvedModel(buildJobInputData(
          {
            ...parsed.data,
            ...(topaz
              ? { targetResolution: topaz.resolution, targetFps: topaz.fps, topazHoldUnits: topaz.holdUnits }
              : {}),
            // The tier it runs at, and the measured clip it was priced on (no
            // frame rate or factor: this provider has neither).
            ...(nodaro
              ? { targetResolution: nodaro.tier, targetFps: undefined, upscaleFactor: undefined, ...nodaroVideoUpscalePlanFields(nodaro) }
              : {}),
            ...(draft
              ? {
                  taskId: draft.draftTaskId,
                  sourceJobId: draft.sourceJobId,
                  draftOutputSec: draft.outputSec,
                  draftHasRefVideo: draft.hasRefVideo,
                  ...(draft.nsfwChecker ? { draftNsfwChecker: true } : {}),
                  ...(draft.audioMux ? { draftAudioMux: draft.audioMux } : {}),
                  ...(draft.draftVideoUrl ? { draftVideoUrl: draft.draftVideoUrl } : {}),
                }
              : {}),
          },
          "video-upscale",
        ), "video-upscale"),
        ...(mcpClient ? { mcp_client: mcpClient } : {}),
      })

    if (error) {
      return sendInternalError(reply, req, error, "Failed to create job")
    }

    const reservation = await reserveCreditsForJob(req, reply, job.id, creditModel)
    if (reply.sent) return
    const usageLogId = reservation?.usageLogId

    if (nodaro) {
      // The clip, the tier and the measured seconds the hold was priced on —
      // the worker runs exactly these.
      await videoQueue.add("video-upscale", {
        jobId: job.id,
        provider,
        targetResolution: nodaro.tier,
        // The stored clip's URL (the plan's), the same the job's request records.
        ...nodaroVideoUpscalePlanFields(nodaro),
        usageLogId,
      })
      return { jobId: job.id }
    }

    await videoQueue.add("video-upscale", {
      jobId: job.id,
      videoUrl,
      upscaleFactor,
      ...(topaz ? { targetResolution: topaz.resolution, targetFps: topaz.fps } : {}),
      provider,
      kieTaskId,
      ...(draft ? { sourceJobId: draft.sourceJobId, draftHasRefVideo: draft.hasRefVideo } : {}),
      ...(draftBilledSec !== undefined ? { draftBilledSec } : {}),
      // The audio mux the draft got after rendering, re-applied to the 1080p
      // render (read from the SOURCE job by the preHandler, never the body).
      ...(draft?.nsfwChecker ? { draftNsfwChecker: true } : {}),
      ...(draft?.audioMux ? { draftAudioMux: draft.audioMux } : {}),
      ...(draft?.draftVideoUrl ? { draftVideoUrl: draft.draftVideoUrl } : {}),
      usageLogId,
    })

    return { jobId: job.id }
  })
}
