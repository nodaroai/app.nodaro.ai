import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * The route's money watch (video-route-watch.ts): balance floors alert (throttled,
 * unset = none) and never revert anything; the daily reconciliation compares the
 * recorded cost of the day's routed jobs with the route's own spend, alerts past
 * the threshold, raises the factors used that day, and keeps both figures.
 */
const h = vi.hoisted(() => ({
  settings: {} as Record<string, unknown>,
  snapshots: [] as Array<{ credits: number; recorded_at: string }>,
  tasks: [] as Array<{ job_id: string; billed_usd: unknown }>,
  statuses: {} as Record<string, string>,
  kept: [] as unknown[],
  adminAlerts: [] as unknown[],
  raised: [] as unknown[],
  held: { count: 0, oldestAt: null } as { count: number; oldestAt: string | null },
  heldFails: false,
  lateBills: 0,
  stuckRepayments: 0,
  otherEnvs: [] as Array<{ env: string; open: number }>,
  aliveEnvs: [] as string[],
  keptDays: null as unknown,
}))
vi.mock("@/lib/video-route-ledger.js", async (orig) => ({
  ...(await orig<typeof import("@/lib/video-route-ledger.js")>()),
  countHeldRouteSettles: async () => {
    if (h.heldFails) throw new Error("ledger unavailable")
    return h.held
  },
  countLateBills: async () => h.lateBills,
  countStuckDeferredRepayments: async () => h.stuckRepayments,
  readOtherEnvOpenSettles: async () => h.otherEnvs,
  envWroteLedgerSince: async (env: string) => h.aliveEnvs.includes(env),
}))

vi.mock("@/lib/app-settings.js", () => ({ getAppSettings: async () => h.settings, invalidateSettingsCache: () => {} }))
vi.mock("../../routes/admin-kie-credits.js", () => ({ fetchKieCreditSnapshotsSince: async () => h.snapshots }))
vi.mock("@/lib/video-route-policy-store.js", () => ({
  videoRouteSpendDaysKey: () => "video_route_spend_days:local",
  readSettingsRowValue: async () => h.keptDays,
  updateSettingsRow: async (key: string, change: (raw: unknown, at: string | null) => unknown) => {
    if (key.startsWith("video_route_alerts:")) h.adminAlerts = change(h.adminAlerts, null) as unknown[]
    else h.kept.push(change(null, null))
  },
}))
vi.mock("@/lib/supabase.js", () => ({
  supabase: {
    from: (table: string) => {
      const q: Record<string, unknown> = {}
      // The day's reads, as the store answers them: by `created_at`, or by when a bill was recorded (`detail->>billedAt`).
      let column = ""
      let from = ""
      let to = ""
      for (const m of ["select", "not", "eq", "order"]) q[m] = () => q
      q.gte = (c: string, v: string) => ((column = c), (from = v), q)
      q.lt = (_c: string, v: string) => ((to = v), q)
      q.range = async () => {
        if (table !== "video_route_ledger") return { data: [], error: null }
        const rows = (h.tasks as Array<Record<string, unknown>>).map((t, i) => ({ id: i + 1, created_at: "2026-11-24T12:00:00.000Z", ...t }))
        const at = (r: Record<string, unknown>) => (column === "created_at" ? r.created_at : (r.detail as { billedAt?: unknown } | undefined)?.billedAt)
        return { data: rows.filter((r) => typeof at(r) === "string" && (at(r) as string) >= from && (to === "" || (at(r) as string) < to)), error: null }
      }
      q.in = async (_c: string, ids: string[]) => ({ data: ids.map((id) => ({ id, status: h.statuses[id] ?? "completed" })), error: null })
      return q
    },
  },
}))

const { checkRouteBalances, reconcileRouteSpend, remindHeldSettlements, reportLateBillsAndOrphans, previousUtcDay, spendDrifted, runOncePerEnvironment, _resetBalanceAlertsForTests } = await import("../video-route-watch.js")
const { setPluginServices, _resetPluginServicesForTests } = await import("../../../lib/private-plugins/services-registry.js")
const { defaultVideoRoutePolicy } = await import("../../../lib/video-route-policy.js")

