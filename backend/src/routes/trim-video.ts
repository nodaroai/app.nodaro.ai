import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { safeUrlSchema } from "../lib/url-validator.js"
import { insertJob } from "../lib/insert-job.js"
import { supabase } from "../lib/supabase.js"
import { videoQueue } from "../lib/queue.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
import { extractWorkflowId, extractNodeId, extractForcePrivate } from "../lib/request-helpers.js"
import { extractMcpClient } from "../lib/extract-mcp-client.js"
import { buildJobInputData } from "../lib/job-input-data.js"
import { measureVideoUtilityPreHandler, stashedVideoUtilityLength, VIDEO_UTILITY_CLIENT_CLOSED, videoUtilityClientGone, videoUtilityMeasuredBaseCredits, withoutVideoUtilityStash } from "../lib/video-utility-length.js"
import { formatZodError } from "../lib/zod-error.js"
import { sendInternalError } from "../lib/http-errors.js"
import { enqueueRouteJob } from "../lib/enqueue-route-job.js"

const trimVideoBody = z.object({
  videoUrl: safeUrlSchema,
  // Time-based trim (seconds). Optional when caller uses frame-based or
  // smart-cut mode; the worker dispatches based on which fields are set.
  startTime: z.number().min(0).optional().default(0),
  endTime: z.number().min(0).optional(),
  // Frame-based trim. Either or both may be set; overrides time-based.
  // Worker probes source fps and converts.
  trimStartFrames: z.number().int().min(0).optional(),
  trimEndFrames: z.number().int().min(0).optional(),
  // Seconds-mirror of the frames mode: trim N seconds from start AND/OR end.
  // Worker probes duration to convert end-trim into an endTime.
  trimStartSeconds: z.number().min(0).optional(),
  trimEndSeconds: z.number().min(0).optional(),
  // Keep only the first/last N seconds. Worker probes duration.
  keepFirstSeconds: z.number().positive().optional(),
  keepLastSeconds: z.number().positive().optional(),
  // Smart loop cut: ignore startTime/endTime/trim*Frames; the worker
  // empirically finds the trailing frame closest to frame 0 (PSNR) and
  // cuts there. `lookbackFrames` bounds how many trailing candidates to
  // evaluate (default 16, max 64).
  smartLoopCut: z.boolean().optional().default(false),
  smartLoopCutLookback: z.number().int().min(2).max(64).optional(),
  outputSilentVideo: z.boolean().optional().default(false),
  // LOSSLESS KEYFRAME SNAP: snap the trim start back to the nearest keyframe
  // and stream-copy (no re-encode). Ignored by smart-loop-cut.
  losslessKeyframe: z.boolean().optional().default(false),
  userId: z.string().uuid().optional(),
  // Accepted for older clients and ignored: the run is priced by the video's
  // length as the route measures it (lib/video-utility-length.ts), never by a
  // length the request sends.
  upstreamDuration: z.number().positive().optional(),
  // Mirror frontend's trimMode for the estimator (default "time"). Worker
  // doesn't read this directly — it dispatches based on which fields are set.
  trimMode: z.enum(["time", "seconds", "keep-first-seconds", "keep-last-seconds", "frames", "smart-loop-cut"]).optional(),
})

export async function trimVideoRoutes(app: FastifyInstance) {
  // One unit when the request was not measured yet (the floor), the measured units once it was.
  const computeCredits = (body: unknown) => videoUtilityMeasuredBaseCredits("trim-video", stashedVideoUtilityLength(body)?.units ?? 1)
  const guard = creditGuard(() => "trim-video", { computeCredits })
  const measuredGuard = creditGuard(() => "trim-video", { computeCredits, dedup: false })
  app.post("/v1/trim-video", {
    preHandler: [
      // The balance at the one-unit floor first (and a repeat of the same request), before anything is fetched.
      guard,
      // The video is measured next — the body parsed first, so a malformed or oversized request probes nothing.
      measureVideoUtilityPreHandler("trim-video", trimVideoBody),
      // Then the measured units are what the guard prices (each at the trim-video row).
      measuredGuard,
    ],
  }, async (req, reply) => {
    const measured = stashedVideoUtilityLength(req.body)
    const parsed = trimVideoBody.safeParse(withoutVideoUtilityStash(req.body))
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: "validation_error", ...formatZodError(parsed.error) },
      })
    }

    const { userId: _bodyUserId, upstreamDuration: _upDur, ...restData } = parsed.data
    // The length and units it was charged ride the job (after the spread: a client's field never wins).
    const charged = { upstreamDuration: measured?.secs[0], billedUnits: measured?.units }
    const userId = req.userId

    if (!userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "Authentication required" },
      })
    }

    const modelIdentifier = "trim-video"
    const mcpClient = extractMcpClient(req.body)

    // Its client went away while its clips were measured: no job, no reservation.
    if (videoUtilityClientGone(req)) return reply.status(499).send({ error: VIDEO_UTILITY_CLIENT_CLOSED })

    const { data: job, error } = await insertJob(req, {
        workflow_id: extractWorkflowId(req.body),
        node_id: extractNodeId(req.body),
        force_private: extractForcePrivate(req.body) || undefined,
        user_id: userId,
        status: "pending",
        input_data: { ...buildJobInputData(parsed.data, "trim-video"), ...charged },
        ...(mcpClient ? { mcp_client: mcpClient } : {}),
      })

    if (error) {
      return sendInternalError(reply, req, error, "Failed to create job")
    }

    // Reserve credits
    const reservation = await reserveCreditsForJob(req, reply, job.id, modelIdentifier)
    if (reply.sent) return
    const usageLogId = reservation?.usageLogId

    // `trimMode` stays on the payload (the worker cuts by the fields it sets) so the
    // render's charge check prices the downloaded video by the same formula.
    await enqueueRouteJob(req, reply, job.id, () => videoQueue.add("trim-video", { jobId: job.id, ...restData, ...charged, usageLogId }))
    if (reply.sent) return
    return { jobId: job.id }
  })
}
