import type { FastifyInstance, FastifyRequest } from "fastify"
import { z } from "zod"
import { openApiRegistry } from "../lib/openapi-registry.js"
import { safeUrlSchema } from "../lib/url-validator.js"
import { supabase } from "../lib/supabase.js"
import { config } from "../lib/config.js"
import { videoQueue } from "../lib/queue.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
import { extractWorkflowId, extractNodeId, extractForcePrivate } from "../lib/request-helpers.js"
import { extractMcpClient } from "../lib/extract-mcp-client.js"
import { buildJobInputData } from "../lib/job-input-data.js"
import { insertWithIdempotencyKey } from "../lib/idempotent-insert.js"
import { IMAGE_GEN_PROVIDERS, T2I_TO_I2I_VARIANT, FLUX_LORA_CHARACTER_MODEL_ID, IMAGE_PROMPT_MAX, PROMPT_HARD_CEILING, resolveImageGenCreditIdentifier } from "@nodaro/shared"
import { assembleImageInput, type AssembleImageInput, type BuildImagePromptResult } from "@nodaro/prompts"
import { connectedReferenceSchema } from "../lib/connected-reference-schema.js"
import { formatZodError } from "../lib/zod-error.js"

// Re-exported for the key-set drift guard in `__tests__/generate-image.test.ts`.
// The canonical definition now lives in `lib/connected-reference-schema.ts`
// (shared with `generate-video` so both routes use the EXACT same mirror).
export { connectedReferenceSchema }

/**
 * If the user picked a T2I provider that has an i2i sibling AND reference images
 * are ATTACHED, transparently route to the i2i variant — the T2I endpoint
 * silently ignores ref URLs, while the i2i endpoint actually consumes them.
 *
 * The trigger is attached refs (`referenceImageUrls.length > 0`), NOT a prompt
 * marker: a plain prompt + a reference still edits, so any caller just sends
 * `referenceImageUrls` and generate-image honors them — no `{image:N}` mention /
 * "Use these references…" header required. Providers that already consume refs
 * natively in their T2I call (Replicate "Open" models, nano-banana) aren't in the
 * swap map and pass through unchanged.
 */
function resolveEffectiveProvider(
  provider: string | undefined,
  referenceImageUrls: string[] | undefined,
): string | undefined {
  if (!provider) return provider
  if (!referenceImageUrls?.length) return provider
  return T2I_TO_I2I_VARIANT[provider] ?? provider
}

// `connectedReferenceSchema` now lives in `lib/connected-reference-schema.ts`
// (imported + re-exported above) so `generate-video` shares the EXACT same
// mirror. The key-set drift guard in `__tests__/generate-image.test.ts` still
// pins its fields to the shared `ConnectedReference` type.

/**
 * The 5 optional cinematic-direction id strings the Studio framing UI (and the
 * MCP route) expose. Mirrors `@nodaro/shared` `DirectionFields` — folded into
 * the prompt as hints by `assembleImageInput`.
 */
const directionSchema = z.object({
  framingId: z.string().optional(),
  framingAngleId: z.string().optional(),
  lightingId: z.string().optional(),
  lensId: z.string().optional(),
  cameraFormatId: z.string().optional(),
})

/**
 * Mirror of `@nodaro/shared` `StructuredPromptFields` (Path-1 structured
 * fields). Free-form strings under person / styling / setting / camera / lens /
 * mood — `assembleImageInput` renders them into a prompt fragment.
 */
const structuredPromptFieldsSchema = z.object({
  person: z.object({
    age: z.number().optional(),
    gender: z.enum(["man", "woman", "child", "non-binary"]).optional(),
    hair: z.string().optional(),
    eyes: z.string().optional(),
    expression: z.string().optional(),
    profession: z.string().optional(),
    warriorType: z.string().optional(),
  }).optional(),
  styling: z.object({
    mood: z.string().optional(),
    lighting: z.string().optional(),
    aesthetic: z.string().optional(),
    colorLook: z.string().optional(),
  }).optional(),
  setting: z.object({
    era: z.string().optional(),
    atmosphere: z.string().optional(),
    backdrop: z.string().optional(),
  }).optional(),
  camera: z.object({
    framing: z.string().optional(),
    motion: z.string().optional(),
    format: z.string().optional(),
  }).optional(),
  lens: z.object({
    focalLength: z.string().optional(),
    aperture: z.string().optional(),
  }).optional(),
  mood: z.string().optional(),
})

