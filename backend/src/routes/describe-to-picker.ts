import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { maybeProxyLlmRouteToCloud } from "../lib/cloud-llm-proxy.js"
import { z } from "zod"
import { buildMultiPickerAnalyzerSpec, applyMinorAgeFloorToPickerValues, PICKER_TYPES, type PickerType, type PickerGaps } from "@nodaro/prompts/picker-catalogs"
import { buildLlmCreditIdentifier, resolveLlmCreditId, getLlmModel, defaultReasoningEffort, DESCRIBE_TO_PICKER_FALLBACK_MODEL, LLM_FEATURE_DEFAULTS, LLM_MODEL_IDS, LLM_REASONING_EFFORTS, STRUCTURED_VISION_MODELS, type LlmModelDef, type LlmReasoningEffort } from "@nodaro/shared/llm-models"
import Anthropic from "@anthropic-ai/sdk"
import { supabase } from "../lib/supabase.js"
import { insertSyncJob } from "../lib/insert-job.js"
import { config } from "../lib/config.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
import { safeUrlSchema } from "../lib/url-validator.js"
import { prefetchAsBase64 } from "../lib/anthropic-image.js"
import { llmCompleteStructured, llmStreamStructured, type LlmContentBlock, type LlmRequest, type LlmServedLane } from "../lib/llm-client.js"
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
import { commitReservedCreditsForJob, commitReservedCreditsForJobAtPrice, refundReservedCreditsForJob } from "../lib/credits-job-lifecycle.js"
import { llmErrorCode, userFacingMessage } from "../lib/user-facing-error.js"
// From their own modules, not the client facade a route test replaces.
import { LLM_STRUCTURED_DEFAULT_ATTEMPTS, StructuredLlmError } from "../lib/llm/structured.js"
import { LLM_MAX_LANES_PER_CALL } from "../lib/llm/router.js"
import { billedContentRefusal, describeErrorChain, LlmAdvancedModeUnavailableError, LlmLaneError, LlmPlatformExhaustedError, LlmStreamResponseError } from "../lib/llm-errors.js"
import { completedJobColumns } from "../lib/job-status.js"
import { markJobFailed } from "../lib/job-failure.js"

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

/** Which model an analyzer run asks, at what effort, and whether the body's
 *  Advanced-mode parameters ride along. */
interface AnalyzerRun {
  model: LlmModelDef
  reasoningEffort: LlmReasoningEffort | undefined
  /** The photo, fetched once for every run of this analysis. */
  imageBlock: LlmContentBlock
  /** A per-lane timeout that overrides the effort's (the fallback's budget cap). */
  timeoutMs?: number
  /** The body's Advanced-mode parameters (a direct pin, temperature, max
   *  tokens) — the requested model's, so never the fallback's. */
  advanced: boolean
}

/** The analyzer call: one request, whichever way the answer is delivered.
 *  With `onToolJson`, the first attempt streams its tool input there. */
async function runAnalyzer(analysis: Analysis, run: AnalyzerRun, onToolJson?: (partialJson: string) => void) {
  const { schema, toolName, legend, otherPickersLegend } = buildMultiPickerAnalyzerSpec(analysis.targetPickers)
  const content: LlmContentBlock[] = [run.imageBlock, { type: "text", text: "Analyze the subject and emit the picker JSON." }]
  // The RESOLVED effort, like the request below: a default read runs at high
  // and needs high's longer timeout even though its body sent no effort.
  const timeoutMs = run.timeoutMs ?? effortTimeoutMs(run.reasoningEffort)
  const request: LlmRequest = {
    modelId: run.model.id,
    system: buildSystemPrompt(legend, analysis.body.instructions, otherPickersLegend),
    messages: [{ role: "user", content }],
    reasoningEffort: run.reasoningEffort,
    ...(run.advanced ? resolveLlmParams(analysis.body) : {}),
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  }
  return onToolJson
    ? llmStreamStructured(request, schema, { schemaName: toolName, onToolJson })
    : llmCompleteStructured(request, schema, { schemaName: toolName })
}

/** An analysis's answer, and the model that gave it. */
interface AnalyzerAnswer {
  output: unknown
  inputTokens: number
  outputTokens: number
  lane: LlmServedLane
  answeredBy: LlmModelDef
}

/** The answer's picker sections, without `gaps`, after the minor-age floor. */
function flooredPickers(output: unknown): { pickerJson: Record<string, unknown>; gaps: PickerGaps | undefined } {
  const { gaps, ...pickerJson } = output as Record<string, unknown> & { gaps?: PickerGaps }
  // W1-a: a minor person value floors the styling/pose/mood values from
  // the same analysis (the per-picker cleanup only sees its own patch).
  return { pickerJson: applyMinorAgeFloorToPickerValues(pickerJson as Record<string, unknown>), gaps }
}

