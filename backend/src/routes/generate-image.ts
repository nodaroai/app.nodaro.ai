import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { safeUrlSchema } from "../lib/url-validator.js"
import { supabase } from "../lib/supabase.js"
import { videoQueue } from "../lib/queue.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
import { extractWorkflowId, extractForcePrivate } from "../lib/request-helpers.js"
import { extractMcpClient } from "../lib/extract-mcp-client.js"
import { buildJobInputData } from "../lib/job-input-data.js"
import { IMAGE_GEN_PROVIDERS, T2I_TO_I2I_VARIANT, FLUX_LORA_CHARACTER_MODEL_ID } from "@nodaro/shared"
import { buildCreditModelIdentifier } from "@nodaro/shared"
import { formatZodError } from "../lib/zod-error.js"

/**
 * Decide whether the prompt actually addresses any reference images.
 * `buildImagePrompt` emits the "Use these references for the output image:"
 * header only when at least one `{image:N:label}` mention is present, so
 * checking for that string is a reliable signal that the user wants the
 * model to consume the attached refs (versus just having them attached).
 */
function promptAddressesReferences(prompt: string): boolean {
  return prompt.includes("Use these references for the output image:")
}

/**
 * If the user picked a T2I provider that has an i2i sibling AND the prompt
 * mentions reference images, transparently route to the i2i variant — the
 * T2I endpoint silently ignores ref URLs, while the i2i endpoint actually
 * uses them.
 */
function resolveEffectiveProvider(
  provider: string | undefined,
  prompt: string,
  referenceImageUrls: string[] | undefined,
): string | undefined {
  if (!provider) return provider
  if (!referenceImageUrls?.length) return provider
  if (!promptAddressesReferences(prompt)) return provider
  return T2I_TO_I2I_VARIANT[provider] ?? provider
}

export const generateImageBody = z.object({
  prompt: z.string().min(1).max(2000),
  userPrompt: z.string().max(8000).optional(),
  referenceImageUrls: z.array(safeUrlSchema).max(14).optional(),
  characterDescriptions: z.array(z.string().max(500)).max(10).optional(),
  // `flux-lora-character` is an internal-only provider id selected when a
  // single trained @character is mentioned. It does NOT appear in
  // `IMAGE_GEN_PROVIDERS` (which drives user-facing dropdowns) — instead we
  // accept it via a union and require the paired `_internalLora` hint below.
  provider: z.union([
    z.enum(IMAGE_GEN_PROVIDERS),
    z.literal(FLUX_LORA_CHARACTER_MODEL_ID),
  ]).optional(),
  /**
   * Internal-only hint set by the frontend's single-node Run path (see
   * `execute-node.ts`) when the user runs a generate-image node that
   * references a trained character. NEVER set by SDK/public clients.
   * Required when `provider === FLUX_LORA_CHARACTER_MODEL_ID`.
   */
  _internalLora: z.object({
    version: z.string().min(1),
    trigger: z.string().min(1),
  }).optional(),
  // "auto" is gpt-image-2 specific (KIE constrains it to 1K) — keeping the
  // enum permissive here and letting the per-provider config / fail-safe in
  // model-options.ts gate it on the correct providers.
  aspectRatio: z.enum([
    "auto",
    "1:1", "16:9", "9:16", "4:3", "3:4",
    "3:2", "2:3", "5:4", "4:5", "21:9",
  ]).optional(),
  resolution: z.enum(["1K", "2K", "4K"]).optional(),
  quality: z.enum(["medium", "high", "basic"]).optional(),
  negativePrompt: z.string().max(5000).optional(),
  seed: z.number().int().min(0).optional(),
  renderingSpeed: z.enum(["TURBO", "BALANCED", "QUALITY"]).optional(),
  styleType: z.string().optional(),
  expandPrompt: z.boolean().optional(),
  // Identity injection: when the upstream Character node has its
  // "Inject identity description in downstream prompts" toggle enabled, the
  // frontend / DAG executor passes these so the route appends the character's
  // canonical_description (with an identity-preserve suffix) to the prompt
  // before reservation and worker enqueue. Default off — must be explicit.
  injectCharacterContext: z.boolean().optional().default(false),
  attachToCharacterId: z.string().uuid().optional(),
  userId: z.string().uuid().optional(),
})

const IDENTITY_PRESERVE_SUFFIX =
  "The subject must remain exactly the same person — preserve facial identity, eye color, hair color, skin tone, and unique features."

