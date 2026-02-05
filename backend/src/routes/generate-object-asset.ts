import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { supabase } from "../lib/supabase.js"
import { videoQueue } from "../lib/queue.js"
import { config } from "../lib/config.js"
import { CreditsService } from "../services/credits.js"

const assetTypeEnum = z.enum(["angles", "materials", "variations", "custom"])

const VARIANTS: Record<string, readonly string[]> = {
  angles: ["front", "side", "top", "back", "three-quarter"],
  materials: ["wood", "metal", "glass", "plastic", "fabric", "stone"],
  variations: ["clean", "weathered", "damaged", "ornate", "minimal"],
}

const generateObjectAssetBody = z.object({
  assetType: assetTypeEnum,
  variant: z.string().min(1).max(100),
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  category: z.string().max(50).optional(),
  style: z.enum(["realistic", "anime", "3d-pixar", "illustration"]).optional(),
  sourceImageUrl: z.string().url().optional(),
  userId: z.string().uuid().optional(),
})

function buildVariantPrompt(
  assetType: string,
  variant: string,
  name: string,
  description?: string,
  category?: string,
  style?: string,
): string {
  const categoryDesc = category ?? "object"
  const descPart = description ? `, ${description}` : ""
  const styleDesc = style ?? "realistic"

  const base = `Single ${categoryDesc} ${name}${descPart}. ${styleDesc} art style, 4k, highly detailed, white/plain background, no text, no labels, no watermarks, product photography style.`

  if (assetType === "custom") {
    return `${variant}. ${base}`
  }

  if (assetType === "angles") {
    const angleMap: Record<string, string> = {
      front: "front view, facing camera directly",
      side: "side profile view",
      top: "top-down view, bird's eye perspective",
      back: "back view, rear perspective",
      "three-quarter": "three-quarter angle view, dynamic perspective",
    }
    const angle = angleMap[variant] ?? `${variant} view`
    return `${name}, ${angle}. ${base}`
  }

  if (assetType === "materials") {
    const materialMap: Record<string, string> = {
      wood: "made of polished wood, wood grain texture visible",
      metal: "made of brushed metal, metallic surface with subtle reflections",
      glass: "made of transparent glass, see-through with subtle reflections",
      plastic: "made of smooth plastic, matte finish",
      fabric: "covered in soft fabric texture, textile material",
      stone: "carved from stone, rough granite or marble texture",
    }
    const material = materialMap[variant] ?? `made of ${variant}`
    return `${name}, ${material}. ${base}`
  }

  // variations
  const variationMap: Record<string, string> = {
    clean: "brand new pristine condition, perfect and clean",
    weathered: "slightly weathered and aged, with wear marks",
    damaged: "battle-damaged with scratches and dents",
    ornate: "ornately decorated with intricate details and patterns",
    minimal: "minimalist design, clean simple lines",
  }
  const variation = variationMap[variant] ?? `${variant} style`
  return `${name}, ${variation}. ${base}`
}

export async function generateObjectAssetRoutes(app: FastifyInstance) {
  app.post("/v1/generate-object-asset", async (req, reply) => {
    const parsed = generateObjectAssetBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: "validation_error",
          message: parsed.error.issues[0]?.message ?? "Invalid request",
        },
      })
    }

    const { assetType, variant, name, description, category, style, sourceImageUrl, userId } = parsed.data

    if (assetType !== "custom") {
      const validVariants = VARIANTS[assetType]
      if (validVariants && !validVariants.includes(variant)) {
        return reply.status(400).send({
          error: {
            code: "validation_error",
            message: `Invalid variant "${variant}" for asset type "${assetType}". Valid: ${validVariants.join(", ")}`,
          },
        })
      }
    }

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
        console.error("[generate-object-asset] Credit check failed:", err)
        return reply.status(500).send({
          error: { code: "credit_check_failed", message: "Failed to check credits" },
        })
      }
    }

    const prompt = buildVariantPrompt(assetType, variant, name, description, category, style)

    const { data: job, error } = await supabase
      .from("jobs")
      .insert({
        workflow_id: null,
        user_id: userId ?? null,
        status: "pending",
        input_data: {
          prompt,
          sourceImageUrl,
          type: "generate-object-asset",
          assetType,
          variant,
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
        console.error("[generate-object-asset] Credit reservation failed:", err)
        // Delete the job if reservation fails
        await supabase.from("jobs").delete().eq("id", job.id)
        return reply.status(500).send({
          error: { code: "credit_reservation_failed", message: "Failed to reserve credits" },
        })
      }
    }

    await videoQueue.add("generate-object-asset", {
      jobId: job.id,
      prompt,
      sourceImageUrl,
      assetType,
      variant,
      provider: "nano-banana",
      usageLogId,
    })

    return { jobId: job.id }
  })
}
