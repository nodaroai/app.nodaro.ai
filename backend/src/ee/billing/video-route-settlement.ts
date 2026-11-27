// @registry-lookup settles the one job it is given, at its own credit id (CreditsService.commitCredits)
/** Settle a delivered routed video from its verified task costs and delivered add-ons. */
import { supabase } from "../../lib/supabase.js"
import { getRuntimeEnv } from "../../lib/runtime-env.js"
import { getAppSettings, settingsReadFailed, type AppSettings } from "../../lib/app-settings.js"
import { VIDEO_ROUTE_STAMP_KEY, foreignRowlessRouteToken, rowlessRunTokenFor, videoRouteStampOf, type VideoRouteStamp } from "../../lib/video-route-decision.js"
import { PRICE_FACTOR_MAX_AUTO, billAnomalyMultipleOf, routeBillAnomalous, routedRunFee, priceFactorOf, raisedPriceFactor, unpaidChargesEnforced } from "../../lib/video-route-policy.js"
import { updateVideoRoutePriceFactor } from "../../lib/video-route-policy-store.js"
import { deliveredTask, markRouteSettleUnbilled, markRouteTaskOwnLoss, noteRouteSettleAttempt, patchRouteSettle, readLateBillWatches, readRouteLedger, recordRouteSettle, reopenUnbilledSettle, type LateBillWatch, type RouteLedger } from "../../lib/video-route-ledger.js"
import { closeUnresolvedStarts, resolveRouteLedger } from "../../lib/video-route-resolve.js"
import { DEFER_SETTLEMENT_INPUT_KEY } from "../../lib/deferred-child-request.js"
import { CreditsService } from "./credits.js"
import { applyServiceMarkup } from "./service-margin.js"
import { routedPriceIdOf, routedSettlementCredits } from "./video-route-pricing.js"

import { commitRoutedCharge, deferRoutedSettlement, finishRoutedReceipt, patchSettleOrAlert, releaseRejectedCharge, watchForLateBill, CONFIRM_ROUNDING_CREDITS, LATE_BILL_READ_MS, RoutedSettleHeld, RoutedSettleNothingDelivered, RoutedSettleUnbilled, type RouteLoss } from "./video-route-receipt.js"
import { ledgerBilledUsd, ledgerMayStillBill, routeLossOf } from "./video-route-loss.js"
import { boundRunOptions, routedRunChargeOf, settleRoutedRunJob, savedRoutedRunSchema } from "./video-route-runs.js"
import { recordVideoRouteAlert } from "./video-route-alerts.js"
export { RoutedSettleRetry, RoutedSettleHeld, RoutedSettleUnbilled, RoutedSettleNothingDelivered } from "./video-route-receipt.js"

/** The usage log a settlement charges: what the caller already read with its managed-settle check. */
export interface RoutedSettleLog {
  readonly action: string | null
  readonly credits_used: number | null
  readonly job_id: string | null
  /** The reservation itself is marked routed (written at admission): it settles here whatever the policy row says. */
  readonly routed?: boolean
}

/**
 * Whether a usage log MAY belong to a routed job, without a read: its price id
 * is one a route can price, and a routing setting was ever saved here (or a
 * route that routes per model is loaded — a job admitted before the setting
 * was removed still settles on its route).
 */
export function mayBeRoutedSettle(action: string | null | undefined, settings?: AppSettings, routedReservation?: boolean): boolean {
  // The reservation in hand says it is routed (marked at admission, read with the log itself):
  // it always settles here, whatever this process sees of the policy row.
  if (routedReservation === true) return true
  // No routing policy was ever saved in this environment (a successful read
  // says so): nothing here was ever routed. Decided with no read and no write,
  // so every such job settles exactly as before. A settings read that failed
  // proves nothing and goes on to the job itself.
  if (settings && !settingsReadFailed(settings) && !settings.video_route_policy) return false
  return routedRunFee(action) || (typeof action === "string" && routedPriceIdOf(action) !== undefined)
}

/** What refuses another environment's routed job: nothing of it is read, written or charged here. */
export const FOREIGN_ROUTED_RESERVATION = "This routed reservation belongs to another environment"

/** How often the job read a settlement decides from is tried before the settlement gives up for now. */
const ROUTED_JOB_READ_ATTEMPTS = 3

export type RoutedCharge =
  | {
      kind: "billed"; chargedCredits: number; costUsd: number
      /** How many sends are charged (and so how many quotes the bill is compared with). */
      taskCount: number
      /** A charged send had no bill and is charged at its quote (an admin's decision). */
      usedQuote: boolean
      /** Delivered sends that are NOT charged: their clip was replaced by a later send after a step of ours failed. Our loss (`billedUsd` null: its bill has not come yet). */
      ownLoss: ReadonlyArray<{ send: number; billedUsd: number | null }>
    }
  | { kind: "pending"; reason: string; cause?: "unbilled" | "nothing-delivered" }

/**
 * What a routed job is charged, from its ledger. Pure.
 *
 * Only ONE send is charged: the last delivered one, the clip the person
 * received. An earlier delivered send exists only because a step of OURS
 * failed after the route delivered it (a voice track that could not be laid
 * on): its bill is our loss, never the person's. `opts.atQuote` (or an admin's
 * recorded `quote` decision) charges that send at its quote when the route
 * never billed it; otherwise a send with no bill is pending.
 */
export function routedChargeOf(stamp: VideoRouteStamp, log: RoutedSettleLog, ledger: RouteLedger, settings: AppSettings, opts: { atQuote?: boolean } = {}): RoutedCharge {
  if (log.action !== stamp.priceId) return { kind: "pending", reason: `its usage log is priced as ${log.action}, its decision as ${stamp.priceId}` }
  // A send that started and was never read to an end may have been billed: nothing is settled over it.
  if ((ledger.unresolvedStarts ?? []).some((s) => s.key === "")) return { kind: "pending", cause: "unbilled", reason: "a started send has not been read to its end" }
  // Only delivered sends count: one the route ended with no result, or one given up on as unresolved, does not.
  const delivered = ledger.tasks.filter(deliveredTask).slice().sort((a, b) => a.send - b.send)
  const charged = delivered.at(-1)
  if (!charged) return { kind: "pending", cause: "nothing-delivered", reason: "no completed routed task is recorded" }
  const atQuote = (opts.atQuote ?? ledger.settle?.atQuote === true) ? stamp.quotedUsd * stamp.factor : null
  if (charged.billedUsd === null && atQuote === null) return { kind: "pending", cause: "unbilled", reason: "the route reported no verified bill for a task" }
  const costUsd = charged.billedUsd ?? atQuote ?? 0
  const { chargedCredits } = routedSettlementCredits({ providerCostUsd: costUsd, priceId: stamp.priceId, settings })
  const addons = ledger.addonsBase ? applyServiceMarkup(ledger.addonsBase, settings, stamp.priceId) : 0
  return {
    kind: "billed", chargedCredits: chargedCredits + addons, costUsd, taskCount: 1, usedQuote: charged.billedUsd === null,
    ownLoss: delivered.slice(0, -1).map((t) => ({ send: t.send, billedUsd: t.billedUsd })),
  }
}

