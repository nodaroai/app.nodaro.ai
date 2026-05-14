import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { safeUrlSchema } from "../lib/url-validator.js"
import { supabase } from "../lib/supabase.js"
import { videoQueue } from "../lib/queue.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
import { extractWorkflowId, extractForcePrivate, extractProvider } from "../lib/request-helpers.js"
import { extractMcpClient } from "../lib/extract-mcp-client.js"
import { buildJobInputData } from "../lib/job-input-data.js"
import { llmComplete } from "../lib/llm-client.js"
import { IMAGE_I2I_PROVIDERS } from "@nodaro/shared"
import { buildCreditModelIdentifier } from "@nodaro/shared"
import { formatZodError } from "../lib/zod-error.js"
import {
  ASSET_DESCRIPTION_SYSTEM_PROMPT,
  ASSET_DESCRIPTION_LLM_OPTIONS,
  buildAssetDescriptionUserMessage,
} from "../lib/asset-description-prompt.js"

const imageToImageBody = z.object({
  imageUrl: safeUrlSchema,
  prompt: z.string().min(1).max(2000),
  userPrompt: z.string().max(8000).optional(),
  provider: z.enum(IMAGE_I2I_PROVIDERS).optional(),
  referenceImageUrls: z.array(safeUrlSchema).max(13).optional(),
  resolution: z.enum(["1K", "2K", "4K"]).optional(),
  quality: z.enum(["medium", "high", "basic"]).optional(),
  strength: z.number().min(0).max(1).optional(),
  // "auto" is gpt-image-2 specific (KIE constrains it to 1K) — kept here
  // for symmetry with generate-image; per-provider gating lives in the
  // frontend config panels' fail-safe.
  aspectRatio: z.enum([
    "auto",
    "1:1", "16:9", "9:16", "4:3", "3:4",
    "3:2", "2:3", "5:4", "4:5", "21:9",
  ]).optional(),
  negativePrompt: z.string().max(5000).optional(),
  seed: z.number().int().min(0).optional(),
  renderingSpeed: z.enum(["TURBO", "BALANCED", "QUALITY"]).optional(),
  guidanceScale: z.number().min(0).max(30).optional(),
  maskUrl: safeUrlSchema.optional(),
  // Character Studio Identity Foundation (v2): per-asset description, capped
  // at 1000 chars. When the studio path runs (attachToCharacterId set) and
  // this field is absent, the route asks Claude Sonnet for a one-sentence
  // draft scoped to the character's canonical description + user prompt.
  description: z.string().max(1000).optional(),
  // Optional real-life reference photos the worker can ship to providers
  // that support multi-image conditioning. Capped at 5 to keep prompt size
  // bounded; URLs validated via safeUrlSchema (SSRF gate). Studio path only —
  // non-studio callers may pass these but the route will not forward them.
  realLifeRefs: z.array(safeUrlSchema).max(5).optional(),
  // Character Studio auto-attach (optional; ignored for non-studio callers).
  // When all three are present, the worker appends `{name: attachName, url}` to
  // the user's character row column after the refine completes.
  attachToCharacterId: z.string().uuid().optional(),
  attachToColumn: z.enum(["expressions", "poses", "angles", "lighting_variations"]).optional(),
  attachName: z.string().min(1).max(200).optional(),
})

