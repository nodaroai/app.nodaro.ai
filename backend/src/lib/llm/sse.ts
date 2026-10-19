/**
 * The KIE SSE stream parser (all three formats) and the `responses` stream integrity rules.
 */

import { calculateLlmCost } from "../pricing/llm-cost.js"
import {
  LlmLaneError,
  LlmOutputTruncatedError,
  LlmStreamResponseError,
  assertNotContentRefusal,
  assertNotOutputCapped,
  isOutputCapStop,
  outputCappedMessage,
  type ReplyEnd,
} from "../llm-errors.js"
import { assertKieEnvelope, extractActualUsd } from "./response.js"
import type { LlmResponse } from "./types.js"

// ---------------------------------------------------------------------------
// SSE stream parser
// ---------------------------------------------------------------------------

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
    throw new LlmLaneError(
      `KIE.ai responses stream ${modelId} ended without a terminal event ` +
        `(no response.completed, no [DONE]) after ${streamedText.length} chars — the connection was cut mid-answer`,
      { lane: "kie" },
    )
  }

  if (sequenceAnomaly) {
    throw new LlmLaneError(
      `KIE.ai responses stream ${modelId} lost or reordered an SSE frame ` +
        `(sequence_number gap) and the stream stated no authoritative text to repair it from ` +
        `— the ${streamedText.length}-char answer is incomplete`,
      { lane: "kie" },
    )
  }

  return streamedText
}

export async function parseSseStream(
  response: Response,
  modelId: string,
  onToken: (chunk: string) => void,
  format: "chat-completions" | "messages" | "responses",
  /** The output cap sent — `ReplyEnd.cap`; required so no stream lane skips the cap check. */
  cap: ReplyEnd["cap"],
  /** Receives each tool-input fragment as it arrives (a structured Claude stream on KIE). */
  onToolJson?: (partialJson: string) => void,
  /** A `stop_reason: "refusal"` throws — a structured call only (`LlmRequest.failOnRefusal`). */
  refusalFails = false,
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
          throw new LlmLaneError(`KIE.ai ${format} stream ${modelId}: expected SSE, got JSON: ${buffer.slice(0, 200)}`, { lane: "kie" })
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
              providerCost, ...(actualUsd !== undefined ? { creditsUsd: actualUsd } : {}), complete: providerCost !== undefined,
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
            if (partial) {
              toolJson += partial
              onToolJson?.(partial)
            }
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
                providerCost, ...(actualUsd !== undefined ? { creditsUsd: actualUsd } : {}),
                complete: usage !== undefined && providerCost !== undefined,
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
  if (refusalFails) assertNotContentRefusal({ modelId, lane: `kie ${format} stream`, stopReason, usage, providerCost, creditsUsd: actualUsd })
  assertNotOutputCapped({ modelId, lane: `kie ${format} stream`, stopReason, cap, usage, providerCost, creditsUsd: actualUsd })

  return {
    // Text wins when present; the accumulated tool payload is the body only for
    // a forced-tool call, which emits no text block at all.
    // A tool call IS the structured answer; any text beside it is preamble (a
    // model asked with `tool_choice: auto` may say a sentence first).
    text: toolJson || fullText,
    usage,
    model: modelId,
    providerCost,
    // KIE's own charge, only when the stream stated one (see LlmResponse.creditsUsd).
    ...(actualUsd !== undefined ? { creditsUsd: actualUsd } : {}),
    // Only KIE's three formats stream through this parser.
    lane: "kie",
  }
}
