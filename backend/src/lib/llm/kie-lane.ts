/**
 * The KIE.ai lane: chat-completions (Gemini, GPT-5.2), messages (Claude) and
 * responses (GPT family, Grok) adapters, each reached through its guarded wrapper.
 */

import type { LlmModelDef, LlmVendor } from "@nodaro/shared/llm-models"
import { config } from "../config.js"
import { LlmLaneError, LlmStreamResponseError, guardLaneAccount } from "../llm-errors.js"
import { KIE_API_BASE } from "../../providers/kie/client.js"
import { inlineImagesForKie } from "../kie-inline-image.js"
import { extractKieToolCallInput } from "../json-utils.js"
import { deriveParams, effectiveTimeout } from "./params.js"
import {
  buildChatCompletionsMessages,
  buildMessagesBody,
  buildResponsesInput,
  kieClaudePromptJson,
  kiePromptJsonText,
  kieResponseFormat,
  kieResponsesTextFormat,
} from "./message-builders.js"
import { assertKieEnvelope, assertMediaIngested, buildResponse, extractActualUsd } from "./response.js"
import { parseSseStream } from "./sse.js"
import { withTransportRetry } from "./transport-retry.js"
import type { LlmRequest, LlmResponse } from "./types.js"

// KIE Claude-proxy passthrough facts. When false, the affected request class
// routes direct-Anthropic instead of through KIE.
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
// Re-measured 2026-10-08: `stream: false` now answers (9/9 across Sonnet 5.5,
// Opus 5.5 and Sonnet 4.6). The flag stays false anyway, for a different
// reason: the collapsed streaming wire (`callKieMessagesCollapsed`) returns a
// forced tool as a REAL tool_use block and carries `credits_consumed`, where
// the non-streaming one re-serializes it as a malformed `<tool_calls>` tag. So
// it now only selects `callKie`'s Claude shape — it no longer pushes any call
// off KIE (a non-advanced, effort-free Claude call is KIE-first since then).
const KIE_CLAUDE_NONSTREAM_VERIFIED = false

/**
 * A `directOnly` model is never sent to KIE. The routing never builds a KIE leg
 * for one (router, lane-fallback, exhaustion-fallback); this is the backstop at
 * the one door every KIE request goes through, so a new path that forgets the
 * flag fails here — before any request is built — instead of spending a call.
 */
export function assertKieServable(model: LlmModelDef): void {
  if (model.directOnly) {
    throw new Error(`Model ${model.id} is served only on its direct lane (directOnly) — no KIE request is built for it`)
  }
}

// Guarded entry points (see the lane-guard note in ./router.ts).
export function callKie(model: LlmModelDef, req: LlmRequest): Promise<LlmResponse> {
  assertKieServable(model)
  return guardLaneAccount({ lane: "kie", provider: "kie", modelId: model.id }, () => callKieUnguarded(model, req))
}

export function streamKie(
  model: LlmModelDef, req: LlmRequest, onToken: (chunk: string) => void, signal?: AbortSignal,
): Promise<LlmResponse> {
  assertKieServable(model)
  return guardLaneAccount({ lane: "kie", provider: "kie", modelId: model.id }, () => streamKieUnguarded(model, req, onToken, signal))
}

export function streamKieMessages(
  model: LlmModelDef, req: LlmRequest, onToken: (chunk: string) => void, signal?: AbortSignal,
  onToolJson?: (partialJson: string) => void,
): Promise<LlmResponse> {
  assertKieServable(model)
  return guardLaneAccount(
    { lane: "kie", provider: "kie", modelId: model.id },
    () => streamKieMessagesUnguarded(model, req, onToken, signal, onToolJson),
  )
}

// ---------------------------------------------------------------------------
// KIE.ai adapters
// ---------------------------------------------------------------------------

async function callKieUnguarded(model: LlmModelDef, req: LlmRequest): Promise<LlmResponse> {
  switch (model.kieFormat) {
    case "chat-completions":
      // Images go inline on this format, never as URLs — fetched and fitted
      // here, before any transport retry, and memoised per block so a
      // structured call's validation retries reuse the result
      // (lib/kie-inline-image.ts says why). Only THIS lane's request is
      // inlined: a fallback lane (direct Gemini) is handed the caller's
      // original blocks and downloads or inlines the image itself, so what it
      // sends stays exactly what that lane sends on its own — the second
      // download on that path is deliberate.
      return callKieChatCompletions(model, await inlineImagesForKie(req))
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
      {
        const inlined = await inlineImagesForKie(req)
        return model.kieCollapseStream
          ? callKieResponsesCollapsed(model, inlined)
          : callKieResponses(model, inlined)
      }
  }
}

