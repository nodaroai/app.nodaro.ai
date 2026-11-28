// @test-units-by-name it names only video job types, never a node unit
/**
 * The daily reconciliation of the route's WHOLE account (video-route-account.ts),
 * through the real ledger and settings modules over one in-memory database:
 * the account's spend for each UTC day against everything recorded for it —
 * every environment's verified bills on the day the route billed them, sends
 * still to be billed at their estimate, the cost of alternate-route jobs with no
 * routing decision and the known other spend — alerted both ways once a later
 * pass still sees it, with midnight straddles offset, once per account, and
 * retried the same day when it fails or cannot read the account.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

const NOW = new Date("2026-11-25T00:40:00Z")
const NEXT = new Date("2026-11-26T00:40:00Z")
const h = vi.hoisted(() => ({
  db: null as null | import("./helpers/fake-tables.js").FakeTables,
  alerts: [] as Array<{ key: string; message: string }>,
  env: "production",
  policy: {} as Record<string, unknown> | null,
  failJobsRead: 0,
  failAlert: "" as string,
}))
vi.mock("@/lib/runtime-env.js", () => ({ getRuntimeEnv: () => h.env }))
/** A read that fails like a dropped connection (every method chains; awaiting it answers the error). */
const failedRead = (): unknown => {
  const chain: Record<string, unknown> = new Proxy({}, { get: (_t, k) => (k === "then" ? (ok: (v: unknown) => unknown) => Promise.resolve({ data: null, error: { message: "connection reset" } }).then(ok) : () => chain) })
  return chain
}
vi.mock("@/lib/supabase.js", () => ({
  supabase: {
    from: (t: string) => {
      if (t === "jobs" && h.failJobsRead > 0) {
        h.failJobsRead--
        return failedRead()
      }
      return h.db!.client.from(t)
    },
    rpc: (n: string) => h.db!.client.rpc(n),
  },
}))
vi.mock("@/lib/app-settings.js", () => ({ getAppSettings: async () => ({ video_route_policy: h.policy }), settingsReadFailed: () => false, invalidateSettingsCache: () => {} }))
vi.mock("../video-route-alerts.js", () => ({
  recordVideoRouteAlert: async (a: { key: string; message: string }) => {
    if (h.failAlert && a.key.startsWith(h.failAlert)) throw new Error("settings row busy")
    h.alerts.push(a)
  },
}))

const { createFakeTables } = await import("./helpers/fake-tables.js")
const { reconcileRouteAccount, offsetMidnightStraddles, ACCOUNT_ROW_KEY, ACCOUNT_DAYS_TRAILING } = await import("../video-route-account.js")
const { setPluginServices, _resetPluginServicesForTests } = await import("../../../lib/private-plugins/services-registry.js")
const { defaultVideoRoutePolicy } = await import("../../../lib/video-route-policy.js")
import type { PluginAlternateRoutesService } from "../../../lib/private-plugins/types.js"

/** What the route's account spent per UTC day; `spend(since)` answers everything from that day on. */
let daily: Record<string, number> = {}
let spendFails = false
const spend = vi.fn(async (since: string) => (spendFails ? null : { actualUsd: Object.entries(daily).filter(([d]) => d >= since.slice(0, 10)).reduce((s, [, usd]) => s + usd, 0), videoSeconds: null }))

let id = 0
const task = (env: string, over: Record<string, unknown>) => ({ id: ++id, job_id: `job-${id}`, env, kind: "task", send: 1, key: "", ref: `t${id}`, billed_usd: null, estimated_usd: null, outcome: null, detail: null, created_at: "2026-11-24T12:00:00.000+00:00", updated_at: "2026-11-24T12:00:00.000+00:00", ...over })
const job = (over: Record<string, unknown>) => ({ id: `legacy-${++id}`, job_type: "image-to-video", provider_kind: "alternate-route", provider_cost: null, completed_at: "2026-11-24T15:00:00.000Z", stamp: null, run: null, ...over })
const row = () => h.db!.rows("app_settings", { key: ACCOUNT_ROW_KEY })[0]?.value as { claim?: Record<string, unknown>; days?: Array<Record<string, unknown>> } | undefined
const day = (d: string) => (row()?.days ?? []).find((k) => k.day === d)
const alertsOf = (prefix: string) => h.alerts.filter((a) => a.key.startsWith(prefix))

function seed(ledger: Array<Record<string, unknown>>, jobs: Array<Record<string, unknown>> = [], keptDays: Array<Record<string, unknown>> = []) {
  h.db = createFakeTables({ video_route_ledger: ledger, jobs, ...(keptDays.length > 0 ? { app_settings: [{ key: ACCOUNT_ROW_KEY, value: { days: keptDays }, updated_at: "2026-11-24T00:20:00.000+00:00" }] } : {}) })
}