/**
 * THE routed settlement (see the module doc). True when the job was routed and
 * is settled (or left for the retry sweep: `RoutedSettleRetry` is thrown after
 * the ledger is marked `retry`); false when it is not routed — the caller
 * settles it as always.
 */
export async function settleRoutedJob(args: { usageLogId: string; jobId: string; log: RoutedSettleLog }): Promise<boolean> {
  let settings: AppSettings | undefined
  try {
    settings = await getAppSettings()
  } catch {
    settings = undefined
  }
  if (!mayBeRoutedSettle(args.log.action, settings, args.log.routed)) return false
  // A log shared with another job (a parent's) is not this job's to settle.
  if (args.log.job_id && args.log.job_id !== args.jobId) throw new Error("Cannot settle another job’s routed reservation")

  const retry = (reason: string) => deferRoutedSettlement(args.jobId, reason)
  // Only a job PROVEN routed may wait on its ledger. Until the row is read
  // nothing is proven, so a failed read is read again, and a read that keeps
  // failing throws with NOTHING written: no retry mark is left on a job that
  // may carry no route (the sweep could never settle it), and its caller's
  // settle fails as any settle does while the database cannot be read. A
  // routed job's own retry mark is written with its completion, by the
  // database, so the sweep still finds it.
  let job: Record<string, unknown> | null = null
  let jobError: { message: string } | null = null
  for (let attempt = 0; attempt < ROUTED_JOB_READ_ATTEMPTS; attempt++) {
    const read = await supabase.from("jobs")
      .select(`status, usage_log_id, input_data->${VIDEO_ROUTE_STAMP_KEY}, run:metadata->videoRouteRun`).eq("id", args.jobId).maybeSingle()
    jobError = read.error
    job = read.data as Record<string, unknown> | null
    if (!jobError) break
  }
  if (jobError) throw new Error(`job ${args.jobId}: reading its routing decision failed: ${jobError.message}`)
  if (!job) throw new Error("Cannot verify the owner of a missing routed job")
  const row = job as { status?: unknown; usage_log_id?: unknown; run?: unknown }
  const raw = (job as Record<string, unknown> | null)?.[VIDEO_ROUTE_STAMP_KEY]
  // Another environment's job (staging and production share one database) is refused BEFORE
  // anything is read from or written to the ledger for it: its decision, or its run's token.
  if (typeof raw === "object" && raw && "env" in raw && raw.env !== getRuntimeEnv()) throw new Error(FOREIGN_ROUTED_RESERVATION)
  if (row?.run && foreignRowlessRouteToken((row.run as { token?: unknown }).token)) throw new Error(FOREIGN_ROUTED_RESERVATION)
  if (row?.run) {
    const saved = savedRoutedRunSchema.parse(row.run)
    if (saved.usageLogId !== args.usageLogId) return retry("The routed run has a different reservation")
    await settleRoutedRunJob(args.usageLogId, args.jobId, saved.token)
    return true
  }
  if (raw === undefined || raw === null) return false
  const stamp = videoRouteStampOf({ [VIDEO_ROUTE_STAMP_KEY]: raw }, args.jobId)
  if (!stamp) return retry("The stored routing decision could not be verified")
  if (row?.status !== "completed" || row.usage_log_id !== args.usageLogId || args.log.job_id !== args.jobId) return retry("Could not verify its delivered result and reservation")
  if (!settings || settingsReadFailed(settings)) return retry("the settings could not be read to price its settlement")
  // (Reached with no policy row only through the reservation's own routed mark.)
  if (!settings.video_route_policy) console.error(`[ALERT] job ${args.jobId}: a routed ${stamp.model} job is settling with no routing policy saved in this environment; it is settled on the route that ran it.`)

  let ledger: RouteLedger
  try {
    ledger = await readRouteLedger(args.jobId)
    // Before anything is charged: a send that started and was never read to its end, or a
    // delivered one with no bill yet, is read from the route once more (lib/video-route-resolve.ts).
    if ((ledger.unresolvedStarts ?? []).length > 0 || ledger.tasks.some((t) => deliveredTask(t) && t.billedUsd === null)) {
      if ((await resolveRouteLedger(args.jobId, stamp.routeId)).resolved > 0) ledger = await readRouteLedger(args.jobId)
    }
  } catch (err) {
    return retry(err instanceof Error ? err.message : String(err))
  }
  const held = args.log.credits_used ?? 0
  const jobQuoteUsd = stamp.quotedUsd * stamp.factor
  // An admin released it (a bill held, or one the route never reported): the hold goes back, whatever the ledger says.
  if (ledger.settle?.decision === "rejected") {
    // The loss recorded is the one loss rule over every send (nothing is charged): the route's
    // bill of each, the quote of one it has not billed yet. A replay computes the same figure.
    await releaseRejectedCharge(args.usageLogId, args.jobId, routeLossOf(ledger, "nothing", jobQuoteUsd), { knownUsd: ledgerBilledUsd(ledger) })
    return true
  }
  const charge = routedChargeOf(stamp, args.log, ledger, settings)
  if (charge.kind === "pending") return deferRoutedSettlement(args.jobId, charge.reason, charge.cause)
  // A delivered send whose clip the person did not receive (a later send replaced it after a step
  // of ours failed) is never charged: its bill is recorded as our loss, once, with an alert.
  for (const lost of charge.ownLoss) {
    if (ledger.tasks.find((t) => t.send === lost.send)?.ownLoss) continue
    const marked = await markRouteTaskOwnLoss(args.jobId, lost.send)
    const message = `Send ${lost.send} of a routed ${stamp.model} run was delivered by the route and replaced after a step of ours failed; its bill is not charged (our loss${lost.billedUsd === null ? ", amount not reported yet" : ""}).${marked ? "" : " It could NOT be marked on the ledger: the daily reconciliation will count its bill as collected until it is."}`
    console.error(`[ALERT] job ${args.jobId}: ${message}`)
    await recordVideoRouteAlert({ key: `own-loss:${args.jobId}:${lost.send}`, kind: "settlement", jobId: args.jobId, model: stamp.model, message })
  }
  const quotedUsd = stamp.quotedUsd * stamp.factor * charge.taskCount
  if (charge.chargedCredits > held || charge.costUsd > quotedUsd) {
    const message = `video route price went up: ${stamp.model} cost ${charge.chargedCredits} credits against a hold of ${held}.`
    console.error(`[ALERT] job ${args.jobId}: ${message}`)
    await recordVideoRouteAlert({ key: `price:${args.jobId}`, kind: "price-increase", jobId: args.jobId, model: stamp.model, factorKey: stamp.factorKey, message })
  }
  // The total about to be charged against the quote the charged send was held at.
  const outcome = await commitRoutedCharge(args.usageLogId, args.jobId, charge.chargedCredits, {
    billedUsd: charge.costUsd,
    quotedUsd,
    policy: settings.video_route_policy,
    model: stamp.model,
    unbilledSends: charge.usedQuote,
    releaseLoss: routeLossOf(ledger, "nothing", jobQuoteUsd),
    knownUsd: ledgerBilledUsd(ledger),
  })
  // A bill an admin rejected moves no price.
  if (outcome === "released") return true
  // The sends that are not charged (replaced after a step of ours failed, or given up on and billed
  // since): their loss, by the one rule, recorded beside the charge; while one may still be billed
  // the route is read for it afterwards.
  const notCharged = routeLossOf(ledger, "delivered", jobQuoteUsd)
  if (notCharged.usd > 0) await patchSettleOrAlert(args.jobId, "The loss of its sends that were not charged", { loss: { credits: notCharged.credits, usd: notCharged.usd } })
  if (notCharged.unbilled && !charge.usedQuote) await watchForLateBill(args.jobId, LATE_BILL_READ_MS.closed, { knownUsd: ledgerBilledUsd(ledger) })
  // A send charged at its quote by an admin says nothing about the route's price.
  if (charge.usedQuote) return true
  await raiseFactorFrom(stamp, charge.costUsd / (stamp.quotedUsd * charge.taskCount), `job ${args.jobId} billed ${(charge.costUsd / (stamp.quotedUsd * charge.taskCount)).toFixed(3)}x its quote`)
  return true
}