const policy = (over: Record<string, unknown> = {}) => ({ ...defaultVideoRoutePolicy(), ...over })
const route = (over: Record<string, unknown> = {}) =>
  setPluginServices({
    alternateRoutes: {
      accepts: () => null, start: async () => ({ taskRef: "t" }), poll: async () => ({ state: "running" }), prices: () => [],
      account: async () => ({ availableUsd: 12, heldUsd: 3, observedAt: "now" }),
      spend: async (since: string) => (since.endsWith("T00:00:00.000Z") && since.startsWith("2026-11-24") ? { actualUsd: 10.5, videoSeconds: 300 } : { actualUsd: 0.5, videoSeconds: 10 }),
      ...over,
    },
  })

let err: { mock: { calls: unknown[][] } }
beforeEach(() => {
  _resetPluginServicesForTests()
  _resetBalanceAlertsForTests()
  h.settings = {}
  h.snapshots = [{ credits: 800, recorded_at: "x" }]
  h.tasks = []
  h.statuses = {}
  h.kept = []
  h.adminAlerts = []
  h.raised = []
  h.held = { count: 0, oldestAt: null }
  h.heldFails = false
  h.lateBills = 0
  h.stuckRepayments = 0
  h.otherEnvs = []
  h.aliveEnvs = []
  h.keptDays = null
  err = vi.spyOn(console, "error").mockImplementation(() => {})
  ;(err as unknown as { mockClear(): void }).mockClear()
})

const alerts = (): string[] => err.mock.calls.map((c: unknown[]) => String(c[0])).filter((m: string) => m.startsWith("[ALERT]"))

describe("checkRouteBalances", () => {
  it("raises nothing with no floors set", async () => {
    route()
    h.settings = { video_route_policy: policy() }
    expect((await checkRouteBalances()).alerted).toEqual([])
    expect(alerts()).toEqual([])
  })

  it("alerts below each floor, once per window, and reads both balances", async () => {
    route()
    h.settings = { video_route_policy: policy({ routeBalanceAlertUsd: 50, defaultProviderBalanceAlertCredits: 1000 }) }
    const first = await checkRouteBalances(0)
    expect(first).toMatchObject({ route: { availableUsd: 12 }, defaultProviderCredits: 800, alerted: ["route", "default"] })
    expect((await checkRouteBalances(60_000)).alerted).toEqual([])
    expect(h.adminAlerts).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "balance:route", kind: "balance" }),
      expect.objectContaining({ key: "balance:default", kind: "balance" }),
    ]))
  })
})

