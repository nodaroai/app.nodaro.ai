import { Readable } from "node:stream"
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { z } from "zod"
import {
  COLLECTION_DEDUPE_KEY_MAX,
  COLLECTION_DESCRIPTION_MAX,
  COLLECTION_IDEMPOTENCY_KEY_MAX,
  COLLECTION_MEDIA_TYPES,
  COLLECTION_NAME_MAX,
  COLLECTION_RECORD_MEDIA_MAX,
  COLLECTION_RECORD_TEXT_MAX,
  COLLECTION_RECORD_TITLE_MAX,
  COLLECTION_RECORD_URL_MAX,
  COLLECTIONS_PAGE_DEFAULT,
  COLLECTIONS_PAGE_MAX,
  clampChars,
  collectionCapsForTier,
  ingestRecordFromJson,
  isCollectionUrl,
  normalizeCollectionFields,
  normalizeCollectionMedia,
  normalizeDedupeKey,
  resolveEffectiveTier,
  type AddCollectionRecordResult,
  type Collection,
  type CollectionLimits,
  type CollectionRecord,
  type CollectionRecordSource,
  type CollectionWriteOutcome,
  type ListCollectionsResult,
} from "@nodaro/shared"
import { supabase } from "../lib/supabase.js"
import { config, hasCredits } from "../lib/config.js"
import { requireAppScope } from "../lib/scope-prehandler.js"
import { sendInternalError } from "../lib/http-errors.js"
import { isMissingTableError } from "../lib/postgrest-errors.js"

/**
 * Collections — where a workflow's records live (migration 462). Personal
 * data: every query is scoped to the caller's user_id (the table names are
 * spelled out at every `.from()` so the tenant-scope lint sees each one).
 * Table-tolerant: staging and production share one database and the
 * migration lands only on main, so a missing table reads as "not available"
 * (`available: false`, empty lists) and refuses writes with a 503, never a 500.
 *
 * Caps (decided 2026-10-05): on Nodaro Cloud by effective tier
 * (`COLLECTION_TIER_CAPS`), self-hosted by two env ceilings (unset = none).
 * Past a collection's records cap the OLDEST records are evicted after the
 * write — a scheduled pipeline is never stalled by a full collection; the
 * answer says how many went (`evicted`). Because the cap is enforced by
 * DELETING records, a limits lookup that fails, or a tier the caps table does
 * not know, means NO cap for that request — never free's.
 *
 * Two unique rules, both partial indexes (a NULL key is no rule), told apart
 * by the index name in the 23505 message: `uq_collection_records_dedupe`
 * (the same story twice is one record — 200 `duplicate`) and
 * `uq_collection_records_idempotency` (a replayed write — 200 `replayed`).
 */

const COLLECTION_COLUMNS = "id, name, description, created_at, updated_at, collection_records(count)"
/** The ownership read: enough to answer 404 and name the collection, no count over its records. */
const COLLECTION_LIGHT_COLUMNS = "id, name"
const RECORD_COLUMNS = "id, collection_id, title, text, url, media, fields, dedupe_key, source, created_at"
const DEDUPE_INDEX = "uq_collection_records_dedupe"
const IDEMPOTENCY_INDEX = "uq_collection_records_idempotency"
/** Records fetched per round while streaming an export. */
const EXPORT_PAGE = 200
const SOURCE_VIAS = ["api", "mcp", "node", "ui"] as const
/** The byte-order mark that makes a spreadsheet read a CSV as UTF-8 (Hebrew, Japanese, Korean text). */
const CSV_BOM = "﻿"

type CollectionRow = {
  id: string
  name: string
  description: string
  created_at: string
  updated_at: string
  collection_records?: Array<{ count: number }> | { count: number } | null
}

type CollectionLight = { id: string; name: string }

