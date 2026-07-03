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
import { getLlmModel, LLM_FEATURE_DEFAULTS, calculateLlmCost } from "@nodaro/shared"
import type { LlmModelDef, LlmFeature } from "@nodaro/shared"
import { getAnthropicClient } from "./anthropic.js"
import { KIE_API_BASE } from "../providers/kie/client.js"
import type { ZodType } from "zod"
import zodToJsonSchema from "zod-to-json-schema"
import { extractJsonFromAIResponse } from "./json-utils.js"

const LLM_TIMEOUT_MS = 120_000

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

  // Claude models: use direct Anthropic SDK (more reliable than KIE proxy)
  if (model.directFallbackModel && config.ANTHROPIC_API_KEY) {
    return callAnthropicDirect(model, req)
  }

  // Other models: use KIE.ai
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

  // Claude models: use direct Anthropic SDK (more reliable than KIE proxy)
  if (model.directFallbackModel && config.ANTHROPIC_API_KEY) {
    return streamAnthropicDirect(model, req, onToken, signal)
  }

  // Other models: use KIE.ai
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
  const jsonSchema = zodToJsonSchema(schema, { target: "jsonSchema7" }) as Record<string, unknown>
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

  return {
    model: model.kieSlugOrModel,
    max_tokens: req.maxTokens ?? model.maxOutputTokens,
    temperature: req.temperature,
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

/** Build LlmResponse with computed provider cost from token usage. */
function buildResponse(model: LlmModelDef, text: string, usage?: { inputTokens: number; outputTokens: number }): LlmResponse {
  return {
    text,
    usage,
    model: model.id,
    providerCost: usage ? calculateLlmCost(model, usage) : undefined,
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
  const body: Record<string, unknown> = {
    model: model.kieSlugOrModel,
    messages: buildChatCompletionsMessages(req),
    max_tokens: req.maxTokens ?? model.maxOutputTokens,
    temperature: req.temperature,
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

  return buildResponse(model, text, usage ? { inputTokens: usage.prompt_tokens ?? 0, outputTokens: usage.completion_tokens ?? 0 } : undefined)
}

async function streamKieChatCompletions(
  model: LlmModelDef, req: LlmRequest, onToken: (chunk: string) => void, signal?: AbortSignal,
): Promise<LlmResponse> {
  const url = `${KIE_API_BASE}/${model.kieSlugOrModel}/v1/chat/completions`
  const body: Record<string, unknown> = {
    model: model.kieSlugOrModel,
    messages: buildChatCompletionsMessages(req),
    max_tokens: req.maxTokens ?? model.maxOutputTokens,
    temperature: req.temperature,
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
  const textBlock = content?.find((b) => b.type === "text")
  const text = (textBlock?.text as string) ?? ""
  const usage = data.usage as Record<string, number> | undefined

  return buildResponse(model, text, usage ? { inputTokens: usage.input_tokens ?? 0, outputTokens: usage.output_tokens ?? 0 } : undefined)
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
  const body: Record<string, unknown> = {
    model: model.kieSlugOrModel,
    input: buildResponsesInput(req),
    stream: false,
  }
  if (req.maxTokens) body.max_output_tokens = req.maxTokens

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

  return buildResponse(model, text, usage ? { inputTokens: usage.input_tokens ?? 0, outputTokens: usage.output_tokens ?? 0 } : undefined)
}

async function streamKieResponses(
  model: LlmModelDef, req: LlmRequest, onToken: (chunk: string) => void, signal?: AbortSignal,
): Promise<LlmResponse> {
  const url = `${KIE_API_BASE}/codex/v1/responses`
  // Responses API models (GPT-5.4) are reasoning models — temperature is unsupported
  const body: Record<string, unknown> = {
    model: model.kieSlugOrModel,
    input: buildResponsesInput(req),
    stream: true,
  }
  if (req.maxTokens) body.max_output_tokens = req.maxTokens

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

  // Forced single-tool structured output: guaranteed schema-shaped JSON. We
  // return the tool input serialized as `text` so the rest of the pipeline
  // (and llmCompleteStructured) treats it like any JSON completion. Temperature
  // is intentionally omitted — newer Anthropic models (e.g. opus-4.7) reject it.
  if (req.jsonSchema && model.structuredOutputMode === "anthropic-tool") {
    const toolName = req.jsonSchema.name
    const response = await anthropic.messages.create(
      {
        model: model.directFallbackModel!,
        max_tokens: req.maxTokens ?? model.maxOutputTokens,
        system: req.system,
        messages: buildAnthropicMessages(req),
        tools: [{
          name: toolName,
          description: "Emit the structured result.",
          input_schema: req.jsonSchema.schema as Anthropic.Messages.Tool.InputSchema,
        }],
        tool_choice: { type: "tool", name: toolName },
      },
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
      max_tokens: req.maxTokens ?? model.maxOutputTokens,
      temperature: req.temperature,
      system: req.system,
      messages: buildAnthropicMessages(req),
    },
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
  const stream = anthropic.messages.stream(
    {
      model: model.directFallbackModel!,
      max_tokens: req.maxTokens ?? model.maxOutputTokens,
      temperature: req.temperature,
      system: req.system,
      messages: buildAnthropicMessages(req),
    },
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
