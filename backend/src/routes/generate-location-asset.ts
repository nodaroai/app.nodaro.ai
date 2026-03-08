import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { safeUrlSchema } from "../lib/url-validator.js"
import { supabase } from "../lib/supabase.js"
import { videoQueue } from "../lib/queue.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
import { extractWorkflowId } from "../lib/request-helpers.js"

const assetTypeEnum = z.enum(["timeOfDay", "weather", "angles", "custom"])

const VARIANTS: Record<string, readonly string[]> = {
  timeOfDay: ["dawn", "morning", "noon", "afternoon", "dusk", "night"],
  weather: ["clear", "cloudy", "rain", "storm", "snow", "fog"],
  angles: ["wide", "medium", "closeup", "aerial", "low-angle"],
}

const generateLocationAssetBody = z.object({
  assetType: assetTypeEnum,
  variant: z.string().min(1).max(100),
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  category: z.string().max(50).optional(),
  style: z.enum(["realistic", "anime", "3d-pixar", "illustration"]).optional(),
  sourceImageUrl: safeUrlSchema.optional(),
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
  const categoryDesc = category ?? "location"
  const descPart = description ? `, ${description}` : ""
  const styleDesc = style ?? "realistic"

  const base = `${categoryDesc} scene, ${name}${descPart}. ${styleDesc} art style, 4k, highly detailed, cinematic lighting, no people, no text, no labels, no watermarks.`

  if (assetType === "custom") {
    return `${variant}. ${base}`
  }

  if (assetType === "timeOfDay") {
    const timeMap: Record<string, string> = {
      dawn: "at dawn, soft pink and orange sunrise, early morning light",
      morning: "in the morning, bright natural daylight, fresh atmosphere",
      noon: "at noon, harsh overhead sun, strong shadows",
      afternoon: "in the afternoon, warm golden hour light",
      dusk: "at dusk, purple and orange sunset, twilight",
      night: "at night, moonlight, stars visible, nighttime atmosphere",
    }
    const time = timeMap[variant] ?? `at ${variant}`
    return `${name}, ${time}. ${base}`
  }

  if (assetType === "weather") {
    const weatherMap: Record<string, string> = {
      clear: "on a clear day, blue sky, perfect weather",
      cloudy: "on a cloudy day, overcast sky, soft diffused light",
      rain: "during rain, wet surfaces, water droplets, moody atmosphere",
      storm: "during a storm, dramatic clouds, lightning, intense weather",
      snow: "covered in snow, winter scene, cold atmosphere, frost",
      fog: "in thick fog, mysterious atmosphere, limited visibility",
    }
    const weather = weatherMap[variant] ?? `with ${variant} weather`
    return `${name}, ${weather}. ${base}`
  }

  // angles
  const angleMap: Record<string, string> = {
    wide: "wide establishing shot, showing full environment",
    medium: "medium shot, balanced perspective",
    closeup: "close-up detail shot, focusing on textures and elements",
    aerial: "aerial view, drone perspective, bird's eye view",
    "low-angle": "low angle shot, dramatic perspective looking up",
  }
  const angle = angleMap[variant] ?? `${variant} shot`
  return `${name}, ${angle}. ${base}`
}

export async function generateLocationAssetRoutes(app: FastifyInstance) {
  app.post("/v1/generate-location-asset", { preHandler: creditGuard(() => "nano-banana") }, async (req, reply) => {
    const parsed = generateLocationAssetBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: "validation_error",
          message: parsed.error.issues[0]?.message ?? "Invalid request",
        },
      })
    }

    const { assetType, variant, name, description, category, style, sourceImageUrl } = parsed.data
    const userId = req.userId

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

    if (!userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "userId is required" },
      })
    }

    // Model identifier for credit check (hardcoded to nano-banana)
    const modelIdentifier = "nano-banana"

    const prompt = buildVariantPrompt(assetType, variant, name, description, category, style)

    const { data: job, error } = await supabase
      .from("jobs")
      .insert({
        workflow_id: extractWorkflowId(req.body),
        user_id: userId,
        status: "pending",
        input_data: {
          prompt,
          sourceImageUrl,
          type: "generate-location-asset",
          assetType,
          variant,
          locationData: { name, description, category, style },
        },
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

    await videoQueue.add("generate-location-asset", {
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
