import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { safeUrlSchema } from "../lib/url-validator.js"
import { supabase } from "../lib/supabase.js"
import { videoQueue } from "../lib/queue.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
import { extractWorkflowId, extractForcePrivate, extractProvider } from "../lib/request-helpers.js"
import { extractMcpClient } from "../lib/extract-mcp-client.js"
import { buildJobInputData } from "../lib/job-input-data.js"
import { formatZodError } from "../lib/zod-error.js"

const assetTypeEnum = z.enum(["expressions", "poses", "lighting", "angles", "custom"])

const VARIANTS: Record<string, readonly string[]> = {
  expressions: ["neutral", "smile", "angry", "surprised", "sad", "talking"],
  poses: ["standing", "walking", "sitting", "running"],
  lighting: ["daylight", "night", "dramatic"],
  angles: ["front", "side", "back"],
}

const generateCharacterAssetBody = z.object({
  assetType: assetTypeEnum,
  variant: z.string().min(1).max(100),
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  userPrompt: z.string().max(8000).optional(),
  gender: z.string().max(50).optional(),
  style: z.enum(["realistic", "anime", "3d-pixar", "illustration"]).optional(),
  baseOutfit: z.string().max(1000).optional(),
  sourceImageUrl: safeUrlSchema.optional(),
  provider: z.string().optional().default("nano-banana"),
  userId: z.string().uuid().optional(),
})

function buildVariantPrompt(
  assetType: string,
  variant: string,
  name: string,
  description?: string,
  gender?: string,
  style?: string,
  baseOutfit?: string,
): string {
  const genderDesc = gender ?? "character"
  const outfitPart = baseOutfit ? `, wearing ${baseOutfit}` : ""
  const descPart = description ? `, ${description}` : ""
  const styleDesc = style ?? "realistic"

  const base = `Single ${genderDesc} character ${name}${descPart}${outfitPart}. ${styleDesc} art style, 4k, highly detailed, white/plain background, no text, no labels, no watermarks.`

  if (assetType === "custom") {
    return `${variant}. ${base}`
  }

  if (assetType === "expressions") {
    const expressionMap: Record<string, string> = {
      neutral: "neutral calm expression, looking at camera",
      smile: "gentle warm smile, looking at camera",
      angry: "angry scowl, furrowed brows, looking at camera",
      surprised: "wide eyes, mouth slightly open, surprised expression",
      sad: "sad downcast expression, slightly lowered gaze",
      talking: "mouth open mid-speech, expressive face",
    }
    const expr = expressionMap[variant] ?? `${variant} expression`
    return `Portrait headshot of ${name}, ${expr}. ${base}`
  }

  if (assetType === "poses") {
    const poseMap: Record<string, string> = {
      standing: "standing relaxed pose, arms at sides",
      walking: "walking mid-stride, natural gait",
      sitting: "sitting on a chair, relaxed posture",
      running: "running action pose, dynamic movement",
    }
    const pose = poseMap[variant] ?? `${variant} pose`
    return `Full body view of ${name}, ${pose}. FULL BODY visible including feet. ${base}`
  }

  if (assetType === "angles") {
    const angleMap: Record<string, string> = {
      front: "front view, facing camera directly",
      side: "side profile view, looking to the right",
      back: "back view, facing away from camera",
    }
    const angle = angleMap[variant] ?? `${variant} view`
    return `Full body view of ${name}, ${angle}, same neutral standing pose. FULL BODY visible including feet. ${base}`
  }

  // lighting
  const lightMap: Record<string, string> = {
    daylight: "bright daylight, natural outdoor lighting, warm sunlight",
    night: "blue night lighting, moonlit atmosphere, cool tones",
    dramatic: "dramatic side lighting, cinematic single light source, high contrast",
  }
  const light = lightMap[variant] ?? `${variant} lighting`
  return `Full body view of ${name}, same neutral standing pose. ${light}. FULL BODY visible. ${base}`
}

export async function generateCharacterAssetRoutes(app: FastifyInstance) {
  app.post("/v1/generate-character-asset", { preHandler: creditGuard((req) => extractProvider(req.body, "nano-banana")) }, async (req, reply) => {
    const parsed = generateCharacterAssetBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: "validation_error", ...formatZodError(parsed.error) },
      })
    }

    const { assetType, variant, name, description, gender, style, baseOutfit, sourceImageUrl } = parsed.data
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

    const modelIdentifier = parsed.data.provider

    const prompt = buildVariantPrompt(assetType, variant, name, description, gender, style, baseOutfit)

    const mcpClient = extractMcpClient(req.body)
    const { data: job, error } = await supabase
      .from("jobs")
      .insert({
        workflow_id: extractWorkflowId(req.body),
        force_private: extractForcePrivate(req.body) || undefined,
        user_id: userId,
        status: "pending",
        input_data: { ...buildJobInputData(parsed.data, "generate-character-asset"), prompt },
        ...(mcpClient ? { mcp_client: mcpClient } : {}),
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

    await videoQueue.add("generate-character-asset", {
      jobId: job.id,
      prompt,
      sourceImageUrl,
      assetType,
      variant,
      provider: parsed.data.provider,
      usageLogId,
    })

    return { jobId: job.id }
  })
}
