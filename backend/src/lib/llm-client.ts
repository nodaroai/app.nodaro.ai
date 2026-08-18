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
import { getLlmModel, LLM_FEATURE_DEFAULTS, effectiveReasoningEffort } from "@nodaro/shared"
import type { LlmModelDef, LlmFeature, LlmReasoningEffort } from "@nodaro/shared"
import { calculateLlmCost, type LlmServingLane } from "./pricing/llm-cost.js"
import { getAnthropicClient } from "./anthropic.js"
import { callGeminiDirect, streamGeminiDirect } from "./gemini/client.js"
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
   * where `buildResponse` sees both the request and the reported usage. It is
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

export async function llmComplete(req: LlmRequest): Promise<LlmResponse> {
  const model = resolveModel(req)

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
      if (emitted) throw err
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
    if (emitted) throw err
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
  const schemaName = opts?.schemaName ?? "result"
  const retries = Math.max(0, opts?.maxRetries ?? 2)
  // Draft-7 keeps Anthropic's tool input_schema happy; strip the $schema marker.
  // io:"input" mirrors zod-to-json-schema's semantics (defaulted fields optional).
  const jsonSchema = restrictObjectSchemas(
    z.toJSONSchema(schema, { target: "draft-7", unrepresentable: "any", io: "input" }) as Record<string, unknown>,
  )
  delete jsonSchema.$schema

  let messages = req.messages
  let lastError = ""
  // Accumulate usage across ALL attempts: a retried call really is billed for
  // every attempt (each re-sends the prompt — incl. multimodal refs), so the
  // returned cost must reflect the full spend, not just the winning attempt.
  // Otherwise jobs.provider_cost under-reports vs the real KIE/Anthropic bill
  // and the credit-anomaly / "actual" audit drifts negative.
  let inTokens = 0
  let outTokens = 0
  let cost = 0
  let costSeen = false
  for (let attempt = 0; attempt <= retries; attempt++) {
    const resp = await llmComplete({ ...req, messages, jsonSchema: { name: schemaName, schema: jsonSchema } })
    inTokens += resp.usage?.inputTokens ?? 0
    outTokens += resp.usage?.outputTokens ?? 0
    if (resp.providerCost != null) { cost += resp.providerCost; costSeen = true }

    let parsedJson: unknown
    try {
      parsedJson = JSON.parse(extractJsonFromAIResponse(resp.text))
    } catch {
      lastError = "Output was not valid JSON."
      messages = withCorrection(messages, resp.text, lastError)
      continue
    }

    const result = schema.safeParse(parsedJson)
    if (result.success) {
      return {
        output: result.data,
        inputTokens: inTokens,
        outputTokens: outTokens,
        providerCost: costSeen ? cost : undefined,
      }
    }
    lastError = result.error.issues.slice(0, 8).map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ")
    messages = withCorrection(messages, resp.text, lastError)
  }
  throw new Error(`llm-structured: validation failed after ${retries + 1} attempt(s): ${lastError}`)
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
 *  models that reject it), and the output-token cap (raised to 32768 whenever
 *  reasoning tokens share the budget — at xhigh/max, or on ANY call to a
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
  if (eff === "xhigh" || eff === "max" || model.thinkingDefaultOn) {
    maxTokens = Math.max(maxTokens, 32768)
  }
  return { eff, temperature, topP, maxTokens }
}

// ---------------------------------------------------------------------------
// Shared message builders
// ---------------------------------------------------------------------------

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
  return {
    text,
    usage,
    model: model.id,
    providerCost: actualUsd ?? tableEstimate,
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
      return callKieResponses(model, req)
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

  return parseSseStream(response, model.id, onToken, "chat-completions")
}

// -- Messages format (Claude models) --

