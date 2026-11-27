// @registry-lookup finalizes a single routed job at its own confirmed charge
import { supabase } from "../../lib/supabase.js"
import { holdRouteSettle, patchRouteSettle, readRouteLedger, recordRouteSettle } from "../../lib/video-route-ledger.js"
import { billAnomalyMultipleOf, routeBillAnomalous, type VideoRoutePolicy } from "../../lib/video-route-policy.js"
import { CreditsService, type CommitOutcome } from "./credits.js"
import { recordVideoRouteAlert } from "./video-route-alerts.js"

export class RoutedSettleRetry extends Error {}
/** Pending because the route has not reported a bill (or how a started send ended): the sweep reads the route again. */
export class RoutedSettleUnbilled extends RoutedSettleRetry {}
/** Pending because the job completed with no delivered routed send on its ledger: past the wait, its hold is released. */
export class RoutedSettleNothingDelivered extends RoutedSettleRetry {}

/** How long a settlement that closed with a send the route had not billed is still read for a late bill, and how often. */
export const LATE_BILL_WATCH_DAYS = 7
export const LATE_BILL_READ_MS = { unbilled: 6 * 3_600_000, closed: 24 * 3_600_000 } as const

/**
 * Writes `patch` (and `columns`) on the job's settle row, and when that cannot
 * be written says so: an `[ALERT]` and an Admin alert, never a silent skip.
 * Answers whether it was written.
 */
export async function patchSettleOrAlert(jobId: string, what: string, patch: Record<string, unknown>, columns: Record<string, unknown> = {}): Promise<boolean> {
  if (await patchRouteSettle(jobId, patch, columns)) return true
  const message = `${what} could not be written on its routed settlement; the sweep reads it again on its next pass.`
  console.error(`[ALERT] video route: job ${jobId}: ${message}`)
  await recordVideoRouteAlert({ key: `settle-write:${jobId}`, kind: "settlement", jobId, message }).catch(() => {})
  return false
}

/**
 * Starts (or keeps) the watch for a late bill on a settlement that closed over
 * a send the route had not billed: the sweep reads the route again every
 * `everyMs` until the watch ends. The watch's starting figures are written in
 * the SAME write that starts it: `knownUsd`, the route's verified bills as the
 * ledger stood when the settlement's figures were taken (`ledgerBilledUsd`),
 * and `loss`, the loss recorded then (the one loss rule). The late-bill pass
 * compares every read against them, so a bill is found on the read where it
 * is first SEEN, not only on the read that fetched it. Every caller passes
 * them; null when the ledger could not be read just then — the first read of
 * the watch then only records them (it is no late bill). A late bill is
 * recorded and alerted, never charged on its own. Tried twice; a watch that
 * cannot be written is alerted (never a silent skip). Never throws.
 */
export async function watchForLateBill(jobId: string, everyMs: number, opts: { knownUsd: number | null; loss?: { credits: number; usd: number } | null; now?: number }): Promise<boolean> {
  const now = opts.now ?? Date.now()
  const patch = {
    watchUntil: new Date(now + LATE_BILL_WATCH_DAYS * 86_400_000).toISOString(),
    ...(typeof opts.knownUsd === "number" ? { knownUsd: opts.knownUsd } : {}),
    ...(opts.loss ? { loss: { credits: opts.loss.credits, usd: opts.loss.usd } } : {}),
  }
  const columns = { next_attempt_at: new Date(now + everyMs).toISOString() }
  if (await patchRouteSettle(jobId, patch, columns)) return true
  return patchSettleOrAlert(jobId, "The watch for a late bill", patch, columns)
}
/** The settlement is held for an admin's decision (its bill is far above its quote); nothing was charged. */
export class RoutedSettleHeld extends RoutedSettleRetry {}

export async function deferRoutedSettlement(jobId: string, reason: string, cause?: "unbilled" | "nothing-delivered"): Promise<never> {
  await recordRouteSettle(jobId, "retry", { note: reason })
  await recordVideoRouteAlert({ key: `settlement:${jobId}`, kind: "settlement", jobId, message: reason })
  if (cause === "unbilled") throw new RoutedSettleUnbilled(`job ${jobId}: ${reason}`)
  if (cause === "nothing-delivered") throw new RoutedSettleNothingDelivered(`job ${jobId}: ${reason}`)
  throw new RoutedSettleRetry(`job ${jobId}: ${reason}`)
}

