// The daily lane history: the gate's snapshot sampled into Redis each minute,
// upserted per environment every 5 minutes, pruned after 90 days. Runs on the
// JS twin of the history scripts and an in-memory database.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { enforcementPreconditions, resetEnforcementHooksForTests } from "../../../lib/concurrency-lanes/enforcement.js"
import { countLiveWaitExpiry, resetHistoryHooksForTests } from "../../../lib/concurrency-lanes/history-hooks.js"
import type { LaneSnapshot } from "../../../lib/concurrency-lanes/types.js"
import { makeFakeLaneDb, type FakeLaneDb } from "../../../lib/concurrency-lanes/__tests__/fake-lane-db.js"
import {
  HISTORY_FLUSH_INTERVAL_MS, HISTORY_SAMPLE_INTERVAL_MS, LaneHistory, MEASURE_DAY_MIN_SAMPLED_MINUTES, startLaneHistory, utcDay, type LaneHistoryDeps,
} from "../history.js"
import { fakeHistoryClient, makeFakeHistoryStore, type FakeHistoryStore } from "./fake-history-redis.js"

const refs = vi.hoisted(() => ({ recorder: null as null | ((e: unknown) => void), db: null as null | { client: { from(t: string): unknown } } }))
vi.mock("../../../lib/concurrency-lanes/queued-sweep.js", () => ({
  registerLaneQueueOutcomeRecorder: (fn: (e: unknown) => void) => { refs.recorder = fn },
}))
vi.mock("../../../lib/supabase.js", () => ({ supabase: { from: (t: string) => refs.db!.client.from(t) } }))

const U = "00000000-0000-4000-8000-000000000001"
const V = "00000000-0000-4000-8000-000000000002"
const T0 = Date.parse("2026-10-30T12:00:00Z")
const DAY_MS = 86_400_000
const zero = { running: 0, overLimit: 0, queued: 0 }

type Line = LaneSnapshot["lines"][number]
type Provider = LaneSnapshot["providers"][number]
const line = (userId: string, over: Partial<Omit<Line, "lanes" | "limits">> & { lanes?: Partial<Line["lanes"]>; limits?: Partial<Line["limits"]> } = {}): Line => ({
  userId,
  payer: `user:${userId}`,
  oldestWaitMs: 0,
  sources: {},
  mcpClients: {},
  ...over,
  lanes: { provider: zero, llm: zero, local: zero, run: zero, ...over.lanes },
  limits: { provider: 2, llm: 4, local: 4, run: 2, ...over.limits },
})
const provider = (p: string, over: Partial<Provider> = {}): Provider => ({
  provider: p, running: 0, byUser: {}, completed15m: 0, failed15m: 0, ceiling: null, outcomesByMinute: [], ...over,
})

interface Env { history: LaneHistory; store: FakeHistoryStore; setSnap: (s: Partial<LaneSnapshot>) => void }

let clock = T0
let db: FakeLaneDb

function makeHistory(env = "production", store = makeFakeHistoryStore()): Env {
  let snap: LaneSnapshot = { lines: [], providers: [], ungated: {}, notLimited: {}, enforced: false }
  const client = fakeHistoryClient(store)
  const deps: LaneHistoryDeps = {
    client: async () => client,
    snapshot: async () => snap,
    db: db.client,
    now: () => clock,
    env: () => env,
    prefix: "cl:v1:",
    callTimeoutMs: 1_000,
  }
  return { history: new LaneHistory(deps), store, setSnap: (s) => { snap = { ...snap, ...s } } }
}

/** Advance into the next flush window (each window is flushed once). */
async function flush(h: LaneHistory): Promise<void> {
  clock += HISTORY_FLUSH_INTERVAL_MS
  await h.flush()
}

const usage = (env = "production") => db.rows("lane_usage_daily").filter((r) => r.runtime_env === env)

beforeEach(() => {
  clock = T0
  db = makeFakeLaneDb()
  refs.db = db
  db.keys.lane_usage_daily = "day,runtime_env,user_id,payer"
  db.keys.lane_provider_daily = "day,runtime_env,provider"
  db.keys.lane_history_days = "day,runtime_env"
  db.foreignKeys["lane_usage_daily.user_id"] = "profiles"
  db.rows("profiles").push({ id: U }, { id: V })
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  resetHistoryHooksForTests()
  resetEnforcementHooksForTests()
})

