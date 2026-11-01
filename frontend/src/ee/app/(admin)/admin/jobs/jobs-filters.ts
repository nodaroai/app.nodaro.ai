/**
 * The admin Jobs page's filters, as they live in the URL — a refresh, a
 * bookmark or a shared link reopens the same filtered view.
 *
 * `parseJobFilters` reads the page's search params and drops any value the
 * server would refuse (`GET /v1/admin/jobs`, backend/src/ee/routes/admin-jobs.ts),
 * so a stale or hand-edited link narrows less instead of failing the list.
 * `serializeJobFilters` writes them back with the defaults left out, the keys
 * in one order and list values sorted, so equal filters make equal URLs (and
 * equal query keys). `serverParams` is the request: a kind or a model line
 * expands to the types or models it stands for, and a text search gets the
 * date range the server would give it.
 *
 * The user filter travels as an address, never an account id: `user=<email>`,
 * or `user=admins-hidden` for "every account but the admins".
 */
import { z } from "zod"
import { otherJobTypes, typesOfKind, type JobKind } from "./job-kinds"
import { MODEL_EXTRA_VALUES, modelLines, modelValuesOf, modelsOfLine } from "./model-lines"

/** The Type filter's kinds: the five a job makes, and the rows that make none. */
export type JobKindFilter = JobKind | "other"

export interface AdminJobFilters {
  view: "table" | "gallery"
  status?: string
  /** One account, by address (lowercase). Wins over `excludeAdmins`. */
  userEmail?: string
  /** Every account but the admins (the caller sends their ids). */
  excludeAdmins: boolean
  kind?: JobKindFilter
  /** Exact row types; empty with a `kind` means every type of the kind. */
  types: string[]
  /** A model product line (`modelLines()`). */
  line?: string
  /** Exact model values; empty with a `line` means every model of the line. */
  models: string[]
  minCredits?: number
  /** Platform keys (`GET /v1/admin/jobs/sources`). */
  sources: string[]
  /** `YYYY-MM-DD`, UTC, inclusive. */
  from?: string
  /** `YYYY-MM-DD`, UTC, inclusive. */
  to?: string
  /** A prompt / error substring, or a job id. */
  q?: string
}

export const DEFAULT_JOB_FILTERS: AdminJobFilters = Object.freeze({
  view: "table",
  excludeAdmins: false,
  types: [],
  models: [],
  sources: [],
}) as AdminJobFilters

/** The server's job statuses (backend/src/lib/job-status.ts `JOB_STATUSES`; a test holds the two equal). */
export const ADMIN_JOB_STATUSES = [
  "pending",
  "queued",
  "processing",
  "pending_review",
  "completed",
  "failed",
  "cancelled",
] as const

/** The `user` value for "hide the admins". */
export const ADMINS_HIDDEN = "admins-hidden"

const KINDS: ReadonlySet<string> = new Set<JobKindFilter>(["video", "image", "audio", "music", "text", "other"])
/** A type, model or platform key as the server's list filters take it (its `LIST_ITEM`). */
export const LIST_ITEM = /^[a-z0-9:._@-]{1,120}$/i
/** The server's cap on one list filter. */
export const LIST_MAX = 200
/** The most exact models one filter picks: each is sent with its stored values (`modelValuesOf`), and the whole must fit `LIST_MAX`. */
export const MODEL_PICK_MAX = LIST_MAX - MODEL_EXTRA_VALUES
/** Any uuid spelling: a search that is one is a job id (the server's `UUID_TEXT`). */
const UUID_TEXT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** The server's address check (`z.email()`), so a link it would refuse is dropped here instead. */
const EMAIL = z.email()
const DAY_TEXT = /^\d{4}-\d{2}-\d{2}$/
const Q_MAX = 200
const DAY_MS = 24 * 60 * 60 * 1000
/** A text search with no `from` looks this many days back from the range's end (the server's window). */
const SEARCH_DEFAULT_DAYS = 7

/** The keys in the order they are written. */
const KEY_ORDER = ["view", "status", "user", "kind", "types", "line", "models", "minCredits", "sources", "from", "to", "q"] as const

function utcDay(day: string): Date | null {
  if (!DAY_TEXT.test(day)) return null
  const [y, m, d] = day.split("-").map(Number) as [number, number, number]
  const t = new Date(Date.UTC(y, m - 1, d))
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d ? t : null
}

function dayText(t: Date): string {
  return t.toISOString().slice(0, 10)
}

/** A list value: split on commas, invalid items dropped, deduped and sorted; more than `max` is no filter. */
function list(raw: string | null, max = LIST_MAX): string[] {
  if (!raw) return []
  const items = raw.split(",").map((s) => s.trim()).filter((s) => LIST_ITEM.test(s))
  const sorted = [...new Set(items)].sort()
  return sorted.length > max ? [] : sorted
}