/**
 * Does no target picker section hold a single value — every one absent,
 * empty, or holding only empty strings and lists? Production job 1572a638
 * completed with `{}` (from a lane that never saw the photo), so the person
 * read "found no pickers" and was charged. Exported for unit testing.
 */
export function isEmptyPickerRead(pickerJson: Record<string, unknown>, targetPickers: readonly string[]): boolean {
  return targetPickers.every((picker) => {
    const section = pickerJson[picker]
    if (!section || typeof section !== "object") return true
    return Object.values(section as Record<string, unknown>).every((v) =>
      v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0))
  })
}

/** The message a person reads when the analysis read nothing in the photo. */
export const EMPTY_PICKER_READ_MESSAGE = "We couldn't read anything in this photo — try a clearer photo of one person. You weren't charged."

/** A completed analysis with no picker value at all: the job fails and the reservation is refunded. */
class EmptyPickerReadError extends Error {
  constructor(readonly answeredBy: string, readonly lane: LlmServedLane) {
    super(EMPTY_PICKER_READ_MESSAGE)
    this.name = "EmptyPickerReadError"
  }
}

/**
 * Why a Claude analyzer's failure is the PLATFORM's and not an answer about
 * the photo — so describe-to-picker re-asks it once on
 * {@link DESCRIBE_TO_PICKER_FALLBACK_MODEL} — or undefined when it is not.
 *
 * By the time this runs the LLM client has already tried both of the Claude
 * model's lanes (direct, then KIE's prompt-JSON retry — and after KIE answers
 * that never validated, the direct tool once more unless its account is
 * latched out as drained). The failure's `cause` chain is read outermost
 * first; a lane that failed AFTER another one carries the earlier failure as
 * its cause (`serveFromFallback`). So:
 * - the platform's account refused (drained, key refused) → yes;
 * - the direct lane busy (429), down (5xx, Anthropic's 529 overload) or
 *   unreachable → yes;
 * - the direct lane refused the REQUEST (any other 4xx — a malformed request,
 *   an image it cannot read) → no, even when KIE failed after it: Gemini gets
 *   the same request;
 * - KIE failed with no such direct refusal behind it, or KIE's answers never
 *   validated → yes: it is the suspect lane (it refused, or completed with
 *   `{}` from a photo it never received). That includes a refusal KIE wrote as
 *   prose without the refusal stop reason — the direct tool is asked first,
 *   and only when the direct lane is latched or absent can such a read reach
 *   Gemini; accepted, since a refusal Gemini then makes fails the same way;
 * - a usage-carrying failure (`LlmStreamResponseError`: the model answered
 *   and was paid — a content refusal (`LlmContentRefusalError`), a cap stop,
 *   a stream that failed after writing) → no: re-asking pays twice, a refusal
 *   is an answer, and a field it streamed would be followed by another model's;
 * - a direct answer that never validated → no: another model is no fix.
 * Exported for unit testing.
 */
export function pickerFallbackReason(requested: LlmModelDef, err: unknown): string | undefined {
  if (requested.vendor !== "anthropic") return undefined
  if (err instanceof StructuredLlmError && err.lane === "kie") return "the KIE retry's answer did not validate"
  let kieFailure: string | undefined
  let cur: unknown = err
  for (let depth = 0; cur !== null && cur !== undefined && depth < 8; depth++) {
    if (cur instanceof LlmAdvancedModeUnavailableError) {
      // Advanced mode is withheld from KIE only; Gemini may still answer (describe-to-picker's own fallback).
      if (cur.cause instanceof LlmPlatformExhaustedError) {
        return `the ${cur.cause.provider} platform account refused (${cur.cause.exhaustion})`
      }
      return "the Anthropic account can't serve Advanced mode right now"
    }
    if (cur instanceof LlmStreamResponseError) return undefined
    if (cur instanceof LlmPlatformExhaustedError) return `the ${cur.provider} platform account refused (${cur.exhaustion})`
    if (cur instanceof LlmLaneError) {
      const status = cur.httpStatus ?? cur.bodyCode
      if (cur.lane === "kie") {
        // Decided by what (if anything) failed before it — read on.
        kieFailure ??= `the KIE lane failed (${status ?? "no status"})`
      } else {
        return status !== undefined && (status === 429 || status >= 500 || cur.bodyCode !== undefined)
          ? `the direct lane failed (${status})`
          : undefined
      }
    } else if (cur instanceof Anthropic.APIConnectionError) {
      return "the direct lane could not be reached"
    } else if (cur instanceof Anthropic.APIError && typeof cur.status === "number") {
      // 401/402/403 reach here typed as LlmPlatformExhaustedError already.
      return cur.status === 429 || cur.status >= 500 ? `the direct lane failed (${cur.status})` : undefined
    }
    cur = (cur as { cause?: unknown }).cause
  }
  return kieFailure
}

