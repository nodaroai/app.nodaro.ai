// backend/src/ee/concurrency-lanes/history.ts — the daily history of the
// concurrency lanes, kept 90 days and shown on Admin → Live usage as "Last 30
// days" (migration 572). Admin editions only: server.ts starts it under
// hasAdmin(), with a dynamic import.
//
// Per runtime environment. Staging and production share one database but not
// their Redis, so each environment samples its own gate and writes, prunes
// and reads only rows naming its own `runtime_env` (getRuntimeEnv()); its Redis
// keys carry the name too (`cl:v1:hist:<env>:`).
//
//   every 30 s     a process claims the current epoch minute (one claim per
//                  minute across the environment's processes); only the
//                  winner reads the gate's snapshot() and merges it into the
//                  day's Redis aggregates (history-scripts.ts): peaks by max,
//                  minutes_at_limit +1 when a lane runs at or above its size,
//                  the providers' per-minute outcomes into their own bucket
//                  (exact daily completed / failed while some process samples
//                  at least once every 15 minutes). Ticking twice a minute
//                  keeps a late timer from skipping one.
//   every 5 min    one process per window writes what changed: each sample
//                  marks the lines and providers whose numbers moved (and
//                  each counted event its line) dirty, and the flush upserts
//                  only those, read in batches outside Lua, yesterday's
//                  included (the last minutes before midnight). Once a day
//                  it prunes this environment's rows older than 90 days.
//   on events      a queue timeout (the queued sweep's hook, on the line the
//                  job waited in) and a live-wait expiry (history-hooks.ts)
//                  are counted into the day.
//
// Its numbers are the measure-only picture while lanes are off: running
// counts include the over-limit leases, so minutes at the limit and the
// over-limit peaks show who WOULD have waited. `peak_by_source` is the most
// jobs of each source running or waiting at once (sampled), not a count of
// jobs started.
//
// Quiet and bounded: no per-request DB write; every Redis call waits at most
// one gate-call timeout and is skipped while the client is not connected; a
// tick still running skips the next; the timers never keep a process alive. A
// missing table (staging before 572 reaches production) is logged once and the
// write skipped (its dirty set kept for the next flush). Nothing here ever
// throws into its caller.
import { LANE_GATE_CALL_TIMEOUT_MS, LANE_KEY_PREFIX } from "../../lib/concurrency-lanes/gate.js"
import { registerMeasureDaysReader } from "../../lib/concurrency-lanes/enforcement.js"
import { registerLiveWaitExpiryRecorder, type LiveWaitExpiry } from "../../lib/concurrency-lanes/history-hooks.js"
import { loadConcurrencyGate, warnLaneRateLimited } from "../../lib/concurrency-lanes/hold.js"
import { registerLaneQueueOutcomeRecorder, type LaneQueueOutcome } from "../../lib/concurrency-lanes/queued-sweep.js"
import type { ConcurrencyLane, LaneSnapshot } from "../../lib/concurrency-lanes/types.js"
import { getRuntimeEnv } from "../../lib/runtime-env.js"
import { historyKeys, LANE_HISTORY_SCRIPTS, type LaneHistoryScriptName } from "./history-scripts.js"

export const HISTORY_SAMPLE_INTERVAL_MS = 30_000
/** How long a minute's claim stands: past the minute, short of a stale key. */
export const HISTORY_MINUTE_CLAIM_TTL_MS = 180_000
export const HISTORY_FLUSH_INTERVAL_MS = 300_000
/** Days a history row is kept. */
export const HISTORY_RETENTION_DAYS = 90
/** How long the Redis aggregates live: long enough for the flushes after midnight to finish the day before. */
export const HISTORY_REDIS_TTL_MS = 3 * 86_400_000
/** Members read per SSCAN page (each one HGETALL, sent together). */
export const HISTORY_READ_BATCH = 200
/** Rows per upsert statement. */
export const HISTORY_UPSERT_CHUNK = 500
/** A completed day counts as measure-only data when at least this many of its 1,440 minutes were sampled (90 %), none enforced. */
export const MEASURE_DAY_MIN_SAMPLED_MINUTES = 1296

