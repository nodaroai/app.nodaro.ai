/**
 * Planning one `POST /v1/generate-image` job on one model: structured
 * assembly, the final prompt, the catalog snap that prices it, the row it
 * records and the payload it sends. The SAME derivation serves a single call
 * and each model of a batch (`count` / `models`), so a fan-out prices, snaps
 * and reports each model exactly as a call naming it would. Split out of
 * generate-image.ts, which keeps the credit CHECK, the OpenAPI entry and the
 * handler.
 */
import type { FastifyBaseLogger } from "fastify"
import { buildJobInputData } from "../lib/job-input-data.js"
import { applySnappedLevers } from "../lib/image-gen-normalize.js"
import { sourceImageForAutoAspect } from "../lib/image-source-size.js"
import { aspectRatioForLoraModel, imageJobPhotoUrl } from "../lib/image-auto-aspect.js"
import { applyPromptPolicies } from "../lib/prompt-policy.js"
import { FLUX_LORA_CHARACTER_MODEL_ID, IMAGE_PROMPT_MAX } from "@nodaro/shared/models"
import { normalizedImageGenModelId, resolveNormalizedImageGen } from "@nodaro/shared/credits"
import { defaultImageModel, type ModelInputAdjustment } from "@nodaro/shared/model-catalog"
import { assembleImageInput, type AssembleImageInput } from "@nodaro/prompts/assembly"
import { REFERENCE_RULES, REFERENCE_RULES_MULTI_PERSON } from "@nodaro/prompts/doctrine"
import { backendHybridRoles } from "../lib/reference-format.js"
// The pure half of the user-direction module (no database client): the
// resolution's shape and the moodboard warning.
import { moodboardWarnings, type ResolvedUserDirection, type RunWarning } from "../lib/user-direction-result.js"
import { generateImageBody, type GenerateImageData } from "./generate-image-body.js"

const IDENTITY_PRESERVE_SUFFIX =
  "The subject must remain exactly the same person — preserve facial identity, eye color, hair color, skin tone, and unique features."

/**
 * WI-1b structured-mode detection. The route enters structured mode (server-side
 * assembly via `assembleImageInput`) when ANY of `connectedReferences` /
 * `direction` / `subject` / `structured` is present. When all are absent the
 * request takes the unchanged pre-assembled flat-prompt path.
 *
 * Accepts a loose shape so BOTH callers can share it: the preHandler (raw,
 * pre-Zod `req.body`) and the handler (Zod-parsed data). It only checks for
 * the presence of the four structured channels — which is why `subjectSchema`
 * normalizes an all-unknown bag to `{}` rather than dropping it: the two
 * callers must reach the same verdict for the same body.
 */
