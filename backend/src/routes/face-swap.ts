/**
 * Face Swap Route
 *
 * Replaces the face in a video with a face from a reference image.
 * Provider: arabyai-replicate/roop_face_swap (Replicate)
 *
 * The target video's length is read before anything is held: a video past
 * 60 seconds, or whose length cannot be read, is refused with nothing held
 * (`faceSwapLengthStep`, decided 2026-11-22). A run is held at its row, the
 * least it is charged; one Replicate billed more for is charged what it cost
 * (lib/face-swap-input.ts).
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { z } from "zod"
import { safeUrlSchema } from "../lib/url-validator.js"
import { insertJob } from "../lib/insert-job.js"
import { videoQueue } from "../lib/queue.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
import { extractWorkflowId, extractNodeId, extractForcePrivate } from "../lib/request-helpers.js"
import { extractMcpClient } from "../lib/extract-mcp-client.js"
import { buildJobInputData } from "../lib/job-input-data.js"
import { formatZodError } from "../lib/zod-error.js"
import { sendInternalError } from "../lib/http-errors.js"
import { enqueueRouteJob } from "../lib/enqueue-route-job.js"
import { FACE_SWAP_CREDIT_ID, readFaceSwapInput } from "../lib/face-swap-input.js"
import { dropClientMeasureFields, requestMeasure, setRequestMeasure } from "../lib/request-measure.js"
import { ROUTE_MEASURE_DEADLINE_MS } from "../lib/pre-charge-probe-bounds.js"
import { probeRefusalStatus } from "../providers/video/probe-guard.js"

export const faceSwapBody = z.object({
  faceImageUrl: safeUrlSchema,
  videoUrl: safeUrlSchema,
  provider: z.enum(["roop"]).default("roop"),
})

/** Body fields named like the server's own reading: dropped from every request, never read. */
const CLIENT_LENGTH_FIELDS: readonly string[] = ["faceSwapVideoSec"]
/** The key the length step keeps its reading under, server-side only. */
const LENGTH_KEY = "faceSwap"

/**
 * The credit guard's `beforePricing` step: past the guard's model and node
 * doors, validate the body with the handler's own schema, read the target
 * video's length (`readFaceSwapInput`, the rule the workflow run shares),
 * refuse a video past the limit or that cannot be read with nothing held, and
 * keep the reading on the server-side request.
 */
export async function faceSwapLengthStep(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  dropClientMeasureFields(req.body, CLIENT_LENGTH_FIELDS)
  const parsed = faceSwapBody.safeParse(req.body)
  if (!parsed.success) {
    return void reply.status(400).send({ error: { code: "validation_error", ...formatZodError(parsed.error) } })
  }
  const read = await readFaceSwapInput(parsed.data.videoUrl, (err) => {
    req.log.warn({ err }, "face-swap: the video's length could not be read; refusing the run")
  }, { deadlineAt: Date.now() + ROUTE_MEASURE_DEADLINE_MS })
  if (!read.ok) {
    return void reply.status(probeRefusalStatus(read.code)).send({ error: { code: read.code, message: read.message } })
  }
  setRequestMeasure(req, LENGTH_KEY, { clipSec: read.clipSec })
}

export async function faceSwapRoutes(app: FastifyInstance) {
  app.post("/v1/face-swap", {
    // The video's length is read inside the guard (`beforePricing`), after its model and node doors.
    preHandler: creditGuard(() => FACE_SWAP_CREDIT_ID, { beforePricing: faceSwapLengthStep }),
  }, async (req, reply) => {
    const parsed = faceSwapBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: "validation_error", ...formatZodError(parsed.error) },
      })
    }

    const { faceImageUrl, videoUrl, provider } = parsed.data
    const userId = req.userId

    if (!userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "Authentication required" },
      })
    }

    const measured = requestMeasure<{ readonly clipSec: number }>(req, LENGTH_KEY)
    const mcpClient = extractMcpClient(req.body)

    const { data: job, error } = await insertJob(req, {
        workflow_id: extractWorkflowId(req.body),
        node_id: extractNodeId(req.body),
        force_private: extractForcePrivate(req.body) || undefined,
        user_id: userId,
        status: "pending",
        input_data: {
          ...buildJobInputData(parsed.data, "face-swap"),
          resolvedModel: parsed.data.provider,
          // The length read before the hold (absent where credits are off and the guard did not measure).
          ...(measured ? { faceSwapVideoSec: measured.clipSec } : {}),
        },
        ...(mcpClient ? { mcp_client: mcpClient } : {}),
      })

    if (error) {
      return sendInternalError(reply, req, error, "Failed to create job")
    }

    const reservation = await reserveCreditsForJob(req, reply, job.id, FACE_SWAP_CREDIT_ID)
    if (reply.sent) return
    const usageLogId = reservation?.usageLogId

    await enqueueRouteJob(req, reply, job.id, () => videoQueue.add("face-swap", {
      jobId: job.id,
      faceImageUrl,
      videoUrl,
      provider,
      usageLogId,
    }))
    if (reply.sent) return

    return { jobId: job.id }
  })
}