describe("lane history", () => {
  it("peaks keep the maximum", async () => {
    const { history, setSnap } = makeHistory()
    setSnap({ lines: [line(U, { lanes: { provider: { running: 2, overLimit: 0, queued: 3 } }, oldestWaitMs: 90_000, sources: { mcp: 4 } })] })
    await history.sample()
    clock += 60_000
    setSnap({ lines: [line(U, { lanes: { provider: { running: 1, overLimit: 0, queued: 5 }, llm: { running: 3, overLimit: 0, queued: 0 } }, oldestWaitMs: 10_000, sources: { mcp: 1, editor: 2 } })] })
    await history.sample()
    clock += 60_000
    setSnap({ lines: [] })
    await history.sample()
    await flush(history)
    expect(usage()).toEqual([expect.objectContaining({
      day: "2026-10-30", user_id: U, payer: `user:${U}`,
      peak_running: { provider: 2, llm: 3, local: 0, run: 0 },
      peak_queued: { provider: 5, llm: 0, local: 0, run: 0 },
      longest_wait_ms: 90_000,
      peak_by_source: { mcp: 4, editor: 2 },
    })])
  })

  it("never stores an MCP client name: the history keeps sources only", async () => {
    const { history, setSnap } = makeHistory()
    setSnap({ lines: [line(U, { lanes: { provider: { running: 3, overLimit: 0, queued: 0 } }, sources: { mcp: 3 }, mcpClients: { "client-a desktop": 2, "x-client-secret-name": 1 } })] })
    await history.sample()
    await flush(history)
    const rows = usage()
    expect(rows).toEqual([expect.objectContaining({ peak_by_source: { mcp: 3 } })])
    expect(JSON.stringify(rows)).not.toMatch(/client-a desktop|x-client-secret-name/)
  })

  it("minutes at limit count sampled minutes", async () => {
    const a = makeHistory()
    const atLimit = line(U, { lanes: { provider: { running: 2, overLimit: 0, queued: 1 } } })
    a.setSnap({ lines: [atLimit] })
    await a.history.sample()
    await a.history.sample() // the same minute again: not another minute
    // A second process of the same environment (same Redis) sampling that minute adds nothing either.
    const b = makeHistory("production", a.store)
    b.setSnap({ lines: [atLimit] })
    await b.history.sample()
    clock += 60_000
    await a.history.sample()
    clock += 60_000
    a.setSnap({ lines: [line(U, { lanes: { provider: { running: 1, overLimit: 0, queued: 0 } } })] }) // under its size
    await a.history.sample()
    await flush(a.history)
    expect(usage()[0]).toMatchObject({ minutes_at_limit: 2 })
    expect(db.rows("lane_history_days")).toEqual([expect.objectContaining({ day: "2026-10-30", runtime_env: "production", sampled_minutes: 3, enforced_minutes: 0 })])
  })

  it("over-limit peaks are recorded in measure-only mode", async () => {
    const { history, setSnap } = makeHistory()
    // Limits off: 5 running on a size-2 lane, 3 of them only because nothing waits.
    setSnap({ enforced: false, lines: [line(U, { lanes: { provider: { running: 5, overLimit: 3, queued: 0 } } })] })
    await history.sample()
    await flush(history)
    expect(usage()[0]).toMatchObject({
      peak_running: { provider: 5, llm: 0, local: 0, run: 0 },
      peak_over_limit: { provider: 3, llm: 0, local: 0, run: 0 },
      minutes_at_limit: 1,
    })
  })

  it("upsert is idempotent", async () => {
    const { history, setSnap } = makeHistory()
    setSnap({
      lines: [line(U, { lanes: { llm: { running: 4, overLimit: 0, queued: 2 } } }), line(V, { payer: "workspace:W" })],
      providers: [provider("kie", { running: 3, ceiling: 3, outcomesByMinute: [{ minute: Math.floor(T0 / 60_000), completed: 4, failed: 1 }] })],
    })
    await history.sample()
    await flush(history)
    const strip = (rows: Record<string, unknown>[]) => rows.map(({ updated_at: _u, ...r }) => r)
    const first = { usage: strip(db.rows("lane_usage_daily")), prov: strip(db.rows("lane_provider_daily")), days: strip(db.rows("lane_history_days")) }
    await flush(history)
    await flush(history)
    expect({ usage: strip(db.rows("lane_usage_daily")), prov: strip(db.rows("lane_provider_daily")), days: strip(db.rows("lane_history_days")) }).toEqual(first)
    expect(first.usage.map((r) => `${String(r.user_id)}|${String(r.payer)}`).sort()).toEqual([`${U}|user:${U}`, `${V}|workspace:W`])
    expect(first.prov).toEqual([{ day: "2026-10-30", runtime_env: "production", provider: "kie", peak_running: 3, ceiling: 3, completed: 4, failed: 1, minutes_at_ceiling: 1 }])
  })

  it("an unchanged line is not rewritten", async () => {
    const { history, setSnap } = makeHistory()
    const upserts: Array<{ table: string; rows: Array<Record<string, unknown>> }> = []
    const from = db.client.from.bind(db.client)
    db.client.from = (t: string) => {
      const q = from(t) as { upsert: (rows: Array<Record<string, unknown>>, o: unknown) => unknown }
      const upsert = q.upsert.bind(q)
      q.upsert = (rows, o) => { upserts.push({ table: t, rows }); return upsert(rows, o) }
      return q
    }
    const busy = (running: number) => line(U, { lanes: { local: { running, overLimit: 0, queued: 0 } } })
    setSnap({ lines: [busy(1), line(V)], providers: [provider("kie", { running: 1 })] })
    await history.sample()
    await flush(history)
    const written = (table: string) => upserts.filter((u) => u.table === table).flatMap((u) => u.rows.map((r) => String(r.user_id ?? r.provider)))
    expect(written("lane_usage_daily").sort()).toEqual([U, V].sort())
    expect(written("lane_provider_daily")).toEqual(["kie"])
    upserts.length = 0
    // Next minutes: V and the provider unchanged, U's peak rises.
    clock += 60_000
    setSnap({ lines: [busy(3), line(V)], providers: [provider("kie", { running: 1 })] })
    await history.sample()
    await flush(history)
    expect(written("lane_usage_daily")).toEqual([U])
    expect(written("lane_provider_daily")).toEqual([])
    upserts.length = 0
    clock += 60_000
    setSnap({ lines: [busy(2), line(V)], providers: [provider("kie", { running: 1 })] })
    await history.sample()
    await flush(history)
    expect(written("lane_usage_daily")).toEqual([])
    // The day's sampled minutes are written each flush they moved (one row per environment and day).
    expect(upserts.filter((u) => u.table === "lane_history_days").flatMap((u) => u.rows)).toHaveLength(1)
    expect(usage().find((r) => r.user_id === U)).toMatchObject({ peak_running: { provider: 0, llm: 0, local: 3, run: 0 } })
  })

  it("an environment writes only its own rows", async () => {
    // Staging and production share the database, not their Redis.
    const prod = makeHistory("production")
    const staging = makeHistory("staging")
    prod.setSnap({ lines: [line(U, { lanes: { provider: { running: 2, overLimit: 0, queued: 0 } } })] })
    staging.setSnap({ lines: [line(U, { lanes: { provider: { running: 1, overLimit: 0, queued: 0 } } })], enforced: true })
    await prod.history.sample()
    await staging.history.sample()
    clock += HISTORY_FLUSH_INTERVAL_MS
    await prod.history.flush()
    await staging.history.flush()
    expect(usage("production").map((r) => (r.peak_running as Record<string, number>).provider)).toEqual([2])
    expect(usage("staging").filter((r) => r.day === "2026-10-30").map((r) => (r.peak_running as Record<string, number>).provider)).toEqual([1])
    // Each environment's sampled day is its own row.
    expect(db.rows("lane_history_days").map((r) => `${String(r.runtime_env)}:${String(r.enforced_minutes)}`).sort()).toEqual(["production:0", "staging:1"])
    // ...and each counts only its own measure-only days.
    db.rows("lane_history_days").push({ day: "2026-10-29", runtime_env: "production", sampled_minutes: 1440, enforced_minutes: 0 })
    expect(await prod.history.measureDays()).toBe(1)
    expect(await staging.history.measureDays()).toBe(0)
    // Production's prune never touches staging's rows, however old.
    db.rows("lane_usage_daily").push({ day: "2025-01-01", runtime_env: "staging", user_id: V, payer: `user:${V}` })
    await prod.history.prune()
    expect(usage("staging").some((r) => r.day === "2025-01-01")).toBe(true)
    // The Redis aggregates are keyed by environment too.
    expect([...prod.store.hashes.keys()].every((k) => k.startsWith("cl:v1:hist:production:"))).toBe(true)
  })

  it("prunes after 90 days", async () => {
    const { history } = makeHistory()
    const day = (n: number) => utcDay(T0 - n * DAY_MS)
    for (const n of [91, 90, 1]) {
      db.rows("lane_usage_daily").push({ day: day(n), runtime_env: "production", user_id: U, payer: `user:${U}` })
      db.rows("lane_provider_daily").push({ day: day(n), runtime_env: "production", provider: "kie" })
      db.rows("lane_history_days").push({ day: day(n), runtime_env: "production", sampled_minutes: 1, enforced_minutes: 0 })
    }
    db.rows("lane_usage_daily").push({ day: day(200), runtime_env: "staging", user_id: U, payer: `user:${U}` })
    await history.flush() // the first flush of the day prunes
    for (const t of ["lane_usage_daily", "lane_provider_daily", "lane_history_days"]) {
      expect(db.rows(t).filter((r) => r.runtime_env === "production").map((r) => r.day).sort(), t).toEqual([day(90), day(1)].sort())
    }
    expect(usage("staging")).toHaveLength(1)
    // Once a day: a later flush the same day prunes nothing more.
    db.rows("lane_history_days").push({ day: day(95), runtime_env: "production", sampled_minutes: 1, enforced_minutes: 0 })
    await flush(history)
    expect(db.rows("lane_history_days").some((r) => r.day === day(95))).toBe(true)
    clock += DAY_MS
    await history.flush()
    expect(db.rows("lane_history_days").some((r) => r.day === day(95))).toBe(false)
  })
})

