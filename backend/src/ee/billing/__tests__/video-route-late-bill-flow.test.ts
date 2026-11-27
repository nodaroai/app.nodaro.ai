// @test-units-by-name it names only Seedance price ids and video job types, never a node unit
/**
 * A late bill, end to end through the REAL ledger, resolve and settlement
 * modules over one in-memory table (no resolver mock, no scripted counts):
 * the route's poll is the only thing faked. A bill is found by what the
 * ledger holds against the figure last recorded on the settlement, so a bill
 * fetched on a pass whose record failed is found on the next pass — it was
 * lost for good when only "bills gained by this read" counted.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

const NOW = Date.parse("2026-11-27T12:00:00Z")
const h = vi.hoisted(() => ({ db: null as null | import("./helpers/fake-tables.js").FakeTables, alerts: [] as Array<{ key: string; message: string }> }))
vi.mock("@/lib/runtime-env.js", () => ({ getRuntimeEnv: () => "production" }))
vi.mock("@/lib/supabase.js", () => ({ supabase: { from: (t: string) => h.db!.client.from(t), rpc: (n: string) => h.db!.client.rpc(n) } }))
vi.mock("@/lib/app-settings.js", () => ({ getAppSettings: async () => ({ video_route_policy: { models: {} }, cost_markup_percent: 0, service_margin_percent: {} }), settingsReadFailed: () => false }))
vi.mock("../video-route-alerts.js", () => ({ recordVideoRouteAlert: async (a: { key: string; message: string }) => { h.alerts.push(a) } }))

const { createFakeTables } = await import("./helpers/fake-tables.js")
const { readLateBills } = await import("../video-route-settlement.js")
const { videoRouteStamp } = await import("../../../lib/video-route-decision.js")
const { setPluginServices, _resetPluginServicesForTests } = await import("../../../lib/private-plugins/services-registry.js")
const { CREDIT_BASE_USD } = await import("@nodaro/shared/models")
import type { PluginAlternateRoutesService } from "../../../lib/private-plugins/types.js"

const JOB = "00000000-0000-4000-8000-00000000f001"
const stamp = () => videoRouteStamp(JOB, { route: "alternate", routeId: "r1", service: "image-to-video" }, { model: "seedance-2-5", priceId: "seedance-2-5:8s:720p", requestKey: "rk", quotedUsd: CREDIT_BASE_USD * 100, quotedSec: 8, factor: 1, factorKey: "seedance-2-5:720p:noref:generate" })
const poll = vi.fn()
const settleRow = () => h.db!.rows("video_route_ledger", { kind: "settle" })[0]!

/** A run settled at its quote (100 credits) while its one delivered send had no bill: watched for that bill. */
function settledAtQuote(tasks: Array<Record<string, unknown>>) {
  const at = new Date(NOW - 3_600_000).toISOString()
  h.db = createFakeTables({
    // (The job as the settlement's reads alias its decision.)
    jobs: [{ id: JOB, status: "completed", usage_log_id: "log", stamp: stamp() }],
    video_route_ledger: [
      { id: 1, job_id: JOB, env: "production", kind: "start", send: 1, key: "", ref: "t1", created_at: at, updated_at: at },
      ...tasks.map((t, i) => ({ id: 10 + i, job_id: JOB, env: "production", kind: "task", key: "", outcome: null, detail: null, created_at: at, updated_at: at, ...t })),
      { id: 2, job_id: JOB, env: "production", kind: "settle", send: 1, key: "", state: "done", credits: 100, uncollected: null, next_attempt_at: new Date(NOW - 60_000).toISOString(), detail: { watchUntil: new Date(NOW + 5 * 86_400_000).toISOString(), knownUsd: 0 }, created_at: at, updated_at: at },
    ],
  }, { now: () => NOW })
}

beforeEach(() => {
  h.alerts = []
  poll.mockReset()
  _resetPluginServicesForTests()
  setPluginServices({ alternateRoutes: { accepts: () => null, start: async () => ({ taskRef: "x" }), poll, prices: () => [] } as unknown as PluginAlternateRoutesService })
  vi.spyOn(console, "error").mockImplementation(() => {})
  vi.spyOn(console, "warn").mockImplementation(() => {})
})

