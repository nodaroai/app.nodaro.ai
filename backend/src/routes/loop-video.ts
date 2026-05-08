import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { safeUrlSchema } from "../lib/url-validator.js"
import { supabase } from "../lib/supabase.js"
import { videoQueue } from "../lib/queue.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
import { extractWorkflowId, extractForcePrivate } from "../lib/request-helpers.js"
import { buildJobInputData } from "../lib/job-input-data.js"
import { estimateLoopVideoCredits } from "@nodaro/shared"
import { formatZodError } from "../lib/zod-error.js"

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
  /** Optional upstream video duration (seconds) for accurate credit
   *  estimation. When omitted, backend falls back to 8s. */
  upstreamDuration: z.number().positive().optional(),
  userId: z.string().uuid().optional(),
})

export async function loopVideoRoutes(app: FastifyInstance) {
  app.post("/v1/loop-video", {
    preHandler: creditGuard(() => "loop-video", {
      computeCredits: (body) => {
        const b = body as Record<string, unknown>
        const upstream = typeof b.upstreamDuration === "number" ? b.upstreamDuration : undefined
        return estimateLoopVideoCredits({
          mode: b.mode as "repeat" | "duration" | undefined,
          repeatCount: b.repeatCount as number | undefined,
          targetDuration: b.targetDuration as number | undefined,
          smartLoopCutBeforeRepeat: b.smartLoopCutBeforeRepeat as boolean | undefined,
          smartLoopCutLookback: b.smartLoopCutLookback as number | undefined,
        }, upstream)
      },
    }),
  }, async (req, reply) => {
    const parsed = loopVideoBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: "validation_error", ...formatZodError(parsed.error) },
      })
    }

    const { userId: _bodyUserId, upstreamDuration: _upDur, ...restData } = parsed.data
    const userId = req.userId

    if (!userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "Authentication required" },
      })
    }

    const modelIdentifier = "loop-video"

    const { data: job, error } = await supabase
      .from("jobs")
      .insert({
        workflow_id: extractWorkflowId(req.body),
        force_private: extractForcePrivate(req.body) || undefined,
        user_id: userId,
        status: "pending",
        input_data: buildJobInputData(parsed.data, "loop-video"),
      })
      .select("id")
      .single()

    if (error) {
      return reply.status(500).send({ error: { code: "internal_error", message: error.message } })
    }

    const reservation = await reserveCreditsForJob(req, reply, job.id, modelIdentifier)
    if (reply.sent) return
    const usageLogId = reservation?.usageLogId

    await videoQueue.add("loop-video", { jobId: job.id, ...restData, usageLogId })
    return { jobId: job.id }
  })
}