describe("lane history — days, events and failures", () => {
  it("the minutes sampled before midnight are written by the first flush after it", async () => {
    clock = Date.parse("2026-10-30T23:58:30Z")
    const { history, setSnap } = makeHistory()
    setSnap({ lines: [line(U, { lanes: { run: { running: 2, overLimit: 0, queued: 0 } } })] })
    await history.sample()
    await history.flush()
    clock = Date.parse("2026-10-30T23:59:30Z")
    await history.sample()
    clock = Date.parse("2026-10-31T00:04:00Z")
    await history.flush()
    expect(usage().find((r) => r.day === "2026-10-30")).toMatchObject({ minutes_at_limit: 2 })
  })

  it("a provider's completed and failed calls are summed over the day's minutes, each once", async () => {
    const { history, setSnap } = makeHistory()
    const m = Math.floor(T0 / 60_000)
    setSnap({ providers: [provider("kie", { running: 1, outcomesByMinute: [{ minute: m, completed: 1, failed: 0 }] })] })
    await history.sample()
    clock += 60_000
    // The same minute seen again (now with more in it) and a new one.
    setSnap({ providers: [provider("kie", { running: 1, outcomesByMinute: [{ minute: m, completed: 2, failed: 1 }, { minute: m + 1, completed: 3, failed: 0 }] })] })
    await history.sample()
    await flush(history)
    expect(db.rows("lane_provider_daily")[0]).toMatchObject({ completed: 5, failed: 1, ceiling: null, minutes_at_ceiling: 0 })
  })

  it("a queue timeout and a live-wait expiry are counted; a lost entry is not a timeout", async () => {
    const { history } = makeHistory()
    history.recordQueueOutcome({ table: "jobs", rowId: "j1", userId: U, payer: `user:${U}`, reason: "timeout", waitedMs: 7_200_000 })
    history.recordQueueOutcome({ table: "jobs", rowId: "j2", userId: U, payer: `user:${U}`, reason: "lost", waitedMs: 9_000_000 })
    history.recordQueueOutcome({ table: "pipelines", rowId: "p1", userId: null, payer: null, reason: "timeout", waitedMs: 1 })
    history.recordQueueOutcome({ table: "jobs", rowId: "j3", userId: V, payer: "workspace:W", reason: "timeout", waitedMs: 60_000 })
    history.recordLiveWaitExpiry({ userId: U, payer: "workspace:W", waitedMs: 600_000 })
    await vi.waitFor(async () => {
      await flush(history)
      expect(usage()).toHaveLength(3)
    })
    // A workspace job's timeout counts on its workspace line.
    expect(usage().find((r) => r.user_id === V)).toMatchObject({ payer: "workspace:W", queue_timeouts: 1 })
    expect(usage().find((r) => r.payer === `user:${U}`)).toMatchObject({ queue_timeouts: 1, live_wait_expiries: 0, longest_wait_ms: 7_200_000 })
    expect(usage().find((r) => r.payer === "workspace:W" && r.user_id === U)).toMatchObject({ queue_timeouts: 0, live_wait_expiries: 1, longest_wait_ms: 600_000 })
  })

  it("lines that are not an account (no profile row possible) are not written", async () => {
    const { history, setSnap } = makeHistory()
    setSnap({ lines: [line("not-a-uuid"), line(U)] })
    await history.sample()
    await flush(history)
    expect(usage().map((r) => r.user_id)).toEqual([U])
  })

  it("an account deleted since it was sampled drops only its own rows", async () => {
    const { history, setSnap } = makeHistory()
    setSnap({ lines: [line(U), line(V)] })
    await history.sample()
    db.tables.set("profiles", db.rows("profiles").filter((r) => r.id !== V))
    await flush(history)
    expect(usage().map((r) => r.user_id)).toEqual([U])
    // Later flushes leave it out up front instead of failing the batch again.
    const upsert = vi.spyOn(history as unknown as { upsert: (t: string, rows: unknown[]) => Promise<boolean> }, "upsert")
    clock += 60_000
    setSnap({ lines: [line(U, { oldestWaitMs: 5 }), line(V, { oldestWaitMs: 5 })] })
    await history.sample()
    await flush(history)
    const usageCalls = upsert.mock.calls.filter((c) => c[0] === "lane_usage_daily")
    expect(usageCalls.map((c) => (c[1] as Array<{ user_id: string }>).map((r) => r.user_id))).toEqual([[U]])
  })

  it("missing tables are logged once and skipped, never thrown, and picked up once they exist", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)
    const { history, setSnap } = makeHistory()
    for (const t of ["lane_usage_daily", "lane_provider_daily", "lane_history_days"]) db.missingTables.add(t)
    setSnap({ lines: [line(U)], providers: [provider("kie", { running: 1 })] })
    await history.sample()
    await expect(flush(history)).resolves.toBeUndefined()
    await flush(history)
    await history.prune()
    expect(await history.measureDays()).toBe(0)
    const lines = warn.mock.calls.map((c) => String(c[0])).filter((m) => m.includes("not in this database yet"))
    expect(lines).toHaveLength(3) // once per table, however many flushes
    db.missingTables.clear()
    await flush(history)
    expect(usage()).toHaveLength(1)
  })

  it("Redis unreachable or not connected: sampling and flushing skip quietly", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined)
    const store = makeFakeHistoryStore()
    const client = { ...fakeHistoryClient(store), status: "reconnecting" }
    const history = new LaneHistory({ client: async () => client, snapshot: async () => ({ lines: [line(U)], providers: [], ungated: {}, notLimited: {}, enforced: false }), db: db.client, now: () => clock, env: () => "production", prefix: "cl:v1:", callTimeoutMs: 1_000 })
    await history.sample()
    await history.flush()
    expect(store.hashes.size).toBe(0)
    const hung = new LaneHistory({ client: async () => ({ eval: () => new Promise(() => {}) }) as never, snapshot: async () => ({ lines: [], providers: [], ungated: {}, notLimited: {}, enforced: false }), db: db.client, now: () => clock, env: () => "production", prefix: "cl:v1:", callTimeoutMs: 50 })
    await expect(hung.sample()).resolves.toBeUndefined()
    await expect(hung.flush()).resolves.toBeUndefined()
    const broken = new LaneHistory({ client: async () => client, snapshot: async () => { throw new Error("gate down") }, db: db.client, now: () => clock, env: () => "production", prefix: "cl:v1:", callTimeoutMs: 50 })
    await expect(broken.sample()).resolves.toBeUndefined()
  })
})