function canonical(items: readonly string[]): string[] {
  return [...new Set(items)].sort()
}

export function parseJobFilters(params: URLSearchParams): AdminJobFilters {
  const get = (key: string) => {
    const v = params.get(key)?.trim()
    return v ? v : undefined
  }
  const f: AdminJobFilters = {
    view: get("view") === "gallery" ? "gallery" : "table",
    excludeAdmins: false,
    types: list(params.get("types")),
    models: list(params.get("models"), MODEL_PICK_MAX),
    sources: list(params.get("sources")),
  }

  const status = get("status")
  if (status && (ADMIN_JOB_STATUSES as readonly string[]).includes(status)) f.status = status

  const user = get("user")
  if (user === ADMINS_HIDDEN) f.excludeAdmins = true
  else if (user && EMAIL.safeParse(user.toLowerCase()).success) f.userEmail = user.toLowerCase()

  const kind = get("kind")
  if (kind && KINDS.has(kind)) f.kind = kind as JobKindFilter

  const line = get("line")
  if (line && modelLines().some((l) => l.line === line)) f.line = line

  const minCredits = get("minCredits")
  if (minCredits && /^\d{1,9}$/.test(minCredits)) f.minCredits = Number(minCredits)

  const from = get("from")
  if (from && utcDay(from)) f.from = from
  const to = get("to")
  if (to && utcDay(to)) f.to = to

  const q = get("q")
  if (q && q.length <= Q_MAX) f.q = q

  return f
}

/** The URL's search params: defaults left out, keys in one order, list values sorted. */
export function serializeJobFilters(f: AdminJobFilters): URLSearchParams {
  const values: Partial<Record<(typeof KEY_ORDER)[number], string>> = {}
  if (f.view === "gallery") values.view = "gallery"
  if (f.status) values.status = f.status
  if (f.userEmail) values.user = f.userEmail.trim().toLowerCase()
  else if (f.excludeAdmins) values.user = ADMINS_HIDDEN
  if (f.kind) values.kind = f.kind
  if (f.types.length > 0) values.types = canonical(f.types).join(",")
  if (f.line) values.line = f.line
  if (f.models.length > 0) values.models = canonical(f.models).join(",")
  if (f.minCredits !== undefined) values.minCredits = String(f.minCredits)
  if (f.sources.length > 0) values.sources = canonical(f.sources).join(",")
  if (f.from) values.from = f.from
  if (f.to) values.to = f.to
  const q = f.q?.trim()
  if (q) values.q = q
  const params = new URLSearchParams()
  for (const key of KEY_ORDER) {
    const v = values[key]
    if (v !== undefined) params.set(key, v)
  }
  return params
}

/** The filters' part of a query key: everything but the view, which changes no row. */
export function jobFiltersKey(f: AdminJobFilters): string {
  return serializeJobFilters({ ...f, view: "table" }).toString()
}

/**
 * The `GET /v1/admin/jobs` filter params (no page, size or excluded ids).
 *
 * A `kind` with no `types` sends every type of the kind ("other": the types
 * that make none); a `line` with no `models` every model of the line; an
 * exact model every value a row stores for it (Suno's "suno-v5" and "V5"). A text
 * search with no `from` gets `from` = the range's end (`to`, else `today`, a
 * UTC day) minus 7 days, so it never starts after `to`; a search that is a
 * uuid is a job id and gets no date.
 */
export function serverParams(f: AdminJobFilters, today: Date): URLSearchParams {
  const params = new URLSearchParams()
  if (f.status) params.set("status", f.status)
  if (f.userEmail) params.set("userEmail", f.userEmail.trim().toLowerCase())
  const types = f.types.length > 0 ? canonical(f.types)
    : f.kind === "other" ? otherJobTypes()
    : f.kind ? typesOfKind(f.kind)
    : []
  if (types.length > 0) params.set("types", types.join(","))
  const models = f.models.length > 0 ? canonical(f.models.flatMap(modelValuesOf)) : f.line ? modelsOfLine(f.line) : []
  if (models.length > 0) params.set("models", models.join(","))
  if (f.sources.length > 0) params.set("sources", canonical(f.sources).join(","))
  if (f.minCredits !== undefined) params.set("minCredits", String(f.minCredits))
  const q = f.q?.trim()
  let from = f.from
  if (q && !UUID_TEXT.test(q) && !from) {
    const end = (f.to ? utcDay(f.to) : null) ?? utcDay(dayText(today))!
    from = dayText(new Date(end.getTime() - SEARCH_DEFAULT_DAYS * DAY_MS))
  }
  if (from) params.set("from", from)
  if (f.to) params.set("to", f.to)
  if (q) params.set("q", q)
  return params
}
