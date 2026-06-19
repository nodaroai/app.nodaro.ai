import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { supabase } from "../lib/supabase.js"
import { videoQueue } from "../lib/queue.js"
import { safeUrlSchema } from "../lib/url-validator.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
import { extractWorkflowId, extractNodeId, extractForcePrivate } from "../lib/request-helpers.js"
import { buildJobInputData } from "../lib/job-input-data.js"
import { formatZodError } from "../lib/zod-error.js"

const audioSeparationBody = z.object({
  audioUrl: safeUrlSchema,
  mode: z.enum(["vocal_instrumental", "stems"]).optional().default("vocal_instrumental"),
  quality: z.enum(["auto", "fast", "best"]).optional().default("auto"),
  userId: z.string().uuid().optional(),
})

/** Composite credit id from the raw `quality` (read before Zod strips it). */
function audioSeparationCreditId(quality: unknown): string {
  return quality === "best" ? "audio-separation:best" : "audio-separation"
}

export async function audioSeparationRoutes(app: FastifyInstance) {
  app.post("/v1/audio-separation", {
    preHandler: creditGuard((req) => {
      const body = req.body as Record<string, unknown> | undefined
      return audioSeparationCreditId(body?.quality)
    }),
  }, async (req, reply) => {
    const parsed = audioSeparationBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: "validation_error", ...formatZodError(parsed.error) },
      })
    }

    const { audioUrl, mode, quality } = parsed.data
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
        input_data: buildJobInputData(parsed.data, "audio-separation"),
      })
      .select("id")
      .single()

    if (error) {
      return reply.status(500).send({
        error: { code: "internal_error", message: error.message },
      })
    }

    const reservation = await reserveCreditsForJob(req, reply, job.id, audioSeparationCreditId(quality))
    if (reply.sent) return
    const usageLogId = reservation?.usageLogId

    await videoQueue.add("audio-separation", {
      jobId: job.id,
      audioUrl,
      mode,
      quality,
      usageLogId,
    })

    return { jobId: job.id }
  })
}
