import type Anthropic from "@anthropic-ai/sdk"
import { z } from "zod"
import type { SupabaseClient } from "@supabase/supabase-js"
import { LLM_MODELS, getLlmModel } from "@nodaro/shared/llm-models"
import { calculateLlmCost } from "../../../lib/pricing/llm-cost.js"
import { getAnthropicClient } from "../../../lib/anthropic.js"
import {
  LLM_CONTENT_REFUSAL_MESSAGE,
  LlmContentRefusalError,
  LlmPlatformExhaustedError,
  toPlatformExhausted,
} from "../../../lib/llm-errors.js"
import { getPipelineSignal } from "../pipeline-context.js"
import { restrictObjectSchemas } from "../../../lib/json-schema-strict.js"
import { anthropicStructuredTool } from "../../../lib/llm/message-builders.js"
import { extractJsonFromAIResponse } from "../../../lib/json-utils.js"

export type LLMRole = "detection" | "showrunner" | "scene_director" | "critic" | "helper" | "specialist"

/**
 * Models that reject the `temperature` parameter with a 400 — derived from the
 * shared registry (`supportsTemperature: false`) so new reasoning models are
 * covered by their registry entry instead of a hand-list here. Covers both the
 * KIE slug and the direct-Anthropic model id.
 */
const TEMPERATURE_UNSUPPORTED_MODELS = new Set<string>(
  LLM_MODELS.filter((m) => m.supportsTemperature === false).flatMap((m) => [
    m.kieSlugOrModel,
    ...(m.directFallbackModel ? [m.directFallbackModel] : []),
  ]),
)

/**
 * Models that reason with no thinking param sent, so reasoning tokens share
 * `max_tokens` with the emit tool_use — derived from the registry
 * (`thinkingDefaultOn`) exactly like the temperature set above, since this is
 * a SEPARATE call path from `lib/llm-client.ts` and must not drift from it.
 */
const THINKING_DEFAULT_ON_MODELS = new Set<string>(
  LLM_MODELS.filter((m) => m.thinkingDefaultOn).flatMap((m) => [
    m.kieSlugOrModel,
    ...(m.directFallbackModel ? [m.directFallbackModel] : []),
  ]),
)

/** Output cap for one stage turn. A reasoning-by-default model splits this
 *  budget with its thinking, and a truncated turn yields NO tool_use block —
 *  which this path reports as "Model did not call the emit tool." and then
 *  retries the full prompt twice more. Give those models headroom; everything
 *  else keeps the long-standing 8192. */
const STAGE_MAX_TOKENS = 8192
const STAGE_MAX_TOKENS_THINKING = 32768

// Accept any Zod schema whose PARSED OUTPUT is T. The schema's INPUT type may
// diverge from T (e.g. ZodDefault makes input optional but output required),
// which is the case for ShowrunnerPlanSchema. z.toJSONSchema + safeParse only
// touch the input/output ends, so widening the middle generics is safe.
export interface CallLLMArgs<T> {
  supabase: SupabaseClient
  pipelineId: string
  stageId: string | null
  sceneId?: string | null
  userId: string
  role: LLMRole
  task: string
  modelId: string
  temperature?: number
  systemPrompt: string
  userPrompt: string | Anthropic.Messages.ContentBlockParam[]
  schema: z.ZodType<T, unknown>
  maxRetries?: number
  cacheSystemPrompt?: boolean
  /**
   * Optional preprocess hook — runs on the raw `toolUse.input` AFTER
   * Anthropic returns it, BEFORE Zod safeParse. Used by critic helpers to
   * truncate freeform string fields that occasionally overshoot their
   * schema cap (see `_critic-truncate.ts`) so a single 503-char string
   * from Sonnet doesn't fail the whole call after retries. Idempotent:
   * applied to every retry attempt.
   */
  preprocess?: (raw: unknown) => unknown
  /**
   * Optional progress callback — when present, switches from non-streaming
   * `messages.create` to streaming `messages.stream` and invokes the
   * callback at observable boundaries (stream start, every ~1s of tool-use
   * input-json deltas, stream complete). Used by the Stage 1 Showrunner so
   * the pipeline panel can render a live "Drafting plan…" banner instead of
   * a 2-minute spinner. Throttled at the call site to at most one event per
   * `progressMinIntervalMs` (default 750ms) so a token-flood doesn't drown
   * the SSE channel.
   *
   * The callback is best-effort — if a caller's callback throws, the LLM
   * call still completes and writes its audit row; the exception is logged
   * and swallowed.
   */
  onProgress?: (update: ProgressUpdate) => void
  /**
   * Minimum gap between `onProgress` invocations when streaming. Default
   * 750ms. Lower = smoother but more SSE traffic; higher = chunkier UI.
   */
  progressMinIntervalMs?: number
}