describe("reconcileRouteSpend", () => {
  const NOW = new Date("2026-11-25T00:20:00Z")
  /** A billed task on the route ledger (a job's send, or a segment of its parent). */
  const task = (jobId: string, usd: number | null, status = "completed") => {
    h.statuses[jobId] = status
    return { job_id: jobId, billed_usd: usd }
  }

  it("names yesterday's UTC day", () => {
    expect(previousUtcDay(NOW).day).toBe("2026-11-24")
  })

  it("keeps the day's two figures, and stays quiet when they agree", async () => {
    route({ spend: async (since: string) => (since.startsWith("2026-11-24") ? { actualUsd: 2.0, videoSeconds: 16 } : { actualUsd: 0, videoSeconds: 0 }) })
    h.settings = { video_route_policy: policy() }
    // A voiced run's two sends are two tasks of one job.
    h.tasks = [task("a", 0.5), task("a", 0.5), task("b", 1)]
    const day = await reconcileRouteSpend(NOW)
    expect(day).toMatchObject({ day: "2026-11-24", recordedUsd: 2, actualUsd: 2, unexplainedUsd: 0, jobs: 2 })
    expect(h.kept).toHaveLength(1)
    expect(alerts().some((m) => m.includes("rate table"))).toBe(false)
  })

  it("the shared account spending MORE than this ledger is context only: shown, never alerted (other environments use the account)", async () => {
    route()
    h.settings = { video_route_policy: policy() }
    h.tasks = [task("a", 5), task("b", 3), task("c", null)]
    const day = await reconcileRouteSpend(NOW)
    // What the ledger itself shows is still alerted: a bill never reported.
    expect(h.adminAlerts).toEqual(expect.arrayContaining([expect.objectContaining({ key: "missing-receipts:2026-11-24", kind: "reconciliation" })]))
    expect(day).toMatchObject({ recordedUsd: 8, actualUsd: 10, unexplainedUsd: 2, overRecordedUsd: 0 })
    expect((h.adminAlerts as Array<{ key: string }>).some((a) => a.key.startsWith("spend-drift:"))).toBe(false)
    expect(alerts().some((m) => m.includes("may be wrong"))).toBe(false)
  })

  it("this environment's ledger recording more than the whole account spent is shown here, and alerted by the account's own pass (never twice)", async () => {
    route()
    h.settings = { video_route_policy: policy() }
    h.tasks = [task("a", 9), task("b", 3)]
    const day = await reconcileRouteSpend(NOW)
    expect(day).toMatchObject({ recordedUsd: 12, actualUsd: 10, overRecordedUsd: 2 })
    expect((h.adminAlerts as Array<{ key: string }>).some((a) => a.key.startsWith("spend-drift:"))).toBe(false)
  })

  it("counts a bill on the day the ROUTE billed it: a bill that reached the ledger days later still counts on its own day", async () => {
    route()
    h.settings = { video_route_policy: policy() }
    h.tasks = [
      // First read done two days before, its bill recorded on this day: that earlier day's, not this one's.
      { job_id: "late", billed_usd: "4.000000", created_at: "2026-11-22T10:00:00.000Z", detail: { billedAt: "2026-11-24T08:00:00.000Z" } },
      // First read done on this day, its bill recorded the next day: this day's.
      { job_id: "next", billed_usd: "2.000000", created_at: "2026-11-24T23:00:00.000Z", detail: { billedAt: "2026-11-25T00:10:00.000Z" } },
      // Read done the next day, but the route's own record says it finished on this day: this day's.
      { job_id: "own", billed_usd: "0.500000", created_at: "2026-11-25T00:05:00.000Z", detail: { completedAt: "2026-11-24T23:58:00.000Z" } },
      // Billed with its row on the day.
      { job_id: "plain", billed_usd: "1.000000" },
    ] as never
    const day = await reconcileRouteSpend(NOW)
    expect(day).toMatchObject({ recordedUsd: 3.5, jobs: 3 })
    expect((h.adminAlerts as Array<{ key: string }>).some((a) => a.key.startsWith("missing-receipts:"))).toBe(false)
  })

  it("recomputes the trailing days, so a bill that reached the ledger after its day was reconciled lands on its own day (only the newest day alerts)", async () => {
    route()
    h.settings = { video_route_policy: policy() }
    // The 22nd was reconciled with no bill; its account figure was kept then.
    h.keptDays = [{ day: "2026-11-22", recordedUsd: 0, lossesUsd: 0, actualUsd: 4, videoSeconds: 30, unexplainedUsd: 4, jobs: 0, failedJobs: 0, at: "x" }]
    // First read done on the 22nd; its bill reached the ledger on the 24th.
    h.tasks = [{ job_id: "old", billed_usd: "4.000000", created_at: "2026-11-22T10:00:00.000Z", detail: { billedAt: "2026-11-24T08:00:00.000Z" } }] as never
    const day = await reconcileRouteSpend(NOW)
    expect(day).toMatchObject({ day: "2026-11-24", recordedUsd: 0 })
    const kept = h.kept[0] as Array<Record<string, unknown>>
    expect(kept).toHaveLength(9)
    expect(kept.find((d) => d.day === "2026-11-22")).toMatchObject({ recordedUsd: 4, actualUsd: 4, videoSeconds: 30, unexplainedUsd: 0, jobs: 1 })
    expect(kept.find((d) => d.day === "2026-11-23")).toMatchObject({ recordedUsd: 0, actualUsd: null })
    expect(h.adminAlerts).toEqual([])
  })

  it("a send given up on whose bill arrived is a known loss, never a charged job's cost", async () => {
    route()
    h.settings = { video_route_policy: policy() }
    h.tasks = [{ job_id: "g", billed_usd: "2.000000", outcome: "unresolved" }, { job_id: "ok", billed_usd: "3.000000" }] as never
    const day = await reconcileRouteSpend(NOW)
    expect(day).toMatchObject({ recordedUsd: 3, lossesUsd: 2 })
    expect((h.adminAlerts as Array<{ key: string }>).some((a) => a.key.startsWith("unresolved-sends:"))).toBe(false)
  })

  it("lists known losses on their own line, so they are not read as drift", async () => {
    route()
    h.settings = { video_route_policy: policy() }
    h.tasks = [task("a", 5), task("b", 3), task("c", 2, "failed")]
    const day = await reconcileRouteSpend(NOW)
    expect(day).toMatchObject({ recordedUsd: 8, lossesUsd: 2, failedJobs: 1, unexplainedUsd: 0 })
    expect(alerts().some((m) => m.includes("known losses") && m.includes("not charged"))).toBe(true)
    expect(alerts().some((m) => m.includes("rate table"))).toBe(false)
  })

  it("does nothing with no route here, or no routing ever saved", async () => {
    h.settings = { video_route_policy: policy() }
    expect(await reconcileRouteSpend(NOW)).toBeNull()
    route()
    h.settings = {}
    expect(await reconcileRouteSpend(NOW)).toBeNull()
  })

  it("drift needs both the percentage and more than the midnight allowance", () => {
    expect(spendDrifted(100, 3, 3)).toBe(false)
    expect(spendDrifted(100, 3.5, 3)).toBe(true)
    expect(spendDrifted(0, 0.4, 3)).toBe(false)
  })
})

