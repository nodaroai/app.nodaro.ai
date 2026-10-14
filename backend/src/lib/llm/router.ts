/**
 * Lane routing for `llmComplete` / `llmStream`: pins, registry preferences and fallback.
 */

import { effectiveReasoningEffort, type LlmModelDef } from "@nodaro/shared/llm-models"
import { config } from "../config.js"
import type { LlmServingLane } from "../pricing/llm-cost.js"
import { callGeminiDirect as callGeminiDirectUnguarded, streamGeminiDirect as streamGeminiDirectUnguarded } from "../gemini/client.js"
import { guardLaneAccount } from "../llm-errors.js"
import { deriveParams, resolveModel } from "./params.js"
import { callKie, streamKie } from "./kie-lane.js"
import { callAnthropicDirect, streamAnthropicDirect } from "./anthropic-lane.js"
import { kieFallback, laneFallbackAllowed, serveFromFallback, streamWithFallback, withFallback } from "./lane-fallback.js"
import {
  exhaustionKieFallback,
  exhaustionKieStreamFallback,
  serveIfDirectLatched,
  streamWithExhaustionFallback,
  withExhaustionFallback,
} from "./exhaustion-fallback.js"
import { noLlmProviderError } from "./provider-unavailable.js"
import type { LlmRequest, LlmResponse } from "./types.js"

// KIE Claude-proxy passthrough facts. When false, the affected request class
// routes direct-Anthropic instead of through KIE.
// KIE's Claude proxy accepts `thinking` / `output_config.effort` and IGNORES
// them — measured 2026-10-08 on a reasoning-heavy prompt across Sonnet 5.5,
// Opus 5.5 and Sonnet 4.6: `low`, `max` and no effort gave the same output
// length (±15%), and no thinking block came back even at `max`. So an
// effort-carrying Claude call is served direct, and bills that way: the
// registry marks these models `effortRequiresDirect`, which `llmServesDirect`
// (@nodaro/shared) turns into the credit rung.
const KIE_CLAUDE_EFFORT_VERIFIED = false
// Forced tool_choice DOES reach the model, but the response is NOT a tool_use
// block: KIE re-serializes the call into a `<tool_calls>` text pseudo-tag with
// malformed JSON (live-captured 2026-07-14 — the 2026-07-13 "verified" only
// checked the call arrived, not the response shape; it broke every structured
// call routed via KIE, e.g. the generate-video-pro planner). callKieMessages
// decodes the pseudo-tag via extractKieToolCallInput and THROWS when a
// structured response carries no decodable payload, so llmComplete falls back
// to the direct SDK instead of burning the parse+retry loop on garbage.
const KIE_CLAUDE_TOOLS_VERIFIED = true

// ---------------------------------------------------------------------------
// Main entry points
// ---------------------------------------------------------------------------

/**
 * How many provider lanes ONE `llmComplete` call can spend before it gives up.
 *
 * `llmComplete` never tries more than a primary and a single fallback
 * (`withFallback`, and the Claude `preferKie` catch below that does the same by
 * hand) — and each lane is bounded by the SAME `effectiveTimeout(req)`, read
 * fresh when that lane starts. So the wall-clock budget of one call is this
 * many timeouts, not one, and anything sizing a deadline around a call (the
 * reconciliation staleness threshold does) has to multiply by it.
 */
export const LLM_MAX_LANES_PER_CALL = 2

export async function llmComplete(req: LlmRequest): Promise<LlmResponse> {
  const model = resolveModel(req)
  assertInlineVideoLane(req, model)

  // A pinned lane wins over every registry preference below, and never falls back.
  if (req.requireLane) {
    assertLanePinnable(model, req.requireLane)
    if (req.requireLane === "kie") return callKie(model, req)
    // A direct pin never falls back — except from a platform-account refusal,
    // which is retried once on KIE serving the same model (exhaustionKieFallback).
    return withExhaustionFallback(
      { modelId: model.id, primary: model.directGeminiModel ? "direct-gemini (pinned)" : "direct-anthropic (pinned)", fallback: "kie" },
      model.directGeminiModel ? "google" : "anthropic",
      () => model.directGeminiModel
        ? callGeminiDirect(model, req, deriveParams(model, req))
        : callAnthropicDirect(model, req),
      exhaustionKieFallback(model, req),
    )
  }

  if (model.directFallbackModel && config.ANTHROPIC_API_KEY) {
    if (!model.preferKie || claudeMustServeDirect(model, req) || !config.KIE_API_KEY) {
      // Direct is the primary lane here, but it is not incident-free — Anthropic
      // logged four elevated-error incidents across 2026-08-04/05, two of them
      // naming Opus 5. `callKieMessagesCollapsed` is a genuine second lane
      // (KIE's streaming wire works even while its non-streaming one 500s), so
      // an Anthropic wobble degrades instead of hard-failing.
      const ctx = { modelId: model.id, primary: "direct-anthropic", fallback: "kie" }
      return serveIfDirectLatched(ctx, "anthropic", exhaustionKieFallback(model, req)) ??
        withFallback(ctx, () => callAnthropicDirect(model, req), kieFallback(model, req))
    }
    try {
      return await callKie(model, req)
    } catch (err) {
      if (!laneFallbackAllowed(err)) throw err
      // KIE proxy failure — the direct SDK is the reliability backstop.
      return serveFromFallback(
        { modelId: model.id, primary: "kie", fallback: "direct-anthropic" },
        err,
        () => callAnthropicDirect(model, req),
      )
    }
  }

  if (geminiDirectAvailable(model)) {
    return model.preferDirect
      ? withFallback(
          { modelId: model.id, primary: "direct-gemini", fallback: "kie" },
          () => callGeminiDirect(model, req, deriveParams(model, req)),
          kieFallback(model, req),
        )
      : withFallback(
          { modelId: model.id, primary: "kie", fallback: "direct-gemini" },
          () => callKie(model, req),
          () => callGeminiDirect(model, req, deriveParams(model, req)),
        )
  }

  if (config.KIE_API_KEY) {
    return callKie(model, req)
  }

  throw await noLlmProviderError(model)
}

