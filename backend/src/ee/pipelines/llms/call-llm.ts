import type Anthropic from "@anthropic-ai/sdk"
import { z } from "zod"
import type { SupabaseClient } from "@supabase/supabase-js"
import { LLM_MODELS, getLlmModel, type LlmModelDef } from "@nodaro/shared/llm-models"
import { calculateLlmCost } from "../../../lib/pricing/llm-cost.js"
import { getAnthropicClient } from "../../../lib/anthropic.js"
import {
  LLM_CONTENT_REFUSAL_MESSAGE,
  LlmContentRefusalError,
  LlmLaneError,
  LlmOutputTruncatedError,
  LlmPlatformExhaustedError,
  LlmStreamResponseError,
  billedProviderCost,
  toPlatformExhausted,
} from "../../../lib/llm-errors.js"
import { exhaustionSignalOf } from "../../../lib/llm-platform-exhaustion.js"
import { getPipelineSignal } from "../pipeline-context.js"
import { restrictObjectSchemas } from "../../../lib/json-schema-strict.js"
import { anthropicStructuredTool } from "../../../lib/llm/message-builders.js"
import { extractJsonFromAIResponse } from "../../../lib/json-utils.js"
import { anthropicKeySet, kieKeySet, pickClaudeLane, type ClaudeLane } from "../../../lib/llm/anthropic-availability.js"
import { callKie } from "../../../lib/llm/kie-lane.js"
import { inlineImagesForClaudeKie } from "../../../lib/llm/claude-kie-images.js"
import { kieCostUsd, kieFailureCostUsd, kieInputTokens, requestChars } from "../../../lib/llm/kie-cost.js"
import type { LlmContentBlock, LlmRequest } from "../../../lib/llm/types.js"
import { kieRetryable } from "../../copilot/lane.js"

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

/** A KIE attempt's deadline — the direct client's own (`lib/anthropic.ts`); the Showrunner takes minutes. */
export const PIPELINE_KIE_TIMEOUT_MS = 600_000

/**
 * KIE's failures come in bursts of a minute or two, longer than `callKie`'s own
 * transport ladder. A KIE try that failed transiently (429, 5xx, KIE's 400
 * "Internal error", a connection error) before any charge is tried again after
 * `pauseMs`, as long as the next try starts within `windowMs` of the attempt's
 * FIRST KIE call and before its 600 s KIE deadline — so the busy sentence comes
 * about 3 minutes in at worst. Those tries are single shots (no transport
 * ladder of their own: the pauses are the ladder), are not validation retries
 * and write no row of their own. Mutable so tests can run them without
 * waiting.
 */
export const PIPELINE_KIE_BURST = {
  pauseMs: 20_000,
  windowMs: 180_000,
  now: (): number => Date.now(),
}

/** What a stage stores when its KIE attempt failed for good. */
export const PIPELINE_KIE_BUSY_MESSAGE =
  "The AI service is busy right now — try again in a few minutes. Your credits were not charged."

/** The models the stages ask by default; any other `modelId` reaching callLLM is a pipeline's pinned script model. */
const PIPELINE_DEFAULT_MODEL_IDS = new Set(["claude-sonnet-5-5", "claude-haiku-5-5"])

/** What a stage stores when KIE could not serve a pinned script model — no substitute is tried. */
export function pinnedModelUnavailableMessage(displayName: string): string {
  return `${displayName} isn't available right now — switch the script model to Claude Sonnet 5.5 or try again later`
}

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
}): {
  request: Omit<Anthropic.Messages.MessageCreateParamsNonStreaming, "messages">
  autoTool: boolean
  jsonSchema: Record<string, unknown>
} {
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

  // The schema as the caller wrote it (draft-7, before any lane's rewrite) —
  // what a KIE attempt pastes into its system prompt. A copy: the strict-tool
  // rewrite below must never reach it.
  const promptJsonSchema = structuredClone(jsonSchema)

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
    jsonSchema: promptJsonSchema,
  }
}

