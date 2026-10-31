// backend/src/ee/concurrency-lanes/history-read.ts — what Admin → Live usage
// shows of the lanes' daily history (migration 572): the users view, the
// providers view, and one user's days on the drill-down.
//
// Only this environment's rows (`runtime_env`): staging and production share
// the database, and each reads its own. Up to 90 days, 30 by default. The
// gateway answers at most 1,000 rows per request, so the reads page through
// with `range`, newest first, and stop at HISTORY_ROW_CAP (then `truncated`:
// the oldest days are the ones left out). Staging runs dev
// code on this database before 572 reaches it: a missing table or column is
// an empty history with `available: false`, never a failure.
import type { ConcurrencyLane } from "../../lib/concurrency-lanes/types.js"
import { utcDay } from "./history.js"
import { visiblePayer, type ProfileLookup } from "./live-usage.js"

export const HISTORY_DEFAULT_DAYS = 30
export const HISTORY_MAX_DAYS = 90
/** Rows per request: the gateway's own maximum. */
export const HISTORY_PAGE = 1_000
/** Rows read at most per view; past it the answer says `truncated`. */
export const HISTORY_ROW_CAP = 50_000
/** Users listed at most in the users view (the most constrained first). */
export const HISTORY_TOP_USERS = 500
const DAY_MS = 86_400_000
const LANES: readonly ConcurrencyLane[] = ["provider", "llm", "local", "run"]
/** 42P01 / PGRST205: no such table; 42703 / PGRST204: no such column. */
const MISSING_SCHEMA_CODES = new Set(["42P01", "PGRST205", "42703", "PGRST204"])

type Row = Record<string, unknown>
type Answer = { data: Row[] | null; error: { code?: string; message?: string } | null }
interface Filterable extends PromiseLike<Answer> {
  eq(col: string, val: unknown): Filterable
  gte(col: string, val: string): Filterable
  order(col: string, opts?: { ascending?: boolean }): Filterable
  range(from: number, to: number): Filterable
}
export interface HistoryReadDb { from(table: string): unknown }

class HistoryAbsentError extends Error {}

/** The first day (UTC) of a window of `days` days ending today. */
export function windowStart(now: number, days: number): string {
  return utcDay(now - (days - 1) * DAY_MS)
}

/** Pages asked at once: a full window is read in a few round trips, not dozens. */
export const HISTORY_PAGES_AT_ONCE = 5

/**
 * Every row of `table` in this environment from `since`, oldest first. Read
 * newest first, in a total order (day, then the rest of the primary key
 * `key`), so the pages never overlap or skip and the cap drops the OLDEST
 * days (`truncated`). Pages go HISTORY_PAGES_AT_ONCE at a time; a row the
 * flush writes meanwhile can shift a later page, so rows are kept once per key.
 */
async function readAll(
  db: HistoryReadDb,
  table: string,
  cols: string,
  key: readonly string[],
  env: string,
  since: string,
  extra?: (q: Filterable) => Filterable,
): Promise<{ rows: Row[]; truncated: boolean }> {
  const page = async (from: number): Promise<Row[]> => {
    let q = (db.from(table) as { select(c: string): Filterable }).select(cols).eq("runtime_env", env).gte("day", since)
    if (extra) q = extra(q)
    q = q.order("day", { ascending: false })
    for (const col of key) q = q.order(col, { ascending: true })
    const { data, error } = await q.range(from, Math.min(from + HISTORY_PAGE, HISTORY_ROW_CAP) - 1)
    if (error) {
      if (error.code && MISSING_SCHEMA_CODES.has(error.code)) throw new HistoryAbsentError(table)
      throw new Error(`could not read ${table}: ${error.message ?? "unknown error"}`)
    }
    return data ?? []
  }
  const byKey = new Map<string, Row>()
  const keyOf = (r: Row) => [String(r.day), ...key.map((c) => String(r[c]))].join("\u0000")
  let truncated = true
  for (let from = 0; from < HISTORY_ROW_CAP && truncated; from += HISTORY_PAGE * HISTORY_PAGES_AT_ONCE) {
    const starts = Array.from({ length: HISTORY_PAGES_AT_ONCE }, (_, i) => from + i * HISTORY_PAGE).filter((f) => f < HISTORY_ROW_CAP)
    const pages = await Promise.all(starts.map(page))
    for (const rows of pages) for (const r of rows) byKey.set(keyOf(r), r)
    if (pages.some((rows) => rows.length < HISTORY_PAGE)) truncated = false
  }
  const rows = [...byKey.values()].sort((a, b) => {
    const x = keyOf(a), y = keyOf(b)
    return x < y ? -1 : x > y ? 1 : 0
  })
  return { rows, truncated }
}