export const generateImageBody = z.object({
  // RELAXED from `.min(1)` to `.min(0)` for WI-1b: in structured mode the user
  // prompt may be empty when `connectedReferences` / `direction` / `structured`
  // fill it. The empty-prompt rejection MOVES post-assembly (a bound entity /
  // direction chip that filled an otherwise-empty prompt still runs; an
  // assembly that produces a truly-empty prompt → 400). The flat path (no
  // structured fields) still effectively requires a prompt because no other
  // input can populate it — see the post-assembly empty check in the handler.
  // Generous ceiling, NOT a per-model reject: the prompt assembler truncates to
  // the provider's verified cap (getMaxImagePromptChars) and the editor warns the
  // user first (warn-don't-block). Per-model enforcement lives in the assembler.
  prompt: z.string().min(0).max(PROMPT_HARD_CEILING),
  userPrompt: z.string().max(8000).optional(),
  referenceImageUrls: z.array(safeUrlSchema).max(14).optional(),
  // ─── WI-1b structured inputs (all optional; ADDITIVE) ────────────────────
  // When ANY of these is present, the route is in "structured mode": it
  // assembles the flat prompt + reference URLs server-side via the shared
  // `assembleImageInput`. When ALL are absent, the route behaves
  // byte-identically to before (the pre-assembled flat-prompt path).
  connectedReferences: z.array(connectedReferenceSchema).max(14).optional(),
  // User-defined reorder of the assembled reference list (stable tile ids),
  // honored by `assembleImageInput`'s reference-order pass — parity with
  // generate-video. No-op without `connectedReferences` (nothing to reorder).
  referenceOrder: z.array(z.string()).max(14).optional(),
  direction: directionSchema.optional(),
  structured: structuredPromptFieldsSchema.optional(),
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
   *
   * Carries the character row id (NOT the resolved version + trigger) —
   * the route looks up `lora_replicate_version` + `lora_trigger_word`
   * server-side scoped by `req.userId`. Without this lookup, a caller
   * could submit any guessed/leaked Replicate version hash and run
   * inference against ANY trained LoRA.
   */
  _internalLora: z.object({
    characterId: z.string().uuid(),
  }).optional(),
  // "auto" is gpt-image-2 specific (KIE constrains it to 1K) — keeping the
  // enum permissive here and letting the per-provider config / fail-safe in
  // model-options.ts gate it on the correct providers.
  aspectRatio: z.enum([
    "auto",
    "1:1", "16:9", "9:16", "4:3", "3:4",
    "3:2", "2:3", "5:4", "4:5", "21:9",
    "8:1", "1:8", // Wan 2.7 / Wan 2.7 Pro ultra-wide (in the catalog + picker)
  ]).optional(),
  resolution: z.enum(["1K", "2K", "4K", "0.5 MP", "1 MP", "2 MP", "4 MP"]).optional(),
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
  /** Inpaint base image (the image being edited). With maskUrl, the worker
   *  composites the result's masked region back over this image. */
  baseImageUrl: safeUrlSchema.optional(),
  /** Inpaint mask (white = edit region, black = keep). Requires baseImageUrl. */
  maskUrl: safeUrlSchema.optional(),
  /** i2i strength (gated per provider by I2I_STRENGTH_SUPPORT). */
  strength: z.number().min(0).max(1).optional(),
  /** guidance scale (gated per provider by GUIDANCE_SCALE_SUPPORT). */
  guidanceScale: z.number().min(0).max(20).optional(),
})

const IDENTITY_PRESERVE_SUFFIX =
  "The subject must remain exactly the same person — preserve facial identity, eye color, hair color, skin tone, and unique features."

/**
 * WI-1b structured-mode detection. The route enters structured mode (server-side
 * assembly via `assembleImageInput`) when ANY of `connectedReferences` /
 * `direction` / `structured` is present. When all are absent the request takes
 * the unchanged pre-assembled flat-prompt path.
 *
 * Accepts a loose shape so BOTH callers can share it: the preHandler (raw,
 * pre-Zod `req.body`) and the handler (Zod-parsed data). It only checks for
 * the presence of the three structured channels.
 */
