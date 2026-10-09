import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { maybeProxyLlmRouteToCloud } from "../lib/cloud-llm-proxy.js"
import { z } from "zod"
import { buildMultiPickerAnalyzerSpec, applyMinorAgeFloorToPickerValues, PICKER_TYPES, type PickerType, type PickerGaps } from "@nodaro/prompts"
import { buildLlmCreditIdentifier, resolveLlmCreditId, getLlmModel, defaultReasoningEffort, LLM_FEATURE_DEFAULTS, LLM_MODEL_IDS, LLM_REASONING_EFFORTS, STRUCTURED_VISION_MODELS, type LlmModelDef, type LlmReasoningEffort } from "@nodaro/shared"
import { supabase } from "../lib/supabase.js"
import { insertJob } from "../lib/insert-job.js"
import { config } from "../lib/config.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
import { safeUrlSchema } from "../lib/url-validator.js"
import { prefetchAsBase64 } from "../lib/anthropic-image.js"
import { llmCompleteStructured, llmStreamStructured, type LlmContentBlock, type LlmRequest } from "../lib/llm-client.js"
import { createSSEStream, type SSEController } from "../lib/sse.js"
import { createPickerFieldStream } from "../lib/picker-field-stream.js"
import { LLM_ADVANCED_SHAPE, advancedModeError, resolveLlmParams } from "../lib/llm-advanced-mode.js"
import { effortTimeoutMs } from "../lib/llm-effort-timeout.js"
import { extractWorkflowId, extractNodeId, extractForcePrivate } from "../lib/request-helpers.js"
import { buildJobInputData } from "../lib/job-input-data.js"
import { formatZodError } from "../lib/zod-error.js"
import { sendInternalError } from "../lib/http-errors.js"
import { markProviderCallStart } from "../lib/reconcile/persistence.js"
import { insertAppReport, type AppReportInput } from "../lib/app-reports.js"
import { commitReservedCreditsForJob, refundReservedCreditsForJob } from "../lib/credits-job-lifecycle.js"
import { userFacingMessage } from "../lib/user-facing-error.js"
import { describeErrorChain } from "../lib/llm-errors.js"

/** Models the analyzer accepts: vision-capable AND able to return guaranteed
 *  structured output (Anthropic forced-tool or Gemini `response_format`). Derived
 *  from the SAME shared list the model picker offers, so the UI options and this
 *  route gate can't drift. */
const STRUCTURED_VISION_MODEL_IDS = new Set(STRUCTURED_VISION_MODELS.map((m) => m.id))

const describeToPickerBody = z
  .object({
    imageUrl: safeUrlSchema,
    targetPickers: z.array(z.enum(PICKER_TYPES as [string, ...string[]])).min(1).optional(),
    /** Legacy single-picker form (pre-multi-picker SDK callers). Normalized to an array. */
    targetPicker: z.enum(PICKER_TYPES as [string, ...string[]]).optional(),
    instructions: z.string().max(2000).optional(),
    /** Originating client app slug ('person', 'studio', …) — attribution for
     *  diagnostic app_reports. Optional and free of behavior otherwise. */
    origin: z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/).optional(),
    userId: z.string().uuid().optional(),
    llmModel: z.enum(LLM_MODEL_IDS as [string, ...string[]]).optional(),
    reasoningEffort: z.enum(LLM_REASONING_EFFORTS).optional(),
    ...LLM_ADVANCED_SHAPE,
  })
  .refine((b) => (b.targetPickers?.length ?? 0) > 0 || !!b.targetPicker, {
    message: "targetPickers (or legacy targetPicker) is required",
  })

/** Normalize the body's picker selection to a non-empty array (array form wins;
 *  legacy scalar is wrapped). Exported for unit testing. */
export function resolveTargetPickers(body: {
  targetPickers?: string[]
  targetPicker?: string
}): PickerType[] {
  if (body.targetPickers && body.targetPickers.length > 0) return body.targetPickers as PickerType[]
  if (body.targetPicker) return [body.targetPicker as PickerType]
  return []
}

interface GapRpcArgs {
  p_picker_type: string
  p_gap_type: "item" | "category"
  p_dimension: string
  p_observed: string
  p_observed_norm: string
  p_chosen_id: string | null
  p_sample_user_id: string
}