const n = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : Number(v) || 0)
const lanesOf = (v: unknown): Record<ConcurrencyLane, number> => {
  const o = v !== null && typeof v === "object" ? (v as Record<string, unknown>) : {}
  return Object.fromEntries(LANES.map((l) => [l, n(o[l])])) as Record<ConcurrencyLane, number>
}
const maxLanes = (a: Record<ConcurrencyLane, number>, b: Record<ConcurrencyLane, number>) =>
  Object.fromEntries(LANES.map((l) => [l, Math.max(a[l], b[l])])) as Record<ConcurrencyLane, number>
const total = (o: Record<ConcurrencyLane, number>) => LANES.reduce((s, l) => s + o[l], 0)

export interface UserDay {
  day: string
  payer: string
  peakRunning: Record<ConcurrencyLane, number>
  peakQueued: Record<ConcurrencyLane, number>
  peakOverLimit: Record<ConcurrencyLane, number>
  longestWaitMs: number
  minutesAtLimit: number
  queueTimeouts: number
  liveWaitExpiries: number
  peakBySource: Record<string, number>
}

/** lane_usage_daily's primary key past (day, runtime_env). */
const USAGE_KEY = ["user_id", "payer"] as const
const USER_COLS = "day, user_id, payer, peak_running, peak_queued, peak_over_limit, longest_wait_ms, minutes_at_limit, queue_timeouts, live_wait_expiries, peak_by_source"

function userDayOf(r: Row, hidden: string | null): UserDay {
  const src = r.peak_by_source !== null && typeof r.peak_by_source === "object" ? (r.peak_by_source as Record<string, unknown>) : {}
  return {
    day: String(r.day),
    payer: visiblePayer(String(r.payer), hidden),
    peakRunning: lanesOf(r.peak_running),
    peakQueued: lanesOf(r.peak_queued),
    peakOverLimit: lanesOf(r.peak_over_limit),
    longestWaitMs: n(r.longest_wait_ms),
    minutesAtLimit: n(r.minutes_at_limit),
    queueTimeouts: n(r.queue_timeouts),
    liveWaitExpiries: n(r.live_wait_expiries),
    peakBySource: Object.fromEntries(Object.entries(src).map(([k, v]) => [k, n(v)])),
  }
}

export interface HistoryReadDeps {
  db: HistoryReadDb
  env: () => string
  now: () => number
  profiles: ProfileLookup
  /** Told when names could not be read; the users view then shows ids. */
  onProfileError?: (err: unknown) => void
}

/** Sampled minutes per day of this environment: how much of each day the history saw, and how much of it enforced. */
async function sampledDays(deps: HistoryReadDeps, since: string): Promise<Array<{ day: string; sampledMinutes: number; enforcedMinutes: number }>> {
  const { rows } = await readAll(deps.db, "lane_history_days", "day, sampled_minutes, enforced_minutes", [], deps.env(), since)
  return rows.map((r) => ({ day: String(r.day), sampledMinutes: n(r.sampled_minutes), enforcedMinutes: n(r.enforced_minutes) }))
}

/** One user's days (every payer line), oldest first; the hidden payer's never. */
export async function userHistory(deps: HistoryReadDeps, userId: string, days: number, hidden: string | null): Promise<{ available: boolean; days: UserDay[] }> {
  if (hidden !== null && userId === hidden) return { available: true, days: [] }
  try {
    const { rows } = await readAll(deps.db, "lane_usage_daily", USER_COLS, USAGE_KEY, deps.env(), windowStart(deps.now(), days), (q) => q.eq("user_id", userId))
    return { available: true, days: rows.map((r) => userDayOf(r, hidden)) }
  } catch (err) {
    if (err instanceof HistoryAbsentError) return { available: false, days: [] }
    throw err
  }
}

export interface UsersHistory {
  view: "users"
  available: boolean
  env: string
  days: number
  from: string
  truncated: boolean
  sampled: Array<{ day: string; sampledMinutes: number; enforcedMinutes: number }>
  /** Per day: the lines with any row, and the sums over them. */
  byDay: Array<{ day: string; lines: number; minutesAtLimit: number; queueTimeouts: number; liveWaitExpiries: number; peakOverLimit: number }>
  /** Per (user, payer line) over the window, the most constrained first. */
  users: Array<{
    userId: string; email: string | null; name: string | null; payer: string; activeDays: number
    peakRunning: Record<ConcurrencyLane, number>; peakQueued: Record<ConcurrencyLane, number>; peakOverLimit: Record<ConcurrencyLane, number>
    longestWaitMs: number; minutesAtLimit: number; queueTimeouts: number; liveWaitExpiries: number
  }>
}

export interface ProvidersHistory {
  view: "providers"
  available: boolean
  env: string
  days: number
  from: string
  truncated: boolean
  sampled: Array<{ day: string; sampledMinutes: number; enforcedMinutes: number }>
  rows: Array<{ day: string; provider: string; peakRunning: number; ceiling: number | null; completed: number; failed: number; minutesAtCeiling: number }>
}

