/**
 * Structured (schema-validated) completion: `llmCompleteStructured` / `llmStreamStructured`.
 */

import type { LlmModelDef } from "@nodaro/shared/llm-models"
import { z, type ZodType } from "zod"
import { config } from "../config.js"
import { LlmPlatformExhaustedError, LlmStreamResponseError } from "../llm-errors.js"
import { extractJsonFromAIResponse } from "../json-utils.js"
import { restrictObjectSchemas } from "../json-schema-strict.js"
import { resolveModel } from "./params.js"
import { assertInlineVideoLane, claudeMustServeDirect, llmComplete } from "./router.js"
import { kieFallback, laneFallbackAllowed, serveFromFallback } from "./lane-fallback.js"
import { exhaustionKieFallback } from "./exhaustion-fallback.js"
import { streamAnthropicStructured } from "./anthropic-lane.js"
import { streamKieMessages } from "./kie-lane.js"
import type { LlmMessage, LlmRequest, LlmResponse, LlmServedLane } from "./types.js"

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
  /** The lane that served the attempt whose answer this is. */
  lane: LlmServedLane
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
  assertInlineVideoLane(req, model)
  const onToolJson = opts?.onToolJson
  if (!onToolJson || !canStreamStructured(model, req)) {
    return runStructuredAttempts(req, schema, opts, (attemptReq) => llmComplete(attemptReq))
  }
  const forward = guardToolJsonCallback(model.id, onToolJson)
  return runStructuredAttempts(req, schema, opts, (attemptReq, attempt) =>
    attempt === 0 ? streamStructuredAttempt(model, attemptReq, forward, opts?.signal) : llmComplete(attemptReq),
  )
}

/** Tool output streams for an `anthropic-tool` model on whichever lane serves
 *  it: the direct SDK (pinned, or a call KIE cannot honour) or KIE's messages
 *  stream, whose `input_json_delta` fragments parseSseStream forwards. */
function canStreamStructured(model: LlmModelDef, req: LlmRequest): boolean {
  if (model.structuredOutputMode !== "anthropic-tool") return false
  const direct = Boolean(model.directFallbackModel) && Boolean(config.ANTHROPIC_API_KEY)
  if (req.requireLane === "direct") return direct
  if (req.requireLane === "kie") return Boolean(config.KIE_API_KEY)
  return direct || Boolean(config.KIE_API_KEY)
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
  const jsonSchema = req.jsonSchema
  if (!jsonSchema) return llmComplete(req)
  const directAvailable = Boolean(model.directFallbackModel) && Boolean(config.ANTHROPIC_API_KEY)
  const kieAvailable = Boolean(config.KIE_API_KEY) && req.requireLane !== "direct"
  // The same lane rule as llmStream: direct when pinned there, when KIE cannot
  // honour the call, or when there is no KIE key; KIE otherwise.
  // A KIE pin never reaches the direct lane, whatever the call carries.
  const directFirst = req.requireLane === "direct" ||
    (req.requireLane !== "kie" && (!kieAvailable || (directAvailable && (!model.preferKie || claudeMustServeDirect(model, req)))))
  if (directFirst) {
    try {
      return await streamAnthropicStructured(model, req, jsonSchema, onToolJson, signal)
    } catch (err) {
      // A platform-account refusal also overrides a direct pin (exhaustionKieFallback).
      const kie = kieAvailable && req.requireLane === undefined
        ? kieFallback(model, req)
        : err instanceof LlmPlatformExhaustedError ? exhaustionKieFallback(model, req) : undefined
      if (!kie || err instanceof LlmStreamResponseError || signal?.aborted) throw err
      return serveFromFallback({ modelId: model.id, primary: "direct-anthropic stream", fallback: "kie" }, err, kie)
    }
  }
  // KIE first. A failure before the first fragment reached the caller falls
  // back to direct (at no extra charge — the call is still billed as KIE);
  // after one, the stream is tainted and the error surfaces.
  let emitted = false
  try {
    return await streamKieMessages(model, req, () => {}, signal, (partial) => {
      emitted = true
      onToolJson(partial, undefined)
    })
  } catch (err) {
    if (emitted || !directAvailable || req.requireLane === "kie" || !laneFallbackAllowed(err) || signal?.aborted) throw err
    return serveFromFallback(
      { modelId: model.id, primary: "kie stream", fallback: "direct-anthropic stream" },
      err,
      () => streamAnthropicStructured(model, req, jsonSchema, onToolJson, signal),
    )
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
        providerCost: usage.providerCost, usageComplete: usage.complete, lane: resp.lane }
    }
    lastError = answer.error
    messages = withCorrection(messages, resp.text, lastError)
  }
  throw new StructuredLlmError(`llm-structured: validation failed after ${retries + 1} attempt(s): ${lastError}`, spendUsage(spend))
}

/** The forced output's JSON Schema — the caller's contract, before any lane's wire rewrite. */
export function structuredJsonSchema(schema: ZodType): Record<string, unknown> {
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