/**
 * Raises the stamp's correction factor toward `observedRatio` (only up, one
 * capped step), with an alert on every change. Best effort: a failed write is
 * logged, never thrown.
 */
export async function raiseFactorFrom(stamp: Pick<VideoRouteStamp, "factorKey" | "model"> & { factor?: number }, observedRatio: number, reason: string): Promise<void> {
  if (!Number.isFinite(observedRatio) || observedRatio <= 1) return
  try {
    const written = await updateVideoRoutePriceFactor(stamp.factorKey, (current) => {
      const before = priceFactorOf(current ? { k: current } : {}, "k")
      const next = Math.min(raisedPriceFactor(before, observedRatio), raisedPriceFactor(stamp.factor ?? before, observedRatio))
      if (next <= before) return null
      return { factor: next, updatedAt: new Date().toISOString(), by: "auto", reason: reason.slice(0, 500) }
    })
    if (written) console.error(`[ALERT] video route: the price factor of ${stamp.factorKey} rose to ${written.factor} (${reason}). New quotes and listed prices for it follow.`)
    else if (observedRatio > PRICE_FACTOR_MAX_AUTO) console.error(`[ALERT] video route: ${stamp.factorKey} needs a factor of ${observedRatio.toFixed(3)} (${reason}), above the automatic ceiling ${PRICE_FACTOR_MAX_AUTO}; an admin decides.`)
  } catch (err) {
    console.error(`[video-route] raising the price factor of ${stamp.factorKey} failed: ${err instanceof Error ? err.message : String(err)}`)
  }
}

/** How long a settlement marked `retry` is left to its own worker before the sweep takes it. */
export const ROUTED_SETTLE_RETRY_MIN_AGE_MS = 10 * 60_000
/** Past this a settlement still marked `retry` is alerted on every sweep (it does not go quiet). */
export const ROUTED_SETTLE_SWEEP_HOURS = 48

/**
 * Settles again each routed job of this environment whose settlement is marked
 * `retry` on its ledger (a settle that could not read what it settles from,
 * a metered settle with no receipt, or a completion that crashed before its
 * settle) and is at least {@link ROUTED_SETTLE_RETRY_MIN_AGE_MS} old — never
 * one its own worker is settling right now — through the one entry. A
 * deferred child is never settled here (its parent settles or releases it),
 * nor a job that is not completed. The {@link ROUTED_SETTLE_SWEEP_HOURS} clock
 * runs from the first settle the sweep really ATTEMPTED on the terminal job
 * and that stayed open (kept on the row), not from when its row was created
 * and not from a pass that found the job still in flight: a run's row is
 * written when it is held, long before it completes. Past it one still open
 * is alerted loudly every run; a run still in flight never is.
 * Then {@link readLateBills} reads the route for bills that arrive late.
 * Idempotent: the commit is a compare-and-set on the log's `reserved` status.
 * Never throws.
 */
