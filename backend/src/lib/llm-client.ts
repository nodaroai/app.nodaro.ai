/**
 * Unified LLM client — routes requests through KIE.ai with Anthropic SDK fallback.
 *
 * Supports three KIE.ai API formats:
 * - chat-completions (Gemini, GPT-5.2): POST /{slug}/v1/chat/completions
 * - messages (Claude models): POST /claude/v1/messages
 * - responses (GPT-5.4): POST /api/v1/responses
 */

import { config } from "./config.js"
import { getLlmModel, LLM_FEATURE_DEFAULTS } from "../../../packages/shared/src/llm-models.js"
import type { LlmModelDef } from "../../../packages/shared/src/llm-models.js"
import { getAnthropicClient } from "./anthropic.js"
import { KIE_API_BASE } from "../providers/kie/client.js"

const LLM_TIMEOUT_MS = 120_000

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type LlmContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; url: string }

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
}

export interface LlmResponse {
  text: string
  usage?: { inputTokens: number; outputTokens: number }
  model: string
}

// ---------------------------------------------------------------------------
// Main entry points
// ---------------------------------------------------------------------------

export async function llmComplete(req: LlmRequest): Promise<LlmResponse> {
  const model = resolveModel(req)

  // Try KIE.ai first
  if (config.KIE_API_KEY) {
    try {
      return await callKie(model, req)
    } catch (err) {
      if (model.directFallbackModel && config.ANTHROPIC_API_KEY) {
        console.warn(`[llm-client] KIE.ai failed for ${model.id}, falling back to direct Anthropic: ${err instanceof Error ? err.message : err}`)
      } else {
        throw err
      }
    }
  }

  if (model.directFallbackModel && config.ANTHROPIC_API_KEY) {
    return callAnthropicDirect(model, req)
  }

  throw new Error(`No LLM provider available for model ${model.id} (need KIE_API_KEY or ANTHROPIC_API_KEY)`)
}

export async function llmStream(
  req: LlmRequest,
  onToken: (chunk: string) => void,
  signal?: AbortSignal,
): Promise<LlmResponse> {
  const model = resolveModel(req)

  if (config.KIE_API_KEY) {
    try {
      return await streamKie(model, req, onToken, signal)
    } catch (err) {
      if (model.directFallbackModel && config.ANTHROPIC_API_KEY) {
        console.warn(`[llm-client] KIE.ai stream failed for ${model.id}, falling back to direct Anthropic: ${err instanceof Error ? err.message : err}`)
      } else {
        throw err
      }
    }
  }

  if (model.directFallbackModel && config.ANTHROPIC_API_KEY) {
    return streamAnthropicDirect(model, req, onToken, signal)
  }

  throw new Error(`No LLM provider available for model ${model.id}`)
}

// ---------------------------------------------------------------------------
// Model resolution
// ---------------------------------------------------------------------------

function resolveModel(req: LlmRequest): LlmModelDef {
  let modelId = req.modelId
  if (!modelId && req.feature) {
    modelId = LLM_FEATURE_DEFAULTS[req.feature] ?? "claude-sonnet-4.6"
  }
  const model = getLlmModel(modelId)
  if (!model) {
    throw new Error(`Unknown LLM model: ${modelId}`)
  }
  return model
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
        return { type: "image_url", image_url: { url: b.url } }
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
      return { type: "image", source: { type: "url", url: b.url } }
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
        return { type: "input_image", image_url: b.url }
      })
      input.push({ role: m.role, content: parts })
    }
  }
  return input
}

function buildAnthropicMessages(req: LlmRequest) {
  return req.messages.map((m) => {
    if (typeof m.content === "string") {
      return { role: m.role as "user" | "assistant", content: m.content }
    }
    const blocks = m.content.map((b) => {
      if (b.type === "text") return { type: "text" as const, text: b.text }
      return { type: "image" as const, source: { type: "url" as const, url: b.url } }
    })
    return { role: m.role as "user" | "assistant", content: blocks }
  })
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
  const body = {
    model: model.kieSlugOrModel,
    messages: buildChatCompletionsMessages(req),
    max_tokens: req.maxTokens ?? model.maxOutputTokens,
    temperature: req.temperature,
  }

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.KIE_API_KEY}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
  })

  if (!response.ok) {
    const errText = await response.text()
    throw new Error(`KIE.ai chat-completions ${model.id} failed (${response.status}): ${errText}`)
  }

  const data = await response.json() as Record<string, unknown>
  const choices = data.choices as Array<Record<string, unknown>> | undefined
  const text = (choices?.[0]?.message as Record<string, unknown>)?.content as string ?? ""
  const usage = data.usage as Record<string, number> | undefined

  return {
    text,
    usage: usage ? { inputTokens: usage.prompt_tokens ?? 0, outputTokens: usage.completion_tokens ?? 0 } : undefined,
    model: model.id,
  }
}