export const HISTORY_TABLES = ["lane_usage_daily", "lane_provider_daily", "lane_history_days"] as const
export type HistoryTable = (typeof HISTORY_TABLES)[number]
export const HISTORY_CONFLICT_KEYS: Record<HistoryTable, string> = {
  lane_usage_daily: "day,runtime_env,user_id,payer",
  lane_provider_daily: "day,runtime_env,provider",
  lane_history_days: "day,runtime_env",
}

const LANES: readonly ConcurrencyLane[] = ["provider", "llm", "local", "run"]
const DAY_MS = 86_400_000
const MINUTE_MS = 60_000
/** 42P01 / PGRST205: no such table; 42703 / PGRST204: no such column. */
const MISSING_SCHEMA_CODES = new Set(["42P01", "PGRST205", "42703", "PGRST204"])
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** The slice of an ioredis client the history uses; `status` other than "ready" skips the call. */
export interface HistoryClient {
  eval(script: string, numKeys: number, ...args: Array<string | number>): Promise<unknown>
  sscan(key: string, cursor: string, countToken: "COUNT", count: number): Promise<[string, string[]]>
  hgetall(key: string): Promise<Record<string, string>>
  unlink(...keys: string[]): Promise<number>
  set(key: string, value: string, px: "PX", ms: number): Promise<unknown>
  readonly status?: string
}

interface DbError { code?: string; message?: string }
interface DbResult { data?: unknown; error: DbError | null }
interface DbQuery extends PromiseLike<DbResult> {
  upsert(rows: Record<string, unknown>[], opts: { onConflict: string }): DbQuery
  delete(): DbQuery
  select(cols: string): DbQuery
  eq(col: string, val: unknown): DbQuery
  gte(col: string, val: string): DbQuery
  lt(col: string, val: string): DbQuery
}
/** The slice of the Supabase client the history uses. */
export interface HistoryDb { from(table: string): unknown }

export interface LaneHistoryDeps {
  client: () => Promise<HistoryClient>
  snapshot: () => Promise<LaneSnapshot>
  db: HistoryDb
  now: () => number
  /** This process's runtime environment, read at call time. */
  env: () => string
  /** Default: the gate's `cl:v1:`. */
  prefix: string
  /** How long one Redis call may take. */
  callTimeoutMs: number
}

/** The UTC day of an epoch-ms time, as YYYY-MM-DD. */
export function utcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

function bounded<T>(p: Promise<T>, ms: number): Promise<T> {
  p.catch(() => undefined)
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`no answer from Redis within ${ms} ms`)), ms)
    timer.unref?.()
  })
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer))
}

const num = (v: unknown): number => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}
const asArray = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : [])
const asMap = (v: unknown): Record<string, string> =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, string>) : {}

export class LaneHistory {
  private absentLogged = new Set<HistoryTable>()
  /** Accounts whose rows the database refused (deleted since sampled): left out of later flushes. */
  private deletedUsers = new Set<string>()

  constructor(private readonly deps: LaneHistoryDeps) {}

  private prefix(): string {
    return `${this.deps.prefix}hist:${this.deps.env()}:`
  }

  /** The connected client, or null while it is not. */
  private async ready(): Promise<HistoryClient | null> {
    const client = await this.deps.client()
    return typeof client.status === "string" && client.status !== "ready" ? null : client
  }

  /** One script call, bounded; null when the client is not connected. */
  private async run(name: LaneHistoryScriptName, req: Record<string, unknown>): Promise<Record<string, unknown> | null> {
    const client = await this.ready()
    if (!client) return null
    // Redis EVAL of the constant scripts in history-scripts.ts — nothing user-supplied is evaluated.
    const raw = await bounded(client.eval(LANE_HISTORY_SCRIPTS[name], 0, this.prefix(), HISTORY_REDIS_TTL_MS, JSON.stringify(req)), this.deps.callTimeoutMs)
    return JSON.parse(String(raw)) as Record<string, unknown>
  }

  private async claim(name: string, ttlMs: number): Promise<boolean> {
    const r = await this.run("claim", { name, ttlMs })
    return r?.claimed === true
  }