function isStructuredImageMode(body: {
  connectedReferences?: unknown
  direction?: unknown
  structured?: unknown
} | null | undefined): boolean {
  // Defensive null/non-object guard (mirrors the preHandler's `:320` check). A
  // literal `null` JSON body (this route has no Fastify body schema) makes
  // `req.body === null`; without this, `body.connectedReferences` would throw a
  // TypeError in the preHandler (which has no try/catch) → 500. With it, the
  // preHandler falls through to the flat-ref path and the handler's
  // `safeParse(null)` returns the clean 400 `validation_error`.
  if (!body || typeof body !== "object") return false
  return (
    (Array.isArray(body.connectedReferences) && body.connectedReferences.length > 0) ||
    (body.direction != null && typeof body.direction === "object") ||
    (body.structured != null && typeof body.structured === "object")
  )
}

/**
 * Build the `assembleImageInput` argument from the route's fields. Shared by
 * the preHandler (pricing) and the handler (reservation + queue) so BOTH price
 * on the SAME assembled reference count — the load-bearing billing invariant.
 *
 * `throwOnEmpty` is OFF here (the preHandler must never throw — it only needs
 * the assembled ref count for pricing); the handler re-runs assembly WITH
 * `throwOnEmpty: true` so a truly-empty assembled prompt → 400.
 */
function buildAssembleInput(
  body: {
    prompt?: string
    provider?: string
    connectedReferences?: AssembleImageInput["connectedReferences"]
    referenceOrder?: AssembleImageInput["referenceOrder"]
    direction?: AssembleImageInput["direction"]
    structured?: AssembleImageInput["structured"]
    referenceImageUrls?: string[]
    negativePrompt?: string
  },
  throwOnEmpty: boolean,
): AssembleImageInput {
  return {
    userPrompt: body.prompt ?? "",
    // Default provider mirrors the rest of the route (`nano-banana`) so the
    // per-provider reference gate inside `buildImagePrompt` resolves the same
    // way regardless of which call site invokes assembly.
    provider: body.provider ?? "nano-banana",
    // HYBRID IS THE DEFAULT everywhere (dev AND production). Test runs must
    // resolve to legacy (route tests assert the legacy assembly) — so the test
    // check comes FIRST. Set IMAGE_REFERENCE_FORMAT=legacy to revert to legacy.
    ...(process.env.NODE_ENV === "test" || process.env.IMAGE_REFERENCE_FORMAT === "legacy"
      ? {}
      : { referenceFormat: "hybrid" as const }),
    ...(body.connectedReferences !== undefined ? { connectedReferences: body.connectedReferences } : {}),
    ...(body.referenceOrder !== undefined ? { referenceOrder: body.referenceOrder } : {}),
    ...(body.direction !== undefined ? { direction: body.direction } : {}),
    ...(body.structured !== undefined ? { structured: body.structured } : {}),
    // The flat `referenceImageUrls` doubles as `extraReferenceImageUrls` so it
    // rides the SAME per-provider reference gate + ordering as
    // `connectedReferences`.
    ...(body.referenceImageUrls !== undefined ? { extraReferenceImageUrls: body.referenceImageUrls } : {}),
    ...(body.negativePrompt !== undefined ? { negativePrompt: body.negativePrompt } : {}),
    throwOnEmpty,
  }
}

/**
 * Pure (no I/O, no mutation) assembly used by the preHandler to derive the
 * ASSEMBLED reference count for pricing. Returns the count of references the
 * handler will actually send to the worker — i.e. post per-provider gate, post
 * dedup, post Phase-0 mention/canonical-fallback resolution — so the credit
 * CHECK prices the same amount the handler will DEBIT.
 *
 * Best-effort: if assembly throws (it shouldn't with `throwOnEmpty: false`),
 * fall back to the flat `referenceImageUrls` count so we never crash the
 * preHandler on a pricing estimate.
 */
function assembledRefCountForPricing(body: {
  prompt?: string
  provider?: string
  connectedReferences?: AssembleImageInput["connectedReferences"]
  direction?: AssembleImageInput["direction"]
  structured?: AssembleImageInput["structured"]
  referenceImageUrls?: string[]
  negativePrompt?: string
}): number {
  try {
    const result = assembleImageInput(buildAssembleInput(body, false))
    return result.referenceImageUrls?.length ?? 0
  } catch {
    return body.referenceImageUrls?.length ?? 0
  }
}