export async function retryRoutedSettlements(now = Date.now()): Promise<{ scanned: number; settled: number; failed: number; stale: number }> {
  const out = { scanned: 0, settled: 0, failed: 0, stale: 0 }
  try {
    const before = new Date(now - ROUTED_SETTLE_RETRY_MIN_AGE_MS).toISOString()
    const ledgerTable = supabase.from("video_route_ledger" as "assets") as unknown as {
      select(cols: string): { eq(c: string, v: unknown): any }
    }
    let cursor = 0
    while (true) {
      const { data, error } = await ledgerTable.select("id, job_id, created_at, attempts, next_attempt_at, detail")
        .eq("env", getRuntimeEnv()).eq("kind", "settle").eq("state", "retry")
        .lte("created_at", before).gt("id", cursor).order("id", { ascending: true }).limit(500)
      if (error) throw new Error(error.message)
      const rows = (data ?? []) as SweepRow[]
      for (const row of rows) {
        // Waiting out its backoff (a route that has not reported a bill yet is not asked every pass).
        if (row.next_attempt_at && Date.parse(row.next_attempt_at) > now) continue
        out.scanned++
        // The 48 h run from the first settle that was really attempted (kept on the row), so a row
        // whose job is still in flight has no clock yet: it is not "past", and nothing alerts.
        const since = firstAttemptAt(row)
        const past = since !== null && now - since > ROUTED_SETTLE_SWEEP_HOURS * 3_600_000
        // A settle attempted on a terminal job that stays open: its clock starts now (once), and past
        // the 48 h it is alerted on every pass. A run still in flight has no clock.
        const stayedOpen = async (why?: string) => {
          if (since === null) await patchSettleOrAlert(row.job_id, "When its open settlement was first attempted", { firstAttemptAt: new Date(now).toISOString() })
          if (past) {
            out.stale++
            const message = `Its routed settlement has been open for more than ${ROUTED_SETTLE_SWEEP_HOURS} h${why ? ` (${why})` : ""}.`
            console.error(`[ALERT] job ${row.job_id}: ${message}`)
            await recordVideoRouteAlert({ key: `stale:${row.job_id}`, kind: "settlement", jobId: row.job_id, message }).catch(() => {})
          }
        }
        try {
          const outcome = await recoverRoutedSettlementOutcome(row.job_id)
          if (outcome === "settled") out.settled++
          // A terminal deferred child its parent has not settled or released: open like any other,
          // never silent (its parent's own settlement is what closes it).
          else if (outcome === "parent-settles") await stayedOpen("a held child its parent has not settled or released")
        } catch (err) {
          // Held for an admin by this very attempt: that is its outcome, not a failure.
          if (err instanceof RoutedSettleHeld) continue
          await stayedOpen()
          try {
            // The route has not reported a bill, or how a started send ended. The settle above
            // already read the route once more; this is the bounded wait around that read.
            if (err instanceof RoutedSettleUnbilled) {
              if (await awaitRouteBill(row, past, now)) out.settled++
              continue
            }
            // A completed run with nothing delivered on its ledger can never be charged: past the
            // wait its hold goes back (never an eternal retry), with an alert.
            if (err instanceof RoutedSettleNothingDelivered && past) {
              if (await releaseUndelivered(row.job_id)) out.settled++
              continue
            }
          } catch (inner) {
            out.failed++
            console.error(`[video-route] job ${row.job_id}: closing its open settlement failed: ${inner instanceof Error ? inner.message : String(inner)}`)
            continue
          }
          out.failed++
          const message = err instanceof Error ? err.message : String(err)
          console.error(`[video-route] job ${row.job_id}: routed settlement retry failed: ${message}`)
          await recordVideoRouteAlert({ key: `settlement:${row.job_id}`, kind: "settlement", jobId: row.job_id, message }).catch(() => {})
        }
      }
      if (rows.length < 500) break
      cursor = rows[rows.length - 1]!.id
    }
    await readLateBills(now)
    await retryDeferredRepayments()
  } catch (err) {
    console.error(`[video-route] the routed settlement sweep failed: ${err instanceof Error ? err.message : String(err)}`)
  }
  return out
}

interface SweepRow { id: number; job_id: string; created_at: string; attempts?: number | null; next_attempt_at?: string | null; detail?: unknown }

/** When the sweep first really attempted this settlement (written when a settle of the terminal job stayed open): what its 48 h run from. Null: not yet. */
function firstAttemptAt(row: SweepRow): number | null {
  const kept = row.detail && typeof row.detail === "object" ? (row.detail as { firstAttemptAt?: unknown }).firstAttemptAt : undefined
  const at = typeof kept === "string" ? Date.parse(kept) : NaN
  return Number.isFinite(at) ? at : null
}

/** The wait between re-reads of a bill the route has not reported: 15 minutes, doubling, at most 6 hours. */
export function routeBillBackoffMs(attempts: number): number {
  return Math.min(15 * 60_000 * 2 ** Math.max(0, Math.min(attempts, 10)), 6 * 3_600_000)
}

/**
 * A settlement still waiting on the route after this pass's re-read. Inside
 * {@link ROUTED_SETTLE_SWEEP_HOURS}: the next re-read is scheduled, with
 * backoff. Past it: every start still unread is recorded `unresolved` (a loss
 * candidate), the settle is tried once more with what is known, and a run
 * that still has a delivered send with no bill moves to `unbilled`, where it
 * waits for an admin (settle at its quote, or release) under the daily
 * reminder, with one alert, and is still read for its bill every six hours.
 * True when the last try settled it.
 */
async function awaitRouteBill(row: SweepRow, past: boolean, now: number): Promise<boolean> {
  const attempts = (row.attempts ?? 0) + 1
  if (!past) {
    await noteRouteSettleAttempt(row.job_id, attempts, new Date(now + routeBillBackoffMs(attempts - 1)))
    return false
  }
  const closed = await closeUnresolvedStarts(row.job_id)
  if (closed.length > 0) {
    const message = `${closed.length} started send(s) could not be read to an end in ${ROUTED_SETTLE_SWEEP_HOURS} h and are recorded as unresolved: not charged, and listed as possible losses.`
    console.error(`[ALERT] job ${row.job_id}: ${message}`)
    await recordVideoRouteAlert({ key: `unresolved:${row.job_id}`, kind: "settlement", jobId: row.job_id, message }).catch(() => {})
  }
  try {
    return await recoverRoutedSettlement(row.job_id)
  } catch (err) {
    if (!(err instanceof RoutedSettleUnbilled)) throw err
    // What it would be charged at its quote: shown in Admin, and the loss recorded if it is released.
    const best = await previewRoutedSettlement(row.job_id).catch(() => null)
    const note = `the route reported no bill in ${ROUTED_SETTLE_SWEEP_HOURS} h; it waits for an admin to settle it at its quote or release it`
    if (await markRouteSettleUnbilled(row.job_id, { credits: best?.credits ?? null, quotedUsd: best?.quotedUsd ?? null, note, nextAttemptAt: new Date(now + LATE_BILL_READ_MS.unbilled) })) {
      await watchForLateBill(row.job_id, LATE_BILL_READ_MS.unbilled, { knownUsd: best?.ledgerBilledUsd ?? null, now })
      const message = `A routed run's settlement is unbilled: ${note}.`
      console.error(`[ALERT] video route: job ${row.job_id}: ${message}`)
      await recordVideoRouteAlert({ key: `unbilled:${row.job_id}`, kind: "anomaly", jobId: row.job_id, message }).catch(() => {})
    }
    return false
  }
}