function normObserved(s: string): string {
  return s.toLowerCase().trim().replace(/\s+/g, " ")
}

/** Flatten gaps into record_picker_catalog_gap arg tuples. chosenId is JOINED
 *  server-side from the picker result (single source of truth — the LLM never
 *  echoes it). Exported for unit testing. */
export function buildGapRecords(
  gaps: PickerGaps | undefined,
  pickerJson: Record<string, unknown>,
  userId: string,
): GapRpcArgs[] {
  const recs: GapRpcArgs[] = []
  for (const it of gaps?.missingItems ?? []) {
    const section = pickerJson[it.picker] as Record<string, unknown> | undefined
    const chosen = section?.[it.dimension]
    recs.push({
      p_picker_type: it.picker,
      p_gap_type: "item",
      p_dimension: it.dimension,
      p_observed: it.observed,
      p_observed_norm: normObserved(it.observed),
      p_chosen_id: Array.isArray(chosen) ? (chosen[0] as string) ?? null : (chosen as string) ?? null,
      p_sample_user_id: userId,
    })
  }
  for (const c of gaps?.missingCategories ?? []) {
    recs.push({
      p_picker_type: c.picker,
      p_gap_type: "category",
      p_dimension: c.suggestedDimension,
      p_observed: c.observed,
      p_observed_norm: normObserved(c.observed),
      p_chosen_id: null,
      p_sample_user_id: userId,
    })
  }
  return recs
}

/** Per-incident missing-picker report (kind 'missing-picker') — the aggregate
 *  counters live in picker_catalog_gaps; this row keeps what the aggregate
 *  can't: WHICH image, the full gap detail, and the originating app. Returns
 *  null when the analysis had no gaps. Exported for unit testing. */
export function buildMissingPickerReport(
  gaps: PickerGaps | undefined,
  ctx: {
    imageUrl: string
    llmModel: string
    targetPickers: readonly string[]
    origin?: string
    userId: string
    jobId: string
  },
): AppReportInput | null {
  const count = (gaps?.missingItems?.length ?? 0) + (gaps?.missingCategories?.length ?? 0)
  if (count === 0) return null
  return {
    appSlug: ctx.origin ?? null,
    node: "describe-to-picker",
    kind: "missing-picker",
    severity: "info",
    title: `${count} unmatched attribute${count === 1 ? "" : "s"} in image analysis`,
    payload: {
      imageUrl: ctx.imageUrl,
      gaps,
      llmModel: ctx.llmModel,
      targetPickers: ctx.targetPickers,
    },
    userId: ctx.userId,
    jobId: ctx.jobId,
  }
}

/** Compose the analyzer system prompt. `otherPickersLegend` (from the spec) is
 *  the compact reference of NON-wired pickers — appended so a gap can be
 *  attributed to the right picker even when it wasn't wired for filling; empty
 *  string means every picker is already wired and the section is omitted.
 *  Exported for unit testing. */
export function buildSystemPrompt(legend: string, instructions?: string, otherPickersLegend?: string): string {
  const hasOther = !!otherPickersLegend && otherPickersLegend.length > 0
  return [
    "You are analyzing the primary subject and scene of an image to fill one or more structured pickers.",
    "Call the emit tool exactly once. For EACH picker section below, choose the closest-matching option id(s) from that picker's lists.",
    "Fill as many dimensions as possible across all sections; OMIT a dimension only when it is not visible or not determinable. Never exceed a dimension's stated maximum. Only use ids from the lists below.",
    "",
    "GAPS (catalog feedback): Leave `gaps` empty unless a salient attribute has no good catalog home — most images need none. A gap's `picker` may name ANY picker, whether wired as a fill section above or not; attribute each gap to the picker it TRULY belongs to, and never force a cross-domain attribute into a wired picker just because it happens to be wired.",
    "A gap's `picker` is ALWAYS the lowercase, hyphenated picker key exactly as written (e.g. `person`, `exposure-settings`, `held-prop`) — never a display name or an uppercased section header.",
    "- Each entry in missingItems { picker, dimension, observed }: the attribute fits an existing dimension of some picker, but no catalog id in that dimension is a good match. When that picker is wired above, still pick its closest id for the result.",
    "- Each entry in missingCategories { picker, suggestedDimension, observed }: NO picker has a dimension covering the attribute — record it against the closest picker with a suggested new dimension name.",
    instructions ? `Additional guidance: ${instructions}` : "",
    "",
    "PICKERS AND ALLOWED VALUES:",
    legend,
    hasOther
      ? "OTHER PICKERS (NOT wired — for gap attribution ONLY; never emit a fill section for these): if a salient attribute belongs to one of these, record it as a gap whose `picker` is the exact key shown here."
      : "",
    hasOther ? (otherPickersLegend as string) : "",
  ]
    .filter(Boolean)
    .join("\n")
}