describe("runOncePerEnvironment", () => {
  it("runs a task once per period across the instances of an environment", async () => {
    const taken = new Set<string>()
    vi.doMock("../../../lib/redis-lease.js", () => ({
      acquireLease: async (key: string) => (taken.has(key) ? null : (taken.add(key), "token")),
      releaseLease: async (key: string) => { taken.delete(key) },
    }))
    const fn = vi.fn(async () => {})
    expect(await runOncePerEnvironment("t", 3_600_000, fn, 10)).toBe(true)
    expect(await runOncePerEnvironment("t", 3_600_000, fn, 20)).toBe(false)
    expect(await runOncePerEnvironment("t", 3_600_000, fn, 3_600_000 + 5)).toBe(true)
    expect(fn).toHaveBeenCalledTimes(2)
    vi.doUnmock("../../../lib/redis-lease.js")
  })

  it("a pass that outlasts its period is not overlapped by the next one, and frees the way when it ends (also when it throws)", async () => {
    const taken = new Set<string>()
    vi.doMock("../../../lib/redis-lease.js", () => ({
      acquireLease: async (key: string) => (taken.has(key) ? null : (taken.add(key), "token")),
      releaseLease: async (key: string) => { taken.delete(key) },
    }))
    let finish = () => {}
    const long = vi.fn(() => new Promise<void>((resolve) => { finish = resolve }))
    const next = vi.fn(async () => {})
    const first = runOncePerEnvironment("t", 3_600_000, long, 10)
    await vi.waitFor(() => expect(long).toHaveBeenCalledTimes(1))
    // The next period comes while the first pass is still running: skipped.
    expect(await runOncePerEnvironment("t", 3_600_000, next, 3_600_000 + 5)).toBe(false)
    expect(next).not.toHaveBeenCalled()
    finish()
    expect(await first).toBe(true)
    // Done: a later period runs.
    expect(await runOncePerEnvironment("t", 3_600_000, next, 2 * 3_600_000 + 5)).toBe(true)
    // A pass that throws frees it too.
    await expect(runOncePerEnvironment("t", 3_600_000, async () => { throw new Error("boom") }, 3 * 3_600_000 + 5)).rejects.toThrow("boom")
    expect(await runOncePerEnvironment("t", 3_600_000, next, 4 * 3_600_000 + 5)).toBe(true)
    expect(next).toHaveBeenCalledTimes(2)
    vi.doUnmock("../../../lib/redis-lease.js")
  })

  it("a skipped period says so; a pass held past two periods is alerted; a shutdown gives the running lease back", async () => {
    const taken = new Map<string, string>()
    const kv = new Map<string, string>()
    vi.doMock("../../../lib/redis-lease.js", () => ({
      LEASE_KEY_PREFIX: "plugin:lease:",
      acquireLease: async (key: string) => (taken.has(key) ? null : (taken.set(key, "token"), "token")),
      releaseLease: async (key: string) => { taken.delete(key) },
    }))
    vi.doMock("../../../lib/queue.js", () => ({ redis: { set: async (k: string, v: string) => (kv.set(k, v), "OK"), get: async (k: string) => kv.get(k) ?? null } }))
    const { runOncePerEnvironment: run, releaseVideoRouteLeases } = await import("../video-route-watch.js")
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    let finish = () => {}
    const stuck = run("s", 15 * 60_000, () => new Promise<void>((resolve) => { finish = resolve }), 0)
    await vi.waitFor(() => expect([...taken.keys()].some((k) => k.endsWith(":s:running"))).toBe(true))
    // The next period: skipped, with a warning, no alert yet.
    expect(await run("s", 15 * 60_000, async () => {}, 15 * 60_000 + 5)).toBe(false)
    expect(warn.mock.calls.some((c) => String(c[0]).includes("still holds its running lease"))).toBe(true)
    expect((h.adminAlerts as Array<{ key: string }>).some((a) => a.key === "lease-held:s")).toBe(false)
    // Three periods later it still holds it: alerted.
    expect(await run("s", 15 * 60_000, async () => {}, 45 * 60_000 + 5)).toBe(false)
    expect((h.adminAlerts as Array<{ key: string }>).some((a) => a.key === "lease-held:s")).toBe(true)
    // A shutdown gives it back: the next period runs.
    await releaseVideoRouteLeases()
    expect([...taken.keys()].some((k) => k.endsWith(":s:running"))).toBe(false)
    expect(await run("s", 15 * 60_000, async () => {}, 60 * 60_000 + 5)).toBe(true)
    finish()
    await stuck
    warn.mockRestore()
    vi.doUnmock("../../../lib/redis-lease.js")
    vi.doUnmock("../../../lib/queue.js")
  })
})

