// @test-units-by-name it names only video job types, never a node unit
/**
 * The daily reconciliation of the route's WHOLE account (video-route-account.ts),
 * through the real ledger and settings modules over one in-memory database:
 * the account's spend for each UTC day against everything recorded for it —
 * every environment's verified bills on the day the route billed them, sends
 * still to be billed at their estimate, and the cost of alternate-route jobs
 * with no routing decision — alerted both ways, once per account.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

const NOW = new Date("2026-11-25T00:20:00Z")
const h = vi.hoisted(() => ({ db: null as null | import("./helpers/fake-tables.js").FakeTables, alerts: [] as Array<{ key: string; message: string }>, env: "production", policy: {} as Record<string, unknown> | null }))
vi.mock("@/lib/runtime-env.js", () => ({ getRuntimeEnv: () => h.env }))
vi.mock("@/lib/supabase.js", () => ({ supabase: { from: (t: string) => h.db!.client.from(t), rpc: (n: string) => h.db!.client.rpc(n) } }))
vi.mock("@/lib/app-settings.js", () => ({ getAppSettings: async () => ({ video_route_policy: h.policy }), settingsReadFailed: () => false, invalidateSettingsCache: () => {} }))
vi.mock("../video-route-alerts.js", () => ({ recordVideoRouteAlert: async (a: { key: string; message: string }) => { h.alerts.push(a) } }))

const { createFakeTables } = await import("./helpers/fake-tables.js")
const { reconcileRouteAccount, ACCOUNT_ROW_KEY, ACCOUNT_DAYS_TRAILING } = await import("../video-route-account.js")
const { setPluginServices, _resetPluginServicesForTests } = await import("../../../lib/private-plugins/services-registry.js")
const { defaultVideoRoutePolicy } = await import("../../../lib/video-route-policy.js")
import type { PluginAlternateRoutesService } from "../../../lib/private-plugins/types.js"

/** What the route's account spent per UTC day; `spend(since)` answers everything from that day on. */
let daily: Record<string, number> = {}
const spend = vi.fn(async (since: string) => ({ actualUsd: Object.entries(daily).filter(([d]) => d >= since.slice(0, 10)).reduce((s, [, usd]) => s + usd, 0), videoSeconds: null }))

let id = 0
const task = (env: string, over: Record<string, unknown>) => ({ id: ++id, job_id: `job-${id}`, env, kind: "task", send: 1, key: "", ref: `t${id}`, billed_usd: null, estimated_usd: null, outcome: null, detail: null, created_at: "2026-11-24T12:00:00.000+00:00", updated_at: "2026-11-24T12:00:00.000+00:00", ...over })
const job = (over: Record<string, unknown>) => ({ id: `legacy-${++id}`, job_type: "image-to-video", provider_kind: "alternate-route", provider_cost: null, completed_at: "2026-11-24T15:00:00.000Z", stamp: null, run: null, ...over })
const keptDays = () => ((h.db!.rows("app_settings", { key: ACCOUNT_ROW_KEY })[0]?.value as { days?: Array<Record<string, unknown>> } | undefined)?.days ?? [])
const day = (d: string) => keptDays().find((k) => k.day === d)

function seed(ledger: Array<Record<string, unknown>>, jobs: Array<Record<string, unknown>> = [], keptDays: Array<Record<string, unknown>> = []) {
  h.db = createFakeTables({ video_route_ledger: ledger, jobs, ...(keptDays.length > 0 ? { app_settings: [{ key: ACCOUNT_ROW_KEY, value: { days: keptDays }, updated_at: "2026-11-24T00:20:00.000+00:00" }] } : {}) })
}

