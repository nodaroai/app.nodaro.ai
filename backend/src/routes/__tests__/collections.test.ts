import { describe, it, expect, vi, beforeEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

vi.mock("@/lib/supabase.js", () => ({ supabase: { from: vi.fn() } }))
// A 500 files an incident report in the background; keep it off the mocked table.
vi.mock("@/lib/app-reports.js", () => ({ insertAppReport: vi.fn(async () => undefined) }))
// The item mapper, spied: a record write must check ownership BEFORE it looks at the item.
vi.mock("@nodaro/shared", async (importOriginal) => {
  const orig = (await importOriginal()) as typeof import("@nodaro/shared")
  return { ...orig, ingestRecordFromJson: vi.fn(orig.ingestRecordFromJson) }
})

const edition = vi.hoisted(() => ({ credits: true, maxCollections: undefined as number | undefined, maxRecords: undefined as number | undefined }))
vi.mock("@/lib/config.js", () => ({
  get config() {
    return {
      EDITION: edition.credits ? "cloud" : "community",
      SUPABASE_URL: "https://t.co",
      SUPABASE_SERVICE_ROLE_KEY: "k",
      COLLECTIONS_MAX_PER_USER: edition.maxCollections,
      COLLECTIONS_MAX_RECORDS_PER_COLLECTION: edition.maxRecords,
    }
  },
  isCloud: () => edition.credits,
  hasCredits: () => edition.credits,
  isCommunity: () => !edition.credits,
  isBusiness: () => false,
  hasAdmin: () => true,
}))

import {
  collectionRoutes,
  csvCell,
  csvLine,
  encodeRecordsCursor,
  exportContentDisposition,
  exportFilename,
  isRealTimestamp,
  parseRecordsCursor,
  searchWords,
  toCollection,
  violatedRule,
} from "../collections.js"
import { supabase } from "../../lib/supabase.js"
import { ingestRecordFromJson } from "@nodaro/shared"

const ingestMock = ingestRecordFromJson as unknown as ReturnType<typeof vi.fn>
const { ingestRecordFromJson: actualIngest } = await vi.importActual<typeof import("@nodaro/shared")>("@nodaro/shared")

const USER = "00000000-0000-4000-8000-000000000001"
const COLL = "00000000-0000-4000-8000-0000000000c1"
const REC = "00000000-0000-4000-8000-0000000000e1"
const REC2 = "00000000-0000-4000-8000-0000000000e2"
const MISSING_TABLE_CODES = ["42P01", "PGRST205"] as const
const LIGHT = "id, name"

type Result = { data?: unknown; error?: { code?: string; message?: string } | null; count?: number | null }

/** Chainable + thenable query-builder mock; `single` / `maybeSingle` / await resolve to `result`. */
function makeQB(result: Result = {}) {
  const resolved = { data: result.data ?? null, error: result.error ?? null, count: result.count ?? null }
  const qb: Record<string, unknown> = {}
  for (const name of ["select", "insert", "update", "delete", "eq", "gte", "in", "or", "order", "limit", "range"]) {
    qb[name] = vi.fn(() => qb)
  }
  qb.single = vi.fn(() => Promise.resolve({ data: resolved.data, error: resolved.error }))
  qb.maybeSingle = vi.fn(() => Promise.resolve({ data: resolved.data, error: resolved.error }))
  qb.then = (resolve: (v: unknown) => unknown) => resolve(resolved)
  return qb
}

type QB = ReturnType<typeof makeQB>
const fromMock = supabase.from as ReturnType<typeof vi.fn>

/** `supabase.from(table)` answers each table from its own queue; an exhausted queue repeats its last builder. */
function tables(queues: Record<string, QB[]>): Record<string, QB[]> {
  const used: Record<string, QB[]> = {}
  fromMock.mockImplementation((table: string) => {
    const queue = queues[table]
    if (!queue || queue.length === 0) {
      const empty = makeQB()
      ;(used[table] ??= []).push(empty)
      return empty
    }
    const next = queue.length > 1 ? queue.shift()! : queue[0]!
    ;(used[table] ??= []).push(next)
    return next
  })
  return used
}

function profile(tier = "free", lifetime = 0) {
  return makeQB({ data: { tier, subscription_tier: tier, lifetime_topup_credits: lifetime } })
}

function collectionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: COLL,
    name: "News",
    description: "Articles the pipeline wrote",
    created_at: "2026-10-06T08:00:00.000+00:00",
    updated_at: "2026-10-06T08:00:00.000+00:00",
    collection_records: [{ count: 2 }],
    ...overrides,
  }
}

/** The ownership read answers only the collection's id and name. */
const owned = () => makeQB({ data: { id: COLL, name: "News" } })