/**
 * Discriminated progress event emitted while a streaming LLM call is in
 * flight. Phases map to observable stream boundaries:
 *   - `starting`   — fires once before the stream request goes out
 *   - `drafting`   — fires repeatedly as tool-use input_json deltas accumulate
 *   - `finalizing` — fires once after the stream completes, before Zod parse
 *
 * Callers convert these into user-facing strings; the LLM layer doesn't
 * know what phrasing the panel uses.
 */
export type ProgressUpdate =
  | { phase: "starting" }
  | { phase: "drafting"; bytesSoFar: number }
  | { phase: "finalizing"; bytesSoFar: number }

export interface CallLLMResult<T> {
  output: T
  llmCallId: string
  costUsd: number
  inputTokens: number
  outputTokens: number
}

/**
 * Everything of one stage turn's request but its messages — the model, the
 * output cap, the temperature (omitted for a model that refuses one), the
 * system block and the `emit` tool with its tool_choice. `callLLM` adds the
 * user turn per attempt; exported so a live probe sends exactly what a stage
 * sends.
 */
export function buildStageRequest(opts: {
  modelId: string
  task: string
  temperature?: number
  systemPrompt: string
  schema: z.ZodType<unknown, unknown>
  cacheSystemPrompt?: boolean
}): { request: Omit<Anthropic.Messages.MessageCreateParamsNonStreaming, "messages">; autoTool: boolean } {
  const { modelId, task, temperature = 0.3, systemPrompt, schema, cacheSystemPrompt = true } = opts
  // Use draft-7 (JSON Schema) not OpenAPI 3.0. Anthropic's Messages API
  // requires tool input_schema to match JSON Schema draft 2020-12 strictly —
  // it rejects OpenAPI-specific extensions like `nullable: true` (Zod's
  // .nullable() / .nullish() emit that under target=openApi3, breaking every
  // tool call). Draft 7 is a compatible subset of 2020-12 and uses
  // `"type": [..., "null"]` for nullable fields, which Anthropic accepts.
  // io:"input" mirrors zod-to-json-schema's semantics (defaulted fields optional).
  const jsonSchema = restrictObjectSchemas(
    z.toJSONSchema(schema, { target: "draft-7", unrepresentable: "any", io: "input" }) as Record<string, unknown>,
  )
  delete jsonSchema.$schema

  // A model that refuses a forced `tool_choice` (registry
  // `supportsForcedToolChoice: false` — Sonnet 5.5 / Opus 5.5 answer one with a
  // 400) is asked the way the unified client asks it: `tool_choice: auto`, the
  // tool `strict` when the schema fits, and a line in the system prompt naming
  // the tool (`anthropicStructuredTool`). Every other model keeps the forced
  // shape byte-for-byte.
  const registryModel = getLlmModel(normalizeModelId(modelId))
  const autoTool =
    registryModel?.supportsForcedToolChoice === false
      ? anthropicStructuredTool(registryModel, systemPrompt, { name: "emit", schema: jsonSchema })
      : null

  const toolDef: Anthropic.Messages.Tool = {
    // The auto shape's tool carries the strict-subset schema and `strict: true`.
    ...(autoTool?.tools[0] as Partial<Anthropic.Messages.Tool> | undefined),
    name: "emit",
    description: `Emit a structured ${task} result.`,
    input_schema: (autoTool?.tools[0]?.input_schema ?? jsonSchema) as Anthropic.Messages.Tool.InputSchema,
  }
  const toolChoice: Anthropic.Messages.ToolChoice = autoTool
    ? { type: "auto" }
    : { type: "tool", name: "emit" }

  const systemBlock: Anthropic.Messages.TextBlockParam[] = [
    {
      type: "text",
      text: autoTool ? autoTool.system : systemPrompt,
      ...(cacheSystemPrompt ? { cache_control: { type: "ephemeral" } } : {}),
    },
  ]

  // Anthropic's reasoning models (Opus 4.7+) reject the `temperature`
  // parameter with a 400 — extended-thinking is incompatible with explicit
  // temperature control. Omit it for those models; older Sonnet/Haiku still
  // accept it.
  const supportsTemperature = !TEMPERATURE_UNSUPPORTED_MODELS.has(modelId)
  return {
    request: {
      model: modelId,
      max_tokens: THINKING_DEFAULT_ON_MODELS.has(modelId) ? STAGE_MAX_TOKENS_THINKING : STAGE_MAX_TOKENS,
      ...(supportsTemperature ? { temperature } : {}),
      system: systemBlock,
      tools: [toolDef],
      tool_choice: toolChoice,
    },
    autoTool: autoTool !== null,
  }
}

