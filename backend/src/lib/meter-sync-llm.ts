import type { FastifyReply, FastifyRequest } from "fastify"
import { supabase } from "./supabase.js"
import { markJobFailed } from "./job-failure.js"
import { completeSettledSyncJob } from "./metered-sync-completion.js"
import type { LlmPlannedCall, LlmReserveResult, LlmSettleOutcome, LlmSpend, MeteredLlmFeature } from "./llm-billing.js"
import { LLM_MODEL_IDS, LLM_REASONING_EFFORTS } from "@nodaro/shared/llm-models"
import type { LlmRequest, LlmResponse } from "./llm/types.js"
import type { StructuredLlmOutput } from "./llm/structured.js"

/** The tier-priced sync meter lives in the leaf `./sync-llm-meter.ts`, which `./llm-billing.ts` reads under the rollback. */
export { meterSyncLlm, type SyncLlmMeter } from "./sync-llm-meter.js"

// ── Metered sync routes (D1/D3): the shared write → settle → terminal order ──

/**
 * Run one LLM call and record it in `spend` — the answer as billed, or the
 * failure's billed usage (a refusal, a cut-off answer, a structured failure's
 * attempts) — then hand the answer back or rethrow. Recorded the moment the
 * call returns, so a failure AFTER the answer (an unparseable reply, a
 * validation miss, a DB error) is still a billed call (§8.1). `spend`
 * undefined (tier pricing, the rollback) = the call alone, nothing recorded.
 */
export async function spendLlmCall(
  spend: LlmSpend | undefined,
  modelId: string,
  request: LlmRequest,
  call: () => Promise<LlmResponse>,
): Promise<LlmResponse> {
  if (!spend) return call()
  let response: LlmResponse
  try {
    response = await call()
  } catch (err) {
    spend.add(modelId, request, { error: err })
    throw err
  }
  spend.add(modelId, request, { response })
  return response
}

/** {@link spendLlmCall} for a structured call (`llmCompleteStructured`): every attempt it made. */
export async function spendLlmStructuredCall<T>(
  spend: LlmSpend | undefined,
  modelId: string,
  request: LlmRequest,
  call: () => Promise<StructuredLlmOutput<T>>,
): Promise<StructuredLlmOutput<T>> {
  if (!spend) return call()
  let output: StructuredLlmOutput<T>
  try {
    output = await call()
  } catch (err) {
    spend.add(modelId, request, { error: err })
    throw err
  }
  spend.add(modelId, request, { output: output as StructuredLlmOutput<unknown> })
  return output
}

/**
 * The text characters of a raw request body, for `llmPrecheckBaseCredits`:
 * every string leaf, EXCEPT a `data:` URI (inline media — the pre-check
 * counts every character as text, so one base64 image would become a
 * ~333k-token hold and a wrong 402; the real hold prices an image as an
 * image). A UX pre-check only: the reservation's hold is sized from the
 * request as it is sent.
 */
export function llmBodyTextChars(body: unknown, depth = 0): number {
  if (typeof body === "string") return body.startsWith("data:") ? 0 : body.length
  if (depth > 8 || body === null || typeof body !== "object") return 0
  let chars = 0
  for (const value of Array.isArray(body) ? body : Object.values(body)) chars += llmBodyTextChars(value, depth + 1)
  return chars
}

/**
 * A metered route's `creditGuard` pre-check (`computeCredits`): the
 * 1-attempt hold, in BASE credits, of the raw body's model with the body's
 * text ({@link llmBodyTextChars}) — `undefined` under the rollback, so the
 * route's tier row prices the check exactly as before. A model or effort the
 * body names that is not a registry value is left out (the feature default
 * prices the check), so the route's own Zod answers it as it always did.
 * `fixed` pins what a route fixes in code (a helper's model, its cap).
 */
export async function llmGuardPrecheck(
  feature: MeteredLlmFeature,
  body: unknown,
  fixed?: { llmModel?: string; maxTokens?: number },
): Promise<number | undefined> {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>
  const llmModel = fixed?.llmModel ?? (typeof b.llmModel === "string" && (LLM_MODEL_IDS as readonly string[]).includes(b.llmModel) ? b.llmModel : undefined)
  const reasoningEffort = typeof b.reasoningEffort === "string" && (LLM_REASONING_EFFORTS as readonly string[]).includes(b.reasoningEffort) ? b.reasoningEffort : undefined
  const maxTokens = fixed?.maxTokens ?? (typeof b.maxTokens === "number" && Number.isFinite(b.maxTokens) && b.maxTokens > 0 ? b.maxTokens : undefined)
  const { llmPrecheckBaseCredits } = await import("./llm-billing.js")
  return llmPrecheckBaseCredits(
    feature,
    { llmModel, reasoningEffort, advancedMode: b.advancedMode === true, maxTokens },
    llmBodyTextChars(body),
  )
}