export function isStructuredImageMode(body: {
  connectedReferences?: unknown
  describedReferences?: unknown
  direction?: unknown
  subject?: unknown
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
    // Described references have no url, so they never reach the flat path's
    // reference channel — without this gate they would be silently dropped.
    (Array.isArray(body.describedReferences) && body.describedReferences.length > 0) ||
    (body.direction != null && typeof body.direction === "object") ||
    (body.subject != null && typeof body.subject === "object") ||
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
 *
 * `userDirection` is what `userDirectionPreHandler` resolved for this request
 * (the caller's palette / moodboard named in `direction`) — read by BOTH call
 * sites from the same request, because a moodboard's images are references
 * and the references price the run.
 */
export function buildAssembleInput(
  body: {
    prompt?: string
    provider?: string
    aspectRatio?: string
    connectedReferences?: AssembleImageInput["connectedReferences"]
    describedReferences?: AssembleImageInput["describedReferences"]
    referenceOrder?: AssembleImageInput["referenceOrder"]
    direction?: AssembleImageInput["direction"]
    subject?: AssembleImageInput["subject"]
    structured?: AssembleImageInput["structured"]
    referenceLock?: "standard" | "multi-person"
    referenceImageUrls?: string[]
    negativePrompt?: string
  },
  throwOnEmpty: boolean,
  userDirection: ResolvedUserDirection | undefined,
): AssembleImageInput {
  return {
    userPrompt: body.prompt ?? "",
    // Default provider mirrors the rest of the route — the credit check and the
    // handler pick it by aspect ratio — so the per-provider reference gate (and
    // a moodboard's free seats) resolve the same way at every call site.
    provider: body.provider ?? defaultImageModel("general", body.aspectRatio),
    // HYBRID IS THE DEFAULT everywhere (dev AND production). Test runs resolve
    // to legacy (route tests assert the legacy assembly), as does an explicit
    // IMAGE_REFERENCE_FORMAT=legacy. `backendHybridRoles()` IS that
    // determination — the video resolvers already gate on it, and it was
    // written to mirror this site, so calling it removes a two-site drift.
    ...(backendHybridRoles() ? { referenceFormat: "hybrid" as const } : {}),
    ...(body.connectedReferences !== undefined ? { connectedReferences: body.connectedReferences } : {}),
    ...(body.describedReferences !== undefined ? { describedReferences: body.describedReferences } : {}),
    ...(body.referenceOrder !== undefined ? { referenceOrder: body.referenceOrder } : {}),
    ...(body.direction !== undefined ? { direction: body.direction } : {}),
    // Carried by the SHARED builder, not by the handler alone: the pricing
    // preHandler and the handler must assemble the same input or the
    // CHECK===DEBIT invariant stops holding.
    ...(body.subject !== undefined ? { subject: body.subject } : {}),
    ...(body.structured !== undefined ? { structured: body.structured } : {}),
    // The lock TOKEN resolves to the measured constant HERE, server-side —
    // clients never carry the wording (see the schema comment).
    ...(body.referenceLock !== undefined
      ? {
          referenceLockSnippet:
            body.referenceLock === "multi-person" ? REFERENCE_RULES_MULTI_PERSON : REFERENCE_RULES,
        }
      : {}),
    // The flat `referenceImageUrls` doubles as `extraReferenceImageUrls` so it
    // rides the SAME per-provider reference gate + ordering as
    // `connectedReferences`.
    ...(body.referenceImageUrls !== undefined ? { extraReferenceImageUrls: body.referenceImageUrls } : {}),
    ...(body.negativePrompt !== undefined ? { negativePrompt: body.negativePrompt } : {}),
    // The caller's own palette / moodboard: clauses fold in their direction
    // rows; the moodboard's images fill only the seats the caller's own
    // references leave free.
    ...(userDirection !== undefined
      ? { directionRefs: userDirection.refs, styleReferences: userDirection.styleReferences }
      : {}),
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
export function assembledRefCountForPricing(
  body: {
    prompt?: string
    provider?: string
    aspectRatio?: string
    connectedReferences?: AssembleImageInput["connectedReferences"]
    describedReferences?: AssembleImageInput["describedReferences"]
    direction?: AssembleImageInput["direction"]
    subject?: AssembleImageInput["subject"]
    structured?: AssembleImageInput["structured"]
    referenceImageUrls?: string[]
    negativePrompt?: string
  },
  userDirection: ResolvedUserDirection | undefined,
): number {
  try {
    const result = assembleImageInput(buildAssembleInput(body, false, userDirection))
    return result.referenceImageUrls?.length ?? 0
  } catch {
    return body.referenceImageUrls?.length ?? 0
  }
}

/** What structured assembly produced for one model — or, on the flat path, the request's own prompt and refs. */
export interface AssembledImageRequest {
  /** Sent to the worker and recorded: the ASSEMBLED list in structured mode, the raw flat list (verbatim, incl. undefined) otherwise. */
  readonly queueReferenceImageUrls: string[] | undefined
  readonly basePrompt: string
  /** The native negative prompt in structured mode (the non-native one is folded into the prompt), the raw one otherwise. */
  readonly negativePrompt: string | undefined
  /** How many of a moodboard's images went as style references (structured mode only). */
  readonly styleReferencesSent: number | undefined
}

/**
 * WI-1b: structured mode. When `connectedReferences` / `direction` /
 * `structured` are present, assemble the flat prompt + reference URLs + native
 * negative prompt server-side via the shared `assembleImageInput` (the single
 * source of truth shared with the frontend `execute-node` and the backend
 * `payload-builder`). When ALL are absent we DO NOT touch the pre-assembled
 * flat path — the request behaves byte-identically to before. `throwOnEmpty`
 * makes an assembly that produces a truly-empty FINAL prompt throw → null → 400.
 * Assembled per MODEL: `data.provider` drives the per-provider reference gate
 * (and a moodboard's free seats). `userDirection` is the caller's palette /
 * moodboard, resolved before the credit guard (the resolution it priced on).
 */
export function assembleImageRequest(
  data: GenerateImageData,
  structuredMode: boolean,
  userDirection: ResolvedUserDirection | undefined,
): AssembledImageRequest | null {
  if (!structuredMode) {
    return { queueReferenceImageUrls: data.referenceImageUrls, basePrompt: data.prompt, negativePrompt: data.negativePrompt, styleReferencesSent: undefined }
  }
  try {
    const assembled = assembleImageInput(buildAssembleInput(data, true, userDirection))
    return {
      queueReferenceImageUrls: assembled.referenceImageUrls ?? [],
      basePrompt: assembled.prompt ?? data.prompt,
      negativePrompt: assembled.nativeNegativePrompt,
      styleReferencesSent: assembled.styleReferencesSent,
    }
  } catch {
    return null
  }
}


/** One image job, planned for one model: what it reserves, records and sends. */
export interface ImageJobPlan {
  /** The model the caller asked for. */
  readonly model: string
  readonly creditIdentifier: string
  readonly inputData: Record<string, unknown> & { type: string }
  /** The worker payload, minus `jobId` / `usageLogId`. */
  readonly queueData: Record<string, unknown>
  readonly adjustments: ModelInputAdjustment[]
  /** Something asked for that was not sent — a moodboard's images past the model's limit. */
  readonly warnings: RunWarning[]
}

/**
 * Plan one image job on `data.provider`: the final prompt, the catalog snap
 * that prices it, the row it records and the payload it sends. The SAME
 * derivation for a single call and for each model of a batch — so a fan-out
 * prices, snaps and reports each model exactly as a call naming it would.
 * Works on its own copy of `data` (the snap writes the levers back onto it).
 */
export async function planImageJob(args: {
  readonly data: GenerateImageData
  readonly assembled: AssembledImageRequest
  readonly resolvedLora: { version: string; trigger: string } | null
  readonly identityText: string | null
  readonly userDirection: ResolvedUserDirection | undefined
  readonly log: FastifyBaseLogger
}): Promise<ImageJobPlan> {
  const data: GenerateImageData = { ...args.data }
  const { resolvedLora } = args
  // The three catalog-governed levers are destructured as `raw*` on purpose:
  // `applySnappedLevers` below rewrites them on `data`, so these locals are the
  // caller's PRE-snap values and are only ever valid as INPUT to the
  // normalizer. Everything downstream reads `data.*`.
  const { provider, aspectRatio: rawAspectRatio, resolution: rawResolution, quality: rawQuality, characterDescriptions, seed, renderingSpeed, styleType, expandPrompt, baseImageUrl, maskUrl, strength, guidanceScale } = data
  // Reference URLs to use downstream. Two views, intentionally distinct:
  //   • `queueReferenceImageUrls` — the value sent to the worker + recorded in
  //     the job (see `AssembledImageRequest`).
  //   • `assembledRefs` — an always-array view used ONLY for the credit
  //     reservation refCount + the i2i auto-swap decision. Its `.length`
  //     equals `queueReferenceImageUrls?.length ?? 0` in BOTH modes, so the
  //     billed count always equals the count actually sent to the provider.
  const { queueReferenceImageUrls } = args.assembled
  const assembledRefs = queueReferenceImageUrls ?? []
  let effectiveNegativePrompt = args.assembled.negativePrompt

  // Append character descriptions to prompt. In structured mode the base is
  // the ASSEMBLED prompt (cinematic hints + structured fields + reference
  // directives + folded non-native negative prompt already composed by
  // `assembleImageInput`); otherwise the raw pre-assembled prompt. The
  // route-level `characterDescriptions` suffix + identity injection below
  // then layer on top in BOTH modes (unchanged behavior).
  const descSuffix = (characterDescriptions ?? []).map((d) => d).join(" ")
  let prompt = descSuffix ? `${args.assembled.basePrompt}\n${descSuffix}` : args.assembled.basePrompt

  // Identity injection — when enabled + a character is referenced, append the
  // canonical description plus an identity-preserve suffix to the prompt. Off
  // by default; the user must explicitly opt in per Character node (see
  // CharacterNodeData.injectIdentityInPrompts).
  if (args.identityText) {
    prompt = `${prompt.trim()}\n\n${args.identityText}\n\n${IDENTITY_PRESERVE_SUFFIX}`
    if (prompt.length > IMAGE_PROMPT_MAX) {
      args.log.warn(
        { characterId: data.attachToCharacterId, finalPromptLength: prompt.length },
        "[generate-image] character context injection produced a long prompt; consider trimming canonicalDescription",
      )
    }
  }

  // B4b: apply any registered PromptPolicy to the server-authoritative final
  // image prompt + native negative (covers BOTH structured assembly and the
  // legacy verbatim path — the legacy branch skips `assembleImageInput`, so a
  // structured-only hook would be bypassable). No policy registered = identity,
  // so mainline is byte-identical.
  {
    const _pp = applyPromptPolicies({
      prompt,
      negativePrompt: effectiveNegativePrompt ?? "",
      kind: "image",
    })
    prompt = _pp.prompt
    effectiveNegativePrompt = _pp.negativePrompt || undefined
  }

  // Determine model identifier for credit reservation (composite for variable pricing).
  // Must mirror the preHandler's identifier — flux-2-max bills per reference image,
  // so refCount drives the `:Nref` suffix the model_pricing row expects. We price
  // on the ASSEMBLED ref count (`assembledRefs.length`) — the exact array sent to
  // the worker below — so the DEBIT can never under/over-bill relative to what the
  // provider actually receives. In the flat path `assembledRefs === referenceImageUrls`,
  // so this is byte-identical to the previous `referenceImageUrls?.length`.
  // Same call the preHandler CHECK made, on the ASSEMBLED ref count. It
  // returns both the identifier AND the snapped levers, so the credits we
  // reserve and the parameters we send the provider come from ONE derivation.
  //
  // "auto" on a model without a native auto keeps the photo's shape: the first
  // image this job sends its provider (`imageJobPhotoUrl` — the inpaint /
  // refine base, else the first assembled reference, what the T2I→I2I swap
  // sends) is read for its size, only in that case, and never on a LoRA run
  // (it sends no photo). The probe asks about the model the snap runs against
  // (`normalizedImageGenModelId`). The CHECK ran before the size was known and
  // priced the same tier — the ratio is not a pricing dimension on any such
  // model (pinned in @nodaro/shared). No photo: "auto" snaps as it always has.
  const sourceImage = resolvedLora
    ? undefined
    : await sourceImageForAutoAspect(
        normalizedImageGenModelId({ provider, refCount: assembledRefs.length, swapToI2i: true }),
        rawAspectRatio,
        imageJobPhotoUrl({ baseImageUrl, referenceImageUrls: queueReferenceImageUrls }),
      )
  const normalized = resolveNormalizedImageGen({
    // Pass the RAW provider — the shared helper decides the T2I→I2I swap
    // (keyed on the assembled ref count) and its `modelId` is the model the
    // job is sent to below, so the model sent, this DEBIT, the preHandler
    // CHECK and the workflow orchestrator all come from one decision.
    provider,
    aspectRatio: rawAspectRatio,
    quality: rawQuality,
    resolution: rawResolution,
    renderingSpeed,
    refCount: assembledRefs.length,
    swapToI2i: true,
    sourceImage,
  })
  const creditIdentifier = resolvedLora ? FLUX_LORA_CHARACTER_MODEL_ID : normalized.identifier

  // Write the snapped levers back onto this plan's copy — `input_data` and the
  // queue payload below both read from it, so what we persist and what we
  // send the provider are the values we just priced. The LoRA path runs a
  // trained Replicate model with no catalog entry, so its levers stay as the
  // caller sent them — except "auto", which that model cannot take and
  // `aspectRatioForLoraModel` omits (the model then draws its default).
  if (!resolvedLora) applySnappedLevers(data, normalized, generateImageBody)
  else if (aspectRatioForLoraModel(data.aspectRatio) === undefined) data.aspectRatio = undefined

  // A moodboard whose images did not all fit (the model's reference limit,
  // after the caller's own) says so — on the response and on the job. The
  // trained-character model sends no reference at all.
  const warnings = moodboardWarnings(
    args.userDirection,
    resolvedLora ? 0 : args.assembled.styleReferencesSent,
    resolvedLora ? FLUX_LORA_CHARACTER_MODEL_ID : (provider ?? normalized.modelId),
  )

  return {
    model: provider ?? defaultImageModel("general", data.aspectRatio),
    creditIdentifier,
    adjustments: resolvedLora ? [] : normalized.adjustments,
    warnings,
    // `direction` keeps a palette / moodboard as its id (`palette:<id>`),
    // never the resolved text, so a re-run resolves it again.
    inputData: {
      ...buildJobInputData(data, "generate-image"),
      prompt,
      ...(warnings.length > 0 ? { warnings } : {}),
    },
    queueData: {
      prompt,
      // LoRA path: trained model + trigger word carry identity — emit zero refs.
      // Otherwise the ASSEMBLED refs in structured mode, or the RAW flat refs
      // (preserved verbatim, incl. undefined) in the non-structured path.
      referenceImageUrls: resolvedLora ? [] : queueReferenceImageUrls,
      // LoRA runs the synthetic flux-lora-character model (Replicate, trained
      // version), bypassing auto-routing. Otherwise the model the levers were
      // snapped and priced against: with references attached, a text-to-image
      // model's image-to-image sibling, since the T2I endpoints take no image
      // input. The trigger is the ASSEMBLED list — a plain prompt plus a
      // reference still edits, no `{image:N}` mention needed, while a wired
      // character with no @-mention contributes no ref and does not swap.
      // Models that consume refs in their T2I call (nano-banana, the Replicate
      // "Open" models) have no sibling and pass through unchanged.
      provider: resolvedLora ? FLUX_LORA_CHARACTER_MODEL_ID : normalized.modelId,
      // Hand the synthetic flux-lora-character model id to the Replicate provider.
      model: resolvedLora ? FLUX_LORA_CHARACTER_MODEL_ID : undefined,
      // Read through `data`, NOT the `raw*` locals above: those still hold the
      // caller's pre-snap values.
      aspectRatio: data.aspectRatio,
      resolution: data.resolution,
      quality: data.quality,
      // Structured mode: only the NATIVE negative prompt rides this channel
      // (the non-native one is folded into `prompt`). Flat mode: the raw
      // negative prompt, unchanged.
      negativePrompt: effectiveNegativePrompt,
      seed,
      renderingSpeed,
      styleType,
      expandPrompt,
      // Pass lora_version + lora_trigger through to ReplicateImageProvider.buildInput.
      // Values resolved server-side from the character row (see the handler).
      extraParams: resolvedLora
        ? { lora_version: resolvedLora.version, lora_trigger: resolvedLora.trigger }
        : undefined,
      baseImageUrl,
      maskUrl,
      strength,
      guidanceScale,
    },
  }
}