async function callKieMessages(model: LlmModelDef, req: LlmRequest): Promise<LlmResponse> {
  const url = `${KIE_API_BASE}/claude/v1/messages`
  // KIE defaults stream to true for Claude — must explicitly set false
  const body = { ...buildMessagesBody(model, req), stream: false }

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
  const body = { ...buildMessagesBody(model, req), stream: true }

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

  return parseSseStream(response, model.id, onToken, "messages")
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
  const once = () => streamKieMessages(model, req, () => {})
  try {
    return await once()
  } catch (err) {
    // KIE's Claude stream fails transiently roughly 1 call in 5 (measured
    // 2026-08-06: 3/4, 5/6, 6/6 across samples), almost always as a single
    // `event: error` frame that a retry clears. This is the LAST lane — it only
    // runs because the direct one already failed — so one extra attempt is the
    // difference between ~80% and ~96% availability during an Anthropic
    // incident. Bounded at one: a genuinely down proxy must still surface fast.
    console.warn(`[llm-kie-stream-retry] ${model.id}: ${String(err).slice(0, 160)}`)
    return once()
  }
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

  return buildResponse(
    model,
    text,
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

  return parseSseStream(response, model.id, onToken, "responses")
}

// ---------------------------------------------------------------------------
// Direct Anthropic SDK fallback
// ---------------------------------------------------------------------------

async function callAnthropicDirect(model: LlmModelDef, req: LlmRequest): Promise<LlmResponse> {
  const anthropic = getAnthropicClient()
  const { eff, temperature, maxTokens } = deriveParams(model, req)

  // Forced single-tool structured output: guaranteed schema-shaped JSON. We
  // return the tool input serialized as `text` so the rest of the pipeline
  // (and llmCompleteStructured) treats it like any JSON completion. Temperature
  // is intentionally omitted — newer Anthropic models (e.g. opus-4.7) reject it.
  if (req.jsonSchema && model.structuredOutputMode === "anthropic-tool") {
    const toolName = req.jsonSchema.name
    const response = await anthropic.messages.create(
      {
        model: model.directFallbackModel!,
        max_tokens: maxTokens,
        system: req.system,
        messages: buildAnthropicMessages(req),
        tools: [{
          name: toolName,
          description: "Emit the structured result.",
          input_schema: req.jsonSchema.schema as Anthropic.Messages.Tool.InputSchema,
        }],
        tool_choice: { type: "tool", name: toolName },
        ...(eff !== undefined ? { thinking: { type: "adaptive" as const }, output_config: { effort: eff } } : {}),
      } as unknown as Anthropic.Messages.MessageCreateParamsNonStreaming,
      { timeout: effectiveTimeout(req) },
    )
    const toolUse = response.content.find(
      (b): b is Anthropic.Messages.ToolUseBlock => b.type === "tool_use",
    )
    const usage = { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens }
    // Anthropic's own API served this — cost it on the direct band, not KIE's.
    return buildResponse(model, toolUse ? JSON.stringify(toolUse.input) : "", usage, undefined, "direct")
  }

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
  return buildResponse(model, textBlock?.text ?? "", usage, undefined, "direct")
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
  return buildResponse(model, fullText, usage, undefined, "direct")
}

// ---------------------------------------------------------------------------
// SSE stream parser
// ---------------------------------------------------------------------------

async function parseSseStream(
  response: Response,
  modelId: string,
  onToken: (chunk: string) => void,
  format: "chat-completions" | "messages" | "responses",
): Promise<LlmResponse> {
  const reader = response.body?.getReader()
  if (!reader) throw new Error("No response body for SSE stream")

  const decoder = new TextDecoder()
  let fullText = ""
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

  try {
    while (true) {
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
        if (!line.startsWith("data: ")) continue
        const payload = line.slice(6).trim()
        if (payload === "[DONE]") continue

        let parsed: Record<string, unknown>
        try {
          parsed = JSON.parse(payload)
        } catch {
          continue
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
        if (parsed.type === "error") {
          const e = parsed.error as { message?: string; type?: string } | undefined
          throw new Error(
            `KIE.ai ${format} stream ${modelId} returned an error event: ${e?.type ?? "unknown"}: ${e?.message ?? JSON.stringify(parsed).slice(0, 200)}`,
          )
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
          if (eventType === "response.completed") {
            const resp = parsed.response as Record<string, unknown> | undefined
            const u = resp?.usage as Record<string, number> | undefined
            if (u) {
              usage = { inputTokens: u.input_tokens ?? 0, outputTokens: u.output_tokens ?? 0 }
            }
          }
        }
      }
    }
  } finally {
    reader.cancel().catch(() => {})
  }

  return {
    // Text wins when present; the accumulated tool payload is the body only for
    // a forced-tool call, which emits no text block at all.
    text: fullText || toolJson,
    usage,
    model: modelId,
    // Real billing beats the estimate, same precedence as the non-streaming path.
    providerCost: actualUsd ?? (usage ? calculateLlmCost(modelId, usage) : undefined),
  }
}
