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
const h = vi.hoisted(() => ({ db: null as null | import("./helpers/fake-tables.js").FakeTables, alerts: [] as Array<{ key: string; message: string }>, failLedgerReads: 0 }))
vi.mock("@/lib/runtime-env.js", () => ({ getRuntimeEnv: () => "production" }))
/** A read of the ledger that fails like a dropped connection (every method chains; awaiting it answers the error). */
const failedRead = (): unknown => {
  const chain: Record<string, unknown> = new Proxy({}, { get: (_t, k) => (k === "then" ? (ok: (v: unknown) => unknown) => Promise.resolve({ data: null, error: { message: "connection reset" } }).then(ok) : () => chain) })
  return chain
}
vi.mock("@/lib/supabase.js", () => ({
  supabase: {
    from: (t: string) => {
      if (t === "video_route_ledger" && h.failLedgerReads > 0) {
        h.failLedgerReads--
        return failedRead()
      }
      return h.db!.client.from(t)
    },
    rpc: (n: string) => h.db!.client.rpc(n),
  },
}))
vi.mock("@/lib/app-settings.js", () => ({ getAppSettings: async () => ({ video_route_policy: { models: {} }, cost_markup_percent: 0, service_margin_percent: {} }), settingsReadFailed: () => false }))
vi.mock("../video-route-alerts.js", () => ({ recordVideoRouteAlert: async (a: { key: string; message: string }) => { h.alerts.push(a) } }))

const { createFakeTables } = await import("./helpers/fake-tables.js")
const { readLateBills, recoverRoutedSettlementOutcome } = await import("../video-route-settlement.js")
const { countLateBills } = await import("../../../lib/video-route-ledger.js")
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
    // (The reservation as the late-bill pass reads it: its metered receipt charged 100.)
    usage_logs: [{ id: "log", job_id: JOB, status: "committed", credits_charged: 100, receipt: { charged: 100, collected_over_hold: 0, shortfall: 0 } }],
    video_route_ledger: [
      { id: 1, job_id: JOB, env: "production", kind: "start", send: 1, key: "", ref: "t1", created_at: at, updated_at: at },
      ...tasks.map((t, i) => ({ id: 10 + i, job_id: JOB, env: "production", kind: "task", key: "", outcome: null, detail: null, created_at: at, updated_at: at, ...t })),
      { id: 2, job_id: JOB, env: "production", kind: "settle", send: 1, key: "", state: "done", credits: 100, uncollected: null, next_attempt_at: new Date(NOW - 60_000).toISOString(), detail: { watchUntil: new Date(NOW + 5 * 86_400_000).toISOString(), knownUsd: 0 }, created_at: at, updated_at: at },
    ],
  }, { now: () => NOW })
}

