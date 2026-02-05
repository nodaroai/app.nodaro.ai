import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { supabase } from "../lib/supabase.js"
import { videoQueue } from "../lib/queue.js"
import { config } from "../lib/config.js"
import { CreditsService } from "../services/credits.js"

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
  app.post("/v1/generate-image", async (req, reply) => {
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

    // Credit check for cloud edition only
    if (config.EDITION !== "self-hosted" && userId) {
      try {
        const creditCheck = await CreditsService.checkCredits(userId, modelIdentifier)

        if (!creditCheck.allowed) {
          return reply.status(402).send({
            error: {
              code: "insufficient_credits",
              message: creditCheck.error ?? "Insufficient credits",
            },
            required: creditCheck.required,
            balance: creditCheck.balance,
          })
        }
      } catch (err) {
        console.error("[generate-image] Credit check failed:", err)
        return reply.status(500).send({
          error: { code: "credit_check_failed", message: "Failed to check credits" },
        })
      }
    }

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

    // Reserve credits for cloud edition
    let usageLogId: string | undefined
    if (config.EDITION !== "self-hosted" && userId) {
      try {
        const reservation = await CreditsService.reserveCredits(
          userId,
          job.id,
          modelIdentifier,
          0, // provider cost calculated in worker
          0  // display cost calculated in worker
        )
        usageLogId = reservation.usageLogId

        // Store usageLogId in job's input_data for worker to access
        await supabase
          .from("jobs")
          .update({
            input_data: { prompt, referenceImageUrls, provider, type: "generate-image", usageLogId },
          })
          .eq("id", job.id)
      } catch (err) {
        console.error("[generate-image] Credit reservation failed:", err)
        // Delete the job if reservation fails
        await supabase.from("jobs").delete().eq("id", job.id)
        return reply.status(500).send({
          error: { code: "credit_reservation_failed", message: "Failed to reserve credits" },
        })
      }
    }

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