beforeEach(() => {
  h.alerts = []
  h.env = "production"
  h.policy = defaultVideoRoutePolicy() as unknown as Record<string, unknown>
  daily = {}
  spend.mockClear()
  _resetPluginServicesForTests()
  setPluginServices({ alternateRoutes: { accepts: () => null, start: async () => ({ taskRef: "x" }), poll: async () => ({ state: "running" }), prices: () => [], spend } as unknown as PluginAlternateRoutesService })
  vi.spyOn(console, "error").mockImplementation(() => {})
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
    expect(day("2026-11-24")).toMatchObject({ actualUsd: 3.2, ledgerUsd: 2.5, byEnv: { production: 1, staging: 1.5 }, unroutedUsd: 0.7, unroutedJobs: 1, unrecordedUsd: 0, overRecordedUsd: 0, env: "production" })
    expect(keptDays()).toHaveLength(ACCOUNT_DAYS_TRAILING)
    expect(h.alerts).toEqual([])
  })

  it("a bill counts on the day the route billed it, however late it reached the ledger, against the spend kept for that day", async () => {
    // The 22nd's spend was measured when it was the day just ended (the route is only asked for the day just ended).
    daily = { "2026-11-22": 99 }
    // First read done on the 22nd; its bill reached the ledger on the 24th.
    seed([task("production", { billed_usd: 4, created_at: "2026-11-22T10:00:00.000+00:00", detail: { billedAt: "2026-11-24T08:00:00.000Z" } })], [], [{ day: "2026-11-22", actualUsd: 4 }])
    await reconcileRouteAccount(NOW)
    expect(day("2026-11-22")).toMatchObject({ actualUsd: 4, ledgerUsd: 4, unrecordedUsd: 0, overRecordedUsd: 0 })
    expect(day("2026-11-24")).toMatchObject({ actualUsd: 0, ledgerUsd: 0, overRecordedUsd: 0 })
    // A day never measured is not compared (never read as nothing spent).
    expect(day("2026-11-23")).toMatchObject({ actualUsd: null, unrecordedUsd: null, overRecordedUsd: null })
    expect(spend.mock.calls.map((c) => c[0])).toEqual(["2026-11-24T00:00:00.000Z", "2026-11-25T00:00:00.000Z"])
    expect(h.alerts).toEqual([])
  })

  it("the account spending more than everything recorded is alerted (possible paid tasks nothing recorded), once until the difference grows", async () => {
    daily = { "2026-11-24": 5 }
    seed([task("production", { billed_usd: 2 })])
    await reconcileRouteAccount(NOW)
    const first = h.alerts.filter((a) => a.key === "account-unrecorded:2026-11-24")
    expect(first).toHaveLength(1)
    expect(first[0]!.message).toContain("3.00 USD more than everything recorded")
    expect(day("2026-11-24")).toMatchObject({ unrecordedUsd: 3, alerted: { unrecordedUsd: 3 } })
    // The next day's pass recomputes it: the same difference is not alerted again.
    await reconcileRouteAccount(new Date("2026-11-26T00:20:00Z"))
    expect(h.alerts.filter((a) => a.key === "account-unrecorded:2026-11-24")).toHaveLength(1)
  })

  it("a send delivered with no bill yet counts at the route's estimate, so a bill still to come is not read as spend nothing recorded", async () => {
    daily = { "2026-11-24": 3 }
    seed([task("production", { billed_usd: 1 }), task("staging", { billed_usd: null, estimated_usd: 2 })])
    await reconcileRouteAccount(NOW)
    expect(day("2026-11-24")).toMatchObject({ ledgerUsd: 1, pendingUsd: 2, unrecordedUsd: 0 })
    expect(h.alerts).toEqual([])
  })

  it("everything recorded coming to more than the account spent is alerted: the recorded bills may be wrong", async () => {
    daily = { "2026-11-24": 1 }
    seed([task("production", { billed_usd: 1 }), task("staging", { billed_usd: 2 })])
    await reconcileRouteAccount(NOW)
    expect(h.alerts.map((a) => a.key)).toEqual(["account-over-recorded:2026-11-24"])
    expect(h.alerts[0]!.message).toContain("may be wrong")
  })

  it("runs once per account: another environment finds the day claimed and skips; a claim that never finished is taken over after two hours", async () => {
    daily = { "2026-11-24": 5 }
    seed([])
    expect(await reconcileRouteAccount(NOW)).not.toBeNull()
    h.env = "staging"
    expect(await reconcileRouteAccount(new Date("2026-11-25T00:25:00Z"))).toBeNull()
    expect(h.alerts.filter((a) => a.key === "account-unrecorded:2026-11-24")).toHaveLength(1)
    // A pass that died holding its claim: a later pass takes the day once two hours have gone by.
    const row = h.db!.rows("app_settings", { key: ACCOUNT_ROW_KEY })[0]!
    row.value = { ...(row.value as Record<string, unknown>), claim: { day: "2026-11-24", env: "production", at: "2026-11-25T00:20:00.000Z" } }
    expect(await reconcileRouteAccount(new Date("2026-11-25T01:00:00Z"))).toBeNull()
    expect(await reconcileRouteAccount(new Date("2026-11-25T02:30:00Z"))).not.toBeNull()
    expect((h.db!.rows("app_settings", { key: ACCOUNT_ROW_KEY })[0]!.value as { claim: unknown }).claim).toMatchObject({ day: "2026-11-24", env: "staging", done: true })
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