export async function finishRoutedReceipt(usageLogId: string, jobId: string, receipt: CommitOutcome): Promise<void> {
  if (receipt.shortfall > 0) {
    const message = `The payer's balance could not cover ${receipt.shortfall} credits over the hold.`
    console.error(`[ALERT] video route: job ${jobId}: ${message}`)
    await recordVideoRouteAlert({ key: `balance:${jobId}`, kind: "balance", message, jobId })
    // A payment may already have arrived since the metered RPC returned.
    const { error } = await supabase.rpc("sync_video_route_debt", { p_usage_log_id: usageLogId, p_job_id: jobId })
    if (error) throw new Error(`Job ${jobId}: could not record the current outstanding charge: ${error.message}`)
    return
  }
  const { error } = await supabase.from("jobs").update({ credits_actual: receipt.charged }).eq("id", jobId)
  if (error) throw new Error(`Job ${jobId}: recording actual credits failed: ${error.message}`)
  await recordRouteSettle(jobId, "done", { credits: receipt.charged })
}

/** The verified bill a routed charge was computed from, beside the quote the run was held at (both USD, summed over the job's tasks). */
export interface RoutedBill {
  readonly billedUsd: number
  /** The quote times its price factor, summed over the same tasks; null when a task has none recorded. */
  readonly quotedUsd: number | null
  readonly policy: VideoRoutePolicy | null | undefined
  readonly model?: string
  /** A delivered send is charged at its quote because the route never billed it: the route is read for a late bill afterwards. */
  readonly unbilledSends?: boolean
  /** What a release of this settlement records as the loss (an admin's rejection): the one loss rule over every send. */
  readonly releaseLoss: RouteLoss
  /** The route's verified bills on the ledger the figures were taken from (`ledgerBilledUsd`): the late-bill watch's starting point. */
  readonly knownUsd: number | null
}

/**
 * The hold is released (nothing is charged): an admin rejected the bill, or a
 * completed run had nothing delivered. `loss` is what is recorded as the
 * loss ({@link RouteLoss}, the one loss rule in video-route-settlement.ts
 * `routeLossOf`: what the route billed, or quoted while unbilled, for the
 * sends, never the hold with our own fee). Idempotent: the release is a
 * compare-and-set on the log's `reserved` status, and a replay finds it done.
 */
export async function releaseRejectedCharge(usageLogId: string, jobId: string, loss: RouteLoss, opts: { note?: string; knownUsd: number | null }): Promise<void> {
  const { data: log, error } = await supabase.from("usage_logs").select("status").eq("id", usageLogId).maybeSingle()
  if (error || !log) throw new Error(`Job ${jobId}: could not read its reservation to release it`)
  if (log.status === "reserved") {
    await CreditsService.refundCredits(usageLogId)
    const check = await supabase.from("usage_logs").select("status").eq("id", usageLogId).maybeSingle()
    if (check.error || check.data?.status !== "refunded") throw new Error(`Job ${jobId}: the rejected charge's release has no receipt`)
  } else if (log.status !== "refunded") {
    throw new Error(`Job ${jobId}: a rejected charge's reservation is ${String(log.status)}; it is not released from here`)
  }
  const { error: jobError } = await supabase.from("jobs").update({ credits_actual: 0 }).eq("id", jobId)
  if (jobError) throw new Error(`Job ${jobId}: recording actual credits failed: ${jobError.message}`)
  await recordRouteSettle(jobId, "waived", { credits: 0, uncollected: loss.credits, note: opts.note ?? "bill rejected by an admin; hold released, charge not taken (a recorded loss)" })
  console.error(`[ALERT] video route: job ${jobId}: its hold was released; ${loss.credits} credits of the route's bill for it are recorded as a loss.`)
  // A send the route had not billed may still be billed: the loss recorded above is the best known, and is corrected if a bill arrives.
  if (loss.unbilled) await watchForLateBill(jobId, LATE_BILL_READ_MS.closed, { knownUsd: opts.knownUsd, loss })
}