  /** Sample the gate into the day's aggregates, if this process is the first to claim the current minute. Never throws. */
  async sample(): Promise<void> {
    try {
      const now = this.deps.now()
      if (!(await this.claim(`tick:${Math.floor(now / MINUTE_MS)}`, HISTORY_MINUTE_CLAIM_TTL_MS))) return
      const snap = await this.deps.snapshot()
      const lines = snap.lines.map((l) => {
        const max: Record<string, number> = { lw: l.oldestWaitMs }
        let atLimit = false
        for (const lane of LANES) {
          const s = l.lanes[lane]
          max[`r:${lane}`] = s.running
          max[`q:${lane}`] = s.queued
          max[`o:${lane}`] = s.overLimit
          const limit = l.limits?.[lane] ?? 0
          if (limit > 0 && s.running >= limit) atLimit = true
        }
        for (const [src, n] of Object.entries(l.sources)) max[`s:${src}`] = n
        return { line: `${l.payer}|${l.userId}`, max, atLimit }
      })
      const providers = snap.providers.map((p) => ({
        p: p.provider, running: p.running, ceiling: p.ceiling, atCeiling: p.ceiling !== null && p.running >= p.ceiling,
      }))
      const outcomes = snap.providers.flatMap((p) => p.outcomesByMinute.map((o) => ({
        p: p.provider, day: utcDay(o.minute * MINUTE_MS), minute: o.minute, completed: o.completed, failed: o.failed,
      })))
      await this.run("sample", { day: utcDay(now), enforced: snap.enforced, lines, providers, outcomes })
    } catch (err) {
      warnLaneRateLimited("could not sample the lanes into the daily history", err)
    }
  }

  private count(userId: string | null, payer: string, field: "qt" | "lwe", waitedMs: number): void {
    if (!userId) return
    const req = { day: utcDay(this.deps.now()), line: `${payer}|${userId}`, field, waitedMs: Math.max(0, Math.round(waitedMs)) }
    void this.run("count", req).catch((err: unknown) => warnLaneRateLimited("could not count a lane event into the daily history", err))
  }

  /** A row the queued sweep ended: only a timeout is counted (a lost entry is not one), on the line it waited in. */
  recordQueueOutcome(e: LaneQueueOutcome): void {
    if (e.reason !== "timeout" || !e.userId) return
    this.count(e.userId, e.payer ?? `user:${e.userId}`, "qt", e.waitedMs)
  }

  recordLiveWaitExpiry(e: LiveWaitExpiry): void {
    this.count(e.userId, e.payer, "lwe", e.waitedMs)
  }

  /**
   * Write what changed on yesterday and today (one process per 5-minute
   * window), then — once a day — prune rows past the retention. Never throws.
   */
  async flush(): Promise<void> {
    try {
      const now = this.deps.now()
      if (!(await this.claim(`flush:${Math.floor(now / HISTORY_FLUSH_INTERVAL_MS)}`, HISTORY_FLUSH_INTERVAL_MS))) return
      for (const day of [utcDay(now - DAY_MS), utcDay(now)]) await this.flushDay(day)
      if (await this.claim(`prune:${utcDay(now)}`, DAY_MS + HISTORY_FLUSH_INTERVAL_MS)) await this.prune()
    } catch (err) {
      warnLaneRateLimited("could not write the daily lane history", err)
    }
  }

