import type { FastifyInstance, FastifyRequest } from "fastify"
import { imagePromptTooShort } from "../lib/image-prompt-minimum.js"
import { sendInternalError } from "../lib/http-errors.js"
import { insertJob } from "../lib/insert-job.js"
import { z } from "zod"
import { safeUrlSchema } from "../lib/url-validator.js"
import { supabase } from "../lib/supabase.js"
import { videoQueue } from "../lib/queue.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
import { extractWorkflowId, extractNodeId, extractForcePrivate } from "../lib/request-helpers.js"
import { isMasked, resolveImageToImageCreditIdentifier, resolveImageToImageRunModel } from "./image-to-image-credit-id.js"
import { extractMcpClient } from "../lib/extract-mcp-client.js"
import { buildJobInputData } from "../lib/job-input-data.js"
import { withResolvedModel } from "../lib/job-resolved-model.js"
import { applySnappedLevers, withAdjustments } from "../lib/image-gen-normalize.js"
import { imageFormatFields, maskFormatConflict } from "../lib/image-format-schema.js"
import { imageToImageAspectRatio } from "../lib/image-auto-aspect.js"
import { probeImageDisplaySize, sourceImageForAutoAspect } from "../lib/image-source-size.js"
import { applyPromptPolicies } from "../lib/prompt-policy.js"
import { llmComplete } from "../lib/llm-client.js"
import { MODIFY_IMAGE_PROVIDERS, IMAGE_ASPECT_RATIO_VALUES, IMAGE_RESOLUTION_VALUES, IMAGE_QUALITY_VALUES, IMAGE_BACKGROUND_VALUES, IMAGE_RENDERING_SPEED_VALUES, IMAGE_PROMPT_MAX, PROMPT_HARD_CEILING, MAX_REQUEST_IMAGE_LIMIT, requestImageLimit } from "@nodaro/shared/models"
import { IMAGE_TO_IMAGE_ATTACH_COLUMNS } from "@nodaro/shared/entities"
import { resolveNormalizedImageGen } from "@nodaro/shared/credits"
import { defaultImageModel, sourceImageSizeNeeded, type SourceImageSize } from "@nodaro/shared/model-catalog"
import { formatZodError } from "../lib/zod-error.js"
import {
  ASSET_DESCRIPTION_MODEL,
  ASSET_DESCRIPTION_SYSTEM_PROMPT,
  ASSET_DESCRIPTION_LLM_OPTIONS,
  buildAssetDescriptionUserMessage,
} from "../lib/asset-description-prompt.js"
import { laneGuard } from "../lib/concurrency-lanes/request-scope.js"
import { isFilledText, llmProviderOf, rawBodyOf } from "../lib/concurrency-lanes/live-routes.js"

