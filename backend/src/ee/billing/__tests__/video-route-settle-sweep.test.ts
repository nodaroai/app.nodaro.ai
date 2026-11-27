// @test-units-by-name it names only Seedance price ids and video job types, never a node unit
/**
 * The routed settlement sweep (video-route-settlement.ts `retryRoutedSettlements`):
 * it settles ONLY settlements the ledger marks `retry`, at least ten minutes
 * old, of completed jobs that are not deferred children — never a held child
 * its parent will settle or release, never a job its own worker is settling
 * now — and past 48 h it alerts on every run instead of going quiet. The 48 h
 * run from the first settle really attempted on the terminal job that stayed
 * open, never from a pass that found the job still in flight. Then the
 * late-bill pass, and what an undelivered run's sends are recorded as.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

const NOW = Date.parse("2026-11-25T12:00:00Z")
const h = vi.hoisted(() => ({
  retryRows: [] as Array<{ job_id: string; created_at: string; updated_at?: string }>,
  alerts: vi.fn(async () => {}),
  jobs: {} as Record<string, Record<string, unknown>>,
  logs: {} as Record<string, Record<string, unknown>>,
  settled: [] as string[],
  marks: [] as unknown[][],
  lteBound: "",
  ledgerFails: false,
  billedUsd: 0,
  runSettles: [] as unknown[][],
  refunds: [] as string[],
  attempts: [] as unknown[][],
  unbilled: [] as unknown[][],
  closed: [] as Array<{ send: number; key: string; ref: string | null }>,
  closes: 0,
  resolves: [] as unknown[][],
  billedSeq: [] as Array<number | null>,
  patches: [] as unknown[][],
  watches: [] as unknown[],
  reopened: [] as unknown[][],
  resolved: 0,
  billed: 0,
  noTasks: false,
  ledger: null as Record<string, unknown> | null,
  ledgerSeq: [] as Array<Record<string, unknown>>,
  policy: { models: {} } as Record<string, unknown> | null,
  holds: [] as unknown[][],
  env: "production",
}))
// The re-read of the route (lib/video-route-resolve.ts) has its own suite: here, when it is asked and what follows.
vi.mock("@/lib/video-route-resolve.js", () => ({
  // (`resolved`: items the read changed. `billed`: sends that gained a verified bill. A test sets each on its own.)
  resolveRouteLedger: async (...a: unknown[]) => (h.resolves.push(a), { readable: true, resolved: h.resolved, billed: h.billed }),
  closeUnresolvedStarts: async () => (h.closes++, h.closed),
}))
// A routed run's own settlement (video-route-runs.ts) is the entry's other branch: seen here, tested there.
vi.mock("../video-route-runs.js", async (orig) => ({
  ...(await orig<typeof import("../video-route-runs.js")>()),
  settleRoutedRunJob: async (...a: unknown[]) => { h.runSettles.push(a) },
}))
vi.mock("../video-route-alerts.js", () => ({ recordVideoRouteAlert: h.alerts }))
vi.mock("../credits.js", async (orig) => ({
  ...(await orig<typeof import("../credits.js")>()),
  CreditsService: {
    commitCredits: async (logId: string, credits: number) => (h.settled.push(`${logId}:${credits}`), { charged: credits, collectedOverHold: 0, shortfall: 0 }),
    refundCredits: async (logId: string) => { h.refunds.push(logId); if (h.logs[logId]) h.logs[logId]!.status = "refunded" },
  },
}))

vi.mock("@/lib/supabase.js", () => ({
  supabase: {
    from: (table: string) => {
      let id = ""
      let cursor = 0
      const chain: Record<string, unknown> = {}
      for (const m of ["select", "order", "update"]) chain[m] = () => chain
      chain.eq = (c: string, v: string) => ((c === "id" ? (id = v) : undefined), chain)
      chain.lte = (_c: string, v: string) => ((h.lteBound = v), chain)
      chain.gt = (_c: string, v: number) => ((cursor = v), chain)
      chain.limit = async (limit: number) => ({ data: h.retryRows.map((r, i) => ({ ...r, id: i + 1 })).filter((r) => r.created_at <= h.lteBound && r.id > cursor).slice(0, limit), error: null })
      chain.maybeSingle = async () => ({ data: table === "jobs" ? h.jobs[id] ?? null : h.logs[id] ?? null, error: null })
      return chain
    },
  },
}))
vi.mock("@/lib/runtime-env.js", () => ({ getRuntimeEnv: () => h.env }))
vi.mock("@/lib/video-route-ledger.js", async (orig) => ({
  ...(await orig<typeof import("@/lib/video-route-ledger.js")>()),
  readRouteLedger: async () => {
    if (h.ledgerFails) throw new Error("still unreadable")
    // (A test can script successive reads: the bill arriving after a re-read; or put a whole ledger in place.)
    if (h.ledgerSeq.length) return h.ledgerSeq.shift()!
    if (h.ledger) return h.ledger
    if (h.noTasks) return { starts: [], tasks: [], segments: [], addonsBase: 0, settle: undefined }
    const billedUsd = h.billedSeq.length ? h.billedSeq.shift()! : (h.billedUsd as number | null)
    return { starts: [], tasks: [{ send: 1, ref: "t", billedUsd }], segments: [], addonsBase: 0, settle: undefined }
  },
  recordRouteSettle: async (...a: unknown[]) => { h.marks.push(a) },
  holdRouteSettle: async (...a: unknown[]) => (h.holds.push(a), true),
  noteRouteSettleAttempt: async (...a: unknown[]) => { h.attempts.push(a) },
  markRouteSettleUnbilled: async (...a: unknown[]) => (h.unbilled.push(a), true),
  patchRouteSettle: async (...a: unknown[]) => (h.patches.push(a), true),
  readLateBillWatches: async () => h.watches,
  reopenUnbilledSettle: async (...a: unknown[]) => (h.reopened.push(a), true),
}))
vi.mock("@/lib/app-settings.js", () => ({ getAppSettings: async () => ({ video_route_policy: h.policy }), settingsReadFailed: () => false }))

const mod = await import("../video-route-settlement.js")
const { videoRouteStamp } = await import("../../../lib/video-route-decision.js")
const { CREDIT_BASE_USD } = await import("@nodaro/shared/models")
const stamped = (jobId: string) => ({ __videoRoute: videoRouteStamp(jobId, { route: "alternate", routeId: "r1", service: "image-to-video" }, { model: "seedance-2-5", priceId: "seedance-2-5:8s:720p", requestKey: "rk", quotedUsd: CREDIT_BASE_USD * 100, quotedSec: 8, factor: 1, factorKey: "seedance-2-5:720p:noref:generate" }) })

const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString()
/** A whole ledger, as the store reads it. */
const ledgerOf = (over: Record<string, unknown> = {}) => ({ starts: [], tasks: [], segments: [], addonsBase: 0, settle: undefined, ...over })
const alertsOf = (key: string) => h.alerts.mock.calls.map((c) => (c as unknown as [{ key: string; message: string }])[0]).filter((a) => a.key === key)
/** The one write was the late-bill watch on the settle row: seven days of it, the next read `everyMs` from when it was started. */
const expectWatch = (jobId: string, everyMs: number) => {
  expect(h.patches).toEqual([[jobId, expect.objectContaining({ watchUntil: expect.any(String) }), { next_attempt_at: expect.any(String) }]])
  const [, kept, columns] = h.patches[0] as [string, { watchUntil: string }, { next_attempt_at: string }]
  expect(Date.parse(kept.watchUntil) - Date.parse(columns.next_attempt_at)).toBe(7 * 86_400_000 - everyMs)
}
const HOUR = 3_600_000