describe("a late bill, through the real ledger", () => {
  it("fetched on a pass whose record FAILED, it is recorded on the next pass (the route is not asked again)", async () => {
    settledAtQuote([{ send: 1, ref: "t1", billed_usd: null }])
    poll.mockResolvedValue({ state: "done", resultUrl: "https://r/x.mp4", providerCostUsd: CREDIT_BASE_USD * 260, costBasis: "receipt" })
    // Pass 1: the route is read and the bill goes on the task row; the record of the late bill is lost.
    h.db!.failNextWrite("video_route_ledger", (patch) => (patch.detail as Record<string, unknown> | undefined)?.lateBill !== undefined)
    await readLateBills(NOW)
    expect(h.db!.rows("video_route_ledger", { kind: "task" })[0]).toMatchObject({ billed_usd: CREDIT_BASE_USD * 260 })
    expect(settleRow().uncollected).toBeNull()
    expect(h.alerts.some((a) => a.key === `settle-write:${JOB}`)).toBe(true)
    expect(poll).toHaveBeenCalledTimes(1)
    // Pass 2: nothing new is fetched (the task has its bill), and the bill is recorded all the same.
    expect(await readLateBills(NOW + 15 * 60_000)).toEqual({ read: 1, arrived: 1 })
    expect(poll).toHaveBeenCalledTimes(1)
    expect(settleRow()).toMatchObject({ uncollected: 160, next_attempt_at: null, detail: expect.objectContaining({ knownUsd: CREDIT_BASE_USD * 260, lateBill: expect.objectContaining({ knownCredits: 260, chargedCredits: 100, differenceCredits: 160 }) }) })
    expect(h.alerts.filter((a) => a.key === `late-bill:${JOB}`)).toHaveLength(1)
    // Pass 3 (were it due): the same figure is not recorded again.
    h.db!.rows("video_route_ledger", { kind: "settle" })[0]!.next_attempt_at = new Date(NOW).toISOString()
    expect(await readLateBills(NOW + 30 * 60_000)).toEqual({ read: 1, arrived: 0 })
    expect(h.alerts.filter((a) => a.key === `late-bill:${JOB}`)).toHaveLength(1)
  })

  it("a replaced send's bill keeps the watch reading after the charged send's bill is known, and is recorded as the loss", async () => {
    // Send 1 was replaced (our loss) and has no bill; send 2, the delivered clip, was billed at 100.
    settledAtQuote([{ send: 1, ref: "t1", billed_usd: null, detail: { ownLoss: true } }, { send: 2, ref: "t2", billed_usd: CREDIT_BASE_USD * 100 }])
    settleRow().detail = { watchUntil: new Date(NOW + 5 * 86_400_000).toISOString(), knownUsd: CREDIT_BASE_USD * 100 }
    poll.mockResolvedValueOnce({ state: "done", resultUrl: "https://r/x.mp4" })
    await readLateBills(NOW)
    // Still read: the replaced send may still be billed.
    expect(settleRow().next_attempt_at).toEqual(new Date(NOW + 24 * 3_600_000).toISOString())
    expect(h.alerts.some((a) => a.key === `late-bill:${JOB}`)).toBe(false)
    poll.mockResolvedValueOnce({ state: "done", resultUrl: "https://r/x.mp4", providerCostUsd: CREDIT_BASE_USD * 40, costBasis: "receipt" })
    settleRow().next_attempt_at = new Date(NOW).toISOString()
    expect(await readLateBills(NOW + 60_000)).toEqual({ read: 1, arrived: 1 })
    expect(settleRow()).toMatchObject({ uncollected: 0, next_attempt_at: null, detail: expect.objectContaining({ loss: { credits: 40, usd: CREDIT_BASE_USD * 40 } }) })
    // The own-loss mark is kept beside the bill, and when the bill was recorded.
    expect(h.db!.rows("video_route_ledger", { kind: "task", send: 1 })[0]!.detail).toEqual({ ownLoss: true, billedAt: expect.any(String) })
  })
})