export async function usersHistory(deps: HistoryReadDeps, days: number, hidden: string | null): Promise<UsersHistory> {
  const from = windowStart(deps.now(), days)
  const base = { view: "users" as const, env: deps.env(), days, from }
  try {
    const [{ rows, truncated }, sampled] = await Promise.all([readAll(deps.db, "lane_usage_daily", USER_COLS, USAGE_KEY, deps.env(), from), sampledDays(deps, from)])
    const byDay = new Map<string, UsersHistory["byDay"][number]>()
    const byLine = new Map<string, Omit<UsersHistory["users"][number], "email" | "name">>()
    for (const r of rows) {
      const userId = String(r.user_id)
      if (userId === hidden) continue
      const d = userDayOf(r, hidden)
      const day = byDay.get(d.day) ?? { day: d.day, lines: 0, minutesAtLimit: 0, queueTimeouts: 0, liveWaitExpiries: 0, peakOverLimit: 0 }
      day.lines += 1
      day.minutesAtLimit += d.minutesAtLimit
      day.queueTimeouts += d.queueTimeouts
      day.liveWaitExpiries += d.liveWaitExpiries
      day.peakOverLimit += total(d.peakOverLimit)
      byDay.set(d.day, day)
      const key = `${userId}|${d.payer}`
      const prev = byLine.get(key)
      byLine.set(key, prev
        ? {
          ...prev,
          activeDays: prev.activeDays + 1,
          peakRunning: maxLanes(prev.peakRunning, d.peakRunning),
          peakQueued: maxLanes(prev.peakQueued, d.peakQueued),
          peakOverLimit: maxLanes(prev.peakOverLimit, d.peakOverLimit),
          longestWaitMs: Math.max(prev.longestWaitMs, d.longestWaitMs),
          minutesAtLimit: prev.minutesAtLimit + d.minutesAtLimit,
          queueTimeouts: prev.queueTimeouts + d.queueTimeouts,
          liveWaitExpiries: prev.liveWaitExpiries + d.liveWaitExpiries,
        }
        : {
          userId, payer: d.payer, activeDays: 1, peakRunning: d.peakRunning, peakQueued: d.peakQueued, peakOverLimit: d.peakOverLimit,
          longestWaitMs: d.longestWaitMs, minutesAtLimit: d.minutesAtLimit, queueTimeouts: d.queueTimeouts, liveWaitExpiries: d.liveWaitExpiries,
        })
    }
    const top = [...byLine.values()]
      .sort((a, b) => b.minutesAtLimit - a.minutesAtLimit || total(b.peakOverLimit) - total(a.peakOverLimit)
        || b.queueTimeouts - a.queueTimeouts || total(b.peakRunning) - total(a.peakRunning) || (a.userId < b.userId ? -1 : 1))
      .slice(0, HISTORY_TOP_USERS)
    let profiles: ReadonlyMap<string, { email: string | null; name: string | null }> = new Map()
    try {
      profiles = await deps.profiles([...new Set(top.map((u) => u.userId))])
    } catch (err) {
      deps.onProfileError?.(err)
    }
    return {
      ...base,
      available: true,
      truncated,
      sampled,
      byDay: [...byDay.values()].sort((a, b) => (a.day < b.day ? -1 : 1)),
      users: top.map((u) => ({ ...u, email: profiles.get(u.userId)?.email ?? null, name: profiles.get(u.userId)?.name ?? null })),
    }
  } catch (err) {
    if (err instanceof HistoryAbsentError) return { ...base, available: false, truncated: false, sampled: [], byDay: [], users: [] }
    throw err
  }
}

export async function providersHistory(deps: HistoryReadDeps, days: number): Promise<ProvidersHistory> {
  const from = windowStart(deps.now(), days)
  const base = { view: "providers" as const, env: deps.env(), days, from }
  try {
    const [{ rows, truncated }, sampled] = await Promise.all([
      readAll(deps.db, "lane_provider_daily", "day, provider, peak_running, ceiling, completed, failed, minutes_at_ceiling", ["provider"], deps.env(), from),
      sampledDays(deps, from),
    ])
    return {
      ...base,
      available: true,
      truncated,
      sampled,
      rows: rows.map((r) => ({
        day: String(r.day),
        provider: String(r.provider),
        peakRunning: n(r.peak_running),
        ceiling: r.ceiling === null || r.ceiling === undefined ? null : n(r.ceiling),
        completed: n(r.completed),
        failed: n(r.failed),
        minutesAtCeiling: n(r.minutes_at_ceiling),
      })),
    }
  } catch (err) {
    if (err instanceof HistoryAbsentError) return { ...base, available: false, truncated: false, sampled: [], rows: [] }
    throw err
  }
}