/**
 * Structured output for a pipeline stage + Zod validation + the llm_calls
 * audit row + the retry-on-invalid loop. Used by every pipeline LLM.
 *
 * Each attempt picks its lane (`pickClaudeLane`): the platform's Anthropic
 * account while it is usable, else KIE. On the direct lane the `emit` tool is
 * FORCED (`tool_choice: tool`) for every model that accepts that; a model
 * whose registry entry says `supportsForcedToolChoice: false` is asked with
 * `tool_choice: auto`, a strict tool and a system-prompt line naming it, and a
 * JSON answer it writes as text is read too. A direct attempt the account
 * refuses (balance or key — which also latches the lane) or whose tool schema
 * the API rejects runs again at once on KIE. On KIE the attempt is
 * prompt-JSON (`callKie`: the schema in the system prompt, no tool), its
 * images inlined, under the direct client's deadline and the pipeline's
 * cancel.
 *
 * KIE fails in bursts, so a transient KIE failure that cost nothing is not
 * final ({@link PIPELINE_KIE_BURST}): it is tried again every 20 s for up to
 * about 3 minutes from the attempt's first KIE call, and only then fails with
 * the busy sentence.
 *
 * Two stop reasons end the loop early, on either lane: a refusal fails at once
 * with {@link CallLLMRefusalError} (re-asking the same request is routing
 * around a content decision), and a cut-off answer with nothing usable is
 * retried once, then fails with {@link CallLLMTruncatedError}. A retry carries
 * the validation error, for a text prompt and a block prompt alike. Every
 * failure writes its llm_calls row with the tokens and cost spent.
 */
