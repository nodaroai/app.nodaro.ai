import type Anthropic from "@anthropic-ai/sdk"
import { z } from "zod"
import zodToJsonSchema from "zod-to-json-schema"
import type { SupabaseClient } from "@supabase/supabase-js"
import { getAnthropicClient } from "../../../lib/anthropic.js"

export type LLMRole = "detection" | "showrunner" | "scene_director" | "critic" | "helper" | "specialist"

/**
 * Models that reject the `temperature` parameter with a 400. Add new reasoning
 * models here as they ship. Anthropic's extended-thinking models (Opus 4.7+)
 * don't accept temperature; their output diversity is controlled by the
 * thinking budget, not by sampling temperature.
 */
const TEMPERATURE_UNSUPPORTED_MODELS = new Set<string>([
  "claude-opus-4-7",
])

// Accept any Zod schema whose PARSED OUTPUT is T. The schema's INPUT type may
// diverge from T (e.g. ZodDefault makes input optional but output required),
// which is the case for ShowrunnerPlanSchema. zodToJsonSchema + safeParse only
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
  schema: z.ZodType<T, z.ZodTypeDef, unknown>
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
 * Forced structured output via Anthropic tools API + Zod schema validation +
 * llm_calls audit insert + retry-on-invalid loop. Used by every pipeline LLM.
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

  // Use draft-7 (JSON Schema) not OpenAPI 3.0. Anthropic's Messages API
  // requires tool input_schema to match JSON Schema draft 2020-12 strictly —
  // it rejects OpenAPI-specific extensions like `nullable: true` (Zod's
  // .nullable() / .nullish() emit that under target=openApi3, breaking every
  // tool call). Draft 7 is a compatible subset of 2020-12 and uses
  // `"type": [..., "null"]` for nullable fields, which Anthropic accepts.
  const jsonSchema = zodToJsonSchema(schema, { target: "jsonSchema7" }) as Record<string, unknown>

  const toolDef: Anthropic.Messages.Tool = {
    name: "emit",
    description: `Emit a structured ${task} result.`,
    input_schema: jsonSchema as Anthropic.Messages.Tool.InputSchema,
  }

  const systemBlock: Anthropic.Messages.TextBlockParam[] = [
    {
      type: "text",
      text: systemPrompt,
      ...(cacheSystemPrompt ? { cache_control: { type: "ephemeral" } } : {}),
    },
  ]

  let lastError: string | null = null
  let totalIn = 0
  let totalOut = 0
  let cacheCreate = 0
  let cacheRead = 0
  const t0 = Date.now()

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

    // Anthropic's reasoning models (Opus 4.7+) reject the `temperature`
    // parameter with a 400 — extended-thinking is incompatible with explicit
    // temperature control. Omit it for those models; Sonnet/Haiku still
    // accept it.
    const supportsTemperature = !TEMPERATURE_UNSUPPORTED_MODELS.has(modelId)
    const createParams = {
      model: modelId,
      max_tokens: 8192,
      ...(supportsTemperature ? { temperature } : {}),
      system: systemBlock,
      tools: [toolDef],
      tool_choice: { type: "tool", name: "emit" } as const,
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
    let resp: Anthropic.Messages.Message
    if (onProgress) {
      resp = await runStreamingMessage(
        anthropic,
        createParams,
        onProgress,
        progressMinIntervalMs,
      )
    } else {
      resp = await anthropic.messages.create(createParams)
    }

    totalIn += resp.usage.input_tokens
    totalOut += resp.usage.output_tokens
    cacheCreate += resp.usage.cache_creation_input_tokens ?? 0
    cacheRead += resp.usage.cache_read_input_tokens ?? 0

    const toolUse = resp.content.find((b): b is Anthropic.Messages.ToolUseBlock => b.type === "tool_use")
    if (!toolUse) {
      lastError = "Model did not call the emit tool."
      continue
    }
    // Optional preprocess (e.g., truncateCriticFields) runs before Zod so
    // recoverable overshoots don't trigger needless retries.
    const emitInput = args.preprocess ? args.preprocess(toolUse.input) : toolUse.input
    const parsed = schema.safeParse(emitInput)
    if (!parsed.success) {
      lastError = parsed.error.issues
        .slice(0, 5)
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ")
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
    error: lastError ?? "unknown",
  })
  if (auditError) {
    // eslint-disable-next-line no-console -- audit-row failure must not be silently swallowed
    console.error("[callLLM] Failed to write llm_calls failure row:", auditError.message)
  }
  throw new CallLLMValidationError(`${task} validation failed after ${retries + 1} attempts: ${lastError}`)
}

export class CallLLMValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "CallLLMValidationError"
  }
}

// Anthropic pricing as of model launch (USD per million tokens). Update when prices change.
const MODEL_PRICING: Record<string, { input: number; output: number; cacheWrite: number; cacheRead: number }> = {
  "claude-haiku-4-5":  { input: 1.0, output: 5.0,  cacheWrite: 1.25, cacheRead: 0.10 },
  "claude-sonnet-4-6": { input: 3.0, output: 15.0, cacheWrite: 3.75, cacheRead: 0.30 },
  "claude-opus-4-7":   { input: 15.0, output: 75.0, cacheWrite: 18.75, cacheRead: 1.50 },
}

function estimateCost(
  modelId: string,
  inputTokens: number,
  outputTokens: number,
  cacheCreate: number,
  cacheRead: number,
): number {
  const p = MODEL_PRICING[normalizeModelId(modelId)]
  if (!p) return 0
  // Anthropic Usage fields are disjoint: input_tokens is the non-cached portion only.
  return (
    (inputTokens * p.input +
      outputTokens * p.output +
      cacheCreate * p.cacheWrite +
      cacheRead * p.cacheRead) /
    1_000_000
  )
}

// Anthropic accepts both alias ("claude-opus-4-7") and dated ("claude-opus-4-7-20251201").
// MODEL_PRICING is keyed on the alias. Normalize before lookup.
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
): Promise<Anthropic.Messages.Message> {
  safeCall(onProgress, { phase: "starting" })

  const stream = anthropic.messages.stream(params)

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