  private async flushDay(day: string): Promise<void> {
    const taken = await this.run("take", { day })
    const client = await this.ready()
    if (!taken || !client) return
    const h = this.prefix()
    const env = this.deps.env()
    const updatedAt = new Date(this.deps.now()).toISOString()

    const minutes = taken.minutes === null || taken.minutes === undefined ? null : asMap(taken.minutes)
    if (minutes) {
      const row = { day, runtime_env: env, sampled_minutes: num(minutes.sampled), enforced_minutes: num(minutes.enforced), updated_at: updatedAt }
      if (!(await this.upsert("lane_history_days", [row]))) {
        await bounded(client.set(historyKeys.minutesDirty(h, day), "1", "PX", HISTORY_REDIS_TTL_MS), this.deps.callTimeoutMs)
      }
    }
    if (taken.providers === true) {
      await this.writeWorkSet(client, historyKeys.providersWork(h, day), "lane_provider_daily", (p) => historyKeys.provider(h, day, p), (p, f) => {
        let completed = 0
        let failed = 0
        for (const [k, v] of Object.entries(f)) {
          if (!k.startsWith("o:")) continue
          if (k.endsWith(":c")) completed += num(v)
          else if (k.endsWith(":f")) failed += num(v)
        }
        return {
          day, runtime_env: env, provider: p, peak_running: num(f.pk), ceiling: f.ceil === undefined ? null : num(f.ceil),
          completed, failed, minutes_at_ceiling: num(f.mac), updated_at: updatedAt,
        }
      })
    }
    if (taken.lines === true) {
      await this.writeWorkSet(client, historyKeys.linesWork(h, day), "lane_usage_daily", (line) => historyKeys.line(h, day, line), (line, f) => {
        const bar = line.lastIndexOf("|")
        const payer = line.slice(0, bar)
        const userId = line.slice(bar + 1)
        // Only a real account has a history row (the table's key references profiles).
        if (bar <= 0 || !UUID.test(userId) || this.deletedUsers.has(userId)) return null
        const perLane = (k: string) => Object.fromEntries(LANES.map((lane) => [lane, num(f[`${k}:${lane}`])]))
        const bySource = Object.fromEntries(Object.entries(f).filter(([k]) => k.startsWith("s:")).map(([k, v]) => [k.slice(2), num(v)]))
        return {
          day, runtime_env: env, user_id: userId, payer,
          peak_running: perLane("r"), peak_queued: perLane("q"), peak_over_limit: perLane("o"),
          longest_wait_ms: num(f.lw), minutes_at_limit: num(f.mal), queue_timeouts: num(f.qt), live_wait_expiries: num(f.lwe),
          peak_by_source: bySource, updated_at: updatedAt,
        }
      })
    }
  }

  /**
   * Read a work set page by page (SSCAN, then the page's hashes together),
   * upsert each page, and delete the set once every page is written. A
   * failed page leaves the set for the next flush, which merges into it.
   */
  private async writeWorkSet(
    client: HistoryClient,
    work: string,
    table: HistoryTable,
    keyOf: (member: string) => string,
    rowOf: (member: string, fields: Record<string, string>) => Record<string, unknown> | null,
  ): Promise<void> {
    const t = this.deps.callTimeoutMs
    let cursor = "0"
    do {
      const [next, members] = await bounded(client.sscan(work, cursor, "COUNT", HISTORY_READ_BATCH), t)
      cursor = next
      const unique = [...new Set(members)]
      const hashes = await bounded(Promise.all(unique.map((m) => client.hgetall(keyOf(m)))), t)
      const rows = unique.flatMap((m, i) => {
        const row = rowOf(m, hashes[i] ?? {})
        return row ? [row] : []
      })
      if (!(await this.upsert(table, rows))) return
    } while (cursor !== "0")
    await bounded(client.unlink(work), t)
  }

  private query(table: HistoryTable): DbQuery {
    return this.deps.db.from(table) as DbQuery
  }

  /** True when the error is the table's absence (logged once per table per process). */
  private absent(table: HistoryTable, error: DbError): boolean {
    if (!error.code || !MISSING_SCHEMA_CODES.has(error.code)) return false
    if (!this.absentLogged.has(table)) {
      this.absentLogged.add(table)
      console.warn(`[concurrency-lanes] ${table} is not in this database yet; the daily lane history is not written until it is`)
    }
    return true
  }

  /** Upsert rows in chunks; false when a chunk could not be written (the caller keeps it for the next flush). */
  private async upsert(table: HistoryTable, rows: Record<string, unknown>[]): Promise<boolean> {
    for (let i = 0; i < rows.length; i += HISTORY_UPSERT_CHUNK) {
      const chunk = rows.slice(i, i + HISTORY_UPSERT_CHUNK)
      const { error } = await this.query(table).upsert(chunk, { onConflict: HISTORY_CONFLICT_KEYS[table] })
      if (!error) continue
      if (this.absent(table, error)) return false
      if (error.code !== "23503") {
        warnLaneRateLimited(`could not write ${table}`, error)
        return false
      }
      // An account deleted since it was sampled: write the rest one by one, dropping its rows.
      for (const row of chunk) {
        const one = await this.query(table).upsert([row], { onConflict: HISTORY_CONFLICT_KEYS[table] })
        if (!one.error) continue
        if (one.error.code !== "23503") {
          warnLaneRateLimited(`could not write ${table}`, one.error)
          return false
        }
        if (typeof row.user_id === "string") this.deletedUsers.add(row.user_id)
      }
    }
    return true
  }

