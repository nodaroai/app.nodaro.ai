/**
 * The direct Anthropic SDK lane, each adapter reached through its guarded wrapper.
 */

import type Anthropic from "@anthropic-ai/sdk"
import type { LlmModelDef } from "@nodaro/shared/llm-models"
import { calculateLlmCost } from "../pricing/llm-cost.js"
import { getAnthropicClient } from "../anthropic.js"
import { LlmStreamResponseError, guardLaneAccount } from "../llm-errors.js"
import { deriveParams, effectiveTimeout } from "./params.js"
import { anthropicStructuredTool, buildAnthropicMessages } from "./message-builders.js"
import { buildResponse } from "./response.js"
import type { LlmRequest, LlmResponse } from "./types.js"

// Guarded entry points (see the lane-guard note in ./router.ts).
export function callAnthropicDirect(model: LlmModelDef, req: LlmRequest): Promise<LlmResponse> {
  return guardLaneAccount({ lane: "direct", provider: "anthropic", modelId: model.id }, () => callAnthropicDirectUnguarded(model, req))
}

export function streamAnthropicDirect(
  model: LlmModelDef, req: LlmRequest, onToken: (chunk: string) => void, signal?: AbortSignal,
): Promise<LlmResponse> {
  return guardLaneAccount(
    { lane: "direct", provider: "anthropic", modelId: model.id },
    () => streamAnthropicDirectUnguarded(model, req, onToken, signal),
  )
}

export function streamAnthropicStructured(
  model: LlmModelDef,
  req: LlmRequest,
  jsonSchema: NonNullable<LlmRequest["jsonSchema"]>,
  onToolJson: (partialJson: string, jsonSnapshot: unknown) => void,
  signal?: AbortSignal,
): Promise<LlmResponse> {
  return guardLaneAccount(
    { lane: "direct", provider: "anthropic", modelId: model.id },
    () => streamAnthropicStructuredUnguarded(model, req, jsonSchema, onToolJson, signal),
  )
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
  const structured = anthropicStructuredTool(model, req.system, jsonSchema, { effort: eff })
  return {
    body: {
      model: model.directFallbackModel!,
      max_tokens: maxTokens,
      system: structured.system,
      messages: buildAnthropicMessages(req),
      tools: structured.tools,
      tool_choice: structured.toolChoice,
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
  // No tool call at all is possible only on a model asked with `tool_choice:
  // auto` (anthropicStructuredTool): read its text then, which is where a model
  // that answered with JSON instead of the tool put it — the caller's parse +
  // Zod decide whether it is an answer.
  const text = message.content
    .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
  return buildResponse(
    model,
    streamedJson || (toolUse ? JSON.stringify(toolUse.input) : text),
    { stopReason: message.stop_reason, cap: maxTokens },
    usage,
    undefined,
    "direct",
  )
}

async function callAnthropicDirectUnguarded(model: LlmModelDef, req: LlmRequest): Promise<LlmResponse> {
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

async function streamAnthropicDirectUnguarded(
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
async function streamAnthropicStructuredUnguarded(
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