/**
 * Inline video bytes are servable by ONE lane, so the request must say so.
 *
 * Runs before any lane is chosen — and therefore before any provider request,
 * any token is spent and any usage is metered — so an unservable call costs
 * nothing and fails with an operator-actionable sentence instead of being
 * mangled into whatever the chosen lane happens to accept.
 *
 * Why a PIN and not "route it direct for them": on a Gemini model an unpinned
 * call is still eligible for a KIE leg (primary for the KIE-first models,
 * fallback for the direct-first ones), and neither leg can carry bytes. The
 * failure that produces is the bad kind — a fallback that answers HTTP 200
 * about media it never received. Requiring `requireLane: "direct"` removes
 * every other leg from the call, which is the only way this is total.
 *
 * `assertLanePinnable` then rejects the wrong MODEL FAMILY on the same pin: a
 * Claude or GPT model has no `directGeminiModel`, so pinning it direct throws
 * there rather than reaching a builder that would have to drop the block.
 */
export function assertInlineVideoLane(req: LlmRequest, model: LlmModelDef): void {
  for (const message of req.messages) {
    if (typeof message.content === "string") continue
    if (!message.content.some((b) => b.type === "video_base64")) continue
    if (req.requireLane === "direct") {
      // The direct lane exists for Claude too now, but only Google carries
      // inline video bytes — refuse before any provider request is made.
      if (model.directGeminiModel) return
      throw new Error(
        `Model ${model.id} is pinned to the direct lane but declares no directGeminiModel — ` +
          `a video_base64 block is carried only by the direct Google lane`,
      )
    }
    throw new Error(
      `llm-client: a video_base64 block requires requireLane: "direct" (the direct Google lane is the only one that ` +
        `carries inline video bytes; this call is ${req.requireLane ? `pinned to "${req.requireLane}"` : "unpinned"})`,
    )
  }
}

/**
 * Fail a lane pin loudly at the call site rather than quietly serving it from
 * the other lane. Both failure modes are configuration errors, and both are
 * things an operator can fix from the message alone — which is the whole
 * reason this throws instead of degrading.
 */
function assertLanePinnable(model: LlmModelDef, lane: LlmServingLane): void {
  if (lane === "direct") {
    if (!model.directGeminiModel && model.directFallbackModel) {
      if (!config.ANTHROPIC_API_KEY) {
        throw new Error(
          `Model ${model.id} is pinned to the direct lane but ANTHROPIC_API_KEY is not set — ` +
            `set it in the environment (Railway: staging AND production)`,
        )
      }
      return
    }
    if (!model.directGeminiModel) {
      throw new Error(
        `Model ${model.id} is pinned to the direct lane but declares no directGeminiModel or directFallbackModel — ` +
          `pick a Gemini or Claude model (see packages/shared/src/llm-models.ts)`,
      )
    }
    if (!config.GEMINI_API_KEY) {
      throw new Error(
        `Model ${model.id} is pinned to the direct lane but GEMINI_API_KEY is not set — ` +
          `set it in the environment (Railway: staging AND production)`,
      )
    }
    return
  }
  if (!config.KIE_API_KEY) {
    throw new Error(`Model ${model.id} is pinned to the KIE lane but KIE_API_KEY is not set`)
  }
}

/** The direct Google lane is usable when the registry names a Gemini model id
 *  for this entry AND a key is configured. Both halves are required — a model
 *  with no `directGeminiModel` stays on KIE no matter what is in the env. */
function geminiDirectAvailable(model: LlmModelDef): boolean {
  return Boolean(model.directGeminiModel) && Boolean(config.GEMINI_API_KEY)
}

/**
 * A Claude call KIE cannot honour, so it is served direct even unpinned: one
 * carrying a reasoning effort (KIE ignores it — see KIE_CLAUDE_EFFORT_VERIFIED;
 * `llmServesDirect` bills the same call one rung up), or a structured call
 * while KIE's tool passthrough is unverified. Direct is still only the
 * PRIMARY lane here: a direct failure falls back to KIE.
 */