function recordRow(overrides: Record<string, unknown> = {}) {
  return {
    id: REC,
    collection_id: COLL,
    title: "Telegram turns ten",
    text: "The body.",
    url: "https://t.me/telegram/441",
    media: [{ type: "image", url: "https://cdn.example.com/a.jpg" }],
    fields: { channel: "telegram", views: "1.52M" },
    dedupe_key: "https://t.me/telegram/441",
    source: { via: "node", nodeType: "collection-write" },
    created_at: "2026-10-06T09:00:00.123456+00:00",
    ...overrides,
  }
}

async function buildApp(opts: { user?: boolean; scopes?: string[] } = {}): Promise<FastifyInstance> {
  const app = Fastify()
  app.addHook("preHandler", async (req) => {
    if (opts.user !== false) (req as { userId?: string }).userId = USER
    if (opts.scopes) (req as { appAuthorization?: unknown }).appAuthorization = { scopes: opts.scopes }
  })
  await app.register(collectionRoutes)
  return app
}

beforeEach(() => {
  vi.resetAllMocks()
  ingestMock.mockImplementation((item: unknown) => actualIngest(item))
  edition.credits = true
  edition.maxCollections = undefined
  edition.maxRecords = undefined
})

describe("collections helpers", () => {
  it("searchWords drops every character PostgREST or LIKE would read", () => {
    expect(searchWords(`  fold, (shirt) 100% "fast" a_b next.js  `)).toEqual(["fold", "shirt", "100", "fast", "a"])
  })

  it("a cursor round-trips, time zone included, and only its own shape parses", () => {
    const cursor = encodeRecordsCursor({ created_at: "2026-10-06T09:00:00.123456+00:00", id: REC })
    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(parseRecordsCursor(cursor)).toEqual({ createdAt: "2026-10-06T09:00:00.123456+00:00", id: REC })
    expect(parseRecordsCursor(Buffer.from(`2026-10-06),id.gt.0|${REC}`).toString("base64url"))).toBeNull()
    expect(parseRecordsCursor(Buffer.from(`2026-02-30T00:00:00Z|${REC}`).toString("base64url"))).toBeNull()
    expect(parseRecordsCursor("garbage")).toBeNull()
  })

  it("isRealTimestamp takes a real date and time only", () => {
    expect(isRealTimestamp("2026-10-06T09:00:00Z")).toBe(true)
    expect(isRealTimestamp("2026-10-06T09:00:00.123456+02:00")).toBe(true)
    expect(isRealTimestamp("2026-02-30T00:00:00Z")).toBe(false)
    expect(isRealTimestamp("2026-10-06T24:00:00Z")).toBe(false)
    expect(isRealTimestamp("2026-10-06")).toBe(false)
    expect(isRealTimestamp("yesterday")).toBe(false)
  })

  it("a CSV cell is quoted, doubles quotes, and defuses a formula, a tab and a return", () => {
    expect(csvCell('say "hi"')).toBe('"say ""hi"""')
    expect(csvCell("=SUM(A1)")).toBe(`"'=SUM(A1)"`)
    expect(csvCell("+1 (555)")).toBe(`"'+1 (555)"`)
    expect(csvCell("-5")).toBe(`"'-5"`)
    expect(csvCell("@handle")).toBe(`"'@handle"`)
    expect(csvCell("\tx")).toBe(`"'\tx"`)
    expect(csvCell("\rx")).toBe(`"'\rx"`)
    expect(csvCell(null)).toBe('""')
    expect(csvCell({ a: 1 })).toBe('"{""a"":1}"')
  })

  it("a CSV line carries the record's columns, media and fields as JSON", () => {
    const line = csvLine({
      id: REC,
      collectionId: COLL,
      title: "T",
      text: "=cmd",
      url: null,
      media: [{ type: "image", url: "https://cdn.example.com/a.jpg" }],
      fields: { views: "1.52M" },
      dedupeKey: null,
      source: {},
      createdAt: "2026-10-06T09:00:00.000Z",
    })
    expect(line).toBe(
      `"${REC}","2026-10-06T09:00:00.000Z","T","'=cmd","","","[{""type"":""image"",""url"":""https://cdn.example.com/a.jpg""}]","{""views"":""1.52M""}"`,
    )
  })

  it("an export file is named after the collection in ASCII, with the collection's own name beside it", () => {
    const day = new Date("2026-10-06T12:00:00Z")
    expect(exportFilename("My News!", "csv", day)).toBe("my-news-2026-10-06.csv")
    expect(exportFilename("חדשות", "json", day)).toBe("collection-2026-10-06.json")
    expect(exportFilename("Café  Stories", "csv", day)).toBe("cafe-stories-2026-10-06.csv")
    expect(exportContentDisposition("חדשות", "csv", day)).toBe(
      `attachment; filename="collection-2026-10-06.csv"; filename*=UTF-8''${encodeURIComponent("חדשות-2026-10-06.csv")}`,
    )
    expect(exportContentDisposition('a/b:"c"', "json", day)).toContain(`filename*=UTF-8''${encodeURIComponent("a b c-2026-10-06.json")}`)
  })

  it("violatedRule reads the index name out of a unique-violation message", () => {
    expect(violatedRule('duplicate key value violates unique constraint "uq_collection_records_dedupe"')).toBe("dedupe")
    expect(violatedRule('duplicate key value violates unique constraint "uq_collection_records_idempotency"')).toBe("idempotency")
    expect(violatedRule("duplicate key")).toBe("unknown")
    expect(violatedRule(undefined)).toBe("unknown")
  })

  it("toCollection reads the count embed as a list or as one object, and none as zero", () => {
    expect(toCollection(collectionRow({ collection_records: [{ count: 4 }] })).recordCount).toBe(4)
    expect(toCollection(collectionRow({ collection_records: { count: 9 } })).recordCount).toBe(9)
    expect(toCollection(collectionRow({ collection_records: null })).recordCount).toBe(0)
  })
})

