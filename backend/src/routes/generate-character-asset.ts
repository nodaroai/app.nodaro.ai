import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { safeUrlSchema } from "../lib/url-validator.js"
import { supabase } from "../lib/supabase.js"
import { videoQueue } from "../lib/queue.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
import { extractWorkflowId, extractProvider } from "../lib/request-helpers.js"
import { extractMcpClient } from "../lib/extract-mcp-client.js"
import { buildJobInputData } from "../lib/job-input-data.js"
import { llmComplete } from "../lib/llm-client.js"
import {
  PLACEHOLDER_CHARACTER_NAME,
  CHARACTER_ASPECT_OPTIONS,
  CHARACTER_ASSET_TYPES,
  CHARACTER_ATTACH_COLUMNS,
  resolveCharacterAspectRatio,
  type CharacterAssetTypeForAspect,
} from "@nodaro/shared"
import { formatZodError } from "../lib/zod-error.js"
import {
  ASSET_DESCRIPTION_SYSTEM_PROMPT,
  ASSET_DESCRIPTION_LLM_OPTIONS,
  buildAssetDescriptionUserMessage,
} from "../lib/asset-description-prompt.js"

// `headAngles` is an alias for `angles` (the legacy single-surface column,
// now treated as head-angles in the UI). `bodyAngles` writes to the new
// `body_angles` column. Both produce different framing in buildVariantPrompt.
// Single source of truth lives in `@nodaro/shared/entity-prompts` —
// `CHARACTER_ASSET_TYPES` is reused by the MCP `generate_character` verb
// (`backend/src/lib/mcp/tools/verbs-clo.ts`) so the Zod enum here and the
// MCP tool's input enum can't drift.
const assetTypeEnum = z.enum(CHARACTER_ASSET_TYPES)

const VARIANTS: Record<string, readonly string[]> = {
  expressions: ["neutral", "smile", "angry", "surprised", "sad", "talking", "laughing", "disgusted", "fearful", "smirk", "crying"],
  poses: ["standing", "walking", "sitting", "running", "crouching", "pointing", "fighting stance", "jumping", "turning"],
  lighting: ["daylight", "night", "dramatic"],
  angles: ["front", "3/4 left", "left profile", "right profile", "3/4 right", "back"],
  headAngles: ["front", "3/4 left", "left profile", "right profile", "3/4 right"],
  bodyAngles: ["front", "3/4 left", "left profile", "right profile", "3/4 right", "back"],
}

const generateCharacterAssetBody = z.object({
  assetType: assetTypeEnum,
  variant: z.string().min(1).max(100),
  name: z.string().min(1).max(200),
  // Character Studio Identity Foundation (v2): per-asset description, capped
  // at 1000 chars. When the studio path runs (attachToCharacterId set) and
  // this field is absent, the route asks Claude Sonnet for a one-sentence
  // draft scoped to the character's canonical description + asset type/variant.
  description: z.string().max(1000).optional(),
  userPrompt: z.string().max(8000).optional(),
  gender: z.string().max(50).optional(),
  style: z.enum(["realistic", "anime", "3d-pixar", "illustration"]).optional(),
  baseOutfit: z.string().max(1000).optional(),
  sourceImageUrl: safeUrlSchema.optional(),
  // Optional real-life reference photos the worker can ship to providers
  // that support multi-image conditioning. Capped at 5 to keep prompt size
  // bounded; URLs validated via safeUrlSchema (SSRF gate).
  realLifeRefs: z.array(safeUrlSchema).max(5).optional(),
  provider: z.string().optional().default("nano-banana"),
  userId: z.string().uuid().optional(),
  // Character Studio auto-attach: when all three are set, the worker appends
  // `{name: attachName, url: <result>}` to the named JSONB array column on the
  // user's character row after generation. `attachToColumn` is the *DB column*
  // (e.g. "lighting_variations"), separate from the prompt-builder `assetType`
  // — important for custom prompts where assetType="custom" but the asset
  // still belongs in expressions / poses / angles / lighting_variations.
  attachToCharacterId: z.string().uuid().optional(),
  attachToColumn: z.enum(CHARACTER_ATTACH_COLUMNS).optional(),
  attachName: z.string().min(1).max(200).optional(),
  // Per-asset-type aspect-ratio defaults (smart-defaults feature). When the
  // caller omits `aspectRatio`, the route derives one from `assetType` —
  // expressions=1:1, poses=9:16, headAngles=3:4, bodyAngles=9:16, lighting=3:4,
  // angles=3:4 (legacy alias for headAngles), custom=portrait default 3:4.
  // `characterNodeAspectRatio` is the character node's per-canvas toggle —
  // wins against the default, loses to an explicit `aspectRatio`.
  // See `packages/shared/src/character-aspect-defaults.ts` for precedence.
  aspectRatio: z.enum(CHARACTER_ASPECT_OPTIONS).optional(),
  characterNodeAspectRatio: z.enum(CHARACTER_ASPECT_OPTIONS).optional(),
})

