/**
 * Trend Radar storage (migration 576): the settings row, the sources, the
 * candidates and their daily readings. Service-role reads and writes only;
 * the routes shape what leaves the server.
 *
 * Staging runs dev code on the shared database before the migration reaches
 * it, so a missing table is `TrendRadarUnavailableError` (the routes answer
 * 503), never a crash.
 */
import { supabase } from "../../../lib/supabase.js"
import { isMissingTableError } from "../../../lib/postgrest-errors.js"
import { israelParts } from "../../notifications/israel-time.js"
import { dayChangePct } from "./labels.js"
import {
  DEFAULT_ALERTS,
  DEFAULT_THRESHOLDS,
  candidateChecklist,
  type TrendCandidate,
  type TrendCandidateCard,
  type TrendCandidateEvent,
  type TrendCandidateLabel,
  type TrendCandidatePost,
  type TrendCandidateReading,
  type TrendCandidateSearch,
  type TrendCandidateSort,
  type TrendCandidateStatus,
  type TrendCandidateTemplate,
  type TrendRadarAlerts,
  type TrendRadarLastRun,
  type TrendRadarSettings,
  type TrendRadarSource,
  type TrendRadarSourceKind,
  type TrendRadarSummary,
  type TrendRadarThresholds,
} from "./types.js"

export class TrendRadarUnavailableError extends Error {
  constructor() {
    super("Trend Radar storage is not available on this deployment yet")
    this.name = "TrendRadarUnavailableError"
  }
}

function fail(what: string, error: { code?: string | null; message?: string } | null): never {
  if (isMissingTableError(error)) throw new TrendRadarUnavailableError()
  throw new Error(`[trend-radar] ${what}: ${error?.message ?? "unknown error"}`)
}

// ── rows ─────────────────────────────────────────────────────────────────────

interface SettingsRow {
  thresholds: Partial<TrendRadarThresholds> | null
  alerts: Partial<TrendRadarAlerts> | null
  retention_days: number
  run_at: string
  runner_user_id: string | null
  last_run: TrendRadarLastRun | null
  last_run_date: string | null
  searches_date: string | null
  searches_today: number
}

interface SourceRow {
  id: string
  name: string
  kind: TrendRadarSourceKind
  url: string | null
  enabled: boolean
  last_read_at: string | null
  pages: number | null
  new_today: number | null
  last_error: string | null
  seen_slugs: string[] | null
}

interface CandidateRow {
  id: string
  name: string
  slug: string
  status: TrendCandidateStatus
  label: TrendCandidateLabel
  sound_name: string | null
  duration_sec: number | null
  creators: number
  plays: number
  day_change_pct: number | null
  first_seen_kind: "template-site" | "social"
  first_seen_name: string
  first_seen_url: string | null
  first_seen_at: string
  top_post: TrendCandidatePost | null
  posts: TrendCandidatePost[] | null
  templates_elsewhere: TrendCandidateTemplate[] | null
  search: TrendCandidateSearch | null
  history: TrendCandidateEvent[] | null
  summary: string | null
  reject_reason: string | null
  passed_at: string | null
  trend_id: string | null
  created_at: string
  updated_at: string
}

interface ReadingRow {
  candidate_id: string
  day: string
  creators: number
  plays: number
  posts: number
}

const CANDIDATE_COLS =
  "id, name, slug, status, label, sound_name, duration_sec, creators, plays, day_change_pct, first_seen_kind, first_seen_name, first_seen_url, first_seen_at, top_post, posts, templates_elsewhere, search, history, summary, reject_reason, passed_at, trend_id, created_at, updated_at"

