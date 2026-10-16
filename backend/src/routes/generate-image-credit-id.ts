/**
 * The credit CHECK of POST /v1/generate-image — the identifier the guard
 * reserves on — kept apart from the route module so a pricing caller (the
 * UGC quote prices an image call the way the route will) reaches it without
 * loading the route's handler, queue, credit guard and batch replay. The
 * route imports these and re-exports `resolveImageCreditIdentifier`.
 */
import type { FastifyRequest } from "fastify"
import { config } from "../lib/config.js"
import { rawImageBatchOf } from "../lib/image-batch.js"
import { presetFanOutBodies } from "../lib/presets/generate-image-preset-hook.js"
import { userDirectionOf, type ResolvedUserDirection } from "../lib/user-direction.js"
import { FLUX_LORA_CHARACTER_MODEL_ID } from "@nodaro/shared/models"
import { resolveNormalizedImageGen } from "@nodaro/shared/credits"
import { defaultImageModel } from "@nodaro/shared/model-catalog"
import { assembledRefCountForPricing, isStructuredImageMode } from "./generate-image-plan.js"

/**
 * The credit-CHECK model-identifier resolver (preHandler side). Extracted as a
 * named export so the CHECK===DEBIT billing-parity test can run the EXACT
 * pricing the live preHandler runs — every route test mocks `creditGuard` to a
 * no-op, so this closure would otherwise never execute. The handler's DEBIT
 * identifier (`modelIdentifier` in routes/generate-image.ts) is computed at a SEPARATELY-WRITTEN site;
 * the test asserts the two stay byte-identical for the same body across the
 * ref-count cases (see __tests__/generate-image.test.ts). Keep this in lock-step
 * with the handler's reservation identifier.
 */
export function resolveImageCreditIdentifier(req: FastifyRequest): string {
  const body = req.body as Record<string, unknown>
  // A fan-out names no `provider`: the single identifier the guard also asks
  // about is its first model's (the batch itself is `batchIdentifiers`).
  const first = rawImageBatchOf(body)?.models?.[0]
  return modelCreditIdentifier(req, body, first)
}

/**
 * One model's identifier: from the preset's own request for it when a preset
 * was applied per model (`presetFanOutBodies`), else from the body on `model`.
 */
export function modelCreditIdentifier(req: FastifyRequest, body: Record<string, unknown>, model: string | undefined): string {
  const presetBody = model !== undefined ? presetFanOutBodies(req)?.get(model) : undefined
  // The caller's palette / moodboard, resolved by `userDirectionPreHandler`
  // ahead of this guard: a moodboard's images count as references here
  // exactly as they will in the handler's DEBIT.
  const userDirection = userDirectionOf(req)
  return presetBody
    ? imageCreditIdentifierFor(presetBody, undefined, userDirection)
    : imageCreditIdentifierFor(body, model, userDirection)
}

/**
 * The credit identifier of one image of `body` — on `model` when given (one
 * model of a fan-out), else on the body's own `provider` / default.
 */
export function imageCreditIdentifierFor(
  body: Record<string, unknown>,
  model: string | undefined,
  userDirection: ResolvedUserDirection | undefined,
): string {
  // Character LoRA single-node Run hint — runs BEFORE Zod, so credits
  // reserve as flux-lora-character (3cr) instead of the default nano-banana
  // (2cr). Without this short-circuit, the preHandler would silently
  // under-bill by 1cr per LoRA inference. Mirrors the kill-switch gate
  // in the route handler (routes/generate-image.ts) — when routing is disabled, fall through to the
  // default identifier so the handler and the preHandler agree.
  if (
    body &&
    typeof body === "object" &&
    "_internalLora" in body &&
    config.CHARACTER_LORA_ROUTING_ENABLED
  ) {
    return FLUX_LORA_CHARACTER_MODEL_ID
  }
  // One model of a fan-out is assembled AS that model: the reference gate
  // inside the assembler is per provider, so the ref count (a pricing input)
  // can differ model to model.
  const pricedBody = model !== undefined ? { ...body, provider: model } : body
  const rawProvider = model ?? (body?.provider as string) ?? defaultImageModel("general", body?.aspectRatio as string | undefined)
  const flatRefs = body?.referenceImageUrls as string[] | undefined
  // Read the levers RAW — this preHandler runs before Zod, so any of them can
  // be a non-string. `resolveNormalizedImageGen` coerces defensively.
  const aspectRatio = body?.aspectRatio
  const quality = body?.quality
  const resolution = body?.resolution
  const renderingSpeed = body?.renderingSpeed

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
    describedReferences?: unknown
    direction?: unknown
    subject?: unknown
    structured?: unknown
  })
  const refCount = structured
    ? assembledRefCountForPricing(pricedBody as Parameters<typeof assembledRefCountForPricing>[0], userDirection)
    : (flatRefs?.length ?? 0)

  // Shared reference-aware builder: mirrors the handler's T2I→I2I auto-swap
  // (triggered by refs being attached — in structured mode the ASSEMBLED count,
  // so a wired character with no @-mention contributes zero refs and does not
  // swap) and encodes the per-ref Flux 2 tier. The SAME helper drives the
  // workflow orchestrator (payload-builder.ts), so single-node and DAG runs
  // reserve identical credits.
  // The catalog snap runs HERE, inside the CHECK, because `resolution` and
  // `quality` are pricing dimensions — a snap applied only in the handler would
  // break CHECK === DEBIT (see `resolveNormalizedImageGen`'s docstring).
  // `aspectRatio` is threaded too: it does not price on its own, but the
  // cross-field rules (gpt-image-2 `auto` → 1K) re-price through it.
  return resolveNormalizedImageGen({
    provider: rawProvider,
    aspectRatio,
    quality,
    resolution,
    renderingSpeed,
    refCount,
    swapToI2i: true,
  }).identifier
}
