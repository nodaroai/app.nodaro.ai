/**
 * THE loss rule of a routed video run, and the figure a late bill is found by.
 * Pure; read by every place a routed loss is recorded (a failed or cancelled
 * run, a release, a completed run with nothing delivered, a send replaced
 * after a step of ours failed, a late bill) so the figure is the same on every
 * path.
 *
 * The recorded loss is what the ROUTE billed for the sends that are not
 * charged: each such send's verified bill, or — while a delivered send has no
 * bill yet — its quote (the best known). It is in base credits: the route's
 * cost at the credit's value (`routeUsdToBaseCredits`), with no markup, no
 * add-on and no run fee — those are ours, never a loss. A send that started
 * and could not be read to an end counts nothing until a bill arrives for it
 * (it may never have been billed), and keeps the route watched. A send the
 * route ended with no result (failed, expired) was not billed.
 */
import { deliveredTask, type RouteLedger, type RouteTaskOutcome } from "../../lib/video-route-ledger.js"
import type { RouteLoss } from "./video-route-receipt.js"
import { routeUsdToBaseCredits } from "./video-route-listing.js"

const roundUsd = (usd: number): number => Math.round(usd * 1e6) / 1e6

/**
 * Every verified bill on the ledger, summed (USD): a job's own sends and a
 * run's segments, delivered, replaced or given up on alike. Markup does not
 * move it and it only grows as bills arrive, so a change of it IS a bill that
 * arrived — what the late-bill pass compares each read with.
 */
export function ledgerBilledUsd(ledger: RouteLedger): number {
  let sum = 0
  for (const t of ledger.tasks) if (t.billedUsd !== null) sum += t.billedUsd
  for (const s of ledger.segments) if (s.billedUsd !== null) sum += s.billedUsd
  return roundUsd(sum)
}

/** Whether any send or segment of the ledger may still be billed: a delivered or given-up one with no bill, or a start not read to an end. */
export function ledgerMayStillBill(ledger: RouteLedger): boolean {
  if ((ledger.unresolvedStarts ?? []).length > 0) return true
  const open = (t: { readonly billedUsd: number | null; readonly outcome?: RouteTaskOutcome | null }) => t.billedUsd === null && (deliveredTask(t) || t.outcome === "unresolved")
  return ledger.tasks.some(open) || ledger.segments.some(open)
}

/**
 * The loss of the sends that are NOT charged (see the module doc).
 *   - `charged: "nothing"`: no send is charged (the run failed, was cancelled,
 *     was released, or delivered nothing): every send counts.
 *   - `charged: "delivered"`: the person was charged for the delivered output
 *     — a job's LAST delivered send, a run's delivered segments — and every
 *     other send counts (an earlier delivered send replaced after a step of
 *     ours failed, a send given up on whose bill arrived).
 * `jobQuoteUsd`: the quote of one of the job's own sends (its decision's
 * quote times its factor), the best known figure of one the route delivered
 * and has not billed. A segment's is on its own start.
 */
export function routeLossOf(ledger: RouteLedger, charged: "nothing" | "delivered", jobQuoteUsd: number): RouteLoss {
  let usd = 0
  let unbilled = (ledger.unresolvedStarts ?? []).length > 0
  const lastDelivered = charged === "delivered" ? ledger.tasks.filter(deliveredTask).reduce<number | null>((m, t) => (m === null || t.send > m ? t.send : m), null) : null
  for (const t of ledger.tasks) {
    if (deliveredTask(t) && t.send === lastDelivered) continue
    if (t.billedUsd !== null) usd += t.billedUsd
    else if (deliveredTask(t)) {
      usd += jobQuoteUsd
      unbilled = true
    } else if (t.outcome === "unresolved") unbilled = true
  }
  for (const s of ledger.segments) {
    if (charged === "delivered" && deliveredTask(s)) continue
    if (s.billedUsd !== null) usd += s.billedUsd
    else if (deliveredTask(s)) {
      usd += s.quotedUsd ?? 0
      unbilled = true
    } else if (s.outcome === "unresolved") unbilled = true
  }
  const total = roundUsd(usd)
  return { credits: total > 0 ? routeUsdToBaseCredits(total) : 0, usd: total, unbilled }
}
