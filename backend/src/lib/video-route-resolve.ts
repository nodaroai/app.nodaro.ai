/**
 * Reading a routed job's unfinished business back from the route, before its
 * settlement charges or releases anything (ee/billing/video-route-settlement.ts):
 *
 *   - a send that STARTED and has no task row (its worker died, its read timed
 *     out): read once more. Done: its bill goes on the ledger. Failed or
 *     expired: recorded as such (not billed). Still running or unreadable:
 *     left, to be read again;
 *   - a delivered task with NO bill yet: read once more, in case the route
 *     has it now. It changes only by GAINING a verified bill: "done" with no
 *     bill leaves it pending, and "failed" / "expired" for a send already
 *     recorded delivered leaves it delivered;
 *   - a start given up on as `unresolved`: read once more, since its bill may
 *     still arrive (it is then a delivered, billed send: a known loss).
 *
 * One read per item per call, never a loop: the settlement sweep is the
 * retry. Core (no ee import); never throws.
 */
import { getPluginServices } from "./private-plugins/services-registry.js"
import { deliveredTask, readRouteLedger, recordRouteTask, recordRouteTaskOutcome, reviveUnresolvedTask, routeCostBasisOf, type UnresolvedStart } from "./video-route-ledger.js"

export interface RouteResolution {
  /** Whether this process could read the route at all (it has the route service). */
  readonly readable: boolean
  /** Items this call changed: a start read to its end, or a send that gained its verified bill. */
  readonly resolved: number
  /** Sends that gained a VERIFIED bill in this call (a bill arrived). "Done" with no bill is not one. */
  readonly billed: number
}

const usd = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null)
/** A verified bill: a positive amount. Zero or none is "no bill". */
const verified = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null)

export async function resolveRouteLedger(jobId: string, routeId: string): Promise<RouteResolution> {
  try {
    const service = getPluginServices().alternateRoutes
    if (!service) return { readable: false, resolved: 0, billed: 0 }
    const ledger = await readRouteLedger(jobId)
    // `open`: a start with no task row. `delivered`: a delivered send with no bill yet.
    // `given-up`: a start recorded `unresolved` after the wait, read again for a bill that may still come.
    const items: Array<{ send: number; key: string; ref: string; was: "open" | "delivered" | "given-up" }> = []
    for (const s of ledger.unresolvedStarts ?? []) if (s.ref) items.push({ send: s.send, key: s.key, ref: s.ref, was: "open" })
    for (const t of ledger.tasks) {
      if (t.billedUsd !== null || !t.ref) continue
      if (deliveredTask(t)) items.push({ send: t.send, key: "", ref: t.ref, was: "delivered" })
      else if (t.outcome === "unresolved") items.push({ send: t.send, key: "", ref: t.ref, was: "given-up" })
    }
    for (const s of ledger.segments) {
      if (s.billedUsd !== null || !s.ref) continue
      if (deliveredTask(s)) items.push({ send: 1, key: s.key, ref: s.ref, was: "delivered" })
      else if (s.outcome === "unresolved") items.push({ send: 1, key: s.key, ref: s.ref, was: "given-up" })
    }
    let resolved = 0
    let billed = 0
    for (const item of items) {
      try {
        const polled = await service.poll(routeId, item.ref)
        if (polled.state === "done" && polled.resultUrl) {
          const bill = verified(polled.providerCostUsd)
          // A delivered send the route still has no bill for stays exactly as it is: pending.
          if (item.was !== "open" && bill === null) continue
          await recordRouteTask(jobId, item.send, item.ref, bill, item.key, usd(polled.estimatedCostUsd), routeCostBasisOf(polled))
          if (item.was === "given-up") await reviveUnresolvedTask(jobId, item.send, item.key)
          resolved++
          if (bill !== null) billed++
        } else if (polled.state === "failed" || polled.state === "expired") {
          // A send once recorded DELIVERED never becomes failed or expired, whatever the route
          // says of it later (an old task it no longer keeps): it stays delivered, bill unknown.
          if (item.was === "delivered") continue
          if (await recordRouteTaskOutcome(jobId, item.send, item.key, item.ref, polled.state)) resolved++
        }
      } catch {
        // This read failed: the item stays as it is and is read again.
      }
    }
    return { readable: true, resolved, billed }
  } catch {
    return { readable: false, resolved: 0, billed: 0 }
  }
}

/**
 * Gives up on the starts that could not be read to an end: each is recorded
 * `unresolved` (never charged, never forgotten: the daily report lists them
 * as loss candidates). Returns them.
 */
export async function closeUnresolvedStarts(jobId: string): Promise<readonly UnresolvedStart[]> {
  try {
    const open = (await readRouteLedger(jobId)).unresolvedStarts ?? []
    for (const s of open) await recordRouteTaskOutcome(jobId, s.send, s.key, s.ref, "unresolved")
    return open
  } catch {
    return []
  }
}