type RecordRow = {
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

function notAvailable(reply: FastifyReply) {
  return reply.status(503).send({ error: { code: "not_available", message: "Collections are not available on this server yet." } })
}

function notFound(reply: FastifyReply, what: "Collection" | "Record") {
  return reply.status(404).send({ error: { code: "not_found", message: `${what} not found` } })
}

function validationError(reply: FastifyReply, message: string) {
  return reply.status(400).send({ error: { code: "validation_error", message } })
}

function zodError(reply: FastifyReply, error: z.ZodError) {
  return validationError(reply, error.issues[0]?.message ?? "invalid request")
}

function requireUser(req: FastifyRequest, reply: FastifyReply): string | null {
  if (!req.userId) {
    void reply.status(401).send({ error: { code: "unauthorized", message: "Authentication required" } })
    return null
  }
  return req.userId
}

const ISO_TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})?$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * An ISO timestamp with a real date and time — `2026-02-30T00:00:00Z` is not
 * one (V8 would roll it to March 2; Postgres refuses it with a 22008, which
 * would read as a server error for what is a client's mistake).
 */
export function isRealTimestamp(value: string): boolean {
  const m = ISO_TIMESTAMP.exec(value)
  if (!m) return false
  const [, y, mo, d, h, mi, s] = m.map(Number) as unknown as [string, number, number, number, number, number, number]
  const date = new Date(Date.UTC(y, mo - 1, d, h, mi, s))
  return (
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === mo - 1 &&
    date.getUTCDate() === d &&
    h <= 23 &&
    mi <= 59 &&
    s <= 59 &&
    !Number.isNaN(Date.parse(value))
  )
}

const nameSchema = z.string().trim().min(1, "name is required").max(COLLECTION_NAME_MAX)
const descriptionSchema = z.string().max(COLLECTION_DESCRIPTION_MAX)
const createBody = z.object({ name: nameSchema, description: descriptionSchema.optional() })
const updateBody = z
  .object({ name: nameSchema.optional(), description: descriptionSchema.optional() })
  .refine((b) => b.name !== undefined || b.description !== undefined, { message: "nothing to update" })

const linkSchema = z.string().max(COLLECTION_RECORD_URL_MAX).refine(isCollectionUrl, { message: "url must be an http(s) link" })
const mediaSchema = z
  .array(z.object({ type: z.enum(COLLECTION_MEDIA_TYPES), url: linkSchema, posterUrl: linkSchema.nullish() }))
  .max(COLLECTION_RECORD_MEDIA_MAX)
const fieldsSchema = z.record(z.string().min(1).max(100), z.union([z.string(), z.number(), z.boolean()]))
const sourceSchema = z.object({
  via: z.enum(SOURCE_VIAS).optional(),
  nodeType: z.string().max(120).optional(),
  workflowId: z.string().max(120).optional(),
  executionId: z.string().max(120).optional(),
  nodeId: z.string().max(120).optional(),
})
const addRecordBody = z.object({
  title: z.string().max(COLLECTION_RECORD_TITLE_MAX).optional(),
  text: z.string().max(COLLECTION_RECORD_TEXT_MAX).optional(),
  url: linkSchema.optional(),
  media: mediaSchema.optional(),
  fields: fieldsSchema.optional(),
  dedupeKey: z.string().max(COLLECTION_DEDUPE_KEY_MAX).optional(),
  source: sourceSchema.optional(),
  item: z.unknown().optional(),
})

const sinceSchema = z.string().max(40).refine(isRealTimestamp, { message: "since must be an ISO timestamp with a date and a time" })
const recordsQuery = z.object({
  q: z.string().max(200).optional(),
  since: sinceSchema.optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(COLLECTIONS_PAGE_MAX).default(COLLECTIONS_PAGE_DEFAULT),
})
const exportQuery = z.object({
  format: z.enum(["csv", "json"]).default("csv"),
  since: sinceSchema.optional(),
  q: z.string().max(200).optional(),
})
const idParams = z.object({ id: z.string().uuid() })
const recordParams = z.object({ id: z.string().uuid(), recordId: z.string().uuid() })

/** Words for an ilike filter, with every PostgREST / LIKE special character removed. */
export function searchWords(q: string): string[] {
  return q
    .replace(/[%_*,()\\.:"'`]/g, " ")
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length > 0)
    .slice(0, 5)
}

/** The last row of a page, as the next page's starting point (base64url, like the saved-posts cursor). */
export function encodeRecordsCursor(row: { created_at: string; id: string }): string {
  return Buffer.from(`${row.created_at}|${row.id}`, "utf8").toString("base64url")
}

/** Both halves are spliced into a PostgREST `or(...)` expression, so each must be exactly a timestamp / a uuid. */
export function parseRecordsCursor(cursor: string): { createdAt: string; id: string } | null {
  const raw = /^[A-Za-z0-9_-]+$/.test(cursor) ? Buffer.from(cursor, "base64url").toString("utf8") : ""
  const separator = raw.lastIndexOf("|")
  if (separator === -1) return null
  const createdAt = raw.slice(0, separator)
  const id = raw.slice(separator + 1)
  return isRealTimestamp(createdAt) && UUID.test(id) ? { createdAt, id } : null
}

/**
 * A CSV cell: quoted, inner quotes doubled, and a cell that would run as a
 * formula in a spreadsheet (`=`, `+`, `-`, `@`, a tab or a return) prefixed
 * with an apostrophe so it opens as text.
 */
export function csvCell(value: unknown): string {
  let s = value === null || value === undefined ? "" : typeof value === "string" ? value : JSON.stringify(value)
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
  return `"${s.replace(/"/g, '""')}"`
}

const CSV_HEADER = ["id", "created_at", "title", "text", "url", "dedupe_key", "media", "fields"]

export function csvLine(record: CollectionRecord): string {
  return [
    record.id,
    record.createdAt,
    record.title,
    record.text,
    record.url ?? "",
    record.dedupeKey ?? "",
    record.media.length > 0 ? record.media : "",
    Object.keys(record.fields).length > 0 ? record.fields : "",
  ]
    .map(csvCell)
    .join(",")
}

/** A file name for an export in ASCII: the collection's name, the day, the format. */
export function exportFilename(name: string, format: "csv" | "json", now = new Date()): string {
  const slug = name
    .normalize("NFKD")
    .replace(/[^\x20-\x7e]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
  return `${slug || "collection"}-${now.toISOString().slice(0, 10)}.${format}`
}

/**
 * The `Content-Disposition` of an export: the ASCII name every client reads,
 * and the collection's own name (Hebrew, Japanese, …) as `filename*` for the
 * browsers that take it (RFC 6266).
 */
export function exportContentDisposition(name: string, format: "csv" | "json", now = new Date()): string {
  const ascii = exportFilename(name, format, now)
  const own = `${name.trim().replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").trim().slice(0, 80) || "collection"}-${now.toISOString().slice(0, 10)}.${format}`
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(own)}`
}

/**
 * The caller's limits: by effective tier on Nodaro Cloud; the two env
 * ceilings elsewhere (unset = no limit). A limits lookup that FAILS, or a
 * tier the caps table does not know, is NO limit for this request — the cap
 * is enforced by deleting records, so it must never fall back to free's. Only
 * a missing profile row reads as free.
 */
async function limitsFor(req: FastifyRequest, userId: string): Promise<CollectionLimits> {
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

type Lookup<R> = { row?: R; missingTable?: boolean; error?: unknown }

/** The caller's collection, by id — the light read for ownership; with the count for the detail answer. */
async function findCollection(id: string, userId: string): Promise<Lookup<CollectionLight>>
async function findCollection(id: string, userId: string, opts: { withCount: true }): Promise<Lookup<CollectionRow>>
async function findCollection(id: string, userId: string, opts?: { withCount: true }): Promise<Lookup<CollectionLight | CollectionRow>> {
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
async function evictPastCap(req: FastifyRequest, collectionId: string, userId: string, cap: number | null): Promise<number> {
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

function applyRecordFilters<Q extends { or: (f: string) => Q; gte: (c: string, v: string) => Q }>(query: Q, q: string | undefined, since: string | undefined): Q {
  let out = query
  if (since) out = out.gte("created_at", since)
  for (const word of searchWords(q ?? "")) {
    out = out.or(`title.ilike.*${word}*,text.ilike.*${word}*,url.ilike.*${word}*`)
  }
  return out
}

type Page = { rows: RecordRow[]; error: unknown; missingTable: boolean }

async function readRecordsPage(opts: {
  collectionId: string
  userId: string
  q?: string
  since?: string
  after?: { createdAt: string; id: string } | null
  limit: number
}): Promise<Page> {
  let query = supabase.from("collection_records").select(RECORD_COLUMNS).eq("collection_id", opts.collectionId).eq("user_id", opts.userId)
  query = applyRecordFilters(query, opts.q, opts.since)
  if (opts.after) query = query.or(`created_at.lt.${opts.after.createdAt},and(created_at.eq.${opts.after.createdAt},id.lt.${opts.after.id})`)
  const { data, error } = await query.order("created_at", { ascending: false }).order("id", { ascending: false }).limit(opts.limit)
  if (isMissingTableError(error)) return { rows: [], error: null, missingTable: true }
  return { rows: ((data ?? []) as unknown[]) as RecordRow[], error, missingTable: false }
}

/** The whole collection, newest first, a page at a time — what an export streams. */
async function* iterateRecords(collectionId: string, userId: string, q: string | undefined, since: string | undefined): AsyncGenerator<CollectionRecord> {
  let after: { createdAt: string; id: string } | null = null
  for (;;) {
    const page = await readRecordsPage({ collectionId, userId, q, since, after, limit: EXPORT_PAGE })
    if (page.error) throw page.error
    for (const row of page.rows) yield toRecord(row)
    if (page.rows.length < EXPORT_PAGE) return
    const last = page.rows[page.rows.length - 1]!
    after = { createdAt: last.created_at, id: last.id }
  }
}

async function* exportBody(req: FastifyRequest, records: AsyncGenerator<CollectionRecord>, format: "csv" | "json"): AsyncGenerator<string> {
  try {
    if (format === "csv") {
      yield `${CSV_BOM}${CSV_HEADER.join(",")}\r\n`
      for await (const record of records) yield `${csvLine(record)}\r\n`
      return
    }
    yield "["
    let first = true
    for await (const record of records) {
      yield `${first ? "" : ","}\n${JSON.stringify(record)}`
      first = false
    }
    yield "\n]\n"
  } catch (err) {
    // A page read failed mid-stream: the response is already open, so it ends short; the log says why.
    req.log.error({ err }, "collection export failed mid-stream")
    throw err
  }
}

/** Which unique rule a 23505 came from, by the index named in the message. */
export function violatedRule(message: string | undefined): "dedupe" | "idempotency" | "unknown" {
  if (!message) return "unknown"
  if (message.includes(IDEMPOTENCY_INDEX)) return "idempotency"
  if (message.includes(DEDUPE_INDEX)) return "dedupe"
  return "unknown"
}

function idempotencyKeyOf(req: FastifyRequest): { key: string | null; invalid: boolean } {
  const raw = req.headers["idempotency-key"]
  const value = Array.isArray(raw) ? raw[0] : raw
  if (value === undefined) return { key: null, invalid: false }
  const key = String(value).trim()
  if (key.length === 0 || key.length > COLLECTION_IDEMPOTENCY_KEY_MAX) return { key: null, invalid: true }
  return { key, invalid: false }
}

export async function collectionRoutes(app: FastifyInstance) {
  app.get("/v1/collections", { preHandler: requireAppScope("assets:read") }, async (req, reply) => {
    const userId = requireUser(req, reply)
    if (!userId) return
    const caps = await limitsFor(req, userId)
    const { data, error } = await supabase.from("collections").select(COLLECTION_COLUMNS).eq("user_id", userId).order("created_at", { ascending: false })
    if (isMissingTableError(error)) return { data: [], available: false, caps } satisfies ListCollectionsResult
    if (error) return sendInternalError(reply, req, error, "Failed to load collections")
    return { data: ((data ?? []) as unknown as CollectionRow[]).map(toCollection), available: true, caps } satisfies ListCollectionsResult
  })

  app.post(
    "/v1/collections",
    { preHandler: requireAppScope("assets:write"), config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const userId = requireUser(req, reply)
      if (!userId) return
      const parsed = createBody.safeParse(req.body)
      if (!parsed.success) return zodError(reply, parsed.error)
      const caps = await limitsFor(req, userId)
      const counted = await supabase.from("collections").select("id", { count: "exact", head: true }).eq("user_id", userId)
      if (isMissingTableError(counted.error)) return notAvailable(reply)
      if (counted.error) return sendInternalError(reply, req, counted.error, "Failed to create the collection")
      if (caps.collections !== null && (counted.count ?? 0) >= caps.collections) {
        return reply.status(403).send({
          error: { code: "collection_limit_reached", message: `Your plan allows ${caps.collections} collections.` },
        })
      }
      const inserted = await supabase
        .from("collections")
        .insert({ user_id: userId, name: parsed.data.name, description: parsed.data.description ?? "" })
        .select(COLLECTION_COLUMNS)
        .single()
      if (!inserted.error) return reply.status(201).send(toCollection(inserted.data as unknown as CollectionRow))
      if (isMissingTableError(inserted.error)) return notAvailable(reply)
      if (inserted.error.code === "23505") {
        return reply.status(409).send({ error: { code: "name_taken", message: "You already have a collection with that name." } })
      }
      return sendInternalError(reply, req, inserted.error, "Failed to create the collection")
    },
  )

  app.get("/v1/collections/:id", { preHandler: requireAppScope("assets:read") }, async (req, reply) => {
    const userId = requireUser(req, reply)
    if (!userId) return
    const params = idParams.safeParse(req.params)
    if (!params.success) return zodError(reply, params.error)
    const found = await findCollection(params.data.id, userId, { withCount: true })
    if (found.missingTable) return notFound(reply, "Collection")
    if (found.error) return sendInternalError(reply, req, found.error, "Failed to load the collection")
    if (!found.row) return notFound(reply, "Collection")
    return toCollection(found.row)
  })

  app.patch("/v1/collections/:id", { preHandler: requireAppScope("assets:write") }, async (req, reply) => {
    const userId = requireUser(req, reply)
    if (!userId) return
    const params = idParams.safeParse(req.params)
    if (!params.success) return zodError(reply, params.error)
    const parsed = updateBody.safeParse(req.body)
    if (!parsed.success) return zodError(reply, parsed.error)
    const { name, description } = parsed.data
    const { data, error } = await supabase
      .from("collections")
      .update({
        ...(name !== undefined ? { name } : {}),
        ...(description !== undefined ? { description } : {}),
        updated_at: new Date().toISOString(),
      })
      .eq("id", params.data.id)
      .eq("user_id", userId)
      .select(COLLECTION_COLUMNS)
      .maybeSingle()
    if (isMissingTableError(error)) return notAvailable(reply)
    if (error?.code === "23505") {
      return reply.status(409).send({ error: { code: "name_taken", message: "You already have a collection with that name." } })
    }
    if (error) return sendInternalError(reply, req, error, "Failed to update the collection")
    if (!data) return notFound(reply, "Collection")
    return toCollection(data as unknown as CollectionRow)
  })

  app.delete("/v1/collections/:id", { preHandler: requireAppScope("assets:write") }, async (req, reply) => {
    const userId = requireUser(req, reply)
    if (!userId) return
    const params = idParams.safeParse(req.params)
    if (!params.success) return zodError(reply, params.error)
    const { data, error } = await supabase.from("collections").delete().eq("id", params.data.id).eq("user_id", userId).select("id").maybeSingle()
    if (isMissingTableError(error)) return notAvailable(reply)
    if (error) return sendInternalError(reply, req, error, "Failed to delete the collection")
    if (!data) return notFound(reply, "Collection")
    return { success: true }
  })

  app.get("/v1/collections/:id/records", { preHandler: requireAppScope("assets:read") }, async (req, reply) => {
    const userId = requireUser(req, reply)
    if (!userId) return
    const params = idParams.safeParse(req.params)
    if (!params.success) return zodError(reply, params.error)
    const parsed = recordsQuery.safeParse(req.query)
    if (!parsed.success) return zodError(reply, parsed.error)
    const { q, since, cursor, limit } = parsed.data
    const after = cursor ? parseRecordsCursor(cursor) : null
    if (cursor && !after) {
      return reply.status(400).send({ error: { code: "invalid_cursor", message: "That cursor is not one this list gave out." } })
    }
    const found = await findCollection(params.data.id, userId)
    if (found.missingTable) return notFound(reply, "Collection")
    if (found.error) return sendInternalError(reply, req, found.error, "Failed to load the collection")
    if (!found.row) return notFound(reply, "Collection")

    const page = await readRecordsPage({ collectionId: params.data.id, userId, q, since, after, limit: limit + 1 })
    if (page.missingTable) return { data: [], nextCursor: null }
    if (page.error) return sendInternalError(reply, req, page.error, "Failed to load the records")
    const rows = page.rows.slice(0, limit)
    return { data: rows.map(toRecord), nextCursor: page.rows.length > limit ? encodeRecordsCursor(rows[rows.length - 1]!) : null }
  })

  app.post(
    "/v1/collections/:id/records",
    // A fan-out writes one record per item: bounded per user, generously.
    { preHandler: requireAppScope("assets:write"), config: { rateLimit: { max: 120, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const userId = requireUser(req, reply)
      if (!userId) return
      const params = idParams.safeParse(req.params)
      if (!params.success) return zodError(reply, params.error)
      const parsed = addRecordBody.safeParse(req.body)
      if (!parsed.success) return zodError(reply, parsed.error)
      const idem = idempotencyKeyOf(req)
      if (idem.invalid) return validationError(reply, `Idempotency-Key must be 1-${COLLECTION_IDEMPOTENCY_KEY_MAX} characters`)

      // Ownership first: nothing of the item is read for a collection that is not the caller's.
      const found = await findCollection(params.data.id, userId)
      if (found.missingTable) return notAvailable(reply)
      if (found.error) return sendInternalError(reply, req, found.error, "Failed to save the record")
      if (!found.row) return notFound(reply, "Collection")

      // An explicit field wins over what the item maps to.
      const body = parsed.data
      const ingested = body.item !== undefined ? ingestRecordFromJson(body.item) : null
      const title = clampChars((body.title ?? ingested?.title ?? "").trim(), COLLECTION_RECORD_TITLE_MAX)
      const text = clampChars(body.text ?? ingested?.text ?? "", COLLECTION_RECORD_TEXT_MAX)
      const url = body.url ?? ingested?.url ?? null
      const media = normalizeCollectionMedia(body.media ?? ingested?.media ?? [])
      const fields = normalizeCollectionFields({ ...(ingested?.fields ?? {}), ...(body.fields ?? {}) })
      const dedupeKey = normalizeDedupeKey(body.dedupeKey) ?? (url ? normalizeDedupeKey(url) : null) ?? ingested?.dedupeKey ?? null
      if (!title && !text && !url && media.length === 0) {
        return reply.status(400).send({ error: { code: "empty_record", message: "A record needs a title, a text, a link or a medium." } })
      }
      const source: CollectionRecordSource = { via: "api", ...(body.source ?? {}) }

      const inserted = await supabase
        .from("collection_records")
        .insert({
          collection_id: params.data.id,
          user_id: userId,
          dedupe_key: dedupeKey,
          idempotency_key: idem.key,
          title,
          text,
          url,
          media,
          fields,
          source,
        })
        .select(RECORD_COLUMNS)
        .single()
      if (!inserted.error) {
        const caps = await limitsFor(req, userId)
        const evicted = await evictPastCap(req, params.data.id, userId, caps.records)
        const result: AddCollectionRecordResult = { record: toRecord(inserted.data as unknown as RecordRow), outcome: "inserted", evicted }
        return reply.status(201).send(result)
      }
      if (isMissingTableError(inserted.error)) return notAvailable(reply)
      if (inserted.error.code !== "23505") return sendInternalError(reply, req, inserted.error, "Failed to save the record")

      // The same story, or the same write, is already there: answer with it.
      const rule = violatedRule(inserted.error.message)
      const lookups: Array<{ outcome: CollectionWriteOutcome; column: string; value: string }> = []
      if (idem.key && rule !== "dedupe") lookups.push({ outcome: "replayed", column: "idempotency_key", value: idem.key })
      if (dedupeKey && rule !== "idempotency") lookups.push({ outcome: "duplicate", column: "dedupe_key", value: dedupeKey })
      for (const lookup of lookups) {
        const existing = await supabase
          .from("collection_records")
          .select(RECORD_COLUMNS)
          .eq("collection_id", params.data.id)
          .eq("user_id", userId)
          .eq(lookup.column, lookup.value)
          .maybeSingle()
        if (existing.data) {
          const result: AddCollectionRecordResult = { record: toRecord(existing.data as unknown as RecordRow), outcome: lookup.outcome, evicted: 0 }
          return reply.status(200).send(result)
        }
      }
      return reply.status(409).send({ error: { code: "conflict", message: "The record changed while saving. Try again." } })
    },
  )

  app.delete("/v1/collections/:id/records/:recordId", { preHandler: requireAppScope("assets:write") }, async (req, reply) => {
    const userId = requireUser(req, reply)
    if (!userId) return
    const params = recordParams.safeParse(req.params)
    if (!params.success) return zodError(reply, params.error)
    const { data, error } = await supabase
      .from("collection_records")
      .delete()
      .eq("id", params.data.recordId)
      .eq("collection_id", params.data.id)
      .eq("user_id", userId)
      .select("id")
      .maybeSingle()
    if (isMissingTableError(error)) return notAvailable(reply)
    if (error) return sendInternalError(reply, req, error, "Failed to delete the record")
    if (!data) return notFound(reply, "Record")
    return { success: true }
  })

  app.get(
    "/v1/collections/:id/export",
    // An export walks the whole collection: bounded per user.
    { preHandler: requireAppScope("assets:read"), config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const userId = requireUser(req, reply)
      if (!userId) return
      const params = idParams.safeParse(req.params)
      if (!params.success) return zodError(reply, params.error)
      const parsed = exportQuery.safeParse(req.query)
      if (!parsed.success) return zodError(reply, parsed.error)
      const found = await findCollection(params.data.id, userId)
      if (found.missingTable) return notFound(reply, "Collection")
      if (found.error) return sendInternalError(reply, req, found.error, "Failed to export the collection")
      if (!found.row) return notFound(reply, "Collection")
      const { format, since, q } = parsed.data
      const records = iterateRecords(params.data.id, userId, q, since)
      return reply
        .header("Content-Type", format === "csv" ? "text/csv; charset=utf-8" : "application/json; charset=utf-8")
        .header("Content-Disposition", exportContentDisposition(found.row.name, format))
        .header("Cache-Control", "no-store")
        .send(Readable.from(exportBody(req, records, format)))
    },
  )
}
