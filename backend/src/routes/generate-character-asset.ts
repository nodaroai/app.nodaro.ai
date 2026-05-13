import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { safeUrlSchema } from "../lib/url-validator.js"
import { supabase } from "../lib/supabase.js"
import { videoQueue } from "../lib/queue.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
import { extractWorkflowId, extractForcePrivate, extractProvider } from "../lib/request-helpers.js"
import { extractMcpClient } from "../lib/extract-mcp-client.js"
import { buildJobInputData } from "../lib/job-input-data.js"
import { PLACEHOLDER_CHARACTER_NAME } from "@nodaro/shared"
import { formatZodError } from "../lib/zod-error.js"

const assetTypeEnum = z.enum(["expressions", "poses", "lighting", "angles", "custom"])

const VARIANTS: Record<string, readonly string[]> = {
  expressions: ["neutral", "smile", "angry", "surprised", "sad", "talking", "laughing", "disgusted", "fearful", "smirk", "crying"],
  poses: ["standing", "walking", "sitting", "running", "crouching", "pointing", "fighting stance", "jumping", "turning"],
  lighting: ["daylight", "night", "dramatic"],
  angles: ["front", "3/4 left", "left profile", "right profile", "3/4 right", "back"],
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
  // Character Studio auto-attach: when all three are set, the worker appends
  // `{name: attachName, url: <result>}` to the named JSONB array column on the
  // user's character row after generation. `attachToColumn` is the *DB column*
  // (e.g. "lighting_variations"), separate from the prompt-builder `assetType`
  // — important for custom prompts where assetType="custom" but the asset
  // still belongs in expressions / poses / angles / lighting_variations.
  attachToCharacterId: z.string().uuid().optional(),
  attachToColumn: z.enum(["expressions", "poses", "angles", "lighting_variations"]).optional(),
  attachName: z.string().min(1).max(200).optional(),
})

function buildVariantPrompt(
  assetType: string,
  variant: string,
  name: string,
  description: string | undefined,
  gender: string | undefined,
  style: string | undefined,
  baseOutfit: string | undefined,
  userPrompt?: string,
): string {
  const genderDesc = gender ?? "character"
  const outfitPart = baseOutfit ? `, wearing ${baseOutfit}` : ""
  const descPart = description ? `, ${description}` : ""
  const styleDesc = style ?? "realistic"
  // Drop the auto-assigned placeholder name from the prompt so we don't ask
  // providers to render "Single male character Untitled character …". The
  // description carries the visual identity until the user renames.
  const trimmedName = name.trim()
  const namePart = trimmedName && trimmedName !== PLACEHOLDER_CHARACTER_NAME ? ` ${trimmedName}` : ""

  const base = `Single ${genderDesc} character${namePart}${descPart}${outfitPart}. ${styleDesc} art style, 4k, highly detailed, white/plain background, no text, no labels, no watermarks.`

  if (assetType === "custom") {
    return `${userPrompt ?? variant}. ${base}`
  }

  if (assetType === "expressions") {
    const expressionMap: Record<string, string> = {
      neutral: "neutral calm expression, looking at camera",
      smile: "gentle warm smile, looking at camera",
      angry: "angry scowl, furrowed brows, looking at camera",
      surprised: "wide eyes, mouth slightly open, surprised expression",
      sad: "sad downcast expression, slightly lowered gaze",
      talking: "mouth open mid-speech, expressive face",
      laughing: "laughing openly, head tilted back, joyful",
      disgusted: "disgusted expression, nose wrinkled, lip curled",
      fearful: "fearful expression, wide eyes, tense",
      smirk: "subtle smirk, one corner of mouth raised, confident",
      crying: "crying, tears, distressed expression",
    }
    const expr = expressionMap[variant] ?? `${variant} expression`
    const subject = namePart ? namePart.trim() : "the character"
    return `Portrait headshot of ${subject}, ${expr}. ${base}`
  }

  if (assetType === "poses") {
    const poseMap: Record<string, string> = {
      standing: "standing relaxed pose, arms at sides",
      walking: "walking mid-stride, natural gait",
      sitting: "sitting on a chair, relaxed posture",
      running: "running action pose, dynamic movement",
      crouching: "crouching low, knees bent, ready",
      pointing: "pointing forward with one arm extended",
      "fighting stance": "fighting stance, fists raised, weight balanced",
      jumping: "mid-jump, both feet off the ground, dynamic",
      turning: "turning to look over the shoulder, body in three-quarter view",
    }
    const pose = poseMap[variant] ?? `${variant} pose`
    const subject = namePart ? namePart.trim() : "the character"
    return `Full body view of ${subject}, ${pose}. FULL BODY visible including feet. ${base}`
  }

  if (assetType === "angles") {
    const angleMap: Record<string, string> = {
      front: "front view, facing camera directly",
      "3/4 left": "three-quarter view, body angled 45 degrees toward the left of the frame, face partially visible",
      "left profile": "left profile view, body and face turned to the left, full side silhouette of the face visible",
      "right profile": "right profile view, body and face turned to the right, full side silhouette of the face visible",
      "3/4 right": "three-quarter view, body angled 45 degrees toward the right of the frame, face partially visible",
      back: "back view, facing away from camera",
    }
    const angle = angleMap[variant] ?? `${variant} view`
    const subject = namePart ? namePart.trim() : "the character"
    return `Full body view of ${subject}, ${angle}, same neutral standing pose. FULL BODY visible including feet. ${base}`
  }

  // lighting
  const lightMap: Record<string, string> = {
    daylight: "bright daylight, natural outdoor lighting, warm sunlight",
    night: "blue night lighting, moonlit atmosphere, cool tones",
    dramatic: "dramatic side lighting, cinematic single light source, high contrast",
  }
  const light = lightMap[variant] ?? `${variant} lighting`
  const subject = namePart ? namePart.trim() : "the character"
  return `Full body view of ${subject}, same neutral standing pose. ${light}. FULL BODY visible. ${base}`
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

    const prompt = buildVariantPrompt(assetType, variant, name, description, gender, style, baseOutfit, parsed.data.userPrompt)

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
      attachToCharacterId: parsed.data.attachToCharacterId,
      attachToColumn: parsed.data.attachToColumn,
      attachName: parsed.data.attachName,
      usageLogId,
    })

    return { jobId: job.id }
  })
}