/** A refusal {@link capturingReply} recorded instead of sending. */
export interface CapturedRefusal {
  statusCode: number
  body: unknown
}

/**
 * A reply that RECORDS what it is sent instead of sending it — for a route
 * whose metered step is OPTIONAL, so a refused reservation (a balance below
 * the hold, a policy block, an unpriced model) must not answer the request:
 * an approval approves and skips its caption (owner decision D11: an approval is
 * never blocked by credits). `refusal()` is what the reservation would have
 * answered, or undefined when nothing was sent.
 */
export function capturingReply(): { reply: FastifyReply; refusal: () => CapturedRefusal | undefined } {
  let refusal: CapturedRefusal | undefined
  let statusCode = 200
  const reply = {
    get sent() { return refusal !== undefined },
    get statusCode() { return statusCode },
    status(code: number) { statusCode = code; return reply },
    code(code: number) { statusCode = code; return reply },
    header() { return reply },
    headers() { return reply },
    type() { return reply },
    send(body?: unknown) { refusal = { statusCode, body }; return reply },
  }
  return { reply: reply as unknown as FastifyReply, refusal: () => refusal }
}

/** What {@link meterOptionalSyncLlm} hands back: the meter, or why the optional step was skipped. */
/** The meter `meterSyncLlmMetered` hands back. */
export interface MeteredSyncLlmMeter {
  spend: LlmSpend
  settle: (status: "completed" | "failed", errorMessage?: string) => Promise<void>
}

export type OptionalSyncLlmMeter =
  | { meter: MeteredSyncLlmMeter }
  | { skipped: CapturedRefusal | { thrown: string } }

/**
 * Meter an OPTIONAL metered step of a route that must never be refused for
 * it (an approval's caption — owner decision D11): the route's own payer-aware
 * `creditGuard` runs INLINE — so the request gets everything the guard does
 * for any metered route: the spend-surface stamp (`req.webFreeMode`, the
 * PAYG_WEB_BLOCK free-pool semantics), the community-instance monthly cap,
 * consent, the payer's balance against the pre-check — then
 * `meterSyncLlmMetered` reserves. Both answer onto a capturing reply: a
 * refusal (or a thrown billing error) is `{ skipped }`, never the route's
 * answer. Only for a caller already metering (`llmMeteredPricing()`).
 */
export async function meterOptionalSyncLlm(
  req: FastifyRequest,
  guard: (req: FastifyRequest, reply: FastifyReply) => unknown,
  jobType: string,
  args: { feature: MeteredLlmFeature; calls: readonly [LlmPlannedCall, ...LlmPlannedCall[]] },
): Promise<OptionalSyncLlmMeter> {
  try {
    const check = capturingReply()
    await guard(req, check.reply)
    const refused = check.refusal()
    if (refused) return { skipped: refused }
    const reserve = capturingReply()
    const { meterSyncLlmMetered } = await import("./llm-billing.js")
    const meter = await meterSyncLlmMetered(req, reserve.reply, jobType, args)
    if (!meter) return { skipped: reserve.refusal() ?? { thrown: "no reservation was made" } }
    return { meter }
  } catch (err) {
    return { skipped: { thrown: err instanceof Error ? err.message : String(err) } }
  }
}

/**
 * The failure message of a metered job whose failure was CHARGED (spec §7,
 * §8.1): it says the call was charged and why, so it never reads as a bug.
 * Any other outcome keeps the message as it is.
 */
export function chargedFailureMessage(message: string, settled: LlmSettleOutcome): string {
  if (settled.outcome !== "charged") return message
  const n = settled.charged
  return `${message} The AI provider had already processed the request, so ${n} credit${n === 1 ? "" : "s"} ${n === 1 ? "was" : "were"} charged for the usage it billed.`
}

