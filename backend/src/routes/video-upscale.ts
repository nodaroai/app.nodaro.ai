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
 *
 * Input:
 * - videoUrl: Source video to upscale — required for Topaz
 * - targetResolution: "720p" | "1080p" | "4k" (short side) — Topaz only, default 1080p
 * - targetFps: 15–60 — Topaz only, default the source's own rate
 * - upscaleFactor: "1", "2", or "4" — legacy Topaz lever, read only without a
 *   targetResolution (mapped over the source's short side)
 * - provider: "topaz" (default), "veo-1080p", "veo-4k" or "seedance-2-5-hd"
 * - taskId: Required for VEO providers (the original VEO job's providerTaskId; kieTaskId is a deprecated alias).
 *   For seedance-2-5-hd: the draft's providerTaskId (or pass sourceJobId).
 * - sourceJobId: seedance-2-5-hd only — the draft's job id.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { z } from "zod"
import { safeUrlSchema } from "../lib/url-validator.js"
import { insertJob } from "../lib/insert-job.js"
import { mayUseChildJobAsSource } from "../lib/job-submission-context.js"
import { kieTaskOwnedByAnother } from "../lib/kie-task-ownership.js"
import { videoQueue } from "../lib/queue.js"
import { creditGuard, reserveCreditsForJob, type RoutePricing } from "../middleware/credit-guard.js"
import { extractWorkflowId, extractNodeId, extractForcePrivate } from "../lib/request-helpers.js"
import { extractMcpClient } from "../lib/extract-mcp-client.js"
import { buildJobInputData } from "../lib/job-input-data.js"
import { SEEDANCE_DRAFT_FINALIZE_PROVIDER } from "@nodaro/shared/model-catalog"
import { TOPAZ_VIDEO_FPS_MAX, TOPAZ_VIDEO_FPS_MIN, TOPAZ_VIDEO_RESOLUTIONS, VIDEO_UPSCALE_PROVIDERS } from "@nodaro/shared/models"
import { TOPAZ_VIDEO_UNIT_CREDIT_ID } from "@nodaro/render-rules"
import { planTopazVideoUpscale, topazVideoHoldBaseCredits, TopazVideoSourceUnreadableError, TopazVideoTooLongError } from "../lib/topaz-video-plan.js"
import { formatZodError } from "../lib/zod-error.js"
import { sendInternalError } from "../lib/http-errors.js"
import {
  resolveSeedanceDraftFinalize,
  seedanceDraftFinalizeBaseCredits,
} from "../lib/seedance-draft-finalize.js"

export const videoUpscaleBody = z.object({
  videoUrl: safeUrlSchema.optional(),
  /** Legacy relative lever (Topaz): read only when `targetResolution` is absent. */
  upscaleFactor: z.enum(["1", "2", "4"]).optional(),
  targetResolution: z.enum(TOPAZ_VIDEO_RESOLUTIONS).optional(),
  targetFps: z.number().int().min(TOPAZ_VIDEO_FPS_MIN).max(TOPAZ_VIDEO_FPS_MAX).optional(),
  provider: z.enum(VIDEO_UPSCALE_PROVIDERS).default("topaz"),
  taskId: z.string().optional(),
  kieTaskId: z.string().optional(), // Deprecated alias of taskId, still accepted
  /** seedance-2-5-hd only: the draft's job id (alternative to taskId). */
  sourceJobId: z.string().optional(),
}).refine(
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

const resolveCreditModel = (req: FastifyRequest): string =>
  req.seedanceDraftFinalize?.creditId ??
  upscaleCreditModel(((req.body as Record<string, unknown> | undefined)?.provider as string | undefined) ?? "topaz")

/**
 * Everything /v1/video-upscale prices a request with — registered as the
 * route's preHandlers and run as-is by `POST /v1/quote` (one copy). The seeded
 * row prices every upscale, including a finalize of a draft made without a
 * reference video (`seedance-2-5-hd:{N}s`, DB-first). A finalize of a
 * reference-video draft bills input + output seconds, which the per-second
 * `-ref` row cannot express alone (same as the generation lane).
 */
export const videoUpscalePricing: RoutePricing = {
  prechecks: [seedanceDraftFinalizePreHandler, topazPlanPreHandler],
  modelResolver: resolveCreditModel,
  opts: {
    computeCredits: async (_body, req) => {
      if (req.topazVideoUpscale) return topazVideoHoldBaseCredits(req.topazVideoUpscale)
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

    const creditModel = draft ? draft.creditId : upscaleCreditModel(provider)
    const mcpClient = extractMcpClient(req.body)

    const { data: job, error } = await insertJob(req, {
        workflow_id: extractWorkflowId(req.body),
        node_id: extractNodeId(req.body),
        force_private: extractForcePrivate(req.body) || undefined,
        user_id: userId,
        status: "pending",
        input_data: buildJobInputData(
          {
            ...parsed.data,
            ...(topaz
              ? { targetResolution: topaz.resolution, targetFps: topaz.fps, topazHoldUnits: topaz.holdUnits }
              : {}),
            ...(draft
              ? {
                  taskId: draft.draftTaskId,
                  sourceJobId: draft.sourceJobId,
                  draftOutputSec: draft.outputSec,
                  draftHasRefVideo: draft.hasRefVideo,
                  ...(draft.audioMux ? { draftAudioMux: draft.audioMux } : {}),
                  ...(draft.draftVideoUrl ? { draftVideoUrl: draft.draftVideoUrl } : {}),
                }
              : {}),
          },
          "video-upscale",
        ),
        ...(mcpClient ? { mcp_client: mcpClient } : {}),
      })

    if (error) {
      return sendInternalError(reply, req, error, "Failed to create job")
    }

    const reservation = await reserveCreditsForJob(req, reply, job.id, creditModel)
    if (reply.sent) return
    const usageLogId = reservation?.usageLogId

    await videoQueue.add("video-upscale", {
      jobId: job.id,
      videoUrl,
      upscaleFactor,
      ...(topaz ? { targetResolution: topaz.resolution, targetFps: topaz.fps } : {}),
      provider,
      kieTaskId,
      ...(draft ? { sourceJobId: draft.sourceJobId } : {}),
      // The audio mux the draft got after rendering, re-applied to the 1080p
      // render (read from the SOURCE job by the preHandler, never the body).
      ...(draft?.audioMux ? { draftAudioMux: draft.audioMux } : {}),
      ...(draft?.draftVideoUrl ? { draftVideoUrl: draft.draftVideoUrl } : {}),
      usageLogId,
    })

    return { jobId: job.id }
  })
}
