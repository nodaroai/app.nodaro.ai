/**
 * Unified LLM client — routes requests through KIE.ai with Anthropic SDK fallback.
 *
 * Supports three KIE.ai API formats:
 * - chat-completions (Gemini, GPT-5.2): POST /{slug}/v1/chat/completions
 * - messages (Claude models): POST /claude/v1/messages
 * - responses (GPT family, Grok): POST /{family}/v1/responses — codex for GPT,
 *   grok for Grok (see kieResponsesUrl)
 */

import type Anthropic from "@anthropic-ai/sdk"
import { config } from "./config.js"
import { describeEmptyCapability, type ProviderKeyName } from "../providers/provider-keys.js"
import { getLlmModel, LLM_FEATURE_DEFAULTS, effectiveReasoningEffort, reasoningOutputFloor } from "@nodaro/shared"
import type { LlmModelDef, LlmFeature, LlmReasoningEffort } from "@nodaro/shared"
import { calculateLlmCost, type LlmServingLane } from "./pricing/llm-cost.js"
import { getAnthropicClient } from "./anthropic.js"
import { callGeminiDirect, streamGeminiDirect } from "./gemini/client.js"
import {
  LlmOutputTruncatedError,
  LlmStreamResponseError,
  assertNotOutputCapped,
  isOutputCapStop,
  outputCappedMessage,
  type ReplyEnd,
} from "./llm-errors.js"
import { KIE_API_BASE } from "../providers/kie/client.js"
import { z, type ZodType } from "zod"
import { extractJsonFromAIResponse, extractKieToolCallInput } from "./json-utils.js"
import { restrictObjectSchemas } from "./json-schema-strict.js"

const LLM_TIMEOUT_MS = 120_000

// KIE Claude-proxy passthrough facts. When false, the affected request class
// routes direct-Anthropic instead of through KIE.
const KIE_CLAUDE_EFFORT_VERIFIED = false // thinking/output_config passthrough NOT verified — effort-carrying calls route direct
// KIE's Claude proxy answers HTTP 500 `{"type":"api_error","message":"Server
// exception, please try again later"}` to EVERY `stream: false` request, for
// EVERY Claude slug — measured 2026-08-06: 0/6 non-stream succeeded against
// claude-opus-5 while the identical body with `stream: true` passed 5/6, and a
// sweep of haiku-4-5 / sonnet-4-6 / opus-4-7 / sonnet-5 / opus-4-8 / opus-5 /
// fable-5 failed 14/14 non-stream. Auth is fine (a bad key returns a distinct
// 401 envelope) and the Gemini + GPT KIE lanes were healthy in the same run, so
// this is specific to the Claude proxy's non-streaming path.
//
// It is a MODEL-INDEPENDENT lane outage, which is why the fix is a lane flag
// and not a model swap: substituting opus-4.8 for opus-5 changes which model
// users get while failing at exactly the same rate.
//
// `llmComplete` is the non-streaming entry point, so this forces every
// non-streamed Claude call onto the direct SDK. `llmStream` is deliberately
// NOT gated — streaming is the shape that still works on KIE.
// Flip to `true` only after re-measuring non-stream success against KIE; it
// gates real spend (the direct lane bills ~2.5× the KIE row), not just a path.
const KIE_CLAUDE_NONSTREAM_VERIFIED = false
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
// Public types
// ---------------------------------------------------------------------------

export type LlmContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; url: string }
  | { type: "image_base64"; mediaType: string; data: string }
  | {
      type: "video"
      url: string
      mimeType?: string
      /**
       * Frame sampling rate. Gemini samples at 1 fps by default; this raises it,
       * and it is the only lever that gets a model MORE frames of the same clip.
       *
       * DIRECT LANE ONLY. KIE reaches Gemini through the `image_url`
       * URL-smuggling hack, which has nowhere to carry this, so `buildChat-
       * CompletionsMessages` THROWS on an fps-bearing block rather than quietly
       * analysing at 1 fps — a silent downgrade here is indistinguishable from
       * success and would mis-ground the analysis with no signal.
       *
       * Costs ~66 tokens per frame, so prompt tokens scale linearly in fps
       * (measured 2026-07-29 against a 640x360 clip: 3,274 prompt tokens at
       * fps 1, 8,026 at fps 3, 15,088 at fps 6, i.e. 66/frame + 25/sec of audio).
       */
      fps?: number
    }
  | {
      /**
       * Inline video BYTES — the exact clip, carried in the request itself.
       *
       * WHY BYTES AND NOT A URL: every other media block in this union is a
       * URL, because both lanes that carry media dereference one (KIE server
       * side, `gemini/media.ts` on our side). That is fine when the URL *is*
       * the asset's identity. It is wrong when a caller must analyse a
       * SPECIFIC, IMMUTABLE set of bytes it already holds: publishing the
       * user's media to reach the model is a privacy cost with no upside, and
       * a mutable or signed URL is not durable request identity — the object
       * behind it can change, expire, or 403 between the request being built
       * and the model reading it, and the analysis would silently describe
       * something else. Handing the bytes over closes both.
       *
       * DIRECT GOOGLE LANE ONLY, and the ONLY lane-pinned block in this union:
       * `llmComplete`/`llmStream` reject the whole request unless it carries
       * `requireLane: "direct"` (see {@link assertInlineVideoLane}). Nothing
       * else can carry it — KIE's chat-completions proxy smuggles media as an
       * `image_url` it dereferences itself (no bytes channel at all), and the
       * Claude `messages` / GPT `responses` lanes take no video input in any
       * form. Requiring the pin is what makes that TOTAL: an unpinned call on
       * a Gemini model would still be eligible for a KIE leg (primary or
       * fallback), so "it happened to route direct today" is not a guarantee.
       *
       * Bounded and validated before the request leaves the process —
       * `gemini/media.ts` enforces exact media type, canonical base64, MP4
       * `ftyp` magic and a 6 MiB RAW ceiling (see `INLINE_MAX_BYTES`; base64
       * inflates that 4/3 on the wire, staying well inside Google's ~20 MB
       * request limit). Anything larger belongs on the URL-bearing `video`
       * block, which streams to the Files API instead.
       */
      type: "video_base64"
      /** Exact, not a family: only `video/mp4` is accepted (validated). */
      mediaType: "video/mp4"
      /** Canonical base64 of the raw MP4 bytes — no data: prefix, no newlines. */
      data: string
      /** Frame sampling rate, identical semantics to the `video` block's `fps`. */
      fps?: number
    }
  | { type: "audio"; url: string; mimeType?: string }

export interface LlmMessage {
  role: "user" | "assistant"
  content: string | LlmContentBlock[]
}

export interface LlmRequest {
  modelId: string
  system: string
  messages: LlmMessage[]
  maxTokens?: number
  temperature?: number
  /** Nucleus-sampling cutoff (`top_p`). Passed through to the KIE body when set;
   *  a caller pins it (e.g. 1.0 to disable nucleus filtering) to avoid riding an
   *  unknown vendor default. Undefined → not sent. */
  topP?: number
  /**
   * Requested reasoning effort. Clamped to the model's declared levels
   * (`effectiveReasoningEffort`); undefined / unsupported → nothing is sent
   * and the vendor default applies.
   */
  reasoningEffort?: LlmReasoningEffort
  /** Feature name — used only for default model resolution */
  feature?: string
  /**
   * Per-request timeout override in milliseconds. Defaults to LLM_TIMEOUT_MS
   * (120s) when omitted, so existing callers are unchanged. Large structured
   * outputs (e.g. the Lottie motion-graphics worker) pass a higher value.
   */
  timeoutMs?: number
  /**
   * Allow a collapsed SSE adapter to restart a stream that failed BEFORE reporting any usage;
   * defaults to true. Set `false` to see the first failure immediately.
   *
   * This is a TRANSPORT policy and it is independent of `llmCompleteStructured`'s `maxRetries`,
   * which counts validation retries. A transport retry re-asks a question the provider never
   * answered and never billed; a validation retry re-asks one it DID answer, and pays again. A
   * call that reported usage is never retried here, whatever this field says. Serving-lane
   * fallback and vendor SDK retry settings are separate policies again.
   */
  retryStreamOnError?: boolean
  /**
   * Request schema-constrained output. The router enforces it natively where
   * the model supports it (Anthropic forced tool / Gemini `response_format`);
   * for models with no native mode the field is ignored and the caller's
   * parse+retry loop ({@link llmCompleteStructured}) is the guarantee. Prefer
   * calling {@link llmCompleteStructured} over setting this directly.
   */
  jsonSchema?: { name: string; schema: Record<string, unknown> }
  /**
   * Pin the serving lane for THIS call, overriding the model's registry
   * default — and disable fallback entirely.
   *
   * `"direct"` means direct-ONLY: no KIE leg, ever. Video-analysis uses this.
   * The point is that a silent fallback would be WORSE than an outage there —
   * KIE reaches Gemini through the `image_url` URL-smuggling hack rather than
   * real media parts, and its `response_format` drops record-shaped schema
   * fields, so a fallback run would quietly produce differently-grounded
   * analysis rather than fail. A hard error is the honest outcome.
   *
   * Pinning a model with no lane of that kind is a configuration error and
   * throws rather than degrading — see {@link assertLanePinnable}.
   */
  requireLane?: LlmServingLane
  /**
   * Reject the response unless the provider reports at least this many PROMPT
   * tokens. Set it when the request carries media the answer depends on.
   *
   * This exists because the proxied lane FAILS OPEN on media. Measured
   * 2026-07-31: of 7 KIE calls carrying a freshly-uploaded R2 video, 3 came
   * back reporting prompt tokens equal to the system prompt ALONE — the video
   * was never ingested — and answered with a fluent, schema-valid analysis of
   * a video that does not exist (a different invented one each time: a
   * programmer with a tabby cat, a starship pilot, a luxury-watch commercial).
   * Nothing downstream can catch that: the text is well-formed, the schema
   * validates, and a text-only grader cannot tell a confident fabrication from
   * the truth. The token count is the only honest signal, and only the caller
   * knows how much media it sent, so the floor is passed in rather than
   * guessed here.
   *
   * Enforced on all three KIE formats — that is the lane with the hazard, and
   * where `buildResponse` sees both the request and the reported usage. The
   * collapsed responses lane (`kieCollapseStream`) returns the stream parser's
   * own object instead of calling `buildResponse`, so it re-applies the guard
   * itself once the retry has resolved. It is
   * deliberately NOT wired into the direct lanes: `lib/gemini/media.ts` already
   * THROWS when media cannot be fetched, so an ungrounded answer is not
   * reachable there, and the direct-Anthropic paths carry no video at all.
   * Setting the field on a direct-pinned call is harmless and simply inert.
   */
  minPromptTokens?: number
}