/**
 * Structured output via the Anthropic tools API (direct SDK) + Zod schema
 * validation + llm_calls audit insert + retry-on-invalid loop. Used by every
 * pipeline LLM. The `emit` tool is FORCED (`tool_choice: tool`) for every model
 * that accepts that; a model whose registry entry says
 * `supportsForcedToolChoice: false` is asked with `tool_choice: auto`, a strict
 * tool and a system-prompt line naming it, and a JSON answer it writes as text
 * is read too.
 *
 * Two stop reasons end the loop early, on either path: `refusal` fails at once
 * with {@link CallLLMRefusalError} (re-asking the same request is routing
 * around a content decision), and `max_tokens` with no usable answer is
 * retried once, then fails with {@link CallLLMTruncatedError}. Every failure
 * still writes its llm_calls row with the tokens and cost spent.
 */
export async function callLLM<T>(args: CallLLMArgs<T>): Promise<CallLLMResult<T>> {
  const {
    supabase,
    pipelineId,
    stageId,
    sceneId,
    userId,
    role,
    task,
    modelId,
    temperature = 0.3,
    systemPrompt,
    userPrompt,
    schema,
    maxRetries = 2,
    cacheSystemPrompt = true,
    onProgress,
    progressMinIntervalMs = 750,
  } = args

  const anthropic = getAnthropicClient()
  const retries = Math.max(0, maxRetries)

  const { request: stageRequest, autoTool } = buildStageRequest({
    modelId,
    task,
    temperature,
    systemPrompt,
    schema,
    cacheSystemPrompt,
  })

  let lastError: string | null = null
  let totalIn = 0
  let totalOut = 0
  let cacheCreate = 0
  let cacheRead = 0
  const t0 = Date.now()
  let truncations = 0

  // The llm_calls row of a call that ends without an answer — the tokens and
  // cost were spent all the same.
  const recordFailure = async (errorText: string): Promise<void> => {
    const { error: auditError } = await supabase.from("llm_calls").insert({
      pipeline_id: pipelineId,
      stage_id: stageId,
      user_id: userId,
      role,
      task,
      model_id: modelId,
      input_tokens: totalIn,
      output_tokens: totalOut,
      cache_creation_input_tokens: cacheCreate,
      cache_read_input_tokens: cacheRead,
      cost_usd: estimateCost(modelId, totalIn, totalOut, cacheCreate, cacheRead),
      duration_ms: Date.now() - t0,
      success: false,
      error: errorText,
    })
    if (auditError) {
      // eslint-disable-next-line no-console -- audit-row failure must not be silently swallowed
      console.error("[callLLM] Failed to write llm_calls failure row:", auditError.message)
    }
  }

  for (let attempt = 0; attempt <= retries; attempt++) {
    const userContent =
      typeof userPrompt === "string"
        ? [
            {
              type: "text" as const,
              text:
                attempt === 0
                  ? userPrompt
                  : `${userPrompt}\n\nYOUR PREVIOUS ATTEMPT FAILED VALIDATION:\n${lastError}\n\nRetry, honoring the schema strictly.`,
            },
          ]
        : userPrompt

    const createParams: Anthropic.Messages.MessageCreateParamsNonStreaming = {
      ...stageRequest,
      messages: [{ role: "user" as const, content: userContent }],
    }
    // Streaming path: only when the caller wants progress events. The non-
    // streaming path stays as the default so the dozens of other LLM helpers
    // keep their existing 2 fewer hops + no event-emitter overhead.
    //
    // Fallback behavior: if `stream()` throws (network blip, SDK
    // regression), we re-throw to the outer retry loop — same as the
    // non-streaming path. We do NOT silently fall back to `create()`
    // because that would mask streaming bugs behind a working pipeline.
    // Pluck the in-flight pipeline's abort signal from AsyncLocalStorage
    // (set by pipeline-worker on each BullMQ job). When the user hits
    // Cancel, the worker calls ctrl.abort() and this signal fires —
    // the Anthropic SDK rejects the in-flight request with an
    // AbortError that propagates out, exiting drivePipeline cleanly
    // instead of burning 1-3 min on a now-irrelevant Showrunner
    // generation. Outside the pipeline-worker (other callers, tests)
    // signal is undefined and Anthropic gets the createParams unchanged.
    const signal = getPipelineSignal()
    let resp: Anthropic.Messages.Message
    try {
      if (onProgress) {
        resp = await runStreamingMessage(
          anthropic,
          createParams,
          onProgress,
          progressMinIntervalMs,
          signal,
        )
      } else {
        resp = await anthropic.messages.create(
          createParams,
          signal ? { signal } : undefined,
        )
      }
    } catch (err) {
      // The platform's own account refusing (balance gone, key refused) is
      // never the vendor's reply on a stage's error: every stage stores
      // `err.message` as it is. The raw reply stays in `internalDetails`
      // (error_detail) and the [ALERT] log line.
      const typed = toPlatformExhausted(err, { lane: "direct", provider: "anthropic", modelId })
      if (typed instanceof LlmPlatformExhaustedError) {
        throw Object.assign(new Error(typed.userMessage, { cause: typed }), { internalDetails: typed.internalDetails })
      }
      throw err
    }

    totalIn += resp.usage.input_tokens
    totalOut += resp.usage.output_tokens
    cacheCreate += resp.usage.cache_creation_input_tokens ?? 0
    cacheRead += resp.usage.cache_read_input_tokens ?? 0

    // A content refusal is the model's answer about this request: asking the
    // same request again is routing around it, so it ends the call at once.
    if (resp.stop_reason === "refusal") {
      const detail = `direct ${modelId} stopped with refusal on ${task} (in ${totalIn} / out ${totalOut} tokens)`
      await recordFailure(`refusal: ${detail}`)
      throw new CallLLMRefusalError(detail, {
        inputTokens: totalIn,
        outputTokens: totalOut,
        providerCost: estimateCost(modelId, totalIn, totalOut, cacheCreate, cacheRead),
        complete: true,
      })
    }
    const truncated = resp.stop_reason === "max_tokens"

    const toolUse = resp.content.find((b): b is Anthropic.Messages.ToolUseBlock => b.type === "tool_use")
    // Under `tool_choice: auto` a model may answer with the JSON as plain text
    // instead of a tool call — read it there before spending a retry.
    const rawOutput = toolUse ? toolUse.input : autoTool ? jsonFromText(resp.content) : undefined
    // Optional preprocess (e.g., truncateCriticFields) runs before Zod so
    // recoverable overshoots don't trigger needless retries.
    const parsed =
      rawOutput === undefined ? undefined : schema.safeParse(args.preprocess ? args.preprocess(rawOutput) : rawOutput)
    if (!parsed?.success) {
      // Cut off at the output cap with nothing usable: one more try (the
      // reasoning differs run to run), then a failure that says so instead of
      // a schema complaint about a fragment.
      if (truncated) {
        truncations++
        if (truncations > 1 || attempt === retries) {
          await recordFailure(`max_tokens: ${task} cut off at ${createParams.max_tokens} output tokens`)
          throw new CallLLMTruncatedError(task, createParams.max_tokens)
        }
        lastError = "Your answer was cut off at the output token cap before the emit call finished. Be more concise."
        continue
      }
      lastError = parsed
        ? parsed.error.issues
            .slice(0, 5)
            .map((i) => `${i.path.join(".")}: ${i.message}`)
            .join("; ")
        : "Model did not call the emit tool."
      continue
    }
    // Success — write llm_calls row.
    const costUsd = estimateCost(modelId, totalIn, totalOut, cacheCreate, cacheRead)
    const { data: llmCall, error } = await supabase
      .from("llm_calls")
      .insert({
        pipeline_id: pipelineId,
        stage_id: stageId,
        user_id: userId,
        role,
        task,
        model_id: modelId,
        input_tokens: totalIn,
        output_tokens: totalOut,
        cache_creation_input_tokens: cacheCreate,
        cache_read_input_tokens: cacheRead,
        cost_usd: costUsd,
        duration_ms: Date.now() - t0,
        success: true,
      })
      .select("id")
      .single()
    if (error || !llmCall) {
      // eslint-disable-next-line no-console -- audit-row failure must not be silently swallowed
      console.error("[callLLM] Failed to write llm_calls success row:", error?.message ?? "unknown")
      // Don't throw — the LLM call succeeded and the caller needs the output. Audit gap accepted.
      return {
        output: parsed.data,
        llmCallId: "unrecorded",
        costUsd,
        inputTokens: totalIn,
        outputTokens: totalOut,
      }
    }
    return {
      output: parsed.data,
      llmCallId: llmCall.id,
      costUsd,
      inputTokens: totalIn,
      outputTokens: totalOut,
    }
  }

  // All retries exhausted — record failure + throw.
  await recordFailure(lastError ?? "unknown")
  throw new CallLLMValidationError(`${task} validation failed after ${retries + 1} attempts: ${lastError}`)
}

