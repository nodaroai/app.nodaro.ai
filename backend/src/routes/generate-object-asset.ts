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
import { OBJECT_ATTACH_COLUMNS } from "@nodaro/shared"
import { llmComplete } from "../lib/llm-client.js"
import {
  OBJECT_ASSET_DESCRIPTION_SYSTEM_PROMPT,
  OBJECT_ASSET_DESCRIPTION_LLM_OPTIONS,
  buildObjectAssetDescriptionUserMessage,
} from "../lib/object-asset-description.js"

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
  // Object Studio Identity Foundation: per-asset description, capped at 1000
  // chars (mirrors generate-character-asset.ts:52). When the studio path
  // runs (attachToObjectId set) and this field is absent, the route asks
  // Claude Sonnet for a one-sentence draft scoped to the object's
  // canonical_description + asset type/variant (spec Pass 7 F-81).
  description: z.string().max(1000).optional(),
  userPrompt: z.string().max(8000).optional(),
  category: z.string().max(50).optional(),
  style: z.enum(["realistic", "anime", "3d-pixar", "illustration"]).optional(),
  sourceImageUrl: safeUrlSchema.optional(),
  provider: z.string().optional().default("nano-banana"),
  userId: z.string().uuid().optional(),
  // Object Studio auto-attach: when all three are set, the worker appends
  // `{name: attachName, url: <result>}` to the named JSONB array column on
  // the user's object row after generation. `attachToColumn` is the *DB
  // column* (e.g. "material_variants"), separate from the prompt-builder
  // `assetType` — important for custom prompts where assetType="custom"
  // but the asset still belongs in angles / material_variants / variations.
  attachToObjectId: z.string().uuid().optional(),
  attachToColumn: z.enum(OBJECT_ATTACH_COLUMNS).optional(),
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
  app.post("/v1/generate-object-asset", { preHandler: creditGuard((req) => extractProvider(req.body, "nano-banana")) }, async (req, reply) => {
    const parsed = generateObjectAssetBody.safeParse(req.body)
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
    // When attachToObjectId is set we MUST have an anchor source image on
    // the object row — every subsequent asset is generated as an
    // image-to-image off that anchor, so a missing main image would
    // silently drop identity. Rejecting here costs nothing: no LLM tokens,
    // no credits reserved, no DB writes.
    //
    // Mirrors generate-character-asset.ts:244-302 with character → object
    // substitution (spec Pass 7 F-81 + Phase C1a F-1).
    //
    // Per spec Pass 10 F-90b: object uses a uniform `"not_found"` error
    // code for missing/cross-user/soft-deleted rows. The main-image-empty
    // case stays as a distinct 400 `"main_image_required"` because it's
    // a user-fixable application-state problem, not an ownership leak.
    // ─────────────────────────────────────────────────────────────────────
    let canonicalDescription: string | null = null
    let sourceImageUrlAnchor: string | null = null
    if (parsed.data.attachToObjectId) {
      const { data: obj, error: objErr } = await supabase
        .from("objects")
        .select("source_image_url, canonical_description")
        .eq("id", parsed.data.attachToObjectId)
        .eq("user_id", userId)
        .is("deleted_at", null)
        .maybeSingle()

      if (objErr || !obj) {
        return reply.status(404).send({
          error: { code: "not_found", message: "Object not found" },
        })
      }
      if (!obj.source_image_url) {
        return reply.status(400).send({
          error: { code: "main_image_required", message: "Generate a main image first" },
        })
      }
      canonicalDescription = (obj.canonical_description as string | null) ?? null
      sourceImageUrlAnchor = obj.source_image_url as string

      // ───────────────────────────────────────────────────────────────────
      // Studio-gated LLM draft of `description` (when caller omitted it
      // AND a canonical description exists). Non-fatal on failure: log +
      // proceed with description undefined. DO NOT 502 — a transient LLM
      // hiccup must not block the user from generating an asset they
      // already configured.
      //
      // External-API callers supplying their own description skip the LLM
      // draft entirely (the !parsed.data.description guard). Callers with
      // no attachToObjectId (non-studio path) also skip (guard above).
      // ───────────────────────────────────────────────────────────────────
      if (!parsed.data.description && canonicalDescription) {
        try {
          const llm = await llmComplete({
            modelId: "claude-sonnet-4.6",
            system: OBJECT_ASSET_DESCRIPTION_SYSTEM_PROMPT,
            messages: [
              {
                role: "user",
                content: buildObjectAssetDescriptionUserMessage({
                  assetType,
                  variant,
                  userPrompt: parsed.data.userPrompt,
                  canonicalDescription,
                }),
              },
            ],
            ...OBJECT_ASSET_DESCRIPTION_LLM_OPTIONS,
          })
          const text = llm.text.trim()
          if (text.length > 0) parsed.data.description = text
        } catch (err) {
          req.log.warn(
            { err, objectId: parsed.data.attachToObjectId, assetType, variant },
            "[generate-object-asset] LLM description draft failed",
          )
          // Leave parsed.data.description undefined and continue.
        }
      }
    }

    const modelIdentifier = parsed.data.provider

    // Use the object's anchor source image as the i2i source when the
    // studio path runs, UNLESS the caller passed an explicit
    // sourceImageUrl (their choice wins). Outside the studio path,
    // behavior is unchanged.
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
        input_data: { ...buildJobInputData(parsed.data, "generate-object-asset"), prompt },
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

    await videoQueue.add("generate-object-asset", {
      jobId: job.id,
      prompt,
      sourceImageUrl: resolvedSourceImageUrl,
      assetType,
      variant,
      provider: parsed.data.provider,
      usageLogId,
      attachToObjectId: parsed.data.attachToObjectId,
      attachToColumn: parsed.data.attachToColumn,
      attachName: parsed.data.attachName,
      description: parsed.data.description,
      seedPromptHint: parsed.data.seedPromptHint,
    })

    return { jobId: job.id }
  })
}
