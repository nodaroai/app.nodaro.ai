import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { supabase } from "../lib/supabase.js"
import { videoQueue } from "../lib/queue.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"

const generateImageBody = z.object({
  prompt: z.string().min(1).max(2000),
  referenceImageUrls: z.array(z.string().url()).max(14).optional(),
  characterDescriptions: z.array(z.string().max(500)).max(10).optional(),
  provider: z.enum([
    // Replicate providers
    "nano-banana",
    "flux",
    "dalle",
    "midjourney",
    // KIE.ai providers
    "nano-banana-pro",
    "grok",
    "gpt-image",
    "flux-i2i",
    "grok-i2i",
    "gpt-image-i2i",
  ]).optional(),
  userId: z.string().uuid().optional(),
})

export async function generateImageRoutes(app: FastifyInstance) {
  app.post("/v1/generate-image", { preHandler: creditGuard((req) => { const body = req.body as Record<string, unknown>; return (body?.provider as string) ?? "nano-banana" }) }, async (req, reply) => {
    const parsed = generateImageBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: "validation_error",
          message: parsed.error.issues[0]?.message ?? "Invalid request",
        },
      })
    }

    const { prompt: rawPrompt, referenceImageUrls, characterDescriptions, provider, userId } = parsed.data

    // Determine model identifier for credit check (default to nano-banana)
    const modelIdentifier = provider ?? "nano-banana"

    // Append character descriptions to prompt
    const descSuffix = (characterDescriptions ?? []).map((d) => d).join(" ")
    const prompt = descSuffix ? `${rawPrompt}\n${descSuffix}` : rawPrompt

    const { data: job, error } = await supabase
      .from("jobs")
      .insert({
        workflow_id: null,
        user_id: userId ?? null,
        status: "pending",
        input_data: { prompt, referenceImageUrls, provider, type: "generate-image" },
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

    await videoQueue.add("generate-image", {
      jobId: job.id,
      prompt,
      referenceImageUrls,
      provider,
      usageLogId,
    })

    return { jobId: job.id }
  })
}