describe("remindHeldSettlements — the daily reminder of settlements waiting for an admin", () => {
  const NOW = new Date("2026-11-25T00:20:00Z")
  it("says nothing while nothing waits", async () => {
    expect(await remindHeldSettlements(NOW)).toEqual({ count: 0, oldestAt: null })
    expect(alerts()).toEqual([])
    expect(h.adminAlerts).toEqual([])
  })

  it("raises one alert a day with how many wait and how long the oldest has waited", async () => {
    h.held = { count: 3, oldestAt: "2026-11-22T00:00:00Z" }
    await remindHeldSettlements(NOW)
    await remindHeldSettlements(NOW)
    expect(alerts().filter((m) => m.includes("3 routed settlement(s)") && m.includes("3 day(s)"))).toHaveLength(2)
    // Kept once for the day (the same key), so the Admin list shows one reminder, not one per call.
    expect((h.adminAlerts as Array<{ key: string }>).filter((a) => a.key === "holds-open:2026-11-25")).toHaveLength(1)
    await remindHeldSettlements(new Date("2026-11-26T00:20:00Z"))
    expect((h.adminAlerts as Array<{ key: string }>).map((a) => a.key).sort()).toEqual(["holds-open:2026-11-25", "holds-open:2026-11-26"])
  })

  it("never throws", async () => {
    h.heldFails = true
    expect(await remindHeldSettlements(NOW)).toBeNull()
  })
})

