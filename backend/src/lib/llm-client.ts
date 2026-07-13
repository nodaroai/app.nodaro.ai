/**
 * Unified LLM client — routes requests through KIE.ai with Anthropic SDK fallback.
 *
 * Supports three KIE.ai API formats:
 * - chat-completions (Gemini, GPT-5.2): POST /{slug}/v1/chat/completions
 * - messages (Claude models): POST /claude/v1/messages
 * - responses (GPT-5.4): POST /api/v1/responses
 */

import type Anthropic from "@anthropic-ai/sdk"
import { config } from "./config.js"
import { getLlmModel, LLM_FEATURE_DEFAULTS, effectiveReasoningEffort } from "@nodaro/shared"
import type { LlmModelDef, LlmFeature, LlmReasoningEffort } from "@nodaro/shared"
import { calculateLlmCost } from "./pricing/llm-cost.js"
import { getAnthropicClient } from "./anthropic.js"
import { KIE_API_BASE } from "../providers/kie/client.js"
import { z, type ZodType } from "zod"
import { extractJsonFromAIResponse } from "./json-utils.js"
import { restrictObjectSchemas } from "./json-schema-strict.js"

const LLM_TIMEOUT_MS = 120_000

// KIE Claude-proxy passthrough facts. When false, the affected request class
// routes direct-Anthropic instead of through KIE.
const KIE_CLAUDE_EFFORT_VERIFIED = false // thinking/output_config passthrough NOT verified — effort-carrying calls route direct
const KIE_CLAUDE_TOOLS_VERIFIED = true   // forced tool_choice passthrough verified 2026-07-13

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type LlmContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; url: string }
  | { type: "image_base64"; mediaType: string; data: string }
  | { type: "video"; url: string; mimeType?: string }
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

  if (model.directFallbackModel && config.ANTHROPIC_API_KEY) {
    const eff = effectiveReasoningEffort(model.id, req.reasoningEffort)
    const mustDirect =
      (req.jsonSchema !== undefined && model.structuredOutputMode === "anthropic-tool" && !KIE_CLAUDE_TOOLS_VERIFIED) ||
      (eff !== undefined && !KIE_CLAUDE_EFFORT_VERIFIED)
    if (!model.preferKie || mustDirect || !config.KIE_API_KEY) {
      return callAnthropicDirect(model, req)
    }
    try {
      return await callKie(model, req)
    } catch {
      // KIE proxy failure — the direct SDK is the reliability backstop.
      return callAnthropicDirect(model, req)
    }
  }

  if (config.KIE_API_KEY) {
    return callKie(model, req)
  }

  throw new Error(`No LLM provider available for model ${model.id} (need KIE_API_KEY or ANTHROPIC_API_KEY)`)
}

