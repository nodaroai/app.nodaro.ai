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
import type { LlmModelDef, LlmReasoningEffort } from "@nodaro/shared/llm-models"
import { config } from "../config.js"
import { calculateLlmCost } from "../pricing/llm-cost.js"
import { blocksToGeminiParts } from "./media.js"
import { toGeminiResponseSchema } from "./response-schema.js"
import { LlmStreamResponseError, assertNotContentRefusal, assertNotOutputCapped, isContentRefusalStop, type ReplyEnd } from "../llm-errors.js"
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
 * The stop reasons that mean the candidate finished normally. Anything else
 * Google reports (its `FinishReason` enum) ended the answer early: the output
 * cap and the content-policy stops have their own errors; the rest — LANGUAGE,
 * OTHER, MALFORMED_FUNCTION_CALL, UNEXPECTED_TOOL_CALL, NO_IMAGE, IMAGE_OTHER —
 * fail as an answer the model did not finish. Absent (a stream that never
 * stated one) and UNSPECIFIED say nothing, so they are not judged.
 */
const UNJUDGED_STOPS: ReadonlySet<unknown> = new Set([undefined, "STOP", "FINISH_REASON_UNSPECIFIED"])

/**
 * `end` is required for the same reason it is on `llm-client`'s builders: a
 * `MAX_TOKENS` reply reads like a finished one. This is the lane issue #1588
 * happened on — Gemini reasons by default here, `maxOutputTokens` covers the
 * reasoning too, and a 1,100-token cap came back as 120 characters marked done.
 *
 * A content stop is read the same way, and so is a prompt Google refused to
 * answer at all (`promptFeedback.blockReason`, no candidate): either used to
 * come back as an EMPTY success (a RECITATION stop did, 2026-10-17). Now it is
 * an `LlmContentRefusalError` — the codebase's provider-content verdict, billed
 * or refunded by its own rule (`billedContentRefusal`) and never re-asked on
 * another lane. A content stop that left a FRAGMENT fails too, exactly as a
 * MAX_TOKENS fragment does: a filter-cut answer is not a finished one.
 */
function toResponse(
  model: LlmModelDef,
  text: string,
  end: ReplyEnd & { blockReason?: unknown },
  usage: { inputTokens: number; outputTokens: number } | undefined,
): LlmResponse {
  // Costed on the DIRECT rate band — Google list price, not KIE's resale.
  // There is no `credits_consumed` equivalent to reconcile against here, so
  // the rate table is the only source of truth for this lane.
  const providerCost = usage ? calculateLlmCost(model, usage, "direct") : undefined
  const lane = "direct-gemini"
  if (end.blockReason !== undefined && end.blockReason !== "BLOCKED_REASON_UNSPECIFIED") {
    // Google's prompt-block spellings overlap its finish reasons only in part
    // (OTHER, MODEL_ARMOR are block-only); a blocked prompt is a content verdict
    // whichever it names, so those two are judged as SAFETY — logged raw first.
    console.warn(`[llm-content-refusal] ${lane} ${model.id} prompt blocked: ${String(end.blockReason)}`)
    const stopReason = isContentRefusalStop(end.blockReason) ? end.blockReason : "SAFETY"
    assertNotContentRefusal({ modelId: model.id, lane, stopReason, usage, providerCost })
  }
  assertNotOutputCapped({ modelId: model.id, lane, stopReason: end.stopReason, cap: end.cap, usage, providerCost })
  assertNotContentRefusal({ modelId: model.id, lane, stopReason: end.stopReason, usage, providerCost })
  if (!UNJUDGED_STOPS.has(end.stopReason)) {
    const detail = `${lane} ${model.id} stopped with ${String(end.stopReason)} after ${text.length} characters ` +
      `(in ${usage?.inputTokens ?? "?"} / out ${usage?.outputTokens ?? "?"} tokens)`
    console.warn(`[llm-unfinished-answer] ${detail}`)
    throw new LlmStreamResponseError(detail, {
      inputTokens: usage?.inputTokens ?? 0,
      outputTokens: usage?.outputTokens ?? 0,
      providerCost,
      complete: usage !== undefined && providerCost !== undefined,
    })
  }
  return { text, usage, model: model.id, providerCost, lane }
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
    { stopReason: response.candidates?.[0]?.finishReason, cap: params.maxTokens, blockReason: response.promptFeedback?.blockReason },
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
  // A refused prompt arrives as a chunk with no candidate, only promptFeedback.
  let blockReason: unknown
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
    const chunkBlock = chunk.promptFeedback?.blockReason
    if (chunkBlock) blockReason = chunkBlock
  }
  return toResponse(model, text, { stopReason, cap: params.maxTokens, blockReason }, usage)
}