beforeEach(() => {
  h.retryRows = []
  h.jobs = {}
  h.logs = {}
  h.marks = []
  h.settled = []
  h.runSettles = []
  h.refunds = []
  h.attempts = []
  h.unbilled = []
  h.closed = []
  h.closes = 0
  h.resolves = []
  h.billedSeq = []
  h.patches = []
  h.watches = []
  h.reopened = []
  h.resolved = 0
  h.billed = 0
  h.noTasks = false
  h.ledger = null
  h.ledgerSeq = []
  h.policy = { models: {} }
  h.holds = []
  h.env = "production"
  h.alerts.mockClear()
  h.ledgerFails = false
  h.billedUsd = CREDIT_BASE_USD * 60
})

describe("retryRoutedSettlements", () => {
  it("leaves a fresh retry mark to its own worker (minimum age)", async () => {
    h.retryRows = [{ job_id: "j-fresh", created_at: iso(60_000) }]
    h.jobs["j-fresh"] = { status: "completed", usage_log_id: "l", parent_job_id: null, defer: null, ...stamped("j-fresh") }
    h.logs.l = { action: "seedance-2-5:8s:720p", credits_used: 100, job_id: "j-fresh", status: "reserved" }
    await mod.retryRoutedSettlements(NOW)
    expect(h.settled).toEqual([])
  })

  it("never settles a deferred child (a routed Remake child its parent releases later refunds in full)", async () => {
    h.retryRows = [{ job_id: "j-child", created_at: iso(20 * 60_000) }]
    h.jobs["j-child"] = { status: "completed", usage_log_id: "l", parent_job_id: "remake-1", defer: true, ...stamped("j-child") }
    h.logs.l = { action: "seedance-2-5:15s:720p-ref", credits_used: 490, job_id: "j-child", status: "reserved" }
    await mod.retryRoutedSettlements(NOW)
    expect(h.settled).toEqual([])
  })

  it("settles a completed job marked retry through the one entry, from its log", async () => {
    h.retryRows = [{ job_id: "j-1", created_at: iso(20 * 60_000) }]
    h.jobs["j-1"] = { status: "completed", usage_log_id: "l", parent_job_id: null, defer: null, ...stamped("j-1") }
    h.logs.l = { action: "seedance-2-5:8s:720p", credits_used: 100, job_id: "j-1", status: "reserved" }
    expect(await mod.retryRoutedSettlements(NOW)).toMatchObject({ scanned: 1, settled: 1 })
    // The entry's own figure from the ledger: the route billed 60.
    expect(h.settled).toEqual(["l:60"])
    // Settled: no clock was started for it.
    expect(h.patches).toEqual([])
  })

  it("a routed run its plugin never settled (a stopped or unassembled delivery on a host it does not gate for) is settled here, through the one entry", async () => {
    // The reservation marked the run for this sweep when it was held; the plugin left the hold alone.
    h.retryRows = [{ job_id: "j-run", created_at: iso(20 * 60_000) }]
    h.jobs["j-run"] = { status: "completed", usage_log_id: "l", parent_job_id: null, defer: null, run: { token: "run-token", usageLogId: "l", opts: { waiveFee: true } } }
    h.logs.l = { action: "generate-video-pro", credits_used: 400, job_id: "j-run", status: "reserved" }
    expect(await mod.retryRoutedSettlements(NOW)).toMatchObject({ scanned: 1, settled: 1, failed: 0 })
    expect(h.runSettles).toEqual([["l", "j-run", "run-token"]])
    expect(h.refunds).toEqual([])
  })

  it("a routed run that ended without a delivery and was never settled has its hold released here, once", async () => {
    h.retryRows = [{ job_id: "j-run", created_at: iso(20 * 60_000) }]
    h.jobs["j-run"] = { status: "cancelled", usage_log_id: "l", parent_job_id: null, defer: null, run: { token: "run-token", usageLogId: "l" } }
    h.logs.l = { action: "generate-video-pro", credits_used: 400, job_id: "j-run", status: "reserved" }
    expect(await mod.retryRoutedSettlements(NOW)).toMatchObject({ settled: 1, failed: 0 })
    expect(await mod.retryRoutedSettlements(NOW)).toMatchObject({ settled: 1, failed: 0 })
    expect(h.refunds).toEqual(["l"])
    expect(h.runSettles).toEqual([])
    expect(h.marks.at(-1)).toEqual(["j-run", "done", { credits: 0, note: "undelivered; refunded" }])
    // The route never worked on it: no loss, no watch, no alert.
    expect(h.patches).toEqual([])
    expect(alertsOf("undelivered-loss:j-run")).toEqual([])
  })

  it("a job not completed is not settled; a log settled meanwhile is marked done", async () => {
    h.retryRows = [{ job_id: "j-failed", created_at: iso(20 * 60_000) }, { job_id: "j-done", created_at: iso(20 * 60_000) }]
    h.jobs["j-failed"] = { status: "failed", usage_log_id: "l1", parent_job_id: null }
    h.jobs["j-done"] = { status: "completed", usage_log_id: "l2", parent_job_id: null }
    h.logs.l2 = { action: "seedance-2-5:8s:720p", credits_used: 100, job_id: "j-done", status: "committed", credits_charged: 77, receipt: { charged: 77, collected_over_hold: 0, shortfall: 0 } }
    await mod.retryRoutedSettlements(NOW)
    expect(h.settled).toEqual([])
    expect(h.marks).toEqual([["j-done", "done", { credits: 77 }]])
  })

  it("processes later pages even when the first 500 jobs remain open", async () => {
    h.retryRows = Array.from({ length: 501 }, (_, i) => ({ job_id: `j-${i}`, created_at: iso(3_600_000) }))
    for (const r of h.retryRows) h.jobs[r.job_id] = { status: "processing" }
    h.jobs["j-500"] = { status: "completed", usage_log_id: "l", ...stamped("j-500") }
    h.logs.l = { action: "seedance-2-5:8s:720p", credits_used: 100, job_id: "j-500", status: "reserved" }
    expect(await mod.retryRoutedSettlements(NOW)).toMatchObject({ scanned: 501, settled: 1 })
  })

  it("never marks a missing or unreceipted committed log done", async () => {
    h.retryRows = [{ job_id: "j-1", created_at: iso(3_600_000) }]
    h.jobs["j-1"] = { status: "completed", usage_log_id: "l" }
    expect(await mod.retryRoutedSettlements(NOW)).toMatchObject({ failed: 1 })
    h.logs.l = { job_id: "j-1", status: "committed", credits_charged: 99 }
    expect(await mod.retryRoutedSettlements(NOW)).toMatchObject({ failed: 1 })
    expect(h.marks).toEqual([])
  })

  describe("a delivered run the route has not billed yet", () => {
    const unbilledJob = (ageMs: number, attempts = 0, next_attempt_at: string | null = null) => {
      h.billedUsd = null as unknown as number
      // The 48 h run from the sweep's FIRST attempt on the settlement (kept on its row), not from the row's creation.
      h.retryRows = [{ job_id: "j-nobill", created_at: iso(ageMs + 7 * 86_400_000), attempts, next_attempt_at, detail: { firstAttemptAt: iso(ageMs) } } as never]
      h.jobs["j-nobill"] = { status: "completed", usage_log_id: "l", parent_job_id: null, defer: null, ...stamped("j-nobill") }
      h.logs.l = { action: "seedance-2-5:8s:720p", credits_used: 100, job_id: "j-nobill", status: "reserved" }
    }

    it("is read from the route again on each pass, and the next pass is put off with a growing wait", async () => {
      unbilledJob(30 * 60_000, 2)
      expect(await mod.retryRoutedSettlements(NOW)).toMatchObject({ scanned: 1, settled: 0, failed: 0 })
      // The settle read the route once more before giving up for this pass.
      expect(h.resolves).toEqual([["j-nobill", "r1"]])
      expect(h.settled).toEqual([])
      expect(h.attempts).toEqual([["j-nobill", 3, new Date(NOW + mod.routeBillBackoffMs(2))]])
      expect(h.unbilled).toEqual([])
    })

    it("is not asked again before its wait is over", async () => {
      unbilledJob(30 * 60_000, 2, new Date(NOW + 60_000).toISOString())
      expect(await mod.retryRoutedSettlements(NOW)).toMatchObject({ scanned: 0 })
      expect(h.resolves).toEqual([])
    })

    it("the waits are bounded: they double from 15 minutes and stop at 6 hours", () => {
      expect(mod.routeBillBackoffMs(0)).toBe(15 * 60_000)
      expect(mod.routeBillBackoffMs(1)).toBe(30 * 60_000)
      expect(mod.routeBillBackoffMs(5)).toBe(6 * 3_600_000)
      expect(mod.routeBillBackoffMs(500)).toBe(6 * 3_600_000)
    })

    it("past 48 h it stops being re-read: it waits for an admin, with one alert, and is never charged on a guess", async () => {
      unbilledJob(49 * 3_600_000, 11)
      const err = vi.spyOn(console, "error").mockImplementation(() => {})
      expect(await mod.retryRoutedSettlements(NOW)).toMatchObject({ scanned: 1, settled: 0, failed: 0 })
      expect(h.unbilled).toEqual([["j-nobill", expect.objectContaining({ note: expect.stringContaining("no bill") })]])
      expect(h.alerts.mock.calls.filter((c) => (c as unknown as [{ key: string }])[0].key === "unbilled:j-nobill")).toHaveLength(1)
      expect(h.settled).toEqual([])
      expect(h.refunds).toEqual([])
      expect(h.attempts).toEqual([])
      err.mockRestore()
    })

    it("past 48 h a send that never read to an end is recorded unresolved (a loss candidate), and the rest settles", async () => {
      unbilledJob(49 * 3_600_000, 11)
      h.closed = [{ send: 2, key: "", ref: "t2" }]
      // The pass's first settle finds no bill (read twice: once by the settle, once after its re-read
      // of the route would have changed something; here it changed nothing). After the close, the bill is there.
      const err = vi.spyOn(console, "error").mockImplementation(() => {})
      h.billedSeq = [null]
      h.billedUsd = CREDIT_BASE_USD * 60
      expect(await mod.retryRoutedSettlements(NOW)).toMatchObject({ settled: 1, failed: 0 })
      expect(h.closes).toBe(1)
      expect(h.alerts.mock.calls.some((c) => (c as unknown as [{ key: string }])[0].key === "unresolved:j-nobill")).toBe(true)
      expect(h.settled).toEqual(["l:60"])
      expect(h.unbilled).toEqual([])
      err.mockRestore()
    })
  })

  it("the 48 h run from the sweep's first attempt, written then: a run whose row was created long before it completed is not past it", async () => {
    // A long run: its settle row was written when it was held, three days before it completed.
    h.retryRows = [{ job_id: "j-long", created_at: iso(72 * 3_600_000) }]
    h.jobs["j-long"] = { status: "completed", usage_log_id: "l", parent_job_id: null, ...stamped("j-long") }
    h.logs.l = { action: "seedance-2-5:8s:720p", credits_used: 100, job_id: "j-long", status: "reserved" }
    h.ledgerFails = true
    const err = vi.spyOn(console, "error").mockImplementation(() => {})
    expect(await mod.retryRoutedSettlements(NOW)).toMatchObject({ stale: 0, failed: 1 })
    expect(h.patches).toContainEqual(["j-long", { firstAttemptAt: new Date(NOW).toISOString() }, {}])
    err.mockRestore()
  })

  describe("the 48 h clock starts at the first settle really attempted, never while the job is in flight", () => {
    const stale = (err: { mock: { calls: unknown[][] } }) => err.mock.calls.some((c) => String(c[0]).includes("open for more than 48 h"))

    it.each([
      ["still running", { status: "processing", usage_log_id: "l", parent_job_id: null, defer: null }],
    ])("a run whose row is 50 h old and is %s gets no clock and no alert, however many passes find it", async (_what, job) => {
      h.retryRows = [{ job_id: "j-flying", created_at: iso(50 * HOUR) }]
      h.jobs["j-flying"] = { ...job, ...stamped("j-flying") }
      h.logs.l = { action: "seedance-2-5:8s:720p", credits_used: 100, job_id: "j-flying", status: "reserved" }
      const err = vi.spyOn(console, "error").mockImplementation(() => {})
      for (let pass = 0; pass < 3; pass++) expect(await mod.retryRoutedSettlements(NOW + pass * HOUR)).toEqual({ scanned: 1, settled: 0, failed: 0, stale: 0 })
      expect(h.patches).toEqual([])
      expect(h.alerts).not.toHaveBeenCalled()
      expect(stale(err)).toBe(false)
      expect(h.settled).toEqual([])
      expect(h.refunds).toEqual([])
      err.mockRestore()
    })

    it("a terminal deferred child its parent has not settled or released is not silent: its clock starts, and past 48 h it is alerted on every pass", async () => {
      h.retryRows = [{ job_id: "j-child", created_at: iso(50 * HOUR) }]
      h.jobs["j-child"] = { status: "completed", usage_log_id: "l", parent_job_id: "parent-1", defer: true, ...stamped("j-child") }
      const err = vi.spyOn(console, "error").mockImplementation(() => {})
      expect(await mod.retryRoutedSettlements(NOW)).toEqual({ scanned: 1, settled: 0, failed: 0, stale: 0 })
      expect(h.patches).toEqual([["j-child", { firstAttemptAt: new Date(NOW).toISOString() }, {}]])
      expect(alertsOf("stale:j-child")).toEqual([])
      // Its parent still has not settled it 49 h later.
      h.patches = []
      h.retryRows = [{ job_id: "j-child", created_at: iso(99 * HOUR), detail: { firstAttemptAt: iso(49 * HOUR) } } as never]
      expect(await mod.retryRoutedSettlements(NOW)).toMatchObject({ stale: 1, settled: 0 })
      expect(alertsOf("stale:j-child")).toEqual([expect.objectContaining({ message: expect.stringContaining("its parent has not settled or released") })])
      // Never settled or released from here: its parent's settlement does that.
      expect(h.settled).toEqual([])
      expect(h.refunds).toEqual([])
      expect(h.patches).toEqual([])
      err.mockRestore()
    })

    it("a run in flight is not alerted even when its row carries an old clock: nothing was attempted on this pass", async () => {
      h.retryRows = [{ job_id: "j-flying", created_at: iso(60 * HOUR), detail: { firstAttemptAt: iso(50 * HOUR) } } as never]
      h.jobs["j-flying"] = { status: "processing", usage_log_id: "l", parent_job_id: null, defer: null, ...stamped("j-flying") }
      const err = vi.spyOn(console, "error").mockImplementation(() => {})
      expect(await mod.retryRoutedSettlements(NOW)).toEqual({ scanned: 1, settled: 0, failed: 0, stale: 0 })
      expect(h.patches).toEqual([])
      expect(h.alerts).not.toHaveBeenCalled()
      expect(stale(err)).toBe(false)
      err.mockRestore()
    })

    it("a run that completes 50 h after its row was written: its first settle that stays open starts the clock, and is not past it", async () => {
      // Held 50 h ago, completed just now; the route has not billed it yet.
      h.billedUsd = null as unknown as number
      h.retryRows = [{ job_id: "j-long", created_at: iso(50 * HOUR), attempts: 0 } as never]
      h.jobs["j-long"] = { status: "completed", usage_log_id: "l", parent_job_id: null, defer: null, ...stamped("j-long") }
      h.logs.l = { action: "seedance-2-5:8s:720p", credits_used: 100, job_id: "j-long", status: "reserved" }
      h.closed = [{ send: 2, key: "", ref: "t2" }]
      const err = vi.spyOn(console, "error").mockImplementation(() => {})
      expect(await mod.retryRoutedSettlements(NOW)).toEqual({ scanned: 1, settled: 0, failed: 0, stale: 0 })
      // The clock starts now, once.
      expect(h.patches).toEqual([["j-long", { firstAttemptAt: new Date(NOW).toISOString() }, {}]])
      // Inside its wait: read again later, as a fresh settlement is.
      expect(h.attempts).toEqual([["j-long", 1, new Date(NOW + mod.routeBillBackoffMs(0))]])
      // Not past: not handed to an admin as unbilled, its starts not given up on, nothing released, no alert of age.
      expect(h.unbilled).toEqual([])
      expect(h.closes).toBe(0)
      expect(h.refunds).toEqual([])
      expect(h.settled).toEqual([])
      expect(alertsOf("stale:j-long")).toEqual([])
      expect(alertsOf("unbilled:j-long")).toEqual([])
      expect(stale(err)).toBe(false)
      err.mockRestore()
    })

    it("the same run with nothing delivered on its ledger is not released on its first attempt either", async () => {
      h.noTasks = true
      h.retryRows = [{ job_id: "j-long", created_at: iso(50 * HOUR) }]
      h.jobs["j-long"] = { status: "completed", usage_log_id: "l", parent_job_id: null, defer: null, ...stamped("j-long") }
      h.logs.l = { action: "seedance-2-5:8s:720p", credits_used: 100, job_id: "j-long", status: "reserved" }
      const err = vi.spyOn(console, "error").mockImplementation(() => {})
      expect(await mod.retryRoutedSettlements(NOW)).toEqual({ scanned: 1, settled: 0, failed: 1, stale: 0 })
      expect(h.patches).toEqual([["j-long", { firstAttemptAt: new Date(NOW).toISOString() }, {}]])
      expect(h.refunds).toEqual([])
      expect(h.marks.some((m) => m[1] === "waived")).toBe(false)
      expect(alertsOf("undelivered:j-long")).toEqual([])
      err.mockRestore()
    })

    it("a clock already running is not started again", async () => {
      h.billedUsd = null as unknown as number
      h.retryRows = [{ job_id: "j-long", created_at: iso(50 * HOUR), attempts: 3, detail: { firstAttemptAt: iso(2 * HOUR) } } as never]
      h.jobs["j-long"] = { status: "completed", usage_log_id: "l", parent_job_id: null, defer: null, ...stamped("j-long") }
      h.logs.l = { action: "seedance-2-5:8s:720p", credits_used: 100, job_id: "j-long", status: "reserved" }
      const err = vi.spyOn(console, "error").mockImplementation(() => {})
      expect(await mod.retryRoutedSettlements(NOW)).toMatchObject({ stale: 0, failed: 0 })
      expect(h.patches).toEqual([])
      err.mockRestore()
    })

    it("a settlement this very attempt holds for an admin is neither a failure nor the start of a clock", async () => {
      // A bill ten times the quote: held, not charged.
      h.billedUsd = CREDIT_BASE_USD * 1000
      h.retryRows = [{ job_id: "j-held", created_at: iso(50 * HOUR) }]
      h.jobs["j-held"] = { status: "completed", usage_log_id: "l", parent_job_id: null, defer: null, ...stamped("j-held") }
      h.logs.l = { action: "seedance-2-5:8s:720p", credits_used: 100, job_id: "j-held", status: "reserved" }
      const err = vi.spyOn(console, "error").mockImplementation(() => {})
      expect(await mod.retryRoutedSettlements(NOW)).toEqual({ scanned: 1, settled: 0, failed: 0, stale: 0 })
      expect(h.holds).toEqual([["j-held", expect.objectContaining({ credits: 1000 })]])
      expect(h.settled).toEqual([])
      expect(h.patches).toEqual([])
      err.mockRestore()
    })
  })

  it("a completed run with nothing delivered on its ledger is released after the wait (never an eternal retry), with an alert", async () => {
    h.retryRows = [{ job_id: "j-empty", created_at: iso(60 * 3_600_000), detail: { firstAttemptAt: iso(50 * 3_600_000) } } as never]
    h.jobs["j-empty"] = { status: "completed", usage_log_id: "l", parent_job_id: null, ...stamped("j-empty") }
    h.logs.l = { action: "seedance-2-5:8s:720p", credits_used: 100, job_id: "j-empty", status: "reserved" }
    const ledgerMod = await import("../../../lib/video-route-ledger.js")
    void ledgerMod
    h.noTasks = true
    const err = vi.spyOn(console, "error").mockImplementation(() => {})
    expect(await mod.retryRoutedSettlements(NOW)).toMatchObject({ settled: 1, failed: 0 })
    expect(h.refunds).toEqual(["l"])
    expect(h.marks.at(-1)).toEqual(["j-empty", "waived", expect.objectContaining({ credits: 0, uncollected: 0 })])
    expect(h.alerts.mock.calls.some((c) => (c as unknown as [{ key: string }])[0].key === "undelivered:j-empty")).toBe(true)
    // No send of it ever started: nothing can have been billed, so the loss is 0 and the route is not watched.
    expect(h.patches).toEqual([])
    expect(alertsOf("undelivered:j-empty")[0]!.message).not.toContain("still read for its bill")
    err.mockRestore()
    h.noTasks = false
  })

  it.each([
    ["a send given up on unread", { tasks: [{ send: 1, ref: "t", billedUsd: null, outcome: "unresolved" }] }],
    ["a segment given up on unread", { segments: [{ key: "seg-1", ref: "s", billedUsd: null, outcome: "unresolved", priceId: null, quotedUsd: null, quotedCredits: null }] }],
    ["a segment start not read to an end", { unresolvedStarts: [{ send: 1, key: "seg-1", ref: "s" }] }],
  ])("a completed run with nothing delivered but %s is released with its hold recorded as the possible loss, and the route is watched for a bill", async (_what, ledger) => {
    h.retryRows = [{ job_id: "j-empty", created_at: iso(60 * HOUR), detail: { firstAttemptAt: iso(50 * HOUR) } } as never]
    h.jobs["j-empty"] = { status: "completed", usage_log_id: "l", parent_job_id: null, ...stamped("j-empty") }
    h.logs.l = { action: "seedance-2-5:8s:720p", credits_used: 140, job_id: "j-empty", status: "reserved" }
    h.ledger = ledgerOf(ledger)
    const err = vi.spyOn(console, "error").mockImplementation(() => {})
    expect(await mod.retryRoutedSettlements(NOW)).toMatchObject({ settled: 1, failed: 0, stale: 1 })
    // Nothing is charged: the hold goes back.
    expect(h.refunds).toEqual(["l"])
    expect(h.settled).toEqual([])
    // The route may have billed the send that started, but no bill is known: the loss is what the route
    // billed (nothing yet), never the hold with our own fee — and the route is watched for that bill.
    expect(h.marks.at(-1)).toEqual(["j-empty", "waived", { credits: 0, uncollected: 0, note: expect.stringContaining("recorded as the loss") }])
    expectWatch("j-empty", 24 * HOUR)
    expect(alertsOf("undelivered:j-empty")).toEqual([expect.objectContaining({ message: expect.stringContaining("still read for its bill") })])
    err.mockRestore()
  })

  it.each([
    ["a send the route ended with no result", { tasks: [{ send: 1, ref: "t", billedUsd: null, outcome: "failed" }] }],
    ["a send and a segment the route let expire", { tasks: [{ send: 1, ref: "t", billedUsd: null, outcome: "expired" }], segments: [{ key: "seg-1", ref: "s", billedUsd: null, outcome: "expired", priceId: null, quotedUsd: null, quotedCredits: null }] }],
  ])("a completed run with nothing delivered but %s is released with no loss and no watch: the route did not bill what it ended itself", async (_what, ledger) => {
    h.retryRows = [{ job_id: "j-empty", created_at: iso(60 * HOUR), detail: { firstAttemptAt: iso(50 * HOUR) } } as never]
    h.jobs["j-empty"] = { status: "completed", usage_log_id: "l", parent_job_id: null, ...stamped("j-empty") }
    h.logs.l = { action: "seedance-2-5:8s:720p", credits_used: 140, job_id: "j-empty", status: "reserved" }
    h.ledger = ledgerOf(ledger)
    const err = vi.spyOn(console, "error").mockImplementation(() => {})
    expect(await mod.retryRoutedSettlements(NOW)).toMatchObject({ settled: 1, failed: 0 })
    expect(h.refunds).toEqual(["l"])
    expect(h.marks.at(-1)).toEqual(["j-empty", "waived", { credits: 0, uncollected: 0, note: expect.not.stringContaining("recorded as the loss") }])
    expect(h.patches).toEqual([])
    expect(alertsOf("undelivered:j-empty")).toEqual([expect.objectContaining({ message: expect.not.stringContaining("still read for its bill") })])
    err.mockRestore()
  })

  describe("the late-bill pass (compared with the figure last RECORDED, not with what this read fetched)", () => {
    // A watch as a settlement starts it: its end, and the verified bills its figures were taken from (none yet).
    const watched = (state: string, over: Record<string, unknown> = {}) => ({ jobId: "j-late", state, credits: 100, uncollected: null, detail: { watchUntil: iso(-3 * 86_400_000), knownUsd: 0 }, ...over })
    const lateJob = () => {
      // (The decision as the settlement's own reads alias it.)
      h.jobs["j-late"] = { status: "completed", usage_log_id: "l", parent_job_id: null, ...stamped("j-late"), stamp: stamped("j-late").__videoRoute }
      h.logs.l = { action: "seedance-2-5:8s:720p", credits_used: 100, job_id: "j-late", status: "committed" }
    }
    const lateBillPatch = () => h.patches.find((p) => (p as [string, Record<string, unknown>])[1]?.lateBill !== undefined) as [string, Record<string, unknown>, Record<string, unknown>] | undefined

    it("nothing arrived: the route is read again on the slow cadence, and nothing else changes", async () => {
      lateJob()
      h.billedUsd = null as unknown as number
      h.watches = [watched("done")]
      expect(await mod.readLateBills(NOW)).toEqual({ read: 1, arrived: 0 })
      expect(h.resolves).toEqual([["j-late", "r1"]])
      expect(h.patches).toEqual([["j-late", {}, { next_attempt_at: new Date(NOW + 24 * 3_600_000).toISOString() }]])
      expect(h.settled).toEqual([])
    })

    it("a bill that arrives after a quote-settle is recorded with its difference and alerted, and NEVER charged", async () => {
      lateJob()
      // Before the read no bill (the quote, 100); after it the route's bill of 260.
      h.billedSeq = [null]
      h.billedUsd = CREDIT_BASE_USD * 260
      h.watches = [watched("done", { credits: 100 })]
      const err = vi.spyOn(console, "error").mockImplementation(() => {})
      expect(await mod.readLateBills(NOW)).toEqual({ read: 1, arrived: 1 })
      expect(h.patches).toEqual([["j-late", { lateBill: { at: new Date(NOW).toISOString(), billedUsd: CREDIT_BASE_USD * 260, knownCredits: 260, chargedCredits: 100, differenceCredits: 160, lossCredits: 0, lossUsd: 0 }, knownUsd: CREDIT_BASE_USD * 260, loss: { credits: 0, usd: 0 } }, { next_attempt_at: null, uncollected: 160 }]])
      expect(alertsOf("late-bill:j-late")).toHaveLength(1)
      // Nothing more is charged, and nothing is refunded.
      expect(h.settled).toEqual([])
      expect(h.refunds).toEqual([])
      err.mockRestore()
    })

    it("a bill FETCHED by an earlier read whose record was lost is found on the next pass all the same (no 'gained in this call' needed)", async () => {
      lateJob()
      // The bill is on the ledger already (another read fetched it); this pass's own read fetches nothing.
      h.billedUsd = CREDIT_BASE_USD * 260
      h.resolved = 0
      h.billed = 0
      h.watches = [watched("done", { credits: 100 })]
      const err = vi.spyOn(console, "error").mockImplementation(() => {})
      expect(await mod.readLateBills(NOW)).toEqual({ read: 1, arrived: 1 })
      expect(lateBillPatch()?.[2]).toEqual({ next_attempt_at: null, uncollected: 160 })
      expect(alertsOf("late-bill:j-late")).toHaveLength(1)
      // Once recorded, the same figure is not recorded again.
      h.patches = []
      h.alerts.mockClear()
      h.watches = [watched("done", { credits: 100, uncollected: 160, detail: { watchUntil: iso(-3 * 86_400_000), knownUsd: CREDIT_BASE_USD * 260 } })]
      expect(await mod.readLateBills(NOW)).toEqual({ read: 1, arrived: 0 })
      expect(lateBillPatch()).toBeUndefined()
      expect(h.alerts).not.toHaveBeenCalled()
      err.mockRestore()
    })

    it("a bill that arrives after a release records the route's bill as the loss: up, or DOWN from a figure that was higher", async () => {
      lateJob()
      h.billedSeq = [null]
      h.billedUsd = CREDIT_BASE_USD * 60
      // Released at the quote's 100; the route's real bill is 60.
      h.watches = [watched("waived", { credits: 0, uncollected: 100 })]
      const err = vi.spyOn(console, "error").mockImplementation(() => {})
      await mod.readLateBills(NOW)
      expect(lateBillPatch()).toEqual(["j-late", expect.objectContaining({ lateBill: expect.objectContaining({ lossCredits: 60, chargedCredits: 0 }), knownUsd: CREDIT_BASE_USD * 60 }), { next_attempt_at: null, uncollected: 60 }])
      expect(alertsOf("late-bill:j-late")[0]!.message).toContain("(it was 100)")
      expect(h.settled).toEqual([])
      err.mockRestore()
    })

    it("an unbilled settlement whose bill is on the ledger goes back to the settlement (by state, whoever fetched the bill)", async () => {
      lateJob()
      h.billedUsd = CREDIT_BASE_USD * 260
      h.resolved = 0
      h.billed = 0
      h.watches = [watched("unbilled", { credits: null })]
      await mod.readLateBills(NOW)
      expect(h.reopened).toEqual([["j-late"]])
      expect(h.settled).toEqual([])
    })

    it.each([["done", 24], ["waived", 24]] as const)("the route still answers done with no bill for a %s settlement: nothing is recorded or alerted, and it is read again", async (state, hours) => {
      lateJob()
      h.billedUsd = null as unknown as number
      h.resolved = 1
      h.billed = 0
      h.watches = [watched(state, state === "waived" ? { credits: 0, uncollected: 100 } : {})]
      const err = vi.spyOn(console, "error").mockImplementation(() => {})
      expect(await mod.readLateBills(NOW)).toEqual({ read: 1, arrived: 0 })
      expect(h.patches).toEqual([["j-late", {}, { next_attempt_at: new Date(NOW + hours * HOUR).toISOString() }]])
      expect(h.alerts).not.toHaveBeenCalled()
      expect(h.reopened).toEqual([])
      expect(err).not.toHaveBeenCalled()
      err.mockRestore()
    })

    it("an unbilled settlement still without its bill: its figures are refreshed only on a row still waiting, and it is read again", async () => {
      lateJob()
      h.billedUsd = null as unknown as number
      h.watches = [watched("unbilled", { credits: null })]
      expect(await mod.readLateBills(NOW)).toEqual({ read: 1, arrived: 0 })
      expect(h.patches).toEqual([["j-late", {}, { next_attempt_at: new Date(NOW + 6 * HOUR).toISOString(), credits: 100, quoted_usd: expect.any(Number) }, { onlyStates: ["unbilled"] }]])
      expect(h.reopened).toEqual([])
    })

    it("a bill arrived for a charged run whose new total cannot be computed just now: nothing is recorded on a guess, and the next pass finds the same change", async () => {
      lateJob()
      // Before the read: one delivered send, no bill. After it: a ledger no total can be computed from yet.
      h.ledgerSeq = [ledgerOf({ tasks: [{ send: 1, ref: "t", billedUsd: null }] }), ledgerOf({ tasks: [{ send: 1, ref: "t", billedUsd: CREDIT_BASE_USD * 260 }], unresolvedStarts: [{ send: 2, key: "", ref: "t2" }] })]
      h.watches = [watched("done")]
      const err = vi.spyOn(console, "error").mockImplementation(() => {})
      expect(await mod.readLateBills(NOW)).toEqual({ read: 1, arrived: 0 })
      expect(h.patches).toEqual([["j-late", {}, { next_attempt_at: new Date(NOW + 24 * HOUR).toISOString() }]])
      expect(h.alerts).not.toHaveBeenCalled()
      err.mockRestore()
    })

    it("a released run with no delivered send (no total to compute) is read again on the slow cadence until its watch ends", async () => {
      lateJob()
      // A send of it had started and was given up on: nothing delivered, no bill, and its bill may still come.
      h.ledger = ledgerOf({ tasks: [{ send: 1, ref: "t", billedUsd: null, outcome: "unresolved" }] })
      h.watches = [watched("waived", { credits: 0, uncollected: 0 })]
      expect(await mod.readLateBills(NOW)).toEqual({ read: 1, arrived: 0 })
      expect(h.resolves).toEqual([["j-late", "r1"]])
      expect(h.patches).toEqual([["j-late", {}, { next_attempt_at: new Date(NOW + 24 * HOUR).toISOString() }]])
      expect(h.alerts).not.toHaveBeenCalled()
      // Past its watch it is no longer read.
      h.patches = []
      h.watches = [watched("waived", { credits: 0, uncollected: 0, detail: { watchUntil: iso(60_000), knownUsd: 0 } })]
      await mod.readLateBills(NOW)
      expect(h.patches).toEqual([["j-late", {}, { next_attempt_at: null }]])
    })

    it("a given-up send whose bill arrives after the release is recorded as the loss (never charged)", async () => {
      lateJob()
      h.ledger = ledgerOf({ tasks: [{ send: 1, ref: "t", billedUsd: CREDIT_BASE_USD * 70, outcome: "unresolved" }] })
      h.watches = [watched("waived", { credits: 0, uncollected: 0 })]
      const err = vi.spyOn(console, "error").mockImplementation(() => {})
      expect(await mod.readLateBills(NOW)).toEqual({ read: 1, arrived: 1 })
      expect(lateBillPatch()?.[2]).toEqual({ next_attempt_at: null, uncollected: 70 })
      expect(h.settled).toEqual([])
      err.mockRestore()
    })

    it("a charged run's replaced send whose bill arrives keeps the watch going until it does, and records it as the loss", async () => {
      lateJob()
      // Send 1 was replaced (our loss) and has no bill; send 2, the delivered clip, was charged at its bill.
      h.ledger = ledgerOf({ tasks: [{ send: 1, ref: "t1", billedUsd: null, ownLoss: true }, { send: 2, ref: "t2", billedUsd: CREDIT_BASE_USD * 50 }] })
      h.watches = [watched("done", { credits: 50, detail: { watchUntil: iso(-3 * 86_400_000), knownUsd: CREDIT_BASE_USD * 50 } })]
      expect(await mod.readLateBills(NOW)).toEqual({ read: 1, arrived: 0 })
      // Still read: the replaced send may still be billed (not only the charged one counts).
      expect(h.patches).toEqual([["j-late", {}, { next_attempt_at: new Date(NOW + 24 * HOUR).toISOString() }]])
      // Its bill arrives: recorded as the loss beside the charge; the charge itself is unchanged.
      h.patches = []
      h.ledger = ledgerOf({ tasks: [{ send: 1, ref: "t1", billedUsd: CREDIT_BASE_USD * 40, ownLoss: true }, { send: 2, ref: "t2", billedUsd: CREDIT_BASE_USD * 50 }] })
      const err = vi.spyOn(console, "error").mockImplementation(() => {})
      expect(await mod.readLateBills(NOW)).toEqual({ read: 1, arrived: 1 })
      expect(lateBillPatch()).toEqual(["j-late", expect.objectContaining({ lateBill: expect.objectContaining({ lossCredits: 40, differenceCredits: 0 }), loss: { credits: 40, usd: CREDIT_BASE_USD * 40 } }), { next_attempt_at: null, uncollected: 0 }])
      expect(alertsOf("late-bill:j-late")[0]!.message).toContain("40 credits of sends not charged")
      err.mockRestore()
    })

    it("past its watch a settlement is no longer read", async () => {
      lateJob()
      h.billedUsd = null as unknown as number
      h.watches = [watched("done", { detail: { watchUntil: iso(60_000), knownUsd: 0 } })]
      await mod.readLateBills(NOW)
      expect(h.patches).toEqual([["j-late", {}, { next_attempt_at: null }]])
    })
  })

  describe("recoverRoutedSettlement", () => {
    const completed = (log: Record<string, unknown> = {}) => {
      h.jobs["j-1"] = { status: "completed", usage_log_id: "l", parent_job_id: null, defer: null, ...stamped("j-1") }
      h.logs.l = { action: "seedance-2-5:8s:720p", credits_used: 100, job_id: "j-1", status: "reserved", ...log }
    }

    it.each([["its reservation mode", { mode: "video-route" }], ["its routed mark", { mark: true }]])("settles a reservation marked routed (%s) on its route even when this process sees no routing policy", async (_what, mark) => {
      h.policy = null
      completed(mark)
      const err = vi.spyOn(console, "error").mockImplementation(() => {})
      expect(await mod.recoverRoutedSettlement("j-1")).toBe(true)
      expect(h.settled).toEqual(["l:60"])
      expect(err.mock.calls.some((c) => String(c[0]).includes("no routing policy saved"))).toBe(true)
      err.mockRestore()
    })

    it.each([["no mark at all", {}], ["another reservation mode and a mark that is not a plain yes", { mode: "default", mark: "true" }]])("with no routing policy and %s the reservation is not settled as routed", async (_what, mark) => {
      h.policy = null
      completed(mark)
      await expect(mod.recoverRoutedSettlement("j-1")).rejects.toThrow(/no verifiable decision/)
      expect(h.settled).toEqual([])
    })

    describe("a run that ended failed or cancelled after the route had worked on it", () => {
      const NOTE = "undelivered; refunded; the route's bills for it are our loss"
      const ended = (status: string) => {
        // (The decision as the settlement's own reads alias it.)
        h.jobs["j-gone"] = { status, usage_log_id: "l", parent_job_id: null, defer: null, ...stamped("j-gone"), stamp: stamped("j-gone").__videoRoute }
        h.logs.l = { action: "seedance-2-5:8s:720p", credits_used: 100, job_id: "j-gone", status: "reserved" }
      }

      it.each(["failed", "cancelled"])("%s with a delivered, billed send: the hold goes back, the send's bill is recorded as our loss, and one alert says so", async (status) => {
        ended(status)
        const err = vi.spyOn(console, "error").mockImplementation(() => {})
        expect(await mod.recoverRoutedSettlement("j-gone")).toBe(true)
        // Every send is read to its end once more before the hold is released.
        expect(h.resolves).toEqual([["j-gone", "r1"]])
        expect(h.closes).toBe(1)
        expect(h.refunds).toEqual(["l"])
        expect(h.settled).toEqual([])
        // The route billed 60: nothing charged, 60 recorded as uncollected.
        expect(h.marks).toEqual([["j-gone", "done", { credits: 0, uncollected: 60, note: NOTE }]])
        // Its bill is known: recorded beside it in USD too, and nothing left to watch the route for.
        expect(h.patches).toEqual([["j-gone", { loss: { credits: 60, usd: CREDIT_BASE_USD * 60 } }, {}]])
        expect(h.alerts).toHaveBeenCalledTimes(1)
        expect(alertsOf("undelivered-loss:j-gone")).toEqual([expect.objectContaining({ kind: "settlement", jobId: "j-gone", message: expect.stringContaining(`ended ${status}`) })])
        expect(alertsOf("undelivered-loss:j-gone")[0]!.message).toContain("60 credits")
        expect(alertsOf("undelivered-loss:j-gone")[0]!.message).not.toContain("still read")
        // A replay finds the hold released already, and records the same loss with the same one alert key.
        expect(await mod.recoverRoutedSettlement("j-gone")).toBe(true)
        expect(h.refunds).toEqual(["l"])
        expect(h.marks.at(-1)).toEqual(["j-gone", "done", { credits: 0, uncollected: 60, note: NOTE }])
        expect(h.alerts.mock.calls.map((c) => (c as unknown as [{ key: string }])[0].key)).toEqual(["undelivered-loss:j-gone", "undelivered-loss:j-gone"])
        err.mockRestore()
      })

      it("a delivered send the route has not billed yet: its quote is the recorded loss, and the route is watched for the bill", async () => {
        ended("cancelled")
        h.billedUsd = null as unknown as number
        const err = vi.spyOn(console, "error").mockImplementation(() => {})
        expect(await mod.recoverRoutedSettlement("j-gone")).toBe(true)
        expect(h.refunds).toEqual(["l"])
        expect(h.marks).toEqual([["j-gone", "done", { credits: 0, uncollected: 100, note: NOTE }]])
        // The loss at its best known figure (the quote, no markup), then the watch for its real bill.
        expect(h.patches[0]).toEqual(["j-gone", { loss: { credits: 100, usd: CREDIT_BASE_USD * 100 } }, {}])
        h.patches = h.patches.slice(1)
        expectWatch("j-gone", 24 * HOUR)
        expect(alertsOf("undelivered-loss:j-gone")).toEqual([expect.objectContaining({ message: expect.stringContaining("still read for a bill that has not come") })])
        expect(h.alerts).toHaveBeenCalledTimes(1)
        err.mockRestore()
      })

      it("a start closed unread and nothing delivered: no figure to record yet, and the route is watched for what it may bill", async () => {
        ended("cancelled")
        h.noTasks = true
        h.closed = [{ send: 1, key: "", ref: "a" }]
        const err = vi.spyOn(console, "error").mockImplementation(() => {})
        expect(await mod.recoverRoutedSettlement("j-gone")).toBe(true)
        expect(h.refunds).toEqual(["l"])
        // No amount is known: none is written (never a made-up one).
        expect(h.marks).toEqual([["j-gone", "done", { credits: 0, note: NOTE }]])
        expectWatch("j-gone", 24 * HOUR)
        expect(alertsOf("unresolved:j-gone")).toHaveLength(1)
        expect(alertsOf("undelivered-loss:j-gone")).toEqual([expect.objectContaining({ message: expect.stringContaining("0 credits") })])
        err.mockRestore()
      })

      it("the route never worked on it: refunded, with no loss, no watch and no alert", async () => {
        ended("failed")
        h.noTasks = true
        expect(await mod.recoverRoutedSettlement("j-gone")).toBe(true)
        expect(h.refunds).toEqual(["l"])
        expect(h.marks).toEqual([["j-gone", "done", { credits: 0, note: "undelivered; refunded" }]])
        expect(h.patches).toEqual([])
        expect(h.alerts).not.toHaveBeenCalled()
      })

      it("a hold that could not be confirmed released records nothing", async () => {
        ended("cancelled")
        h.logs.l!.status = "committed"
        await expect(mod.recoverRoutedSettlement("j-gone")).rejects.toThrow(/unconfirmed refund/)
        expect(h.marks).toEqual([])
        expect(alertsOf("undelivered-loss:j-gone")).toEqual([])
      })
    })
  })

  describe("another environment's job (staging and production share one database)", () => {
    it("a run token signed in another environment is refused BEFORE the run branch: nothing is written or settled", async () => {
      const { rowlessRouteToken, bindRowlessRouteToken } = await import("../../../lib/video-route-decision.js")
      h.env = "staging"
      const token = bindRowlessRouteToken(rowlessRouteToken({ routeId: "r1", model: "seedance-2-5", service: "generate-video-pro", feeChargedCredits: 10, reserveChargedCredits: 100, feeId: "gvp-fee" }), { parentJobId: "j-run", userId: "u" })!
      h.env = "production"
      h.jobs["j-run"] = { status: "completed", usage_log_id: "l", parent_job_id: null, run: { token, usageLogId: "other-log" } }
      h.logs.l = { action: "gvp-fee", credits_used: 100, job_id: "j-run", status: "reserved", mode: "video-route" }
      await expect(mod.settleRoutedJob({ usageLogId: "l", jobId: "j-run", log: { action: "gvp-fee", credits_used: 100, job_id: "j-run", routed: true } })).rejects.toThrow(mod.FOREIGN_ROUTED_RESERVATION)
      await expect(mod.recoverRoutedSettlement("j-run")).rejects.toThrow(mod.FOREIGN_ROUTED_RESERVATION)
      // Not even a retry mark (the usage logs differ, which would otherwise write one) under this environment.
      expect(h.marks).toEqual([])
      expect(h.runSettles).toEqual([])
      expect(h.settled).toEqual([])
      expect(h.refunds).toEqual([])
    })

    it("a decision stamped in another environment is refused before anything is released or recorded", async () => {
      h.env = "staging"
      const foreign = stamped("j-far")
      h.env = "production"
      h.jobs["j-far"] = { status: "failed", usage_log_id: "l", parent_job_id: null, ...foreign, stamp: foreign.__videoRoute }
      h.logs.l = { action: "seedance-2-5:8s:720p", credits_used: 100, job_id: "j-far", status: "reserved" }
      await expect(mod.recoverRoutedSettlement("j-far")).rejects.toThrow(mod.FOREIGN_ROUTED_RESERVATION)
      expect(h.refunds).toEqual([])
      expect(h.marks).toEqual([])
      expect(h.resolves).toEqual([])
    })
  })

  it("past 48 h a settlement still open is alerted on every run", async () => {
    h.retryRows = [{ job_id: "j-old", created_at: iso(50 * 3_600_000), updated_at: iso(1000), detail: { firstAttemptAt: iso(50 * 3_600_000) } } as never]
    h.jobs["j-old"] = { status: "completed", usage_log_id: "l", parent_job_id: null, ...stamped("j-old") }
    h.logs.l = { action: "seedance-2-5:8s:720p", credits_used: 100, job_id: "j-old", status: "reserved" }
    h.ledgerFails = true
    const err = vi.spyOn(console, "error").mockImplementation(() => {})
    expect(await mod.retryRoutedSettlements(NOW)).toMatchObject({ stale: 1, failed: 1 })
    expect(err.mock.calls.some((c) => String(c[0]).includes("open for more than 48 h"))).toBe(true)
    err.mockRestore()
  })
})
