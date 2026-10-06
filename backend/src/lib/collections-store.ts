import type { FastifyRequest } from "fastify"
import {
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
} from "@nodaro/shared"
import { supabase } from "./supabase.js"
import { config, hasCredits } from "./config.js"
import { isMissingTableError } from "./postgrest-errors.js"

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
export const RECORD_COLUMNS = "id, collection_id, title, text, url, media, fields, dedupe_key, source, created_at"
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
  }
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
  const deleted = await supabase
    .from("collection_records")
    .delete({ count: "exact" })
    .eq("collection_id", collectionId)
    .eq("user_id", userId)
    .or(`created_at.lt.${edge.created_at},and(created_at.eq.${edge.created_at},id.lt.${edge.id})`)
  if (deleted.error) {
    req.log.warn({ err: deleted.error, collectionId }, "collection eviction failed")
    return 0
  }
  return deleted.count ?? count - cap
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

function applyRecordFilters<Q extends { or: (f: string) => Q; gte: (c: string, v: string) => Q }>(query: Q, q: string | undefined, since: string | undefined): Q {
  let out = query
  if (since) out = out.gte("created_at", since)
  for (const word of searchWords(q ?? "")) {
    out = out.or(`title.ilike.*${word}*,text.ilike.*${word}*,url.ilike.*${word}*`)
  }
  return out
}

export type RecordsPage = { rows: RecordRow[]; error: unknown; missingTable: boolean }

/** A page of a collection's records: newest first by default (`order: "oldest"` flips it), after a key-set cursor, narrowed by words and `since`. */
export async function readRecordsPage(opts: {
  collectionId: string
  userId: string
  q?: string
  since?: string
  after?: { createdAt: string; id: string } | null
  limit: number
  order?: "newest" | "oldest"
}): Promise<RecordsPage> {
  const ascending = opts.order === "oldest"
  let query = supabase.from("collection_records").select(RECORD_COLUMNS).eq("collection_id", opts.collectionId).eq("user_id", opts.userId)
  query = applyRecordFilters(query, opts.q, opts.since)
  if (opts.after) query = query.or(`created_at.lt.${opts.after.createdAt},and(created_at.eq.${opts.after.createdAt},id.lt.${opts.after.id})`)
  const { data, error } = await query.order("created_at", { ascending }).order("id", { ascending }).limit(opts.limit)
  if (isMissingTableError(error)) return { rows: [], error: null, missingTable: true }
  return { rows: ((data ?? []) as unknown[]) as RecordRow[], error, missingTable: false }
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
  if (typeof item !== "string") return item
  const trimmed = item.trim()
  if (!trimmed.startsWith("{")) return item
  try {
    const parsed: unknown = JSON.parse(trimmed)
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed : item
  } catch {
    return item
  }
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
    .select(RECORD_COLUMNS)
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
    const existing = await supabase
      .from("collection_records")
      .select(RECORD_COLUMNS)
      .eq("collection_id", collectionId)
      .eq("user_id", userId)
      .eq(lookup.column, lookup.value)
      .maybeSingle()
    if (existing.data) return { kind: lookup.kind, record: toRecord(existing.data as unknown as RecordRow), collection }
  }
  return { kind: "conflict" }
}