export async function callLLM<T>(args: CallLLMArgs<T>): Promise<CallLLMResult<T>> {
  const {
    supabase,
    pipelineId,
    stageId,
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

  const retries = Math.max(0, maxRetries)

  const { request: stageRequest, autoTool, jsonSchema } = buildStageRequest({
    modelId,
    task,
    temperature,
    systemPrompt,
    schema,
    cacheSystemPrompt,
  })
  // The registry entry a KIE attempt asks for. An id the registry does not
  // know has no KIE twin, so its stage stays on the direct lane.
  const registryModel = getLlmModel(normalizeModelId(modelId))

  let lastError: string | null = null
  let totalIn = 0
  let totalOut = 0
  let cacheCreate = 0
  let cacheRead = 0
  let totalCost = 0
  let lane: ClaudeLane = "direct"
  let kieBaseBlocks: LlmContentBlock[] | null = null
  const t0 = Date.now()
  let truncations = 0

  const callRow = (extra: Record<string, unknown>): Record<string, unknown> => ({
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
    cost_usd: totalCost,
    duration_ms: Date.now() - t0,
    lane,
    ...extra,
  })

  // The llm_calls row of a call that ends without an answer — the tokens and
  // cost were spent all the same.
  const recordFailure = async (errorText: string): Promise<void> => {
    const { error } = await insertLlmCallRow(supabase, callRow({ success: false, error: errorText }), false)
    if (error) {
      // eslint-disable-next-line no-console -- audit-row failure must not be silently swallowed
      console.error("[callLLM] Failed to write llm_calls failure row:", error)
    }
  }

  for (let attempt = 0; attempt <= retries; attempt++) {
    const feedback = attempt === 0 || lastError === null ? null : retryFeedback(lastError)
    // The in-flight pipeline's abort signal (AsyncLocalStorage, set by the
    // pipeline worker per job): a user's Cancel ends the request at once.
    // Undefined outside a pipeline.
    const signal = getPipelineSignal()
    lane = registryModel ? pickClaudeLane() : "direct"
    let laneReason = lane === "kie" ? (anthropicKeySet() ? "the Anthropic direct lane is latched" : "no Anthropic key") : ""
    let outcome: AttemptOutcome | undefined

    if (lane === "direct") {
      try {
        outcome = await runDirectAttempt({
          stageRequest,
          userContent: withRetryFeedback(userPrompt, feedback),
          onProgress,
          progressMinIntervalMs,
          signal,
          autoTool,
          modelId,
        })
      } catch (err) {
        laneReason = directFailureToKie(err, { modelId, task, kieAvailable: Boolean(registryModel) && kieKeySet() })
        lane = "kie"
      }
    }

    if (lane === "kie") {
      const model = registryModel!
      // No key is said once per process (`pickClaudeLane`'s K2 line); a latch or a refusal is said per attempt.
      if (laneReason !== "no Anthropic key") {
        // eslint-disable-next-line no-console -- the lane is the operator's only signal until llm_calls.lane exists everywhere
        console.warn(`[callLLM] ${task}: ${modelId} served from KIE — ${laneReason}`)
      }
      // Under the pipeline's cancel: a Cancel while the images are fetched ends the call at once.
      kieBaseBlocks ??= typeof userPrompt === "string" ? [] : await inlineImagesForClaudeKie(userPrompt, signal)
      const blocks = kieUserBlocks(userPrompt, kieBaseBlocks, feedback)
      // One deadline for this attempt's KIE tries, however many a burst takes.
      const deadline = AbortSignal.timeout(PIPELINE_KIE_TIMEOUT_MS)
      const firstCallAt = PIPELINE_KIE_BURST.now()
      const deadlineAt = firstCallAt + PIPELINE_KIE_TIMEOUT_MS
      let burstTry = false
      while (outcome === undefined) {
        try {
          outcome = await runKieAttempt({
            model,
            systemPrompt,
            blocks,
            jsonSchema,
            maxTokens: stageRequest.max_tokens,
            temperature,
            onProgress,
            signal,
            deadline,
            singleShot: burstTry,
          })
        } catch (err) {
          if (signal?.aborted) throw err
          if (kieBurstRetryable(err, deadline)) {
            const nextTryAt = PIPELINE_KIE_BURST.now() + PIPELINE_KIE_BURST.pauseMs
            if (nextTryAt < firstCallAt + PIPELINE_KIE_BURST.windowMs && nextTryAt < deadlineAt) {
              // eslint-disable-next-line no-console -- the operator's view of a burst being ridden out
              console.warn(
                `[callLLM] ${task}: KIE ${model.id} failed before any charge — trying again in ${PIPELINE_KIE_BURST.pauseMs} ms: ` +
                  String(err).slice(0, 160),
              )
              // A cancel during the pause ends the call at once, as a cancel.
              await pauseUnlessCancelled(PIPELINE_KIE_BURST.pauseMs, signal)
              burstTry = true
              continue
            }
          }
          const failure = pipelineKieFailure(err, modelId, model)
          await recordFailure(`kie: ${failure.internalDetails}`)
          throw failure
        }
      }
    }

    const result = outcome!
    totalIn += result.inputTokens
    totalOut += result.outputTokens
    cacheCreate += result.cacheCreate
    cacheRead += result.cacheRead
    totalCost += result.costUsd

    // A content refusal is the model's answer about this request: asking the
    // same request again is routing around it, so it ends the call at once.
    if (result.stop === "refusal") {
      const detail = `${lane} ${modelId} stopped with refusal on ${task} (in ${totalIn} / out ${totalOut} tokens)`
      await recordFailure(`refusal: ${detail}`)
      throw new CallLLMRefusalError(detail, {
        inputTokens: totalIn,
        outputTokens: totalOut,
        providerCost: totalCost,
        complete: true,
      })
    }

    // Optional preprocess (e.g., truncateCriticFields) runs before Zod so
    // recoverable overshoots don't trigger needless retries.
    const parsed =
      result.raw === undefined ? undefined : schema.safeParse(args.preprocess ? args.preprocess(result.raw) : result.raw)
    if (!parsed?.success) {
      // Cut off at the output cap with nothing usable: one more try (the
      // reasoning differs run to run), then a failure that says so instead of
      // a schema complaint about a fragment.
      if (result.stop === "truncated") {
        truncations++
        if (truncations > 1 || attempt === retries) {
          await recordFailure(`max_tokens: ${task} cut off at ${stageRequest.max_tokens} output tokens`)
          throw new CallLLMTruncatedError(task, stageRequest.max_tokens)
        }
        lastError = "Your answer was cut off at the output token cap before the emit call finished. Be more concise."
        continue
      }
      lastError = parsed
        ? parsed.error.issues
            .slice(0, 5)
            .map((i) => `${i.path.join(".")}: ${i.message}`)
            .join("; ")
        : result.noAnswerReason
      continue
    }

    // Success — write the llm_calls row. An audit gap is accepted: the caller needs the output.
    const { id, error } = await insertLlmCallRow(supabase, callRow({ success: true }), true)
    if (error || !id) {
      // eslint-disable-next-line no-console -- audit-row failure must not be silently swallowed
      console.error("[callLLM] Failed to write llm_calls success row:", error ?? "unknown")
    }
    return {
      output: parsed.data,
      llmCallId: id ?? "unrecorded",
      costUsd: totalCost,
      inputTokens: totalIn,
      outputTokens: totalOut,
    }
  }

  // All retries exhausted — record failure + throw.
  await recordFailure(lastError ?? "unknown")
  throw new CallLLMValidationError(`${task} validation failed after ${retries + 1} attempts: ${lastError}`)
}

/** What one attempt produced, on either lane — the loop above reads only this. */
interface AttemptOutcome {
  /** The structured answer as the model wrote it (tool input or parsed JSON), or undefined when there is none. */
  raw: unknown
  stop: "answer" | "refusal" | "truncated"
  inputTokens: number
  outputTokens: number
  cacheCreate: number
  cacheRead: number
  /** This attempt's provider cost, at the rates of the lane that served it. */
  costUsd: number
  /** The retry feedback when `raw` is missing. */
  noAnswerReason: string
}

/** One attempt on the direct SDK — exactly the request this path has always sent. */
async function runDirectAttempt(opts: {
  stageRequest: Omit<Anthropic.Messages.MessageCreateParamsNonStreaming, "messages">
  userContent: Anthropic.Messages.ContentBlockParam[]
  onProgress: ((update: ProgressUpdate) => void) | undefined
  progressMinIntervalMs: number
  signal: AbortSignal | undefined
  autoTool: boolean
  modelId: string
}): Promise<AttemptOutcome> {
  const anthropic = getAnthropicClient()
  const createParams: Anthropic.Messages.MessageCreateParamsNonStreaming = {
    ...opts.stageRequest,
    messages: [{ role: "user" as const, content: opts.userContent }],
  }
  // Streaming only when the caller wants progress events; the non-streaming
  // call stays the default. A `stream()` failure is re-thrown to the loop, as
  // a `create()` one is — never a silent fall back to `create()`, which would
  // mask streaming bugs behind a working pipeline. Outside a pipeline the
  // signal is undefined and `create` gets the params unchanged.
  const resp = opts.onProgress
    ? await runStreamingMessage(anthropic, createParams, opts.onProgress, opts.progressMinIntervalMs, opts.signal)
    : await anthropic.messages.create(createParams, opts.signal ? { signal: opts.signal } : undefined)

  const inputTokens = resp.usage.input_tokens
  const outputTokens = resp.usage.output_tokens
  const cacheCreate = resp.usage.cache_creation_input_tokens ?? 0
  const cacheRead = resp.usage.cache_read_input_tokens ?? 0
  const toolUse = resp.content.find((b): b is Anthropic.Messages.ToolUseBlock => b.type === "tool_use")
  return {
    // Under `tool_choice: auto` a model may answer with the JSON as plain text
    // instead of a tool call — read it there before spending a retry.
    raw: toolUse ? toolUse.input : opts.autoTool ? jsonFromText(resp.content) : undefined,
    stop: resp.stop_reason === "refusal" ? "refusal" : resp.stop_reason === "max_tokens" ? "truncated" : "answer",
    inputTokens,
    outputTokens,
    cacheCreate,
    cacheRead,
    costUsd: estimateCost(opts.modelId, inputTokens, outputTokens, cacheCreate, cacheRead),
    noAnswerReason: "Model did not call the emit tool.",
  }
}

/**
 * One attempt on KIE as prompt-JSON: the stage's own system prompt (KIE's
 * prompt-JSON suffix asks for bare JSON, which overrides the stage prompts'
 * "via the emit tool" wording), the draft-7 schema, images already inlined,
 * the direct client's deadline combined with the pipeline's cancel. A
 * refusal or a cut-off answer comes back as an outcome, like the direct
 * lane's stop reasons; any other failure is thrown.
 */
async function runKieAttempt(opts: {
  model: LlmModelDef
  systemPrompt: string
  blocks: LlmContentBlock[]
  jsonSchema: Record<string, unknown>
  maxTokens: number
  temperature: number
  onProgress: ((update: ProgressUpdate) => void) | undefined
  signal: AbortSignal | undefined
  /** The attempt's 600 s KIE deadline, shared by every try of a burst. */
  deadline: AbortSignal
  /** A burst try: no transport ladder inside `callKie` — the burst's own pauses replace it. */
  singleShot: boolean
}): Promise<AttemptOutcome> {
  const req: LlmRequest = {
    modelId: opts.model.id,
    system: opts.systemPrompt,
    messages: [{ role: "user", content: opts.blocks }],
    jsonSchema: { name: "emit", schema: opts.jsonSchema },
    maxTokens: opts.maxTokens,
    temperature: opts.temperature,
    failOnRefusal: true,
    timeoutMs: PIPELINE_KIE_TIMEOUT_MS,
    // A model that thinks by default on the direct lane thinks on KIE only when flagged.
    ...(opts.model.thinkingDefaultOn ? { thinkingFlag: true } : {}),
    ...(opts.singleShot ? { retryStreamOnError: false } : {}),
  }
  const signal = opts.signal ? AbortSignal.any([opts.signal, opts.deadline]) : opts.deadline
  const promptChars = requestChars(req)
  // KIE answers in one piece, so a progress caller sees the call start and end.
  if (opts.onProgress) safeCall(opts.onProgress, { phase: "starting" })
  try {
    const resp = await callKie(opts.model, req, signal)
    if (opts.onProgress) safeCall(opts.onProgress, { phase: "finalizing", bytesSoFar: resp.text.length })
    return {
      raw: parseJsonOrUndefined(resp.text),
      stop: "answer",
      // The size estimate: KIE's own input count leaves out our prompt.
      inputTokens: kieInputTokens(promptChars),
      outputTokens: resp.usage?.outputTokens ?? 0,
      cacheCreate: 0,
      cacheRead: 0,
      costUsd: kieCostUsd(opts.model.id, { creditsUsd: resp.creditsUsd, promptChars, answerChars: resp.text.length }),
      noAnswerReason: "Your answer was not one valid JSON object matching the schema.",
    }
  } catch (err) {
    if (err instanceof LlmContentRefusalError || err instanceof LlmOutputTruncatedError) {
      return {
        raw: undefined,
        stop: err instanceof LlmContentRefusalError ? "refusal" : "truncated",
        inputTokens: kieInputTokens(promptChars),
        outputTokens: err.usage.outputTokens,
        cacheCreate: 0,
        cacheRead: 0,
        costUsd: kieFailureCostUsd(opts.model.id, err.usage, promptChars),
        noAnswerReason: "",
      }
    }
    throw err
  }
}

/**
 * A failed direct attempt that KIE answers instead — returns why, for the log
 * line — or a throw:
 * - the platform account refused (balance or key; typed, alerted and latched
 *   by `toPlatformExhausted`): KIE, or the capacity sentence when there is no
 *   KIE leg;
 * - a 400 rejecting the stage's tool schema: KIE, with an `[ALERT]` naming
 *   it — so a schema the direct API stops accepting degrades instead of
 *   failing every stage;
 * - anything else (a pipeline cancel included) is thrown as it is.
 * The account check runs first: a drained balance is a 400 too.
 */
function directFailureToKie(err: unknown, ctx: { modelId: string; task: string; kieAvailable: boolean }): string {
  const typed = toPlatformExhausted(err, { lane: "direct", provider: "anthropic", modelId: ctx.modelId, latchAuth: true })
  if (typed instanceof LlmPlatformExhaustedError) {
    // The platform's own account refusing is never the vendor's reply on a
    // stage's error: the raw reply stays in internalDetails and the [ALERT] line.
    if (!ctx.kieAvailable) {
      throw Object.assign(new Error(typed.userMessage, { cause: typed }), { internalDetails: typed.internalDetails })
    }
    return `the Anthropic account refused (${typed.exhaustion})`
  }
  if (ctx.kieAvailable && isToolSchemaRejection(err)) {
    const detail = err instanceof Error ? err.message : String(err)
    // eslint-disable-next-line no-console -- an operator alert, same marker as the platform-exhaustion alert
    console.error(
      `[ALERT] pipeline ${ctx.task}: direct ${ctx.modelId} rejected the emit tool schema — this attempt runs on KIE prompt-JSON — ` +
        detail.replace(/\s+/g, " ").slice(0, 400),
    )
    return "the direct API rejected the tool schema"
  }
  throw err
}

/**
 * May a failed KIE try be tried again within a burst? Only a transient failure
 * that cost nothing — the Copilot's own rule (`kieRetryable`: 429, 5xx, KIE's
 * 400 `api_error` "Internal error", a network failure or KIE's stream error
 * frame with no status; never our own bug) — and
 * never one that reported usage, KIE's own account refusing, KIE having no
 * account for the model (`no_available_account`, K14), or the attempt's 600 s
 * deadline. None of those clears in a few minutes. A refusal or a cut-off
 * answer never gets here — they come back as outcomes.
 */
function kieBurstRetryable(err: unknown, deadline: AbortSignal): boolean {
  if (deadline.aborted || (err as { name?: unknown } | null)?.name === "TimeoutError") return false
  if (err instanceof LlmPlatformExhaustedError || err instanceof LlmStreamResponseError) return false
  if (billedProviderCost(err) !== null) return false
  if (/no_available_account/i.test(exhaustionSignalOf(err)?.text ?? "")) return false
  return kieRetryable(err)
}

/** Wait `ms`, or reject the moment the pipeline's cancel fires, with its reason as a cancel. */
function pauseUnlessCancelled(ms: number, signal: AbortSignal | undefined): Promise<void> {
  const cancelReason = (s: AbortSignal): Error =>
    s.reason instanceof Error ? s.reason : Object.assign(new Error("This operation was aborted"), { name: "AbortError" })
  if (signal?.aborted) return Promise.reject(cancelReason(signal))
  return new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer)
      reject(cancelReason(signal!))
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort)
      resolve()
    }, ms)
    signal?.addEventListener("abort", onAbort, { once: true })
  })
}