beforeEach(() => {
  h.alerts = []
  h.env = "production"
  h.policy = defaultVideoRoutePolicy() as unknown as Record<string, unknown>
  h.failJobsRead = 0
  h.failAlert = ""
  daily = {}
  spendFails = false
  spend.mockClear()
  _resetPluginServicesForTests()
  setPluginServices({ alternateRoutes: { accepts: () => null, start: async () => ({ taskRef: "x" }), poll: async () => ({ state: "running" }), prices: () => [], spend } as unknown as PluginAlternateRoutesService })
  vi.spyOn(console, "error").mockImplementation(() => {})
  vi.spyOn(console, "warn").mockImplementation(() => {})
})

describe("the account's daily reconciliation", () => {
  it("holds the account's spend against every environment's bills and the unrouted jobs of the day, and stays quiet when they agree", async () => {
    daily = { "2026-11-24": 3.2 }
    seed(
      [task("production", { billed_usd: 1 }), task("staging", { billed_usd: 1.5 })],
      // An alternate-route job with no routing decision (it writes no ledger), and one that has one (on the ledger already).
      [job({ provider_cost: 0.7 }), job({ provider_cost: 9, stamp: { routeId: "r1" } })],
    )
    await reconcileRouteAccount(NOW)
    expect(day("2026-11-24")).toMatchObject({ status: "measured", actualUsd: 3.2, ledgerUsd: 2.5, byEnv: { production: 1, staging: 1.5 }, unroutedUsd: 0.7, unroutedJobs: 1, unrecordedUsd: 0, overRecordedUsd: 0, env: "production" })
    expect(row()?.days).toHaveLength(ACCOUNT_DAYS_TRAILING)
    expect(row()?.claim).toMatchObject({ day: "2026-11-24", done: true })
    expect(h.alerts).toEqual([])
  })

  it("a bill counts on the day the route billed it, however late it reached the ledger, against the spend kept for that day", async () => {
    // The 22nd's spend was measured when it was the day just ended (the route is only asked for recent days).
    daily = { "2026-11-22": 99 }
    seed([task("production", { billed_usd: 4, created_at: "2026-11-22T10:00:00.000+00:00", detail: { billedAt: "2026-11-24T08:00:00.000Z" } })], [], [{ day: "2026-11-22", status: "measured", actualUsd: 4 }])
    await reconcileRouteAccount(NOW)
    expect(day("2026-11-22")).toMatchObject({ status: "measured", actualUsd: 4, ledgerUsd: 4, unrecordedUsd: 0, overRecordedUsd: 0 })
    expect(day("2026-11-24")).toMatchObject({ actualUsd: 0, ledgerUsd: 0, overRecordedUsd: 0 })
    // A day older than the route's reach that was never measured is not compared (never read as nothing spent).
    expect(day("2026-11-21")).toMatchObject({ status: "unmeasured", actualUsd: null, unrecordedUsd: null, overRecordedUsd: null })
    // Only the recent days are asked for: the day just ended and the one before.
    expect(new Set(spend.mock.calls.map((c) => c[0]))).toEqual(new Set(["2026-11-23T00:00:00.000Z", "2026-11-24T00:00:00.000Z", "2026-11-25T00:00:00.000Z"]))
    expect(h.alerts).toEqual([])
  })

  it("the account spending more than everything recorded is alerted only when a later pass still sees it, and again only when it grows", async () => {
    daily = { "2026-11-24": 5 }
    seed([task("production", { billed_usd: 2 })])
    await reconcileRouteAccount(NOW)
    // Seen once: noted, not alerted (a late bill gets its chance first).
    expect(alertsOf("account-unrecorded:")).toEqual([])
    expect(day("2026-11-24")).toMatchObject({ unrecordedUsd: 3, unrecordedSince: "2026-11-24" })
    // The next day's pass still sees it: alerted.
    await reconcileRouteAccount(NEXT)
    expect(alertsOf("account-unrecorded:2026-11-24")).toHaveLength(1)
    expect(alertsOf("account-unrecorded:2026-11-24")[0]!.message).toContain("3.00 USD more than everything recorded")
    // The same difference on a later pass is not alerted again.
    await reconcileRouteAccount(new Date("2026-11-27T00:40:00Z"))
    expect(alertsOf("account-unrecorded:2026-11-24")).toHaveLength(1)
  })

  it("a late bill that explains the difference before the next pass raises nothing", async () => {
    daily = { "2026-11-24": 5 }
    seed([task("production", { billed_usd: 2 }), task("production", { billed_usd: null, outcome: "unresolved", created_at: "2026-11-24T20:00:00.000+00:00" })])
    await reconcileRouteAccount(NOW)
    // The given-up send's bill reaches the ledger the next day.
    Object.assign(h.db!.rows("video_route_ledger")[1]!, { billed_usd: 3, detail: { billedAt: "2026-11-24T22:00:00.000Z" } })
    await reconcileRouteAccount(NEXT)
    expect(day("2026-11-24")).toMatchObject({ ledgerUsd: 5, unrecordedUsd: 0 })
    expect(day("2026-11-24")?.unrecordedSince).toBeUndefined()
    expect(alertsOf("account-")).toEqual([])
  })

  it("the known other spend on the account is taken off before it alerts", async () => {
    h.policy = { ...(h.policy as Record<string, unknown>), accountOtherSpendUsdPerDay: 3 }
    daily = { "2026-11-24": 5, "2026-11-25": 3 }
    seed([task("production", { billed_usd: 2 })])
    await reconcileRouteAccount(NOW)
    await reconcileRouteAccount(NEXT)
    expect(day("2026-11-24")).toMatchObject({ otherSpendUsd: 3, unrecordedUsd: 0 })
    expect(alertsOf("account-unrecorded:")).toEqual([])
  })

  it("everything recorded coming to more than the account spent is alerted once a later pass still sees it: the recorded bills may be wrong", async () => {
    daily = { "2026-11-24": 1 }
    seed([task("production", { billed_usd: 1 }), task("staging", { billed_usd: 2 })])
    await reconcileRouteAccount(NOW)
    expect(h.alerts).toEqual([])
    await reconcileRouteAccount(NEXT)
    expect(h.alerts.map((a) => a.key)).toEqual(["account-over-recorded:2026-11-24"])
    expect(h.alerts[0]!.message).toContain("may be wrong")
  })

  it("a run that straddles midnight (spent on one day, recorded on the next) is offset between the two days, not alerted", async () => {
    // The route billed a 1.20 USD run on the 24th; the ledger placed it on the 25th.
    daily = { "2026-11-24": 3.2, "2026-11-25": 1 }
    seed([task("production", { billed_usd: 2 }), task("production", { billed_usd: 1.2, created_at: "2026-11-25T00:00:05.000+00:00" }), task("production", { billed_usd: 1, created_at: "2026-11-25T09:00:00.000+00:00" })])
    await reconcileRouteAccount(NEXT)
    await reconcileRouteAccount(new Date("2026-11-27T00:40:00Z"))
    expect(day("2026-11-24")).toMatchObject({ unrecordedUsd: 0, straddleUsd: 1.2 })
    expect(day("2026-11-25")).toMatchObject({ overRecordedUsd: 0, straddleUsd: 1.2 })
    expect(alertsOf("account-")).toEqual([])
  })

  it("runs once per account: another environment finds the day claimed and skips; a claim that never finished is taken over after two hours", async () => {
    daily = { "2026-11-24": 5 }
    seed([])
    expect(await reconcileRouteAccount(NOW)).not.toBeNull()
    h.env = "staging"
    expect(await reconcileRouteAccount(new Date("2026-11-25T01:40:00Z"))).toBeNull()
    // A pass that died holding its claim: a later pass takes the day once two hours have gone by.
    const r = h.db!.rows("app_settings", { key: ACCOUNT_ROW_KEY })[0]!
    r.value = { ...(r.value as Record<string, unknown>), claim: { day: "2026-11-24", env: "production", at: "2026-11-25T00:40:00.000Z" } }
    expect(await reconcileRouteAccount(new Date("2026-11-25T01:40:00Z"))).toBeNull()
    expect(await reconcileRouteAccount(new Date("2026-11-25T02:40:00Z"))).not.toBeNull()
    expect(row()?.claim).toMatchObject({ day: "2026-11-24", env: "staging", done: true })
  })

  it("a day whose account spend cannot be read stays pending, its claim goes back, and a later hour reads it and finishes the day", async () => {
    daily = { "2026-11-24": 2 }
    seed([task("production", { billed_usd: 2 })])
    spendFails = true
    await reconcileRouteAccount(NOW)
    expect(day("2026-11-24")).toMatchObject({ status: "pending", actualUsd: null })
    expect(row()?.claim).toBeUndefined()
    spendFails = false
    await reconcileRouteAccount(new Date("2026-11-25T01:40:00Z"))
    expect(day("2026-11-24")).toMatchObject({ status: "measured", actualUsd: 2, unrecordedUsd: 0 })
    expect(row()?.claim).toMatchObject({ day: "2026-11-24", done: true })
    expect(h.alerts).toEqual([])
  })

  it("a day still unread when the route no longer reports it is alerted once, and never compared", async () => {
    seed([task("production", { billed_usd: 2 })])
    spendFails = true
    for (const at of ["2026-11-25T00:40:00Z", "2026-11-26T00:40:00Z", "2026-11-27T00:40:00Z", "2026-11-28T00:40:00Z"]) await reconcileRouteAccount(new Date(at))
    expect(day("2026-11-24")).toMatchObject({ status: "unmeasured", actualUsd: null })
    expect(alertsOf("account-unmeasured:2026-11-24")).toHaveLength(1)
  })

  it("a pass that fails after its claim is alerted and gives its claim back, so a later hour runs it", async () => {
    daily = { "2026-11-24": 2 }
    seed([task("production", { billed_usd: 2 })])
    h.failJobsRead = 1
    expect(await reconcileRouteAccount(NOW)).toBeNull()
    expect(alertsOf("account-pass:2026-11-24")).toHaveLength(1)
    expect(row()?.claim).toBeUndefined()
    expect(await reconcileRouteAccount(new Date("2026-11-25T01:40:00Z"))).not.toBeNull()
    expect(row()?.claim).toMatchObject({ done: true })
  })

  it("an alert that cannot be kept never stops the pass", async () => {
    daily = { "2026-11-24": 9, "2026-11-23": 9 }
    seed([task("production", { billed_usd: 1 }), task("production", { billed_usd: 1, created_at: "2026-11-23T12:00:00.000+00:00" })])
    await reconcileRouteAccount(NOW)
    h.failAlert = "account-unrecorded:2026-11-23"
    await reconcileRouteAccount(NEXT)
    // The 23rd's alert could not be kept; the 24th's still was, and the day was kept and finished.
    expect(alertsOf("account-unrecorded:2026-11-24")).toHaveLength(1)
    expect(row()?.claim).toMatchObject({ day: "2026-11-25", done: true })
  })

  it("does nothing in an environment with no routing policy saved, or with no route that reports its spend", async () => {
    seed([])
    h.policy = null
    expect(await reconcileRouteAccount(NOW)).toBeNull()
    h.policy = defaultVideoRoutePolicy() as unknown as Record<string, unknown>
    _resetPluginServicesForTests()
    expect(await reconcileRouteAccount(NOW)).toBeNull()
    expect(h.db!.rows("app_settings")).toEqual([])
    expect(spend).not.toHaveBeenCalled()
  })
})

