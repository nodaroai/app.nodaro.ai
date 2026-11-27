/**
 * The late-bill pass of routed video settlements (docs/design/alternate-routes.md):
 * a settlement that closed over a send the route had not billed is read from
 * the route again until its watch ends, and a bill that arrives is RECORDED
 * and alerted, never charged. Run by the settlement sweep
 * (video-route-settlement.ts `retryRoutedSettlements`), which hands it the
 * settlement's own preview (this module imports nothing of the settlement but
 * its types, so the two never import each other).
 */

/** What a settlement would charge right now, and what it is measured against (video-route-settlement.ts `previewRoutedSettlement`). */
export type PreviewRoutedSettlement = (jobId: string, opts?: { reservation?: boolean }) => Promise<RoutedSettlementPreview>
import { patchRouteSettle, readLateBillWatches, reopenUnbilledSettle, type LateBillWatch } from "../../lib/video-route-ledger.js"
import { resolveRouteLedger } from "../../lib/video-route-resolve.js"
import { LATE_BILL_READ_MS, patchSettleOrAlert } from "./video-route-receipt.js"
import type { RoutedSettlementPreview } from "./video-route-settlement.js"
import { recordVideoRouteAlert } from "./video-route-alerts.js"

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
 * What was charged is the reservation's own word (its hold went back, or the
 * credits its receipt charged), never the row's credits. A watch whose
 * starting figure could not be kept (the ledger could not be read when it
 * started) has it recorded by its first read, which is no late bill and is
 * not counted — unless the charge against what the run now costs moved. A
 * row in the list that carries no watch at all (a finished settlement with a
 * retry time left over) is taken off the list.
 * Never throws.
 */
export async function readLateBills(now: number, previewRoutedSettlement: PreviewRoutedSettlement): Promise<{ read: number; arrived: number }> {
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
      const until = typeof watch.detail.watchUntil === "string" ? Date.parse(watch.detail.watchUntil) : NaN
      // Not a watch: a settlement that ended with a time left over from its retry backoff, and no
      // watch ever started on it (a short balance's record is written by the database, which keeps
      // that time). Its time is cleared so no pass reads it again; nothing is recorded or counted.
      if (watch.state !== "unbilled" && !Number.isFinite(until)) {
        await patchRouteSettle(watch.jobId, {}, { next_attempt_at: null }, { onlyStates: [watch.state] })
        continue
      }
      out.read++
      const before = await previewRoutedSettlement(watch.jobId)
      if (before.routeId) await resolveRouteLedger(watch.jobId, before.routeId)
      const after = await previewRoutedSettlement(watch.jobId, { reservation: watch.state !== "unbilled" })
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
      // The bills changed since the figures were recorded (or none was kept): what it is now known
      // to cost, against what was taken. What was taken is the reservation's own word — its hold went
      // back, or the credits its receipt charged — never the row's credits (a short balance's are what
      // was collected so far; an undelivered run's record says 0 like a release does).
      const taken = watch.state === "waived" ? { nothing: true, credits: 0 } : (after.taken ?? null)
      const nothingCharged = taken?.nothing === true
      const loss = (nothingCharged ? after.loss : after.chargedLoss) ?? null
      const known = nothingCharged ? null : after.credits
      // A reservation that cannot be read, or a charged run whose total cannot be computed just now:
      // not recorded on a guess; the next pass finds the same change.
      if (taken === null || loss === null || (!nothingCharged && known === null)) {
        await patchSettleOrAlert(watch.jobId, "The next late-bill read", {}, { next_attempt_at: later })
        continue
      }
      const difference = known === null ? 0 : Math.max(0, known - taken.credits)
      // `uncollected`: the charge not collected (a charged run), or the loss (nothing charged) — the
      // figure as it now stands, down as well as up. A shortfall's column is its unpaid charge, kept by
      // the database: the difference is recorded on its late bill only, and never includes that debt.
      const uncollected = nothingCharged ? loss.credits : difference
      const lateBillBefore = watch.detail.lateBill as Record<string, unknown> | undefined
      const priorUncollected = watch.state === "shortfall" ? (numberOf(lateBillBefore?.differenceCredits) ?? 0) : watch.uncollected
      const priorLoss = numberOf(lateBillBefore?.lossCredits) ?? numberOf((watch.detail.loss as Record<string, unknown> | undefined)?.credits) ?? (nothingCharged ? watch.uncollected : 0)
      const columns = { next_attempt_at: nextAt, ...(watch.state === "shortfall" ? {} : { uncollected }) }
      // No starting figure was kept (the ledger could not be read when the watch started): this read
      // only records it — no late bill, nothing counted — unless what it costs against what was taken
      // moved, which is a late bill whatever the starting point.
      if (recordedUsd === null && (nothingCharged ? priorUncollected === null || priorUncollected === uncollected : (priorUncollected ?? 0) === difference)) {
        if (!(await patchSettleOrAlert(watch.jobId, "The starting figures of a late-bill watch", { knownUsd: billedNow, loss: { credits: loss.credits, usd: loss.usd } }, columns))) continue
        // A run that was not charged whose loss was not known when it ended: the loss, once, now that it is.
        if (nothingCharged && priorUncollected === null && loss.credits > 0) {
          const message = `The loss of a routed run that was not charged is now known: the route's bills for it come to ${loss.credits} credits (${loss.usd.toFixed(4)} USD), recorded as the loss.`
          console.error(`[ALERT] video route: job ${watch.jobId}: ${message}`)
          await recordVideoRouteAlert({ key: `loss-known:${watch.jobId}`, kind: "settlement", jobId: watch.jobId, message }).catch(() => {})
        }
        continue
      }
      const lateBill = { at: new Date(now).toISOString(), billedUsd: billedNow, knownCredits: known ?? loss.credits, chargedCredits: taken.credits, differenceCredits: difference, lossCredits: loss.credits, lossUsd: loss.usd }
      const recorded = await patchSettleOrAlert(watch.jobId, "A late bill", { lateBill, knownUsd: billedNow, loss: { credits: loss.credits, usd: loss.usd } }, columns)
      if (!recorded) continue
      out.arrived++
      const message = nothingCharged
        ? `A bill arrived for a routed run that was not charged (released or undelivered): the route's bills for it now come to ${loss.credits} credits (${loss.usd.toFixed(4)} USD), recorded as the loss (it was ${priorLoss ?? 0}).`
        : `A bill arrived after a routed run was settled: it is now known to cost ${known} credits against ${taken.credits} charged; ${difference} credits are recorded as ${watch.state === "shortfall" ? "not charged on its late-bill record (its unpaid charge is kept apart)" : "uncollected"}${loss.credits > 0 ? `, and ${loss.credits} credits of sends not charged as a loss` : ""}. Nothing more was charged.`
      console.error(`[ALERT] video route: job ${watch.jobId}: ${message}`)
      await recordVideoRouteAlert({ key: `late-bill:${watch.jobId}`, kind: "anomaly", jobId: watch.jobId, message }).catch(() => {})
    } catch (err) {
      console.error(`[video-route] job ${watch.jobId}: reading its late bill failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  return out
}