describe("GET /v1/collections", () => {
  it("lists the caller's collections with their record counts and the tier's caps", async () => {
    const used = tables({ profiles: [profile("pro")], collections: [makeQB({ data: [collectionRow(), collectionRow({ id: "00000000-0000-4000-8000-0000000000c2", name: "Leads", collection_records: [] })] })] })
    const app = await buildApp()
    const res = await app.inject({ method: "GET", url: "/v1/collections" })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.available).toBe(true)
    expect(body.caps).toEqual({ collections: 100, records: 100_000 })
    expect(body.data).toHaveLength(2)
    expect(body.data[0]).toMatchObject({ id: COLL, name: "News", recordCount: 2 })
    expect(body.data[1].recordCount).toBe(0)
    expect(used.collections![0]!.eq).toHaveBeenCalledWith("user_id", USER)
    expect(used.profiles![0]!.select).toHaveBeenCalledWith("tier, subscription_tier, lifetime_topup_credits")
  })

  it("a free account with lifetime top-ups derives payg and gets basic's caps", async () => {
    tables({ profiles: [profile("free", 500)], collections: [makeQB({ data: [] })] })
    const app = await buildApp()
    const res = await app.inject({ method: "GET", url: "/v1/collections" })
    expect(res.json().caps).toEqual({ collections: 10, records: 5_000 })
  })

  it("a failed tier lookup, or a tier the caps table does not know, is NO cap — never free's", async () => {
    tables({ profiles: [makeQB({ error: { code: "XX000", message: "boom" } })], collections: [makeQB({ data: [] })] })
    const app = await buildApp()
    expect((await app.inject({ method: "GET", url: "/v1/collections" })).json().caps).toEqual({ collections: null, records: null })
    tables({ profiles: [profile("vip")], collections: [makeQB({ data: [] })] })
    expect((await app.inject({ method: "GET", url: "/v1/collections" })).json().caps).toEqual({ collections: null, records: null })
    tables({ profiles: [makeQB({ data: null })], collections: [makeQB({ data: [] })] })
    expect((await app.inject({ method: "GET", url: "/v1/collections" })).json().caps).toEqual({ collections: 3, records: 500 })
  })

  it.each(MISSING_TABLE_CODES)("answers not available, with empty data, while the table does not exist yet (%s)", async (code) => {
    tables({ profiles: [profile()], collections: [makeQB({ error: { code, message: "missing" } })] })
    const app = await buildApp()
    const res = await app.inject({ method: "GET", url: "/v1/collections" })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ data: [], available: false, caps: { collections: 3, records: 500 } })
  })

  it("off Nodaro Cloud the caps are the env ceilings, none when unset", async () => {
    edition.credits = false
    tables({ collections: [makeQB({ data: [] })] })
    const app = await buildApp()
    expect((await app.inject({ method: "GET", url: "/v1/collections" })).json().caps).toEqual({ collections: null, records: null })
    edition.maxCollections = 5
    edition.maxRecords = 1_000
    expect((await app.inject({ method: "GET", url: "/v1/collections" })).json().caps).toEqual({ collections: 5, records: 1_000 })
    expect(fromMock).not.toHaveBeenCalledWith("profiles")
  })

  it("refuses a caller without a user, and an app token without assets:read", async () => {
    expect((await (await buildApp({ user: false })).inject({ method: "GET", url: "/v1/collections" })).statusCode).toBe(401)
    expect((await (await buildApp({ scopes: ["assets:write"] })).inject({ method: "GET", url: "/v1/collections" })).statusCode).toBe(403)
    expect(fromMock).not.toHaveBeenCalled()
  })
})

