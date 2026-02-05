import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { supabase } from "../lib/supabase.js"
import { videoQueue } from "../lib/queue.js"
import { config } from "../lib/config.js"
import { CreditsService } from "../services/credits.js"

const generateObjectBody = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  category: z.enum(["furniture", "vehicle", "weapon", "food", "clothing", "electronics", "nature", "tool", "other"]).optional(),
  style: z.enum(["realistic", "anime", "3d-pixar", "illustration"]).optional(),
  sourceImageUrl: z.string().url().optional(),
  userId: z.string().uuid().optional(),
})

export async function generateObjectRoutes(app: FastifyInstance) {
  app.post("/v1/generate-object", async (req, reply) => {
    const parsed = generateObjectBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: "validation_error",
          message: parsed.error.issues[0]?.message ?? "Invalid request",
        },
      })
    }

    const { name, description, category, style, sourceImageUrl, userId } = parsed.data

    // Model identifier for credit check (hardcoded to nano-banana)
    const modelIdentifier = "nano-banana"

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
        console.error("[generate-object] Credit check failed:", err)
        return reply.status(500).send({
          error: { code: "credit_check_failed", message: "Failed to check credits" },
        })
      }
    }

    // Build single front view object prompt
    const categoryDesc = category ?? "object"
    const descPart = description ? `, ${description}` : ""
    const styleDesc = style ?? "realistic"
    const prompt = [
      `Single ${categoryDesc} ${name}${descPart},`,
      `${styleDesc} art style, front view,`,
      "4k, highly detailed, white/plain background, no text, no labels, no watermarks, product photography style.",
    ].join(" ")

    const { data: job, error } = await supabase
      .from("jobs")
      .insert({
        workflow_id: null,
        user_id: userId ?? null,
        status: "pending",
        input_data: {
          prompt,
          sourceImageUrl,
          type: "generate-object",
          objectData: { name, description, category, style },
        },
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

        // Store usageLogId in dedicated column for worker to access
        await supabase
          .from("jobs")
          .update({ usage_log_id: usageLogId })
          .eq("id", job.id)
      } catch (err) {
        console.error("[generate-object] Credit reservation failed:", err)
        // Delete the job if reservation fails
        await supabase.from("jobs").delete().eq("id", job.id)
        return reply.status(500).send({
          error: { code: "credit_reservation_failed", message: "Failed to reserve credits" },
        })
      }
    }

    await videoQueue.add("generate-object", {
      jobId: job.id,
      prompt,
      sourceImageUrl,
      provider: "nano-banana",
      usageLogId,
    })

    return { jobId: job.id }
  })
}