/**
 * {@link chargedFailureMessage} for a caller that settles through
 * `meterSyncLlmMetered` (whose `settle` reports no outcome): a failure whose
 * spend billed anything is charged, so the message says so — without the
 * figure, which only the settle knows. Unbilled = the message unchanged.
 */
export function billedFailureMessage(message: string, spend: LlmSpend): string {
  if (!spend.billedAnything) return message
  return `${message} The AI provider had already processed the request, so its usage was charged.`
}

export type MeteredSyncLlmFinish =
  /** `outputData` is the job's `output_data`; `provider` the served lane (admin-only column). */
  | { status: "completed"; outputData?: Record<string, unknown>; provider?: string }
  | { status: "failed"; errorMessage: string; outputData?: Record<string, unknown> }

/**
 * Finish a SYNCHRONOUS metered LLM job a route reserved with `reserveLlmCall`
 * (`{ metered: true }`) and stamped with `markProviderCallStart` — in the
 * order the contract requires (`settleLlmJob` jsdoc, C3):
 *  1. the route's `output_data` (and served lane) is written FIRST, the row
 *     still non-terminal; the settle then writes `provider_cost`,
 *     `credits_actual` and the billing ledger (the server-only ledger column,
 *     R32 — never `output_data`), so no later write may touch those columns;
 *  2. `settleLlmJob`: charge what was billed (a billed failure too), refund
 *     what was not;
 *  3. on `unsettled` NOTHING more: the row stays non-terminal with its
 *     reserved hold, for the reconcile sweep;
 *  4. otherwise the terminal write — `completed` (through `complete` when the
 *     route uses the result-gated funnel, handed the row's `output_data` as
 *     the settle left it), or `markJobFailed` with
 *     {@link chargedFailureMessage}.
 * Returns the settle's outcome and the failure message as written (the
 * route's reply says the same).
 *
 * ONCE per job (its spend): a second call — a route's catch after a throw in
 * the success path's own finish — returns the first call's result and
 * settles nothing again.
 */
export function finishMeteredSyncLlmJob(
  jobId: string,
  reserve: LlmReserveResult,
  spend: LlmSpend,
  finish: MeteredSyncLlmFinish,
  opts?: { complete?: (outputData: Record<string, unknown>) => Promise<unknown> },
): Promise<{ settled: LlmSettleOutcome; errorMessage?: string }> {
  const first = finishedJobs.get(spend)
  if (first) return first
  const run = finishOnce(jobId, reserve, spend, finish, opts)
  finishedJobs.set(spend, run)
  return run
}

/** The one finish of each metered job, by its spend ({@link finishMeteredSyncLlmJob}). */
const finishedJobs = new WeakMap<LlmSpend, Promise<{ settled: LlmSettleOutcome; errorMessage?: string }>>()

async function finishOnce(
  jobId: string,
  reserve: LlmReserveResult,
  spend: LlmSpend,
  finish: MeteredSyncLlmFinish,
  opts?: { complete?: (outputData: Record<string, unknown>) => Promise<unknown> },
): Promise<{ settled: LlmSettleOutcome; errorMessage?: string }> {
  if (finish.outputData !== undefined) {
    const provider = finish.status === "completed" ? finish.provider : undefined
    const { error } = provider !== undefined
      ? await supabase.from("jobs").update({ output_data: finish.outputData, provider }).eq("id", jobId)
      : await supabase.from("jobs").update({ output_data: finish.outputData }).eq("id", jobId)
    if (error) console.warn(`[meter-sync-llm] failed to write job ${jobId}'s result before its settle: ${error.message}`)
  }
  const { settleLlmJob } = await import("./llm-billing.js")
  const settled = await settleLlmJob(jobId, reserve, spend)
  if (settled.outcome === "unsettled") {
    return { settled, ...(finish.status === "failed" ? { errorMessage: finish.errorMessage } : {}) }
  }
  if (finish.status === "completed") {
    if (opts?.complete) {
      const { data } = await supabase.from("jobs").select("output_data").eq("id", jobId).maybeSingle()
      const output = (data as { output_data?: unknown } | null)?.output_data
      await opts.complete(output && typeof output === "object" && !Array.isArray(output) ? (output as Record<string, unknown>) : {})
    } else {
      await completeSettledSyncJob(jobId)
    }
    return { settled }
  }
  const errorMessage = chargedFailureMessage(finish.errorMessage, settled)
  await markJobFailed(jobId, { error_message: errorMessage })
  return { settled, errorMessage }
}