describe("the daily report lists sends that started and could never be read to an end", () => {
  it("alerts with their count and jobs, and counts neither them nor a send the route ended unbilled as a missing bill", async () => {
    route()
    h.settings = { video_route_policy: policy() }
    h.tasks = [
      { job_id: "j-ok", billed_usd: "5.000000" },
      { job_id: "j-lost", billed_usd: null, outcome: "unresolved" },
      { job_id: "j-lost", billed_usd: null, outcome: "unresolved" },
      { job_id: "j-failed", billed_usd: null, outcome: "failed" },
    ] as never
    await reconcileRouteSpend(new Date("2026-11-25T00:20:00Z"))
    const kept = (h.adminAlerts as Array<{ key: string; message: string }>)
    expect(kept.find((a) => a.key === "unresolved-sends:2026-11-24")?.message).toMatch(/2 routed send\(s\).*1 job\(s\): j-lost/)
    expect(kept.some((a) => a.key.startsWith("missing-receipts:"))).toBe(false)
  })
})

describe("reportLateBillsAndOrphans — the daily report of late bills and of settlements no server sweeps", () => {
  const NOW = new Date("2026-11-25T00:20:00Z")
  const kept = () => h.adminAlerts as Array<{ key: string; message: string }>

  it("says nothing when no bill arrived late and every other environment is alive", async () => {
    h.otherEnvs = [{ env: "staging", open: 4 }]
    h.aliveEnvs = ["staging"]
    await reportLateBillsAndOrphans(NOW)
    expect(kept()).toEqual([])
    expect(alerts()).toEqual([])
  })

  it("lists the bills that arrived after their run was settled or released: recorded, never charged", async () => {
    h.lateBills = 3
    await reportLateBillsAndOrphans(NOW)
    expect(kept().find((a) => a.key === "late-bills:2026-11-25")?.message).toMatch(/3 routed run\(s\).*as uncollected.*as the loss. Nothing more was charged/)
  })

  it("lists the repayments the database's retry gave up on: no longer retried, still owed", async () => {
    h.stuckRepayments = 2
    await reportLateBillsAndOrphans(NOW)
    expect(kept().find((a) => a.key === "stuck-repayments:2026-11-25")?.message).toMatch(/2 repayment\(s\).*no longer retried.*still owed/)
  })

  it("alerts on settlements open under an environment name that has gone quiet (a renamed environment)", async () => {
    h.otherEnvs = [{ env: "staging", open: 4 }, { env: "prod-old", open: 2 }]
    h.aliveEnvs = ["staging"]
    await reportLateBillsAndOrphans(NOW)
    const orphan = kept().filter((a) => a.key.startsWith("orphan-env:"))
    expect(orphan).toHaveLength(1)
    expect(orphan[0]!.message).toMatch(/2 routed settlement\(s\).*"prod-old"/)
  })
})

describe("a delivered send that was replaced after a step of ours failed is a known loss in the daily report", () => {
  it("counts its bill with the losses, not with what delivered jobs were charged for", async () => {
    route()
    h.settings = { video_route_policy: policy() }
    h.tasks = [
      { job_id: "j-voiced", billed_usd: "2.000000", detail: { ownLoss: true } },
      { job_id: "j-voiced", billed_usd: "3.000000" },
    ] as never
    const day = await reconcileRouteSpend(new Date("2026-11-25T00:20:00Z"))
    expect(day).toMatchObject({ recordedUsd: 3, lossesUsd: 2 })
  })
})
