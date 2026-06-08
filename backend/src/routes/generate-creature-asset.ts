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
import { CREATURE_ATTACH_COLUMNS } from "@nodaro/shared"
import { llmComplete } from "../lib/llm-client.js"
import {
  CREATURE_ASSET_DESCRIPTION_SYSTEM_PROMPT,
  CREATURE_ASSET_DESCRIPTION_LLM_OPTIONS,
  buildCreatureAssetDescriptionUserMessage,
} from "../lib/creature-asset-description.js"

// Creature asset types (mirrors object's angles/materials/variations/custom
// with `materials`→`poses` per the Creature delta map). `custom` carries a
// free-text variant + userPrompt.
const assetTypeEnum = z.enum(["angles", "poses", "variations", "custom"])

const VARIANTS: Record<string, readonly string[]> = {
  angles: ["front", "side", "top", "back", "three-quarter"],
  poses: ["idle", "walking", "running", "attacking", "resting", "alert"],
  variations: ["healthy", "scarred", "juvenile", "elder", "armored"],
}

const generateCreatureAssetBody = z.object({
  assetType: assetTypeEnum,
  variant: z.string().min(1).max(100),
  name: z.string().min(1).max(200),
  // Creature Studio Identity Foundation: per-asset description, capped at 1000
  // chars (mirrors generate-object-asset.ts). When the studio path runs
  // (attachToCreatureId set) and this field is absent, the route asks Claude
  // Sonnet for a one-sentence draft scoped to the creature's
  // canonical_description + asset type/variant.
  description: z.string().max(1000).optional(),
  userPrompt: z.string().max(8000).optional(),
  category: z.string().max(50).optional(),
  // Free-text style (a creature can be any visual style — NOT the object's
  // fixed enum). Matches the hero generate-creature route's `style` shape.
  style: z.string().max(50).optional(),
  sourceImageUrl: safeUrlSchema.optional(),
  provider: z.string().optional().default("nano-banana"),
  userId: z.string().uuid().optional(),
  // Creature Studio auto-attach: when all three are set, the worker appends
  // `{name: attachName, url: <result>}` to the named JSONB array column on
  // the user's creature row after generation. `attachToColumn` is the *DB
  // column* (e.g. "poses"), separate from the prompt-builder `assetType` —
  // important for custom prompts where assetType="custom" but the asset still
  // belongs in angles / poses / variations.
  attachToCreatureId: z.string().uuid().optional(),
  attachToColumn: z.enum(CREATURE_ATTACH_COLUMNS).optional(),
  attachName: z.string().min(1).max(200).optional(),
  // Phase E picker-hint pass-through: prompt-fragment for the worker.
  seedPromptHint: z.string().max(2000).optional(),
})

function buildVariantPrompt(
  assetType: string,
  variant: string,
  name: string,
  description?: string,
  category?: string,
  style?: string,
): string {
  const categoryDesc = category ?? "creature"
  const descPart = description ? `, ${description}` : ""
  const styleDesc = style ?? "realistic"

  const base = `Single ${categoryDesc} ${name}${descPart}. ${styleDesc} art style, 4k, highly detailed, white/plain background, no text, no labels, no watermarks, full-body creature reference.`

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

  if (assetType === "poses") {
    const poseMap: Record<string, string> = {
      idle: "idle standing pose, neutral stance",
      walking: "mid-walk pose, natural gait",
      running: "running pose, dynamic motion, legs extended",
      attacking: "aggressive attacking pose, lunging forward",
      resting: "resting pose, lying down relaxed",
      alert: "alert pose, head raised, ears/eyes attentive",
    }
    const pose = poseMap[variant] ?? `${variant} pose`
    return `${name}, ${pose}. ${base}`
  }

  // variations
  const variationMap: Record<string, string> = {
    healthy: "healthy and vigorous, glossy coat, prime condition",
    scarred: "battle-scarred with visible old wounds and worn hide",
    juvenile: "juvenile form, smaller and softer features",
    elder: "elder form, greying coat and weathered features",
    armored: "wearing natural or fused armor plating",
  }
  const variation = variationMap[variant] ?? `${variant} variation`
  return `${name}, ${variation}. ${base}`
}