describe("measure-only days", () => {
  it("count only completed days sampled for at least 90 % of their minutes, never enforced, in this environment", async () => {
    const { history } = makeHistory()
    const day = (n: number) => utcDay(T0 - n * DAY_MS)
    expect(MEASURE_DAY_MIN_SAMPLED_MINUTES).toBe(1296)
    db.rows("lane_history_days").push(
      { day: day(0), runtime_env: "production", sampled_minutes: 1440, enforced_minutes: 0 }, // today: not complete
      { day: day(1), runtime_env: "production", sampled_minutes: 1296, enforced_minutes: 0 }, // counts
      { day: day(2), runtime_env: "production", sampled_minutes: 1295, enforced_minutes: 0 }, // too few minutes
      { day: day(3), runtime_env: "production", sampled_minutes: 1440, enforced_minutes: 1 }, // enforced once
      { day: day(4), runtime_env: "production", sampled_minutes: 1440, enforced_minutes: 0 }, // counts
      { day: day(5), runtime_env: "staging", sampled_minutes: 1440, enforced_minutes: 0 }, // another environment
      { day: day(91), runtime_env: "production", sampled_minutes: 1440, enforced_minutes: 0 }, // past the retention
    )
    expect(await history.measureDays()).toBe(2)
  })

  it("ticking every 30 s, the processes of one environment sample every minute exactly once, wherever their timers start", async () => {
    vi.useFakeTimers({ now: T0 + 7_000 })
    const store = makeFakeHistoryStore()
    const client = fakeHistoryClient(store)
    const snapshot = vi.fn(async (): Promise<LaneSnapshot> => ({ lines: [line(U)], providers: [], ungated: {}, notLimited: {}, enforced: false }))
    const deps = { client: async () => client, snapshot, db: db.client, env: () => "production", now: () => Date.now() }
    const stopA = await startLaneHistory(deps)
    await vi.advanceTimersByTimeAsync(17_000)
    const stopB = await startLaneHistory(deps)
    await vi.advanceTimersByTimeAsync(20 * 60_000)
    stopA()
    stopB()
    // From 12:00:07 to 12:20:24: minutes 12:00 … 12:20, each sampled once (12:00 by A's first tick at 12:00:37).
    expect(snapshot).toHaveBeenCalledTimes(21)
    expect(Number(store.hashes.get(`cl:v1:hist:production:d:${utcDay(T0)}:m`)?.get("sampled"))).toBe(21)
  })
})

