/**
 * The pieces the metered TEXT routes share — Generate Text (`routes/llm-chat.ts`),
 * AI Writer (`routes/ai-writer.ts`) and Prompt Helper (`routes/prompt-helper.ts`).
 *
 * Each route reserves through `reserveLlmCall`, records its call in an
 * `LlmSpend`, and settles with `settleLlmJob` (`lib/llm-billing.ts`). The
 * terminal status writes stay in the route files themselves (the job-policy
 * result guard is keyed by file); this module prices the guard's pre-check,
 * records a call into the spend without ever throwing, records a job's output
 * (with the evidence that it was billed) before the settle, ties a stream to
 * its client's disconnect, and words a charged failure.
 */
import type { FastifyReply } from "fastify"
import type { ZodType } from "zod"
import { supabase } from "./supabase.js"
import { writeLlmBillingLedger } from "./llm-billing-ledger.js"
import { LlmContentRefusalError, LlmOutputTruncatedError, LlmStreamAbortedError } from "./llm-errors.js"
import { llmPrecheckBaseCredits, type LlmSettleOutcome, type LlmSpend, type MeteredLlmFeature } from "./llm-billing.js"
import type { LlmRequest } from "./llm/types.js"

/** The characters of every string in `values` (arrays and plain objects walked), never anything else. */
function textChars(values: readonly unknown[]): number {
  let chars = 0
  const walk = (v: unknown, depth: number): void => {
    if (typeof v === "string") chars += v.length
    else if (depth < 3 && Array.isArray(v)) for (const item of v) walk(item, depth + 1)
    else if (depth < 3 && v && typeof v === "object") for (const item of Object.values(v)) walk(item, depth + 1)
  }
  for (const v of values) walk(v, 0)
  return chars
}

/** The body fields every metered text route's schema carries (the parsed body's view the pre-check reads). */
interface PrecheckBody {
  llmModel?: string
  reasoningEffort?: string
  advancedMode?: boolean
}

/**
 * The guard's `computeCredits` for a metered text route: the 1-attempt hold,
 * in base credits, of the body's model over the TEXT the route sends — a UX
 * pre-check only; `reserveLlmCall`'s hold is what is reserved.
 *
 * It refuses nothing the route's own schema refuses: a body that fails
 * `schema` answers `undefined` (no override — the route then answers it
 * Zod's 400, never `llm_model_unpriced` or a 402). It reads the PARSED body,
 * so the schema's defaults apply exactly as in the route. `undefined` under
 * the rollback (the tier row prices the check exactly as before).
 */
export function meteredTextPrecheck<T extends PrecheckBody>(
  feature: MeteredLlmFeature,
  route: {
    /** The route's own body schema. */
    schema: ZodType<T>
    /** The fields whose text the route sends — never a media URL or inline media. */
    textOf: (body: T) => readonly unknown[]
    /**
     * The output cap the route SENDS for this body, resolved as the route
     * resolves it (its defaults, Advanced mode). An undefined cap is priced at
     * the model's whole output ceiling, so leaving out a default the route
     * applies would sit far above the real hold and refuse a payer who can
     * afford it.
     */
    maxTokensOf: (body: T) => number | undefined
  },
): (body: unknown) => Promise<number | undefined> {
  return async (body) => {
    const parsed = route.schema.safeParse(body)
    if (!parsed.success) return undefined
    const b = parsed.data
    return llmPrecheckBaseCredits(
      feature,
      { llmModel: b.llmModel, reasoningEffort: b.reasoningEffort, advancedMode: b.advancedMode, maxTokens: route.maxTokensOf(b) },
      textChars(route.textOf(b)),
    )
  }
}

/**
 * Abort `controller` when the CLIENT goes away mid-stream: the response's
 * `close` before it finished. Never the request's `close` — on current Node
 * that fires once the POST body has been read, not when the client leaves
 * (see `lib/sse.ts`), so a listener there never stops a stream. A response
 * that finished normally (`writableFinished`) is no disconnect.
 */
export function abortOnClientDisconnect(reply: FastifyReply, controller: AbortController): void {
  reply.raw.once("close", () => {
    if (!reply.raw.writableFinished) controller.abort()
  })
}

/**
 * `spend.add`, never throwing: a malformed outcome is logged loudly and
 * answers false. The caller then records the job's evidence and leaves it to
 * the reconcile sweep instead of settling a spend that misses the call — the
 * settle would refund a call that was billed.
 */
