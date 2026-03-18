import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { safeUrlSchema } from "../lib/url-validator.js"
import { supabase } from "../lib/supabase.js"
import { videoQueue } from "../lib/queue.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
import { extractWorkflowId, extractForcePrivate } from "../lib/request-helpers.js"

const soraCharacterBody = z.object({
  mode: z.enum(["video", "sora-task"]),
  characterPrompt: z.string().max(5000),
  characterName: z.string().max(40).optional(),
  timestamps: z.string().optional(),
  safetyInstruction: z.string().optional(),
  videoUrl: safeUrlSchema.optional(),
  kieTaskId: z.string().optional(),
  userId: z.string().uuid(),
})

export async function soraCharacterRoutes(app: FastifyInstance) {
  app.post("/v1/sora-character", {
    preHandler: creditGuard(() => "sora-character"),
  }, async (req, reply) => {
    const parsed = soraCharacterBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: "validation_error",
          message: parsed.error.issues[0]?.message ?? "Invalid request",
        },
      })
    }

    const { mode, characterPrompt, characterName, timestamps, safetyInstruction, videoUrl, kieTaskId } = parsed.data
    const userId = req.userId

    if (!userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "Authentication required" },
      })
    }

    // Mode-specific validation
    if (mode === "video" && !videoUrl) {
      return reply.status(400).send({
        error: { code: "validation_error", message: "videoUrl is required for video mode" },
      })
    }
    if (mode === "sora-task" && (!kieTaskId || !timestamps)) {
      return reply.status(400).send({
        error: { code: "validation_error", message: "kieTaskId and timestamps are required for sora-task mode" },
      })
    }

    const { data: job, error } = await supabase
      .from("jobs")
      .insert({
        workflow_id: extractWorkflowId(req.body),
        force_private: extractForcePrivate(req.body) || undefined,
        user_id: userId,
        status: "pending",
        input_data: {
          type: "sora-character",
          mode,
          characterPrompt,
          characterName,
          timestamps,
          safetyInstruction,
          videoUrl,
          kieTaskId,
        },
      })
      .select("id")
      .single()

    if (error) {
      return reply.status(500).send({
        error: { code: "internal_error", message: error.message },
      })
    }

    const reservation = await reserveCreditsForJob(req, reply, job.id, "sora-character")
    if (reply.sent) return
    const usageLogId = reservation?.usageLogId

    await videoQueue.add("sora-character", {
      jobId: job.id,
      mode,
      characterPrompt,
      characterName,
      timestamps,
      safetyInstruction,
      videoUrl,
      kieTaskId,
      usageLogId,
    })

    return { jobId: job.id }
  })
}
