import type { FastifyRequest } from "fastify"
import {
  COLLECTION_EVICT_MAX_PER_WRITE,
  COLLECTION_RECORD_TEXT_MAX,
  COLLECTION_RECORD_TITLE_MAX,
  clampChars,
  collectionCapsForTier,
  ingestRecordFromJson,
  isCollectionUrl,
  normalizeCollectionFields,
  normalizeCollectionMedia,
  normalizeDedupeKey,
  resolveEffectiveTier,
  type Collection,
  type CollectionFieldValue,
  type CollectionLimits,
  type CollectionMedia,
  type CollectionRecord,
  type CollectionRecordSource,
  type CollectionRecordStatus,
  type CollectionUsage,
} from "@nodaro/shared"
import { supabase } from "./supabase.js"
import { config, hasCredits } from "./config.js"
import { isMissingColumnError, isMissingTableError } from "./postgrest-errors.js"

/**
 * Collections — the ONE store both the API (`routes/collections.ts`) and the
 * nodes (`routes/collection-nodes.ts`: Save to Collection, Read Collection)
 * write and read through. Every query is scoped to the caller's user_id, and
 * the table names are spelled out at every `.from()` so the tenant-scope lint
 * sees each one. A missing table (staging before the migration lands on main)
 * is an outcome, never a throw.
 *
 * The write rule (decided 2026-10-05): the same story twice is one record
 * (`uq_collection_records_dedupe`), a replayed write is one record
 * (`uq_collection_records_idempotency`), and past the plan's records cap the
 * OLDEST records are evicted after the write in ONE range delete — never a
 * refused write (a scheduled pipeline must not stall), and never an eviction
 * on a guess: a limits lookup that fails is NO cap for that request.
 */

export const COLLECTION_COLUMNS = "id, name, description, created_at, updated_at, collection_records(count)"
/** The ownership read: enough to answer 404 and name the collection, no count over its records. */
export const COLLECTION_LIGHT_COLUMNS = "id, name"
export const RECORD_COLUMNS = "id, collection_id, title, text, url, media, fields, dedupe_key, source, created_at, used_at, used_by, deleted_at"
/** The columns a database before migration 494 (usage + Trash) has — a read falls back to them, and every record then reads as not used and not in the Trash. */
export const RECORD_COLUMNS_LEGACY = "id, collection_id, title, text, url, media, fields, dedupe_key, source, created_at"
const DEDUPE_INDEX = "uq_collection_records_dedupe"
const IDEMPOTENCY_INDEX = "uq_collection_records_idempotency"
const SOURCE_VIAS = ["api", "mcp", "node", "ui"] as const

export type CollectionRow = {
  id: string
  name: string
  description: string
  created_at: string
  updated_at: string
  collection_records?: Array<{ count: number }> | { count: number } | null
}

export type CollectionLight = { id: string; name: string }

export type RecordRow = {
  id: string
  collection_id: string
  title: string
  text: string
  url: string | null
  media: unknown
  fields: unknown
  dedupe_key: string | null
  source: unknown
  created_at: string
  /** Absent on a database before migration 494. */
  used_at?: string | null
  used_by?: unknown
  deleted_at?: string | null
}