export class CallLLMValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "CallLLMValidationError"
  }
}

/**
 * The model refused the request on content grounds (`stop_reason: "refusal"`).
 * `message` is the content-policy sentence every LLM path shows — a stage
 * stores `err.message` as its failure reason, as it does for every throw here —
 * and the shared {@link LlmContentRefusalError} rides `cause`, carrying the
 * usage and the duck-typed `contentPolicyClass` the safety-block seam reads.
 * The diagnostic (model, task, tokens) is `internalDetails`.
 */
export class CallLLMRefusalError extends Error {
  readonly code = "content_refusal"
  readonly internalDetails: string
  constructor(detail: string, usage: ConstructorParameters<typeof LlmContentRefusalError>[1]) {
    super(LLM_CONTENT_REFUSAL_MESSAGE, {
      cause: new LlmContentRefusalError(`${LLM_CONTENT_REFUSAL_MESSAGE} (${detail})`, usage),
    })
    this.name = "CallLLMRefusalError"
    this.internalDetails = detail
  }
}

/** The answer was cut off at the output cap twice (or on the last attempt) — never a usable emit. */
export class CallLLMTruncatedError extends Error {
  readonly code = "output_truncated"
  constructor(task: string, maxTokens: number) {
    super(`${task}: the answer was cut off at the token cap (${maxTokens} output tokens) before the model finished.`)
    this.name = "CallLLMTruncatedError"
  }
}