async function streamKieUnguarded(
  model: LlmModelDef,
  req: LlmRequest,
  onToken: (chunk: string) => void,
  signal?: AbortSignal,
): Promise<LlmResponse> {
  switch (model.kieFormat) {
    case "chat-completions":
      return streamKieChatCompletions(model, await inlineImagesForKie(req, { signal }), onToken, signal)
    case "messages":
      return streamKieMessages(model, req, onToken, signal)
    case "responses":
      return streamKieResponses(model, await inlineImagesForKie(req, { signal }), onToken, signal)
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
  if (responseFormat) body.response_format = responseFormat.body

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.KIE_API_KEY}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(effectiveTimeout(req)),
  })

  if (!response.ok) {
    const errText = await response.text()
    throw new LlmLaneError(`KIE.ai chat-completions ${model.id} failed (${response.status}): ${errText}`, { lane: "kie", httpStatus: response.status })
  }

  const data = await response.json() as Record<string, unknown>
  assertKieEnvelope(data, model.id, "chat-completions")
  const choices = data.choices as Array<Record<string, unknown>> | undefined
  const text = (choices?.[0]?.message as Record<string, unknown>)?.content as string ?? ""
  const usage = data.usage as Record<string, number> | undefined

  return buildResponse(
    model,
    responseFormat ? responseFormat.restoreText(text) : text,
    { stopReason: choices?.[0]?.finish_reason, cap: maxTokens },
    usage ? { inputTokens: usage.prompt_tokens ?? 0, outputTokens: usage.completion_tokens ?? 0 } : undefined,
    extractActualUsd(data),
    "kie",
    req,
  )
}

/**
 * The streamed twin of {@link callKieChatCompletions}. With a schema, the chunks
 * `onToken` receives are the WIRE form — they reach the caller as they arrive,
 * before anything could rename a key in them — while the returned text carries
 * the caller's names. No structured caller reads those chunks today
 * (`llmStreamStructured` streams `anthropic-tool` models only).
 */
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
  if (responseFormat) body.response_format = responseFormat.body

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.KIE_API_KEY}` },
    body: JSON.stringify(body),
    signal: signal ?? AbortSignal.timeout(effectiveTimeout(req)),
  })

  if (!response.ok) {
    const errText = await response.text()
    throw new LlmLaneError(`KIE.ai chat-completions stream ${model.id} failed (${response.status}): ${errText}`, { lane: "kie", httpStatus: response.status })
  }

  const streamed = await parseSseStream(response, model.id, onToken, "chat-completions", maxTokens)
  return responseFormat ? { ...streamed, text: responseFormat.restoreText(streamed.text) } : streamed
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
    throw new LlmLaneError(`KIE.ai messages ${model.id} failed (${response.status}): ${errText}`, { lane: "kie", httpStatus: response.status })
  }

  const data = await response.json() as Record<string, unknown>
  assertKieEnvelope(data, model.id, "messages")
  const content = data.content as Array<Record<string, unknown>> | undefined
  // Dormant for Claude while KIE_CLAUDE_NONSTREAM_VERIFIED is false (callKie
  // serves the collapsed stream instead), kept in step with it: a structured
  // call is sent no tool (kieClaudePromptJson), so its answer is the text,
  // fences stripped. A tool_use block, or the `<tool_calls>` pseudo-tag KIE
  // re-serialized forced tools into in 2026-07 (extractKieToolCallInput), is
  // still decoded should one arrive — neither has been seen since tools
  // stopped being sent. A structured call with NO payload throws the same lane
  // error the stream path does (kiePromptJsonPayload), so the caller's lane
  // fallback runs instead of the parse+retry loop eating an empty answer.
  // Plain-text calls are unaffected.
  const toolUseBlock = content?.find((b) => b.type === "tool_use")
  const rawText = (content?.find((b) => b.type === "text")?.text as string) ?? ""
  let text: string
  if (toolUseBlock) {
    const input = (toolUseBlock as { input?: unknown }).input
    text = typeof input === "string" ? input : JSON.stringify(input ?? {})
  } else if (kieClaudePromptJson(model, req)) {
    const unwrapped = extractKieToolCallInput(rawText)
    if (unwrapped === null && (rawText.includes("<tool_calls>") || rawText.trim() === "")) {
      throw noKiePayloadError(model)
    }
    text = unwrapped ?? kiePromptJsonText(rawText)
  } else {
    text = rawText
  }
  const usage = data.usage as Record<string, number> | undefined

  return buildResponse(
    model,
    text,
    { stopReason: data.stop_reason, cap: base.max_tokens as number, refusalFails: req.failOnRefusal === true },
    usage ? { inputTokens: usage.input_tokens ?? 0, outputTokens: usage.output_tokens ?? 0 } : undefined,
    extractActualUsd(data),
    "kie",
    req,
  )
}

async function streamKieMessagesUnguarded(
  model: LlmModelDef, req: LlmRequest, onToken: (chunk: string) => void, signal?: AbortSignal,
  onToolJson?: (partialJson: string) => void,
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
    throw new LlmLaneError(`KIE.ai messages stream ${model.id} failed (${response.status}): ${errText}`, { lane: "kie", httpStatus: response.status })
  }

  const streamed = await parseSseStream(response, model.id, onToken, "messages", base.max_tokens as number, onToolJson, req.failOnRefusal === true)
  return kieClaudePromptJson(model, req) ? kiePromptJsonPayload(model, streamed) : streamed
}

/** The lane error a structured Claude call on KIE throws when its answer carries no payload at all. */
function noKiePayloadError(model: LlmModelDef): LlmLaneError {
  return new LlmLaneError(`KIE.ai messages ${model.id}: structured call returned no decodable payload`, { lane: "kie" })
}

/**
 * A prompt-JSON answer (kieClaudePromptJson) as the caller's JSON: the text,
 * any ```json fence or surrounding prose removed. An EMPTY answer is not a
 * success — it throws {@link noKiePayloadError}, as the non-stream path does,
 * so a KIE-first call falls back to the direct lane instead of handing "" to
 * a caller that reads `text` as its JSON. A plain lane error (no usage), so
 * the collapsed wire's transport retry may re-dial it like any other blip.
 */