export function claudeMustServeDirect(model: LlmModelDef, req: LlmRequest): boolean {
  const eff = effectiveReasoningEffort(model.id, req.reasoningEffort)
  return (
    (eff !== undefined && !KIE_CLAUDE_EFFORT_VERIFIED) ||
    (req.jsonSchema !== undefined && model.structuredOutputMode === "anthropic-tool" && !KIE_CLAUDE_TOOLS_VERIFIED)
  )
}

// ---------------------------------------------------------------------------
// Lane adapters, guarded: a platform-account refusal is typed at the lane
// ---------------------------------------------------------------------------

/*
 * Every lane adapter is reached ONLY through these wrappers, so a refusal of
 * the platform's own account (balance/quota gone, key refused —
 * `llm-platform-exhaustion.ts`) is an `LlmPlatformExhaustedError` on every
 * path: the person reads the capacity sentence, never the vendor's reply, and
 * the routing below can tell it from any other failure.
 */

// The KIE and direct-Anthropic wrappers live beside their adapters (./kie-lane.ts,
// ./anthropic-lane.ts); the direct Google ones are here.

type GeminiParams = Parameters<typeof callGeminiDirectUnguarded>[2]

function callGeminiDirect(model: LlmModelDef, req: LlmRequest, params: GeminiParams): Promise<LlmResponse> {
  return guardLaneAccount({ lane: "direct", provider: "google", modelId: model.id }, () => callGeminiDirectUnguarded(model, req, params))
}

function streamGeminiDirect(
  model: LlmModelDef, req: LlmRequest, params: GeminiParams, onToken: (chunk: string) => void, signal?: AbortSignal,
): Promise<LlmResponse> {
  return guardLaneAccount(
    { lane: "direct", provider: "google", modelId: model.id },
    () => streamGeminiDirectUnguarded(model, req, params, onToken, signal),
  )
}

export async function llmStream(
  req: LlmRequest,
  onToken: (chunk: string) => void,
  signal?: AbortSignal,
): Promise<LlmResponse> {
  const model = resolveModel(req)
  assertInlineVideoLane(req, model)

  // A pinned lane wins over every registry preference below, and never falls back.
  if (req.requireLane) {
    assertLanePinnable(model, req.requireLane)
    if (req.requireLane === "kie") return streamKie(model, req, onToken, signal)
    return streamWithExhaustionFallback(
      { modelId: model.id, primary: model.directGeminiModel ? "direct-gemini stream (pinned)" : "direct-anthropic stream (pinned)", fallback: "kie stream" },
      model.directGeminiModel ? "google" : "anthropic",
      (cb) => model.directGeminiModel
        ? streamGeminiDirect(model, req, deriveParams(model, req), cb, signal)
        : streamAnthropicDirect(model, req, cb, signal),
      exhaustionKieStreamFallback(model, req, signal),
      onToken,
    )
  }

  if (model.directFallbackModel && config.ANTHROPIC_API_KEY) {
    // A streamed tool call is read on the KIE path too (parseSseStream collects
    // its `input_json_delta` fragments), so a structured stream no longer has
    // to go direct — only what KIE cannot honour does.
    if (!model.preferKie || claudeMustServeDirect(model, req) || !config.KIE_API_KEY) {
      return streamWithExhaustionFallback(
        { modelId: model.id, primary: "direct-anthropic stream", fallback: "kie stream" },
        "anthropic",
        (cb) => streamAnthropicDirect(model, req, cb, signal),
        exhaustionKieStreamFallback(model, req, signal),
        onToken,
      )
    }
    // Fall back only if KIE fails BEFORE any token reached the caller — after
    // that the stream is tainted and the error must surface.
    let emitted = false
    const wrapped = (chunk: string) => { emitted = true; onToken(chunk) }
    try {
      return await streamKie(model, req, wrapped, signal)
    } catch (err) {
      if (emitted || !laneFallbackAllowed(err)) throw err
      return serveFromFallback(
        { modelId: model.id, primary: "kie", fallback: "direct-anthropic" },
        err,
        () => streamAnthropicDirect(model, req, onToken, signal),
      )
    }
  }

  if (geminiDirectAvailable(model)) {
    const direct = (cb: (chunk: string) => void) =>
      streamGeminiDirect(model, req, deriveParams(model, req), cb, signal)
    const kie = config.KIE_API_KEY ? (cb: (chunk: string) => void) => streamKie(model, req, cb, signal) : undefined
    return model.preferDirect
      ? streamWithFallback({ modelId: model.id, primary: "direct-gemini", fallback: "kie" }, direct, kie, onToken)
      : streamWithFallback(
          { modelId: model.id, primary: kie ? "kie" : "direct-gemini", fallback: "direct-gemini" },
          kie ?? direct,
          kie ? direct : undefined,
          onToken,
        )
  }

  if (config.KIE_API_KEY) {
    return streamKie(model, req, onToken, signal)
  }

  // Same typed, lane-aware sentence as llmComplete — the stream routes' SSE
  // error event and the sync routes' 503 read one shape.
  throw await noLlmProviderError(model)
}