describe("POST /v1/collections", () => {
  it("creates a collection for the caller under its cap", async () => {
    const insert = makeQB({ data: collectionRow({ collection_records: [] }) })
    const used = tables({ profiles: [profile("free")], collections: [makeQB({ count: 2 }), insert] })
    const app = await buildApp()
    const res = await app.inject({ method: "POST", url: "/v1/collections", payload: { name: "  News ", description: "Articles the pipeline wrote" } })
    expect(res.statusCode).toBe(201)
    expect(used.collections![0]!.select).toHaveBeenCalledWith("id", { count: "exact", head: true })
    expect(used.collections![0]!.eq).toHaveBeenCalledWith("user_id", USER)
    expect(insert.insert).toHaveBeenCalledWith({ user_id: USER, name: "News", description: "Articles the pipeline wrote" })
    expect(res.json()).toMatchObject({ id: COLL, name: "News", recordCount: 0 })
  })

  it("refuses a collection past the plan's cap, but never when the tier lookup failed", async () => {
    tables({ profiles: [profile("free")], collections: [makeQB({ count: 3 })] })
    const app = await buildApp()
    const res = await app.inject({ method: "POST", url: "/v1/collections", payload: { name: "Fourth" } })
    expect(res.statusCode).toBe(403)
    expect(res.json().error).toEqual({ code: "collection_limit_reached", message: "Your plan allows 3 collections." })

    tables({ profiles: [makeQB({ error: { code: "XX000", message: "boom" } })], collections: [makeQB({ count: 3 }), makeQB({ data: collectionRow() })] })
    expect((await app.inject({ method: "POST", url: "/v1/collections", payload: { name: "Fourth" } })).statusCode).toBe(201)
  })

  it("answers 409 name_taken when the name is already the caller's", async () => {
    tables({ profiles: [profile()], collections: [makeQB({ count: 0 }), makeQB({ error: { code: "23505", message: "dup" } })] })
    const app = await buildApp()
    const res = await app.inject({ method: "POST", url: "/v1/collections", payload: { name: "news" } })
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe("name_taken")
  })

  it.each(MISSING_TABLE_CODES)("answers 503 while the table does not exist yet (%s)", async (code) => {
    tables({ profiles: [profile()], collections: [makeQB({ error: { code } })] })
    const app = await buildApp()
    const res = await app.inject({ method: "POST", url: "/v1/collections", payload: { name: "News" } })
    expect(res.statusCode).toBe(503)
    expect(res.json().error.code).toBe("not_available")
  })

  it("refuses an empty or over-long name before touching the table", async () => {
    const app = await buildApp()
    expect((await app.inject({ method: "POST", url: "/v1/collections", payload: { name: "   " } })).statusCode).toBe(400)
    expect((await app.inject({ method: "POST", url: "/v1/collections", payload: { name: "x".repeat(81) } })).statusCode).toBe(400)
    expect(fromMock).not.toHaveBeenCalled()
  })

  it("needs the assets:write scope from an app token", async () => {
    const app = await buildApp({ scopes: ["assets:read"] })
    expect((await app.inject({ method: "POST", url: "/v1/collections", payload: { name: "News" } })).statusCode).toBe(403)
  })
})

describe("GET / PATCH / DELETE /v1/collections/:id", () => {
  it("reads the caller's collection with its count, 404 for another person's", async () => {
    const mine = makeQB({ data: collectionRow({ collection_records: { count: 4 } }) })
    tables({ collections: [mine, makeQB({ data: null })] })
    const app = await buildApp()
    expect((await app.inject({ method: "GET", url: `/v1/collections/${COLL}` })).json()).toMatchObject({ id: COLL, recordCount: 4 })
    expect(mine.select).toHaveBeenCalledWith(expect.stringContaining("collection_records(count)"))
    expect(mine.eq).toHaveBeenCalledWith("id", COLL)
    expect(mine.eq).toHaveBeenCalledWith("user_id", USER)
    expect((await app.inject({ method: "GET", url: `/v1/collections/${COLL}` })).statusCode).toBe(404)
  })

  it("renames and re-describes, stamping updated_at, scoped to the caller", async () => {
    const qb = makeQB({ data: collectionRow({ name: "World" }) })
    tables({ collections: [qb] })
    const app = await buildApp()
    const res = await app.inject({ method: "PATCH", url: `/v1/collections/${COLL}`, payload: { name: "World" } })
    expect(res.statusCode).toBe(200)
    expect(qb.update).toHaveBeenCalledWith(expect.objectContaining({ name: "World", updated_at: expect.any(String) }))
    expect(qb.eq).toHaveBeenCalledWith("id", COLL)
    expect(qb.eq).toHaveBeenCalledWith("user_id", USER)
    expect(res.json().name).toBe("World")
  })

  it("refuses an update with nothing in it, and a name another collection has", async () => {
    const app = await buildApp()
    expect((await app.inject({ method: "PATCH", url: `/v1/collections/${COLL}`, payload: {} })).statusCode).toBe(400)
    tables({ collections: [makeQB({ error: { code: "23505", message: "dup" } })] })
    const res = await app.inject({ method: "PATCH", url: `/v1/collections/${COLL}`, payload: { name: "Leads" } })
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe("name_taken")
  })

  it("deletes the caller's collection, 404 when it is not theirs, and refuses a non-uuid id", async () => {
    const qb = makeQB({ data: { id: COLL } })
    tables({ collections: [qb, makeQB({ data: null })] })
    const app = await buildApp()
    expect((await app.inject({ method: "DELETE", url: `/v1/collections/${COLL}` })).json()).toEqual({ success: true })
    expect(qb.eq).toHaveBeenCalledWith("user_id", USER)
    expect((await app.inject({ method: "DELETE", url: `/v1/collections/${COLL}` })).statusCode).toBe(404)
    expect((await app.inject({ method: "DELETE", url: "/v1/collections/abc" })).statusCode).toBe(400)
  })
})