/**
 * Run the analysis on the requested model and, when a Claude model could not
 * answer for a platform-side reason ({@link pickerFallbackReason}) or its KIE
 * retry answered empty, ONCE more on {@link DESCRIBE_TO_PICKER_FALLBACK_MODEL}
 * at its default effort, on its own lanes.
 *
 * An empty read is re-asked only from KIE: an empty answer from the direct
 * lane, which saw the photo, is an answer about the photo (it fails,
 * uncharged, in completeAnalysis), and so is an empty answer from the fallback.
 *
 * Streamed: a fallback never follows a `field` event. Every failure after the
 * first fragment is a usage-carrying one (pickerFallbackReason refuses it),
 * and `wrote` refuses it here as well, whatever it was. Gemini's structured
 * answer does not stream, so a fallback stream carries `done` alone.
 */
async function analyze(analysis: Analysis, onToolJson?: (partialJson: string) => void): Promise<AnalyzerAnswer> {
  const startedAt = Date.now()
  const requested = analysis.model
  const imageBlock = await prefetchAsBase64(analysis.imageUrl)
  let wrote = false
  const forward = onToolJson && ((partialJson: string) => { wrote = true; onToolJson(partialJson) })
  let reason: string | undefined
  try {
    const result = await runAnalyzer(analysis, { model: requested, reasoningEffort: analysis.reasoningEffort, advanced: true, imageBlock }, forward)
    const kieEmpty = requested.vendor === "anthropic" && result.lane === "kie" &&
      isEmptyPickerRead(flooredPickers(result.output).pickerJson, analysis.targetPickers)
    if (!kieEmpty || wrote) return { ...result, answeredBy: requested }
    reason = "the KIE retry answered empty"
  } catch (err) {
    reason = wrote ? undefined : pickerFallbackReason(requested, err)
    if (!reason) throw err
  }
  const fallback = getLlmModel(DESCRIBE_TO_PICKER_FALLBACK_MODEL)!
  console.warn(`[picker-fallback] ${requested.id} → ${fallback.id}: ${reason} (job ${analysis.jobId})`)
  const timeoutMs = fallbackLaneTimeoutMs(Date.now() - startedAt)
  const result = await runAnalyzer(analysis, { model: fallback, reasoningEffort: undefined, advanced: false, imageBlock, timeoutMs }, onToolJson)
  return { ...result, answeredBy: fallback }
}

/**
 * The longest one describe-to-picker request may hold its job row — under
 * the reconciliation sweep's `anthropic-sync` threshold (40 min), which
 * force-fails and refunds a row past it. A Claude run at its slowest effort
 * already spends most of it: (attempts × lanes + the direct-tool backup) ×
 * 285 s ≈ 33 min, before Gemini starts.
 */
export const DESCRIBE_TO_PICKER_MAX_RUNTIME_MS = 38 * 60_000

/** The client's default per-lane timeout (`LLM_TIMEOUT_MS`): what a Gemini fallback gets when time allows. */
const FALLBACK_LANE_TIMEOUT_MAX_MS = 120_000
/** A floor so a fallback is never asked with no time at all; the budget test shows it is never reached. */
const FALLBACK_LANE_TIMEOUT_MIN_MS = 10_000

/**
 * The Gemini fallback's per-lane timeout: the client default, or less when the
 * Claude run used enough of {@link DESCRIBE_TO_PICKER_MAX_RUNTIME_MS} that
 * every attempt on both lanes would not fit in what is left. A Claude failure
 * that came back at once (a drained account) leaves the full default.
 * Exported for unit testing.
 */
export function fallbackLaneTimeoutMs(elapsedMs: number): number {
  const lanes = LLM_STRUCTURED_DEFAULT_ATTEMPTS * LLM_MAX_LANES_PER_CALL
  const share = Math.floor((DESCRIBE_TO_PICKER_MAX_RUNTIME_MS - elapsedMs) / lanes)
  return Math.max(FALLBACK_LANE_TIMEOUT_MIN_MS, Math.min(FALLBACK_LANE_TIMEOUT_MAX_MS, share))
}

/** Floor, persist, bill and record catalog gaps, in that order, then return
 *  the answer's body. An answer with no picker value fails instead. */