export interface LlmResponse {
  text: string
  usage?: { inputTokens: number; outputTokens: number }
  model: string
  /** Estimated provider cost in USD based on token usage */
  providerCost?: number
}

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
  assertInlineVideoLane(req)

  // A pinned lane wins over every registry preference below, and never falls back.
  if (req.requireLane) {
    assertLanePinnable(model, req.requireLane)
    return req.requireLane === "direct"
      ? callGeminiDirect(model, req, deriveParams(model, req))
      : callKie(model, req)
  }

  if (model.directFallbackModel && config.ANTHROPIC_API_KEY) {
    const eff = effectiveReasoningEffort(model.id, req.reasoningEffort)
    const mustDirect =
      // KIE's Claude proxy 500s on every non-streaming request, and this is the
      // non-streaming entry point — so while that outage stands, NO Claude call
      // routed here can be served by KIE. Trying anyway just spends 6–12s on a
      // guaranteed 500 before the catch below reaches the same place.
      !KIE_CLAUDE_NONSTREAM_VERIFIED ||
      (req.jsonSchema !== undefined && model.structuredOutputMode === "anthropic-tool" && !KIE_CLAUDE_TOOLS_VERIFIED) ||
      (eff !== undefined && !KIE_CLAUDE_EFFORT_VERIFIED)
    if (!model.preferKie || mustDirect || !config.KIE_API_KEY) {
      // Direct is the primary lane here, but it is not incident-free — Anthropic
      // logged four elevated-error incidents across 2026-08-04/05, two of them
      // naming Opus 5. `callKieMessagesCollapsed` is a genuine second lane
      // (KIE's streaming wire works even while its non-streaming one 500s), so
      // an Anthropic wobble degrades instead of hard-failing.
      return withFallback(
        { modelId: model.id, primary: "direct-anthropic", fallback: "kie" },
        () => callAnthropicDirect(model, req),
        kieFallback(model, req),
      )
    }
    try {
      return await callKie(model, req)
    } catch (err) {
      if (!laneFallbackAllowed(err)) throw err
      // KIE proxy failure — the direct SDK is the reliability backstop.
      warnLaneFallback({ modelId: model.id, primary: "kie", fallback: "direct-anthropic" }, err)
      return callAnthropicDirect(model, req)
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
 * Nothing local can serve this model. Say which keys WOULD (KIE proxies every
 * model; Anthropic serves the Claude models directly, Gemini the Gemini ones)
 * and whether connecting nodaro.ai is an answer — the shared sentence shape
 * every other provider gap uses, so a self-hoster reads one shape everywhere.
 * Typed so a route can answer 503 provider_unavailable instead of a 500.
 */
export class LlmProviderUnavailableError extends Error {
  readonly code = "provider_unavailable"
  constructor(message: string) {
    super(message)
    this.name = "LlmProviderUnavailableError"
  }
}

export function isLlmProviderUnavailable(err: unknown): err is LlmProviderUnavailableError {
  return err instanceof LlmProviderUnavailableError
    || (typeof err === "object" && err !== null && (err as { code?: unknown }).code === "provider_unavailable")
}

async function noLlmProviderError(model: LlmModelDef): Promise<LlmProviderUnavailableError> {
  const candidates: ProviderKeyName[] = [
    "KIE_API_KEY",
    ...(model.directFallbackModel ? (["ANTHROPIC_API_KEY"] as const) : []),
    ...(model.directGeminiModel ? (["GEMINI_API_KEY"] as const) : []),
  ]
  // The connection covers the LLM routes (they proxy to the cloud), so
  // whether it is live decides the remedy the sentence offers.
  const connected = await import("./nodaro-connect.js")
    .then((m) => m.isNodaroConnected())
    .catch(() => false)
  return new LlmProviderUnavailableError(
    describeEmptyCapability(
      "LLM nodes",
      model.id,
      {
        REPLICATE_API_TOKEN: config.REPLICATE_API_TOKEN,
        KIE_API_KEY: config.KIE_API_KEY,
        ELEVENLABS_API_KEY: config.ELEVENLABS_API_KEY,
        ANTHROPIC_API_KEY: config.ANTHROPIC_API_KEY,
        GEMINI_API_KEY: config.GEMINI_API_KEY,
        FAL_KEY: config.FAL_KEY,
        HEYGEN_API_KEY: config.HEYGEN_API_KEY,
        BEEBLE_API_KEY: config.BEEBLE_API_KEY,
        APIFY_API_TOKEN: config.APIFY_API_TOKEN,
      },
      connected,
      candidates,
    ),
  )
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
function assertInlineVideoLane(req: LlmRequest): void {
  if (req.requireLane === "direct") return
  for (const message of req.messages) {
    if (typeof message.content === "string") continue
    if (!message.content.some((b) => b.type === "video_base64")) continue
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
    if (!model.directGeminiModel) {
      throw new Error(
        `Model ${model.id} is pinned to the direct lane but declares no directGeminiModel — ` +
          `pick a model with a direct Google lane (see packages/shared/src/llm-models.ts)`,
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

/** KIE as a fallback leg, or `undefined` when it isn't configured (in which
 *  case the primary lane's error must surface rather than be swallowed). */
function kieFallback(model: LlmModelDef, req: LlmRequest): (() => Promise<LlmResponse>) | undefined {
  return config.KIE_API_KEY ? () => callKie(model, req) : undefined
}

/** Which lane failed and which one is about to serve — for the fallback warn. */
interface LaneFallbackCtx {
  modelId: string
  primary: string
  fallback: string
}

/**
 * One greppable line per silently-recovered lane failure. Without it a chronic
 * primary-lane outage is invisible: every unpinned call quietly serves from the
 * other lane (at that lane's cost profile) and only lane-PINNED calls ever
 * surface the error — which is exactly how the 2026-08-14 direct-Gemini
 * `403 PERMISSION_DENIED` blip was diagnosable only through a pinned
 * video-analysis job. Warn, not error: the request is about to succeed.
 */
function warnLaneFallback(ctx: LaneFallbackCtx, err: unknown): void {
  const msg = err instanceof Error ? err.message : String(err)
  const head = msg.length > 300 ? `${msg.slice(0, 300)}…` : msg
  console.warn(
    `[llm-lane-fallback] ${ctx.modelId}: ${ctx.primary} lane failed, serving from ${ctx.fallback} — ${head}`,
  )
}

/**
 * May a failure on one lane be re-asked on the other? Not a cap stop: the
 * reply ran to the output cap, and that cap is the request's, not the lane's —
 * the other lane gets the SAME cap for the same prompt, so a fallback buys a
 * second billed full-length reply that most likely stops at the same place
 * (the direct Gemini lane reasons MORE than KIE's on the same input, #1588).
 * Every other failure keeps the fallback.
 */
function laneFallbackAllowed(err: unknown): boolean {
  return !(err instanceof LlmOutputTruncatedError)
}

/** Run `primary`, falling back to `secondary` on failure (warn-logged). With no
 *  secondary the original error propagates untouched. */
async function withFallback(
  ctx: LaneFallbackCtx,
  primary: () => Promise<LlmResponse>,
  secondary: (() => Promise<LlmResponse>) | undefined,
): Promise<LlmResponse> {
  if (!secondary) return primary()
  try {
    return await primary()
  } catch (err) {
    if (!laneFallbackAllowed(err)) throw err
    warnLaneFallback(ctx, err)
    return secondary()
  }
}

export async function llmStream(
  req: LlmRequest,
  onToken: (chunk: string) => void,
  signal?: AbortSignal,
): Promise<LlmResponse> {
  const model = resolveModel(req)
  assertInlineVideoLane(req)

  // A pinned lane wins over every registry preference below, and never falls back.
  if (req.requireLane) {
    assertLanePinnable(model, req.requireLane)
    return req.requireLane === "direct"
      ? streamGeminiDirect(model, req, deriveParams(model, req), onToken, signal)
      : streamKie(model, req, onToken, signal)
  }

  if (model.directFallbackModel && config.ANTHROPIC_API_KEY) {
    const eff = effectiveReasoningEffort(model.id, req.reasoningEffort)
    // streamed forced-tool output is not parsed on the KIE path — always take the direct SDK for structured streams
    const mustDirect =
      (req.jsonSchema !== undefined && model.structuredOutputMode === "anthropic-tool") ||
      (eff !== undefined && !KIE_CLAUDE_EFFORT_VERIFIED)
    if (!model.preferKie || mustDirect || !config.KIE_API_KEY) {
      return streamAnthropicDirect(model, req, onToken, signal)
    }
    // Fall back only if KIE fails BEFORE any token reached the caller — after
    // that the stream is tainted and the error must surface.
    let emitted = false
    const wrapped = (chunk: string) => { emitted = true; onToken(chunk) }
    try {
      return await streamKie(model, req, wrapped, signal)
    } catch (err) {
      if (emitted || !laneFallbackAllowed(err)) throw err
      warnLaneFallback({ modelId: model.id, primary: "kie", fallback: "direct-anthropic" }, err)
      return streamAnthropicDirect(model, req, onToken, signal)
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

/**
 * Streaming twin of {@link withFallback}. The extra rule: once a token has
 * reached the caller the stream is TAINTED — restarting on the other lane
 * would duplicate everything already emitted — so a mid-stream failure always
 * surfaces. Only a failure before the first token is recoverable.
 */
async function streamWithFallback(
  ctx: LaneFallbackCtx,
  primary: (onToken: (chunk: string) => void) => Promise<LlmResponse>,
  secondary: ((onToken: (chunk: string) => void) => Promise<LlmResponse>) | undefined,
  onToken: (chunk: string) => void,
): Promise<LlmResponse> {
  if (!secondary) return primary(onToken)
  let emitted = false
  try {
    return await primary((chunk) => { emitted = true; onToken(chunk) })
  } catch (err) {
    // A cap stop with no visible token (all of it reasoning) is still a cap stop.
    if (emitted || !laneFallbackAllowed(err)) throw err
    warnLaneFallback(ctx, err)
    return secondary(onToken)
  }
}

// ---------------------------------------------------------------------------
// Structured (schema-validated) completion
// ---------------------------------------------------------------------------

export interface StructuredLlmOutput<T> {
  output: T
  inputTokens: number
  outputTokens: number
  providerCost?: number
  /** Every attempt reported both token usage and cost. */
  usageComplete?: boolean
}

/** Known usage remains available when a later attempt fails or is malformed. */
export class StructuredLlmError extends Error {
  constructor(message: string, readonly usage: {
    inputTokens: number; outputTokens: number; providerCost?: number; complete: boolean
  }, options?: ErrorOptions) {
    super(message, options)
    this.name = "StructuredLlmError"
  }
}

// `LlmStreamResponseError` — the usage-carrying failure every rule below keys on
// — lives in ./llm-errors.ts with its `LlmOutputTruncatedError` subclass, so the
// direct Gemini lane can throw them too.
export { LlmOutputTruncatedError } from "./llm-errors.js"

/**
 * The transport-retry ladder: the pause before each EXTRA attempt at a failure that cost
 * nothing. Its length is the number of extra attempts (so 5 entries = 6 attempts in all).
 *
 * MEASURED 2026-09-14 (round 7g) against staging, KIE `codex/v1/responses` serving
 * `gpt-6-astra`: 4 of 21 POSTs in one four-hour window — 19% — came back
 * `503 {"error":{"type":"server_error","message":"Service temporarily unavailable"}}` in one to
 * three seconds, carrying no usage, on requests that were otherwise identical to the 17 that
 * answered. It is not a property of the request: the same 503 ended the 1.8 KB table brief's
 * job (ddb9251d) AND the 257-character suitcase brief's job (48595da9), the registry's own
 * 2026-09-06 probe measured 1 failure in 6 on this lane with a TINY body, and two of round 7g's
 * own eight probes 503'd on their first POST — one at 98,683 chars (the smallest request of the
 * round) and one at 165,000 (the largest), both answered by a retry 400 ms later. A request
 * rejected for its size does not become acceptable 400 ms later.
 *
 * ONE extra attempt at 400 ms was measured to be too short: staging job a37e5a64's planner call
 * 503'd, paused the 400 ms, and 503'd again — the pair 2 s apart — and the job died having
 * already paid for the authoring pass before it. So the ladder steps out past a short flap
 * instead of hitting the same wobble twice: 400 ms clears an instant one, 2 s and 6 s clear a
 * several-second one. 8.4 s is the whole added wait in the worst case, against a caller (the
 * Scene3D planner) whose own deadline is 360 s and whose job dies outright on the first
 * unanswered call.
 *
 * MEASURED AGAIN 2026-09-14 05:04:42–05:04:57Z (round 10a), staging job 7f109f4b, the edit
 * pass of the first Basic-lane scene to author end to end: the repair planner call failed FOUR
 * times in fifteen seconds — `upstream_error` frame, `500 "The server is currently being
 * maintained"`, `503 "Service temporarily unavailable"`, then the 500 again — every one before
 * any usage, so the whole 8.4 s ladder was spent inside one burst and the job died having paid
 * for pass 0. The six bursts the ladder met between 04:43Z and 05:05Z tell the shape: five
 * ended within one or two extra attempts (2.4 s), one outran 8.4 s. The failures on this lane
 * come in BURSTS of mixed shapes, not as independent 19% coin flips (four independent misses
 * would be 0.13%; one burst in six is what was seen). So the ladder gains a 15 s and a 30 s
 * step: 53.4 s of added wait in the worst case, still bounded by the caller's own deadline
 * (the Scene3D planner's is 360 s), and still free — none of these attempts reported usage.
 *
 * It does NOT try to ride out a real outage — minutes of `server_error` still surface, which is
 * the behaviour the Scene3D loop deliberately treats as terminal rather than burning three
 * queue attempts on.
 */
const LLM_TRANSPORT_RETRY_DELAYS_MS: readonly number[] = [400, 2_000, 6_000, 15_000, 30_000]

/**
 * May this failure be retried at the TRANSPORT level — i.e. did it cost nothing?
 *
 * The rule is one line and it is the whole safety property: **a call that reported usage is
 * never retried.** A failure that reported none (connection error, 5xx, an `event: error` frame
 * or a silent close before any usage arrived) spent nothing, so one more attempt is free; a
 * failure carrying usage is an {@link LlmStreamResponseError} and re-asking would double-pay.
 *
 * This is deliberately INDEPENDENT of `llmCompleteStructured`'s `maxRetries`, which counts
 * VALIDATION retries — re-asking a provider that already answered, and paying again for a
 * better-shaped answer. A caller that sets `maxRetries: 0` (the plugin host's structured calls
 * do, on purpose) is refusing to pay twice for a wrong answer; it is not asking to fail on a
 * 503 that cost nothing. Coupling the two, as this file did between 2026-09-08 and now, is
 * what left the Scene3D planner with no retry at all: measured 2026-09-13, a
 * `503 {"type":"server_error"}` and an `upstream_error … "The server is currently being
 * maintained"` frame, both with NO usage, each ending a paid job outright.
 *
 * `retryStreamOnError: false` is the explicit opt-out, for a caller that must see the first
 * failure immediately.
 */
function transportRetryable(err: unknown, req: LlmRequest): boolean {
  if (err instanceof LlmStreamResponseError) return false
  return req.retryStreamOnError !== false
}

/**
 * Run `once`, and on a failure that cost nothing run it again — up to
 * {@link LLM_TRANSPORT_RETRY_DELAYS_MS}`.length` more times, pausing longer before each.
 *
 * Bounded on purpose, and bounded TWICE: by the ladder's length, and by the caller's own
 * `timeoutMs` — no further attempt is STARTED once the elapsed time plus the next pause would
 * pass the deadline this call entered with. That second bound is the one that makes a longer
 * ladder safe on the lanes whose `once()` arms its own per-attempt `AbortSignal.timeout`: a
 * slow failure spends the caller's budget and then stops, instead of buying itself another full
 * timeout per attempt the way a fixed count alone would.
 *
 * The LAST attempt's error propagates unchanged — no retry-exhausted wrapper, so the provider's
 * own reason is what the caller and the logs see.
 *
 * `abandoned` lets a lane that shares ONE deadline across every attempt (the responses lane)
 * stop rather than start an attempt the caller no longer has time for.
 */
async function withTransportRetry<T>(
  modelId: string,
  req: LlmRequest,
  once: () => Promise<T>,
  abandoned: () => boolean = () => false,
): Promise<T> {
  // Read once, at entry: the ladder is bounded by the budget the CALL was given, not by a
  // fresh budget per attempt.
  const deadline = Date.now() + effectiveTimeout(req)
  const total = LLM_TRANSPORT_RETRY_DELAYS_MS.length + 1
  for (let attempt = 1; ; attempt++) {
    try {
      return await once()
    } catch (err) {
      if (attempt > LLM_TRANSPORT_RETRY_DELAYS_MS.length || !transportRetryable(err, req) || abandoned()) throw err
      const pause = LLM_TRANSPORT_RETRY_DELAYS_MS[attempt - 1]
      if (Date.now() + pause >= deadline) throw err
      console.warn(
        `[llm-kie-stream-retry] ${modelId} attempt ${attempt + 1}/${total} in ${pause} ms — ` +
          `attempt ${attempt} failed before any usage was reported: ${String(err).slice(0, 160)}`,
      )
      await new Promise((resolve) => setTimeout(resolve, pause))
      if (abandoned()) throw err
    }
  }
}

/**
 * Why a terminal responses event was not `response.completed`, in one clause.
 *
 * Both shapes the responses dialect uses, read defensively because this runs on a
 * failure path: `incomplete_details.reason` for `response.incomplete`, `error.code` /
 * `error.message` for `response.failed`. Bounded — a provider message is not a log budget —
 * and it returns "" rather than inventing a reason when the event carries none.
 */
export function terminalResponseReason(resp: Record<string, unknown> | undefined): string {
  const text = (value: unknown): string => (typeof value === "string" && value.trim() ? value.trim() : "")
  const details = resp?.incomplete_details as Record<string, unknown> | undefined
  const error = resp?.error as Record<string, unknown> | undefined
  const parts = [text(details?.reason), text(error?.code), text(error?.message)].filter(Boolean)
  return parts.join(" ").slice(0, 300)
}

/**
 * Schema-constrained completion with validation + retry — the reliable entry
 * point for "the LLM must return JSON shaped like X".
 *
 * The router enforces the schema natively where the model supports it
 * (Anthropic forced tool / Gemini `response_format` / GPT responses
 * `text.format`); for models with no native mode (GPT-5.2 via KIE
 * chat-completions) the call is plain text. Either way the result is parsed,
 * Zod-validated, and on failure retried — the bad output + the validation error
 * are fed back — up to `maxRetries` times before throwing, so callers never see
 * a malformed object. Replaces ad-hoc `JSON.parse` + single-shot validation.
 */
export async function llmCompleteStructured<T>(
  req: LlmRequest,
  schema: ZodType<T>,
  opts?: { schemaName?: string; maxRetries?: number },
): Promise<StructuredLlmOutput<T>> {
  return runStructuredAttempts(req, schema, opts, (attemptReq) => llmComplete(attemptReq))
}

export interface StructuredStreamOptions {
  schemaName?: string
  maxRetries?: number
  /**
   * Receives each raw fragment of the tool input as the model writes it,
   * plus the SDK's best-effort parse of everything so far. That snapshot
   * closes an open string, so it cannot tell a finished value from a prefix;
   * parse the fragments (`incremental-json.ts`) to know.
   *
   * Only the FIRST attempt streams, and only where forced-tool output can
   * stream: a model with `anthropic-tool` structured output and a direct
   * lane, on a call no `requireLane` pins elsewhere. Otherwise it is never
   * called and the answer arrives one-shot. A throw from it is logged and
   * stops the forwarding; it never fails the call.
   */
  onToolJson?: (partialJson: string, jsonSnapshot: unknown) => void
  /** Aborts the streamed attempt. */
  signal?: AbortSignal
}

/**
 * {@link llmCompleteStructured}, with the first attempt's tool input streamed
 * to `onToolJson` as the model writes it, so a caller can show each finished
 * value before the answer is done.
 *
 * Everything that makes the answer trustworthy is shared with
 * llmCompleteStructured rather than restated: the same validation, the same
 * correction retries (one-shot, since streaming a retry would re-show values
 * the caller already has), the same usage and cost summed over every attempt,
 * the same cap-stop rule. Streamed values are PROVISIONAL; the returned
 * output is the answer.
 *
 * The streamed attempt always goes to the direct Anthropic SDK (a streamed
 * forced-tool reply is not parsed on the KIE lane, the rule `llmStream`
 * applies too), with the body the one-shot direct call sends. If it fails
 * before a single fragment arrived, that attempt is served one-shot on the
 * model's normal lanes instead, exactly as the non-streamed call would have
 * been. Once anything has streamed, a failure surfaces: re-asking would pay
 * twice.
 */
export async function llmStreamStructured<T>(
  req: LlmRequest,
  schema: ZodType<T>,
  opts?: StructuredStreamOptions,
): Promise<StructuredLlmOutput<T>> {
  const model = resolveModel(req)
  assertInlineVideoLane(req)
  const onToolJson = opts?.onToolJson
  if (!onToolJson || !canStreamStructured(model, req)) {
    return runStructuredAttempts(req, schema, opts, (attemptReq) => llmComplete(attemptReq))
  }
  const forward = guardToolJsonCallback(model.id, onToolJson)
  return runStructuredAttempts(req, schema, opts, (attemptReq, attempt) =>
    attempt === 0 ? streamStructuredAttempt(model, attemptReq, forward, opts?.signal) : llmComplete(attemptReq),
  )
}

/** Forced-tool output streams only on the direct Anthropic lane: the model
 *  speaks `anthropic-tool`, names a direct model, the key is set, and no
 *  `requireLane` pins the call elsewhere. */
function canStreamStructured(model: LlmModelDef, req: LlmRequest): boolean {
  return (
    req.requireLane === undefined &&
    model.structuredOutputMode === "anthropic-tool" &&
    Boolean(model.directFallbackModel) &&
    Boolean(config.ANTHROPIC_API_KEY)
  )
}

/** A broken consumer must never fail a paid call: its first throw is logged
 *  and ends the forwarding. */
function guardToolJsonCallback(
  modelId: string,
  onToolJson: (partialJson: string, jsonSnapshot: unknown) => void,
): (partialJson: string, jsonSnapshot: unknown) => void {
  let live = true
  return (partialJson, jsonSnapshot) => {
    if (!live) return
    try {
      onToolJson(partialJson, jsonSnapshot)
    } catch (err) {
      live = false
      console.warn(
        `[llm-structured-stream] ${modelId}: onToolJson threw, forwarding stopped (the call continues) — ` +
          String(err).slice(0, 200),
      )
    }
  }
}

/**
 * The first, streamed attempt. Its lanes are the one-shot path's pair for a
 * Claude model (`llmComplete`): the direct SDK, then KIE, one each, so the
 * call stays within `LLM_MAX_LANES_PER_CALL`. KIE is asked only when the
 * stream cost nothing: it failed before `message_start` (a started stream
 * throws a usage-carrying `LlmStreamResponseError`, a cap stop included), and
 * the caller did not cancel it.
 */
async function streamStructuredAttempt(
  model: LlmModelDef,
  req: LlmRequest,
  onToolJson: (partialJson: string, jsonSnapshot: unknown) => void,
  signal?: AbortSignal,
): Promise<LlmResponse> {
  if (!req.jsonSchema) return llmComplete(req)
  try {
    return await streamAnthropicStructured(model, req, req.jsonSchema, onToolJson, signal)
  } catch (err) {
    const kie = kieFallback(model, req)
    if (!kie || err instanceof LlmStreamResponseError || signal?.aborted) throw err
    warnLaneFallback({ modelId: model.id, primary: "direct-anthropic stream", fallback: "kie" }, err)
    return kie()
  }
}

/**
 * The validation loop both structured entry points share: build the JSON
 * schema, ask (through `callAttempt`), parse, Zod-validate, and on failure
 * ask again with a correction turn, summing usage over every attempt.
 */
async function runStructuredAttempts<T>(
  req: LlmRequest,
  schema: ZodType<T>,
  opts: { schemaName?: string; maxRetries?: number } | undefined,
  callAttempt: (attemptReq: LlmRequest, attempt: number) => Promise<LlmResponse>,
): Promise<StructuredLlmOutput<T>> {
  const schemaName = opts?.schemaName ?? "result"
  const retries = Math.max(0, opts?.maxRetries ?? 2)
  const jsonSchema = structuredJsonSchema(schema)

  let messages = req.messages
  let lastError = ""
  let spend = NO_SPEND
  for (let attempt = 0; attempt <= retries; attempt++) {
    let resp: LlmResponse
    try {
      // `maxRetries` is NOT passed down as a transport policy. It bounds how many times a
      // provider that ANSWERED is asked again for a better-shaped answer — each of those is
      // paid work, which is why a caller that must not re-pay (the plugin host's structured
      // calls) sets it to 0. A stream that failed before reporting any usage was not an
      // answer and cost nothing, so refusing to re-dial it buys the caller no protection and
      // costs it the whole job. `retryStreamOnError` is that separate lever and travels
      // verbatim.
      resp = await callAttempt({ ...req, messages,
        jsonSchema: { name: schemaName, schema: jsonSchema } }, attempt)
    } catch (error) {
      throw failureWithSpend(spend, error)
    }
    spend = addSpend(spend, resp)
    const answer = parseStructuredAnswer(schema, resp.text)
    if (answer.ok) {
      const usage = spendUsage(spend)
      return { output: answer.data, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens,
        providerCost: usage.providerCost, usageComplete: usage.complete }
    }
    lastError = answer.error
    messages = withCorrection(messages, resp.text, lastError)
  }
  throw new StructuredLlmError(`llm-structured: validation failed after ${retries + 1} attempt(s): ${lastError}`, spendUsage(spend))
}

/** The forced output's JSON Schema. */
function structuredJsonSchema(schema: ZodType): Record<string, unknown> {
  // Draft-7 keeps Anthropic's tool input_schema happy; strip the $schema marker.
  // io:"input" mirrors zod-to-json-schema's semantics (defaulted fields optional).
  const jsonSchema = restrictObjectSchemas(
    z.toJSONSchema(schema, { target: "draft-7", unrepresentable: "any", io: "input" }) as Record<string, unknown>,
  )
  delete jsonSchema.$schema
  return jsonSchema
}

/**
 * What one structured call has spent so far.
 *
 * Accumulate usage across ALL attempts: a retried call really is billed for
 * every attempt (each re-sends the prompt — incl. multimodal refs), so the
 * returned cost must reflect the full spend, not just the winning attempt.
 * Otherwise jobs.provider_cost under-reports vs the real KIE/Anthropic bill
 * and the credit-anomaly / "actual" audit drifts negative.
 */
interface StructuredSpend {
  inputTokens: number
  outputTokens: number
  cost: number
  costSeen: boolean
  /** Every attempt reported both token usage and cost. */
  complete: boolean
}

const NO_SPEND: StructuredSpend = { inputTokens: 0, outputTokens: 0, cost: 0, costSeen: false, complete: true }

function addSpend(spend: StructuredSpend, resp: LlmResponse): StructuredSpend {
  return {
    inputTokens: spend.inputTokens + (resp.usage?.inputTokens ?? 0),
    outputTokens: spend.outputTokens + (resp.usage?.outputTokens ?? 0),
    cost: spend.cost + (resp.providerCost ?? 0),
    costSeen: spend.costSeen || resp.providerCost != null,
    complete: spend.complete && resp.usage !== undefined && resp.providerCost !== undefined,
  }
}

function spendUsage(spend: StructuredSpend): StructuredLlmError["usage"] {
  return {
    inputTokens: spend.inputTokens,
    outputTokens: spend.outputTokens,
    providerCost: spend.costSeen ? spend.cost : undefined,
    complete: spend.complete,
  }
}

/** An attempt that threw ends the call; the usage it reported (if any) joins the total. */
function failureWithSpend(spend: StructuredSpend, error: unknown): StructuredLlmError {
  const terminalUsage = error instanceof LlmStreamResponseError ? error.usage : undefined
  return new StructuredLlmError(error instanceof Error ? error.message : "Structured completion failed", {
    inputTokens: spend.inputTokens + (terminalUsage?.inputTokens ?? 0),
    outputTokens: spend.outputTokens + (terminalUsage?.outputTokens ?? 0),
    providerCost: spend.costSeen || terminalUsage?.providerCost !== undefined
      ? spend.cost + (terminalUsage?.providerCost ?? 0) : undefined,
    complete: spend.complete && terminalUsage?.complete === true,
  }, { cause: error })
}

/** Parse and validate one attempt's answer: its data, or the error to feed back. */
function parseStructuredAnswer<T>(
  schema: ZodType<T>,
  text: string,
): { ok: true; data: T } | { ok: false; error: string } {
  let parsedJson: unknown
  try {
    parsedJson = JSON.parse(extractJsonFromAIResponse(text))
  } catch {
    return { ok: false, error: "Output was not valid JSON." }
  }
  const result = schema.safeParse(parsedJson)
  if (result.success) return { ok: true, data: result.data }
  return {
    ok: false,
    error: result.error.issues.slice(0, 8).map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; "),
  }
}

/**
 * Append a correction turn for the next retry. The failed output goes back as an
 * assistant turn, then a user correction, so roles alternate (Anthropic rejects
 * consecutive same-role messages).
 */
function withCorrection(messages: LlmMessage[], prevOutput: string, error: string): LlmMessage[] {
  return [
    ...messages,
    { role: "assistant", content: prevOutput || "{}" },
    { role: "user", content: `Your previous output was invalid: ${error}. Return ONLY valid JSON matching the schema — no prose, no markdown fences.` },
  ]
}

// ---------------------------------------------------------------------------
// Model resolution
// ---------------------------------------------------------------------------

function resolveModel(req: LlmRequest): LlmModelDef {
  let modelId = req.modelId
  if (!modelId && req.feature) {
    modelId = LLM_FEATURE_DEFAULTS[req.feature as LlmFeature] ?? "claude-sonnet-4.6"
  }
  const model = getLlmModel(modelId)
  if (!model) {
    throw new Error(`Unknown LLM model: ${modelId}`)
  }
  return model
}

/** Effective request timeout — per-request override, else the 120s default. */
function effectiveTimeout(req: LlmRequest): number {
  return req.timeoutMs ?? LLM_TIMEOUT_MS
}

/** Per-request derived params: clamped effort, temperature (stripped for
 *  models that reject it), and the output-token cap (raised to the model's
 *  reasoning floor — 32768 unless a lane caps it lower — whenever reasoning
 *  tokens share the budget: at xhigh/max, or on ANY call to a
 *  `thinkingDefaultOn` model — so thinking doesn't truncate the answer). */
function deriveParams(model: LlmModelDef, req: LlmRequest): {
  eff: LlmReasoningEffort | undefined
  temperature: number | undefined
  topP: number | undefined
  maxTokens: number
} {
  // The direct lane accepts a WIDER effort ladder than the aggregator, so the
  // clamp has to know which lane this call is pinned to. Without this, Advanced
  // mode unlocked temperature/maxTokens but silently kept clamping effort
  // against the aggregator's set — the headline capability was inert, and on
  // gemini-3-flash (which declares no KIE levels at all) every level the picker
  // offered was discarded before it reached the wire.
  const eff = effectiveReasoningEffort(model.id, req.reasoningEffort, req.requireLane === "direct")
  const temperature = model.supportsTemperature === false ? undefined : req.temperature
  // top_p rides the same support gate as temperature — a reasoning model that
  // rejects sampling params gets neither.
  const topP = model.supportsTemperature === false ? undefined : req.topP
  let maxTokens = req.maxTokens ?? model.maxOutputTokens
  // Reasoning tokens share the output budget. Two ways that happens:
  //   - an xhigh/max effort was requested (any reasoning model), or
  //   - the model reasons with no thinking param sent at all
  //     (`thinkingDefaultOn` — Claude Opus 5 flipped this default, so even
  //     Effort=Auto reasons and a 2048 cap is shared with the answer).
  // Floor the cap even when the caller sent an explicit maxTokens — node data
  // persists the old 2048 default, and hardcoded 2048s live in several routes
  // (after-effects/motion-graphics/lottie-overlay); such a call must never
  // truncate its answer because thinking consumed a small legacy cap. The cap
  // is a ceiling, not spend: billing is flat per call, so raising it costs
  // nothing unless the model actually generates that much.
  //
  // The floor is the model's own (`reasoningOutputFloor`), not a flat 32768:
  // it rides every lane the model can be served on, and the Gemini flash KIE
  // endpoints are only known to take 8192. Issue #1588 is what a missing floor
  // costs — gemini-3.6-flash reasons by default and was sent a node's 1,100.
  if (eff === "xhigh" || eff === "max" || model.thinkingDefaultOn) {
    maxTokens = Math.max(maxTokens, reasoningOutputFloor(model))
  }
  return { eff, temperature, topP, maxTokens }
}

// ---------------------------------------------------------------------------
// Shared message builders
// ---------------------------------------------------------------------------

/** One sentence for every lane that cannot carry a `video_base64` block — which
 *  is every lane except the direct Google one. Named per lane so a stack-free
 *  error still says which wire refused it. */
const INLINE_VIDEO_LANE_ERROR = (lane: string) =>
  `llm-client: the ${lane} lane cannot carry inline video bytes (video_base64) — ` +
  `pin requireLane: "direct" on a model that declares a directGeminiModel`

function buildChatCompletionsMessages(req: LlmRequest): Array<Record<string, unknown>> {
  const msgs: Array<Record<string, unknown>> = []
  if (req.system) {
    msgs.push({ role: "system", content: req.system })
  }
  for (const m of req.messages) {
    if (typeof m.content === "string") {
      msgs.push({ role: m.role, content: m.content })
    } else {
      const parts = m.content.map((b) => {
        if (b.type === "text") return { type: "text", text: b.text }
        if (b.type === "image_base64") return { type: "image_url", image_url: { url: `data:${b.mediaType};base64,${b.data}` } }
        if (b.type === "image") return { type: "image_url", image_url: { url: b.url } }
        // KIE's OpenAI-compat chat-completions proxy forwards ONLY `image_url`
        // content parts and SILENTLY drops `video_url`/`audio_url` (HTTP 200, no
        // error — the model just receives the text parts). Gemini ingests whatever
        // media the URL resolves to, keyed off its MIME type: mp4 → frames + audio
        // track, mp3 → audio. So we route video AND audio refs through `image_url`
        // too — that is the ONLY channel KIE actually delivers. Live-verified via
        // direct curl 2026-07-03 (Gate 0): mp4-as-image_url = 1,972 ingestion
        // tokens w/ correct frames; a 596s/62MB mp4 + `response_format` ingested
        // full-length (heardAudio + accurate last-30s); mp3 = speech transcribed;
        // `video_url`/`audio_url` (object AND string form) = silently dropped.
        // This ONLY applies to the KIE chat-completions (Gemini) wire — the Claude
        // `messages` and GPT `responses` builders still THROW on video/audio, which
        // is correct (those providers genuinely cannot ingest it).
        if (b.type === "video" || b.type === "audio") {
          // A sampling rate cannot survive the URL-smuggling hack: KIE hands
          // Gemini a bare URL and Gemini then samples at its 1 fps default.
          // Throwing beats returning a block that looks accepted — the caller
          // would get analysis grounded in a third of the frames it asked for,
          // with a 200 and no way to tell. Analysis pins `requireLane: "direct"`
          // (toolkit.ts), so this is only reachable by a genuine mistake.
          if (b.type === "video" && b.fps !== undefined) {
            throw new Error(
              `llm-client: video fps=${b.fps} was requested but the KIE lane cannot carry a sampling rate — pin requireLane: "direct"`,
            )
          }
          return { type: "image_url", image_url: { url: b.url } }
        }
        // Inline bytes have no channel here AT ALL: this lane's only media
        // affordance is a URL that KIE dereferences server-side. The router
        // gate (`assertInlineVideoLane`) already refuses such a request before
        // a lane is picked, so reaching this line means a NEW call site built
        // a KIE body directly — throw rather than let the block be dropped or
        // stringified into a text part.
        if (b.type === "video_base64") {
          throw new Error(INLINE_VIDEO_LANE_ERROR("KIE chat-completions"))
        }
        const _exhaustive: never = b
        return _exhaustive
      })
      msgs.push({ role: m.role, content: parts })
    }
  }
  return msgs
}

function buildMessagesBody(model: LlmModelDef, req: LlmRequest): Record<string, unknown> {
  const messages = req.messages.map((m) => {
    if (typeof m.content === "string") {
      return { role: m.role, content: m.content }
    }
    const blocks = m.content.map((b) => {
      if (b.type === "text") return { type: "text", text: b.text }
      if (b.type === "image_base64") return { type: "image", source: { type: "base64", media_type: b.mediaType, data: b.data } }
      if (b.type === "image") return { type: "image", source: { type: "url", url: b.url } }
      if (b.type === "video" || b.type === "audio") {
        throw new Error(`Claude messages API does not support ${b.type} input — pick a Gemini model for video/audio refs.`)
      }
      if (b.type === "video_base64") {
        throw new Error(INLINE_VIDEO_LANE_ERROR("Claude messages"))
      }
      const _exhaustive: never = b
      return _exhaustive
    })
    return { role: m.role, content: blocks }
  })

  const { eff, temperature, topP, maxTokens } = deriveParams(model, req)
  return {
    model: model.kieSlugOrModel,
    max_tokens: maxTokens,
    ...(temperature !== undefined ? { temperature } : {}),
    ...(topP !== undefined ? { top_p: topP } : {}),
    ...(eff !== undefined ? { thinking: { type: "adaptive" }, output_config: { effort: eff } } : {}),
    // Forced-tool structured output — mirrors callAnthropicDirect's pattern.
    // KIE_CLAUDE_TOOLS_VERIFIED gates routing (see llmComplete/llmStream); once
    // a structured call reaches here, the schema must actually be carried on
    // the wire or KIE has no way to know to emit a tool_use block.
    ...(req.jsonSchema && model.structuredOutputMode === "anthropic-tool" ? {
      tools: [{
        name: req.jsonSchema.name,
        description: "Emit the structured result.",
        input_schema: req.jsonSchema.schema,
      }],
      tool_choice: { type: "tool", name: req.jsonSchema.name },
    } : {}),
    system: req.system,
    messages,
  }
}

function buildResponsesInput(req: LlmRequest): Array<Record<string, unknown>> {
  const input: Array<Record<string, unknown>> = []
  if (req.system) {
    input.push({ role: "developer", content: req.system })
  }
  for (const m of req.messages) {
    if (typeof m.content === "string") {
      input.push({ role: m.role, content: m.content })
    } else {
      const parts = m.content.map((b) => {
        if (b.type === "text") return { type: "input_text", text: b.text }
        if (b.type === "image_base64") return { type: "input_image", image_url: `data:${b.mediaType};base64,${b.data}` }
        if (b.type === "image") return { type: "input_image", image_url: b.url }
        if (b.type === "video" || b.type === "audio") {
          throw new Error(`GPT responses API does not support ${b.type} input — pick a Gemini model for video/audio refs.`)
        }
        if (b.type === "video_base64") {
          throw new Error(INLINE_VIDEO_LANE_ERROR("GPT responses"))
        }
        const _exhaustive: never = b
        return _exhaustive
      })
      input.push({ role: m.role, content: parts })
    }
  }
  return input
}

/**
 * Map a single {@link LlmContentBlock} → Anthropic content block (text + image
 * only; Anthropic vision rejects video/audio). Shared by {@link buildAnthropicMessages}
 * and structured-llm's `toAnthropicContent` so the per-block mapping lives once.
 */
export function llmBlockToAnthropic(b: LlmContentBlock): Anthropic.Messages.ContentBlockParam {
  if (b.type === "text") return { type: "text", text: b.text }
  if (b.type === "image_base64") {
    return { type: "image", source: { type: "base64", media_type: b.mediaType as "image/png" | "image/jpeg" | "image/webp" | "image/gif", data: b.data } }
  }
  if (b.type === "image") return { type: "image", source: { type: "url", url: b.url } }
  if (b.type === "video_base64") {
    throw new Error(INLINE_VIDEO_LANE_ERROR("Anthropic"))
  }
  if (b.type === "video" || b.type === "audio") {
    throw new Error(`Anthropic does not support ${b.type} input — pick a Gemini model for video/audio refs.`)
  }
  const _exhaustive: never = b
  return _exhaustive
}

function buildAnthropicMessages(req: LlmRequest) {
  return req.messages.map((m) => {
    if (typeof m.content === "string") {
      return { role: m.role as "user" | "assistant", content: m.content }
    }
    return { role: m.role as "user" | "assistant", content: m.content.map(llmBlockToAnthropic) }
  })
}

/**
 * KIE `response_format` for models that natively enforce a JSON schema (Gemini
 * via KIE — live-verified). `strict: false` avoids OpenAI strict-mode's
 * all-keys-required constraint (our schemas carry optional fields); the schema
 * still strongly constrains the shape, and `llmCompleteStructured`'s validate +
 * retry is the actual guarantee. Returns undefined for models with no native
 * mode (GPT-via-KIE ignores response_format) so the caller falls back to text.
 */
function kieResponseFormat(model: LlmModelDef, req: LlmRequest): Record<string, unknown> | undefined {
  if (!req.jsonSchema || model.structuredOutputMode !== "kie-response-format") return undefined
  return {
    type: "json_schema",
    json_schema: { name: req.jsonSchema.name, strict: false, schema: req.jsonSchema.schema },
  }
}

/**
 * KIE responses-API `text` param for models that natively enforce a JSON
 * schema on the {family}/v1/responses endpoints (gpt-5.4/5.5 + the GPT-5.6
 * family — live-verified 2026-07-14; grok-4.6 — live-verified 2026-08-18;
 * text AND vision inputs; the format is
 * echoed back and output arrives schema-shaped). Same `strict: false`
 * rationale as {@link kieResponseFormat}; `llmCompleteStructured`'s
 * validate+retry remains the actual guarantee. Returns undefined for models
 * without the mode.
 */
function kieResponsesTextFormat(model: LlmModelDef, req: LlmRequest): Record<string, unknown> | undefined {
  if (!req.jsonSchema || model.structuredOutputMode !== "responses-json-schema") return undefined
  return {
    format: { type: "json_schema", name: req.jsonSchema.name, strict: false, schema: req.jsonSchema.schema },
  }
}

/**
 * KIE's non-stream responses carry `credits_consumed` (KIE credits; 1 credit
 * = $0.005) — the ACTUAL provider charge for that call, which can drift from
 * our per-token rate table as KIE repriced models. Returns undefined when the
 * field is absent/non-positive/non-numeric so callers fall back to the table
 * estimate. KIE's SSE stream responses don't reliably carry this field, so
 * streaming call sites never pass data through this helper (table estimate
 * only — see {@link parseSseStream}).
 */
const KIE_CREDIT_USD = 0.005

function extractActualUsd(data: unknown): number | undefined {
  const kieCredits = (data as { credits_consumed?: unknown }).credits_consumed
  return typeof kieCredits === "number" && Number.isFinite(kieCredits) && kieCredits > 0
    ? kieCredits * KIE_CREDIT_USD
    : undefined
}

/**
 * Build LlmResponse with computed provider cost from token usage. When
 * `actualUsd` is supplied (real KIE `credits_consumed` billing — see
 * {@link extractActualUsd}), it wins over the per-token table estimate; the
 * table estimate is still computed (when usage is available) so it can be
 * compared against the actual for drift detection. A >25% divergence between
 * the two logs an ops signal — KIE's real price moved and the rate table in
 * `pricing/llm-cost.ts` needs a manual reprice.
 */
/**
 * The media fail-open guard. Throws when the provider reports fewer prompt
 * tokens than the caller's floor — i.e. it answered without ingesting the media
 * it was sent. See {@link LlmRequest.minPromptTokens} for the measurement that
 * motivated it; the failure mode is a confident analysis of a video that was
 * never delivered, which is strictly worse than an error.
 *
 * Silent when the caller sets no floor, or when the provider reports no usage
 * at all (streams) — this must never turn a working call into a failure.
 */
function assertMediaIngested(model: LlmModelDef, req: LlmRequest, usage?: { inputTokens: number }): void {
  const floor = req.minPromptTokens
  if (floor === undefined || !usage || usage.inputTokens <= 0) return
  if (usage.inputTokens < floor) {
    throw new Error(
      `media_not_ingested:${model.id} — provider reported ${usage.inputTokens} prompt tokens, below the ${floor} floor for this request's media. ` +
        `The response describes content the model was not shown; discarding it.`,
    )
  }
}

function buildResponse(
  model: LlmModelDef,
  text: string,
  end: ReplyEnd,
  usage?: { inputTokens: number; outputTokens: number },
  actualUsd?: number,
  lane: LlmServingLane = "kie",
  req?: LlmRequest,
): LlmResponse {
  if (req) assertMediaIngested(model, req, usage)
  const tableEstimate = usage ? calculateLlmCost(model, usage, lane) : undefined
  if (actualUsd !== undefined && tableEstimate !== undefined && tableEstimate > 0) {
    const drift = Math.abs(actualUsd - tableEstimate) / tableEstimate
    if (drift > 0.25) {
      console.warn(
        `[llm-cost-drift] model=${model.id} estimated=$${tableEstimate.toFixed(6)} actual=$${actualUsd.toFixed(6)}`,
      )
    }
  }
  const providerCost = actualUsd ?? tableEstimate
  // Only the KIE formats and the direct Anthropic SDK build through here (the
  // Gemini lane has its own builder), so "direct" names Anthropic.
  assertNotOutputCapped({
    modelId: model.id, lane: lane === "direct" ? "direct-anthropic" : "kie",
    stopReason: end.stopReason, cap: end.cap, usage, providerCost,
  })
  return {
    text,
    usage,
    model: model.id,
    providerCost,
  }
}

/**
 * KIE returns HTTP 200 with a `{code: <non-zero>, msg: "..."}` envelope for
 * service errors (e.g. "maintenance") and validation errors (e.g. unsupported
 * model). Without this guard the downstream parser silently produces empty
 * text, the job is marked completed, and credits are committed.
 *
 * Success bodies have no `code` field (chat-completions / responses) or use
 * `code: 0|200` (legacy task client).
 */
function assertKieEnvelope(data: unknown, modelId: string, context: string): void {
  if (!data || typeof data !== "object") return
  const code = (data as { code?: number }).code
  if (code === undefined || code === 0 || code === 200) return
  const msg =
    (data as { msg?: string }).msg ??
    (data as { message?: string }).message ??
    JSON.stringify(data)
  throw new Error(`KIE.ai ${context} ${modelId} failed (code ${code}): ${msg}`)
}

// ---------------------------------------------------------------------------
// KIE.ai adapters
// ---------------------------------------------------------------------------

async function callKie(model: LlmModelDef, req: LlmRequest): Promise<LlmResponse> {
  switch (model.kieFormat) {
    case "chat-completions":
      return callKieChatCompletions(model, req)
    case "messages":
      // One switch for every path that reaches KIE for a non-streamed Claude
      // call — the fallback leg in llmComplete, a KIE-only deployment with no
      // ANTHROPIC_API_KEY, and any future caller. While KIE's non-streaming
      // Claude endpoint 500s unconditionally, the streaming wire collapsed back
      // to a single response is the only shape that can actually be served.
      return KIE_CLAUDE_NONSTREAM_VERIFIED
        ? callKieMessages(model, req)
        : callKieMessagesCollapsed(model, req)
    case "responses":
      // Per MODEL, not per lane — the opposite of the Claude switch above.
      // KIE's non-streaming responses endpoint serves gpt-5.4/5.5/5.6 fine and
      // 500s ~2 calls in 3 for gpt-6-astra, so the registry names the affected
      // model (`kieCollapseStream`) and this reads the flag. No name matching:
      // a future model with the same condition declares it and is served here.
      return model.kieCollapseStream
        ? callKieResponsesCollapsed(model, req)
        : callKieResponses(model, req)
  }
}

async function streamKie(
  model: LlmModelDef,
  req: LlmRequest,
  onToken: (chunk: string) => void,
  signal?: AbortSignal,
): Promise<LlmResponse> {
  switch (model.kieFormat) {
    case "chat-completions":
      return streamKieChatCompletions(model, req, onToken, signal)
    case "messages":
      return streamKieMessages(model, req, onToken, signal)
    case "responses":
      return streamKieResponses(model, req, onToken, signal)
  }
}

// -- Chat Completions format (Gemini, GPT-5.2) --

async function callKieChatCompletions(model: LlmModelDef, req: LlmRequest): Promise<LlmResponse> {
  const url = `${KIE_API_BASE}/${model.kieSlugOrModel}/v1/chat/completions`
  const { eff, temperature, topP, maxTokens } = deriveParams(model, req)
  const body: Record<string, unknown> = {
    model: model.kieSlugOrModel,
    messages: buildChatCompletionsMessages(req),
    max_tokens: maxTokens,
    ...(temperature !== undefined ? { temperature } : {}),
    ...(topP !== undefined ? { top_p: topP } : {}),
    ...(eff !== undefined ? { reasoning_effort: eff } : {}),
  }
  const responseFormat = kieResponseFormat(model, req)
  if (responseFormat) body.response_format = responseFormat

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.KIE_API_KEY}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(effectiveTimeout(req)),
  })

  if (!response.ok) {
    const errText = await response.text()
    throw new Error(`KIE.ai chat-completions ${model.id} failed (${response.status}): ${errText}`)
  }

  const data = await response.json() as Record<string, unknown>
  assertKieEnvelope(data, model.id, "chat-completions")
  const choices = data.choices as Array<Record<string, unknown>> | undefined
  const text = (choices?.[0]?.message as Record<string, unknown>)?.content as string ?? ""
  const usage = data.usage as Record<string, number> | undefined

  return buildResponse(
    model,
    text,
    { stopReason: choices?.[0]?.finish_reason, cap: maxTokens },
    usage ? { inputTokens: usage.prompt_tokens ?? 0, outputTokens: usage.completion_tokens ?? 0 } : undefined,
    extractActualUsd(data),
    "kie",
    req,
  )
}

async function streamKieChatCompletions(
  model: LlmModelDef, req: LlmRequest, onToken: (chunk: string) => void, signal?: AbortSignal,
): Promise<LlmResponse> {
  const url = `${KIE_API_BASE}/${model.kieSlugOrModel}/v1/chat/completions`
  const { eff, temperature, topP, maxTokens } = deriveParams(model, req)
  const body: Record<string, unknown> = {
    model: model.kieSlugOrModel,
    messages: buildChatCompletionsMessages(req),
    max_tokens: maxTokens,
    ...(temperature !== undefined ? { temperature } : {}),
    ...(topP !== undefined ? { top_p: topP } : {}),
    ...(eff !== undefined ? { reasoning_effort: eff } : {}),
    stream: true,
  }
  const responseFormat = kieResponseFormat(model, req)
  if (responseFormat) body.response_format = responseFormat

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.KIE_API_KEY}` },
    body: JSON.stringify(body),
    signal: signal ?? AbortSignal.timeout(effectiveTimeout(req)),
  })

  if (!response.ok) {
    const errText = await response.text()
    throw new Error(`KIE.ai chat-completions stream ${model.id} failed (${response.status}): ${errText}`)
  }

  return parseSseStream(response, model.id, onToken, "chat-completions", maxTokens)
}

// -- Messages format (Claude models) --

async function callKieMessages(model: LlmModelDef, req: LlmRequest): Promise<LlmResponse> {
  const url = `${KIE_API_BASE}/claude/v1/messages`
  // KIE defaults stream to true for Claude — must explicitly set false
  const base = buildMessagesBody(model, req)
  const body = { ...base, stream: false }

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.KIE_API_KEY}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(effectiveTimeout(req)),
  })

  if (!response.ok) {
    const errText = await response.text()
    throw new Error(`KIE.ai messages ${model.id} failed (${response.status}): ${errText}`)
  }

  const data = await response.json() as Record<string, unknown>
  assertKieEnvelope(data, model.id, "messages")
  const content = data.content as Array<Record<string, unknown>> | undefined
  // A forced-tool structured call (see buildMessagesBody) should return its
  // result in a tool_use block — prefer it when present. In practice KIE's
  // proxy re-serializes the tool call into a `<tool_calls>` text pseudo-tag
  // with malformed JSON (see extractKieToolCallInput), so decode that next.
  // A structured call with NO decodable payload throws: llmComplete's catch
  // then falls back to the direct SDK rather than feeding garbage to the
  // parse+retry loop. Plain-text calls are unaffected.
  const toolUseBlock = content?.find((b) => b.type === "tool_use")
  const rawText = (content?.find((b) => b.type === "text")?.text as string) ?? ""
  let text: string
  if (toolUseBlock) {
    const input = (toolUseBlock as { input?: unknown }).input
    text = typeof input === "string" ? input : JSON.stringify(input ?? {})
  } else if (req.jsonSchema && model.structuredOutputMode === "anthropic-tool") {
    const unwrapped = extractKieToolCallInput(rawText)
    if (unwrapped === null && (rawText.includes("<tool_calls>") || rawText.trim() === "")) {
      throw new Error(`KIE.ai messages ${model.id}: structured call returned no decodable tool payload`)
    }
    text = unwrapped ?? rawText
  } else {
    text = rawText
  }
  const usage = data.usage as Record<string, number> | undefined

  return buildResponse(
    model,
    text,
    { stopReason: data.stop_reason, cap: base.max_tokens as number },
    usage ? { inputTokens: usage.input_tokens ?? 0, outputTokens: usage.output_tokens ?? 0 } : undefined,
    extractActualUsd(data),
    "kie",
    req,
  )
}

async function streamKieMessages(
  model: LlmModelDef, req: LlmRequest, onToken: (chunk: string) => void, signal?: AbortSignal,
): Promise<LlmResponse> {
  const url = `${KIE_API_BASE}/claude/v1/messages`
  const base = buildMessagesBody(model, req)
  const body = { ...base, stream: true }

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.KIE_API_KEY}` },
    body: JSON.stringify(body),
    signal: signal ?? AbortSignal.timeout(effectiveTimeout(req)),
  })

  if (!response.ok) {
    const errText = await response.text()
    throw new Error(`KIE.ai messages stream ${model.id} failed (${response.status}): ${errText}`)
  }

  return parseSseStream(response, model.id, onToken, "messages", base.max_tokens as number)
}

/**
 * Serve a NON-streaming Claude request over KIE's STREAMING wire, collapsing
 * the SSE into one response.
 *
 * This exists because KIE's Claude lane is only half-broken: `stream: false`
 * 500s every time, while `stream: true` answers normally (measured 2026-08-06 —
 * 0/6 vs 5/6 plain, 6/6 with a forced tool). Collapsing the working half back
 * into the non-streaming shape gives `llmComplete` a real second lane instead
 * of none.
 *
 * That matters because the direct Anthropic lane is not incident-free either:
 * status.claude.com logged "Degraded performance for Claude Opus 5" and
 * "Degraded performance of multiple models" on 2026-08-05, plus two more
 * elevated-error incidents on 2026-08-04. Direct-only would turn each of those
 * into a hard outage for every non-streamed Claude call.
 *
 * A bonus: over SSE, a forced tool arrives as a REAL `tool_use` block with
 * clean `input_json_delta` fragments — not the malformed `<tool_calls>`
 * pseudo-tag the non-streaming path has to reverse-engineer.
 */
async function callKieMessagesCollapsed(model: LlmModelDef, req: LlmRequest): Promise<LlmResponse> {
  // No caller wants the tokens — this is the non-streaming entry point.
  //
  // KIE's Claude stream fails transiently roughly 1 call in 5 (measured 2026-08-06: 3/4, 5/6,
  // 6/6 across samples), almost always as a single `event: error` frame that a retry clears.
  // This is the LAST lane — it only runs because the direct one already failed — so one extra
  // attempt is the difference between ~80% and ~96% availability during an Anthropic incident.
  // An error frame that arrives AFTER `message_delta` reported usage is a billed answer and is
  // not retried; `withTransportRetry` makes that call, not this lane.
  return withTransportRetry(model.id, req, () => streamKieMessages(model, req, () => {}))
}

// -- Responses format (GPT family + Grok) --

/**
 * KIE serves the responses dialect under a per-family path prefix — the GPT
 * models live at codex/v1/responses, Grok at grok/v1/responses (live-verified
 * 2026-08-18; the wrong prefix is a hard 4xx/5xx, not a graceful alias).
 * Derived from the registry's `vendor` so a future responses-format model on a
 * new vendor fails loudly HERE instead of silently posting to another family's
 * endpoint.
 */
function kieResponsesUrl(model: LlmModelDef): string {
  const family =
    model.vendor === "openai" ? "codex"
    : model.vendor === "xai" ? "grok"
    : undefined
  if (!family) {
    throw new Error(`llm-client: no KIE responses endpoint family for vendor "${model.vendor}" (model ${model.id})`)
  }
  return `${KIE_API_BASE}/${family}/v1/responses`
}

async function callKieResponses(model: LlmModelDef, req: LlmRequest): Promise<LlmResponse> {
  const url = kieResponsesUrl(model)
  // Responses API models are reasoning models — temperature is unsupported
  const { eff, maxTokens } = deriveParams(model, req)
  const body: Record<string, unknown> = {
    model: model.kieSlugOrModel,
    input: buildResponsesInput(req),
    stream: false,
    ...(eff !== undefined ? { reasoning: { effort: eff } } : {}),
  }
  if (req.maxTokens !== undefined || eff === "xhigh" || eff === "max") body.max_output_tokens = maxTokens
  const textFormat = kieResponsesTextFormat(model, req)
  if (textFormat) body.text = textFormat

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.KIE_API_KEY}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(effectiveTimeout(req)),
  })

  if (!response.ok) {
    const errText = await response.text()
    throw new Error(`KIE.ai responses ${model.id} failed (${response.status}): ${errText}`)
  }

  const data = await response.json() as Record<string, unknown>
  assertKieEnvelope(data, model.id, "responses")
  const output = data.output as Array<Record<string, unknown>> | undefined
  const textItem = output?.find((o) => o.type === "message")
  const contentArr = (textItem?.content as Array<Record<string, unknown>>) ?? []
  const textBlock = contentArr.find((c) => c.type === "output_text")
  const text = (textBlock?.text as string) ?? ""
  const usage = data.usage as Record<string, number> | undefined
  // The responses dialect states an unfinished reply as `status: "incomplete"`
  // plus a reason — "max_output_tokens" is the cap.
  const incompleteReason = data.status === "incomplete"
    ? (data.incomplete_details as Record<string, unknown> | undefined)?.reason
    : undefined

  return buildResponse(
    model,
    text,
    { stopReason: incompleteReason, cap: body.max_output_tokens as number | undefined },
    usage ? { inputTokens: usage.input_tokens ?? 0, outputTokens: usage.output_tokens ?? 0 } : undefined,
    extractActualUsd(data),
    "kie",
    req,
  )
}