/**
 * Provider cost of one pipeline call, from the ONE rate table the rest of the
 * platform uses (`calculateLlmCost`, lib/pricing/llm-cost.ts) on the DIRECT
 * lane — this wrapper only ever calls the Anthropic SDK. It used to keep its own
 * table, which went stale (Opus 4.7 at $15/$75 against a $5/$25 list; decided
 * 2026-10-08: every call is costed at the rates of the lane that served it).
 * An id the registry does not know costs 0, as before.
 */
function estimateCost(
  modelId: string,
  inputTokens: number,
  outputTokens: number,
  cacheCreate: number,
  cacheRead: number,
): number {
  const model = getLlmModel(normalizeModelId(modelId))
  if (!model) return 0
  // Anthropic Usage fields are disjoint: input_tokens is the non-cached portion
  // only — the shape LlmCostUsage's cache fields expect.
  return calculateLlmCost(
    model,
    { inputTokens, outputTokens, cacheWriteTokens: cacheCreate, cacheReadTokens: cacheRead },
    "direct",
  )
}

/** The JSON a model wrote as text (no tool call), or undefined when there is none. */
function jsonFromText(content: Anthropic.Messages.ContentBlock[]): unknown {
  const text = content
    .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
  if (!text.trim()) return undefined
  try {
    return JSON.parse(extractJsonFromAIResponse(text))
  } catch {
    return undefined
  }
}