export const imageToImageBody = z.object({
  imageUrl: safeUrlSchema,
  // Generous ceiling; per-model truncation happens in the assembler (warn-don't-block).
  prompt: z.string().min(1).max(PROMPT_HARD_CEILING),
  userPrompt: z.string().max(PROMPT_HARD_CEILING).optional(),
  // MODIFY_IMAGE_PROVIDERS = IMAGE_I2I_PROVIDERS + nano-banana-edit (the KIE
  // i2i path handles it — see providers/kie/image.ts). Using the wider set
  // lets the MCP modify_image tool pass nano-banana-edit without a 400; it's
  // a superset so existing i2i callers are unaffected.
  provider: z.enum(MODIFY_IMAGE_PROVIDERS).optional(),
  // `imageUrl` plus these. The array's bound is the largest limit any model has;
  // `imageToImageRequest` holds each model to its own.
  referenceImageUrls: z.array(safeUrlSchema).max(MAX_REQUEST_IMAGE_LIMIT - 1).optional(),
  resolution: z.enum(IMAGE_RESOLUTION_VALUES).optional(),
  quality: z.enum(IMAGE_QUALITY_VALUES).optional(),
  /** Image background, on the models that take one (`auto`, `opaque`, `transparent`). */
  background: z.enum(IMAGE_BACKGROUND_VALUES).optional(),
  // The file written (PNG, JPEG, WebP, GIF, SVG) and a GIF's or an SVG's own levers.
  ...imageFormatFields,
  strength: z.number().min(0).max(1).optional(),
  // The SAME shared vocabulary /v1/generate-image and /v1/edit-image declare
  // (`IMAGE_ASPECT_RATIO_VALUES`) — one tuple, not three drifting literal
  // lists. Per-model gating is the catalog snap below (it corrects, never
  // rejects), so the wider vocabulary only defers a 400 to a disclosed
  // correction.
  aspectRatio: z.enum(IMAGE_ASPECT_RATIO_VALUES).optional(),
  negativePrompt: z.string().max(5000).optional(),
  seed: z.number().int().min(0).optional(),
  renderingSpeed: z.enum(IMAGE_RENDERING_SPEED_VALUES).optional(),
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
  attachToColumn: z.enum(IMAGE_TO_IMAGE_ATTACH_COLUMNS).optional(),
  attachName: z.string().min(1).max(200).optional(),
  // Identity injection (non-studio path only). When the upstream Character
  // node has its "Inject identity description in downstream prompts" toggle
  // enabled, the frontend / DAG executor passes this so the route appends the
  // character's canonical_description (with an identity-preserve suffix) to
  // the prompt before reservation + worker enqueue. Default off. Ignored on
  // the studio path because that flow already drafts a `description` via LLM
  // and forwards a richer payload — re-injecting canonical here would double
  // up identity language.
  injectCharacterContext: z.boolean().optional().default(false),
})

/** What the handler validates: the body, and each model's own image limit.
 *  `imageToImageBody` stays a plain object for `applySnappedLevers`. */
const imageToImageRequest = imageToImageBody.superRefine((data, ctx) => {
  // No model named: the limit of the default the handler will run it on.
  const limit = requestImageLimit(data.provider ?? defaultImageModel("edit", data.aspectRatio))
  if (1 + (data.referenceImageUrls?.length ?? 0) > limit) {
    ctx.addIssue({ code: "custom", path: ["referenceImageUrls"], message: `This model takes at most ${limit} input images, imageUrl included` })
  }
  const maskConflict = maskFormatConflict(data)
  if (maskConflict) ctx.addIssue({ code: "custom", path: ["maskUrl"], message: maskConflict })
})

const IDENTITY_PRESERVE_SUFFIX =
  "The subject must remain exactly the same person — preserve facial identity, eye color, hair color, skin tone, and unique features."

// The credit-CHECK resolver lives in image-to-image-credit-id.ts; re-exported for its importers.
export { resolveImageToImageCreditIdentifier }

/**
 * Reads the source photo's size ONCE, before the credit check, when it can
 * change what the run sends: "auto" that keeps the photo's shape, or a masked
 * edit on a model that follows its photo, whose size is then a pricing
 * dimension. The check and the handler's reservation both read the answer
 * (`req.imageSourceSize`), so they price the same size; `null` when it could
 * not be read (the size asked is kept). Runs before Zod, so it reads only a
 * valid url and never refuses anything.
 */
export async function readImageSourceSize(req: FastifyRequest): Promise<void> {
  const body = req.body as Record<string, unknown> | null
  if (!body) return
  const provider = typeof body.provider === "string" && body.provider.length > 0
    ? body.provider
    : defaultImageModel("edit", typeof body.aspectRatio === "string" ? body.aspectRatio : undefined)
  const aspectRatio = imageToImageAspectRatio(provider, body.aspectRatio)
  if (!sourceImageSizeNeeded(provider, aspectRatio, isMasked(body.maskUrl))) return
  if (typeof body.imageUrl !== "string" || !safeUrlSchema.safeParse(body.imageUrl).success) return
  req.imageSourceSize = (await probeImageDisplaySize(body.imageUrl)) ?? null
}

