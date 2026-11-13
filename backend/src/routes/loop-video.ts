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

const loopVideoBody = z.object({
  videoUrl: safeUrlSchema,
  mode: z.enum(["repeat", "duration"]),
  repeatCount: z.number().int().min(2).max(20).optional(),
  targetDuration: z.number().min(1).max(300).optional(),
  // Smart loop cut preprocess: trim the input to its cleanest loop
  // boundary BEFORE concatenating. Eliminates seam discontinuity at
  // every internal repeat boundary.
  smartLoopCutBeforeRepeat: z.boolean().optional().default(false),
  smartLoopCutLookback: z.number().int().min(2).max(64).optional(),
  /** Accepted for older clients and ignored: the run is priced by the video's
   *  length as the route measures it (lib/video-utility-length.ts). */
  upstreamDuration: z.number().positive().optional(),
  userId: z.string().uuid().optional(),
})

export async function loopVideoRoutes(app: FastifyInstance) {
  // One unit when the request was not measured yet (the floor), the measured units once it was.
  const computeCredits = (body: unknown) => videoUtilityMeasuredBaseCredits("loop-video", stashedVideoUtilityLength(body)?.units ?? 1)
  const guard = creditGuard(() => "loop-video", { computeCredits })
  const measuredGuard = creditGuard(() => "loop-video", { computeCredits, dedup: false })
  app.post("/v1/loop-video", {
    preHandler: [
      // The balance at the one-unit floor first (and a repeat of the same request), before anything is fetched.
      guard,
      // The video is measured next — the body parsed first, so a malformed or oversized request probes nothing.
      measureVideoUtilityPreHandler("loop-video", loopVideoBody),
      // Then the measured units are what the guard prices (each at the loop-video row).
      measuredGuard,
    ],
  }, async (req, reply) => {
    const measured = stashedVideoUtilityLength(req.body)
    const parsed = loopVideoBody.safeParse(withoutVideoUtilityStash(req.body))
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

    const modelIdentifier = "loop-video"
    const mcpClient = extractMcpClient(req.body)

    // Its client went away while its clips were measured: no job, no reservation.
    if (videoUtilityClientGone(req)) return reply.status(499).send({ error: VIDEO_UTILITY_CLIENT_CLOSED })

    const { data: job, error } = await insertJob(req, {
        workflow_id: extractWorkflowId(req.body),
        node_id: extractNodeId(req.body),
        force_private: extractForcePrivate(req.body) || undefined,
        user_id: userId,
        status: "pending",
        input_data: { ...buildJobInputData(parsed.data, "loop-video"), ...charged },
        ...(mcpClient ? { mcp_client: mcpClient } : {}),
      })

    if (error) {
      return sendInternalError(reply, req, error, "Failed to create job")
    }

    const reservation = await reserveCreditsForJob(req, reply, job.id, modelIdentifier)
    if (reply.sent) return
    const usageLogId = reservation?.usageLogId

    await enqueueRouteJob(req, reply, job.id, () => videoQueue.add("loop-video", { jobId: job.id, ...restData, ...charged, usageLogId }))
    if (reply.sent) return
    return { jobId: job.id }
  })
}