/** A direct 400 `invalid_request_error` that names the tool schema (`tools`, `input_schema`, `strict`). */
function isToolSchemaRejection(err: unknown): boolean {
  const signal = exhaustionSignalOf(err)
  if (!signal || signal.status !== 400) return false
  const text = signal.text.toLowerCase()
  return text.includes("invalid_request_error") && /\b(tools|input_schema|strict)\b/.test(text)
}

/**
 * A KIE attempt's failure as a stage stores it (`err.message` verbatim): the
 * capacity sentence for KIE's own account refusing, the busy sentence for any
 * other failure — or, for a pinned script model, a sentence naming it and the
 * model to switch to. The raw text stays in `internalDetails`, never on the
 * user's screen.
 */
function pipelineKieFailure(err: unknown, modelId: string, model: LlmModelDef): Error & { internalDetails: string } {
  const raw = err instanceof LlmLaneError ? err.internalDetails : err instanceof Error ? err.message : String(err)
  const message =
    err instanceof LlmPlatformExhaustedError
      ? err.userMessage
      : PIPELINE_DEFAULT_MODEL_IDS.has(normalizeModelId(modelId))
        ? PIPELINE_KIE_BUSY_MESSAGE
        : pinnedModelUnavailableMessage(model.displayName)
  return Object.assign(new Error(message, { cause: err }), { internalDetails: `kie ${model.id}: ${raw}` })
}