describe("offsetMidnightStraddles", () => {
  it("offsets a gap on one day against the neighbouring day's opposite excess, up to one clip's worth", () => {
    // Spent on day 1, recorded on day 2: one clip of 1.2.
    expect(offsetMidnightStraddles([{ unrecordedUsd: 1.2, overRecordedUsd: 0, clipUsd: 1.2 }, { unrecordedUsd: 0, overRecordedUsd: 1.2, clipUsd: 0.5 }])).toEqual([
      { unrecordedUsd: 0, overRecordedUsd: 0, straddleUsd: 1.2 },
      { unrecordedUsd: 0, overRecordedUsd: 0, straddleUsd: 1.2 },
    ])
    // And the other way round: recorded on day 1, spent on day 2.
    expect(offsetMidnightStraddles([{ unrecordedUsd: 0, overRecordedUsd: 0.8, clipUsd: 0.8 }, { unrecordedUsd: 0.8, overRecordedUsd: 0, clipUsd: 0 }])[1]).toEqual({ unrecordedUsd: 0, overRecordedUsd: 0, straddleUsd: 0.8 })
  })

  it("offsets no more than one clip's worth (never less than the midnight allowance), and nothing across a day with no figure", () => {
    const [a, b] = offsetMidnightStraddles([{ unrecordedUsd: 5, overRecordedUsd: 0, clipUsd: 1 }, { unrecordedUsd: 0, overRecordedUsd: 4, clipUsd: 0.6 }])
    expect(a).toEqual({ unrecordedUsd: 4, overRecordedUsd: 0, straddleUsd: 1 })
    expect(b).toEqual({ unrecordedUsd: 0, overRecordedUsd: 3, straddleUsd: 1 })
    expect(offsetMidnightStraddles([{ unrecordedUsd: 0.4, overRecordedUsd: 0, clipUsd: 0 }, { unrecordedUsd: 0, overRecordedUsd: 0.4, clipUsd: 0 }])[0]).toEqual({ unrecordedUsd: 0, overRecordedUsd: 0, straddleUsd: 0.4 })
    expect(offsetMidnightStraddles([{ unrecordedUsd: 1, overRecordedUsd: 0, clipUsd: 1 }, { unrecordedUsd: null, overRecordedUsd: null, clipUsd: 1 }, { unrecordedUsd: 0, overRecordedUsd: 1, clipUsd: 1 }])[0]).toEqual({ unrecordedUsd: 1, overRecordedUsd: 0, straddleUsd: 0 })
  })

  it("two gaps in the same direction are not a straddle", () => {
    expect(offsetMidnightStraddles([{ unrecordedUsd: 1, overRecordedUsd: 0, clipUsd: 1 }, { unrecordedUsd: 1, overRecordedUsd: 0, clipUsd: 1 }]).map((d) => d.straddleUsd)).toEqual([0, 0])
  })
})
