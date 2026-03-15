import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { supabase } from "../lib/supabase.js"
import { videoQueue } from "../lib/queue.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
import { extractWorkflowId, extractForcePrivate } from "../lib/request-helpers.js"

const textToDialogueBody = z.object({
  dialogue: z.array(z.object({
    text: z.string().min(1),
    voice: z.string().min(1),
  })).min(1).refine(
    (lines) => lines.reduce((sum, l) => sum + l.text.length, 0) <= 5000,
    { message: "Total dialogue text must not exceed 5000 characters" }
  ),
  stability: z.number().refine((v) => v === 0 || v === 0.5 || v === 1, {
    message: "Stability must be 0, 0.5, or 1",
  }).optional(),
  languageCode: z.string().max(10).optional(),
  userId: z.string().uuid().optional(),
})

export async function textToDialogueRoutes(app: FastifyInstance) {
  app.post("/v1/text-to-dialogue", {
    preHandler: creditGuard(() => "elevenlabs-dialogue"),
  }, async (req, reply) => {
    const parsed = textToDialogueBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: "validation_error",
          message: parsed.error.issues[0]?.message ?? "Invalid request",
        },
      })
    }

    const { dialogue, stability, languageCode } = parsed.data
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
        force_private: extractForcePrivate(req.body) || undefined,
        user_id: userId,
        status: "pending",
        input_data: { dialogue, stability, languageCode, type: "text-to-dialogue" },
      })
      .select("id")
      .single()

    if (error) {
      return reply.status(500).send({
        error: { code: "internal_error", message: error.message },
      })
    }

    const reservation = await reserveCreditsForJob(req, reply, job.id, "elevenlabs-dialogue")
    if (reply.sent) return
    const usageLogId = reservation?.usageLogId

    await videoQueue.add("text-to-dialogue", {
      jobId: job.id,
      dialogue,
      stability,
      languageCode,
      usageLogId,
    })

    return { jobId: job.id }
  })
}
