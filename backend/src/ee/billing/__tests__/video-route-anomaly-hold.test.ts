// @test-units-by-name it names only Seedance price ids and video job types, never a node unit
/**
 * The anomaly hold of the routed settlement (video-route-receipt.ts
 * `commitRoutedCharge`): a verified bill more than the policy's multiple of
 * the run's quote is not charged — the settlement is held for an admin, the
 * clip stays delivered, and one alert is raised. An admin's confirm charges
 * it in full, a reject releases the hold, each exactly once, through the same
 * one settlement. A confirm is for the total the admin was shown: a total that
 * grew since is held again for a confirmation of its own.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

type Settle = { state: string; decision: string | null; credits?: number | null; uncollected?: number | null; note?: string | null; billedUsd?: number; quotedUsd?: number; atQuote?: boolean; detail?: Record<string, unknown> | null }
const h = vi.hoisted(() => ({
  alerts: vi.fn(async () => {}),
  job: {} as Record<string, unknown>,
  log: {} as Record<string, unknown>,
  jobUpdates: [] as unknown[],
  commits: [] as number[],
  refunds: 0,
  tasks: [] as Array<{ send: number; ref: string; billedUsd: number | null }>,
  settle: undefined as Settle | undefined,
  policy: { models: {} } as Record<string, unknown>,
  raise: vi.fn(async () => null),
  ownLoss: [] as unknown[][],
  patches: [] as unknown[][],
}))
vi.mock("@/lib/video-route-policy-store.js", () => ({ updateVideoRoutePriceFactor: h.raise }))
vi.mock("../video-route-alerts.js", () => ({ recordVideoRouteAlert: h.alerts }))
vi.mock("../credits.js", async (orig) => ({
  ...(await orig<typeof import("../credits.js")>()),
  CreditsService: {
    commitCredits: async (_logId: string, credits: number) => {
      if (h.log.status !== "reserved") throw new Error("already settled")
      h.commits.push(credits)
      const receipt = { charged: credits, collected_over_hold: 0, shortfall: 0 }
      Object.assign(h.log, { status: "committed", credits_charged: credits, receipt })
      return { charged: credits, collectedOverHold: 0, shortfall: 0 }
    },
    refundCredits: async () => {
      if (h.log.status !== "reserved") return
      h.refunds++
      h.log.status = "refunded"
    },
  },
}))
vi.mock("@/lib/supabase.js", () => ({
  supabase: {
    from: (table: string) => {
      const chain: Record<string, unknown> = {}
      for (const m of ["select", "order", "eq"]) chain[m] = () => chain
      chain.update = (patch: unknown) => ((table === "jobs" ? h.jobUpdates.push(patch) : undefined), chain)
      chain.maybeSingle = async () => ({ data: table === "jobs" ? h.job : h.log, error: null })
      return chain
    },
  },
}))
vi.mock("@/lib/runtime-env.js", () => ({ getRuntimeEnv: () => "production" }))
vi.mock("@/lib/video-route-ledger.js", async (orig) => ({
  ...(await orig<typeof import("@/lib/video-route-ledger.js")>()),
  readRouteLedger: async () => ({ starts: [], tasks: h.tasks, segments: [], addonsBase: 0, settle: h.settle ? { ...h.settle, updatedAt: "" } : undefined }),
  recordRouteSettle: async (_jobId: string, state: string, fields: Record<string, unknown> = {}) => {
    // As the store does: a `retry` mark never overwrites a row that is there.
    if (state === "retry" && h.settle) return
    h.settle = { decision: h.settle?.decision ?? null, ...fields, state }
  },
  holdRouteSettle: async (_jobId: string, hold: { credits: number; billedUsd: number; quotedUsd: number; note: string }) => {
    // As the store does: a spent `quote` or `confirmed` decision is cleared (what a quote chose stays in `atQuote`), then the compare-and-set.
    if (h.settle?.state === "retry" && (h.settle.decision === "quote" || h.settle.decision === "confirmed")) h.settle = { ...h.settle, decision: null }
    if (h.settle && !(h.settle.state === "retry" && h.settle.decision === null)) return false
    h.settle = { ...(h.settle ?? {}), state: "hold", decision: null, ...hold }
    return true
  },
  markRouteTaskOwnLoss: async (...a: unknown[]) => { h.ownLoss.push(a); return true },
  patchRouteSettle: async (...a: unknown[]) => { h.patches.push(a); return true },
  decideRouteSettleHold: async (_jobId: string, decision: string, _adminId: string, _kind?: string, decidedForCredits?: number) => {
    if (h.settle?.state !== "hold" || h.settle.decision !== null) return false
    // As the store does: the total the decision was made for is kept beside it.
    h.settle = { ...h.settle, state: "retry", decision, ...(decision === "quote" ? { atQuote: true } : {}), detail: { ...(h.settle.detail ?? {}), ...(decidedForCredits !== undefined ? { decidedForCredits } : {}) } }
    return true
  },
}))
vi.mock("@/lib/app-settings.js", () => ({ getAppSettings: async () => ({ video_route_policy: h.policy }), settingsReadFailed: () => false }))

const { recoverRoutedSettlement, settleRoutedJob, plannedRoutedCredits, RoutedSettleHeld } = await import("../video-route-settlement.js")
const { decideRouteSettleHold } = await import("../../../lib/video-route-ledger.js")
const { videoRouteStamp } = await import("../../../lib/video-route-decision.js")
const { ROUTE_BILL_ANOMALY_MULTIPLE_DEFAULT } = await import("../../../lib/video-route-policy.js")
const { CREDIT_BASE_USD } = await import("@nodaro/shared/models")

const JOB = "job-1"
/** A quote of 100 credits' worth per task, times `factor`. */
function routedJob(factor = 1) {
  h.job = {
    status: "completed", usage_log_id: "log", parent_job_id: null, defer: null,
    __videoRoute: videoRouteStamp(JOB, { route: "alternate", routeId: "r1", service: "image-to-video" }, { model: "seedance-2-5", priceId: "seedance-2-5:8s:720p", requestKey: "rk", quotedUsd: CREDIT_BASE_USD * 100, quotedSec: 8, factor, factorKey: "seedance-2-5:720p:noref:generate" }),
  }
  h.log = { action: "seedance-2-5:8s:720p", credits_used: 100 * factor, job_id: JOB, status: "reserved" }
}
const billed = (...credits: number[]) => { h.tasks = credits.map((c, i) => ({ send: i + 1, ref: `t${i}`, billedUsd: CREDIT_BASE_USD * c })) }
const settleOnce = () => settleRoutedJob({ jobId: JOB, usageLogId: "log", log: h.log as never })
/** The default multiple: every threshold below is derived from it, so changing the constant needs no edit here. */
const M = ROUTE_BILL_ANOMALY_MULTIPLE_DEFAULT
/** The largest bill (in credits, on a quote of 100) that is still charged, and the smallest that is held. */
const AT = 100 * M
const OVER = AT + 10
const anomalyAlerts = () => h.alerts.mock.calls.filter((c) => (c as unknown as [{ kind: string }])[0].kind === "anomaly")

