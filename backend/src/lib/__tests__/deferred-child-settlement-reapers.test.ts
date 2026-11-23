import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * A deferred child (lib/deferred-child-settlement.ts) is a COMPLETED job whose
 * usage log is still `reserved`. To a reaper that reads "completed" as
 * "settled", or "reserved" as "stuck", it could look like work to do. None may
 * commit or refund it before its plugin or the deferred sweep decides:
 *  - the cost shortfall sweep judges only a COMMITTED log (an open one is
 *    "settlement pending"; a released one is "refunded", never a loss);
 *  - cancelling a run cancels only its IN-FLIGHT children (a completed child
 *    is left to the deferred sweep, which releases it once the run is
 *    cancelled);
 *  - every reconcile scan and the hold expiry read only live statuses
 *    (`IN_FLIGHT_JOB_STATUSES` has no "completed");
 *  - a child is never held for review, so no approve or reject replays it.
 * Each reaper's own suite covers the rest of its behaviour.
 */

const db = vi.hoisted(() => ({ inFilters: [] as Array<[string, readonly unknown[]]>, rows: [] as Array<{ id: string; status: string }> }))
vi.mock("@/lib/supabase.js", () => {
  const chain = () => {
    const self: Record<string, unknown> = {}
    self.select = () => self
    self.eq = () => self
    self.in = (col: string, vals: readonly unknown[]) => {
      db.inFilters.push([col, vals])
      return Promise.resolve({ data: db.rows.filter((r) => col !== "status" || vals.includes(r.status)), error: null })
    }
    return self
  }
  return { supabase: { from: () => chain() } }
})

import { judgeCostShortfall } from "../../ee/billing/cost-shortfall.js"
import { cancelRunningChildJobs } from "../cancel-job.js"
import { IN_FLIGHT_JOB_STATUSES } from "../job-status.js"

beforeEach(() => {
  db.inFilters = []
  db.rows = []
})

const job = (status: string) => ({
  providerCostUsd: 1.2,
  usageLog: { status, credits_used: 40, credits_charged: null },
  sideCharged: 0,
  sharedUsageLog: false,
}) as unknown as Parameters<typeof judgeCostShortfall>[0]

describe("the reapers leave a held child alone", () => {
  it("the cost shortfall sweep does not judge a held child, nor count a released one as a loss", () => {
    expect(judgeCostShortfall(job("reserved"))).toEqual({ kind: "skip", reason: "settlement_pending" })
    expect(judgeCostShortfall(job("refunded"))).toEqual({ kind: "skip", reason: "refunded" })
  })

  it("cancelling a run reads only its in-flight children: a completed (held) child is not cancelled or refunded", async () => {
    db.rows = [{ id: "00000000-0000-4000-8000-0000000000c1", status: "completed" }]
    const cancelled = await cancelRunningChildJobs("00000000-0000-4000-8000-0000000000a1", "u")
    expect(cancelled).toBe(0)
    const [col, statuses] = db.inFilters.find(([c]) => c === "status")!
    expect(col).toBe("status")
    expect(statuses).not.toContain("completed")
  })

  it("no live status is 'completed' (the reconcile scans, the hold expiry)", () => {
    expect(IN_FLIGHT_JOB_STATUSES as readonly string[]).not.toContain("completed")
  })
})
