/**
 * Direct Google Gemini lane — `generativelanguage`, keyed by `GEMINI_API_KEY`,
 * with no aggregator in the path.
 *
 * This is the Google-side twin of the direct-Anthropic fallback in
 * `llm-client.ts`. Which models use it, and whether they prefer it over KIE, is
 * declared per model in the shared registry (`directGeminiModel` /
 * `preferDirect`) — never decided here, and never by vendor-name matching.
 *
 * Three things genuinely differ from the KIE chat-completions dialect, and all
 * three are why this lane exists at all:
 *
 *  1. **Media.** Google will not dereference an arbitrary URL. Every media
 *     block is resolved to inline bytes or a Files API handle first — see
 *     `./media.ts`.
 *  2. **Structured output.** `responseJsonSchema` accepts real JSON Schema
 *     including `additionalProperties`, so record/map-shaped fields survive.
 *     KIE's `response_format` silently drops them (the `z.record` rule in
 *     backend/CLAUDE.md); on this lane that rule does not apply. What this
 *     lane does NOT accept is an array cap — see `./response-schema.ts`.
 *  3. **Reasoning.** `thinkingLevel` is a real, documented lever here, and
 *     thinking tokens are billed at the OUTPUT rate — so they are folded into
 *     `outputTokens` rather than discarded.
 */

import { GoogleGenAI, ThinkingLevel } from "@google/genai"
import type { LlmModelDef, LlmReasoningEffort } from "@nodaro/shared"
import { config } from "../config.js"
import { calculateLlmCost } from "../pricing/llm-cost.js"
import { blocksToGeminiParts } from "./media.js"
import { toGeminiResponseSchema } from "./response-schema.js"
import { assertNotOutputCapped, type ReplyEnd } from "../llm-errors.js"
import type { LlmRequest, LlmResponse } from "../llm-client.js"

/** Per-call params already derived by `llm-client.deriveParams` — passed in so
 *  that clamping/temperature-stripping stays single-sourced there. */
export interface GeminiCallParams {
  eff: LlmReasoningEffort | undefined
  temperature: number | undefined
  topP: number | undefined
  maxTokens: number
}

// Memoised per KEY, not once: provider keys are live (env, then the
// operator-supplied key from /setup), so a client built for one key must be
// rebuilt when the key changes rather than keep signing with the old one.
let client: { key: string; sdk: GoogleGenAI } | undefined

export function getGeminiClient(): GoogleGenAI {
  const apiKey = config.GEMINI_API_KEY
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not configured — the direct Gemini lane is unavailable")
  }
  if (!client || client.key !== apiKey) client = { key: apiKey, sdk: new GoogleGenAI({ apiKey }) }
  return client.sdk
}

/** Test seam: drop the memoized client so a suite can swap the key. */
export function __resetGeminiClient(): void {
  client = undefined
}

/**
 * Our 6-level effort scale → Gemini's 4-level `thinkingLevel`.
 *
 * `xhigh`/`max` collapse onto `high` because Google exposes nothing above it;
 * the extra levels still matter upstream, where they bump the credit tier and
 * raise the output-token floor.
 */
const THINKING_LEVEL: Record<LlmReasoningEffort, ThinkingLevel> = {
  none: ThinkingLevel.MINIMAL,
  low: ThinkingLevel.LOW,
  medium: ThinkingLevel.MEDIUM,
  high: ThinkingLevel.HIGH,
  xhigh: ThinkingLevel.HIGH,
  max: ThinkingLevel.HIGH,
}

/** Gemini names the assistant turn "model"; every other dialect here says "assistant". */
function geminiRole(role: "user" | "assistant"): "user" | "model" {
  return role === "assistant" ? "model" : "user"
}

function buildConfig(model: LlmModelDef, req: LlmRequest, p: GeminiCallParams, signal?: AbortSignal) {
  return {
    ...(req.system ? { systemInstruction: req.system } : {}),
    maxOutputTokens: p.maxTokens,
    ...(p.temperature !== undefined ? { temperature: p.temperature } : {}),
    ...(p.topP !== undefined ? { topP: p.topP } : {}),
    ...(p.eff !== undefined ? { thinkingConfig: { thinkingLevel: THINKING_LEVEL[p.eff] } } : {}),
    // Gated on the model declaring SOME native structured mode, not on a
    // vendor id — a model with no native mode falls through to
    // llmCompleteStructured's parse+retry, exactly as on the KIE lane.
    ...(req.jsonSchema && model.structuredOutputMode
      ? { responseMimeType: "application/json", responseJsonSchema: toGeminiResponseSchema(req.jsonSchema.schema) }
      : {}),
    ...(signal ? { abortSignal: signal } : {}),
  }
}