// Anthropic accepts both alias ("claude-opus-4-7") and dated ("claude-opus-4-7-20251201").
// The registry resolves the alias (its direct-lane slug). Normalize before lookup.
function normalizeModelId(modelId: string): string {
  // Strip optional date suffix: "claude-haiku-4-5-20251001" -> "claude-haiku-4-5"
  return modelId.replace(/-\d{8}$/, "")
}

/**
 * Streaming variant of `messages.create`. Returns the same `Message` shape
 * after the stream resolves; callers can extract `tool_use` content the
 * same way as the non-streaming path.
 *
 * Emits `onProgress`:
 *   - once with `phase: "starting"` immediately before the API call
 *   - repeatedly with `phase: "drafting"` as tool-use input deltas arrive
 *     (throttled to one event per `minIntervalMs`)
 *   - once with `phase: "finalizing"` after `finalMessage()` resolves
 *
 * Callback exceptions are caught + logged so a buggy callback can't
 * abort an otherwise-successful LLM call.
 */
async function runStreamingMessage(
  anthropic: ReturnType<typeof getAnthropicClient>,
  params: Anthropic.Messages.MessageCreateParamsNonStreaming,
  onProgress: (update: ProgressUpdate) => void,
  minIntervalMs: number,
  signal: AbortSignal | undefined,
): Promise<Anthropic.Messages.Message> {
  safeCall(onProgress, { phase: "starting" })

  const stream = anthropic.messages.stream(params)

  // Hard-interrupt on user cancel — wire the pipeline-context AbortSignal
  // through to the SDK's stream.abort(). The SDK's stream object exposes
  // its own abort() rather than taking a signal option, so we mirror the
  // pattern used by lib/llm-client.ts:streamAnthropicDirect.
  if (signal) {
    if (signal.aborted) {
      // Already aborted before we registered — abort immediately so the
      // await below rejects fast instead of waiting on a doomed request.
      stream.abort()
    } else {
      signal.addEventListener("abort", () => stream.abort(), { once: true })
    }
  }

  let bytesSoFar = 0
  let lastEmitMs = 0
  stream.on("inputJson", (delta: string) => {
    bytesSoFar += delta.length
    const now = Date.now()
    if (now - lastEmitMs >= minIntervalMs) {
      lastEmitMs = now
      safeCall(onProgress, { phase: "drafting", bytesSoFar })
    }
  })

  const finalMessage = await stream.finalMessage()
  safeCall(onProgress, { phase: "finalizing", bytesSoFar })
  return finalMessage
}

function safeCall(
  cb: (update: ProgressUpdate) => void,
  update: ProgressUpdate,
): void {
  try {
    cb(update)
  } catch (err) {
    // eslint-disable-next-line no-console -- callback failure is a caller bug; surface it but don't abort the LLM call
    console.error(
      "[callLLM] onProgress callback threw:",
      err instanceof Error ? err.message : String(err),
    )
  }
}