export function addCallToSpend(spend: LlmSpend, modelId: string, request: LlmRequest, outcome: Parameters<LlmSpend["add"]>[2]): boolean {
  try {
    spend.add(modelId, request, outcome)
    return true
  } catch (err) {
    console.error(`[metered-text-route] ALERT: could not record a ${modelId} call in its spend — the job is left to the reconcile sweep:`, err)
    return false
  }
}

/**
 * The `provider_cost` written before the settle — the evidence the reconcile
 * sweep reads (`provider_cost > 0` → billed → it charges the hold, never
 * refunds it; R20) should the settle crash before writing its own ledger. The
 * spend's cost when it billed something and the cost is computable, else the
 * call's own figure (`fallback`); null for a spend that billed nothing (it is
 * refunded). A settle that succeeds overwrites it with the settled cost.
 */
export function billedEvidence(spend: LlmSpend, fallback: number | null | undefined): number | null {
  const own = typeof fallback === "number" && Number.isFinite(fallback) && fallback > 0 ? fallback : null
  if (!spend.billedAnything) return own
  try {
    const cost = spend.costUsd
    if (Number.isFinite(cost) && cost > 0) return cost
  } catch {
    // A missing rate: the settle charges the hold whole; the call's own figure stands as the evidence.
  }
  return own
}

/**
 * Record a metered job's output (its answer, or its error) BEFORE the settle:
 * the settle writes `provider_cost` / `credits_actual` and the billing ledger
 * (server-only ledger column, R32), so nothing written after it may touch
 * those columns. Never a status write — the route writes the terminal status
 * after the settle (and not at all when it is `unsettled`, leaving the row to
 * the reconcile sweep). `providerCost` is the billed evidence
 * ({@link billedEvidence}). `unrecordedChargeId`: given (the hold's charge
 * id) for an answered call whose spend could not be recorded — the job also
 * gets the `uncomputable` billing ledger, under that charge id
 * (in the server-only ledger column, through `writeLlmBillingLedger`; never in
 * `output_data`, which the job's owner reads), so the sweep charges its hold
 * (R20) even when the call reported no cost.
 * Best-effort: a failed write is logged, never thrown.
 */
export async function recordMeteredJobOutput(
  jobId: string,
  output: Record<string, unknown>,
  providerCost: number | null,
  unrecordedChargeId?: string,
): Promise<void> {
  try {
    const { error } = await supabase
      .from("jobs") // tenant-scope-ignore: job.id is server-generated in this request
      .update({ output_data: output, provider_cost: providerCost })
      .eq("id", jobId)
    if (error) console.warn(`[metered-text-route] failed to record the output of job ${jobId}: ${error.message}`)
  } catch (err) {
    console.warn(`[metered-text-route] failed to record the output of job ${jobId}: ${(err as Error).message}`)
  }
  if (unrecordedChargeId !== undefined) {
    await writeLlmBillingLedger(jobId, { costUsd: null, source: "uncomputable", calls: 1, lanes: [], chargeId: unrecordedChargeId })
  }
}

/** The first error of `type` on `err`'s cause chain. */
function onCauseChain<E>(err: unknown, type: abstract new (...args: never[]) => E): E | undefined {
  let cur: unknown = err
  for (let depth = 0; cur !== null && cur !== undefined && depth < 8; depth++) {
    if (cur instanceof type) return cur as E
    cur = (cur as { cause?: unknown }).cause
  }
  return undefined
}

/**
 * The sentence a person reads for a failed metered call. Spec §7: a CHARGED
 * failure says it was charged, and why, so it does not read as a bug. Only a
 * settle that confirmed the charge (`charged`) says so: a refunded call, and
 * one whose settle is still open (`unsettled`), keep `message` as it is.
 *  - a stopped stream (D2): the text generated before the stop;
 *  - a cut-off answer: the text written before the cap;
 *  - a content refusal: the provider billed the request it refused;
 *  - anything else billed (an answer that failed validation after its
 *    retries, a malformed reply): the attempts the provider billed.
 */
export function meteredFailureMessage(err: unknown, message: string, settled: LlmSettleOutcome): string {
  if (settled.outcome !== "charged") return message
  if (onCauseChain(err, LlmStreamAbortedError)) return "The answer was stopped — charged for the text generated so far."
  const base = message.replace(/[.\s]+$/, "")
  if (onCauseChain(err, LlmOutputTruncatedError)) return `${base} — charged for the text the model wrote before it was cut off.`
  if (onCauseChain(err, LlmContentRefusalError)) return `${base} — charged, because the provider billed the request it refused.`
  return `${base} — charged for the attempts the provider billed.`
}