export async function llmStream(
  req: LlmRequest,
  onToken: (chunk: string) => void,
  signal?: AbortSignal,
): Promise<LlmResponse> {
  const model = resolveModel(req)

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
      return streamAnthropicDirect(model, req, onToken, signal)
    }
  }

  if (config.KIE_API_KEY) {
    return streamKie(model, req, onToken, signal)
  }

  throw new Error(`No LLM provider available for model ${model.id}`)
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
 * (Anthropic forced tool / Gemini `response_format`); for models with no native
 * mode (GPT-via-KIE) the call is plain text. Either way the result is parsed,
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
 *  models that reject it), and the output-token cap (raised to 32768 at
 *  xhigh/max so thinking doesn't truncate the answer). */
function deriveParams(model: LlmModelDef, req: LlmRequest): {
  eff: LlmReasoningEffort | undefined
  temperature: number | undefined
  maxTokens: number
} {
  const eff = effectiveReasoningEffort(model.id, req.reasoningEffort)
  const temperature = model.supportsTemperature === false ? undefined : req.temperature
  let maxTokens = req.maxTokens ?? model.maxOutputTokens
  if (eff === "xhigh" || eff === "max") {
    // Reasoning tokens share the output budget on these models. Floor the cap
    // even when the caller sent an explicit maxTokens — node data persists the
    // old 2048 default, and a tier-bumped call must never truncate its answer
    // because thinking consumed a small legacy cap. The cap is a ceiling, not
    // spend: billing is flat per call, so raising it costs nothing unless the
    // model actually generates that much.
    maxTokens = Math.max(maxTokens, 32768)
  }
  return { eff, temperature, maxTokens }
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
        if (b.type === "video" || b.type === "audio") return { type: "image_url", image_url: { url: b.url } }
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

  const { eff, temperature, maxTokens } = deriveParams(model, req)
  return {
    model: model.kieSlugOrModel,
    max_tokens: maxTokens,
    ...(temperature !== undefined ? { temperature } : {}),
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
function buildResponse(
  model: LlmModelDef,
  text: string,
  usage?: { inputTokens: number; outputTokens: number },
  actualUsd?: number,
): LlmResponse {
  const tableEstimate = usage ? calculateLlmCost(model, usage) : undefined
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
      return callKieMessages(model, req)
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
  const { eff, temperature, maxTokens } = deriveParams(model, req)
  const body: Record<string, unknown> = {
    model: model.kieSlugOrModel,
    messages: buildChatCompletionsMessages(req),
    max_tokens: maxTokens,
    ...(temperature !== undefined ? { temperature } : {}),
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
  )
}

async function streamKieChatCompletions(
  model: LlmModelDef, req: LlmRequest, onToken: (chunk: string) => void, signal?: AbortSignal,
): Promise<LlmResponse> {
  const url = `${KIE_API_BASE}/${model.kieSlugOrModel}/v1/chat/completions`
  const { eff, temperature, maxTokens } = deriveParams(model, req)
  const body: Record<string, unknown> = {
    model: model.kieSlugOrModel,
    messages: buildChatCompletionsMessages(req),
    max_tokens: maxTokens,
    ...(temperature !== undefined ? { temperature } : {}),
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
  // A forced-tool structured call (see buildMessagesBody) returns its result in
  // a tool_use block, not text — prefer it so schema-carrying calls aren't
  // silently parsed as empty text. Plain-text calls are unaffected (no tool_use
  // block present, falls through to the text block exactly as before).
  const toolUseBlock = content?.find((b) => b.type === "tool_use")
  const text = toolUseBlock
    ? JSON.stringify((toolUseBlock as { input?: unknown }).input ?? {})
    : ((content?.find((b) => b.type === "text")?.text as string) ?? "")
  const usage = data.usage as Record<string, number> | undefined

  return buildResponse(
    model,
    text,
    usage ? { inputTokens: usage.input_tokens ?? 0, outputTokens: usage.output_tokens ?? 0 } : undefined,
    extractActualUsd(data),
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

// -- Responses format (GPT-5.4) --

async function callKieResponses(model: LlmModelDef, req: LlmRequest): Promise<LlmResponse> {
  const url = `${KIE_API_BASE}/codex/v1/responses`
  // Responses API models (GPT-5.4) are reasoning models — temperature is unsupported
  const { eff, maxTokens } = deriveParams(model, req)
  const body: Record<string, unknown> = {
    model: model.kieSlugOrModel,
    input: buildResponsesInput(req),
    stream: false,
    ...(eff !== undefined ? { reasoning: { effort: eff } } : {}),
  }
  if (req.maxTokens !== undefined || eff === "xhigh" || eff === "max") body.max_output_tokens = maxTokens

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
  )
}

async function streamKieResponses(
  model: LlmModelDef, req: LlmRequest, onToken: (chunk: string) => void, signal?: AbortSignal,
): Promise<LlmResponse> {
  const url = `${KIE_API_BASE}/codex/v1/responses`
  // Responses API models (GPT-5.4) are reasoning models — temperature is unsupported
  const { eff, maxTokens } = deriveParams(model, req)
  const body: Record<string, unknown> = {
    model: model.kieSlugOrModel,
    input: buildResponsesInput(req),
    stream: true,
    ...(eff !== undefined ? { reasoning: { effort: eff } } : {}),
  }
  if (req.maxTokens !== undefined || eff === "xhigh" || eff === "max") body.max_output_tokens = maxTokens

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
    return buildResponse(model, toolUse ? JSON.stringify(toolUse.input) : "", usage)
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
  return buildResponse(model, textBlock?.text ?? "", usage)
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
  return buildResponse(model, fullText, usage)
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
  let usage: { inputTokens: number; outputTokens: number } | undefined
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
    text: fullText,
    usage,
    model: modelId,
    providerCost: usage ? calculateLlmCost(modelId, usage) : undefined,
  }
}