function retryFeedback(lastError: string): string {
  return `YOUR PREVIOUS ATTEMPT FAILED VALIDATION:\n${lastError}\n\nRetry, honoring the schema strictly.`
}

/** The direct lane's user turn: a text prompt with the feedback appended, a block prompt with it as a final text block. */
function withRetryFeedback(
  userPrompt: string | Anthropic.Messages.ContentBlockParam[],
  feedback: string | null,
): Anthropic.Messages.ContentBlockParam[] {
  if (typeof userPrompt === "string") {
    return [{ type: "text" as const, text: feedback ? `${userPrompt}\n\n${feedback}` : userPrompt }]
  }
  return feedback ? [...userPrompt, { type: "text" as const, text: feedback }] : userPrompt
}

/** The same user turn on the KIE wire, its images inlined once per call (`base`). */
function kieUserBlocks(
  userPrompt: string | Anthropic.Messages.ContentBlockParam[],
  base: LlmContentBlock[],
  feedback: string | null,
): LlmContentBlock[] {
  if (typeof userPrompt === "string") {
    return [{ type: "text", text: feedback ? `${userPrompt}\n\n${feedback}` : userPrompt }]
  }
  return feedback ? [...base, { type: "text", text: feedback }] : base
}

function parseJsonOrUndefined(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

/**
 * Write one llm_calls row. Staging runs dev's code against production's
 * database, and migrations reach that database only with the dev→main release
 * — so for that window the `lane` column may not exist, and PostgREST refuses
 * the WHOLE insert. The row is then written again without it rather than lost.
 */
async function insertLlmCallRow(
  supabase: SupabaseClient,
  row: Record<string, unknown>,
  withId: boolean,
): Promise<{ id: string | null; error: string | null }> {
  type Written = { id: string | null; error: { code?: string; message: string } | null }
  const write = async (values: Record<string, unknown>): Promise<Written> => {
    if (withId) {
      const { data, error } = await supabase.from("llm_calls").insert(values).select("id").single()
      return { id: (data as { id: string } | null)?.id ?? null, error }
    }
    const { error } = await supabase.from("llm_calls").insert(values)
    return { id: null, error }
  }
  let written = await write(row)
  if (written.error && laneColumnMissing(written.error)) {
    const withoutLane = { ...row }
    delete withoutLane.lane
    written = await write(withoutLane)
  }
  return { id: written.id, error: written.error?.message ?? null }
}

function laneColumnMissing(error: { code?: string; message?: string }): boolean {
  return error.code === "PGRST204" || /'lane' column/.test(error.message ?? "")
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
 * Provider cost of one DIRECT pipeline attempt, from the ONE rate table the
 * rest of the platform uses (`calculateLlmCost`, lib/pricing/llm-cost.ts) at
 * the direct lane's rates. A KIE attempt is costed by `kieCostUsd` instead —
 * every attempt is costed at the rates of the lane that served it. An id the
 * registry does not know costs 0, as before.
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