async function streamKieChatCompletions(
  model: LlmModelDef, req: LlmRequest, onToken: (chunk: string) => void, signal?: AbortSignal,
): Promise<LlmResponse> {
  const url = `${KIE_API_BASE}/${model.kieSlugOrModel}/v1/chat/completions`
  const body = {
    model: model.kieSlugOrModel,
    messages: buildChatCompletionsMessages(req),
    max_tokens: req.maxTokens ?? model.maxOutputTokens,
    temperature: req.temperature,
    stream: true,
  }

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.KIE_API_KEY}` },
    body: JSON.stringify(body),
    signal: signal ?? AbortSignal.timeout(LLM_TIMEOUT_MS),
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
  const body = buildMessagesBody(model, req)

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Api-Key": config.KIE_API_KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
  })

  if (!response.ok) {
    const errText = await response.text()
    throw new Error(`KIE.ai messages ${model.id} failed (${response.status}): ${errText}`)
  }

  const data = await response.json() as Record<string, unknown>
  const content = data.content as Array<Record<string, unknown>> | undefined
  const textBlock = content?.find((b) => b.type === "text")
  const text = (textBlock?.text as string) ?? ""
  const usage = data.usage as Record<string, number> | undefined

  return {
    text,
    usage: usage ? { inputTokens: usage.input_tokens ?? 0, outputTokens: usage.output_tokens ?? 0 } : undefined,
    model: model.id,
  }
}

async function streamKieMessages(
  model: LlmModelDef, req: LlmRequest, onToken: (chunk: string) => void, signal?: AbortSignal,
): Promise<LlmResponse> {
  const url = `${KIE_API_BASE}/claude/v1/messages`
  const body = { ...buildMessagesBody(model, req), stream: true }

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Api-Key": config.KIE_API_KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify(body),
    signal: signal ?? AbortSignal.timeout(LLM_TIMEOUT_MS),
  })

  if (!response.ok) {
    const errText = await response.text()
    throw new Error(`KIE.ai messages stream ${model.id} failed (${response.status}): ${errText}`)
  }

  return parseSseStream(response, model.id, onToken, "messages")
}

// -- Responses format (GPT-5.4) --

async function callKieResponses(model: LlmModelDef, req: LlmRequest): Promise<LlmResponse> {
  const url = `${KIE_API_BASE}/api/v1/responses`
  const body = {
    model: model.kieSlugOrModel,
    input: buildResponsesInput(req),
    max_output_tokens: req.maxTokens ?? model.maxOutputTokens,
    temperature: req.temperature,
  }

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.KIE_API_KEY}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
  })

  if (!response.ok) {
    const errText = await response.text()
    throw new Error(`KIE.ai responses ${model.id} failed (${response.status}): ${errText}`)
  }

  const data = await response.json() as Record<string, unknown>
  const output = data.output as Array<Record<string, unknown>> | undefined
  const textItem = output?.find((o) => o.type === "message")
  const contentArr = (textItem?.content as Array<Record<string, unknown>>) ?? []
  const textBlock = contentArr.find((c) => c.type === "output_text")
  const text = (textBlock?.text as string) ?? ""
  const usage = data.usage as Record<string, number> | undefined

  return {
    text,
    usage: usage ? { inputTokens: usage.input_tokens ?? 0, outputTokens: usage.output_tokens ?? 0 } : undefined,
    model: model.id,
  }
}

async function streamKieResponses(
  model: LlmModelDef, req: LlmRequest, onToken: (chunk: string) => void, signal?: AbortSignal,
): Promise<LlmResponse> {
  const url = `${KIE_API_BASE}/api/v1/responses`
  const body = {
    model: model.kieSlugOrModel,
    input: buildResponsesInput(req),
    max_output_tokens: req.maxTokens ?? model.maxOutputTokens,
    temperature: req.temperature,
    stream: true,
  }

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.KIE_API_KEY}` },
    body: JSON.stringify(body),
    signal: signal ?? AbortSignal.timeout(LLM_TIMEOUT_MS),
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
  const response = await anthropic.messages.create(
    {
      model: model.directFallbackModel!,
      max_tokens: req.maxTokens ?? model.maxOutputTokens,
      temperature: req.temperature,
      system: req.system,
      messages: buildAnthropicMessages(req),
    },
    { timeout: LLM_TIMEOUT_MS },
  )

  const textBlock = response.content.find((b) => b.type === "text")
  return {
    text: textBlock?.text ?? "",
    usage: { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens },
    model: model.id,
  }
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
    { timeout: LLM_TIMEOUT_MS },
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

  return {
    text: fullText,
    usage: { inputTokens: finalMessage.usage.input_tokens, outputTokens: finalMessage.usage.output_tokens },
    model: model.id,
  }
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

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
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

  return { text: fullText, usage, model: modelId }
}