/**
 * The credit-CHECK model-identifier resolver (preHandler side). Extracted as a
 * named export so the CHECK===DEBIT billing-parity test can run the EXACT
 * pricing the live preHandler runs — every route test mocks `creditGuard` to a
 * no-op, so this closure would otherwise never execute. The handler's DEBIT
 * identifier (`modelIdentifier` below) is computed at a SEPARATELY-WRITTEN site;
 * the test asserts the two stay byte-identical for the same body across the
 * ref-count cases (see __tests__/generate-image.test.ts). Keep this in lock-step
 * with the handler's reservation identifier.
 */
export function resolveImageCreditIdentifier(req: FastifyRequest): string {
  const body = req.body as Record<string, unknown>
  // Character LoRA single-node Run hint — runs BEFORE Zod, so credits
  // reserve as flux-lora-character (3cr) instead of the default nano-banana
  // (2cr). Without this short-circuit, the preHandler would silently
  // under-bill by 1cr per LoRA inference. Mirrors the kill-switch gate
  // in the handler below — when routing is disabled, fall through to the
  // default identifier so the handler and the preHandler agree.
  if (
    body &&
    typeof body === "object" &&
    "_internalLora" in body &&
    config.CHARACTER_LORA_ROUTING_ENABLED
  ) {
    return FLUX_LORA_CHARACTER_MODEL_ID
  }
  const rawProvider = (body?.provider as string) ?? "nano-banana"
  const flatRefs = body?.referenceImageUrls as string[] | undefined
  const quality = body?.quality as string | undefined
  const resolution = body?.resolution as string | undefined
  const renderingSpeed = body?.renderingSpeed as string | undefined

  // WI-1b: in structured mode, `connectedReferences` expand to URLs and are
  // gated per-provider INSIDE `buildImagePrompt` — so the billed reference
  // count must reflect the ASSEMBLED (post-gate, post-dedup) count, not the
  // raw `connectedReferences.length`. We run the SAME shared `assembleImageInput`
  // here that the handler runs, so this CHECK prices the exact amount the
  // handler will DEBIT. (`assembleImageInput` is pure — no I/O, no mutation —
  // so running it twice is safe and cheap. The atomic `reserve_credits` RPC in
  // the handler is the authoritative debit + balance/cap guard; this preHandler
  // is the advisory pre-check, and keeping it on the same count avoids a false
  // 402 / false pass.)
  const structured = isStructuredImageMode(body as {
    connectedReferences?: unknown
    direction?: unknown
    structured?: unknown
  })
  const refCount = structured
    ? assembledRefCountForPricing(body as Parameters<typeof assembledRefCountForPricing>[0])
    : (flatRefs?.length ?? 0)

  // Shared reference-aware builder: mirrors the handler's T2I→I2I auto-swap
  // (triggered by refs being attached — in structured mode the ASSEMBLED count,
  // so a wired character with no @-mention contributes zero refs and does not
  // swap) and encodes the per-ref Flux 2 tier. The SAME helper drives the
  // workflow orchestrator (payload-builder.ts), so single-node and DAG runs
  // reserve identical credits.
  return resolveImageGenCreditIdentifier({ provider: rawProvider, quality, resolution, renderingSpeed, refCount, swapToI2i: true })
}


openApiRegistry.registerPath({
  method: "post",
  path: "/v1/generate-image",
  description:
    "Generate an image (async). Returns a jobId — poll GET /v1/jobs/{id}/status. " +
    "Every generation node follows this same shape: POST /v1/{node-type} with " +
    "that node's params (see the node catalog for per-type fields).",
  security: [{ bearerAuth: [] }],
  request: { body: { content: { "application/json": { schema: generateImageBody } } } },
  responses: {
    200: { description: "Job created", content: { "application/json": { schema: z.object({ jobId: z.string().uuid() }) } } },
    401: { description: "Unauthorized" },
    402: { description: "Insufficient credits" },
  },
})

