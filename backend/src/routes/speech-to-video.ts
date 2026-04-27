import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { safeUrlSchema } from "../lib/url-validator.js"
import { supabase } from "../lib/supabase.js"
import { videoQueue } from "../lib/queue.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
import { extractWorkflowId, extractForcePrivate } from "../lib/request-helpers.js"
import { buildJobInputData } from "../lib/job-input-data.js"

const speechToVideoBody = z.object({
  imageUrl: safeUrlSchema,
  audioUrl: safeUrlSchema,
  prompt: z.string().min(1).max(2500),
  userPrompt: z.string().max(8000).optional(),
  resolution: z.enum(["480p", "580p", "720p"]).optional().default("480p"),
  negativePrompt: z.string().max(2500).optional(),
  seed: z.number().int().optional(),
  numFrames: z.number().int().min(16).max(81).optional(),
  fps: z.number().int().min(8).max(24).optional(),
  inferenceSteps: z.number().int().min(1).max(50).optional(),
  guidanceScale: z.number().min(0).max(20).optional(),
  shift: z.number().min(0).max(20).optional(),
  userId: z.string().uuid().optional(),
})

export async function speechToVideoRoutes(app: FastifyInstance) {
  app.post("/v1/speech-to-video", {
    preHandler: creditGuard((req) => {
      const body = req.body as Record<string, unknown>
      const resolution = (body?.resolution as string) ?? "480p"
      if (resolution === "720p") return "speech-to-video:720p"
      if (resolution === "580p") return "speech-to-video:580p"
      return "speech-to-video"
    }),
  }, async (req, reply) => {
    const parsed = speechToVideoBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: "validation_error",
          message: parsed.error.issues[0]?.message ?? "Invalid request",
        },
      })
    }

    const { imageUrl, audioUrl, prompt, resolution, negativePrompt, seed, numFrames, fps, inferenceSteps, guidanceScale, shift } = parsed.data
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
        input_data: buildJobInputData(parsed.data, "speech-to-video"),
      })
      .select("id")
      .single()

    if (error) {
      return reply.status(500).send({
        error: { code: "internal_error", message: error.message },
      })
    }

    const modelId = resolution === "720p"
      ? "speech-to-video:720p"
      : resolution === "580p"
        ? "speech-to-video:580p"
        : "speech-to-video"

    const reservation = await reserveCreditsForJob(req, reply, job.id, modelId)
    if (reply.sent) return
    const usageLogId = reservation?.usageLogId

    await videoQueue.add("speech-to-video", {
      jobId: job.id,
      imageUrl, audioUrl, prompt, resolution,
      negativePrompt, seed, numFrames, fps, inferenceSteps, guidanceScale, shift,
      usageLogId,
    })

    return { jobId: job.id }
  })
}