/** One analysis once its job exists and its credits are reserved — what both
 *  the JSON answer and the streamed answer act on. */
interface Analysis {
  req: FastifyRequest
  jobId: string
  userId: string
  imageUrl: string
  targetPickers: PickerType[]
  model: LlmModelDef
  /** The effort this analysis runs at — the body's, or the default model's
   *  default — resolved once with the credit id it reserved (never re-read
   *  from `body`, which may omit it). */
  reasoningEffort: LlmReasoningEffort | undefined
  body: z.infer<typeof describeToPickerBody>
}

/** Stream only when the caller asks for it: an `Accept` naming `text/event-stream`. */
function wantsEventStream(req: FastifyRequest): boolean {
  return (req.headers.accept ?? "").toLowerCase().includes("text/event-stream")
}

/** The analyzer call: one request, whichever way the answer is delivered.
 *  With `onToolJson`, the first attempt streams its tool input there. */
async function runAnalyzer(analysis: Analysis, onToolJson?: (partialJson: string) => void) {
  const { schema, toolName, legend, otherPickersLegend } = buildMultiPickerAnalyzerSpec(analysis.targetPickers)
  const imageBlock = await prefetchAsBase64(analysis.imageUrl)
  const content: LlmContentBlock[] = [imageBlock, { type: "text", text: "Analyze the subject and emit the picker JSON." }]
  // The RESOLVED effort, like the request below: a default read runs at high
  // and needs high's longer timeout even though its body sent no effort.
  const timeoutMs = effortTimeoutMs(analysis.reasoningEffort)
  const request: LlmRequest = {
    modelId: analysis.model.id,
    system: buildSystemPrompt(legend, analysis.body.instructions, otherPickersLegend),
    messages: [{ role: "user", content }],
    reasoningEffort: analysis.reasoningEffort,
    ...resolveLlmParams(analysis.body),
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  }
  return onToolJson
    ? llmStreamStructured(request, schema, { schemaName: toolName, onToolJson })
    : llmCompleteStructured(request, schema, { schemaName: toolName })
}

/** Floor, persist, bill and record catalog gaps, in that order, then return
 *  the answer's body. */
async function completeAnalysis(
  analysis: Analysis,
  { output, inputTokens, outputTokens }: { output: unknown; inputTokens: number; outputTokens: number },
) {
  const { jobId, userId, imageUrl, targetPickers } = analysis
  const { gaps, ...pickerJson } = output as Record<string, unknown> & { gaps?: PickerGaps }
  // W1-a: a minor person value floors the styling/pose/mood values from
  // the same analysis (the per-picker cleanup only sees its own patch).
  const flooredPickerJson = applyMinorAgeFloorToPickerValues(pickerJson as Record<string, unknown>)

  await supabase
    .from("jobs")
    .update({
      status: "completed",
      completed_at: new Date().toISOString(),
      output_data: { json: flooredPickerJson, targetPickers, usage: { inputTokens, outputTokens } },
    })
    .eq("id", jobId)
    .eq("user_id", userId)
  await commitReservedCreditsForJob(jobId)

  // Persist catalog-gap feedback (best-effort — never breaks the analysis).
  // Parallel so a 0-8 gap batch doesn't add serial RPC latency to the response.
  // Two sinks: the aggregate counters (picker_catalog_gaps) and one
  // per-incident app_report carrying the image link + app origin.
  const missingReport = buildMissingPickerReport(gaps, {
    imageUrl,
    llmModel: analysis.model.id,
    targetPickers,
    origin: analysis.body.origin,
    userId,
    jobId,
  })
  await Promise.all([
    ...buildGapRecords(gaps, flooredPickerJson, userId).map(async (rec) => {
      const { error: gapErr } = await supabase.rpc("record_picker_catalog_gap", rec)
      if (gapErr) analysis.req.log.warn({ err: gapErr.message }, "picker gap upsert failed")
    }),
    ...(missingReport ? [insertAppReport(missingReport)] : []),
  ])

  return { jobId, pickerJson: flooredPickerJson, gaps }
}

