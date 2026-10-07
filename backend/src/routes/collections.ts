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
  isCollectionUrl,
  type AddCollectionRecordResult,
  type CollectionRecord,
  type CollectionRecordSource,
  type ListCollectionsResult,
} from "@nodaro/shared"
import { supabase } from "../lib/supabase.js"
import { requireAppScope } from "../lib/scope-prehandler.js"
import { sendInternalError } from "../lib/http-errors.js"
import { isMissingTableError } from "../lib/postgrest-errors.js"
import {
  COLLECTION_COLUMNS,
  findCollection,
  limitsFor,
  readRecordsPage,
  toCollection,
  toRecord,
  writeCollectionRecord,
  type CollectionRow,
  type RecordRow,
} from "../lib/collections-store.js"

export { searchWords, toCollection, violatedRule } from "../lib/collections-store.js"

/**
 * Collections — where a workflow's records live (migration 462). The API over
 * `lib/collections-store.ts`, which the two collection nodes share
 * (`routes/collection-nodes.ts`). Personal data: every query is scoped to the
 * caller's user_id. Table-tolerant: staging and production share one database
 * and the migration lands only on main, so a missing table reads as "not
 * available" (`available: false`, empty lists) and refuses writes with a 503,
 * never a 500.
 *
 * Caps (decided 2026-10-05): on Nodaro Cloud by effective tier
 * (`COLLECTION_TIER_CAPS`), self-hosted by two env ceilings (unset = none).
 * Past a collection's records cap the OLDEST records are evicted after the
 * write (the store's one range delete); the answer says how many went
 * (`evicted`). A limits lookup that fails, or a tier the caps table does not
 * know, means NO cap for that request — never free's.
 */

/** Records fetched per round while streaming an export. */
const EXPORT_PAGE = 200
const SOURCE_VIAS = ["api", "mcp", "node", "ui"] as const
/** The byte-order mark that makes a spreadsheet read a CSV as UTF-8 (Hebrew, Japanese, Korean text). */
const CSV_BOM = "﻿"

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
      const { source: given, ...input } = parsed.data
      const source: CollectionRecordSource = { via: "api", ...(given ?? {}) }

      const outcome = await writeCollectionRecord(req, { userId, collectionId: params.data.id, input, idempotencyKey: idem.key, source })
      switch (outcome.kind) {
        case "inserted": {
          const result: AddCollectionRecordResult = { record: outcome.record, outcome: "inserted", evicted: outcome.evicted }
          return reply.status(201).send(result)
        }
        case "duplicate":
        case "replayed": {
          const result: AddCollectionRecordResult = { record: outcome.record, outcome: outcome.kind, evicted: 0 }
          return reply.status(200).send(result)
        }
        case "not_found":
          return notFound(reply, "Collection")
        case "missing_table":
          return notAvailable(reply)
        case "empty":
          return reply.status(400).send({ error: { code: "empty_record", message: "A record needs a title, a text, a link or a medium." } })
        case "conflict":
          return reply.status(409).send({ error: { code: "conflict", message: "The record changed while saving. Try again." } })
        case "error":
          return sendInternalError(reply, req, outcome.error, "Failed to save the record")
      }
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

export type { RecordRow }