async function buildContents(req: LlmRequest) {
  const ai = getGeminiClient()
  const contents = []
  for (const m of req.messages) {
    contents.push({ role: geminiRole(m.role), parts: await blocksToGeminiParts(ai, m.content) })
  }
  return contents
}

/**
 * Token usage → our shape. `thoughtsTokenCount` is folded into output because
 * that is how Google bills it: "response pricing is the sum of output tokens
 * and thinking tokens". Dropping it would under-report every reasoning call.
 */
function readUsage(meta: {
  promptTokenCount?: number
  candidatesTokenCount?: number
  thoughtsTokenCount?: number
} | undefined): { inputTokens: number; outputTokens: number } | undefined {
  if (!meta) return undefined
  return {
    inputTokens: meta.promptTokenCount ?? 0,
    outputTokens: (meta.candidatesTokenCount ?? 0) + (meta.thoughtsTokenCount ?? 0),
  }
}

/**
 * `end` is required for the same reason it is on `llm-client`'s builders: a
 * `MAX_TOKENS` reply reads like a finished one. This is the lane issue #1588
 * happened on — Gemini reasons by default here, `maxOutputTokens` covers the
 * reasoning too, and a 1,100-token cap came back as 120 characters marked done.
 */
function toResponse(
  model: LlmModelDef,
  text: string,
  end: ReplyEnd,
  usage: { inputTokens: number; outputTokens: number } | undefined,
): LlmResponse {
  // Costed on the DIRECT rate band — Google list price, not KIE's resale.
  // There is no `credits_consumed` equivalent to reconcile against here, so
  // the rate table is the only source of truth for this lane.
  const providerCost = usage ? calculateLlmCost(model, usage, "direct") : undefined
  assertNotOutputCapped({
    modelId: model.id, lane: "direct-gemini", stopReason: end.stopReason, cap: end.cap, usage, providerCost,
  })
  return { text, usage, model: model.id, providerCost, lane: "direct-gemini" }
}

function geminiModelId(model: LlmModelDef): string {
  if (!model.directGeminiModel) {
    throw new Error(`Model ${model.id} has no directGeminiModel — it cannot be served on the direct Gemini lane`)
  }
  return model.directGeminiModel
}

export async function callGeminiDirect(
  model: LlmModelDef,
  req: LlmRequest,
  params: GeminiCallParams,
): Promise<LlmResponse> {
  const ai = getGeminiClient()
  const response = await ai.models.generateContent({
    model: geminiModelId(model),
    contents: await buildContents(req),
    config: buildConfig(model, req, params),
  })
  return toResponse(
    model,
    response.text ?? "",
    { stopReason: response.candidates?.[0]?.finishReason, cap: params.maxTokens },
    readUsage(response.usageMetadata),
  )
}

export async function streamGeminiDirect(
  model: LlmModelDef,
  req: LlmRequest,
  params: GeminiCallParams,
  onToken: (chunk: string) => void,
  signal?: AbortSignal,
): Promise<LlmResponse> {
  const ai = getGeminiClient()
  const stream = await ai.models.generateContentStream({
    model: geminiModelId(model),
    contents: await buildContents(req),
    config: buildConfig(model, req, params, signal),
  })

  let text = ""
  // Usage arrives cumulatively; the LAST chunk carrying it is authoritative.
  let usage: { inputTokens: number; outputTokens: number } | undefined
  // So does the finish reason — only the final chunk states it.
  let stopReason: unknown
  for await (const chunk of stream) {
    const piece = chunk.text
    if (piece) {
      text += piece
      onToken(piece)
    }
    const chunkUsage = readUsage(chunk.usageMetadata)
    if (chunkUsage) usage = chunkUsage
    const finishReason = chunk.candidates?.[0]?.finishReason
    if (finishReason) stopReason = finishReason
  }
  return toResponse(model, text, { stopReason, cap: params.maxTokens }, usage)
}
