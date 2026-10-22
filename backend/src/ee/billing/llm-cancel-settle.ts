// @registry-enumerates commits the credit id it is given through CreditsService — a credit id, not a node type, so not a @registry-lookup
// Cloud half of the cancel rule for a FIXED-price hold that carries billed
// metered LLM calls (D10 / R22): the Meta Ads / Instagram scrapes keep ONE
// usage log under their fixed scrape id (`meta-ads-scrape:100`, not a metered
// id) and record their per-item analyses' spend in the job's server-only
// billing ledger (R32; `chargeId` = `meta-ads-analysis:<model>`). The sweep's metered rule keys off
// a metered usage-log id and never sees them; this keys off the LEDGER.
// Loaded by `lib/cancel-job.ts` through a dynamic import, credits on only.

import { CREDIT_BASE_USD } from "@nodaro/shared/models"
import { supabase } from "../../lib/supabase.js"
import { readLlmBillingLedger } from "../../lib/llm-billing-ledger.js"
import { CreditsService } from "./credits.js"
import { computeActualCredits } from "./credit-anomaly.js"
import { parseMeteredLlmId } from "./metered-llm-id.js"

/** The same three verdicts as the sweep's metered rule (`settleSweptMeteredLlmJob`). */
export type BilledLedgerCancelVerdict = "not-metered" | "settled" | "retry"

interface Ledger {
  costUsd?: unknown
  calls?: unknown
  chargeId?: unknown
  inFlight?: unknown
}

/** A ledger that recorded at least one billed call (a settle's `LlmBillingRecord`, or an uncomputable ledger). */
export function ledgerBilled(ledger: unknown): ledger is Ledger {
  if (!ledger || typeof ledger !== "object") return false
  const l = ledger as Ledger
  return (typeof l.calls === "number" && l.calls > 0) || (typeof l.costUsd === "number" && l.costUsd > 0)
}

/**
 * A running ledger with calls STARTED and not yet recorded (the scrapes'
 * call-start marker, `fixedPlusLlmSpendTracker`): a call is in flight, so the
 * hold is kept for the job's own settle — never committed or refunded under it.
 */
export function ledgerInFlight(ledger: unknown): boolean {
  if (!ledger || typeof ledger !== "object") return false
  const n = (ledger as Ledger).inFlight
  return typeof n === "number" && n > 0
}

/**
 * What the ledger says the billed calls cost, in charged credits — the
 * settle's own arithmetic (`computeActualCredits(max(cost, floor), chargeId)`)
 * — or undefined when it cannot be priced (no cost, an uncomputable ledger, no
 * metered charge id).
 */
async function ledgerCharge(ledger: Ledger): Promise<number | undefined> {
  const cost = ledger.costUsd
  const chargeId = ledger.chargeId
  if (typeof cost !== "number" || !Number.isFinite(cost) || cost < 0) return undefined
  if (typeof chargeId !== "string" || parseMeteredLlmId(chargeId) === null) return undefined
  return computeActualCredits(Math.max(cost, CREDIT_BASE_USD), chargeId)
}

/**
 * After a cancel's FLIP (N1 — `settleMeteredHoldsBeforeCancel` answers
 * `not-started` before it, so nothing is committed while the scrape may still
 * record a billed analysis), before the cancel refunds the job's holds: a job
 * whose billing ledger (the server-only column, read through
 * `lib/llm-billing-ledger.ts`) recorded billed calls is never refunded for them. The spend recorded so far
 * is committed on the job's reserved hold through the metered commit
 * (`collectOverHold`: an overrun is collected, capped at the payer's balance;
 * the commit refunds the rest of the hold — the fixed part, which a cancel
 * did not deliver). A ledger that cannot be priced commits the hold WHOLE.
 *  - `not-metered` — no reserved hold, or no billed ledger: refund as before;
 *  - `settled` — committed and confirmed (`credits_actual` from the receipt);
 *  - `retry` — a read failed or a commit was not confirmed: nothing refunded.
 * A job holding several reserved logs has the ledger charged on the first;
 * the others are the caller's to refund (the scrapes hold one).
 */
export async function settleBilledLedgerBeforeCancelImpl(
  jobId: string,
  /** The cancelled-hold sweep, past the grace: a call still marked in flight died with its process (counted unbilled, as everywhere). */
  opts: { ignoreInFlight?: boolean } = {},
): Promise<BilledLedgerCancelVerdict> {
  const { data: logs, error } = await supabase
    .from("usage_logs")
    .select("id, credits_used")
    .eq("job_id", jobId)
    .eq("status", "reserved")
  if (error) return "retry"
  const rows = (Array.isArray(logs) ? logs : []) as Array<{ id: string; credits_used?: unknown }>
  if (rows.length === 0) return "not-metered"

  const read = await readLlmBillingLedger(jobId)
  if (!read.ok) return "retry"
  const ledger = read.ledger
  if (!opts.ignoreInFlight && ledgerInFlight(ledger)) {
    // A call is in flight: kept — the job settles it once its calls end
    // (`settleFixedPlusLlmCallsAfterCancel`), the cancelled-hold sweep otherwise.
    console.warn(`[llm-billing] cancel: job ${jobId} has an analysis call in flight — its hold is kept for its own settle`)
    return "retry"
  }
  if (!ledgerBilled(ledger)) return "not-metered"

  const log = rows[0]!
  const hold = typeof log.credits_used === "number" && Number.isFinite(log.credits_used) ? log.credits_used : undefined
  const charge = await ledgerCharge(ledger)
  const amount = charge ?? hold
  if (amount === undefined) {
    console.error(`[llm-billing] cancel: job ${jobId} recorded billed calls but neither its ledger nor its hold can be read — left reserved`)
    return "retry"
  }
  if (charge === undefined) {
    console.error(`[llm-billing] ALERT: cancel: job ${jobId}'s billed ledger cannot be priced — committing its hold whole (${hold} credits)`)
  }
  let receipt: Awaited<ReturnType<typeof CreditsService.commitCredits>> = undefined
  try {
    receipt = await CreditsService.commitCredits(log.id, amount, { collectOverHold: true })
  } catch (err) {
    console.error(`[llm-billing] cancel: commit of job ${jobId}'s billed calls threw:`, err)
  }
  if (!receipt) return "retry"
  const { error: writeError } = await supabase.from("jobs").update({ credits_actual: receipt.charged }).eq("id", jobId)
  if (writeError) console.warn(`[llm-billing] cancel: failed to record credits_actual on job ${jobId}: ${writeError.message}`)
  console.warn(`[llm-billing] cancel: job ${jobId} was cancelled after billed calls — committed ${receipt.charged} credits, never refunded`)
  return "settled"
}