/**
 * A recorded loss, by the one loss rule (video-route-settlement.ts `routeLossOf`):
 * what the route billed — or quoted, while a delivered send has no bill — for
 * the sends that are NOT charged, in base credits (the route's cost at the
 * credit's value: no markup, no add-on, no run fee), and in USD beside it.
 * `unbilled`: a send counted in it may still be billed (the route is watched).
 */
export interface RouteLoss {
  readonly credits: number
  readonly usd: number
  readonly unbilled: boolean
}

/**
 * THE one place a routed charge is taken — every routed settlement (a job's
 * own, a plugin run's, the retry sweep, a deferred child's release, an admin's
 * decision) ends here.
 *
 * The anomaly hold: a verified bill more than the policy's
 * `billAnomalyMultiple` times the run's quote is NOT charged. The settlement
 * moves to `hold` (one alert, when it enters), and `RoutedSettleHeld` is
 * thrown; the clip stays delivered. An admin then decides (Admin → Video
 * route): `confirmed` charges it in full through this same call, `rejected`
 * releases the hold and records the loss. Answers which of the two happened:
 * a released bill is no evidence of the route's price (no factor is raised).
 */
/** How far a charge may differ from the total an admin was shown and still be the total they decided on. */
export const CONFIRM_ROUNDING_CREDITS = 1

export async function commitRoutedCharge(usageLogId: string, jobId: string, charged: number, bill: RoutedBill): Promise<"charged" | "released"> {
  const settle = (await readRouteLedger(jobId)).settle
  const decision = settle?.decision ?? null
  if (decision === "rejected") {
    await releaseRejectedCharge(usageLogId, jobId, bill.releaseLoss, { knownUsd: bill.knownUsd })
    return "released"
  }
  const multiple = billAnomalyMultipleOf(bill.policy)
  // The test ALWAYS runs on the total about to be charged, against the quote the run was held at.
  // Only an admin's `confirmed` (given on a hold, having seen that total) passes it. A `quote`
  // decision does not: it only says what an unbilled send is charged at, and a total that is far
  // above the quote (a billed send's real bill, or a bill that arrived since) is held for its own
  // confirmation.
  // And a `confirmed` passes only the total it was given for (kept beside the decision, with one
  // credit of rounding): a bill that arrived since the admin looked is held for its own.
  const confirmedFor = settle?.detail?.decidedForCredits
  const confirmed = decision === "confirmed" && typeof confirmedFor === "number" && charged <= confirmedFor + CONFIRM_ROUNDING_CREDITS
  if (!confirmed && routeBillAnomalous(bill.billedUsd, bill.quotedUsd, multiple)) {
    const quoted = bill.quotedUsd ?? 0
    const note = quoted > 0
      ? `its verified bill is ${(bill.billedUsd / quoted).toFixed(2)}x its quote (held above ${multiple}x); ${charged} credits await a decision`
      : `its verified bill has no quote to compare against; ${charged} credits await a decision`
    const entered = await holdRouteSettle(jobId, { credits: charged, billedUsd: bill.billedUsd, quotedUsd: quoted, note })
    if (entered) {
      const message = `A routed${bill.model ? ` ${bill.model}` : ""} run's settlement is held: ${note}. Confirm or reject it in Admin.`
      console.error(`[ALERT] video route: job ${jobId}: ${message}`)
      // The hold is durable and listed in Admin whether or not this alert could be kept.
      try {
        await recordVideoRouteAlert({ key: `anomaly:${jobId}`, kind: "anomaly", jobId, ...(bill.model ? { model: bill.model } : {}), message })
      } catch (err) {
        console.error(`[video-route] job ${jobId}: recording its held-settlement alert failed: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
    throw new RoutedSettleHeld(`job ${jobId}: ${note}`)
  }
  const outcome = await CreditsService.commitCredits(usageLogId, charged, { collectOverHold: true, routedJobId: jobId })
  if (!outcome) return deferRoutedSettlement(jobId, `The metered settlement of ${charged} credits gave no receipt`)
  await finishRoutedReceipt(usageLogId, jobId, outcome)
  // Charged at its quote for a send the route had not billed: a bill that arrives later is recorded against this charge.
  if (bill.unbilledSends) await watchForLateBill(jobId, LATE_BILL_READ_MS.closed, { knownUsd: bill.knownUsd })
  return "charged"
}