export async function generateImageRoutes(app: FastifyInstance) {
  app.post("/v1/generate-image", { preHandler: creditGuard(resolveImageCreditIdentifier) }, async (req, reply) => {
    const parsed = generateImageBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: "validation_error", ...formatZodError(parsed.error) },
      })
    }

    const { prompt: rawPrompt, referenceImageUrls, characterDescriptions, provider, aspectRatio, resolution, quality, negativePrompt, seed, renderingSpeed, styleType, expandPrompt, baseImageUrl, maskUrl, strength, guidanceScale } = parsed.data
    const internalLora = parsed.data._internalLora
    const userId = req.userId

    // WI-1b: structured mode. When `connectedReferences` / `direction` /
    // `structured` are present, assemble the flat prompt + reference URLs +
    // native negative prompt server-side via the shared `assembleImageInput`
    // (the single source of truth shared with the frontend `execute-node` and
    // the backend `payload-builder`). When ALL are absent we DO NOT touch the
    // pre-assembled flat path — `assembled` stays null and the request behaves
    // byte-identically to before. `throwOnEmpty: true` makes an assembly that
    // produces a truly-empty FINAL prompt throw → caught below → 400.
    const structuredMode = isStructuredImageMode(parsed.data)
    let assembled: BuildImagePromptResult | null = null
    if (structuredMode) {
      try {
        assembled = assembleImageInput(buildAssembleInput(parsed.data, true))
      } catch {
        return reply.status(400).send({
          error: { code: "no_prompt", message: "No prompt" },
        })
      }
    }
    // Reference URLs to use downstream. Two views, intentionally distinct:
    //   • `queueReferenceImageUrls` — the value sent to the worker + recorded in
    //     the job. In structured mode it's the ASSEMBLED (post per-provider gate,
    //     post-dedup) list; in flat mode it's the RAW `referenceImageUrls`
    //     PRESERVED VERBATIM (including `undefined` when absent) so the flat path
    //     is byte-identical to before.
    //   • `assembledRefs` — an always-array view used ONLY for the credit
    //     reservation refCount + the i2i auto-swap decision. Its `.length`
    //     equals `queueReferenceImageUrls?.length ?? 0` in BOTH modes, so the
    //     billed count always equals the count actually sent to the provider.
    const queueReferenceImageUrls = structuredMode
      ? (assembled?.referenceImageUrls ?? [])
      : referenceImageUrls
    const assembledRefs = queueReferenceImageUrls ?? []
    // In structured mode the non-native negative prompt is already folded into
    // the assembled prompt by `buildImagePrompt`; only the NATIVE negative
    // prompt rides its own channel to the worker (mirrors payload-builder).
    const effectiveNegativePrompt = structuredMode
      ? assembled?.nativeNegativePrompt
      : negativePrompt

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

    // Resolve `_internalLora.characterId` to `{ version, trigger }` via a
    // server-side lookup scoped by `req.userId`. The caller never sees the
    // raw Replicate version hash — preventing a stolen JWT from running
    // inference against another user's trained model by submitting a
    // guessed version string. The `lora_training_status='succeeded'` filter
    // ensures we only route through fully-trained models (in-flight or
    // failed trainings fall back to the generic provider).
    let resolvedLora: { version: string; trigger: string } | null = null
    // Gated by CHARACTER_LORA_ROUTING_ENABLED — when "false", we ignore the
    // body hint entirely and the request proceeds as the default provider.
    // The frontend may still send `_internalLora`; the server is the
    // authority on whether to swap.
    if (internalLora && config.CHARACTER_LORA_ROUTING_ENABLED) {
      const { data: char } = await supabase
        .from("characters")
        .select("lora_replicate_version, lora_trigger_word, lora_training_status")
        .eq("id", internalLora.characterId)
        .eq("user_id", userId)
        .is("deleted_at", null)
        .single()
      if (
        !char ||
        char.lora_training_status !== "succeeded" ||
        !char.lora_replicate_version ||
        !char.lora_trigger_word
      ) {
        return reply.status(400).send({
          error: {
            code: "character_not_trained",
            message: "Character not found or has no successful LoRA training.",
          },
        })
      }
      resolvedLora = {
        version: char.lora_replicate_version,
        trigger: char.lora_trigger_word,
      }
    }

    // Append character descriptions to prompt. In structured mode the base is
    // the ASSEMBLED prompt (cinematic hints + structured fields + reference
    // directives + folded non-native negative prompt already composed by
    // `assembleImageInput`); otherwise the raw pre-assembled prompt. The
    // route-level `characterDescriptions` suffix + identity injection below
    // then layer on top in BOTH modes (unchanged behavior).
    const basePrompt = structuredMode ? (assembled?.prompt ?? rawPrompt) : rawPrompt
    const descSuffix = (characterDescriptions ?? []).map((d) => d).join(" ")
    let prompt = descSuffix ? `${basePrompt}\n${descSuffix}` : basePrompt

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
          if (prompt.length > IMAGE_PROMPT_MAX) {
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
    // version. Otherwise, auto-route T2I providers to their i2i sibling whenever
    // reference images are attached (no prompt-mention required). The swap keys
    // off the ASSEMBLED ref list so a structured-mode request with a wired
    // character that has no @-mention (→ zero assembled refs) does NOT swap.
    const effectiveProvider = resolvedLora
      ? FLUX_LORA_CHARACTER_MODEL_ID
      : resolveEffectiveProvider(provider, assembledRefs)

    // Determine model identifier for credit reservation (composite for variable pricing).
    // Must mirror the preHandler's identifier — flux-2-max bills per reference image,
    // so refCount drives the `:Nref` suffix the model_pricing row expects. We price
    // on the ASSEMBLED ref count (`assembledRefs.length`) — the exact array sent to
    // the worker below — so the DEBIT can never under/over-bill relative to what the
    // provider actually receives. In the flat path `assembledRefs === referenceImageUrls`,
    // so this is byte-identical to the previous `referenceImageUrls?.length`.
    const modelIdentifier = resolvedLora
      ? FLUX_LORA_CHARACTER_MODEL_ID
      : resolveImageGenCreditIdentifier({
          // Pass the RAW provider — the shared helper applies the same T2I→I2I
          // swap as `resolveEffectiveProvider` above, keyed on the assembled
          // ref count, so this DEBIT matches the preHandler CHECK and the
          // workflow orchestrator exactly.
          provider,
          quality,
          resolution,
          renderingSpeed,
          refCount: assembledRefs.length,
          swapToI2i: true,
        })

    const mcpClient = extractMcpClient(req.body)

    // Race-proof INSERT: if a concurrent caller already inserted a row with
    // the same (user_id, idempotency_key), the DB UNIQUE constraint catches
    // it and we get back the winner's row with `created: false`. Skip credit
    // reservation in that case — the original caller already reserved.
    let insertResult: { row: { id: string }; created: boolean }
    try {
      insertResult = await insertWithIdempotencyKey<{ id: string }>(
        "jobs",
        {
          workflow_id: extractWorkflowId(req.body),
          node_id: extractNodeId(req.body),
          force_private: extractForcePrivate(req.body) || undefined,
          user_id: userId,
          status: "pending",
          input_data: { ...buildJobInputData(parsed.data, "generate-image"), prompt },
          ...(mcpClient ? { mcp_client: mcpClient } : {}),
        },
        req.idempotencyKey,
      )
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return reply.status(500).send({
        error: { code: "internal_error", message },
      })
    }
    const job = insertResult.row

    if (!insertResult.created) {
      // Dedup hit at the DB layer (race winner already exists). Mirror the
      // preHandler dedup-hit response so callers see a consistent contract.
      reply.header("X-Dedup-Hit", "1")
      return reply.code(200).send({ jobId: job.id, deduped: true })
    }

    // Reserve credits
    const reservation = await reserveCreditsForJob(req, reply, job.id, modelIdentifier)
    if (reply.sent) return
    const usageLogId = reservation?.usageLogId

    await videoQueue.add("generate-image", {
      jobId: job.id,
      prompt,
      // LoRA path: trained model + trigger word carry identity — emit zero refs.
      // Otherwise the ASSEMBLED refs in structured mode, or the RAW flat refs
      // (preserved verbatim, incl. undefined) in the non-structured path.
      referenceImageUrls: resolvedLora ? [] : queueReferenceImageUrls,
      provider: effectiveProvider,
      // Hand the synthetic flux-lora-character model id to the Replicate provider.
      model: resolvedLora ? FLUX_LORA_CHARACTER_MODEL_ID : undefined,
      aspectRatio,
      resolution,
      quality,
      // Structured mode: only the NATIVE negative prompt rides this channel
      // (the non-native one is folded into `prompt`). Flat mode: the raw
      // negative prompt, unchanged.
      negativePrompt: effectiveNegativePrompt,
      seed,
      renderingSpeed,
      styleType,
      expandPrompt,
      // Pass lora_version + lora_trigger through to ReplicateImageProvider.buildInput.
      // Values resolved server-side from the character row (see top of handler).
      extraParams: resolvedLora
        ? { lora_version: resolvedLora.version, lora_trigger: resolvedLora.trigger }
        : undefined,
      baseImageUrl,
      maskUrl,
      strength,
      guidanceScale,
      usageLogId,
    })

    return { jobId: job.id }
  })
}