export async function imageToImageRoutes(app: FastifyInstance) {
  app.post("/v1/image-to-image", { preHandler: creditGuard((req) => {
    const body = req.body as Record<string, unknown>
    const provider = extractProvider(req.body, "nano-banana")
    const quality = body?.quality as string | undefined
    const resolution = body?.resolution as string | undefined
    const renderingSpeed = body?.renderingSpeed as string | undefined
    return buildCreditModelIdentifier(provider, quality, resolution, renderingSpeed)
  }) }, async (req, reply) => {
    const parsed = imageToImageBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: "validation_error", ...formatZodError(parsed.error) },
      })
    }

    const { imageUrl, prompt, provider, referenceImageUrls, resolution, quality, strength, aspectRatio, negativePrompt, seed, renderingSpeed, guidanceScale, maskUrl } = parsed.data
    const userId = req.userId

    if (!userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "Authentication required" },
      })
    }

    const modelIdentifier = buildCreditModelIdentifier(provider ?? "nano-banana", quality, resolution, renderingSpeed)

    // ─────────────────────────────────────────────────────────────────────
    // Studio path — when attachToCharacterId is set, the caller is the
    // Character Studio refining/regenerating an asset against a character
    // row. Non-studio callers (workflows, MCP, i2i-as-a-tool) hit none of
    // this and keep their existing behavior end-to-end.
    //
    // Two gates + one inline LLM draft + one privacy override fire here:
    //   1. Portrait-required gate: character must exist (404 cross-user
    //      OR soft-deleted) and have a non-null source_image_url (400
    //      portrait_required).
    //   2. Studio-gated LLM draft of `description` when the caller omitted
    //      it — non-fatal on failure (continue with description undefined).
    //   3. force_private: true on the job row, unconditional.
    //   4. description + realLifeRefs forwarded to the worker payload.
    // ─────────────────────────────────────────────────────────────────────
    const isStudioPath = parsed.data.attachToCharacterId !== undefined
    if (isStudioPath) {
      const { data: char, error: charErr } = await supabase
        .from("characters")
        .select("source_image_url, canonical_description")
        .eq("id", parsed.data.attachToCharacterId!)
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
      const canonicalDescription = (char.canonical_description as string | null) ?? null

      // Inline LLM draft when description is absent. Non-fatal: a transient
      // LLM hiccup must not block the user from running a refine they
      // already configured. There is no natural `variant` for an i2i refine
      // — pass the user's `prompt` field as the `userPrompt` slot. Using
      // assetType: "image-to-image" makes the shared helper's custom-asset
      // branch fold `userPrompt` into the variant-or-prompt slot, so the
      // LLM gets meaningful input even though no variant was selected.
      if (!parsed.data.description) {
        try {
          const llm = await llmComplete({
            modelId: "claude-sonnet-4.6",
            system: ASSET_DESCRIPTION_SYSTEM_PROMPT,
            messages: [
              {
                role: "user",
                content: buildAssetDescriptionUserMessage({
                  assetType: "image-to-image",
                  variant: undefined,
                  userPrompt: prompt,
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
            { err, characterId: parsed.data.attachToCharacterId },
            "[image-to-image] LLM description draft failed",
          )
          // Leave parsed.data.description undefined and continue.
        }
      }
    }

    const mcpClient = extractMcpClient(req.body)
    const forcePrivate = isStudioPath ? true : (extractForcePrivate(req.body) || undefined)
    const { data: job, error } = await supabase
      .from("jobs")
      .insert({
        workflow_id: extractWorkflowId(req.body),
        force_private: forcePrivate,
        user_id: userId,
        status: "pending",
        input_data: buildJobInputData(parsed.data, "image-to-image"),
        ...(mcpClient ? { mcp_client: mcpClient } : {}),
      })
      .select("id")
      .single()

    if (error) {
      return reply.status(500).send({
        error: { code: "internal_error", message: error.message },
      })
    }

    const reservation = await reserveCreditsForJob(req, reply, job.id, modelIdentifier)
    if (reply.sent) return
    const usageLogId = reservation?.usageLogId

    await videoQueue.add("image-to-image", {
      jobId: job.id,
      imageUrl,
      referenceImageUrls,
      prompt,
      provider,
      resolution,
      quality,
      strength,
      aspectRatio,
      negativePrompt,
      seed,
      renderingSpeed,
      guidanceScale,
      maskUrl,
      attachToCharacterId: parsed.data.attachToCharacterId,
      attachToColumn: parsed.data.attachToColumn,
      attachName: parsed.data.attachName,
      // Studio-only fields — only forwarded when the studio path ran. Outside
      // the studio path these stay out of the worker payload so the worker's
      // existing image-to-image handler sees no shape change.
      ...(isStudioPath
        ? {
            description: parsed.data.description,
            realLifeRefs: parsed.data.realLifeRefs,
          }
        : {}),
      usageLogId,
    })

    return { jobId: job.id }
  })
}