describe("GET /v1/collections/:id/records", () => {
  it("lists newest first with a cursor when more remain, after a light ownership read scoped to the caller", async () => {
    const ownership = owned()
    const records = makeQB({ data: [recordRow(), recordRow({ id: REC2 })] })
    tables({ collections: [ownership], collection_records: [records] })
    const app = await buildApp()
    const res = await app.inject({ method: "GET", url: `/v1/collections/${COLL}/records?limit=1` })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.data).toHaveLength(1)
    expect(body.data[0]).toEqual({
      id: REC,
      collectionId: COLL,
      title: "Telegram turns ten",
      text: "The body.",
      url: "https://t.me/telegram/441",
      media: [{ type: "image", url: "https://cdn.example.com/a.jpg" }],
      fields: { channel: "telegram", views: "1.52M" },
      dedupeKey: "https://t.me/telegram/441",
      source: { via: "node", nodeType: "collection-write" },
      createdAt: "2026-10-06T09:00:00.123456+00:00",
    })
    expect(parseRecordsCursor(body.nextCursor)).toEqual({ createdAt: recordRow().created_at, id: REC })
    expect(ownership.select).toHaveBeenCalledWith(LIGHT)
    expect(ownership.eq).toHaveBeenCalledWith("id", COLL)
    expect(ownership.eq).toHaveBeenCalledWith("user_id", USER)
    expect(records.eq).toHaveBeenCalledWith("collection_id", COLL)
    expect(records.eq).toHaveBeenCalledWith("user_id", USER)
    expect(records.limit).toHaveBeenCalledWith(2)
  })

  it("filters by words, since and a cursor it gave out", async () => {
    const records = makeQB({ data: [] })
    tables({ collections: [owned()], collection_records: [records] })
    const app = await buildApp()
    const cursor = encodeRecordsCursor({ created_at: "2026-10-06T09:00:00+02:00", id: REC })
    const res = await app.inject({ method: "GET", url: `/v1/collections/${COLL}/records?q=fold%20shirt&since=2026-10-05T00:00:00Z&cursor=${cursor}` })
    expect(res.statusCode).toBe(200)
    expect(records.gte).toHaveBeenCalledWith("created_at", "2026-10-05T00:00:00Z")
    expect(records.or).toHaveBeenCalledWith("title.ilike.*fold*,text.ilike.*fold*,url.ilike.*fold*")
    expect(records.or).toHaveBeenCalledWith("title.ilike.*shirt*,text.ilike.*shirt*,url.ilike.*shirt*")
    expect(records.or).toHaveBeenCalledWith(`created_at.lt.2026-10-06T09:00:00+02:00,and(created_at.eq.2026-10-06T09:00:00+02:00,id.lt.${REC})`)
  })

  it("refuses a cursor it did not give out, a since that is not a timestamp, and an impossible date", async () => {
    const app = await buildApp()
    expect((await app.inject({ method: "GET", url: `/v1/collections/${COLL}/records?cursor=abc` })).json().error.code).toBe("invalid_cursor")
    expect((await app.inject({ method: "GET", url: `/v1/collections/${COLL}/records?since=yesterday` })).statusCode).toBe(400)
    expect((await app.inject({ method: "GET", url: `/v1/collections/${COLL}/records?since=2026-02-30T00:00:00Z` })).statusCode).toBe(400)
    expect((await app.inject({ method: "GET", url: `/v1/collections/${COLL}/records?since=2026-10-05` })).statusCode).toBe(400)
    expect(fromMock).not.toHaveBeenCalled()
  })

  it("answers 404 for a collection that is not the caller's, reading no record", async () => {
    tables({ collections: [makeQB({ data: null })] })
    const app = await buildApp()
    expect((await app.inject({ method: "GET", url: `/v1/collections/${COLL}/records` })).statusCode).toBe(404)
    expect(fromMock).not.toHaveBeenCalledWith("collection_records")
  })
})