  /** Delete this environment's rows older than the retention. */
  async prune(): Promise<void> {
    const cutoff = utcDay(this.deps.now() - HISTORY_RETENTION_DAYS * DAY_MS)
    const env = this.deps.env()
    for (const table of HISTORY_TABLES) {
      try {
        const { error } = await this.query(table).delete().eq("runtime_env", env).lt("day", cutoff)
        if (error && !this.absent(table, error)) warnLaneRateLimited(`could not prune ${table}`, error)
      } catch (err) {
        warnLaneRateLimited(`could not prune ${table}`, err)
      }
    }
  }

  /**
   * Days of measure-only data in this environment, within the retention:
   * completed days (before today, UTC) sampled for at least 90 % of their
   * minutes and never enforced. 0 while the table is absent; throws on any
   * other failure (the switch's precondition reads that as 0, logged).
   */
  async measureDays(): Promise<number> {
    const now = this.deps.now()
    const cutoff = utcDay(now - HISTORY_RETENTION_DAYS * DAY_MS)
    const { data, error } = await this.query("lane_history_days")
      .select("day, sampled_minutes, enforced_minutes").eq("runtime_env", this.deps.env()).gte("day", cutoff).lt("day", utcDay(now))
    if (error) {
      if (this.absent("lane_history_days", error)) return 0
      throw new Error(error.message ?? "could not read lane_history_days")
    }
    return asArray<{ sampled_minutes: unknown; enforced_minutes: unknown }>(data)
      .filter((r) => num(r.sampled_minutes) >= MEASURE_DAY_MIN_SAMPLED_MINUTES && num(r.enforced_minutes) === 0).length
  }
}

async function defaultClient(): Promise<HistoryClient> {
  // ioredis's overloaded command signatures include these call shapes.
  return (await import("../../lib/queue.js")).redis as unknown as HistoryClient
}

async function defaultDb(): Promise<HistoryDb> {
  return (await import("../../lib/supabase.js")).supabase
}

/**
 * For the server process (admin editions): register the history's hooks,
 * sample every 30 s (once per minute across processes) and flush every 5
 * minutes. Returns the stop function (idempotent), called on shutdown.
 */
export async function startLaneHistory(over: Partial<LaneHistoryDeps> = {}): Promise<() => void> {
  const history = new LaneHistory({
    client: over.client ?? defaultClient,
    snapshot: over.snapshot ?? (async () => (await loadConcurrencyGate()).snapshot()),
    db: over.db ?? (await defaultDb()),
    now: over.now ?? Date.now,
    env: over.env ?? getRuntimeEnv,
    prefix: over.prefix ?? LANE_KEY_PREFIX,
    callTimeoutMs: over.callTimeoutMs ?? LANE_GATE_CALL_TIMEOUT_MS,
  })
  registerLaneQueueOutcomeRecorder((e) => history.recordQueueOutcome(e))
  registerLiveWaitExpiryRecorder((e) => history.recordLiveWaitExpiry(e))
  registerMeasureDaysReader(() => history.measureDays())

  const every = (ms: number, fn: () => Promise<void>): ReturnType<typeof setInterval> => {
    let inFlight = false
    const tick = (): void => {
      if (inFlight) return
      inFlight = true
      void fn().finally(() => { inFlight = false })
    }
    const timer = setInterval(tick, ms)
    timer.unref?.()
    return timer
  }
  const timers = [every(HISTORY_SAMPLE_INTERVAL_MS, () => history.sample()), every(HISTORY_FLUSH_INTERVAL_MS, () => history.flush())]
  let stopped = false
  return () => {
    if (stopped) return
    stopped = true
    for (const t of timers) clearInterval(t)
  }
}