/** Fail the job and refund its reservation; returns the message to report. */
async function failAnalysis(analysis: Analysis, err: unknown): Promise<string> {
  // The person reads a model-lane failure's user-safe sentence; the full
  // diagnostic goes to the log EVERY time, causes included — a provider error
  // whose own message is that sentence used to leave no log line at all.
  const message = userFacingMessage(err, "Picker analysis failed")
  console.error(`[describe-to-picker] job ${analysis.jobId} failed — ${describeErrorChain(err)}`)
  await supabase
    .from("jobs")
    .update({ status: "failed", completed_at: new Date().toISOString(), output_data: { error: message } })
    .eq("id", analysis.jobId)
    .eq("user_id", analysis.userId)
  await refundReservedCreditsForJob(analysis.jobId)
  return message
}

/**
 * The streamed answer (`Accept: text/event-stream`): the same analysis, job
 * and reservation as the JSON answer, delivered as server-sent events. It
 * opens only after everything a plain HTTP error reports (validation, auth,
 * credits) has passed.
 *
 * - `field`: `{ field: "<picker>.<dimension>", value }`, one per detail the
 *   moment the model has finished writing it, in the analyzer's own
 *   coordinates (`pickerJson[picker][dimension]`). Provisional, and never a
 *   value the minor-age floor removes (`picker-field-stream.ts`).
 * - `done`: exactly the JSON answer's body. Authoritative.
 * - `error`: `{ code: "llm_error", message }`; the job is failed and the
 *   reservation refunded, as on the JSON path.
 *
 * A client that disconnects does not stop the analysis: it finishes, bills
 * and records exactly as the JSON path does, so the job and the reservation
 * always reach a terminal state. Writes after the disconnect are no-ops.
 */
async function streamAnalysis(reply: FastifyReply, analysis: Analysis): Promise<void> {
  let sse: SSEController
  try {
    sse = await createSSEStream(analysis.req, reply)
  } catch (err) {
    // Nothing written yet: fail the job and answer as the JSON path does.
    const message = await failAnalysis(analysis, err)
    reply.status(502).send({ error: { code: "llm_error", message } })
    return
  }
  try {
    let body: Awaited<ReturnType<typeof completeAnalysis>>
    try {
      const fields = createPickerFieldStream({
        targetPickers: analysis.targetPickers,
        onField: (event) => sse.sendEvent({ type: "field", data: event }),
      })
      body = await completeAnalysis(analysis, await runAnalyzer(analysis, (partialJson) => fields.push(partialJson)))
    } catch (err) {
      const message = await failAnalysis(analysis, err)
      sse.sendEvent({ type: "error", data: { code: "llm_error", message } })
      return
    }
    sse.sendEvent({ type: "done", data: body })
  } finally {
    // Always end the stream (and its keepalive), even if recording a failure throws.
    sse.close()
  }
}

/**
 * The raw body with the defaults the handler applies before it reserves: an
 * omitted model is the analyzer's default, and an omitted effort is that
 * model's default effort. The credit guard prices the raw body before
 * validation, so without these it pre-checked a default read at the bare id
 * (10) while the job reserved premium-direct (25), and a balance in between
 * passed the check, then failed the reservation with a 500 instead of a 402.
 *
 * Shared by the two routes that bill this feature, this one and its text twin
 * text-to-picker. It lives with them, not in the shared `resolveLlmCreditId`
 * every LLM route's guard uses: a default model applied there would move every
 * other feature's pre-check too. A model or effort that is not a string is
 * treated as absent here; the handler's validation refuses it.
 */