describe("POST /v1/collections/:id/records", () => {
  it("checks ownership first, then stores an item's record with explicit fields winning, the link as the dedupe key, and the idempotency key", async () => {
    const ownership = owned()
    const insert = makeQB({ data: recordRow() })
    tables({
      collections: [ownership],
      collection_records: [insert, makeQB({ count: 3 })],
      profiles: [profile("free")],
    })
    const app = await buildApp()
    const res = await app.inject({
      method: "POST",
      url: `/v1/collections/${COLL}/records`,
      headers: { "idempotency-key": "wf-exec1-node1-0" },
      payload: {
        item: {
          id: 441,
          channel: "telegram",
          postUrl: "https://T.me/Telegram/441",
          text: "Telegram turns ten.",
          media: [{ type: "photo", url: "https://cdn.example.com/a.jpg" }],
          views: "1.52M",
        },
        title: "Telegram turns ten",
        fields: { topic: "tech" },
        source: { via: "node", nodeType: "collection-write", workflowId: "wf1" },
      },
    })
    expect(res.statusCode).toBe(201)
    expect(fromMock.mock.calls[0]![0]).toBe("collections")
    expect(ingestMock).toHaveBeenCalledTimes(1)
    expect(ownership.select).toHaveBeenCalledWith(LIGHT)
    expect(ownership.eq).toHaveBeenCalledWith("user_id", USER)
    expect(insert.insert).toHaveBeenCalledWith({
      collection_id: COLL,
      user_id: USER,
      dedupe_key: "https://t.me/Telegram/441",
      idempotency_key: "wf-exec1-node1-0",
      title: "Telegram turns ten",
      text: "Telegram turns ten.",
      url: "https://T.me/Telegram/441",
      media: [{ type: "image", url: "https://cdn.example.com/a.jpg" }],
      fields: { id: 441, channel: "telegram", views: "1.52M", topic: "tech" },
      source: { via: "node", nodeType: "collection-write", workflowId: "wf1" },
    })
    expect(res.json()).toMatchObject({ outcome: "inserted", evicted: 0, record: { id: REC } })
  })

  it("evicts the oldest records past the cap-th newest — a bounded id list per write, scoped to the collection and the caller", async () => {
    edition.credits = false
    edition.maxRecords = 5
    const count = makeQB({ count: 7 })
    const boundary = makeQB({ data: { created_at: "2026-10-06T07:00:00.000+00:00", id: "00000000-0000-4000-8000-0000000000a5" } })
    const victimIds = ["00000000-0000-4000-8000-0000000000a1", "00000000-0000-4000-8000-0000000000a2"]
    const victims = makeQB({ data: victimIds.map((id) => ({ id })) })
    const remove = makeQB({ count: 2 })
    tables({
      collections: [owned()],
      collection_records: [makeQB({ data: recordRow() }), count, boundary, victims, remove],
    })
    const app = await buildApp()
    const res = await app.inject({ method: "POST", url: `/v1/collections/${COLL}/records`, payload: { title: "Seventh" } })
    expect(res.statusCode).toBe(201)
    expect(res.json().evicted).toBe(2)
    expect(count.select).toHaveBeenCalledWith("id", { count: "exact", head: true })
    expect(count.eq).toHaveBeenCalledWith("collection_id", COLL)
    expect(count.eq).toHaveBeenCalledWith("user_id", USER)
    expect(boundary.order).toHaveBeenCalledWith("created_at", { ascending: false })
    expect(boundary.range).toHaveBeenCalledWith(4, 4)
    // The victims: everything older than the boundary, oldest first, at most COLLECTION_EVICT_MAX_PER_WRITE.
    expect(victims.or).toHaveBeenCalledWith(
      "created_at.lt.2026-10-06T07:00:00.000+00:00,and(created_at.eq.2026-10-06T07:00:00.000+00:00,id.lt.00000000-0000-4000-8000-0000000000a5)",
    )
    expect(victims.order).toHaveBeenCalledWith("created_at", { ascending: true })
    expect(victims.limit).toHaveBeenCalledWith(100)
    expect(victims.eq).toHaveBeenCalledWith("user_id", USER)
    expect(remove.delete).toHaveBeenCalledWith({ count: "exact" })
    expect(remove.eq).toHaveBeenCalledWith("collection_id", COLL)
    expect(remove.eq).toHaveBeenCalledWith("user_id", USER)
    expect(remove.in).toHaveBeenCalledWith("id", victimIds)
    expect(remove.or).not.toHaveBeenCalled()
  })

  it("evicts nothing when the collection is at or under its cap, or when it has no cap", async () => {
    edition.credits = false
    edition.maxRecords = 5
    const used = tables({ collections: [owned()], collection_records: [makeQB({ data: recordRow() }), makeQB({ count: 5 })] })
    const app = await buildApp()
    expect((await app.inject({ method: "POST", url: `/v1/collections/${COLL}/records`, payload: { title: "Fifth" } })).json().evicted).toBe(0)
    expect(used.collection_records).toHaveLength(2)

    edition.maxRecords = undefined
    const unlimited = tables({ collections: [owned()], collection_records: [makeQB({ data: recordRow() })] })
    expect((await app.inject({ method: "POST", url: `/v1/collections/${COLL}/records`, payload: { title: "Sixth" } })).json().evicted).toBe(0)
    expect(unlimited.collection_records).toHaveLength(1)
  })

  it("a failed tier lookup evicts NOTHING (a paying account must never be cut to free's cap)", async () => {
    const used = tables({
      collections: [owned()],
      collection_records: [makeQB({ data: recordRow() })],
      profiles: [makeQB({ error: { code: "XX000", message: "boom" } })],
    })
    const app = await buildApp()
    const res = await app.inject({ method: "POST", url: `/v1/collections/${COLL}/records`, payload: { title: "Kept" } })
    expect(res.statusCode).toBe(201)
    expect(res.json().evicted).toBe(0)
    expect(used.collection_records).toHaveLength(1)
    expect(fromMock).toHaveBeenCalledWith("profiles")
  })

  it("answers the existing record as a duplicate when the dedupe rule fires", async () => {
    const existing = makeQB({ data: recordRow() })
    tables({
      collections: [owned()],
      collection_records: [makeQB({ error: { code: "23505", message: 'duplicate key value violates unique constraint "uq_collection_records_dedupe"' } }), existing],
    })
    const app = await buildApp()
    const res = await app.inject({ method: "POST", url: `/v1/collections/${COLL}/records`, payload: { url: "https://t.me/telegram/441", text: "again" } })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ outcome: "duplicate", evicted: 0, record: { id: REC } })
    expect(existing.eq).toHaveBeenCalledWith("dedupe_key", "https://t.me/telegram/441")
    expect(existing.eq).toHaveBeenCalledWith("user_id", USER)
    expect(fromMock).not.toHaveBeenCalledWith("profiles")
  })

  it("answers the existing record as replayed when the idempotency rule fires", async () => {
    const existing = makeQB({ data: recordRow() })
    tables({
      collections: [owned()],
      collection_records: [makeQB({ error: { code: "23505", message: 'duplicate key value violates unique constraint "uq_collection_records_idempotency"' } }), existing],
    })
    const app = await buildApp()
    const res = await app.inject({
      method: "POST",
      url: `/v1/collections/${COLL}/records`,
      headers: { "idempotency-key": "wf-exec1-node1-0" },
      payload: { text: "a replay" },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().outcome).toBe("replayed")
    expect(existing.eq).toHaveBeenCalledWith("idempotency_key", "wf-exec1-node1-0")
  })

  it("answers 409 only when the unique rule fires twice with the row gone both times (#1890: one retry)", async () => {
    const DUP = { error: { code: "23505", message: "dup" } }
    tables({
      collections: [owned()],
      collection_records: [makeQB(DUP), makeQB({ data: null }), makeQB(DUP), makeQB({ data: null })],
    })
    const app = await buildApp()
    const res = await app.inject({ method: "POST", url: `/v1/collections/${COLL}/records`, payload: { url: "https://t.me/telegram/441" } })
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe("conflict")
  })

  it("a unique violation whose row is gone by the lookup is inserted again (#1890)", async () => {
    tables({
      collections: [owned()],
      collection_records: [makeQB({ error: { code: "23505", message: "dup" } }), makeQB({ data: null }), makeQB({ data: recordRow() }), makeQB({ count: 1 })],
      profiles: [profile()],
    })
    const app = await buildApp()
    const res = await app.inject({ method: "POST", url: `/v1/collections/${COLL}/records`, payload: { url: "https://t.me/telegram/441" } })
    expect(res.statusCode).toBe(201)
  })

  it("accepts a medium with a null poster, and a long text cut to whole characters", async () => {
    const insert = makeQB({ data: recordRow() })
    tables({ collections: [owned()], collection_records: [insert, makeQB({ count: 1 })], profiles: [profile()] })
    const app = await buildApp()
    const res = await app.inject({
      method: "POST",
      url: `/v1/collections/${COLL}/records`,
      payload: { media: [{ type: "image", url: "https://cdn.example.com/a.jpg", posterUrl: null }], item: { text: "😀".repeat(12_000) } },
    })
    expect(res.statusCode).toBe(201)
    const inserted = (insert.insert as ReturnType<typeof vi.fn>).mock.calls[0]![0] as { media: unknown; text: string }
    expect(inserted.media).toEqual([{ type: "image", url: "https://cdn.example.com/a.jpg" }])
    expect(Array.from(inserted.text)).toHaveLength(12_000)
  })

  it("refuses an empty record, a bad link and a bad Idempotency-Key before touching the table", async () => {
    const app = await buildApp()
    tables({ collections: [owned()] })
    const empty = await app.inject({ method: "POST", url: `/v1/collections/${COLL}/records`, payload: { item: { nothing: null } } })
    expect(empty.statusCode).toBe(400)
    expect(empty.json().error.code).toBe("empty_record")
    expect(fromMock).not.toHaveBeenCalledWith("collection_records")
    expect((await app.inject({ method: "POST", url: `/v1/collections/${COLL}/records`, payload: { url: "javascript:alert(1)" } })).statusCode).toBe(400)
    const key = await app.inject({ method: "POST", url: `/v1/collections/${COLL}/records`, headers: { "idempotency-key": "x".repeat(201) }, payload: { text: "t" } })
    expect(key.statusCode).toBe(400)
  })

  it("answers 404 for another person's collection before reading the item, and 503 while the table does not exist yet", async () => {
    tables({ collections: [makeQB({ data: null })] })
    const app = await buildApp()
    expect((await app.inject({ method: "POST", url: `/v1/collections/${COLL}/records`, payload: { item: { text: "never mapped" } } })).statusCode).toBe(404)
    expect(ingestMock).not.toHaveBeenCalled()
    tables({ collections: [makeQB({ error: { code: "42P01" } })] })
    const res = await app.inject({ method: "POST", url: `/v1/collections/${COLL}/records`, payload: { text: "t" } })
    expect(res.statusCode).toBe(503)
    expect(res.json().error.code).toBe("not_available")
  })

  it("needs the assets:write scope from an app token", async () => {
    const app = await buildApp({ scopes: ["assets:read"] })
    expect((await app.inject({ method: "POST", url: `/v1/collections/${COLL}/records`, payload: { text: "t" } })).statusCode).toBe(403)
  })
})