async function completeAnalysis(analysis: Analysis, { output, inputTokens, outputTokens, lane, answeredBy }: AnalyzerAnswer) {
  const { jobId, userId, imageUrl, targetPickers } = analysis
  const { pickerJson: flooredPickerJson, gaps } = flooredPickers(output)
  if (isEmptyPickerRead(flooredPickerJson, targetPickers)) throw new EmptyPickerReadError(answeredBy.id, lane)

  await supabase
    .from("jobs")
    .update({
      status: "completed",
      ...completedJobColumns(),
      // `answeredBy`: the model whose answer this is — the requested one, or
      // the fallback that answered when it could not.
      output_data: { json: flooredPickerJson, targetPickers, usage: { inputTokens, outputTokens }, answeredBy: answeredBy.id },
      // Which LLM lane served the answer, a fallback included.
      // `provider` is admin-only — outside PUBLIC_JOB_KEYS (routes/jobs.ts) and
      // outside the browser's column grant on jobs (migration 347) — while
      // output_data is owner-readable through both, so the lane never rides there.
      provider: lane,
    })
    .eq("id", jobId)
    .eq("user_id", userId)
  // The person pays for the model that answered: the reservation was made at
  // the requested model's price, and a fallback answer commits at the
  // fallback's own (the rest of the hold is returned in the same commit).
  if (answeredBy.id === analysis.model.id) {
    await commitReservedCreditsForJob(jobId)
  } else {
    await commitReservedCreditsForJobAtPrice(jobId, buildLlmCreditIdentifier("describe-to-picker", answeredBy.id))
  }

  // Persist catalog-gap feedback (best-effort — never breaks the analysis).
  // Parallel so a 0-8 gap batch doesn't add serial RPC latency to the response.
  // Two sinks: the aggregate counters (picker_catalog_gaps) and one
  // per-incident app_report carrying the image link + app origin.
  const missingReport = buildMissingPickerReport(gaps, {
    imageUrl,
    llmModel: answeredBy.id,
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

/** Fail the job and settle its reservation; returns the message to report.
 *  Refunded — unless the analysis ended in a content refusal the provider
 *  billed (`billedContentRefusal`): that is a paid answer, so the hold is
 *  committed. Only the requested Claude model can refuse (the Gemini lane
 *  raises no refusal), and the hold was reserved at its price. An empty read
 *  is always refunded. */
async function failAnalysis(analysis: Analysis, err: unknown): Promise<string> {
  // The person reads a model-lane failure's user-safe sentence; the full
  // diagnostic goes to the log EVERY time, causes included — a provider error
  // whose own message is that sentence used to leave no log line at all.
  const message = userFacingMessage(err, "Picker analysis failed")
  console.error(`[describe-to-picker] job ${analysis.jobId} failed — ${describeErrorChain(err)}`)
  await markJobFailed(analysis.jobId, { error_message: message, extra: { output_data: { error: message } } })
  if (billedContentRefusal(err)) await commitReservedCreditsForJob(analysis.jobId)
  else await refundReservedCreditsForJob(analysis.jobId)
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
 *   reservation refunded, as on the JSON path — an empty read included.
 *   A run that fell back to Gemini ({@link analyze}) streams no `field` and
 *   ends in `done` like any other.
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
    reply.status(502).send({ error: { code: llmErrorCode(err), message } })
    return
  }
  try {
    let body: Awaited<ReturnType<typeof completeAnalysis>>
    try {
      const fields = createPickerFieldStream({
        targetPickers: analysis.targetPickers,
        onField: (event) => sse.sendEvent({ type: "field", data: event }),
      })
      body = await completeAnalysis(analysis, await analyze(analysis, (partialJson) => fields.push(partialJson)))
    } catch (err) {
      const message = await failAnalysis(analysis, err)
      sse.sendEvent({ type: "error", data: { code: llmErrorCode(err), message } })
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
      // A latched-out Anthropic account is not refused here: the client refuses the
      // Advanced call mid-flight, and the Gemini fallback answers (analyze). A
      // missing key is still a 400.
      const advancedError = advancedModeError(parsed.data, model.id, { ignoreLatch: true })
      if (advancedError) return reply.status(400).send({ error: advancedError })
      // No effort sent: the default model runs at its default effort (Opus 5.5
      // at high, decided 2026-10-09); any other model keeps its Auto. Resolved
      // ONCE and used for both the request and the credit id, so the bill and
      // the wire agree — Opus 5.5 with an effort runs on Anthropic's own API
      // and bills on the direct rung, as intended.
      const reasoningEffort = parsed.data.reasoningEffort ?? defaultReasoningEffort("describe-to-picker", parsed.data.llmModel)
      const modelIdentifier = buildLlmCreditIdentifier("describe-to-picker", llmModelId, reasoningEffort, parsed.data.advancedMode)

      const { data: job, error: jobError } = await insertSyncJob(req, {
          workflow_id: extractWorkflowId(req.body),
          node_id: extractNodeId(req.body),
          force_private: extractForcePrivate(req.body) || undefined,
          user_id: userId,
          status: "pending",
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
        return reply.send(await completeAnalysis(analysis, await analyze(analysis)))
      } catch (err) {
        const message = await failAnalysis(analysis, err)
        return reply.status(502).send({ error: { code: llmErrorCode(err), message } })
      }
    },
  )
}
