/**
 * Video Depth Route — video in → depth video out.
 * Providers: video-depth-anything (fal, default), depth-anything-frames (Replicate).
 *
 * The clip is probed BEFORE the credit guard (lib/video-depth-input.ts): an
 * over-long or unreadable clip is a 400 with nothing reserved, and the measured
 * length picks the price row. Levers a provider does not honour are dropped,
 * never rejected, and a colormap it cannot render is coerced to grayscale
 * (`resolveVideoDepthColormap`) — a provider switched by a FieldMapping must
 * still run.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { z } from "zod"
import {
  VIDEO_DEPTH_PROVIDERS,
  VIDEO_DEPTH_MODEL_SIZES,
  VIDEO_DEPTH_COLORMAPS,
  VIDEO_DEPTH_RESOLUTIONS,
  videoDepthLevers,
  resolveVideoDepthColormap,
} from "@nodaro/shared/media"
import { safeUrlSchema } from "../lib/url-validator.js"
import { insertJob } from "../lib/insert-job.js"
import { videoQueue } from "../lib/queue.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
import { extractWorkflowId, extractNodeId, extractForcePrivate } from "../lib/request-helpers.js"
import { extractMcpClient } from "../lib/extract-mcp-client.js"
import { buildJobInputData } from "../lib/job-input-data.js"
import { formatZodError } from "../lib/zod-error.js"
import { sendInternalError } from "../lib/http-errors.js"
import { measureVideoDepthInput } from "../lib/video-depth-input.js"

const videoDepthBody = z.object({
  // safeUrlSchema (not z.string().url()): rejects local paths, non-http(s) and
  // literal private/reserved IPs at the boundary. The DNS-rebinding case is
  // closed at the ffprobe sink by assertSafeProbeSource in ffmpeg-utils.ts.
  videoUrl: safeUrlSchema,
  provider: z.enum(VIDEO_DEPTH_PROVIDERS).default("video-depth-anything"),
  modelSize: z.enum(VIDEO_DEPTH_MODEL_SIZES).default("large"),
  colormap: z.enum(VIDEO_DEPTH_COLORMAPS).optional(),
  resolution: z.enum(VIDEO_DEPTH_RESOLUTIONS).optional(),
  sideBySide: z.boolean().optional(),
  userId: z.string().uuid().optional(),
})
type VideoDepthBody = z.infer<typeof videoDepthBody>

/** What the probe needs, validated before anything is fetched or priced. */
const probeInput = videoDepthBody.pick({ videoUrl: true, provider: true })

const STASH = "__videoDepth"
type Stash = { durationSec: number; creditId: string }

/**
 * Fastify preHandler, ahead of the credit guard: validates the URL and the
 * provider (the probe must never fetch a local path — `probeVideoSource`'s
 * guard only inspects strings with a scheme — and an unknown provider must
 * never reach a price row), measures the clip, and stashes the length and its
 * price row on the body for the guard and the handler.
 */
async function probePreHandler(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const body = (req.body ?? {}) as Record<string, unknown>
  const input = probeInput.safeParse(body)
  if (!input.success) {
    return void reply.status(400).send({ error: { code: "validation_error", ...formatZodError(input.error) } })
  }
  // The credit guard's model deny reads the RAW `body.provider`; write the
  // resolved one back so a request that omits it cannot run (and bill) on a
  // default model the deployment denied. (`denyResolvedModel` does not fit:
  // the guard's resolver returns the bucket id, not the dispatch id.)
  body.provider = input.data.provider
  const measured = await measureVideoDepthInput(input.data.provider, input.data.videoUrl, (err) => {
    req.log.warn({ err }, "video-depth: ffprobe failed")
  })
  if (!measured.ok) {
    return void reply.status(400).send({ error: { code: measured.code, message: measured.message } })
  }
  body[STASH] = { durationSec: measured.durationSec, creditId: measured.creditId } satisfies Stash
}

const stashOf = (body: unknown): Stash | undefined =>
  (body as Record<string, unknown> | undefined)?.[STASH] as Stash | undefined

/** The optional levers `provider` honours, with the colormap resolved for it. */
function leversFor(d: VideoDepthBody): Partial<Pick<VideoDepthBody, "colormap" | "resolution" | "sideBySide">> {
  const has = videoDepthLevers(d.provider)
  const colormap = resolveVideoDepthColormap(d.provider, d.colormap)
  return {
    ...(colormap ? { colormap } : {}),
    ...(has.has("resolution") && d.resolution ? { resolution: d.resolution } : {}),
    ...(has.has("sideBySide") && d.sideBySide !== undefined ? { sideBySide: d.sideBySide } : {}),
  }
}

export async function videoDepthRoutes(app: FastifyInstance) {
  app.post("/v1/video-depth", {
    preHandler: [
      probePreHandler,
      // Priced from the measured length's own row (`<provider>:<n>s`); the
      // fallback only covers a body the preHandler already refused.
      creditGuard((req) => stashOf(req.body)?.creditId ?? VIDEO_DEPTH_PROVIDERS[0]),
    ],
  }, async (req, reply) => {
    // Strip the preHandler stash before parsing so it never reaches input_data.
    const { [STASH]: _stash, ...toParse } = (req.body ?? {}) as Record<string, unknown>
    const parsed = videoDepthBody.safeParse(toParse)
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: "validation_error", ...formatZodError(parsed.error) },
      })
    }
    const userId = req.userId
    if (!userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "Authentication required" },
      })
    }
    const stash = stashOf(req.body)
    if (!stash) {
      // Unreachable while probePreHandler runs first; an invariant, not a user error.
      return sendInternalError(reply, req, new Error("video-depth: probe stash missing"), "Failed to create job")
    }

    const d = parsed.data
    const levers = leversFor(d)
    const mcpClient = extractMcpClient(req.body)
    try {
      const { data: job, error } = await insertJob(req, {
        workflow_id: extractWorkflowId(req.body),
        node_id: extractNodeId(req.body),
        force_private: extractForcePrivate(req.body) || undefined,
        user_id: userId,
        status: "pending",
        input_data: {
          ...buildJobInputData({ videoUrl: d.videoUrl, provider: d.provider, modelSize: d.modelSize, ...levers }, "video-depth"),
          duration_seconds: stash.durationSec,
          bucketKey: stash.creditId,
        },
        ...(mcpClient ? { mcp_client: mcpClient } : {}),
      })
      if (error || !job) return sendInternalError(reply, req, error, "Failed to create job")

      const reservation = await reserveCreditsForJob(req, reply, job.id, stash.creditId)
      if (reply.sent) return

      await videoQueue.add("video-depth", {
        jobId: job.id,
        videoUrl: d.videoUrl,
        provider: d.provider,
        modelSize: d.modelSize,
        ...levers,
        durationSec: stash.durationSec,
        usageLogId: reservation?.usageLogId,
      })
      return { jobId: job.id }
    } catch (err) {
      return sendInternalError(reply, req, err, "Failed to create job")
    }
  })
}