describe("startLaneHistory", () => {
  it("registers the queue-timeout, live-wait and measure-days hooks, samples each minute and flushes every 5", async () => {
    vi.useFakeTimers({ now: T0 })
    const store = makeFakeHistoryStore()
    const client = fakeHistoryClient(store)
    const snapshot = vi.fn(async (): Promise<LaneSnapshot> => ({ lines: [line(U)], providers: [], ungated: {}, notLimited: {}, enforced: false }))
    const stop = await startLaneHistory({ client: async () => client, snapshot, db: db.client, env: () => "production", now: () => Date.now() })
    expect(HISTORY_SAMPLE_INTERVAL_MS).toBe(30_000)
    expect(HISTORY_FLUSH_INTERVAL_MS).toBe(300_000)
    await vi.advanceTimersByTimeAsync(60_000) // ticks at :30 (minute 0) and 1:00 (minute 1)
    expect(snapshot).toHaveBeenCalledTimes(2)
    refs.recorder!({ table: "jobs", rowId: "j", userId: U, payer: "workspace:W", reason: "timeout", waitedMs: 5 })
    countLiveWaitExpiry({ userId: U, payer: `user:${U}`, waitedMs: 3 })
    await vi.advanceTimersByTimeAsync(240_000) // to 5:00: minutes 2 … 5
    expect(snapshot).toHaveBeenCalledTimes(6)
    expect(usage().find((r) => r.payer === "workspace:W")).toMatchObject({ queue_timeouts: 1 })
    expect(usage().find((r) => r.payer === `user:${U}`)).toMatchObject({ live_wait_expiries: 1 })
    db.rows("lane_history_days").push({ day: "2026-10-29", runtime_env: "production", sampled_minutes: 1440, enforced_minutes: 0 })
    expect((await enforcementPreconditions()).measureDays).toBe(1)
    stop()
    stop()
    await vi.advanceTimersByTimeAsync(600_000)
    expect(snapshot).toHaveBeenCalledTimes(6)
  })
})