beforeEach(() => {
  h.alerts.mockClear()
  h.raise.mockClear()
  h.ownLoss = []
  h.patches = []
  h.jobUpdates = []
  h.commits = []
  h.refunds = 0
  h.settle = { state: "retry", decision: null }
  h.policy = { models: {} }
  routedJob()
  vi.spyOn(console, "error").mockImplementation(() => {})
})

describe("the anomaly hold", () => {
  it("the default multiple is the one named constant, and what a policy with none saved uses", async () => {
    const { billAnomalyMultipleOf, defaultVideoRoutePolicy } = await import("../../../lib/video-route-policy.js")
    expect(M).toBeGreaterThanOrEqual(1)
    expect(billAnomalyMultipleOf(null)).toBe(M)
    expect(defaultVideoRoutePolicy().billAnomalyMultiple).toBe(M)
  })

  it("a bill at or under the multiple is charged in full, as before", async () => {
    billed(AT)
    expect(await settleOnce()).toBe(true)
    expect(h.commits).toEqual([AT])
    expect(h.settle).toMatchObject({ state: "done", credits: AT })
    expect(anomalyAlerts()).toHaveLength(0)
    // A charged bill above its quote is evidence of the route's price, as before.
    expect(h.raise).toHaveBeenCalledTimes(M > 1 ? 1 : 0)
  })

  it("a bill over the multiple is not charged: held, still delivered, alerted once", async () => {
    billed(OVER)
    await expect(settleOnce()).rejects.toBeInstanceOf(RoutedSettleHeld)
    expect(h.commits).toEqual([])
    expect(h.refunds).toBe(0)
    expect(h.settle).toMatchObject({ state: "hold", decision: null, credits: OVER })
    // The job is untouched: completed, its result delivered.
    expect(h.job.status).toBe("completed")
    expect(h.jobUpdates).toEqual([])
    expect(anomalyAlerts()).toHaveLength(1)
    // Shown as pending, never as a confirmed charge.
    expect(await plannedRoutedCredits({ jobId: JOB, log: h.log as never })).toEqual({ kind: "pending" })
    // Every later settle attempt finds it held: no charge, no second alert.
    await expect(settleOnce()).rejects.toBeInstanceOf(RoutedSettleHeld)
    await expect(recoverRoutedSettlement(JOB)).rejects.toBeInstanceOf(RoutedSettleHeld)
    expect(h.commits).toEqual([])
    expect(anomalyAlerts()).toHaveLength(1)
    // A held bill moves no price.
    expect(h.raise).not.toHaveBeenCalled()
  })

  it("an admin's confirm charges it in full, exactly once", async () => {
    billed(2 * OVER)
    await expect(settleOnce()).rejects.toBeInstanceOf(RoutedSettleHeld)
    expect(await decideRouteSettleHold(JOB, "confirmed", "admin-1", "anomaly", 2 * OVER)).toBe(true)
    // One decision per hold.
    expect(await decideRouteSettleHold(JOB, "rejected", "admin-2")).toBe(false)
    expect(await recoverRoutedSettlement(JOB)).toBe(true)
    expect(await recoverRoutedSettlement(JOB)).toBe(true)
    expect(h.commits).toEqual([2 * OVER])
    // Once confirmed and charged, the bill is evidence of the route's price again.
    expect(h.raise).toHaveBeenCalledTimes(1)
    expect(h.refunds).toBe(0)
    expect(h.settle).toMatchObject({ state: "done", credits: 2 * OVER, decision: "confirmed" })
    expect(h.jobUpdates).toContainEqual({ credits_actual: 2 * OVER })
  })

  describe("a confirm is for the total the admin was shown", () => {
    /** Held at `shown`, confirmed for it; then the bill the settlement reads is `now`. */
    const confirmedFor = async (shown: number, now: number, decidedFor: number | undefined = shown) => {
      billed(shown)
      await expect(settleOnce()).rejects.toBeInstanceOf(RoutedSettleHeld)
      expect(await decideRouteSettleHold(JOB, "confirmed", "admin-1", "anomaly", decidedFor)).toBe(true)
      billed(now)
    }

    it("a bill that grew after the confirm is not charged: it is held again, for a confirmation of its own", async () => {
      await confirmedFor(2 * OVER, 3 * OVER)
      await expect(recoverRoutedSettlement(JOB)).rejects.toBeInstanceOf(RoutedSettleHeld)
      expect(h.commits).toEqual([])
      expect(h.refunds).toBe(0)
      // The spent confirmation is gone; the hold shows the new total and waits for a decision.
      expect(h.settle).toMatchObject({ state: "hold", decision: null, credits: 3 * OVER })
      expect(anomalyAlerts()).toHaveLength(2)
      expect(h.raise).not.toHaveBeenCalled()
      // Shown as pending, and every later attempt finds it held.
      expect(await plannedRoutedCredits({ jobId: JOB, log: h.log as never })).toEqual({ kind: "pending" })
      await expect(recoverRoutedSettlement(JOB)).rejects.toBeInstanceOf(RoutedSettleHeld)
      expect(h.commits).toEqual([])
      // Confirmed for the new total, it is charged in full, once.
      expect(await decideRouteSettleHold(JOB, "confirmed", "admin-1", "anomaly", 3 * OVER)).toBe(true)
      expect(await recoverRoutedSettlement(JOB)).toBe(true)
      expect(await recoverRoutedSettlement(JOB)).toBe(true)
      expect(h.commits).toEqual([3 * OVER])
    })

    it("a charge one credit of rounding above the confirmed total is the same total: charged", async () => {
      await confirmedFor(2 * OVER, 2 * OVER, 2 * OVER - 1)
      expect(await recoverRoutedSettlement(JOB)).toBe(true)
      expect(h.commits).toEqual([2 * OVER])
      expect(h.settle).toMatchObject({ state: "done", decision: "confirmed" })
    })

    it("a charge two credits above the confirmed total is another total: held again", async () => {
      await confirmedFor(2 * OVER, 2 * OVER, 2 * OVER - 2)
      await expect(recoverRoutedSettlement(JOB)).rejects.toBeInstanceOf(RoutedSettleHeld)
      expect(h.commits).toEqual([])
      expect(h.settle).toMatchObject({ state: "hold", decision: null, credits: 2 * OVER })
    })

    it("a total that came down since is covered by the confirm of the larger one", async () => {
      await confirmedFor(3 * OVER, 2 * OVER)
      expect(await recoverRoutedSettlement(JOB)).toBe(true)
      expect(h.commits).toEqual([2 * OVER])
    })

    it("what a held child is shown follows the same rule: a confirmed charge only for the total it was confirmed for", async () => {
      billed(2 * OVER)
      const planned = () => plannedRoutedCredits({ jobId: JOB, log: h.log as never })
      h.settle = { state: "retry", decision: "confirmed", detail: { decidedForCredits: 2 * OVER } }
      expect(await planned()).toEqual({ kind: "confirmed", credits: 2 * OVER })
      h.settle = { state: "retry", decision: "confirmed", detail: { decidedForCredits: 2 * OVER - 1 } }
      expect(await planned()).toEqual({ kind: "confirmed", credits: 2 * OVER })
      // Confirmed for a smaller total, or for none: the settlement would hold it again, so it is pending.
      h.settle = { state: "retry", decision: "confirmed", detail: { decidedForCredits: 2 * OVER - 2 } }
      expect(await planned()).toEqual({ kind: "pending" })
      h.settle = { state: "retry", decision: "confirmed" }
      expect(await planned()).toEqual({ kind: "pending" })
    })

    it("a confirm that names no total covers none: the bill is held again", async () => {
      billed(2 * OVER)
      h.settle = { state: "retry", decision: "confirmed" }
      await expect(recoverRoutedSettlement(JOB)).rejects.toBeInstanceOf(RoutedSettleHeld)
      expect(h.commits).toEqual([])
      expect(h.settle).toMatchObject({ state: "hold", decision: null, credits: 2 * OVER })
    })
  })

  it("an admin's reject releases the hold, exactly once, and records the loss", async () => {
    billed(2 * OVER)
    await expect(settleOnce()).rejects.toBeInstanceOf(RoutedSettleHeld)
    expect(await decideRouteSettleHold(JOB, "rejected", "admin-1")).toBe(true)
    expect(await recoverRoutedSettlement(JOB)).toBe(true)
    expect(await recoverRoutedSettlement(JOB)).toBe(true)
    expect(h.refunds).toBe(1)
    expect(h.commits).toEqual([])
    expect(h.log.status).toBe("refunded")
    expect(h.settle).toMatchObject({ state: "waived", credits: 0, uncollected: 2 * OVER, decision: "rejected" })
    expect(h.job.status).toBe("completed")
    // A rejected bill moves no price.
    expect(h.raise).not.toHaveBeenCalled()
  })

  it("two delivered sends in one job: only the delivered clip's send is charged and tested; the earlier one is our loss", async () => {
    // The first send was delivered by the route, then a step of ours failed and a second send made the clip the person got.
    billed(4 * AT, AT)
    expect(await settleOnce()).toBe(true)
    // Charged the second send alone (within the multiple of ONE quote), never the two summed.
    expect(h.commits).toEqual([AT])
    expect(h.ownLoss).toEqual([[JOB, 1]])
    expect(h.alerts.mock.calls.filter((c) => (c as unknown as [{ key: string }])[0].key === `own-loss:${JOB}:1`)).toHaveLength(1)
    // The delivered send far over its own quote is held, whatever the earlier one cost.
    routedJob()
    h.settle = { state: "retry", decision: null }
    billed(10, OVER)
    await expect(settleOnce()).rejects.toBeInstanceOf(RoutedSettleHeld)
    expect(h.commits).toEqual([AT])
  })

  describe("an admin settles an unbilled run at its quote", () => {
    const unbilled = () => { h.settle = { state: "retry", decision: "quote", atQuote: true } as never }
    it("a send the route never billed is charged at the quote it was held at, and the route is then watched for a late bill", async () => {
      h.tasks = [{ send: 1, ref: "t0", billedUsd: null }]
      unbilled()
      expect(await settleOnce()).toBe(true)
      expect(h.commits).toEqual([100])
      expect(h.patches).toContainEqual([JOB, expect.objectContaining({ watchUntil: expect.any(String) }), expect.objectContaining({ next_attempt_at: expect.any(String) })])
      // A quote says nothing about the route's price.
      expect(h.raise).not.toHaveBeenCalled()
    })

    it("a bill that arrived before the click is charged at its real figure only when that passes the anomaly test: far above the quote it is HELD, not charged", async () => {
      // The admin clicked "settle at quote" on an unbilled run; meanwhile the route reported a bill far above the quote.
      billed(OVER)
      unbilled()
      await expect(settleOnce()).rejects.toBeInstanceOf(RoutedSettleHeld)
      expect(h.commits).toEqual([])
      expect(h.settle).toMatchObject({ state: "hold", decision: null, credits: OVER })
      expect(anomalyAlerts()).toHaveLength(1)
      // Its own confirmation then charges it in full.
      expect(await decideRouteSettleHold(JOB, "confirmed", "admin-1", "anomaly", OVER)).toBe(true)
      expect(await recoverRoutedSettlement(JOB)).toBe(true)
      expect(h.commits).toEqual([OVER])
    })

    it("a bill that arrived within the multiple is charged at its real figure, not the quote", async () => {
      billed(AT)
      unbilled()
      expect(await settleOnce()).toBe(true)
      expect(h.commits).toEqual([AT])
    })
  })

  it("releasing an unbilled run records the best-known loss (its quote), never zero, and the route is watched for a late bill", async () => {
    h.tasks = [{ send: 1, ref: "t0", billedUsd: null }]
    h.settle = { state: "retry", decision: "rejected", credits: null } as never
    expect(await recoverRoutedSettlement(JOB)).toBe(true)
    expect(h.refunds).toBe(1)
    expect(h.settle).toMatchObject({ state: "waived", credits: 0, uncollected: 100 })
    expect(h.patches).toContainEqual([JOB, expect.objectContaining({ watchUntil: expect.any(String) }), expect.objectContaining({ next_attempt_at: expect.any(String) })])
  })

  it("the quote is the one the run was held at: scaled by its price factor", async () => {
    routedJob(2)
    billed(2 * AT)
    expect(await settleOnce()).toBe(true)
    routedJob(2)
    h.settle = { state: "retry", decision: null }
    billed(2 * AT + 10)
    await expect(settleOnce()).rejects.toBeInstanceOf(RoutedSettleHeld)
  })

  it("the multiple is the admin's: a higher saved one charges what the default would hold", async () => {
    h.policy = { models: {}, billAnomalyMultiple: M * 2 }
    billed(OVER)
    expect(await settleOnce()).toBe(true)
    expect(h.commits).toEqual([OVER])
  })
})