export function toCollection(row: CollectionRow): Collection {
  const embed = row.collection_records
  const count = Array.isArray(embed) ? (embed[0]?.count ?? 0) : embed && typeof embed === "object" ? (embed.count ?? 0) : 0
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? "",
    recordCount: Number(count) || 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function sourceFrom(value: unknown): CollectionRecordSource {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {}
  const v = value as Record<string, unknown>
  const pick = (key: string) => (typeof v[key] === "string" && (v[key] as string).length > 0 ? (v[key] as string) : undefined)
  const via = pick("via")
  return {
    ...(via && (SOURCE_VIAS as readonly string[]).includes(via) ? { via: via as CollectionRecordSource["via"] } : {}),
    ...(pick("nodeType") ? { nodeType: pick("nodeType") } : {}),
    ...(pick("workflowId") ? { workflowId: pick("workflowId") } : {}),
    ...(pick("executionId") ? { executionId: pick("executionId") } : {}),
    ...(pick("nodeId") ? { nodeId: pick("nodeId") } : {}),
  }
}

export function toRecord(row: RecordRow): CollectionRecord {
  return {
    id: row.id,
    collectionId: row.collection_id,
    title: row.title ?? "",
    text: row.text ?? "",
    url: row.url ?? null,
    media: normalizeCollectionMedia(row.media),
    fields: normalizeCollectionFields(row.fields),
    dedupeKey: row.dedupe_key ?? null,
    source: sourceFrom(row.source),
    createdAt: row.created_at,
    usedAt: row.used_at ?? null,
    usedBy: sourceFrom(row.used_by),
    deletedAt: row.deleted_at ?? null,
  }
}

const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * The names and projects of the workflows that saved or used these records —
 * ONE lookup for a page, scoped to the caller (a workflow that is not theirs
 * stays a bare id). Read-side enrichment of `source` / `usedBy`; nothing is stored.
 */
export async function enrichRecordSources(records: readonly CollectionRecord[], userId: string): Promise<CollectionRecord[]> {
  const ids = new Set<string>()
  for (const r of records) {
    if (r.source.workflowId && UUID_SHAPE.test(r.source.workflowId)) ids.add(r.source.workflowId)
    if (r.usedBy?.workflowId && UUID_SHAPE.test(r.usedBy.workflowId)) ids.add(r.usedBy.workflowId)
  }
  if (ids.size === 0) return [...records]
  const { data, error } = await supabase.from("workflows").select("id, name, project_id").in("id", [...ids]).eq("user_id", userId)
  if (error || !data) return [...records]
  const byId = new Map((data as Array<{ id: string; name: string | null; project_id: string | null }>).map((w) => [w.id, w]))
  const enrich = (s: CollectionRecordSource): CollectionRecordSource => {
    const w = s.workflowId ? byId.get(s.workflowId) : undefined
    return w ? { ...s, ...(w.name ? { workflowName: w.name } : {}), ...(w.project_id ? { projectId: w.project_id } : {}) } : s
  }
  return records.map((r) => ({ ...r, source: enrich(r.source), ...(r.usedBy ? { usedBy: enrich(r.usedBy) } : {}) }))
}

/**
 * A collection's used (live) records and its Trash, counted; null when the
 * database has no usage columns yet, or a count failed (the page then hides
 * what it cannot show, as before the migration).
 */
export async function collectionCounts(collectionId: string, userId: string): Promise<{ used: number; trash: number } | null> {
  // A GET with an empty range, never a HEAD: a HEAD answer has no body, so the error of a
  // missing column could not be told from any other — and a count is wanted with its reason.
  const count = () => supabase.from("collection_records").select("id", { count: "exact" }).eq("collection_id", collectionId).eq("user_id", userId)
  const [used, trash] = await Promise.all([count().is("deleted_at", null).not("used_at", "is", null).range(0, 0), count().not("deleted_at", "is", null).range(0, 0)])
  if (used.error || trash.error) return null
  return { used: used.count ?? 0, trash: trash.count ?? 0 }
}

export type SetDeletedOutcome = { kind: "updated"; count: number } | { kind: "missing_table" } | { kind: "missing_column" } | { kind: "error"; error: unknown }

/**
 * Move the caller's records (within one collection) to the Trash, or bring
 * them back: `deleted_at` is stamped or cleared; nothing is deleted. The count
 * says how many of the ids were theirs and changed — with `onlyChanged`, a
 * record already in the asked state is left alone and not counted. A database
 * before migration 494 answers `missing_column` (the routes answer 503: the
 * Trash is never stood in for by a delete).
 */
export async function setRecordsDeleted(opts: {
  userId: string
  collectionId: string
  ids: readonly string[]
  deleted: boolean
  onlyChanged?: boolean
}): Promise<SetDeletedOutcome> {
  if (opts.ids.length === 0) return { kind: "updated", count: 0 }
  let update = supabase
    .from("collection_records")
    .update({ deleted_at: opts.deleted ? new Date().toISOString() : null })
    .in("id", [...opts.ids])
    .eq("collection_id", opts.collectionId)
    .eq("user_id", opts.userId)
  if (opts.onlyChanged) update = opts.deleted ? update.is("deleted_at", null) : update.not("deleted_at", "is", null)
  const { data, error } = await update.select("id")
  if (isMissingTableError(error)) return { kind: "missing_table" }
  if (isMissingColumnError(error)) return { kind: "missing_column" }
  if (error) return { kind: "error", error }
  return { kind: "updated", count: (data ?? []).length }
}

/** Delete the caller's records that are already in the Trash, for good; a live record is left alone (and not counted). */
export async function deleteTrashedForGood(opts: { userId: string; collectionId: string; ids: readonly string[] }): Promise<SetDeletedOutcome> {
  if (opts.ids.length === 0) return { kind: "updated", count: 0 }
  const { data, error } = await supabase
    .from("collection_records")
    .delete()
    .in("id", [...opts.ids])
    .eq("collection_id", opts.collectionId)
    .eq("user_id", opts.userId)
    .not("deleted_at", "is", null)
    .select("id")
  if (isMissingTableError(error)) return { kind: "missing_table" }
  if (isMissingColumnError(error)) return { kind: "missing_column" }
  if (error) return { kind: "error", error }
  return { kind: "updated", count: (data ?? []).length }
}

export type SetUsedOutcome =
  | { kind: "updated"; record: CollectionRecord }
  /** `firstUseWins` only: the record was already used, and keeps who used it first. */
  | { kind: "already_used"; record: CollectionRecord }
  | { kind: "not_found" }
  | { kind: "missing_table" }
  | { kind: "missing_column" }
  | { kind: "error"; error: unknown }

/**
 * Mark one of the caller's records used (when, and by whom — the shape of
 * `source`), or not used again. A node's mark passes `firstUseWins`: a record
 * already used keeps its first "used by" — the run that really used it — and
 * answers `already_used`; the page and the API overwrite on purpose.
 */
export async function setRecordUsed(opts: {
  userId: string
  collectionId: string
  recordId: string
  used: boolean
  by: CollectionRecordSource
  firstUseWins?: boolean
}): Promise<SetUsedOutcome> {
  const onlyUnused = opts.used && opts.firstUseWins === true
  let update = supabase
    .from("collection_records")
    .update({ used_at: opts.used ? new Date().toISOString() : null, used_by: opts.used ? opts.by : {} })
    .eq("id", opts.recordId)
    .eq("collection_id", opts.collectionId)
    .eq("user_id", opts.userId)
  if (onlyUnused) update = update.is("used_at", null)
  const { data, error } = await update.select(RECORD_COLUMNS).maybeSingle()
  if (isMissingTableError(error)) return { kind: "missing_table" }
  if (isMissingColumnError(error)) return { kind: "missing_column" }
  if (error) return { kind: "error", error }
  if (data) return { kind: "updated", record: toRecord(data as unknown as RecordRow) }
  if (!onlyUnused) return { kind: "not_found" }
  // Nothing updated under "first use wins": either the record is not theirs, or it was used before.
  const existing = await readRecordBy(opts.collectionId, opts.userId, "id", opts.recordId)
  return existing?.usedAt ? { kind: "already_used", record: existing } : { kind: "not_found" }
}

/**
 * The caller's limits: by effective tier on Nodaro Cloud; the two env
 * ceilings elsewhere (unset = no limit). A limits lookup that FAILS, or a
 * tier the caps table does not know, is NO limit for this request — the cap
 * is enforced by deleting records, so it must never fall back to free's. Only
 * a missing profile row reads as free.
 */
export async function limitsFor(req: FastifyRequest, userId: string): Promise<CollectionLimits> {
  if (!hasCredits()) {
    return {
      collections: config.COLLECTIONS_MAX_PER_USER ?? null,
      records: config.COLLECTIONS_MAX_RECORDS_PER_COLLECTION ?? null,
    }
  }
  const { data, error } = await supabase
    .from("profiles")
    .select("tier, subscription_tier, lifetime_topup_credits")
    .eq("id", userId)
    .maybeSingle()
  if (error) {
    req.log.warn({ err: error, userId }, "collections: tier lookup failed; holding the account to no cap for this request")
    return { collections: null, records: null }
  }
  const tier = data
    ? resolveEffectiveTier({
        tier: (data.tier as string | null) ?? null,
        subscription_tier: (data.subscription_tier as string | null) ?? null,
        lifetime_topup_credits: Number(data.lifetime_topup_credits ?? 0),
      })
    : "free"
  const caps = collectionCapsForTier(tier)
  if (!caps) {
    req.log.warn({ tier, userId }, "collections: no caps for this tier; holding the account to no cap (add the tier to COLLECTION_TIER_CAPS)")
    return { collections: null, records: null }
  }
  return { collections: caps.collections, records: caps.records }
}

export type Lookup<R> = { row?: R; missingTable?: boolean; error?: unknown }

/** The caller's collection, by id — the light read for ownership; with the count for the detail answer. */
export async function findCollection(id: string, userId: string): Promise<Lookup<CollectionLight>>
export async function findCollection(id: string, userId: string, opts: { withCount: true }): Promise<Lookup<CollectionRow>>
export async function findCollection(id: string, userId: string, opts?: { withCount: true }): Promise<Lookup<CollectionLight | CollectionRow>> {
  const { data, error } = await supabase
    .from("collections")
    .select(opts?.withCount ? COLLECTION_COLUMNS : COLLECTION_LIGHT_COLUMNS)
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle()
  if (isMissingTableError(error)) return { missingTable: true }
  if (error) return { error }
  return data ? { row: data as unknown as CollectionRow } : {}
}

/**
 * Delete the oldest records past the cap — ONE range delete from the cap-th
 * newest record, however far over the cap the collection is (a downgrade can
 * leave it thousands over; a delete by id list would hit the gateway's row
 * and URL limits and never catch up). Best effort — a failed eviction never
 * fails the write; it is logged and the next write tries again.
 */
export async function evictPastCap(req: FastifyRequest, collectionId: string, userId: string, cap: number | null): Promise<number> {
  if (cap === null || cap < 1) return 0
  const counted = await supabase
    .from("collection_records")
    .select("id", { count: "exact", head: true })
    .eq("collection_id", collectionId)
    .eq("user_id", userId)
  const count = counted.count ?? 0
  if (counted.error || count <= cap) return 0
  // The newest `cap` records stay: the cap-th newest is the boundary.
  const boundary = await supabase
    .from("collection_records")
    .select("created_at, id")
    .eq("collection_id", collectionId)
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(cap - 1, cap - 1)
    .maybeSingle()
  const edge = boundary.data as { created_at: string; id: string } | null
  if (boundary.error || !edge) return 0
  // The oldest records past the boundary, at most COLLECTION_EVICT_MAX_PER_WRITE
  // of them: a cap that fell at once (a lapsed plan) trims a little per write
  // rather than deleting most of a collection in one go. The list is bounded,
  // so an id list is fine here; the boundary itself is still one row.
  const victims = await supabase
    .from("collection_records")
    .select("id")
    .eq("collection_id", collectionId)
    .eq("user_id", userId)
    .or(`created_at.lt.${edge.created_at},and(created_at.eq.${edge.created_at},id.lt.${edge.id})`)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(COLLECTION_EVICT_MAX_PER_WRITE)
  const ids = ((victims.data ?? []) as Array<{ id: string }>).map((r) => r.id)
  if (victims.error || ids.length === 0) return 0
  const deleted = await supabase
    .from("collection_records")
    .delete({ count: "exact" })
    .eq("collection_id", collectionId)
    .eq("user_id", userId)
    .in("id", ids)
  if (deleted.error) {
    req.log.warn({ err: deleted.error, collectionId }, "collection eviction failed")
    return 0
  }
  return deleted.count ?? ids.length
}

/** Words for an ilike filter, with every PostgREST / LIKE special character removed. */
export function searchWords(q: string): string[] {
  return q
    .replace(/[%_*,()\\.:"'`]/g, " ")
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length > 0)
    .slice(0, 5)
}

/** What narrows a records query: the caller's collection, words, the saved-at range, usage, and live-or-Trash. */
export type RecordQuery = {
  collectionId: string
  userId: string
  q?: string
  since?: string
  until?: string
  usage?: CollectionUsage
  status?: CollectionRecordStatus
}

type RecordFilterable<Q> = {
  or: (f: string) => Q
  gte: (c: string, v: string) => Q
  lt: (c: string, v: string) => Q
  is: (c: string, v: null) => Q
  not: (c: string, op: string, v: null) => Q
}

/**
 * The filters of a records query. `withUsageColumns` false is a database
 * before migration 494: no `used_at` / `deleted_at` there, so the usage and
 * status filters are left out — `unused` and `active` are then every record,
 * and `used` / `trash` are answered empty by the callers (`emptyBeforeUsage`).
 */
function applyRecordFilters<Q extends RecordFilterable<Q>>(query: Q, opts: RecordQuery, withUsageColumns: boolean): Q {
  let out = query
  if (opts.since) out = out.gte("created_at", opts.since)
  if (opts.until) out = out.lt("created_at", opts.until)
  for (const word of searchWords(opts.q ?? "")) {
    out = out.or(`title.ilike.*${word}*,text.ilike.*${word}*,url.ilike.*${word}*`)
  }
  if (!withUsageColumns) return out
  const usage = opts.usage ?? "all"
  if (usage === "unused") out = out.is("used_at", null)
  if (usage === "used") out = out.not("used_at", "is", null)
  out = (opts.status ?? "active") === "trash" ? out.not("deleted_at", "is", null) : out.is("deleted_at", null)
  return out
}

/** On a database before migration 494, "used" and "trash" hold nothing. */
function emptyBeforeUsage(opts: RecordQuery): boolean {
  return opts.usage === "used" || opts.status === "trash"
}

export type RecordsPage = { rows: RecordRow[]; error: unknown; missingTable: boolean }

/**
 * A page of a collection's records: newest first by default (`order: "oldest"`
 * flips it), after a key-set cursor that follows the order — or from an
 * `offset` (a numbered page) — narrowed by words, `since` / `until`, `usage`
 * and `status` (the live records unless the Trash is asked for). A database
 * before migration 494 (no usage columns) answers the legacy columns:
 * `unused` / `active` are every record, `used` / `trash` none.
 */
export async function readRecordsPage(
  opts: RecordQuery & {
    after?: { createdAt: string; id: string } | null
    offset?: number
    limit: number
    order?: "newest" | "oldest"
  },
): Promise<RecordsPage> {
  const ascending = opts.order === "oldest"
  const run = (columns: string, withUsage: boolean) => {
    let query = supabase.from("collection_records").select(columns).eq("collection_id", opts.collectionId).eq("user_id", opts.userId)
    query = applyRecordFilters(query, opts, withUsage)
    if (opts.after) {
      // The cursor is the last row of the previous page; the next page continues in the page's own direction.
      const { createdAt, id } = opts.after
      query = ascending
        ? query.or(`created_at.gt.${createdAt},and(created_at.eq.${createdAt},id.gt.${id})`)
        : query.or(`created_at.lt.${createdAt},and(created_at.eq.${createdAt},id.lt.${id})`)
    }
    const ordered = query.order("created_at", { ascending }).order("id", { ascending })
    return opts.offset !== undefined ? ordered.range(opts.offset, opts.offset + opts.limit - 1) : ordered.limit(opts.limit)
  }
  let { data, error } = await run(RECORD_COLUMNS, true)
  if (isMissingColumnError(error)) {
    if (emptyBeforeUsage(opts)) return { rows: [], error: null, missingTable: false }
    ;({ data, error } = await run(RECORD_COLUMNS_LEGACY, false))
  }
  if (isMissingTableError(error)) return { rows: [], error: null, missingTable: true }
  return { rows: ((data ?? []) as unknown[]) as RecordRow[], error, missingTable: false }
}

/**
 * How many records match a query in all (the page count of a numbered list);
 * null when the count failed. A GET with an empty range, never a HEAD: a HEAD
 * answer has no body, so a database before migration 494 could not be told
 * apart from any other failure and the fallback below would never run.
 */
export async function countRecords(opts: RecordQuery): Promise<number | null> {
  const run = (withUsage: boolean) =>
    applyRecordFilters(
      supabase.from("collection_records").select("id", { count: "exact" }).eq("collection_id", opts.collectionId).eq("user_id", opts.userId),
      opts,
      withUsage,
    ).range(0, 0)
  let { count, error } = await run(true)
  if (isMissingColumnError(error)) {
    if (emptyBeforeUsage(opts)) return 0
    ;({ count, error } = await run(false))
  }
  if (isMissingTableError(error)) return 0
  return error || count === null ? null : count
}

/** Which unique rule a 23505 came from, by the index named in the message. */
export function violatedRule(message: string | undefined): "dedupe" | "idempotency" | "unknown" {
  if (!message) return "unknown"
  if (message.includes(IDEMPOTENCY_INDEX)) return "idempotency"
  if (message.includes(DEDUPE_INDEX)) return "dedupe"
  return "unknown"
}

/** What a caller hands a write: explicit fields, and / or an item to map. */
export interface RecordWriteInput {
  readonly title?: string
  readonly text?: string
  readonly url?: string
  readonly media?: ReadonlyArray<{ type: CollectionMedia["type"]; url: string; posterUrl?: string | null }>
  readonly fields?: Readonly<Record<string, CollectionFieldValue>>
  readonly dedupeKey?: string
  /** Any JSON — or JSON TEXT, which is what a node receives from a `json` wire (the engines stringify it). */
  readonly item?: unknown
}

/** The record a write would store, before the insert. */
export interface PreparedRecord {
  readonly title: string
  readonly text: string
  readonly url: string | null
  readonly media: CollectionMedia[]
  readonly fields: Record<string, CollectionFieldValue>
  readonly dedupeKey: string | null
}

/**
 * A node's `item` arrives as TEXT when it came down a `json` wire (both
 * engines stringify a json output for a text consumer): JSON text that is an
 * object is read as that object; a list is a misuse of a plain wire (one
 * record per item needs an "each" wire) and is kept as its text; anything
 * else is the text it is.
 */
export function itemFromWire(item: unknown): unknown {
  if (typeof item !== "string") return unwrapSingleObject(item) ?? item
  // A model answering in a ```json fence is still JSON.
  const trimmed = stripCodeFence(item.trim())
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return item
  try {
    return unwrapSingleObject(JSON.parse(trimmed)) ?? item
  } catch {
    return item
  }
}

const asRecord = (v: unknown): Record<string, unknown> | undefined =>
  typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined

/**
 * An object is the item; a list of exactly ONE object is that object — an
 * "each" wire that held a single post never fanned out (a list fans out from
 * two values), so the node received the whole list as its item. A longer list
 * stays text: one record per item needs an "each" wire.
 */
function unwrapSingleObject(v: unknown): Record<string, unknown> | undefined {
  return asRecord(v) ?? (Array.isArray(v) && v.length === 1 ? asRecord(v[0]) : undefined)
}

function stripCodeFence(s: string): string {
  const fenced = s.match(/^```[a-z]*[ \t]*\r?\n([\s\S]*?)\r?\n?```$/i)
  return fenced ? fenced[1]!.trim() : s
}

/** Explicit fields win over what the item maps to; null when the record would hold nothing. */
export function prepareRecord(input: RecordWriteInput): PreparedRecord | null {
  // A plain-text item that is ONE link (a list of article addresses, each
  // row saved in turn) is the record's link, not its text.
  const plainLink = typeof input.item === "string" && isCollectionUrl(input.item.trim()) ? input.item.trim() : undefined
  const ingested = input.item !== undefined && plainLink === undefined ? ingestRecordFromJson(itemFromWire(input.item)) : null
  const title = clampChars((input.title ?? ingested?.title ?? "").trim(), COLLECTION_RECORD_TITLE_MAX)
  const text = clampChars(input.text ?? ingested?.text ?? "", COLLECTION_RECORD_TEXT_MAX)
  const explicitUrl = typeof input.url === "string" && isCollectionUrl(input.url.trim()) ? input.url.trim() : undefined
  const url = explicitUrl ?? plainLink ?? ingested?.url ?? null
  // The item's own media AND what was wired in, the item's first; the
  // normalizer drops repeats and holds the cap.
  const media = normalizeCollectionMedia([...(ingested?.media ?? []), ...(input.media ?? [])])
  const fields = normalizeCollectionFields({ ...(ingested?.fields ?? {}), ...(input.fields ?? {}) })
  const dedupeKey = normalizeDedupeKey(input.dedupeKey) ?? (url ? normalizeDedupeKey(url) : null) ?? ingested?.dedupeKey ?? null
  if (!title && !text && !url && media.length === 0) return null
  return { title, text, url, media, fields, dedupeKey }
}

export type RecordWriteOutcome =
  | { kind: "inserted"; record: CollectionRecord; evicted: number; collection: CollectionLight }
  | { kind: "duplicate" | "replayed"; record: CollectionRecord; collection: CollectionLight }
  | { kind: "not_found" }
  | { kind: "missing_table" }
  | { kind: "empty" }
  | { kind: "conflict" }
  | { kind: "error"; error: unknown }

/**
 * Save one record for the caller: ownership first (nothing of the item is
 * read for a collection that is not theirs), then the insert, then the
 * eviction past the cap. A unique violation answers with the record already
 * there — by the rule the 23505 named.
 */
export async function writeCollectionRecord(
  req: FastifyRequest,
  opts: {
    userId: string
    collectionId: string
    input: RecordWriteInput
    idempotencyKey: string | null
    source: CollectionRecordSource
  },
): Promise<RecordWriteOutcome> {
  const { userId, collectionId } = opts
  const found = await findCollection(collectionId, userId)
  if (found.missingTable) return { kind: "missing_table" }
  if (found.error) return { kind: "error", error: found.error }
  if (!found.row) return { kind: "not_found" }
  const collection = found.row

  const prepared = prepareRecord(opts.input)
  if (!prepared) return { kind: "empty" }

  // Two tries at most. A unique violation whose colliding row is gone by the
  // lookup (an eviction past the cap, or a delete, in between) has nothing to
  // answer with, and the slot it held is free again: insert once more rather
  // than fail the write with a conflict (#1890). A second miss is a conflict.
  for (let attempt = 0; attempt < 2; attempt++) {
    const inserted = await supabase
      .from("collection_records")
      .insert({
        collection_id: collectionId,
        user_id: userId,
        dedupe_key: prepared.dedupeKey,
        idempotency_key: opts.idempotencyKey,
        title: prepared.title,
        text: prepared.text,
        url: prepared.url,
        media: prepared.media,
        fields: prepared.fields,
        source: opts.source,
      })
      // A fresh record is never used, so the legacy columns say everything — and a
      // database before migration 494 (staging ahead of the promotion) still inserts.
      .select(RECORD_COLUMNS_LEGACY)
      .single()
    if (!inserted.error) {
      const caps = await limitsFor(req, userId)
      const evicted = await evictPastCap(req, collectionId, userId, caps.records)
      return { kind: "inserted", record: toRecord(inserted.data as unknown as RecordRow), evicted, collection }
    }
    if (isMissingTableError(inserted.error)) return { kind: "missing_table" }
    if (inserted.error.code !== "23505") return { kind: "error", error: inserted.error }

    // The same story, or the same write, is already there: answer with it.
    const rule = violatedRule(inserted.error.message)
    const lookups: Array<{ kind: "replayed" | "duplicate"; column: string; value: string }> = []
    if (opts.idempotencyKey && rule !== "dedupe") lookups.push({ kind: "replayed", column: "idempotency_key", value: opts.idempotencyKey })
    if (prepared.dedupeKey && rule !== "idempotency") lookups.push({ kind: "duplicate", column: "dedupe_key", value: prepared.dedupeKey })
    for (const lookup of lookups) {
      // A record in the Trash is answered as the duplicate it is and STAYS there: a pipeline
      // that keeps seeing the same item must not undo a delete on every run (the person
      // restores it from the Trash tab when they want it back).
      const existing = await readRecordBy(collectionId, userId, lookup.column, lookup.value)
      if (existing) return { kind: lookup.kind, record: existing, collection }
    }
  }
  return { kind: "conflict" }
}

/** One of the caller's records by id, Trash included; null when it is not theirs. */
export function findRecord(collectionId: string, userId: string, recordId: string): Promise<CollectionRecord | null> {
  return readRecordBy(collectionId, userId, "id", recordId)
}

/**
 * One of the caller's records in a collection by a unique column (its id, its
 * dedupe key, its idempotency key); null when there is none. A database before
 * migration 494 answers the legacy columns, so the record reads as not used.
 */
async function readRecordBy(collectionId: string, userId: string, column: string, value: string): Promise<CollectionRecord | null> {
  const run = (columns: string) =>
    supabase.from("collection_records").select(columns).eq("collection_id", collectionId).eq("user_id", userId).eq(column, value).maybeSingle()
  let { data, error } = await run(RECORD_COLUMNS)
  if (isMissingColumnError(error)) ({ data, error } = await run(RECORD_COLUMNS_LEGACY))
  return data ? toRecord(data as unknown as RecordRow) : null
}