function kiePromptJsonPayload(model: LlmModelDef, streamed: LlmResponse): LlmResponse {
  const text = kiePromptJsonText(streamed.text)
  if (text.trim() === "") throw noKiePayloadError(model)
  return { ...streamed, text }
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
 * 2026-08-18; the wrong prefix is a hard 4xx/5xx, not a graceful alias), and
 * Kimi + DeepSeek at openai/v1/responses (live-verified 2026-10-08).
 *
 * A TOTAL map over `LlmVendor`, so adding a vendor to the registry fails the
 * build until its family is stated here. `null` = the vendor has no model on
 * this dialect, and asking for one throws instead of silently posting to
 * another family's endpoint.
 */
const KIE_RESPONSES_FAMILY: Record<LlmVendor, string | null> = {
  anthropic: null,
  deepseek: "openai",
  google: null,
  moonshot: "openai",
  openai: "codex",
  xai: "grok",
}

function kieResponsesUrl(model: LlmModelDef): string {
  const family = KIE_RESPONSES_FAMILY[model.vendor]
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
  if (textFormat) body.text = textFormat.body

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.KIE_API_KEY}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(effectiveTimeout(req)),
  })

  if (!response.ok) {
    const errText = await response.text()
    throw new LlmLaneError(`KIE.ai responses ${model.id} failed (${response.status}): ${errText}`, { lane: "kie", httpStatus: response.status })
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
    textFormat ? textFormat.restoreText(text) : text,
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
  if (textFormat) body.text = textFormat.body

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.KIE_API_KEY}` },
    body: JSON.stringify(body),
    signal: signal ?? AbortSignal.timeout(effectiveTimeout(req)),
  })

  if (!response.ok) {
    const errText = await response.text()
    throw new LlmLaneError(`KIE.ai responses stream ${model.id} failed (${response.status}): ${errText}`, { lane: "kie", httpStatus: response.status })
  }

  // As on the chat-completions stream: `onToken` chunks are the wire form, the
  // returned text the caller's.
  const streamed = await parseSseStream(response, model.id, onToken, "responses", body.max_output_tokens as number | undefined)
  return textFormat ? { ...streamed, text: textFormat.restoreText(streamed.text) } : streamed
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