async function streamKieResponses(
  model: LlmModelDef, req: LlmRequest, onToken: (chunk: string) => void, signal?: AbortSignal,
): Promise<LlmResponse> {
  const url = kieResponsesUrl(model)
  // Responses API models are reasoning models — temperature is unsupported
  const { eff, maxTokens } = deriveParams(model, req)
  const body: Record<string, unknown> = {
    model: model.kieSlugOrModel,
    input: buildResponsesInput(req),
    stream: true,
    ...(eff !== undefined ? { reasoning: { effort: eff } } : {}),
  }
  if (req.maxTokens !== undefined || eff === "xhigh" || eff === "max") body.max_output_tokens = maxTokens
  const textFormat = kieResponsesTextFormat(model, req)
  if (textFormat) body.text = textFormat

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.KIE_API_KEY}` },
    body: JSON.stringify(body),
    signal: signal ?? AbortSignal.timeout(effectiveTimeout(req)),
  })

  if (!response.ok) {
    const errText = await response.text()
    throw new Error(`KIE.ai responses stream ${model.id} failed (${response.status}): ${errText}`)
  }

  return parseSseStream(response, model.id, onToken, "responses", body.max_output_tokens as number | undefined)
}

/**
 * Serve a NON-streaming `responses` request over KIE's STREAMING wire,
 * collapsing the SSE into one response — the same shape as
 * `callKieMessagesCollapsed`, applied to a per-MODEL condition instead of a
 * lane-wide one.
 *
 * Measured 2026-09-06 on gpt-6-astra, 12 identical requests: `stream: false`
 * succeeded 2/6 (4–5 s) and 500'd 4/6 with `{"error":{"type":"server_error"}}`
 * after 34, 34, 35 and 64 s; the identical body with `stream: true` succeeded
 * 5/6 in the same 4–5 s. A schema-less non-stream call 500'd too, so the
 * json_schema is not the trigger — the non-stream lane is. The same endpoint
 * serves gpt-5.4/5.5/5.6 non-stream reliably, which is why the switch is a
 * registry flag on one model rather than a change to this whole format.
 *
 * Without it, `llmComplete` / `llmCompleteStructured` — every non-streaming
 * caller, including the llm-structured route the studio Director drafts on —
 * fail ~2 attempts in 3, and the structured route's 3 attempts turn that into
 * roughly a third of drafts dying after ~100 s of 500s.
 *
 * Cost note: KIE's SSE does not reliably carry `credits_consumed`, so
 * `parseSseStream` falls back to the rate-table estimate for `providerCost`.
 * That is the deliberate trade — an estimated cost on a call that succeeds
 * beats an exact cost on one that mostly doesn't.
 */
async function callKieResponsesCollapsed(model: LlmModelDef, req: LlmRequest): Promise<LlmResponse> {
  // No caller wants the tokens — this is the non-streaming entry point.
  // ONE deadline for both attempts: the caller's `timeoutMs` stays a bound on
  // the whole call. Without a shared signal each attempt gets its own full
  // budget and a timed-out first attempt buys the second another 120 s (240 s
  // on the structured route) — the retry exists to clear a FAST silent close,
  // not to double every slow failure.
  const signal = AbortSignal.timeout(effectiveTimeout(req))
  const once = async () => {
    const res = await streamKieResponses(model, req, () => {}, signal)
    // A stream that ENDS without ever emitting text is a failure, and must be
    // thrown rather than returned as an empty success. Only an `event: error`
    // frame makes parseSseStream throw; a stream that dies after
    // `response.created` — which is what the probe's one silent failure looked
    // like from here — just runs out of chunks and returns `text: ""` with the
    // reader closed and nothing raised. That empty string is indistinguishable
    // from a real answer to every caller: llm-chat hands it to the user as a
    // successful reply, and llmCompleteStructured turns `JSON.parse("")` into a
    // fake `assistant: "{}"` correction turn. The non-streaming lane this
    // replaces 500'd in that situation, so returning "" would be a REGRESSION in
    // failure honesty. Throwing inside `once()` puts it on the retry below,
    // which is what the probe showed clears it. `!res.text` is the honest test:
    // the responses dialect carries structured output as `output_text` too, so
    // no legitimate reply of any shape is empty here.
    //
    // Which ERROR it is decides whether the retry may run. A stream that closed before any
    // `response.completed` reported nothing and cost nothing — a plain throw, retryable. One
    // that completed WITH usage and still carried no text is the provider answering (badly)
    // and billing for it, so it throws the usage-carrying shape and is never re-dialled: a
    // second call would be a second charge for the same empty answer.
    if (!res.text) {
      const detail = `KIE.ai responses stream ${model.id} closed without output (no text before end of stream)`
      if (res.usage) {
        throw new LlmStreamResponseError(detail, {
          inputTokens: res.usage.inputTokens, outputTokens: res.usage.outputTokens,
          providerCost: res.providerCost, complete: res.providerCost !== undefined,
        })
      }
      throw new Error(detail)
    }
    return res
  }

  // 1 of the 6 streaming probes produced no `response.completed` (a silent failure / error
  // frame) after 35 s, which a retry clears — both shapes arrive as a throw (the error frame
  // from parseSseStream, the silent close from the guard above). Bounded at one attempt: for a
  // responses-format model there is no direct-vendor lane behind this, so a genuinely down
  // endpoint must still surface fast rather than multiply the caller's wait, and the SHARED
  // deadline is checked before a second attempt is started at all.
  const res = await withTransportRetry(model.id, req, once, () => signal.aborted)

  // This lane bypasses `buildResponse`, so the media fail-open guard has to be
  // re-applied by hand — otherwise a `kieCollapseStream` model would be the one
  // KIE format that silently ignores `minPromptTokens`, which the field's
  // docstring promises on all three. Deliberately OUTSIDE the retry: an
  // un-ingested media answer is the provider answering, not the stream failing,
  // and re-asking costs a second billed call for no better odds — the same
  // no-retry treatment `callKieResponses` gives it through `buildResponse`.
  assertMediaIngested(model, req, res.usage)
  return res
}

// ---------------------------------------------------------------------------
// Direct Anthropic SDK fallback
// ---------------------------------------------------------------------------

/**
 * The ONE request body the direct Anthropic lane sends for forced single-tool
 * structured output, shared by the one-shot call and the stream
 * ({@link llmStreamStructured}) so the two can never ask differently.
 *
 * Temperature is intentionally omitted: newer Anthropic models (e.g.
 * opus-4.7) reject it.
 */
function anthropicStructuredRequest(
  model: LlmModelDef,
  req: LlmRequest,
  jsonSchema: NonNullable<LlmRequest["jsonSchema"]>,
): { body: Record<string, unknown>; options: { timeout: number }; maxTokens: number } {
  const { eff, maxTokens } = deriveParams(model, req)
  return {
    body: {
      model: model.directFallbackModel!,
      max_tokens: maxTokens,
      system: req.system,
      messages: buildAnthropicMessages(req),
      tools: [{
        name: jsonSchema.name,
        description: "Emit the structured result.",
        input_schema: jsonSchema.schema as Anthropic.Messages.Tool.InputSchema,
      }],
      tool_choice: { type: "tool", name: jsonSchema.name },
      ...(eff !== undefined ? { thinking: { type: "adaptive" as const }, output_config: { effort: eff } } : {}),
    },
    options: { timeout: effectiveTimeout(req) },
    maxTokens,
  }
}

/** The forced tool's input, serialized as `text` so the rest of the pipeline
 *  (and llmCompleteStructured) treats it like any JSON completion. Anthropic's
 *  own API served it, so it is costed on the direct band, not KIE's.
 *
 *  A streamed call passes the tool input's raw JSON (`streamedJson`): the
 *  stream's final message carries the SDK's partial-JSON parse of it, which
 *  misreads numbers (`1e-3` comes back as 13), so the bytes the model wrote
 *  are the answer. A forced tool with an empty input streams no bytes; the
 *  final message's input is read then, as the one-shot call reads it. */
function anthropicToolResponse(
  model: LlmModelDef,
  message: Pick<Anthropic.Messages.Message, "content" | "usage" | "stop_reason">,
  maxTokens: number,
  streamedJson?: string,
): LlmResponse {
  const toolUse = message.content.find(
    (b): b is Anthropic.Messages.ToolUseBlock => b.type === "tool_use",
  )
  const usage = { inputTokens: message.usage.input_tokens, outputTokens: message.usage.output_tokens }
  return buildResponse(
    model,
    streamedJson || (toolUse ? JSON.stringify(toolUse.input) : ""),
    { stopReason: message.stop_reason, cap: maxTokens },
    usage,
    undefined,
    "direct",
  )
}

async function callAnthropicDirect(model: LlmModelDef, req: LlmRequest): Promise<LlmResponse> {
  const anthropic = getAnthropicClient()

  // Forced single-tool structured output: guaranteed schema-shaped JSON.
  if (req.jsonSchema && model.structuredOutputMode === "anthropic-tool") {
    const { body, options, maxTokens } = anthropicStructuredRequest(model, req, req.jsonSchema)
    const response = await anthropic.messages.create(
      body as unknown as Anthropic.Messages.MessageCreateParamsNonStreaming,
      options,
    )
    return anthropicToolResponse(model, response, maxTokens)
  }

  const { eff, temperature, maxTokens } = deriveParams(model, req)
  const response = await anthropic.messages.create(
    {
      model: model.directFallbackModel!,
      max_tokens: maxTokens,
      ...(temperature !== undefined ? { temperature } : {}),
      system: req.system,
      messages: buildAnthropicMessages(req),
      ...(eff !== undefined ? { thinking: { type: "adaptive" as const }, output_config: { effort: eff } } : {}),
    } as unknown as Anthropic.Messages.MessageCreateParamsNonStreaming,
    { timeout: effectiveTimeout(req) },
  )

  const textBlock = response.content.find((b) => b.type === "text")
  const usage = { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens }
  return buildResponse(
    model,
    textBlock?.text ?? "",
    { stopReason: response.stop_reason, cap: maxTokens },
    usage,
    undefined,
    "direct",
  )
}

async function streamAnthropicDirect(
  model: LlmModelDef, req: LlmRequest, onToken: (chunk: string) => void, signal?: AbortSignal,
): Promise<LlmResponse> {
  const anthropic = getAnthropicClient()
  const { eff, temperature, maxTokens } = deriveParams(model, req)
  const stream = anthropic.messages.stream(
    {
      model: model.directFallbackModel!,
      max_tokens: maxTokens,
      ...(temperature !== undefined ? { temperature } : {}),
      system: req.system,
      messages: buildAnthropicMessages(req),
      ...(eff !== undefined ? { thinking: { type: "adaptive" as const }, output_config: { effort: eff } } : {}),
    } as unknown as Anthropic.Messages.MessageCreateParamsStreaming,
    { timeout: effectiveTimeout(req) },
  )

  // Abort stream if caller signals (e.g. client disconnect)
  if (signal) {
    signal.addEventListener("abort", () => stream.abort(), { once: true })
  }

  let fullText = ""
  stream.on("text", (delta) => {
    fullText += delta
    onToken(delta)
  })

  const finalMessage = await stream.finalMessage()
  const usage = { inputTokens: finalMessage.usage.input_tokens, outputTokens: finalMessage.usage.output_tokens }
  return buildResponse(
    model,
    fullText,
    { stopReason: finalMessage.stop_reason, cap: maxTokens },
    usage,
    undefined,
    "direct",
  )
}

/**
 * A forced-tool structured answer, streamed on the direct Anthropic lane:
 * each raw `input_json_delta` fragment reaches `onToolJson` as the model
 * writes it. The request is {@link anthropicStructuredRequest}'s — the one-shot
 * call's body, byte for byte — and the response is built the same way, so
 * usage, cost band and the cap-stop rule are unchanged. With adaptive thinking
 * on, the thinking finishes before the first fragment arrives.
 *
 * Fragments are read from the raw `streamEvent`s, not the SDK's `inputJson`
 * event, which fires only when its partial parse of the input is truthy: the
 * caller's parser and the answer (`anthropicToolResponse`) read every byte.
 *
 * The SDK's `timeout` bounds only the wait for response headers, so the
 * stream gets the one-shot call's whole-call budget here. A failure after
 * `message_start` (the request was accepted and its input billed) is thrown
 * as a usage-carrying {@link LlmStreamResponseError}, so it is never re-asked
 * and the job can record what it cost.
 */
async function streamAnthropicStructured(
  model: LlmModelDef,
  req: LlmRequest,
  jsonSchema: NonNullable<LlmRequest["jsonSchema"]>,
  onToolJson: (partialJson: string, jsonSnapshot: unknown) => void,
  signal?: AbortSignal,
): Promise<LlmResponse> {
  const anthropic = getAnthropicClient()
  const { body, options, maxTokens } = anthropicStructuredRequest(model, req, jsonSchema)
  const stream = anthropic.messages.stream(
    body as unknown as Anthropic.Messages.MessageCreateParamsStreaming,
    options,
  )
  let timedOut = false
  const deadline = setTimeout(() => {
    timedOut = true
    stream.abort()
  }, options.timeout)
  const abort = (): void => stream.abort()
  if (signal?.aborted) abort()
  else signal?.addEventListener("abort", abort, { once: true })

  let started: Anthropic.Messages.Message | undefined
  let toolJson = ""
  stream.on("streamEvent", (event, snapshot) => {
    started = snapshot
    if (event.type !== "content_block_delta" || event.delta.type !== "input_json_delta") return
    toolJson += event.delta.partial_json
    const block = snapshot.content[event.index]
    onToolJson(event.delta.partial_json, block?.type === "tool_use" ? block.input : undefined)
  })

  let finalMessage: Anthropic.Messages.Message
  try {
    finalMessage = await stream.finalMessage()
  } catch (err) {
    const failure = timedOut
      ? new Error(`llm-client: ${model.id} structured stream exceeded its ${options.timeout} ms budget`, { cause: err })
      : err
    if (!started) throw failure
    throw startedStreamFailure(model, failure, started.usage)
  } finally {
    clearTimeout(deadline)
    signal?.removeEventListener("abort", abort)
  }
  return anthropicToolResponse(model, finalMessage, maxTokens, toolJson)
}

/** A streamed call that failed after the provider accepted (and billed) it:
 *  the usage the stream reported so far rides the error. */
function startedStreamFailure(
  model: LlmModelDef,
  err: unknown,
  usage: Anthropic.Messages.Usage,
): LlmStreamResponseError {
  const inputTokens = usage.input_tokens
  const outputTokens = usage.output_tokens
  const failure = new LlmStreamResponseError(err instanceof Error ? err.message : String(err), {
    inputTokens,
    outputTokens,
    providerCost: calculateLlmCost(model, { inputTokens, outputTokens }, "direct"),
    complete: false,
  })
  failure.cause = err
  return failure
}

// ---------------------------------------------------------------------------
// SSE stream parser
// ---------------------------------------------------------------------------

/**
 * The authoritative answer text a `responses` terminal frame states outright.
 *
 * The responses dialect says the answer TWICE: once as a long run of
 * `response.output_text.delta` fragments, and once verbatim inside
 * `response.completed` (`response.output[].content[].text`) and
 * `response.output_text.done` (`text`). Measured on KIE `codex/v1/responses`
 * with gpt-6-astra (2026-09-14, 56 frames for a 104-character answer): the
 * deltas are ONE TO THREE CHARACTERS each, so a single lost frame is a single
 * lost character — exactly the corruption the Scene3D planner kept being
 * blamed for (`"seed":370◀c dropped▶a086`, `[-0.4,-0.6,0.8◀] dropped▶}}`).
 *
 * Concatenated in arrival order, because a multi-part answer states each part
 * separately and the deltas concatenate the same way. Returns undefined — not
 * "" — when the frame states no text at all, so "the provider said the answer
 * is empty" stays distinguishable from "the provider never said".
 */
function responsesFrameText(resp: Record<string, unknown> | undefined): string | undefined {
  const output = resp?.output as Array<Record<string, unknown>> | undefined
  if (!Array.isArray(output)) return undefined
  let text: string | undefined
  for (const item of output) {
    const content = item?.content as Array<Record<string, unknown>> | undefined
    if (!Array.isArray(content)) continue
    for (const block of content) {
      if (block?.type !== "output_text") continue
      const t = block.text
      if (typeof t === "string") text = (text ?? "") + t
    }
  }
  return text
}

/** First index at which two strings differ, or -1 when they are identical. */
function firstDivergence(a: string, b: string): number {
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i
  return a.length === b.length ? -1 : n
}

/**
 * Decide what a `responses` stream actually delivered — the one place that can.
 *
 * Three verdicts, in the order they are checked:
 *
 * 1. **The provider stated the text and it disagrees with the deltas.** The
 *    statement wins and the divergence is logged. A delta frame that never
 *    arrived (ours or KIE's relay) is repaired here instead of reaching the
 *    caller as a one-character-corrupt document, which is indistinguishable
 *    from a model that writes bad JSON and was charged to the brief every time
 *    it happened.
 * 2. **The stream ended with no terminal sentinel** — no `response.completed`,
 *    no `[DONE]`. That is a CUT CONNECTION, not an answer: returning the bytes
 *    that did arrive is what turned a truncated 14,414-character draft into a
 *    "planner output invalid" verdict (job 0671503e, 2026-09-13). It throws a
 *    plain Error, which carries no usage, so `transportRetryable` re-dials it.
 * 3. **A `sequence_number` gap with nothing authoritative to repair it.** Every
 *    responses frame carries a globally contiguous `sequence_number` (verified
 *    0..55 with no gaps on a clean live stream); a gap is positive proof a
 *    frame was lost. Also a plain Error — transport, retryable, never the
 *    planner's fault.
 *
 * Exported for the byte-boundary/integrity suite; not part of the module's API.
 */
export function reconcileResponsesStreamText(opts: {
  modelId: string
  streamedText: string
  authoritativeText: string | undefined
  sawStreamEnd: boolean
  sequenceAnomaly: boolean
}): string {
  const { modelId, streamedText, authoritativeText, sawStreamEnd, sequenceAnomaly } = opts

  // Logged whether or not it is repairable: this lane had NO telemetry at all,
  // so how often KIE's relay loses a frame was unknowable — which is why three
  // rounds of one-character corruption could not be attributed either way.
  if (sequenceAnomaly) {
    console.warn(
      `[llm-kie-stream-gap] ${modelId} SSE sequence_number was not contiguous — a frame was lost or reordered`,
    )
  }

  if (authoritativeText !== undefined) {
    if (authoritativeText !== streamedText) {
      console.warn(
        `[llm-kie-stream-mismatch] ${modelId} delta stream disagrees with the provider's stated answer: ` +
          `streamed ${streamedText.length} chars, stated ${authoritativeText.length} chars, ` +
          `first divergence at ${firstDivergence(streamedText, authoritativeText)} — using the stated answer`,
      )
    }
    return authoritativeText
  }

  if (!sawStreamEnd) {
    throw new Error(
      `KIE.ai responses stream ${modelId} ended without a terminal event ` +
        `(no response.completed, no [DONE]) after ${streamedText.length} chars — the connection was cut mid-answer`,
    )
  }

  if (sequenceAnomaly) {
    throw new Error(
      `KIE.ai responses stream ${modelId} lost or reordered an SSE frame ` +
        `(sequence_number gap) and the stream stated no authoritative text to repair it from ` +
        `— the ${streamedText.length}-char answer is incomplete`,
    )
  }

  return streamedText
}

