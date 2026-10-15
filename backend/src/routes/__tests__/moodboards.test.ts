/**
 * /v1/moodboards (routes/moodboards.ts).
 *
 * What must hold: every read and write is the caller's own row (a miss is 404);
 * images are 1..12 links that pass the same SSRF gate as every reference image
 * (http(s), never localhost or a private address) and are stored as given; an
 * OAuth app needs assets:read / assets:write; the list pages newest first; a
 * database without the table reads as empty and refuses writes with 503.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"
import { argOf, has, type QueryResult, type RecordedQuery } from "../../lib/__tests__/fake-supabase-query.js"

const db = vi.hoisted(() => ({
  log: [] as RecordedQuery[],
  respond: null as null | ((q: RecordedQuery) => QueryResult),
}))

vi.mock("../../lib/supabase.js", async () => {
  const { makeFakeFrom } = await import("../../lib/__tests__/fake-supabase-query.js")
  return { supabase: { from: makeFakeFrom(db.log, (q) => db.respond!(q)) } }
})

import { moodboardRoutes } from "../moodboards.js"

const OWNER = "00000000-0000-4000-8000-000000000001"
const BOARD = "00000000-0000-4000-8000-000000000041"
const IMG = "https://cdn.example.com/uploads/linen.png"

const ROW = {
  id: BOARD,
  user_id: OWNER,
  name: "Nordic calm",
  description: "Moody Nordic interiors, soft daylight",
  images: [{ url: IMG, caption: "linen" }, { url: "https://cdn.example.com/uploads/oak.png" }],
  created_at: "2026-10-15T10:00:00.000000+00:00",
  updated_at: "2026-10-15T10:00:00.000000+00:00",
}
const WIRE = {
  id: BOARD,
  name: "Nordic calm",
  description: "Moody Nordic interiors, soft daylight",
  images: ROW.images,
  createdAt: ROW.created_at,
  updatedAt: ROW.updated_at,
}
const MISSING_TABLE = { code: "PGRST205", message: "Could not find the table 'public.moodboards' in the schema cache" }

let app: FastifyInstance

function queries(op?: string): RecordedQuery[] {
  return db.log.filter((q) => q.table === "moodboards" && (!op || argOf(q, op)))
}

beforeEach(async () => {
  db.log.length = 0
  db.respond = () => ({ data: null, error: null })
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    const user = req.headers["x-user-id"]
    if (typeof user === "string") req.userId = user
    const scopes = req.headers["x-app-scopes"]
    if (typeof scopes === "string") req.appAuthorization = { scopes: scopes.split(" ") } as never
  })
  await app.register(moodboardRoutes)
  await app.ready()
})

afterEach(async () => {
  await app.close()
})

describe("POST /v1/moodboards", () => {
  it("creates the caller's moodboard; an empty caption is no caption", async () => {
    db.respond = () => ({ data: ROW, error: null })
    const res = await app.inject({
      method: "POST", url: "/v1/moodboards", headers: { "x-user-id": OWNER },
      payload: {
        name: " Nordic calm ",
        description: "Moody Nordic interiors, soft daylight",
        images: [{ url: IMG, caption: " linen " }, { url: "https://cdn.example.com/uploads/oak.png", caption: "" }],
      },
    })
    expect(res.statusCode).toBe(201)
    expect(res.json()).toEqual(WIRE)
    const [insert] = queries("insert")
    expect(argOf(insert, "insert")![0]).toEqual({
      user_id: OWNER,
      name: "Nordic calm",
      description: "Moody Nordic interiors, soft daylight",
      images: [{ url: IMG, caption: "linen" }, { url: "https://cdn.example.com/uploads/oak.png" }],
    })
  })

  it("takes a moodboard with no description", async () => {
    db.respond = () => ({ data: { ...ROW, description: null }, error: null })
    const res = await app.inject({
      method: "POST", url: "/v1/moodboards", headers: { "x-user-id": OWNER },
      payload: { name: "Board", images: [{ url: IMG }] },
    })
    expect(res.statusCode).toBe(201)
    expect((argOf(queries("insert")[0], "insert")![0] as Record<string, unknown>).description).toBeNull()
  })

  it.each([
    ["no images", { name: "x", images: [] }],
    ["thirteen images", { name: "x", images: Array.from({ length: 13 }, () => ({ url: IMG })) }],
    ["a localhost image", { name: "x", images: [{ url: "http://localhost:8080/a.png" }] }],
    ["a private-network image", { name: "x", images: [{ url: "http://10.0.0.5/a.png" }] }],
    ["a cloud metadata address", { name: "x", images: [{ url: "http://169.254.169.254/latest/meta-data" }] }],
    ["a non-http image", { name: "x", images: [{ url: "file:///etc/passwd" }] }],
    ["an image that is not a url", { name: "x", images: [{ url: "linen.png" }] }],
    ["a 201-character caption", { name: "x", images: [{ url: IMG, caption: "c".repeat(201) }] }],
    ["a 1001-character description", { name: "x", description: "d".repeat(1001), images: [{ url: IMG }] }],
    ["a blank name", { name: " ", images: [{ url: IMG }] }],
  ])("refuses %s with a validation error and writes nothing", async (_label, payload) => {
    const res = await app.inject({ method: "POST", url: "/v1/moodboards", headers: { "x-user-id": OWNER }, payload })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
    expect(queries("insert")).toHaveLength(0)
  })

  it("an OAuth app needs assets:write", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/moodboards", headers: { "x-user-id": OWNER, "x-app-scopes": "assets:read" },
      payload: { name: "x", images: [{ url: IMG }] },
    })
    expect(res.statusCode).toBe(403)
    expect(queries("insert")).toHaveLength(0)
  })

  it("answers 503 while the database has no moodboards table", async () => {
    db.respond = () => ({ data: null, error: MISSING_TABLE })
    const res = await app.inject({
      method: "POST", url: "/v1/moodboards", headers: { "x-user-id": OWNER },
      payload: { name: "x", images: [{ url: IMG }] },
    })
    expect(res.statusCode).toBe(503)
  })
})

describe("GET /v1/moodboards", () => {
  it("lists the caller's moodboards newest first", async () => {
    db.respond = () => ({ data: [ROW], error: null })
    const res = await app.inject({ method: "GET", url: "/v1/moodboards", headers: { "x-user-id": OWNER } })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ data: [WIRE], nextCursor: null })
    const [list] = queries()
    expect(has(list, "eq", "user_id", OWNER)).toBe(true)
    expect(has(list, "order", "created_at", { ascending: false })).toBe(true)
    expect(has(list, "limit", 51)).toBe(true)
  })

  it("reads as empty while the database has no moodboards table", async () => {
    db.respond = () => ({ data: null, error: MISSING_TABLE })
    const res = await app.inject({ method: "GET", url: "/v1/moodboards", headers: { "x-user-id": OWNER } })
    expect(res.json()).toEqual({ data: [], nextCursor: null })
  })

  it("an OAuth app needs assets:read", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/moodboards", headers: { "x-user-id": OWNER, "x-app-scopes": "assets:write" } })
    expect(res.statusCode).toBe(403)
  })
})

describe("GET /v1/moodboards/:id", () => {
  it("answers the caller's own moodboard and is 404 for anyone else's", async () => {
    db.respond = () => ({ data: ROW, error: null })
    const ok = await app.inject({ method: "GET", url: `/v1/moodboards/${BOARD}`, headers: { "x-user-id": OWNER } })
    expect(ok.statusCode).toBe(200)
    expect(ok.json()).toEqual(WIRE)
    const [get] = queries()
    expect(has(get, "eq", "id", BOARD)).toBe(true)
    expect(has(get, "eq", "user_id", OWNER)).toBe(true)

    db.respond = () => ({ data: null, error: null })
    const miss = await app.inject({ method: "GET", url: `/v1/moodboards/${BOARD}`, headers: { "x-user-id": OWNER } })
    expect(miss.statusCode).toBe(404)
  })
})

describe("PATCH /v1/moodboards/:id", () => {
  it("replaces the images and keeps what was not sent", async () => {
    db.respond = () => ({ data: ROW, error: null })
    const res = await app.inject({
      method: "PATCH", url: `/v1/moodboards/${BOARD}`, headers: { "x-user-id": OWNER },
      payload: { images: [{ url: IMG }] },
    })
    expect(res.statusCode).toBe(200)
    const [update] = queries("update")
    const written = argOf(update, "update")![0] as Record<string, unknown>
    expect(written.images).toEqual([{ url: IMG }])
    expect(written).not.toHaveProperty("name")
    expect(written).not.toHaveProperty("description")
    expect(has(update, "eq", "id", BOARD)).toBe(true)
    expect(has(update, "eq", "user_id", OWNER)).toBe(true)
  })

  it("refuses an unsafe image url on update too", async () => {
    const res = await app.inject({
      method: "PATCH", url: `/v1/moodboards/${BOARD}`, headers: { "x-user-id": OWNER },
      payload: { images: [{ url: "http://127.0.0.1/a.png" }] },
    })
    expect(res.statusCode).toBe(400)
    expect(queries("update")).toHaveLength(0)
  })

  it("is 404 when no row of the caller's matched", async () => {
    db.respond = () => ({ data: null, error: null })
    const res = await app.inject({ method: "PATCH", url: `/v1/moodboards/${BOARD}`, headers: { "x-user-id": OWNER }, payload: { name: "New" } })
    expect(res.statusCode).toBe(404)
  })
})

describe("DELETE /v1/moodboards/:id", () => {
  it("deletes the caller's own moodboard, and is 404 otherwise", async () => {
    db.respond = () => ({ data: { id: BOARD }, error: null })
    const res = await app.inject({ method: "DELETE", url: `/v1/moodboards/${BOARD}`, headers: { "x-user-id": OWNER } })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ success: true })
    const [del] = queries("delete")
    expect(has(del, "eq", "user_id", OWNER)).toBe(true)

    db.respond = () => ({ data: null, error: null })
    const miss = await app.inject({ method: "DELETE", url: `/v1/moodboards/${BOARD}`, headers: { "x-user-id": OWNER } })
    expect(miss.statusCode).toBe(404)
  })
})
