/**
 * A FIXED-price job that also makes metered LLM calls, billed in ONE
 * reservation (B5 — the Meta Ads / Instagram scrapes and their per-item
 * analysis). The fixed part keeps its fixed price; the LLM calls are metered
 * like any other (D1), under their own charge id and markup:
 *  - hold   = the fixed id's charged price + the TYPICAL per-item cost
 *             (`llmEstimateBaseCredits`, LLM_TYPICAL_USAGE) × the item
 *             count, marked up at `llmChargeId(feature, model)` (D12 — not
 *             one attempt at the full output cap per item);
 *  - settle = the fixed price (or 0 when the fixed part failed) +
 *             `computeActualCredits(Σ calls' cost, chargeId)`, committed
 *             through `commit_credits_metered` (`collectOverHold`), which
 *             collects an overrun above the hold; nothing billed → refund.
 * Not `commitJobCredits`' USD branch, whose `extraNonProviderCredits` would
 * lose the calls' markup.
 *
 * Core shim: the Cloud implementation is loaded by dynamic `import()`, so
 * core never statically imports `ee/`. Only for a caller already metering
 * (`llmMeteredPricing()`); under the rollback the caller reserves its tier id
 * exactly as before and never reaches this file.
 */
import type { FastifyReply, FastifyRequest } from "fastify"
import type { LlmBillingRecord, LlmPlannedCall, LlmSpend, MeteredLlmFeature } from "./llm-billing.js"
import { llmCompleteStructured } from "./llm-client.js"
import { spendLlmStructuredCall } from "./meter-sync-llm.js"
import { clearLlmBillingLedger, writeLlmBillingLedger, writeLlmBillingLedgerIfLive, type LlmBillingLedgerWrite } from "./llm-billing-ledger.js"
import { JobCancelledError } from "./job-cancellation.js"

/** The reservation `reserveFixedPlusLlmCalls` made. */
export interface FixedPlusLlmHold {
  usageLogId: string
  /** `<feature>:<model>` — the calls' charge id (their markup, their audit key). */
  chargeId: string
  /** What the fixed id is charged. */
  fixedCharged: number
  /** The calls' marked-up hold. */
  llmHoldCredits: number
  /** fixedCharged + llmHoldCredits — what was reserved. */
  holdCredits: number
}

/**
 * What a settle did: `charged` — a CONFIRMED commit (`charged` = the
 * receipt's figure, the job's `credits_actual`; `record` = the calls' billing
 * record, absent when nothing was billed or their cost was uncomputable);
 * `refunded` — nothing to charge; `unsettled` — no confirmed commit (the hold
 * stays reserved and is logged).
 */
export type FixedPlusLlmSettle =
  | { outcome: "charged"; charged: number; shortfall: number; record?: LlmBillingRecord }
  | { outcome: "refunded" }
  | { outcome: "unsettled" }

let implPromise: Promise<typeof import("../ee/billing/llm-fixed-plus-calls-impl.js")> | null = null
function loadImpl(): Promise<typeof import("../ee/billing/llm-fixed-plus-calls-impl.js")> {
  return (implPromise ??= import("../ee/billing/llm-fixed-plus-calls-impl.js"))
}

/**
 * Reserve a fixed id's price plus the calls' typical cost (D12), as ONE
 * usage log under `fixedId` (`reserveCreditsForJob(…, { holdCredits })`).
 * `undefined` = a reply was sent (a refusal: an unpriced model `400
 * llm_model_unpriced`, its job row deleted; a short balance `402`).
 * `plannedRequest` is one item's call as it will be sent — the model must be
 * priced on every lane it may be served on (fail closed); `items` is how
 * many such calls the job makes at most.
 */
export async function reserveFixedPlusLlmCalls(
  req: FastifyRequest,
  reply: FastifyReply,
  jobId: string,
  args: { fixedId: string; feature: MeteredLlmFeature; modelId: string; items: number; plannedRequest: LlmPlannedCall["request"] },
): Promise<FixedPlusLlmHold | undefined> {
  return (await loadImpl()).reserveFixedPlusLlmCallsImpl(req, reply, jobId, args)
}

/**
 * Settle it — AFTER the job's completion (or failure) write, so a cancel that
 * lands first is never charged: `fixedPart: "charge"` when the fixed work was
 * delivered, `"refund"` when it failed — the calls are charged what they
 * billed either way (a billed call is never refunded, D10). On a receipt it
 * writes the job's `credits_actual` and `provider_cost`, then the billing
 * ledger (with the charge id) into the server-only ledger column
 * (`lib/llm-billing-ledger.ts`, R32); an unconfirmed settle alerts and files
 * a `metered_settle_unconfirmed` `credit_anomalies` row (the hold stays
 * reserved — nothing sweeps these jobs).
 */
export async function settleFixedPlusLlmCalls(
  jobId: string,
  hold: FixedPlusLlmHold,
  spend: LlmSpend,
  fixedPart: "charge" | "refund",
): Promise<FixedPlusLlmSettle> {
  return (await loadImpl()).settleFixedPlusLlmCallsImpl(jobId, hold, spend, fixedPart)
}

