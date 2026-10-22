/**
 * Lane routing for `llmComplete` / `llmStream`: pins, registry preferences and fallback.
 */

import type { LlmModelDef } from "@nodaro/shared/llm-models"
import { config } from "../config.js"
import type { LlmServingLane } from "../pricing/llm-cost.js"
import { callGeminiDirect as callGeminiDirectUnguarded, streamGeminiDirect as streamGeminiDirectUnguarded } from "../gemini/client.js"
import { guardLaneAccount } from "../llm-errors.js"
import { deriveParams, resolveModel } from "./params.js"
import { anthropicKeySet } from "./anthropic-availability.js"
import { callKie, streamKie } from "./kie-lane.js"
import { callAnthropicDirect, streamAnthropicDirect } from "./anthropic-lane.js"
import { kieFallback, streamWithDirectFallback, streamWithFallback, withDirectFallback, withFallback } from "./lane-fallback.js"
import {
  advancedModeRefusalOf,
  assertAdvancedModeServable,
  exhaustionKieFallback,
  exhaustionKieStreamFallback,
  serveIfDirectLatched,
  streamWithExhaustionFallback,
  withExhaustionFallback,
} from "./exhaustion-fallback.js"
import { noLlmProviderError } from "./provider-unavailable.js"
import type { LlmRequest, LlmResponse } from "./types.js"
import { claudeMustServeDirect } from "./claude-direct.js"