export async function imageToImageRoutes(app: FastifyInstance) {
  app.post("/v1/image-to-image", {
    preHandler: [
      readImageSourceSize,
      creditGuard(resolveImageToImageCreditIdentifier, { runModel: resolveImageToImageRunModel }),
      // The lane last, and only for a request that will make the LLM call.
      laneGuard("llm", {
        // The studio refine drafts a missing description with an LLM before it reserves.
        when: (req) => { const b = rawBodyOf(req); return b.attachToCharacterId != null && b.injectCharacterContext !== true && !isFilledText(b.description) },
        provider: () => llmProviderOf(ASSET_DESCRIPTION_MODEL),
      }),
    ],
  }, async (req, reply) => {
    const parsed = imageToImageRequest.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: "validation_error", ...formatZodError(parsed.error) },
      })
    }
    // No model named → the platform's edit default for this ratio (shared
    // `image-model-roles.ts`), resolved once so snap, credits and job agree.
    if (!parsed.data.provider) {
      parsed.data.provider = defaultImageModel("edit", parsed.data.aspectRatio) as NonNullable<(typeof parsed.data)["provider"]>
    }
    // No ratio named on a GPT Image 2, 2.5 or 2.6 edit model is "auto", the
    // photo's shape, instead of the provider config's 16:9. Set here, before
    // the levers are read, so the snap, `input_data` and the queue payload all
    // carry it, as the credit check does (`imageToImageAspectRatio`).
    parsed.data.aspectRatio = imageToImageAspectRatio(parsed.data.provider, parsed.data.aspectRatio)

    // The three catalog-governed levers are destructured as `raw*` on purpose:
    // `applySnappedLevers` below rewrites them on `parsed.data`, so these locals
    // are the caller's PRE-snap values and are only ever valid as INPUT to the
    // normalizer. Everything downstream reads `parsed.data.*`.
    const { imageUrl, prompt: rawPrompt, provider, referenceImageUrls, resolution: rawResolution, quality: rawQuality, background: rawBackground, outputFormat: rawOutputFormat, gifFrames: rawGifFrames, gifFrameDurationMs: rawGifFrameDurationMs, svgLevel: rawSvgLevel, strength, aspectRatio: rawAspectRatio, negativePrompt, seed, renderingSpeed, guidanceScale, maskUrl } = parsed.data
    let prompt = rawPrompt
    const userId = req.userId

    if (!userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "Authentication required" },
      })
    }

    // Must mirror the preHandler's identifier — flux-2-max bills per reference
    // image, and in i2i the primary `imageUrl` counts as one of the refs (the
    // worker concatenates [imageUrl, ...refs] before dispatch). One derivation
    // gives both the reserved tier and the parameters we actually send.
    //
    // "auto" on a model without a native auto keeps the source photo's shape:
    // `imageUrl`'s size, read from its header (and only then), picks the
    // model's nearest ratio. A masked edit on a model that follows its photo
    // (GPT Image 2.6 Flare and Sunburst) also takes its size from the photo,
    // and the size is priced, so the check and this reservation read the one
    // size `readImageSourceSize` read before the check.
    const i2iRefCount = 1 + (referenceImageUrls?.length ?? 0)
    // The size the preHandler read for the credit check, so the reservation
    // prices the same size; read here only when it was not (a direct call).
    const masked = isMasked(maskUrl)
    const sourceImage: SourceImageSize | undefined = req.imageSourceSize !== undefined
      ? req.imageSourceSize ?? undefined
      : await sourceImageForAutoAspect(provider, rawAspectRatio, imageUrl, masked)
    const normalized = resolveNormalizedImageGen({
      provider,
      aspectRatio: rawAspectRatio,
      quality: rawQuality,
      resolution: rawResolution,
      renderingSpeed,
      background: rawBackground,
      outputFormat: rawOutputFormat,
      gifFrames: rawGifFrames,
      gifFrameDurationMs: rawGifFrameDurationMs,
      svgLevel: rawSvgLevel,
      refCount: i2iRefCount,
      swapToI2i: false,
      sourceImage,
      masked,
    })
    const modelIdentifier = normalized.identifier

    // Write the snapped levers back onto the parsed body — `input_data` and the
    // queue payload below both read from it, so what we persist and what we
    // send the provider are the values we just priced.
    applySnappedLevers(parsed.data, normalized, imageToImageBody)
    const adjustments = normalized.adjustments

    // ─────────────────────────────────────────────────────────────────────
    // Studio path — when attachToCharacterId is set AND the caller has NOT
    // opted in to the simpler injectCharacterContext flow, the caller is the
    // Character Studio refining/regenerating an asset against a character
    // row. Non-studio callers (workflows / DAG executor / MCP) use
    // injectCharacterContext to opt into the simpler canonical_description
    // prompt mutation below and bypass the studio LLM-draft path entirely.
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
    const isStudioPath =
      parsed.data.attachToCharacterId !== undefined && !parsed.data.injectCharacterContext
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
            modelId: ASSET_DESCRIPTION_MODEL,
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

    // Identity injection (non-studio path only). When the Character node has
    // its injectIdentityInPrompts toggle enabled, the frontend forwards
    // injectCharacterContext + attachToCharacterId here. We append the
    // canonical_description (or description fallback) and an identity-preserve
    // suffix to the prompt BEFORE the job insert so the persisted input_data
    // and the worker payload both reflect the final prompt.
    if (!isStudioPath && parsed.data.injectCharacterContext && parsed.data.attachToCharacterId) {
      const { data: char } = await supabase
        .from("characters")
        .select("canonical_description, description, name")
        .eq("id", parsed.data.attachToCharacterId)
        .eq("user_id", userId)
        .is("deleted_at", null)
        .single()
      if (char) {
        const canonical = typeof char.canonical_description === "string" ? char.canonical_description.trim() : ""
        const desc = typeof char.description === "string" ? char.description.trim() : ""
        const identityText = canonical.length > 0 ? canonical : (desc.length > 0 ? desc : "")
        if (identityText.length > 0) {
          prompt = `${prompt.trim()}\n\n${identityText}\n\n${IDENTITY_PRESERVE_SUFFIX}`
          // Mirror the final prompt into parsed.data so buildJobInputData
          // persists it (input_data is what gallery/debug surfaces read back).
          parsed.data.prompt = prompt
          if (prompt.length > IMAGE_PROMPT_MAX) {
            req.log.warn(
              { characterId: parsed.data.attachToCharacterId, finalPromptLength: prompt.length },
              "[image-to-image] character context injection produced a long prompt; consider trimming canonicalDescription",
            )
          }
        }
      }
    }

    // B4b: apply any registered PromptPolicy to the final single-node i2i
    // prompt + native negative — this route's only policing site (the DAG lane
    // polices in payload-builder). Mirrored into parsed.data so the persisted
    // input_data carries the policed text the worker dispatches. No policy
    // registered = identity.
    const policed = applyPromptPolicies({ prompt, negativePrompt: negativePrompt ?? "", kind: "image" })
    prompt = policed.prompt
    const finalNegativePrompt = policed.negativePrompt || undefined
    parsed.data.prompt = prompt
    parsed.data.negativePrompt = finalNegativePrompt

    // A prompt shorter than the model takes is refused before the job row and
    // the reservation: the provider would refuse it after both.
    const tooShort = imagePromptTooShort(normalized.modelId, prompt)
    if (tooShort) return reply.status(400).send({ error: tooShort })

    const mcpClient = extractMcpClient(req.body)
    const forcePrivate = isStudioPath ? true : (extractForcePrivate(req.body) || undefined)
    const { data: job, error } = await insertJob(req, {
        workflow_id: extractWorkflowId(req.body),
        node_id: extractNodeId(req.body),
        force_private: forcePrivate,
        user_id: userId,
        status: "pending",
        input_data: withResolvedModel(buildJobInputData(parsed.data, "image-to-image"), "image-to-image"),
        ...(mcpClient ? { mcp_client: mcpClient } : {}),
      })

    if (error) {
      return sendInternalError(reply, req, error, "Failed to process image")
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
      resolution: parsed.data.resolution,
      quality: parsed.data.quality,
      background: parsed.data.background,
      outputFormat: parsed.data.outputFormat,
      gifFrames: parsed.data.gifFrames,
      gifFrameDurationMs: parsed.data.gifFrameDurationMs,
      svgLevel: parsed.data.svgLevel,
      strength,
      aspectRatio: parsed.data.aspectRatio,
      negativePrompt: finalNegativePrompt,
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

    return withAdjustments({ jobId: job.id }, adjustments)
  })
}