export async function generateImageRoutes(app: FastifyInstance) {
  app.post("/v1/generate-image", { preHandler: creditGuard((req) => {
    const body = req.body as Record<string, unknown>
    // Character LoRA single-node Run hint — runs BEFORE Zod, so credits
    // reserve as flux-lora-character (3cr) instead of the default nano-banana
    // (2cr). Without this short-circuit, the preHandler would silently
    // under-bill by 1cr per LoRA inference.
    if (body && typeof body === "object" && "_internalLora" in body) {
      return FLUX_LORA_CHARACTER_MODEL_ID
    }
    const rawProvider = (body?.provider as string) ?? "nano-banana"
    const prompt = (body?.prompt as string) ?? ""
    const refs = body?.referenceImageUrls as string[] | undefined
    // Mirror the auto-swap inside the route handler so credits are reserved
    // for the variant we'll actually invoke.
    const provider = resolveEffectiveProvider(rawProvider, prompt, refs) ?? rawProvider
    const quality = body?.quality as string | undefined
    const resolution = body?.resolution as string | undefined
    const renderingSpeed = body?.renderingSpeed as string | undefined
    // flux-2-max bills per reference image — pass the count so the identifier
    // becomes `flux-2-max:Nref` and the right model_pricing row is hit.
    const refCount = refs?.length ?? 0
    return buildCreditModelIdentifier(provider, quality, resolution, renderingSpeed, undefined, refCount)
  }) }, async (req, reply) => {
    const parsed = generateImageBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: "validation_error", ...formatZodError(parsed.error) },
      })
    }

    const { prompt: rawPrompt, referenceImageUrls, characterDescriptions, provider, aspectRatio, resolution, quality, negativePrompt, seed, renderingSpeed, styleType, expandPrompt } = parsed.data
    const internalLora = parsed.data._internalLora
    const userId = req.userId

    if (!userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "Authentication required" },
      })
    }

    // Internal-only provider gate: flux-lora-character requires the paired
    // _internalLora hint. If a client somehow submits the provider literal
    // without the hint, reject — this is internal-orchestrator-only.
    if (provider === FLUX_LORA_CHARACTER_MODEL_ID && !internalLora) {
      return reply.status(400).send({
        error: {
          code: "internal_only_provider",
          message: "flux-lora-character requires _internalLora hint",
        },
      })
    }

    // Append character descriptions to prompt
    const descSuffix = (characterDescriptions ?? []).map((d) => d).join(" ")
    let prompt = descSuffix ? `${rawPrompt}\n${descSuffix}` : rawPrompt

    // Identity injection — when enabled + a character is referenced, append the
    // canonical description (with description / nothing fallback) plus an
    // identity-preserve suffix to the prompt. Off by default; the user must
    // explicitly opt in per Character node (see CharacterNodeData.injectIdentityInPrompts).
    if (parsed.data.injectCharacterContext && parsed.data.attachToCharacterId) {
      const { data: char } = await supabase
        .from("characters")
        .select("canonical_description, description, name")
        .eq("id", parsed.data.attachToCharacterId)
        .eq("user_id", userId)
        .is("deleted_at", null)
        .single()
      if (char) {
        // Degradation chain: canonical_description -> description.
        // We deliberately skip the `name`-only case — injecting just the
        // character's name adds zero identity signal and pollutes the prompt.
        const canonical = typeof char.canonical_description === "string" ? char.canonical_description.trim() : ""
        const desc = typeof char.description === "string" ? char.description.trim() : ""
        const identityText = canonical.length > 0 ? canonical : (desc.length > 0 ? desc : "")
        if (identityText.length > 0) {
          prompt = `${prompt.trim()}\n\n${identityText}\n\n${IDENTITY_PRESERVE_SUFFIX}`
          if (prompt.length > 2000) {
            req.log.warn(
              { characterId: parsed.data.attachToCharacterId, finalPromptLength: prompt.length },
              "[generate-image] character context injection produced a long prompt; consider trimming canonicalDescription",
            )
          }
        }
      }
    }

    // LoRA inference path bypasses provider auto-routing — the synthetic
    // flux-lora-character provider always lands on Replicate with the trained
    // version. Otherwise, auto-route T2I providers to their i2i sibling when
    // the user actually addresses reference images in the prompt.
    const effectiveProvider = internalLora
      ? FLUX_LORA_CHARACTER_MODEL_ID
      : resolveEffectiveProvider(provider, prompt, referenceImageUrls)

    // Determine model identifier for credit reservation (composite for variable pricing).
    const modelIdentifier = internalLora
      ? FLUX_LORA_CHARACTER_MODEL_ID
      : buildCreditModelIdentifier(effectiveProvider ?? "nano-banana", quality, resolution, renderingSpeed)

    const mcpClient = extractMcpClient(req.body)
    const { data: job, error } = await supabase
      .from("jobs")
      .insert({
        workflow_id: extractWorkflowId(req.body),
        force_private: extractForcePrivate(req.body) || undefined,
        user_id: userId,
        status: "pending",
        input_data: { ...buildJobInputData(parsed.data, "generate-image"), prompt },
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

    await videoQueue.add("generate-image", {
      jobId: job.id,
      prompt,
      // LoRA path: trained model + trigger word carry identity — emit zero refs.
      referenceImageUrls: internalLora ? [] : referenceImageUrls,
      provider: effectiveProvider,
      // Hand the synthetic flux-lora-character model id to the Replicate provider.
      model: internalLora ? FLUX_LORA_CHARACTER_MODEL_ID : undefined,
      aspectRatio,
      resolution,
      quality,
      negativePrompt,
      seed,
      renderingSpeed,
      styleType,
      expandPrompt,
      // Pass lora_version + lora_trigger through to ReplicateImageProvider.buildInput.
      extraParams: internalLora
        ? { lora_version: internalLora.version, lora_trigger: internalLora.trigger }
        : undefined,
      usageLogId,
    })

    return { jobId: job.id }
  })
}
