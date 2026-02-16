import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { supabase } from "../lib/supabase.js"
import { videoQueue } from "../lib/queue.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"

const generateVideoBody = z.object({
  imageUrl: z.string().url(),                      // Start frame image
  endFrameUrl: z.string().url().optional(),        // Optional end frame (for supported providers)
  audioUrl: z.string().url().optional(),           // Optional audio track to merge after generation
  prompt: z.string().max(2000).optional(),
  // Replicate providers + KIE-only providers
  provider: z.enum([
    // Available on both Replicate and KIE
    "veo3", "veo3.1", "kling", "minimax",
    // Replicate only
    "veo", "runway", "pika", "sora",
    // KIE only
    "kling-turbo", "kling-3.0", "grok-i2v", "sora2-pro"
  ]).optional(),
  generateAudio: z.boolean().optional(),
  duration: z.number().int().min(1).max(60).optional(),
  mode: z.enum(["pro", "std"]).optional(),       // Kling 3.0 quality mode
  sound: z.boolean().optional(),                  // Kling 3.0 sound effects
  aspectRatio: z.enum(["16:9", "9:16", "1:1"]).optional(),
  multiShot: z.boolean().optional(),
  shots: z.array(z.object({ prompt: z.string().max(2500), duration: z.number().int().min(1).max(12) })).max(6).optional(),
  elements: z.array(z.object({ name: z.string().max(50), description: z.string().max(200), type: z.enum(["image", "video"]), urls: z.array(z.string().url()).min(1).max(4) })).max(5).optional(),
  userId: z.string().uuid().optional(),
})

export async function generateVideoRoutes(app: FastifyInstance) {
  app.post("/v1/generate-video", { preHandler: creditGuard((req) => { const body = req.body as Record<string, unknown>; return (body?.provider as string) ?? "minimax" }) }, async (req, reply) => {
    const parsed = generateVideoBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: "validation_error",
          message: parsed.error.issues[0]?.message ?? "Invalid request",
        },
      })
    }

    const { imageUrl, endFrameUrl, audioUrl, prompt, provider, generateAudio, duration, mode, sound, aspectRatio, multiShot, shots, elements, userId } = parsed.data

    if (!userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "userId is required" },
      })
    }

    // Determine model identifier for credit check (default to minimax)
    const modelIdentifier = provider ?? "minimax"

    const { data: job, error } = await supabase
      .from("jobs")
      .insert({
        workflow_id: null,
        user_id: userId,
        status: "pending",
        input_data: { imageUrl, endFrameUrl, audioUrl, prompt, provider, generateAudio, duration, mode, sound, aspectRatio, multiShot, shots, elements, type: "image-to-video" },
      })
      .select("id")
      .single()

    if (error) {
      return reply.status(500).send({
        error: { code: "internal_error", message: error.message },
      })
    }

    // Reserve credits
    const reservation = await reserveCreditsForJob(req, reply, job.id, modelIdentifier)
    if (reply.sent) return
    const usageLogId = reservation?.usageLogId

    await videoQueue.add("image-to-video", {
      jobId: job.id,
      imageUrl,
      endFrameUrl,
      audioUrl,
      prompt,
      provider,
      generateAudio,
      duration,
      mode,
      sound,
      aspectRatio,
      multiShot,
      shots,
      elements,
      usageLogId,
    })

    return { jobId: job.id }
  })
}