beforeEach(() => {
  h.alerts = []
  h.failLedgerReads = 0
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

  it("a watch whose starting figure was never kept records it on its first read: no late bill, nothing counted", async () => {
    // Charged 100 at a bill of 100; the watch started before its figure could be kept.
    settledAtQuote([{ send: 1, ref: "t1", billed_usd: CREDIT_BASE_USD * 100 }])
    settleRow().detail = { watchUntil: new Date(NOW + 5 * 86_400_000).toISOString() }
    expect(await readLateBills(NOW)).toEqual({ read: 1, arrived: 0 })
    expect(settleRow().detail).toMatchObject({ knownUsd: CREDIT_BASE_USD * 100, loss: { credits: 0, usd: 0 } })
    expect((settleRow().detail as Record<string, unknown>).lateBill).toBeUndefined()
    expect(h.alerts.some((a) => a.key === `late-bill:${JOB}`)).toBe(false)
    expect(await countLateBills(new Date(NOW - 86_400_000).toISOString())).toBe(0)
  })

  it("with no starting figure, a charge below what the run now costs is still a late bill", async () => {
    settledAtQuote([{ send: 1, ref: "t1", billed_usd: CREDIT_BASE_USD * 260 }])
    settleRow().detail = { watchUntil: new Date(NOW + 5 * 86_400_000).toISOString() }
    expect(await readLateBills(NOW)).toEqual({ read: 1, arrived: 1 })
    expect(settleRow()).toMatchObject({ uncollected: 160, detail: expect.objectContaining({ lateBill: expect.objectContaining({ chargedCredits: 100, differenceCredits: 160 }) }) })
    expect(await countLateBills(new Date(NOW - 86_400_000).toISOString())).toBe(1)
  })

  it("a short balance's late bill is measured against what its receipt charged, never what was collected, and its unpaid charge stays the database's", async () => {
    // Charged 100 at its quote; the balance covered none of it yet (0 collected, 100 owed): credits 0 is NOT "nothing charged".
    settledAtQuote([{ send: 1, ref: "t1", billed_usd: null }])
    Object.assign(settleRow(), { state: "shortfall", credits: 0, uncollected: 100 })
    // (Its receipt says only what was collected; the charge asked for is on its unpaid-charge record.)
    Object.assign(h.db!.rows("usage_logs")[0]!, { credits_charged: 0, receipt: { charged: 0, collected_over_hold: 0, shortfall: 100 } })
    h.db!.tables.video_route_debts = [{ id: 1, usage_log_id: "log", job_id: JOB, requested: 100, remaining: 100 }]
    poll.mockResolvedValue({ state: "done", resultUrl: "https://r/x.mp4", providerCostUsd: CREDIT_BASE_USD * 130, costBasis: "receipt" })
    expect(await readLateBills(NOW)).toEqual({ read: 1, arrived: 1 })
    expect(settleRow()).toMatchObject({ state: "shortfall", uncollected: 100, detail: expect.objectContaining({ lateBill: expect.objectContaining({ knownCredits: 130, chargedCredits: 100, differenceCredits: 30 }) }) })
    const alert = h.alerts.find((a) => a.key === `late-bill:${JOB}`)!
    expect(alert.message).toContain("against 100 charged")
    expect(alert.message).not.toContain("released or undelivered")
  })

  it("a run whose hold went back is read as not charged from its reservation, and its loss is corrected", async () => {
    // A failed run: its record says 0 credits and its hold was refunded; a send the route billed is our loss.
    settledAtQuote([{ send: 1, ref: "t1", billed_usd: null }])
    h.db!.rows("jobs")[0]!.status = "failed"
    Object.assign(settleRow(), { credits: 0, uncollected: 100 })
    Object.assign(h.db!.rows("usage_logs")[0]!, { status: "refunded", receipt: null })
    poll.mockResolvedValue({ state: "done", resultUrl: "https://r/x.mp4", providerCostUsd: CREDIT_BASE_USD * 120, costBasis: "receipt" })
    expect(await readLateBills(NOW)).toEqual({ read: 1, arrived: 1 })
    expect(settleRow()).toMatchObject({ uncollected: 120, detail: expect.objectContaining({ loss: { credits: 120, usd: CREDIT_BASE_USD * 120 } }) })
    expect(h.alerts.find((a) => a.key === `late-bill:${JOB}`)!.message).toContain("was not charged")
  })

  it("a run that was not charged whose loss was not known when it ended has it recorded and alerted once on its first read, never as a late bill", async () => {
    // A failed run: its hold was refunded, and its ledger could not be read when it ended (no figures kept).
    settledAtQuote([{ send: 1, ref: "t1", billed_usd: CREDIT_BASE_USD * 120 }])
    h.db!.rows("jobs")[0]!.status = "failed"
    Object.assign(settleRow(), { credits: 0, uncollected: null, detail: { watchUntil: new Date(NOW + 5 * 86_400_000).toISOString() } })
    Object.assign(h.db!.rows("usage_logs")[0]!, { status: "refunded", receipt: null })
    expect(await readLateBills(NOW)).toEqual({ read: 1, arrived: 0 })
    expect(settleRow()).toMatchObject({ uncollected: 120, detail: expect.objectContaining({ knownUsd: CREDIT_BASE_USD * 120, loss: { credits: 120, usd: CREDIT_BASE_USD * 120 } }) })
    expect(h.alerts.filter((a) => a.key === `loss-known:${JOB}`)).toHaveLength(1)
    expect(h.alerts.some((a) => a.key === `late-bill:${JOB}`)).toBe(false)
    expect(await countLateBills(new Date(NOW - 86_400_000).toISOString())).toBe(0)
  })

  it("a finished settlement with a retry time left over and no watch is taken off the list, with nothing recorded", async () => {
    settledAtQuote([{ send: 1, ref: "t1", billed_usd: null }])
    settleRow().detail = { firstAttemptAt: new Date(NOW - 86_400_000).toISOString() }
    expect(await readLateBills(NOW)).toEqual({ read: 0, arrived: 0 })
    expect(settleRow()).toMatchObject({ next_attempt_at: null, detail: { firstAttemptAt: expect.any(String) } })
    expect(poll).not.toHaveBeenCalled()
    expect(await countLateBills(new Date(NOW - 86_400_000).toISOString())).toBe(0)
  })

  describe("a charge whose record is finished by the sweep (its first settle stopped after the commit)", () => {
    /** The commit landed (its receipt is on the reservation); the settlement row is still `retry`. */
    function committedNotRecorded(tasks: Array<Record<string, unknown>>) {
      settledAtQuote(tasks)
      Object.assign(h.db!.rows("jobs")[0]!, { parent_job_id: null, defer: null, run: null })
      Object.assign(h.db!.rows("usage_logs")[0]!, { action: "seedance-2-5:8s:720p", credits_used: 100, mode: "video-route" })
      Object.assign(settleRow(), { state: "retry", credits: null, next_attempt_at: new Date(NOW - 3_600_000).toISOString(), detail: { firstAttemptAt: new Date(NOW - 3_600_000).toISOString() } })
    }

    it("starts the watch with its starting figures in the same write, so the first read records nothing", async () => {
      // Send 1 was replaced after a step of ours failed (billed 40: our loss); send 2, charged at its quote, has no bill yet.
      committedNotRecorded([{ send: 1, ref: "t1", billed_usd: CREDIT_BASE_USD * 40, detail: { ownLoss: true } }, { send: 2, ref: "t2", billed_usd: null }])
      expect(await recoverRoutedSettlementOutcome(JOB)).toBe("settled")
      expect(Date.parse(String(settleRow().next_attempt_at))).toBeGreaterThan(NOW)
      expect(settleRow()).toMatchObject({ state: "done", credits: 100, detail: expect.objectContaining({ knownUsd: CREDIT_BASE_USD * 40, loss: { credits: 40, usd: CREDIT_BASE_USD * 40 }, watchUntil: expect.any(String) }) })
      // The next read, with no bill yet: nothing arrived, nothing alerted (the replaced send's loss was already known).
      poll.mockResolvedValue({ state: "done", resultUrl: "https://r/x.mp4" })
      settleRow().next_attempt_at = new Date(NOW).toISOString()
      expect(await readLateBills(NOW + 60_000)).toEqual({ read: 1, arrived: 0 })
      expect(h.alerts.some((a) => a.key === `late-bill:${JOB}`)).toBe(false)
    })

    it("a bill that arrived after the charge was taken is not taken as the starting figure: the first read records it as a late bill", async () => {
      // Charged 100 at its quote; the route's bill of 260 reached the ledger before the sweep finished the record.
      committedNotRecorded([{ send: 1, ref: "t1", billed_usd: CREDIT_BASE_USD * 260 }, { send: 2, ref: "t2", billed_usd: null, outcome: "unresolved" }])
      expect(await recoverRoutedSettlementOutcome(JOB)).toBe("settled")
      expect((settleRow().detail as Record<string, unknown>).knownUsd).toBeUndefined()
      poll.mockResolvedValue({ state: "running" })
      settleRow().next_attempt_at = new Date(NOW).toISOString()
      expect(await readLateBills(NOW + 60_000)).toEqual({ read: 1, arrived: 1 })
      expect(settleRow()).toMatchObject({ uncollected: 160, detail: expect.objectContaining({ lateBill: expect.objectContaining({ chargedCredits: 100, differenceCredits: 160 }) }) })
    })

    it("a ledger that cannot be read leaves the settlement open for the sweep: its record is not finished without its watch", async () => {
      committedNotRecorded([{ send: 1, ref: "t1", billed_usd: null }])
      h.failLedgerReads = 1
      await expect(recoverRoutedSettlementOutcome(JOB)).rejects.toThrow(/route ledger/)
      expect(settleRow()).toMatchObject({ state: "retry", credits: null })
      expect(h.db!.rows("jobs")[0]!.credits_actual).toBeUndefined()
      // The sweep's next try finishes it, with its watch.
      expect(await recoverRoutedSettlementOutcome(JOB)).toBe("settled")
      expect(settleRow()).toMatchObject({ state: "done", detail: expect.objectContaining({ knownUsd: 0, watchUntil: expect.any(String) }) })
    })
  })
})