/**
 * A completed run with no delivered send after the wait: its hold is released,
 * with an alert. The loss recorded is the one loss rule over every send
 * ({@link routeLossOf}): the route's bill of a send given up on whose bill
 * arrived, nothing for one the route ended or that may never have been billed
 * — never the hold with our own fee. While a send of it may still be billed
 * the route is read for that bill afterwards. True when released.
 */
async function releaseUndelivered(jobId: string): Promise<boolean> {
  // trash-read: a terminal job's reservation is released even after trashing.
  const { data: job, error } = await supabase.from("jobs").select(`usage_log_id, stamp:input_data->${VIDEO_ROUTE_STAMP_KEY}`).eq("id", jobId).maybeSingle()
  if (error || !job?.usage_log_id) throw new Error(error?.message ?? "No reservation to release")
  const ledger = await readRouteLedger(jobId)
  const loss = routeLossOf(ledger, "nothing", jobQuoteUsdOf(jobId, (job as { stamp?: unknown }).stamp))
  await releaseRejectedCharge(job.usage_log_id, jobId, loss, {
    note: `no delivered routed send was recorded in ${ROUTED_SETTLE_SWEEP_HOURS} h; hold released, nothing charged${loss.usd > 0 || loss.unbilled ? " (the route's bills for its sends are recorded as the loss)" : ""}`,
    knownUsd: ledgerBilledUsd(ledger),
  })
  const message = `A completed routed run has no delivered send on its ledger after ${ROUTED_SETTLE_SWEEP_HOURS} h; its hold was released and nothing was charged; ${loss.credits} credits of the route's bills for it are recorded as a loss.${loss.unbilled ? " A send of it may still be billed: the route is still read for its bill." : ""}`
  console.error(`[ALERT] job ${jobId}: ${message}`)
  await recordVideoRouteAlert({ key: `undelivered:${jobId}`, kind: "settlement", jobId, message }).catch(() => {})
  return true
}

/** A job's own send's quote (its decision's quote times its factor), the best known figure of one the route has not billed; 0 with no decision (a run's segments carry their own). */
function jobQuoteUsdOf(jobId: string, stampRaw: unknown): number {
  const stamp = stampRaw ? videoRouteStampOf({ [VIDEO_ROUTE_STAMP_KEY]: stampRaw }, jobId) : undefined
  return stamp ? stamp.quotedUsd * stamp.factor : 0
}

/** What a settlement would charge with every unbilled send at its quote, and what that is measured against. */
export interface RoutedSettlementPreview {
  /** The charge in credits: real bills of billed sends, the quote of the rest. Null when it cannot be computed yet. */
  readonly credits: number | null
  readonly billedUsd: number | null
  readonly quotedUsd: number | null
  /** Whether a send in it has no bill (charged at its quote). */
  readonly usedQuote: boolean
  /** Whether that total is far enough above the quote to be held for its own confirmation. */
  readonly anomalous: boolean
  readonly routeId: string | undefined
  /** Every verified bill on its ledger, summed (USD; `ledgerBilledUsd`); null when the ledger could not be read. */
  readonly ledgerBilledUsd?: number | null
  /** Whether a send or segment of it may still be billed (the route is still worth reading). */
  readonly mayStillBill?: boolean
  /** The loss a release would record now: the one loss rule over every send (`routeLossOf`, nothing charged). */
  readonly loss?: RouteLoss | null
  /** The loss of the sends NOT charged when the delivered output is: replaced sends, and given-up ones billed since. */
  readonly chargedLoss?: RouteLoss | null
}

/**
 * What settling this job would charge RIGHT NOW with every unbilled send at
 * its quote: the figure Admin shows before a decision and what a late bill is
 * measured against — and, beside it, what a release records as the loss (the
 * one loss rule). Charges nothing.
 */
export async function previewRoutedSettlement(jobId: string): Promise<RoutedSettlementPreview> {
  const none: RoutedSettlementPreview = { credits: null, billedUsd: null, quotedUsd: null, usedQuote: false, anomalous: false, routeId: undefined, ledgerBilledUsd: null, mayStillBill: false, loss: null, chargedLoss: null }
  // trash-read: a settlement reads its job whatever became of it.
  const { data: job, error } = await supabase.from("jobs")
    .select(`usage_log_id, run:metadata->videoRouteRun, stamp:input_data->${VIDEO_ROUTE_STAMP_KEY}`).eq("id", jobId).maybeSingle()
  if (error || !job) return none
  const j = job as { usage_log_id?: string | null; run?: unknown; stamp?: unknown }
  const routeId = routeIdOfJob(jobId, j.stamp, j.run)
  const settings = await getAppSettings()
  if (settingsReadFailed(settings)) return { ...none, routeId }
  const ledger = await readRouteLedger(jobId)
  const jobQuoteUsd = jobQuoteUsdOf(jobId, j.stamp)
  // What the ledger itself says, whatever the charge comes to.
  const facts = {
    routeId,
    ledgerBilledUsd: ledgerBilledUsd(ledger),
    mayStillBill: ledgerMayStillBill(ledger),
    loss: routeLossOf(ledger, "nothing", jobQuoteUsd),
    chargedLoss: routeLossOf(ledger, "delivered", jobQuoteUsd),
  }
  const multiple = billAnomalyMultipleOf(settings.video_route_policy)
  if (j.run) {
    const saved = savedRoutedRunSchema.safeParse(j.run).data
    const run = saved ? rowlessRunTokenFor(saved.token, jobId, 0) : undefined
    if (!saved || !run) return { ...none, routeId }
    const charge = routedRunChargeOf(run, boundRunOptions(run, saved.opts ?? {}), ledger, settings, true)
    if (charge.kind !== "billed") return { ...none, ...facts }
    return { credits: charge.charged, billedUsd: charge.billedUsd, quotedUsd: charge.quotedUsd, usedQuote: charge.usedQuote, anomalous: routeBillAnomalous(charge.billedUsd, charge.quotedUsd, multiple), ...facts }
  }
  const stamp = j.stamp ? videoRouteStampOf({ [VIDEO_ROUTE_STAMP_KEY]: j.stamp }, jobId) : undefined
  if (!stamp) return { ...none, routeId }
  const charge = routedChargeOf(stamp, { action: stamp.priceId, credits_used: null, job_id: jobId }, ledger, settings, { atQuote: true })
  if (charge.kind !== "billed") return { ...none, ...facts }
  const quotedUsd = stamp.quotedUsd * stamp.factor * charge.taskCount
  return { credits: charge.chargedCredits, billedUsd: charge.costUsd, quotedUsd, usedQuote: charge.usedQuote, anomalous: routeBillAnomalous(charge.costUsd, quotedUsd, multiple), ...facts }
}