export async function generateCreatureAssetRoutes(app: FastifyInstance) {
  app.post("/v1/generate-creature-asset", { preHandler: creditGuard((req) => extractProvider(req.body, "nano-banana")) }, async (req, reply) => {
    const parsed = generateCreatureAssetBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: "validation_error", ...formatZodError(parsed.error) },
      })
    }

    const { assetType, variant, name, category, style } = parsed.data
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

    // ─────────────────────────────────────────────────────────────────────
    // Main-image-required gate (studio path only).
    //
    // When attachToCreatureId is set we MUST have an anchor source image on
    // the creature row — every subsequent asset is generated as an
    // image-to-image off that anchor, so a missing main image would silently
    // drop identity. Rejecting here costs nothing: no LLM tokens, no credits
    // reserved, no DB writes.
    //
    // Mirrors generate-object-asset.ts with object → creature substitution.
    //
    // Uniform `"not_found"` error code for missing/cross-user/soft-deleted
    // rows (mirrors object — DELIBERATELY stricter than location's per-path
    // codes to prevent callees from enumerating creature IDs by error-code
    // differences). The main-image-empty case stays as a distinct 400
    // `"main_image_required"` because it's a user-fixable application-state
    // problem, not an ownership leak.
    // ─────────────────────────────────────────────────────────────────────
    let canonicalDescription: string | null = null
    let sourceImageUrlAnchor: string | null = null
    if (parsed.data.attachToCreatureId) {
      const { data: creature, error: creatureErr } = await supabase
        .from("creatures")
        .select("source_image_url, canonical_description")
        .eq("id", parsed.data.attachToCreatureId)
        .eq("user_id", userId)
        .is("deleted_at", null)
        .maybeSingle()

      if (creatureErr || !creature) {
        return reply.status(404).send({
          error: { code: "not_found", message: "Creature not found" },
        })
      }
      if (!creature.source_image_url) {
        return reply.status(400).send({
          error: { code: "main_image_required", message: "Generate a main image first" },
        })
      }
      canonicalDescription = (creature.canonical_description as string | null) ?? null
      sourceImageUrlAnchor = creature.source_image_url as string

      // ───────────────────────────────────────────────────────────────────
      // Studio-gated LLM draft of `description` (when caller omitted it AND a
      // canonical description exists). Non-fatal on failure: log + proceed
      // with description undefined. DO NOT 502 — a transient LLM hiccup must
      // not block the user from generating an asset they already configured.
      //
      // External-API callers supplying their own description skip the LLM
      // draft entirely (the !parsed.data.description guard). Callers with no
      // attachToCreatureId (non-studio path) also skip (guard above).
      // ───────────────────────────────────────────────────────────────────
      if (!parsed.data.description && canonicalDescription) {
        try {
          const llm = await llmComplete({
            modelId: "claude-sonnet-4.6",
            system: CREATURE_ASSET_DESCRIPTION_SYSTEM_PROMPT,
            messages: [
              {
                role: "user",
                content: buildCreatureAssetDescriptionUserMessage({
                  assetType,
                  variant,
                  userPrompt: parsed.data.userPrompt,
                  canonicalDescription,
                }),
              },
            ],
            ...CREATURE_ASSET_DESCRIPTION_LLM_OPTIONS,
          })
          const text = llm.text.trim()
          if (text.length > 0) parsed.data.description = text
        } catch (err) {
          req.log.warn(
            { err, creatureId: parsed.data.attachToCreatureId, assetType, variant },
            "[generate-creature-asset] LLM description draft failed",
          )
          // Leave parsed.data.description undefined and continue.
        }
      }
    }

    const modelIdentifier = parsed.data.provider

    // Use the creature's anchor source image as the i2i source when the
    // studio path runs, UNLESS the caller passed an explicit sourceImageUrl
    // (their choice wins). Outside the studio path, behavior is unchanged.
    const resolvedSourceImageUrl = parsed.data.sourceImageUrl ?? sourceImageUrlAnchor ?? undefined

    const prompt = buildVariantPrompt(assetType, variant, name, parsed.data.description, category, style)

    const mcpClient = extractMcpClient(req.body)
    const { data: job, error } = await supabase
      .from("jobs")
      .insert({
        workflow_id: extractWorkflowId(req.body),
        force_private: extractForcePrivate(req.body) || undefined,
        user_id: userId,
        status: "pending",
        input_data: { ...buildJobInputData(parsed.data, "generate-creature-asset"), prompt },
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

    await videoQueue.add("generate-creature-asset", {
      jobId: job.id,
      prompt,
      sourceImageUrl: resolvedSourceImageUrl,
      assetType,
      variant,
      provider: parsed.data.provider,
      usageLogId,
      attachToCreatureId: parsed.data.attachToCreatureId,
      attachToColumn: parsed.data.attachToColumn,
      attachName: parsed.data.attachName,
      description: parsed.data.description,
      seedPromptHint: parsed.data.seedPromptHint,
    })

    return { jobId: job.id }
  })
}