export function toCard(r: CandidateRow): TrendCandidateCard {
  return {
    id: r.id,
    name: r.name,
    slug: r.slug,
    status: r.status,
    label: r.label,
    soundName: r.sound_name,
    durationSec: r.duration_sec,
    creators: r.creators,
    plays: Number(r.plays),
    dayChangePct: r.day_change_pct,
    firstSeen: { kind: r.first_seen_kind, name: r.first_seen_name, url: r.first_seen_url, firstSeenAt: r.first_seen_at },
    topPost: r.top_post,
    passedAt: r.passed_at,
    trendId: r.trend_id,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

function toSource(r: SourceRow): TrendRadarSource {
  return {
    id: r.id,
    name: r.name,
    kind: r.kind,
    url: r.url,
    enabled: r.enabled,
    lastReadAt: r.last_read_at,
    pages: r.pages,
    newToday: r.new_today,
    lastError: r.last_error,
  }
}

// ── settings ────────────────────────────────────────────────────────────────

export interface StoredSettings {
  thresholds: TrendRadarThresholds
  alerts: TrendRadarAlerts
  retentionDays: number
  runAt: string
  runnerUserId: string | null
  lastRun: TrendRadarLastRun | null
  lastRunDate: string | null
  searchesDate: string | null
  searchesToday: number
}

export async function readSettings(): Promise<StoredSettings> {
  const { data, error } = await supabase
    .from("trend_radar_settings")
    .select("thresholds, alerts, retention_days, run_at, runner_user_id, last_run, last_run_date, searches_date, searches_today")
    .eq("id", 1)
    .maybeSingle()
  if (error) fail("read settings", error)
  const r = (data ?? null) as SettingsRow | null
  return {
    thresholds: { ...DEFAULT_THRESHOLDS, ...(r?.thresholds ?? {}) },
    alerts: { ...DEFAULT_ALERTS, ...(r?.alerts ?? {}) },
    retentionDays: r?.retention_days ?? 90,
    runAt: r?.run_at ?? "06:00",
    runnerUserId: r?.runner_user_id ?? null,
    lastRun: r?.last_run ?? null,
    lastRunDate: r?.last_run_date ?? null,
    searchesDate: r?.searches_date ?? null,
    searchesToday: r?.searches_today ?? 0,
  }
}

export interface SettingsPatch {
  thresholds?: Partial<TrendRadarThresholds>
  alerts?: Partial<TrendRadarAlerts>
  retentionDays?: number
  runAt?: string
  runnerUserId?: string | null
  lastRun?: TrendRadarLastRun
  lastRunDate?: string
  searchesDate?: string
  searchesToday?: number
}

export async function writeSettings(patch: SettingsPatch): Promise<StoredSettings> {
  const current = await readSettings()
  const row: Record<string, unknown> = { id: 1, updated_at: new Date().toISOString() }
  if (patch.thresholds) row.thresholds = { ...current.thresholds, ...patch.thresholds }
  if (patch.alerts) row.alerts = { ...current.alerts, ...patch.alerts }
  if (patch.retentionDays !== undefined) row.retention_days = patch.retentionDays
  if (patch.runAt !== undefined) row.run_at = patch.runAt
  if (patch.runnerUserId !== undefined) row.runner_user_id = patch.runnerUserId
  if (patch.lastRun !== undefined) row.last_run = patch.lastRun
  if (patch.lastRunDate !== undefined) row.last_run_date = patch.lastRunDate
  if (patch.searchesDate !== undefined) row.searches_date = patch.searchesDate
  if (patch.searchesToday !== undefined) row.searches_today = patch.searchesToday
  const { error } = await supabase.from("trend_radar_settings").upsert(row, { onConflict: "id" })
  if (error) fail("write settings", error)
  return readSettings()
}

/**
 * Claims today's scheduled run: true once per day, on whichever process asks
 * first (the write is conditional on the stored date). A run that then fails
 * is not retried every minute until midnight; the failure is in the log.
 */
export async function claimRunDay(today: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("trend_radar_settings")
    .update({ last_run_date: today, updated_at: new Date().toISOString() })
    .eq("id", 1)
    .or(`last_run_date.is.null,last_run_date.neq.${today}`)
    .select("id")
  if (error) fail("claim run day", error)
  if ((data ?? []).length > 0) return true
  // No row changed: either today is claimed already, or no settings row exists yet.
  const current = await readSettings()
  if (current.lastRunDate === today) return false
  await writeSettings({ lastRunDate: today })
  return true
}

/** Counts one more search today; answers the day's total after it. */
export async function countSearch(today: string): Promise<number> {
  const s = await readSettings()
  const total = s.searchesDate === today ? s.searchesToday + 1 : 1
  await writeSettings({ searchesDate: today, searchesToday: total })
  return total
}

// ── sources ──────────────────────────────────────────────────────────────────

export async function listSources(): Promise<Array<TrendRadarSource & { seenSlugs: string[] }>> {
  const { data, error } = await supabase
    .from("trend_radar_sources")
    .select("id, name, kind, url, enabled, last_read_at, pages, new_today, last_error, seen_slugs")
    .order("created_at", { ascending: true })
  if (error) fail("list sources", error)
  return ((data ?? []) as SourceRow[]).map((r) => ({ ...toSource(r), seenSlugs: Array.isArray(r.seen_slugs) ? r.seen_slugs : [] }))
}

export interface SourceInput {
  id?: string
  name: string
  kind: TrendRadarSourceKind
  url: string | null
  enabled: boolean
}

/** Replaces the source list: rows named by id are updated, new ones inserted, the rest removed. */
export async function replaceSources(sources: SourceInput[]): Promise<void> {
  const existing = await listSources()
  const keep = new Set(sources.map((s) => s.id).filter((id): id is string => typeof id === "string"))
  const gone = existing.filter((s) => !keep.has(s.id)).map((s) => s.id)
  if (gone.length) {
    const { error } = await supabase.from("trend_radar_sources").delete().in("id", gone)
    if (error) fail("remove sources", error)
  }
  for (const s of sources) {
    const row = { name: s.name, kind: s.kind, url: s.url, enabled: s.enabled, updated_at: new Date().toISOString() }
    // A source pointed at another address starts over: its old catalog's slugs
    // would otherwise hide the new site's pages, or drip them in as "new".
    const before = s.id ? existing.find((e) => e.id === s.id) : undefined
    const reset = before && before.url !== s.url ? { seen_slugs: [], pages: null, new_today: null, last_read_at: null, last_error: null } : {}
    const { error } = s.id
      ? await supabase.from("trend_radar_sources").update({ ...row, ...reset }).eq("id", s.id)
      : await supabase.from("trend_radar_sources").insert(row)
    if (error) fail("write source", error)
  }
}

export async function markSourceRead(id: string, read: { pages: number | null; newToday: number | null; lastError: string | null; seenSlugs?: string[] }): Promise<void> {
  const { error } = await supabase
    .from("trend_radar_sources")
    .update({
      last_read_at: new Date().toISOString(),
      pages: read.pages,
      new_today: read.newToday,
      last_error: read.lastError,
      ...(read.seenSlugs ? { seen_slugs: read.seenSlugs } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
  if (error) fail("mark source read", error)
}

// ── candidates ──────────────────────────────────────────────────────────────

export interface ListCandidatesParams {
  status?: TrendCandidateStatus
  sort?: TrendCandidateSort
  cursor?: string
  limit?: number
}

const SORT_COLUMNS: Record<TrendCandidateSort, { column: string; ascending: boolean }> = {
  creators: { column: "creators", ascending: false },
  dayChange: { column: "day_change_pct", ascending: false },
  firstSeen: { column: "first_seen_at", ascending: false },
}

/** A page of cards; `next` is the offset of the following page (the list is small). */
export async function listCandidates(params: ListCandidatesParams): Promise<{ data: TrendCandidateCard[]; next: string | null }> {
  const limit = Math.min(Math.max(params.limit ?? 50, 1), 200)
  const offset = params.cursor ? Math.max(0, Number.parseInt(params.cursor, 10) || 0) : 0
  const sort = SORT_COLUMNS[params.sort ?? "creators"]
  let q = supabase.from("trend_radar_candidates").select(CANDIDATE_COLS)
  if (params.status) q = q.eq("status", params.status)
  else q = q.not("status", "in", "(rejected,archived)")
  q = q.order(sort.column, { ascending: sort.ascending, nullsFirst: false }).order("updated_at", { ascending: false }).range(offset, offset + limit)
  const { data, error } = await q
  if (error) fail("list candidates", error)
  const rows = (data ?? []) as CandidateRow[]
  const page = rows.slice(0, limit)
  return { data: page.map(toCard), next: rows.length > limit ? String(offset + limit) : null }
}

export async function readCandidateRow(id: string): Promise<CandidateRow | null> {
  const { data, error } = await supabase.from("trend_radar_candidates").select(CANDIDATE_COLS).eq("id", id).maybeSingle()
  if (error) fail("read candidate", error)
  return (data ?? null) as CandidateRow | null
}

export async function readCandidateBySlug(slug: string): Promise<CandidateRow | null> {
  const { data, error } = await supabase.from("trend_radar_candidates").select(CANDIDATE_COLS).eq("slug", slug).maybeSingle()
  if (error) fail("read candidate by slug", error)
  return (data ?? null) as CandidateRow | null
}

export async function listReadings(candidateId: string): Promise<TrendCandidateReading[]> {
  const { data, error } = await supabase
    .from("trend_radar_readings")
    .select("candidate_id, day, creators, plays, posts")
    .eq("candidate_id", candidateId)
    .order("day", { ascending: true })
  if (error) fail("list readings", error)
  return ((data ?? []) as ReadingRow[]).map((r) => ({ date: r.day, creators: r.creators, plays: Number(r.plays), posts: r.posts }))
}

export async function readCandidate(id: string, thresholds: TrendRadarThresholds): Promise<TrendCandidate | null> {
  const row = await readCandidateRow(id)
  if (!row) return null
  const readings = await listReadings(id)
  const card = toCard(row)
  return {
    ...card,
    summary: row.summary,
    posts: Array.isArray(row.posts) ? row.posts : [],
    readings,
    templatesElsewhere: Array.isArray(row.templates_elsewhere) ? row.templates_elsewhere : [],
    search: row.search,
    history: Array.isArray(row.history) ? row.history : [],
    checklist: candidateChecklist(card, thresholds),
    rejectReason: row.reject_reason,
  }
}

export interface NewCandidate {
  name: string
  slug: string
  firstSeen: { kind: "template-site" | "social"; name: string; url: string | null }
  templatesElsewhere?: TrendCandidateTemplate[]
}

/** Creates a candidate, or answers the one its slug already names. */
export async function upsertCandidate(input: NewCandidate): Promise<CandidateRow> {
  const existing = await readCandidateBySlug(input.slug)
  if (existing) {
    if (input.templatesElsewhere?.length) {
      const known = new Set((existing.templates_elsewhere ?? []).map((t) => t.site))
      const added = input.templatesElsewhere.filter((t) => !known.has(t.site))
      if (added.length) {
        const { error } = await supabase
          .from("trend_radar_candidates")
          .update({ templates_elsewhere: [...(existing.templates_elsewhere ?? []), ...added], updated_at: new Date().toISOString() })
          .eq("id", existing.id)
        if (error) fail("note template", error)
      }
    }
    return existing
  }
  const now = new Date().toISOString()
  const { data, error } = await supabase
    .from("trend_radar_candidates")
    .insert({
      name: input.name,
      slug: input.slug,
      first_seen_kind: input.firstSeen.kind,
      first_seen_name: input.firstSeen.name,
      first_seen_url: input.firstSeen.url,
      first_seen_at: now,
      templates_elsewhere: input.templatesElsewhere ?? [],
      history: [{ at: now, event: "first_seen", detail: `First seen on ${input.firstSeen.name}` }],
    })
    .select(CANDIDATE_COLS)
    .single()
  if (error) {
    // Two runs racing on the same slug: the other one's row wins.
    if (error.code === "23505") {
      const again = await readCandidateBySlug(input.slug)
      if (again) return again
    }
    fail("create candidate", error)
  }
  return data as CandidateRow
}

/** The candidates the run re-reads: everything an admin has not decided on. */
export async function listOpenCandidates(): Promise<CandidateRow[]> {
  const { data, error } = await supabase
    .from("trend_radar_candidates")
    .select(CANDIDATE_COLS)
    .in("status", ["watching", "candidate", "slowing"])
    .order("updated_at", { ascending: true })
  if (error) fail("list open candidates", error)
  return (data ?? []) as CandidateRow[]
}

export interface ReadingInput {
  day: string
  creators: number
  plays: number
  posts: number
}

/** Writes the day's reading (a second read of the same day replaces it) and answers every reading, oldest first. */
export async function writeReading(candidateId: string, reading: ReadingInput): Promise<TrendCandidateReading[]> {
  const { error } = await supabase
    .from("trend_radar_readings")
    .upsert({ candidate_id: candidateId, day: reading.day, creators: reading.creators, plays: reading.plays, posts: reading.posts, read_at: new Date().toISOString() }, { onConflict: "candidate_id,day" })
  if (error) fail("write reading", error)
  return listReadings(candidateId)
}

export interface CandidateUpdate {
  status?: TrendCandidateStatus
  label?: TrendCandidateLabel
  soundName?: string | null
  durationSec?: number | null
  creators?: number
  plays?: number
  dayChangePct?: number | null
  topPost?: TrendCandidatePost | null
  posts?: TrendCandidatePost[]
  search?: TrendCandidateSearch | null
  summary?: string | null
  rejectReason?: string | null
  passedAt?: string | null
  trendId?: string | null
  /** Appended to the history. */
  event?: { event: string; detail: string | null }
}

/** The statuses the run still decides; approved, rejected and archived are an admin's and stay. */
export const OPEN_STATUSES: readonly TrendCandidateStatus[] = ["watching", "candidate", "slowing"]

export async function updateCandidate(id: string, update: CandidateUpdate): Promise<CandidateRow> {
  const current = await readCandidateRow(id)
  if (!current) throw new Error(`[trend-radar] candidate ${id} not found`)
  const row = candidatePatch(current, update)
  const { data, error } = await supabase.from("trend_radar_candidates").update(row).eq("id", id).select(CANDIDATE_COLS).single()
  if (error) fail("update candidate", error)
  return data as CandidateRow
}

/**
 * The run's write: lands only while the candidate is still open, so a
 * decision an admin made during the run (approve, reject, archive) is never
 * overwritten. Null when the row was decided meanwhile (or is gone).
 */
export async function updateOpenCandidate(id: string, update: CandidateUpdate): Promise<CandidateRow | null> {
  const current = await readCandidateRow(id)
  if (!current || !OPEN_STATUSES.includes(current.status)) return null
  const row = candidatePatch(current, update)
  const { data, error } = await supabase
    .from("trend_radar_candidates")
    .update(row)
    .eq("id", id)
    .in("status", [...OPEN_STATUSES])
    .select(CANDIDATE_COLS)
    .maybeSingle()
  if (error) fail("update open candidate", error)
  return (data as CandidateRow | null) ?? null
}

function candidatePatch(current: CandidateRow, update: CandidateUpdate): Record<string, unknown> {
  const now = new Date().toISOString()
  const row: Record<string, unknown> = { updated_at: now }
  if (update.status !== undefined) row.status = update.status
  if (update.label !== undefined) row.label = update.label
  if (update.soundName !== undefined) row.sound_name = update.soundName
  if (update.durationSec !== undefined) row.duration_sec = update.durationSec
  if (update.creators !== undefined) row.creators = update.creators
  if (update.plays !== undefined) row.plays = update.plays
  if (update.dayChangePct !== undefined) row.day_change_pct = update.dayChangePct
  if (update.topPost !== undefined) row.top_post = update.topPost
  if (update.posts !== undefined) row.posts = update.posts
  if (update.search !== undefined) row.search = update.search
  if (update.summary !== undefined) row.summary = update.summary
  if (update.rejectReason !== undefined) row.reject_reason = update.rejectReason
  if (update.passedAt !== undefined) row.passed_at = update.passedAt
  if (update.trendId !== undefined) row.trend_id = update.trendId
  if (update.event) row.history = [...(current.history ?? []), { at: now, ...update.event }].slice(-200)
  return row
}

/** Readings older than `retentionDays` are dropped (ids, names and counts: nothing else was kept). */
export async function pruneReadings(retentionDays: number): Promise<void> {
  const cutoff = new Date(Date.now() - retentionDays * 86_400_000).toISOString().slice(0, 10)
  const { error } = await supabase.from("trend_radar_readings").delete().lt("day", cutoff)
  if (error) fail("prune readings", error)
}

export async function readSummary(): Promise<TrendRadarSummary> {
  const s = await readSettings()
  const counts = { candidates: 0, watching: 0, slowing: 0 }
  const { data, error } = await supabase.from("trend_radar_candidates").select("status").in("status", ["candidate", "watching", "slowing"])
  if (error) fail("count candidates", error)
  for (const r of (data ?? []) as Array<{ status: TrendCandidateStatus }>) {
    if (r.status === "candidate") counts.candidates++
    else if (r.status === "watching") counts.watching++
    else if (r.status === "slowing") counts.slowing++
  }
  // The run counts its searches on the Israel date; the card reads the same day.
  const today = israelParts(new Date()).date
  return {
    lastRun: s.lastRun,
    counts,
    searchesToday: s.searchesDate === today || s.searchesDate === s.lastRunDate ? s.searchesToday : 0,
    dailySearchBudget: s.thresholds.dailySearchBudget,
  }
}

export async function readPublicSettings(): Promise<TrendRadarSettings> {
  const s = await readSettings()
  const sources = await listSources()
  return {
    sources: sources.map(({ seenSlugs: _seen, ...rest }) => rest),
    thresholds: s.thresholds,
    alerts: s.alerts,
    retentionDays: s.retentionDays,
    runAt: s.runAt,
  }
}

/** The day change of the latest readings, for the card. */
export function latestDayChange(readings: readonly TrendCandidateReading[]): number | null {
  return dayChangePct(readings)
}