/**
 * The analysers' `complete` seam (`AnalyzeAdCreativesOptions.complete`) for a
 * metered fixed + LLM job: every call is recorded in `spend` (the answer's
 * attempts, or a failure's billed usage), and after EACH item the job's
 * accumulating ledger is written to the server-only ledger column
 * (`writeLlmBillingLedger`, R32 — never `output_data`, which the job's owner
 * reads) — the shape the settle writes, with the calls' `chargeId` — so a
 * cancel that lands mid-run finds what was already billed (R29 / D10: a
 * billed call is never refunded).
 *
 * The call-start marker (the N1 race, closed for these calls too): BEFORE
 * each call is sent the ledger is written with `inFlight` + 1, a CAS on a live
 * row (`writeLlmBillingLedgerIfLive`). A row cancelled first never has the
 * call sent (`JobCancelledError` — the analyser records the item as failed);
 * a cancel that lands while a call is in flight finds `inFlight > 0` and keeps
 * the hold, and the job settles it itself once its calls have ended
 * ({@link settleFixedPlusLlmCallsAfterCancel}; the cancelled-hold sweep
 * otherwise). Each recorded call writes `inFlight` − 1 (unconditionally, so a
 * call that ends after the flip is still on the ledger).
 *
 * The writes are serialized; `flush()` waits for the last one — call it
 * before the job's completion write (and so before the settle), so no
 * interim write can land after the settle's final ledger. A job whose calls
 * billed nothing leaves no ledger (cleared at the last write).
 */
export function fixedPlusLlmSpendTracker(
  jobId: string,
  chargeId: string,
  spend: LlmSpend,
): { complete: typeof llmCompleteStructured; flush: () => Promise<void> } {
  let queue: Promise<void> = Promise.resolve()
  let inFlight = 0
  const enqueue = <T>(write: () => Promise<T>): Promise<T> => {
    const run = queue.then(write)
    queue = run.then(() => undefined, () => undefined)
    return run
  }
  const record = (): void => {
    const n = inFlight
    void enqueue(() => writeInterimBilling(jobId, chargeId, spend, n))
  }
  const complete = (async (request, schema, opts) => {
    inFlight++
    const n = inFlight
    const started = await enqueue(() => writeLlmBillingLedgerIfLive(jobId, runningLedger(chargeId, spend, n)))
    if (started !== "written") {
      inFlight--
      record()
      if (started === "not-live") throw new JobCancelledError(jobId)
      throw new Error(`The analysis call's start could not be recorded — it is not sent (job ${jobId})`)
    }
    try {
      return await spendLlmStructuredCall(spend, request.modelId, request, () => llmCompleteStructured(request, schema, opts))
    } finally {
      inFlight--
      record()
    }
  }) as typeof llmCompleteStructured
  return { complete, flush: () => queue }
}

/** The running ledger: the spend's record (or an empty one while nothing billed) with the calls in flight. */
function runningLedger(chargeId: string, spend: LlmSpend, inFlight: number): LlmBillingLedgerWrite {
  if (spend.billedAnything) {
    try {
      return { ...spend.record, chargeId, inFlight }
    } catch {
      // An uncomputable cost (a missing rate) is the settle's to charge whole.
      return { costUsd: null, source: "uncomputable", calls: spend.attempts.length, lanes: spend.attempts.map((a) => a.lane), chargeId, inFlight }
    }
  }
  return { costUsd: 0, source: "floor", calls: 0, lanes: [], chargeId, inFlight }
}

/** One interim ledger write (replaces the job's ledger; cleared when nothing billed and nothing is in flight). Never throws. */
async function writeInterimBilling(jobId: string, chargeId: string, spend: LlmSpend, inFlight: number): Promise<void> {
  if (!spend.billedAnything && inFlight === 0) {
    await clearLlmBillingLedger(jobId)
    return
  }
  await writeLlmBillingLedger(jobId, runningLedger(chargeId, spend, inFlight))
}

/**
 * A fixed + calls job that found its row cancelled (its completion or failure
 * write lost its CAS): settle what its calls billed, once they have all ended
 * (call it after `flush()`). The cancel kept the hold when a call was in
 * flight (`inFlight > 0`), or settled it already; this runs the cancel's own
 * after-flip rule (`settleMeteredHoldAfterFlip`): the billed calls charged at
 * their actual, the fixed part (never delivered) released; nothing billed →
 * refunded. Never throws.
 */
export async function settleFixedPlusLlmCallsAfterCancel(jobId: string): Promise<void> {
  try {
    const { settleMeteredHoldAfterFlip } = await import("./cancel-job.js")
    const verdict = await settleMeteredHoldAfterFlip(jobId)
    if (verdict === "refund") {
      const { refundReservedCreditsForJob } = await import("./credits-job-lifecycle.js")
      await refundReservedCreditsForJob(jobId)
    }
  } catch (err) {
    console.error(`[llm-billing] job ${jobId}: settling its calls after the cancel failed — left to the cancelled-hold sweep:`, err)
  }
}