export function withDescribeToPickerDefaults(body: unknown): Record<string, unknown> {
  const raw = (body ?? {}) as Record<string, unknown>
  const named = typeof raw.llmModel === "string" ? raw.llmModel : undefined
  const sent = typeof raw.reasoningEffort === "string" ? raw.reasoningEffort : undefined
  return {
    ...raw,
    llmModel: named ?? LLM_FEATURE_DEFAULTS["describe-to-picker"],
    reasoningEffort: sent ?? defaultReasoningEffort("describe-to-picker", named),
  }
}

export async function describeToPickerRoutes(app: FastifyInstance) {
  app.post(
    "/v1/describe-to-picker",
    { preHandler: creditGuard((req) => resolveLlmCreditId("describe-to-picker", withDescribeToPickerDefaults(req.body))) },
    async (req, reply) => {
      // Keyless install with a live connection: the cloud runs the same
      // code, so forward the body and pass its answer straight back.
      if (await maybeProxyLlmRouteToCloud(req, reply, "/v1/describe-to-picker", "describe-to-picker")) return

      const parsed = describeToPickerBody.safeParse(req.body)
      if (!parsed.success) {
        return reply.status(400).send({ error: { code: "validation_error", ...formatZodError(parsed.error) } })
      }
      const { imageUrl } = parsed.data
      const targetPickers = resolveTargetPickers(parsed.data)
      const userId = req.userId
      if (!userId) {
        return reply.status(401).send({ error: { code: "unauthorized", message: "Authentication required" } })
      }
      // Structured analysis routes through the unified LLM client — KIE for any
      // vendor (Claude messages / Gemini response_format), with direct Anthropic
      // as the Claude fallback. So it needs EITHER key, not Anthropic specifically
      // (mirrors prompt-helper); requiring the Anthropic key would wrongly block
      // Gemini models on a KIE-only deploy.
      if (!config.KIE_API_KEY && !config.ANTHROPIC_API_KEY) {
        return reply.status(503).send({ error: { code: "provider_unavailable", message: "LLM API key not configured" } })
      }

      const llmModelId = parsed.data.llmModel ?? LLM_FEATURE_DEFAULTS["describe-to-picker"]
      const model = getLlmModel(llmModelId)
      if (!model || !STRUCTURED_VISION_MODEL_IDS.has(model.id)) {
        return reply.status(400).send({ error: { code: "validation_error", message: "describe-to-picker requires a vision-capable model with structured output (Anthropic or Gemini)" } })
      }
      const advancedError = advancedModeError(parsed.data, model.id)
      if (advancedError) return reply.status(400).send({ error: advancedError })
      // No effort sent: the default model runs at its default effort (Opus 5.5
      // at high, decided 2026-10-09); any other model keeps its Auto. Resolved
      // ONCE and used for both the request and the credit id, so the bill and
      // the wire agree — Opus 5.5 with an effort runs on Anthropic's own API
      // and bills on the direct rung, as intended.
      const reasoningEffort = parsed.data.reasoningEffort ?? defaultReasoningEffort("describe-to-picker", parsed.data.llmModel)
      const modelIdentifier = buildLlmCreditIdentifier("describe-to-picker", llmModelId, reasoningEffort, parsed.data.advancedMode)

      const { data: job, error: jobError } = await insertJob(req, {
          workflow_id: extractWorkflowId(req.body),
          node_id: extractNodeId(req.body),
          force_private: extractForcePrivate(req.body) || undefined,
          user_id: userId,
          status: "pending",
          // A sync route works the job at once: `started_at` here and
          // `completed_at` on the answer give the read a measurable duration.
          started_at: new Date().toISOString(),
          input_data: buildJobInputData(parsed.data, "describe-to-picker"),
        })
      if (jobError) {
        return sendInternalError(reply, req, jobError, "Failed to create job")
      }

      const reservation = await reserveCreditsForJob(req, reply, job.id, modelIdentifier)
      if (reply.sent) return
      void reservation

      await markProviderCallStart(job.id, "anthropic-sync")

      const analysis: Analysis = { req, jobId: job.id, userId, imageUrl, targetPickers, model, reasoningEffort, body: parsed.data }
      if (wantsEventStream(req)) return streamAnalysis(reply, analysis)

      try {
        return reply.send(await completeAnalysis(analysis, await runAnalyzer(analysis)))
      } catch (err) {
        const message = await failAnalysis(analysis, err)
        return reply.status(502).send({ error: { code: "llm_error", message } })
      }
    },
  )
}