// The KIE Claude-proxy passthrough facts (`KIE_CLAUDE_EFFORT_VERIFIED`,
// `KIE_CLAUDE_TOOLS_VERIFIED`) and the rule built on them live in
// ./claude-direct.ts — a pure module, so billing can price the lane the router
// picks without loading the lanes.
export { claudeMustServeDirect }

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

  // A pinned lane wins over every registry preference below. It falls back only to KIE serving the same model, and only when the account behind it cannot serve: no Anthropic key (keylessClaudePin), or a platform-account refusal (exhaustionKieFallback). Never for Advanced mode, which is refused instead (assertAdvancedModeServable, advancedModeRefusalOf).
  if (req.requireLane) {
    assertAdvancedModeServable(model, req)
    if (keylessClaudePin(model, req)) {
      const kie = exhaustionKieFallback(model, req)
      if (kie) {
        warnKeylessPin(model)
        return kie()
      }
    }
    assertLanePinnable(model, req.requireLane)
    if (req.requireLane === "kie") return callKie(model, req)
    // Past the keyless branch, a direct pin falls back only from a platform-account refusal, retried once on KIE
    // serving the same model (exhaustionKieFallback) — never for Advanced mode, whose refusal is re-typed instead.
    try {
      return await withExhaustionFallback(
        { modelId: model.id, primary: model.directGeminiModel ? "direct-gemini (pinned)" : "direct-anthropic (pinned)", fallback: "kie" },
        model.directGeminiModel ? "google" : "anthropic",
        () => model.directGeminiModel
          ? callGeminiDirect(model, req, deriveParams(model, req))
          : callAnthropicDirect(model, req),
        exhaustionKieFallback(model, req),
      )
    } catch (err) {
      throw advancedModeRefusalOf(req, err)
    }
  }

  if (model.directFallbackModel && anthropicKeySet()) {
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
    // KIE proxy failure — the direct SDK is the reliability backstop (not
    // taken under `cheapLanesOnly`: the failure surfaces instead).
    return withDirectFallback(
      { modelId: model.id, primary: "kie", fallback: "direct-anthropic" },
      req,
      () => callKie(model, req),
      () => callAnthropicDirect(model, req),
    )
  }

  // Served on the vendor's own API and nowhere else: no KIE leg, primary or
  // fallback, and no key means provider-unavailable rather than KIE.
  if (model.directOnly) {
    if (!geminiDirectAvailable(model)) throw await noLlmProviderError(model)
    return callGeminiDirect(model, req, deriveParams(model, req))
  }

  if (geminiDirectAvailable(model)) {
    return model.preferDirect
      ? withFallback(
          { modelId: model.id, primary: "direct-gemini", fallback: "kie" },
          () => callGeminiDirect(model, req, deriveParams(model, req)),
          kieFallback(model, req),
        )
      : withDirectFallback(
          { modelId: model.id, primary: "kie", fallback: "direct-gemini" },
          req,
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
      if (!anthropicKeySet()) {
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
  if (model.directOnly) {
    throw new Error(`Model ${model.id} is served only on its direct lane (directOnly) — it cannot be pinned to KIE`)
  }
  if (!config.KIE_API_KEY) {
    throw new Error(`Model ${model.id} is pinned to the KIE lane but KIE_API_KEY is not set`)
  }
}

/**
 * A Claude call pinned to the direct lane on an install with no Anthropic key
 * (the key empty or blank). Served from KIE on the same registry model — the
 * leg a refused account gets (`exhaustionKieFallback`), so it is never built
 * for a call KIE cannot carry, nor (Advanced mode) for one that must not run
 * there. With no such leg the pin runs as before and `assertLanePinnable`
 * names the missing key.
 */
function keylessClaudePin(model: LlmModelDef, req: LlmRequest): boolean {
  return req.requireLane === "direct" && !model.directGeminiModel && Boolean(model.directFallbackModel) && !anthropicKeySet()
}

/** A missing key is a setting, not an event: said once per process, like the K2 line. */
let keylessPinWarned = false

function warnKeylessPin(model: LlmModelDef): void {
  if (keylessPinWarned) return
  keylessPinWarned = true
  console.warn(`[llm-lane-fallback] ${model.id}: pinned to the direct lane, but no Anthropic key is set — serving from KIE`)
}

/** Tests only: say the keyless-pin line again. */
export function __resetKeylessPinWarning(): void {
  keylessPinWarned = false
}

/** The direct Google lane is usable when the registry names a Gemini model id
 *  for this entry AND a key is configured. Both halves are required — a model
 *  with no `directGeminiModel` stays on KIE no matter what is in the env. */
function geminiDirectAvailable(model: LlmModelDef): boolean {
  return Boolean(model.directGeminiModel) && Boolean(config.GEMINI_API_KEY)
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

  // A pinned lane wins over every registry preference below. It falls back only to KIE serving the same model, and only when the account behind it cannot serve: no Anthropic key (keylessClaudePin), or a platform-account refusal (exhaustionKieFallback). Never for Advanced mode, which is refused instead (assertAdvancedModeServable, advancedModeRefusalOf).
  if (req.requireLane) {
    assertAdvancedModeServable(model, req)
    if (keylessClaudePin(model, req)) {
      const kie = exhaustionKieStreamFallback(model, req, signal)
      if (kie) {
        warnKeylessPin(model)
        return kie(onToken)
      }
    }
    assertLanePinnable(model, req.requireLane)
    if (req.requireLane === "kie") return streamKie(model, req, onToken, signal)
    // Past the keyless branch, as llmComplete: a refusal only, never for Advanced mode.
    try {
      return await streamWithExhaustionFallback(
        { modelId: model.id, primary: model.directGeminiModel ? "direct-gemini stream (pinned)" : "direct-anthropic stream (pinned)", fallback: "kie stream" },
        model.directGeminiModel ? "google" : "anthropic",
        (cb) => model.directGeminiModel
          ? streamGeminiDirect(model, req, deriveParams(model, req), cb, signal)
          : streamAnthropicDirect(model, req, cb, signal),
        exhaustionKieStreamFallback(model, req, signal),
        onToken,
      )
    } catch (err) {
      throw advancedModeRefusalOf(req, err)
    }
  }

  if (model.directFallbackModel && anthropicKeySet()) {
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
    // that the stream is tainted and the error must surface. Not taken under
    // `cheapLanesOnly`.
    return streamWithDirectFallback(
      { modelId: model.id, primary: "kie", fallback: "direct-anthropic" },
      req,
      (cb) => streamKie(model, req, cb, signal),
      (cb) => streamAnthropicDirect(model, req, cb, signal),
      onToken,
    )
  }

  if (model.directOnly) {
    if (!geminiDirectAvailable(model)) throw await noLlmProviderError(model)
    return streamGeminiDirect(model, req, deriveParams(model, req), onToken, signal)
  }

  if (geminiDirectAvailable(model)) {
    const direct = (cb: (chunk: string) => void) =>
      streamGeminiDirect(model, req, deriveParams(model, req), cb, signal)
    const kie = config.KIE_API_KEY ? (cb: (chunk: string) => void) => streamKie(model, req, cb, signal) : undefined
    if (model.preferDirect) {
      return streamWithFallback({ modelId: model.id, primary: "direct-gemini", fallback: "kie" }, direct, kie, onToken)
    }
    if (!kie) return direct(onToken)
    return streamWithDirectFallback({ modelId: model.id, primary: "kie", fallback: "direct-gemini" }, req, kie, direct, onToken)
  }

  if (config.KIE_API_KEY) {
    return streamKie(model, req, onToken, signal)
  }

  // Same typed, lane-aware sentence as llmComplete — the stream routes' SSE
  // error event and the sync routes' 503 read one shape.
  throw await noLlmProviderError(model)
}
