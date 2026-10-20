/**
 * Structured (schema-validated) completion: `llmCompleteStructured` / `llmStreamStructured`.
 */

import type { LlmModelDef } from "@nodaro/shared/llm-models"
import { z, type ZodType } from "zod"
import { config } from "../config.js"
import { LlmPlatformExhaustedError, LlmStreamResponseError } from "../llm-errors.js"
import { directLaneLatch } from "../llm-platform-exhaustion.js"
import { extractJsonFromAIResponse } from "../json-utils.js"
import { restrictObjectSchemas } from "../json-schema-strict.js"
import { resolveModel } from "./params.js"
import { anthropicKeySet } from "./anthropic-availability.js"
import { assertInlineVideoLane, claudeMustServeDirect, llmComplete } from "./router.js"
import { directFallbackAllowed, kieFallback, serveFromFallback } from "./lane-fallback.js"
import { advancedModeRefusalOf, assertAdvancedModeServable, exhaustionKieFallback, serveIfDirectLatched } from "./exhaustion-fallback.js"
import { callAnthropicDirect, streamAnthropicStructured } from "./anthropic-lane.js"
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
  /**
   * On a validation failure, the lane that served the last malformed answer —
   * so a caller can tell a model that answered badly from a lane that is
   * suspect (describe-to-picker re-asks another model only after the KIE
   * lane's answer, never after the direct one's). Undefined when an attempt threw.
   */
  readonly lane?: LlmServedLane

  constructor(message: string, readonly usage: {
    inputTokens: number; outputTokens: number; providerCost?: number; complete: boolean
  }, options?: ErrorOptions & { lane?: LlmServedLane }) {
    super(message, options)
    this.name = "StructuredLlmError"
    if (options?.lane !== undefined) this.lane = options.lane
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

/** Tool output streams for an `anthropic-tool` model served by the direct SDK
 *  (pinned, or a call KIE cannot honour). On KIE's messages stream the call
 *  is prompt-JSON (`kieClaudePromptJson`): its answer is text, so nothing
 *  reaches `onToolJson` there and the answer arrives whole. */
function canStreamStructured(model: LlmModelDef, req: LlmRequest): boolean {
  if (model.structuredOutputMode !== "anthropic-tool") return false
  const direct = Boolean(model.directFallbackModel) && anthropicKeySet()
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
  const directAvailable = Boolean(model.directFallbackModel) && anthropicKeySet()
  const kieAvailable = Boolean(config.KIE_API_KEY) && req.requireLane !== "direct"
  // The same lane rule as llmStream: direct when pinned there, when KIE cannot
  // honour the call, or when there is no KIE key; KIE otherwise.
  // A KIE pin never reaches the direct lane, whatever the call carries.
  const directFirst = req.requireLane === "direct" ||
    (req.requireLane !== "kie" && (!kieAvailable || (directAvailable && (!model.preferKie || claudeMustServeDirect(model, req)))))
  if (directFirst) {
    // Advanced mode never reaches KIE: refused here when the Anthropic account cannot serve it.
    assertAdvancedModeServable(model, req)
    // A direct account latched out after a refusal (out of credit, or a latched key refusal) is not asked
    // again inside its window (serveIfDirectLatched).
    const latched = serveIfDirectLatched(
      { modelId: model.id, primary: "direct-anthropic stream", fallback: "kie" }, "anthropic", exhaustionKieFallback(model, req),
    )
    if (latched) return latched
    try {
      return await streamAnthropicStructured(model, req, jsonSchema, onToolJson, signal)
    } catch (err) {
      // A platform-account refusal also overrides a direct pin (exhaustionKieFallback).
      const kie = kieAvailable && req.requireLane === undefined
        ? kieFallback(model, req)
        : err instanceof LlmPlatformExhaustedError ? exhaustionKieFallback(model, req) : undefined
      if (!kie || err instanceof LlmStreamResponseError || signal?.aborted) throw advancedModeRefusalOf(req, err)
      return serveFromFallback({ modelId: model.id, primary: "direct-anthropic stream", fallback: "kie" }, err, kie)
    }
  }
  // KIE first. A failure before the first fragment reached the caller falls
  // back to direct (at no extra charge — the call is still billed as KIE);
  // after one, the stream is tainted and the error surfaces. Not under
  // `cheapLanesOnly` (directFallbackAllowed).
  let emitted = false
  const ctx = { modelId: model.id, primary: "kie stream", fallback: "direct-anthropic stream" }
  try {
    return await streamKieMessages(model, req, () => {}, signal, (partial) => {
      emitted = true
      onToolJson(partial, undefined)
    })
  } catch (err) {
    if (emitted || !directAvailable || req.requireLane === "kie" || signal?.aborted || !directFallbackAllowed(ctx, req, err)) throw err
    return serveFromFallback(ctx, err, () => streamAnthropicStructured(model, req, jsonSchema, onToolJson, signal))
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
  const retries = Math.max(0, opts?.maxRetries ?? LLM_STRUCTURED_DEFAULT_ATTEMPTS - 1)
  const jsonSchema = structuredJsonSchema(schema)

  let messages = req.messages
  let lastError = ""
  let spend = NO_SPEND
  let lastLane: LlmServedLane | undefined
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
      // failOnRefusal: a refusal here is an answer, never a malformed reply
      // to correct or a lane to route around (LlmContentRefusalError).
      resp = await callAttempt({ ...req, messages, failOnRefusal: true,
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
    lastLane = resp.lane
    messages = withCorrection(messages, resp.text, lastError)
  }
  let attempts = retries + 1
  const backup = directToolBackup(req, lastLane)
  if (backup) {
    attempts++
    console.warn(
      `[llm-lane-fallback] ${backup.modelId}: KIE's prompt-JSON answers failed validation (${lastError.slice(0, 200)}), ` +
        "asking the direct-anthropic tool once",
    )
    let resp: LlmResponse
    try {
      // The caller's own messages, not the correction turns: a fresh ask on
      // the lane whose tool enforces the schema.
      resp = await backup.call({ ...req, failOnRefusal: true, jsonSchema: { name: schemaName, schema: jsonSchema } })
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
    lastLane = resp.lane
  }
  throw new StructuredLlmError(`llm-structured: validation failed after ${attempts} attempt(s): ${lastError}`, spendUsage(spend),
    lastLane === undefined ? undefined : { lane: lastLane })
}

/**
 * How many extra asks the direct-tool backup ({@link directToolBackup}) adds to
 * one structured call: one, on one lane. Named because runtime budgets
 * (`STRUCTURED_LLM_MAX_RUNTIME_MS`, describe-to-picker's) count it.
 */
export const LLM_STRUCTURED_DIRECT_BACKUP_ASKS = 1

/** The validation attempts `llmCompleteStructured` makes when the caller sets no `maxRetries`. */
export const LLM_STRUCTURED_DEFAULT_ATTEMPTS = 3

/**
 * The direct Anthropic tool as ONE last ask for a structured Claude call
 * whose KIE answers never validated — or undefined when there is none to ask.
 *
 * KIE serves a structured Claude call as prompt-JSON (`kieClaudePromptJson`,
 * ./message-builders.ts — its tool shape 503s or drops the image), and
 * nothing on that wire enforces the schema: the answer is only as good as the
 * model's reading of an instruction. The direct lane's forced/strict tool
 * does enforce it, so a call KIE served (KIE-first, or KIE after a failed
 * direct call) gets it once before the call fails (decided 2026-10-16). It
 * bills nothing extra to the person — the charge is the node's reservation;
 * only the provider cost recorded grows. It applies under `maxRetries: 0`
 * too: those callers were answered by the direct tool until KIE stopped
 * carrying one (a KIE call 503'd, the direct lane answered), so this keeps
 * what they had.
 *
 * Not when the call is pinned to KIE, there is no direct key or model, the
 * direct account is latched out (out of credit, or a latched key refusal), or
 * the call is kept to the cheap lanes (`cheapLanesOnly`: this ask IS the
 * direct-vendor fallback, at the direct price): then the call fails as before.
 * The ask goes straight to the guarded direct adapter, so a platform refusal
 * there fails the call with the capacity sentence — it never loops back to KIE.
 */
function directToolBackup(
  req: LlmRequest, lastLane: LlmServedLane | undefined,
): { modelId: string; call: (attemptReq: LlmRequest) => Promise<LlmResponse> } | undefined {
  if (lastLane !== "kie" || req.requireLane === "kie" || req.cheapLanesOnly === true || !anthropicKeySet()) return undefined
  const model = resolveModel(req)
  if (model.structuredOutputMode !== "anthropic-tool" || !model.directFallbackModel) return undefined
  if (directLaneLatch("anthropic")) return undefined
  return { modelId: model.id, call: (attemptReq) => callAnthropicDirect(model, attemptReq) }
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
