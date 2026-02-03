import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { supabase } from "../lib/supabase.js"
import { videoQueue } from "../lib/queue.js"

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

    const { assetType, variant, name, description, category, style, sourceImageUrl } = parsed.data

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

    const prompt = buildVariantPrompt(assetType, variant, name, description, category, style)

    const { data: job, error } = await supabase
      .from("jobs")
      .insert({
        workflow_id: null,
        user_id: "fb48d4d5-cd33-4599-816a-3262e4908522", // TODO: get from auth
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

    await videoQueue.add("generate-object-asset", {
      jobId: job.id,
      prompt,
      sourceImageUrl,
      assetType,
      variant,
      provider: "nano-banana",
    })

    return { jobId: job.id }
  })
}