/**
 * Pick the asset-type bucket the resolver uses for defaults. `custom` doesn't
 * have its own framing — fall back to the portrait default (3:4) so a custom
 * asset still gets a sensible vertical crop instead of inheriting whatever the
 * caller left over from a previous request.
 */
function pickAspectAssetType(
  assetType: z.infer<typeof assetTypeEnum>,
): CharacterAssetTypeForAspect {
  if (assetType === "custom") return "portrait"
  return assetType
}

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

  if (assetType === "angles" || assetType === "headAngles") {
    // The legacy `angles` column now stores head-and-shoulders portraits.
    // `headAngles` is the explicit alias; both produce head-portrait framing.
    const angleMap: Record<string, string> = {
      front: "front view, facing camera directly",
      "3/4 left": "three-quarter view, head angled 45 degrees toward the left of the frame, face partially visible",
      "left profile": "left profile view, head turned to the left, full side silhouette of the face visible",
      "right profile": "right profile view, head turned to the right, full side silhouette of the face visible",
      "3/4 right": "three-quarter view, head angled 45 degrees toward the right of the frame, face partially visible",
      back: "back of head view, facing away from camera",
    }
    const angle = angleMap[variant] ?? `${variant} view`
    const subject = namePart ? namePart.trim() : "the character"
    return `Head-and-shoulders portrait of ${subject}, ${angle}, same neutral expression. ${base}`
  }

  if (assetType === "bodyAngles") {
    const angleMap: Record<string, string> = {
      front: "front view, facing camera directly",
      "3/4 left": "three-quarter view, body angled 45 degrees toward the left of the frame",
      "left profile": "left profile view, body turned to the left",
      "right profile": "right profile view, body turned to the right",
      "3/4 right": "three-quarter view, body angled 45 degrees toward the right of the frame",
      back: "back view, body facing away from camera",
    }
    const angle = angleMap[variant] ?? `${variant} view`
    const subject = namePart ? namePart.trim() : "the character"
    return `Full body view of ${subject}, ${angle}, standing naturally with arms relaxed at sides. FULL BODY visible including feet, plain background. ${base}`
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
    // ─────────────────────────────────────────────────────────────────────
    // 1. Authentication
    // ─────────────────────────────────────────────────────────────────────
    const userId = req.userId
    if (!userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "userId is required" },
      })
    }

    // ─────────────────────────────────────────────────────────────────────
    // 2. Zod validation
    // ─────────────────────────────────────────────────────────────────────
    const parsed = generateCharacterAssetBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: "validation_error", ...formatZodError(parsed.error) },
      })
    }

    const { assetType, variant, name, gender, style, baseOutfit } = parsed.data

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

    // ─────────────────────────────────────────────────────────────────────
    // 3. Portrait-required gate (studio path only).
    //    When attachToCharacterId is set we MUST have an anchor portrait
    //    on the character row — every subsequent asset is generated as an
    //    image-to-image off that anchor, so a missing portrait would silently
    //    drop identity. Rejecting here costs nothing: no LLM tokens, no
    //    credits reserved, no DB writes.
    // ─────────────────────────────────────────────────────────────────────
    let canonicalDescription: string | null = null
    let portraitImageUrl: string | null = null
    if (parsed.data.attachToCharacterId) {
      const { data: char, error: charErr } = await supabase
        .from("characters")
        .select("source_image_url, canonical_description")
        .eq("id", parsed.data.attachToCharacterId)
        .eq("user_id", userId)
        .is("deleted_at", null)
        .single()

      if (charErr || !char) {
        return reply.status(404).send({
          error: { code: "not_found", message: "Character not found" },
        })
      }
      if (!char.source_image_url) {
        return reply.status(400).send({
          error: { code: "portrait_required", message: "Generate a portrait first" },
        })
      }
      canonicalDescription = (char.canonical_description as string | null) ?? null
      portraitImageUrl = char.source_image_url as string

      // ───────────────────────────────────────────────────────────────────
      // 4. Studio-gated LLM draft of `description` (when caller omitted it).
      //    Non-fatal on failure: log + proceed with description undefined.
      //    DO NOT 502 — a transient LLM hiccup must not block the user from
      //    generating an asset they already configured.
      // ───────────────────────────────────────────────────────────────────
      if (!parsed.data.description) {
        try {
          const llm = await llmComplete({
            modelId: "claude-sonnet-4.6",
            system: ASSET_DESCRIPTION_SYSTEM_PROMPT,
            messages: [
              {
                role: "user",
                content: buildAssetDescriptionUserMessage({
                  assetType,
                  variant,
                  userPrompt: parsed.data.userPrompt,
                  canonicalDescription,
                }),
              },
            ],
            ...ASSET_DESCRIPTION_LLM_OPTIONS,
          })
          const text = llm.text.trim()
          if (text.length > 0) parsed.data.description = text
        } catch (err) {
          req.log.warn(
            { err, characterId: parsed.data.attachToCharacterId, assetType, variant },
            "[generate-character-asset] LLM description draft failed",
          )
          // Leave parsed.data.description undefined and continue.
        }
      }
    }

    const modelIdentifier = parsed.data.provider

    // Use the character's anchor portrait as the i2i source when the studio
    // path runs, UNLESS the caller passed an explicit sourceImageUrl (their
    // choice wins). Outside the studio path, behavior is unchanged.
    const resolvedSourceImageUrl = parsed.data.sourceImageUrl ?? portraitImageUrl ?? undefined

    const prompt = buildVariantPrompt(
      assetType,
      variant,
      name,
      parsed.data.description,
      gender,
      style,
      baseOutfit,
      parsed.data.userPrompt,
    )

    // ─────────────────────────────────────────────────────────────────────
    // 5. DB insert. `force_private: true` is unconditional — generated
    //    character assets must never leak to the public gallery, regardless
    //    of what the caller sends in `forcePrivate`.
    // ─────────────────────────────────────────────────────────────────────
    const mcpClient = extractMcpClient(req.body)
    const { data: job, error } = await supabase
      .from("jobs")
      .insert({
        workflow_id: extractWorkflowId(req.body),
        force_private: true,
        user_id: userId,
        status: "pending",
        input_data: { ...buildJobInputData(parsed.data, "generate-character-asset"), prompt },
        ...(mcpClient ? { mcp_client: mcpClient } : {}),
      })
      .select("id")
      .single()

    if (error || !job) {
      return reply.status(500).send({
        error: { code: "internal_error", message: error?.message ?? "Failed to create job" },
      })
    }

    // ─────────────────────────────────────────────────────────────────────
    // 6. Reserve credits
    // ─────────────────────────────────────────────────────────────────────
    const reservation = await reserveCreditsForJob(req, reply, job.id, modelIdentifier)
    if (reply.sent) return
    const usageLogId = reservation?.usageLogId

    // ─────────────────────────────────────────────────────────────────────
    // 7. Enqueue worker job. `description` + `realLifeRefs` are passed
    //    through so the worker's `attachAssetToCharacter` helper (Task 2)
    //    can persist them on the character row alongside the generated URL.
    // ─────────────────────────────────────────────────────────────────────
    // Resolve aspect ratio with per-asset-type defaults. Expressions are 1:1
    // (square), poses/bodyAngles/motions are 9:16 (full-body vertical),
    // headAngles/angles/lighting are 3:4 (vertical headshot). Caller's
    // explicit value wins; node toggle is the middle layer.
    const aspectRatio = resolveCharacterAspectRatio({
      explicit: parsed.data.aspectRatio,
      nodeOverride: parsed.data.characterNodeAspectRatio,
      assetType: pickAspectAssetType(assetType),
    })

    await videoQueue.add("generate-character-asset", {
      jobId: job.id,
      prompt,
      sourceImageUrl: resolvedSourceImageUrl,
      assetType,
      variant,
      provider: parsed.data.provider,
      attachToCharacterId: parsed.data.attachToCharacterId,
      attachToColumn: parsed.data.attachToColumn,
      attachName: parsed.data.attachName,
      description: parsed.data.description,
      realLifeRefs: parsed.data.realLifeRefs,
      aspectRatio,
      usageLogId,
    })

    return { jobId: job.id }
  })
}
