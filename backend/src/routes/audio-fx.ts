import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { safeUrlSchema } from "../lib/url-validator.js"
import { supabase } from "../lib/supabase.js"
import { videoQueue } from "../lib/queue.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
import { extractWorkflowId, extractNodeId, extractForcePrivate } from "../lib/request-helpers.js"
import { buildJobInputData } from "../lib/job-input-data.js"
import { formatZodError } from "../lib/zod-error.js"
import { sendInternalError } from "../lib/http-errors.js"
import { AUDIO_FX_PRESETS } from "@nodaro/shared"

const audioFxBody = z.object({
  audioUrl: safeUrlSchema,
  preset: z.enum(AUDIO_FX_PRESETS).optional().default("room"),
  mix: z.number().min(0).max(100).optional(),
  delayMs: z.number().min(20).max(2000).optional(),
  decay: z.number().min(0.1).max(0.9).optional(),
  eqLow: z.number().min(-20).max(20).optional(),
  eqHigh: z.number().min(-20).max(20).optional(),
  userId: z.string().uuid().optional(),
})

export async function audioFxRoutes(app: FastifyInstance) {
  app.post("/v1/audio-fx", { preHandler: creditGuard(() => "audio-fx") }, async (req, reply) => {
    const parsed = audioFxBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: "validation_error", ...formatZodError(parsed.error) },
      })
    }

    const { userId: _bodyUserId, ...restData } = parsed.data
    const userId = req.userId
    if (!userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "Authentication required" },
      })
    }

    const { data: job, error } = await supabase
      .from("jobs")
      .insert({
        workflow_id: extractWorkflowId(req.body),
        node_id: extractNodeId(req.body),
        force_private: extractForcePrivate(req.body) || undefined,
        user_id: userId,
        status: "pending",
        input_data: buildJobInputData(parsed.data, "audio-fx"),
      })
      .select("id")
      .single()

    if (error) {
      return sendInternalError(reply, req, error, "Failed to create job")
    }

    const reservation = await reserveCreditsForJob(req, reply, job.id, "audio-fx")
    if (reply.sent) return
    const usageLogId = reservation?.usageLogId

    await videoQueue.add("audio-fx", { jobId: job.id, ...restData, usageLogId })
    return { jobId: job.id }
  })
}