const sameUsd = (a: number, b: number): boolean => Math.abs(a - b) < 1e-6
const numberOf = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null)

/**
 * The late-bill pass. A settlement that closed over a send the route had not
 * billed (settled at its quote, released, ended undelivered, or waiting
 * `unbilled`) is read from the route again on its slow cadence until its
 * watch ends — while ANY of its sends may still be billed, a replaced or
 * given-up one included, not only the charged one. Each read compares what
 * the ledger now holds with the figure last RECORDED on the settlement
 * (`detail.knownUsd`, the verified bills its figures were taken from), never
 * with "what this read fetched": a bill fetched by any other read (the sweep,
 * an admin's look, a read whose record failed) is found on the next pass.
 *   - `unbilled`, and every charged send has its bill now: it goes back to the
 *     settlement, where it is charged or held like any bill;
 *   - settled or released, and the bills changed: what the run is now known to
 *     cost against what was charged (`uncollected`, `detail.lateBill`), and the
 *     loss of what was not charged (the one loss rule, corrected down as well
 *     as up), are RECORDED in one write that also moves the recorded figure,
 *     and alerted. Nothing more is ever charged from here. A record that
 *     cannot be computed or written changes nothing: the next pass finds the
 *     same difference again.
 * Never throws.
 */
export async function readLateBills(now = Date.now()): Promise<{ read: number; arrived: number }> {
  const out = { read: 0, arrived: 0 }
  let watches: LateBillWatch[]
  try {
    watches = await readLateBillWatches(new Date(now))
  } catch (err) {
    console.error(`[video-route] the late-bill pass could not read its watches: ${err instanceof Error ? err.message : String(err)}`)
    return out
  }
  for (const watch of watches) {
    try {
      out.read++
      const before = await previewRoutedSettlement(watch.jobId)
      if (before.routeId) await resolveRouteLedger(watch.jobId, before.routeId)
      const after = await previewRoutedSettlement(watch.jobId)
      const until = typeof watch.detail.watchUntil === "string" ? Date.parse(watch.detail.watchUntil) : NaN
      const cadence = watch.state === "unbilled" ? LATE_BILL_READ_MS.unbilled : LATE_BILL_READ_MS.closed
      const later = new Date(now + cadence).toISOString()
      const billedNow = after.ledgerBilledUsd ?? null
      // The ledger could not be read just now (a settings or job read that failed): nothing is decided on a guess; read again (while the watch lasts).
      if (billedNow === null) {
        await patchSettleOrAlert(watch.jobId, "The next late-bill read", {}, { next_attempt_at: Number.isFinite(until) && now < until ? new Date(now + LATE_BILL_READ_MS.unbilled).toISOString() : null })
        continue
      }
      // Read again while any send may still be billed and the watch has time left. Otherwise stop.
      const again = after.mayStillBill === true && Number.isFinite(until) && now < until
      const nextAt = again ? later : null
      if (watch.state === "unbilled") {
        // By what the ledger holds NOW: every charged send has its bill. Back to the settlement.
        if (after.credits !== null && !after.usedQuote) {
          if (await reopenUnbilledSettle(watch.jobId)) out.arrived++
          continue
        }
        // Still waiting: the figures Admin shows are refreshed, on a row still waiting.
        await patchRouteSettle(watch.jobId, {}, { next_attempt_at: Number.isFinite(until) && now < until ? later : null, ...(after.credits !== null ? { credits: after.credits, quoted_usd: after.quotedUsd } : {}) }, { onlyStates: ["unbilled"] })
        continue
      }
      const recordedUsd = numberOf(watch.detail.knownUsd)
      if (recordedUsd !== null && sameUsd(recordedUsd, billedNow)) {
        await patchSettleOrAlert(watch.jobId, "The next late-bill read", {}, { next_attempt_at: nextAt })
        continue
      }
      // The bills changed since the figures were recorded (or none was kept: a settlement watched
      // before the figure was): what it is now known to cost, against what was taken.
      const nothingCharged = watch.state === "waived" || (watch.credits ?? 0) === 0
      const loss = (nothingCharged ? after.loss : after.chargedLoss) ?? null
      const taken = nothingCharged ? 0 : (watch.credits ?? 0)
      const known = nothingCharged ? null : after.credits
      // A charged run whose total cannot be computed just now: not recorded on a guess; the next pass finds the same change.
      if (loss === null || (!nothingCharged && known === null)) {
        await patchSettleOrAlert(watch.jobId, "The next late-bill read", {}, { next_attempt_at: later })
        continue
      }
      const difference = known === null ? 0 : Math.max(0, known - taken)
      // `uncollected`: the charge not collected (a charged run), or the loss (nothing charged) —
      // the figure as it now stands, down as well as up. A shortfall's is its unpaid charge, kept by the database.
      const uncollected = nothingCharged ? loss.credits : difference
      const lateBill = { at: new Date(now).toISOString(), billedUsd: billedNow, knownCredits: known ?? loss.credits, chargedCredits: taken, differenceCredits: difference, lossCredits: loss.credits, lossUsd: loss.usd }
      const before_ = { uncollected: watch.uncollected ?? 0, loss: numberOf((watch.detail.lateBill as Record<string, unknown> | undefined)?.lossCredits) ?? numberOf((watch.detail.loss as Record<string, unknown> | undefined)?.credits) ?? (nothingCharged ? (watch.uncollected ?? 0) : 0) }
      const recorded = await patchSettleOrAlert(watch.jobId, "A late bill", { lateBill, knownUsd: billedNow, loss: { credits: loss.credits, usd: loss.usd } }, { next_attempt_at: nextAt, ...(watch.state === "shortfall" ? {} : { uncollected }) })
      if (!recorded) continue
      out.arrived++
      // A settlement watched before the figure was kept, whose money figures did not move: nothing to alert.
      if (recordedUsd === null && before_.uncollected === uncollected && before_.loss === loss.credits) continue
      const message = nothingCharged
        ? `A bill arrived for a routed run that was not charged (released or undelivered): the route's bills for it now come to ${loss.credits} credits (${loss.usd.toFixed(4)} USD), recorded as the loss (it was ${before_.uncollected}).`
        : `A bill arrived after a routed run was settled: it is now known to cost ${known} credits against ${taken} charged; ${difference} credits are recorded as uncollected${loss.credits > 0 ? `, and ${loss.credits} credits of sends not charged as a loss` : ""}. Nothing more was charged.`
      console.error(`[ALERT] video route: job ${watch.jobId}: ${message}`)
      await recordVideoRouteAlert({ key: `late-bill:${watch.jobId}`, kind: "anomaly", jobId: watch.jobId, message }).catch(() => {})
    } catch (err) {
      console.error(`[video-route] job ${watch.jobId}: reading its late bill failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  return out
}

/**
 * Applies the repayments that could not take their locks when the funding
 * arrived (the database notes them instead of failing the funding). Only where
 * unpaid charges are enforced: elsewhere nothing is ever noted, and nothing is
 * called. Never throws.
 */
export async function retryDeferredRepayments(): Promise<void> {
  try {
    const settings = await getAppSettings()
    if (settingsReadFailed(settings) || !unpaidChargesEnforced(settings.video_route_policy)) return
    const { data, error } = await (supabase as unknown as { rpc(name: string): Promise<{ data: unknown; error: { message: string } | null }> }).rpc("retry_deferred_video_repayments")
    if (error) {
      console.error(`[video-route] retrying deferred repayments failed: ${error.message}`)
      return
    }
    // The answer: notes applied, what they collected, notes with nothing left to repay,
    // tries that failed in this call, and notes left for an admin (the daily report raises those).
    const answer = (data && typeof data === "object" ? data : {}) as Record<string, unknown>
    const count = (key: string): number => (typeof answer[key] === "number" ? (answer[key] as number) : 0)
    const [applied, collected, failed, stuck] = [count("applied"), count("credits"), count("failed"), count("stuck")]
    if (applied > 0) console.info(`[video-route] ${applied} deferred repayment(s) applied (${collected} collected)`)
    if (failed > 0 || stuck > 0) console.warn(`[video-route] deferred repayments: ${failed} could not be applied in this pass, ${stuck} are left for an admin`)
  } catch (err) {
    console.error(`[video-route] retrying deferred repayments failed: ${err instanceof Error ? err.message : String(err)}`)
  }
}

/** The route a routed job or run was admitted on, from its stored decision or run token; undefined when neither reads. */
function routeIdOfJob(jobId: string, stampRaw: unknown, run: unknown): string | undefined {
  const stamp = stampRaw && typeof stampRaw === "object" ? (stampRaw as { routeId?: unknown }).routeId : undefined
  if (typeof stamp === "string" && stamp) return stamp
  const token = run && typeof run === "object" ? (run as { token?: unknown }).token : undefined
  return typeof token === "string" ? rowlessRunTokenFor(token, jobId, 0)?.routeId : undefined
}

/**
 * Settles (or releases) a terminal routed job through the one entry. True when
 * it is settled. False when it is not this call's to settle: a job still in
 * flight, or a held child whose parent settles or releases it
 * ({@link recoverRoutedSettlementOutcome} says which).
 */
export async function recoverRoutedSettlement(jobId: string): Promise<boolean> {
  return (await recoverRoutedSettlementOutcome(jobId)) === "settled"
}

/**
 * {@link recoverRoutedSettlement}, saying what it did: `settled`, `in-flight`
 * (the job is not terminal yet: nothing to settle, no clock), or
 * `parent-settles` (a terminal held child, settled or released by its
 * parent's own settlement — the sweep keeps its 48 h clock and alert, so a
 * parent that never does is not silent).
 */
export async function recoverRoutedSettlementOutcome(jobId: string): Promise<"settled" | "in-flight" | "parent-settles"> {
  // trash-read: a terminal job's reservation needs its receipt even after trashing.
  const { data: job, error } = await supabase.from("jobs")
    .select(`status, usage_log_id, parent_job_id, defer:input_data->${DEFER_SETTLEMENT_INPUT_KEY}, run:metadata->videoRouteRun, stamp:input_data->${VIDEO_ROUTE_STAMP_KEY}`).eq("id", jobId).maybeSingle()
  if (error || !job) throw new Error(error?.message ?? "No job for routed reservation")
  const j = job
  // Another environment's job is never released, recorded or charged from here.
  const stampEnv = (j as { stamp?: unknown }).stamp && typeof (j as { stamp?: unknown }).stamp === "object" ? ((j as { stamp: { env?: unknown } }).stamp.env) : undefined
  if ((typeof stampEnv === "string" && stampEnv !== getRuntimeEnv()) || foreignRowlessRouteToken((j.run as { token?: unknown } | null)?.token)) throw new Error(FOREIGN_ROUTED_RESERVATION)
  const failed = j.status === "failed" || j.status === "cancelled"
  const terminal = failed || j.status === "completed"
  if (j.parent_job_id && j.defer === true) return terminal ? "parent-settles" : "in-flight"
  if (!terminal) return "in-flight"
  if (!j.usage_log_id) throw new Error("Terminal routed job has no reservation")
  const { data: log, error: logError } = await supabase.from("usage_logs")
    .select("action, credits_used, credits_charged, job_id, status, receipt:metadata->videoRouteReceipt, mode:metadata->>reservation_mode, mark:metadata->video_route").eq("id", j.usage_log_id).maybeSingle()
  if (logError || !log || log.job_id !== jobId) throw new Error(logError?.message ?? "Routed job has no matching reservation")
  // The reservation's own routed mark, as the worker's settle reads it: it settles here whatever this process sees of the policy row.
  const routed = (log as { mode?: unknown }).mode === "video-route" || (log as { mark?: unknown }).mark === true
  if (failed) {
    // Before the hold is released: every send that started is read to its end once more, and
    // what still cannot be read is recorded `unresolved`. Nothing is charged for an undelivered
    // job either way; what the route billed stays on the ledger, where the daily report finds it.
    const routeId = routeIdOfJob(jobId, (j as { stamp?: unknown }).stamp, j.run)
    if (routeId) await resolveRouteLedger(jobId, routeId)
    const unread = await closeUnresolvedStarts(jobId)
    if (unread.length > 0) {
      const message = `${unread.length} started send(s) of an undelivered run could not be read to an end and are recorded as unresolved (possible losses).`
      console.error(`[ALERT] job ${jobId}: ${message}`)
      await recordVideoRouteAlert({ key: `unresolved:${jobId}`, kind: "settlement", jobId, message }).catch(() => {})
    }
    if (log.status === "reserved") {
      await CreditsService.refundCredits(j.usage_log_id)
      const check = await supabase.from("usage_logs").select("status").eq("id", j.usage_log_id).maybeSingle()
      if (check.error || check.data?.status !== "refunded") throw new Error("Routed refund has no receipt")
    } else if (log.status !== "refunded") throw new Error("Undelivered routed job with an unconfirmed refund")
    // What the route billed for the run before it ended undelivered is OUR loss, by the one loss
    // rule (the route's bills, the quote of a delivered send not billed yet; never our own fee):
    // recorded on the settlement, alerted once per run, and the route is read afterwards while a
    // send of it may still be billed (one in flight when it ended, or given up on).
    const lost = await previewRoutedSettlement(jobId).catch(() => null)
    const loss = lost?.loss ?? null
    const credits = loss?.credits ?? 0
    // A loss that could not be computed just now (a read that failed) is watched too: the late-bill
    // pass records it once it can. One that can never be computed (a decision that does not verify) is not.
    const watch = unread.length > 0 || loss?.unbilled === true || (loss === null && (lost === null || lost.routeId !== undefined))
    await recordRouteSettle(jobId, "done", { credits: 0, ...(credits > 0 ? { uncollected: credits } : {}), note: credits > 0 || watch ? "undelivered; refunded; the route's bills for it are our loss" : "undelivered; refunded" })
    if (loss && loss.usd > 0) await patchSettleOrAlert(jobId, "The loss of an undelivered run", { loss: { credits: loss.credits, usd: loss.usd } })
    if (credits > 0 || watch) {
      if (watch) await watchForLateBill(jobId, LATE_BILL_READ_MS.closed, { knownUsd: lost?.ledgerBilledUsd ?? null })
      const message = `A routed run ended ${String(j.status)} after the route had worked on it: nothing was charged, ${credits} credits of the route's bills for its sends are recorded as our loss${watch ? ", and the route is still read for a bill that has not come" : ""}.`
      console.error(`[ALERT] job ${jobId}: ${message}`)
      await recordVideoRouteAlert({ key: `undelivered-loss:${jobId}`, kind: "settlement", jobId, message }).catch(() => {})
    }
    return "settled"
  }
  if (log.status === "committed") {
    const r = log.receipt as { charged?: number; collected_over_hold?: number; shortfall?: number } | null
    if (!r || !Number.isSafeInteger(r.charged) || (r.shortfall === 0 && r.charged !== log.credits_charged) || !Number.isSafeInteger(r.collected_over_hold) || !Number.isSafeInteger(r.shortfall)) {
      throw new Error("Committed routed reservation has no confirmed metered receipt")
    }
    await finishRoutedReceipt(j.usage_log_id, jobId, { charged: r.charged!, collectedOverHold: r.collected_over_hold!, shortfall: r.shortfall! })
    // A charge whose record was finished here (its first settle stopped after the commit) never
    // started its late-bill watch: while a send of it may still be billed, the route is read for it.
    // (No figure is kept from that first settle: the first read records what the ledger shows then.)
    if (ledgerMayStillBill(await readRouteLedger(jobId))) await watchForLateBill(jobId, LATE_BILL_READ_MS.closed)
    return "settled"
  }
  // A rejected bill whose release landed before its record: the one settlement finishes the record.
  if (log.status === "refunded" ? (await readRouteLedger(jobId)).settle?.decision !== "rejected" : log.status !== "reserved") {
    throw new Error("Delivered routed job has no open reservation or metered receipt")
  }
  if (j.run) {
    await settleRoutedRunJob(j.usage_log_id, jobId, savedRoutedRunSchema.parse(j.run).token)
    return "settled"
  }
  if (await settleRoutedJob({ jobId, usageLogId: j.usage_log_id, log: { ...log, routed } })) return "settled"
  throw new Error("The routed reservation has no verifiable decision")
}

/**
 * What {@link settleRoutedJob} will charge this job, without charging — the
 * figure a held (deferred) child shows — by the same {@link routedChargeOf}.
 * Distinguishes an unrouted job from a routed charge awaiting evidence, so
 * the latter never displays a default charge as a confirmed actual.
 */
export type PlannedRoutedCharge = { kind: "default" } | { kind: "pending" } | { kind: "confirmed"; credits: number }

export async function plannedRoutedCredits(args: { jobId: string; log: RoutedSettleLog; addonsBase?: number }): Promise<PlannedRoutedCharge> {
  try {
    const { data: job, error } = await supabase.from("jobs").select(`input_data->${VIDEO_ROUTE_STAMP_KEY}, run:metadata->videoRouteRun`).eq("id", args.jobId).maybeSingle()
    if (error || !job) return { kind: "pending" }
    const raw = (job as Record<string, unknown> | null)?.[VIDEO_ROUTE_STAMP_KEY]
    if (raw === undefined || raw === null) return { kind: (job as Record<string, unknown>).run ? "pending" : "default" }
    const stamp = videoRouteStampOf({ [VIDEO_ROUTE_STAMP_KEY]: raw }, args.jobId)
    if (!stamp || stamp.env !== getRuntimeEnv()) return { kind: "pending" }
    const settings = await getAppSettings()
    if (settingsReadFailed(settings)) return { kind: "pending" }
    const ledger = await readRouteLedger(args.jobId)
    const charge = routedChargeOf(stamp, args.log, { ...ledger, ...(args.addonsBase !== undefined ? { addonsBase: args.addonsBase } : {}) }, settings)
    if (charge.kind !== "billed") return { kind: "pending" }
    // A bill held for an admin's decision (or about to be) is never shown as a confirmed charge.
    if (ledger.settle?.state === "hold" || ledger.settle?.state === "unbilled" || ledger.settle?.decision === "rejected") return { kind: "pending" }
    // (A confirmation covers only the total it was given for, as in the one place a charge is taken.)
    const confirmedFor = ledger.settle?.detail?.decidedForCredits
    const confirmed = ledger.settle?.decision === "confirmed" && typeof confirmedFor === "number" && charge.chargedCredits <= confirmedFor + CONFIRM_ROUNDING_CREDITS
    if (!confirmed && routeBillAnomalous(charge.costUsd, stamp.quotedUsd * stamp.factor * charge.taskCount, billAnomalyMultipleOf(settings.video_route_policy))) return { kind: "pending" }
    return { kind: "confirmed", credits: charge.chargedCredits }
  } catch {
    return { kind: "pending" }
  }
}