describe("DELETE /v1/collections/:id/records/:recordId", () => {
  it("deletes the caller's record within the collection, 404 otherwise", async () => {
    const qb = makeQB({ data: { id: REC } })
    tables({ collection_records: [qb, makeQB({ data: null })] })
    const app = await buildApp()
    expect((await app.inject({ method: "DELETE", url: `/v1/collections/${COLL}/records/${REC}` })).json()).toEqual({ success: true })
    expect(qb.eq).toHaveBeenCalledWith("id", REC)
    expect(qb.eq).toHaveBeenCalledWith("collection_id", COLL)
    expect(qb.eq).toHaveBeenCalledWith("user_id", USER)
    expect((await app.inject({ method: "DELETE", url: `/v1/collections/${COLL}/records/${REC}` })).statusCode).toBe(404)
  })
})

describe("GET /v1/collections/:id/export", () => {
  it("streams a UTF-8 CSV with a mark, a header, defused formulas and both file names", async () => {
    tables({
      collections: [makeQB({ data: { id: COLL, name: "World News" } })],
      collection_records: [makeQB({ data: [recordRow({ text: "=HYPERLINK(\"x\")" }), recordRow({ id: REC2, title: 'He said "hi"', url: null, media: [], fields: {} })] })],
    })
    const app = await buildApp()
    const res = await app.inject({ method: "GET", url: `/v1/collections/${COLL}/export` })
    expect(res.statusCode).toBe(200)
    expect(res.headers["content-type"]).toContain("text/csv")
    expect(res.headers["content-disposition"]).toMatch(/^attachment; filename="world-news-\d{4}-\d{2}-\d{2}\.csv"; filename\*=UTF-8''World%20News-\d{4}-\d{2}-\d{2}\.csv$/)
    expect(res.body.startsWith("﻿")).toBe(true)
    const lines = res.body.slice(1).split("\r\n").filter((l) => l.length > 0)
    expect(lines[0]).toBe("id,created_at,title,text,url,dedupe_key,media,fields")
    expect(lines[1]).toContain(`"'=HYPERLINK(""x"")"`)
    expect(lines[2]).toContain('"He said ""hi"""')
    expect(lines).toHaveLength(3)
  })

  it("walks past the first page with the last row as the next page's cursor", async () => {
    const first = makeQB({ data: Array.from({ length: 200 }, (_, i) => recordRow({ id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`, created_at: `2026-10-06T09:${String(59 - Math.floor(i / 4)).padStart(2, "0")}:00.000+00:00` })) })
    const second = makeQB({ data: [recordRow({ id: REC2 })] })
    tables({ collections: [owned()], collection_records: [first, second] })
    const app = await buildApp()
    const res = await app.inject({ method: "GET", url: `/v1/collections/${COLL}/export?format=json` })
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body)).toHaveLength(201)
    expect(first.limit).toHaveBeenCalledWith(200)
    expect(first.or).not.toHaveBeenCalled()
    expect(second.or).toHaveBeenCalledWith(
      `created_at.lt.2026-10-06T09:10:00.000+00:00,and(created_at.eq.2026-10-06T09:10:00.000+00:00,id.lt.00000000-0000-4000-8000-000000000199)`,
    )
  })

  it("streams JSON on request and answers 404 for another person's collection", async () => {
    tables({ collections: [owned()], collection_records: [makeQB({ data: [recordRow()] })] })
    const app = await buildApp()
    const res = await app.inject({ method: "GET", url: `/v1/collections/${COLL}/export?format=json` })
    expect(res.statusCode).toBe(200)
    expect(res.headers["content-type"]).toContain("application/json")
    expect(JSON.parse(res.body)).toEqual([expect.objectContaining({ id: REC, title: "Telegram turns ten" })])
    tables({ collections: [makeQB({ data: null })] })
    expect((await app.inject({ method: "GET", url: `/v1/collections/${COLL}/export` })).statusCode).toBe(404)
  })
})