async function parseSseStream(
  response: Response,
  modelId: string,
  onToken: (chunk: string) => void,
  format: "chat-completions" | "messages" | "responses",
  /** The output cap sent — `ReplyEnd.cap`; required so no stream lane skips the cap check. */
  cap: ReplyEnd["cap"],
): Promise<LlmResponse> {
  const reader = response.body?.getReader()
  if (!reader) throw new Error("No response body for SSE stream")

  const decoder = new TextDecoder()
  let fullText = ""
  // How the provider said the reply ended — chat-completions puts it on the
  // last chunk's `finish_reason`, Claude on `message_delta.delta.stop_reason`.
  // (A responses stream states a cap stop as `response.incomplete`, below.)
  let stopReason: unknown
  // Forced-tool output arrives as `input_json_delta` fragments rather than text.
  // Accumulated separately and NEVER pushed through `onToken` — it is a JSON
  // payload, not display text — then used as the response body when no text
  // block came back. This is what lets a structured call be served off the
  // streaming wire (see callKieMessagesCollapsed).
  let toolJson = ""
  let usage: { inputTokens: number; outputTokens: number } | undefined
  // KIE's Claude SSE DOES carry `credits_consumed` (verified 2026-08-06 —
  // 0.09 and 0.13 on live streams), so the collapsed non-streaming path keeps
  // real actual-cost capture instead of silently dropping to the rate-table
  // estimate. Which event carries it varies, so any event that has it wins.
  let actualUsd: number | undefined
  let buffer = ""
  let firstChunk = true
  // --- `responses` stream integrity (see reconcileResponsesStreamText) -------
  /** A terminal sentinel was seen: `response.completed`, or the `[DONE]` line. */
  let sawStreamEnd = false
  /** The provider's own statement of the answer, from `response.completed` (whole
   *  answer) or, failing that, the `response.output_text.done` parts in order. */
  let completedText: string | undefined
  let donePartsText: string | undefined
  /** A `sequence_number` that was not `previous + 1` — a lost or reordered frame. */
  let sequenceAnomaly = false
  let lastSequence: number | undefined

  try {
    readEvents: while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })

      // KIE returns 200 + `{"code":N,"msg":"..."}` JSON envelope (not SSE) for
      // service errors. Detect on the first chunk: SSE always begins with
      // `data:`/`event:`/comment, never `{`.
      if (firstChunk) {
        firstChunk = false
        if (buffer.trimStart().startsWith("{")) {
          while (true) {
            const r = await reader.read()
            if (r.done) break
            buffer += decoder.decode(r.value, { stream: true })
          }
          let envelope: unknown = null
          try { envelope = JSON.parse(buffer) } catch { /* not JSON */ }
          assertKieEnvelope(envelope, modelId, `${format} stream`)
          throw new Error(`KIE.ai ${format} stream ${modelId}: expected SSE, got JSON: ${buffer.slice(0, 200)}`)
        }
      }

      const lines = buffer.split("\n")
      buffer = lines.pop() ?? ""

      for (const line of lines) {
        // The space after `data:` is OPTIONAL in the SSE spec. KIE sends one
        // today; a relay that stopped would make every frame invisible here and
        // the stream would return "" as a successful answer. `.trim()` then
        // absorbs both the optional space and a `\r\n` line ending.
        if (!line.startsWith("data:")) continue
        const payload = line.slice(5).trim()
        if (payload === "[DONE]") {
          sawStreamEnd = true
          continue
        }

        let parsed: Record<string, unknown>
        try {
          parsed = JSON.parse(payload)
        } catch {
          continue
        }

        // Every responses frame carries a globally contiguous `sequence_number`
        // (measured 0..55, no gaps, on a clean live stream). Tracked for ALL
        // formats because it costs nothing and is absent everywhere else, so a
        // dialect that grows one is covered the day it does.
        const sequence = parsed.sequence_number
        if (typeof sequence === "number" && Number.isFinite(sequence)) {
          if (lastSequence !== undefined && sequence !== lastSequence + 1) sequenceAnomaly = true
          lastSequence = sequence
        }

        // An SSE `event: error` frame carries `{"type":"error","error":{...}}`.
        // No normal event uses that type, so the match is unambiguous. Without
        // this the frame falls through every format branch and the stream ends
        // with whatever text arrived before it — an EMPTY string when the error
        // came first, returned as a successful response. That is the silent
        // failure mode: no throw means llmStream's catch never runs, so the
        // direct-Anthropic fallback is skipped and the caller is handed an
        // empty completion. Observed on KIE's Claude stream in 1 of 6 plain
        // requests (2026-08-06). Throwing puts a pre-token failure back on the
        // fallback path and surfaces a mid-stream one, per streamWithFallback's
        // tainted-stream rule.
        //
        // Which SHAPE it throws is the billing decision, and this is the only place that can
        // make it: an error frame that arrives before any usage was reported cost nothing and
        // is transport-retryable, while one that arrives after `message_delta` / a completed
        // response already reported usage is a billed answer and must never be re-asked. The
        // usage rides the throw either way so the job is charged for what it really spent.
        if (parsed.type === "error") {
          const e = parsed.error as { message?: string; type?: string } | undefined
          const detail =
            `KIE.ai ${format} stream ${modelId} returned an error event: ${e?.type ?? "unknown"}: ${e?.message ?? JSON.stringify(parsed).slice(0, 200)}`
          if (usage) {
            const providerCost = actualUsd ?? calculateLlmCost(modelId, usage)
            throw new LlmStreamResponseError(detail, {
              inputTokens: usage.inputTokens, outputTokens: usage.outputTokens,
              providerCost, complete: providerCost !== undefined,
            })
          }
          throw new Error(detail)
        }

        actualUsd = extractActualUsd(parsed) ?? actualUsd

        if (format === "chat-completions") {
          const choices = parsed.choices as Array<Record<string, unknown>> | undefined
          const delta = choices?.[0]?.delta as Record<string, unknown> | undefined
          const text = delta?.content as string | undefined
          if (text) {
            fullText += text
            onToken(text)
          }
          const finishReason = choices?.[0]?.finish_reason
          if (typeof finishReason === "string" && finishReason) stopReason = finishReason
          if (parsed.usage) {
            const u = parsed.usage as Record<string, number>
            usage = { inputTokens: u.prompt_tokens ?? 0, outputTokens: u.completion_tokens ?? 0 }
          }
        } else if (format === "messages") {
          const eventType = parsed.type as string | undefined
          if (eventType === "content_block_delta") {
            const delta = parsed.delta as Record<string, unknown> | undefined
            const text = delta?.text as string | undefined
            if (text) {
              fullText += text
              onToken(text)
            }
            const partial = delta?.partial_json as string | undefined
            if (partial) toolJson += partial
          }
          if (eventType === "message_delta") {
            const u = parsed.usage as Record<string, number> | undefined
            if (u) {
              usage = { inputTokens: u.input_tokens ?? 0, outputTokens: u.output_tokens ?? 0 }
            }
            const d = parsed.delta as Record<string, unknown> | undefined
            if (d?.stop_reason) stopReason = d.stop_reason
          }
        } else if (format === "responses") {
          const eventType = parsed.type as string | undefined
          if (eventType === "response.output_text.delta") {
            const text = parsed.delta as string | undefined
            if (text) {
              fullText += text
              onToken(text)
            }
          }
          // The provider restating one finished content part verbatim. Kept as
          // the fallback authority for a stream that is cut after the parts are
          // done but before `response.completed`.
          if (eventType === "response.output_text.done") {
            const text = parsed.text
            if (typeof text === "string") donePartsText = (donePartsText ?? "") + text
          }
          if (eventType === "response.completed" || eventType === "response.incomplete" || eventType === "response.failed") {
            const resp = parsed.response as Record<string, unknown> | undefined
            const u = resp?.usage as Record<string, number> | undefined
            if (u) {
              usage = { inputTokens: u.input_tokens ?? 0, outputTokens: u.output_tokens ?? 0 }
            }
            actualUsd = extractActualUsd(resp ?? {}) ?? actualUsd
            if (eventType === "response.completed") {
              sawStreamEnd = true
              completedText = responsesFrameText(resp)
            }
            if (eventType !== "response.completed") {
              const providerCost = actualUsd ?? (usage ? calculateLlmCost(modelId, usage) : undefined)
              // The provider's own reason, not just the event name. `response.incomplete`
              // carries `incomplete_details.reason` ("max_output_tokens", "content_filter")
              // and `response.failed` carries `error.code`/`error.message` — the difference
              // between "raise the output budget" and "the endpoint is failing", which the
              // event name alone cannot tell apart. Logged too: this throw is the only
              // record that the call ended, and it had NO log line, so a caller that
              // rewrites the message (as the Scene3D planner did) left nothing behind.
              const reason = terminalResponseReason(resp)
              const detail = `KIE.ai responses stream ${modelId} ended with ${eventType}` +
                (reason ? `: ${reason}` : "") +
                ` (in ${usage?.inputTokens ?? 0} / out ${usage?.outputTokens ?? 0} tokens)`
              console.warn(`[llm-kie-stream-terminal] ${detail}`)
              const failureUsage = {
                inputTokens: usage?.inputTokens ?? 0, outputTokens: usage?.outputTokens ?? 0,
                providerCost, complete: usage !== undefined && providerCost !== undefined,
              }
              // A cap stop is the truncation every other lane reports as
              // `LlmOutputTruncatedError` (#1588): same class and opening sentence
              // there, with this lane's own diagnostic kept in the parentheses.
              const incomplete = (resp?.incomplete_details as Record<string, unknown> | undefined)?.reason
              if (isOutputCapStop(incomplete)) {
                throw new LlmOutputTruncatedError(`${outputCappedMessage()} (${detail})`, failureUsage)
              }
              throw new LlmStreamResponseError(detail, failureUsage)
            }
            // This event completes the response even if the HTTP connection stays
            // open. Preserve its usage, then release the reader in finally.
            break readEvents
          }
        }
      }
    }
  } finally {
    reader.cancel().catch(() => {})
  }

  // The delta run is a RECONSTRUCTION; the terminal frames are the provider's
  // own statement of the answer. Where they disagree the statement wins, and a
  // stream that stated nothing and never terminated is a cut connection rather
  // than a short answer. Scoped to `responses` because it is the only dialect
  // that restates the text — the Claude `messages` and chat-completions lanes
  // carry deltas only, and have their own end-of-stream contracts.
  if (format === "responses") {
    fullText = reconcileResponsesStreamText({
      modelId,
      streamedText: fullText,
      authoritativeText: completedText ?? donePartsText,
      sawStreamEnd,
      sequenceAnomaly,
    })
  }

  // Real billing beats the estimate, same precedence as the non-streaming path.
  const providerCost = actualUsd ?? (usage ? calculateLlmCost(modelId, usage) : undefined)
  // Last, so a streamed caller has already shown every token it received — the
  // throw is what stops those tokens being saved as a finished answer.
  assertNotOutputCapped({ modelId, lane: `kie ${format} stream`, stopReason, cap, usage, providerCost })

  return {
    // Text wins when present; the accumulated tool payload is the body only for
    // a forced-tool call, which emits no text block at all.
    text: fullText || toolJson,
    usage,
    model: modelId,
    providerCost,
  }
}
