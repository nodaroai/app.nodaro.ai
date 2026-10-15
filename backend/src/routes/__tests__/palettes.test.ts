/**
 * /v1/palettes (routes/palettes.ts).
 *
 * What must hold: every read and write is the caller's own row (a miss is 404,
 * never another person's row); colours are #RRGGBB and stored upper case; an
 * OAuth app needs assets:read to read and assets:write to write; the list pages
 * newest first by a strict (created_at, id) keyset; a server whose database has
 * not got the table yet reads as empty and refuses writes with 503.
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

import { paletteRoutes } from "../palettes.js"
import { encodeKeysetCursor } from "../../lib/keyset-cursor.js"

const OWNER = "00000000-0000-4000-8000-000000000001"
const PALETTE = "00000000-0000-4000-8000-000000000031"

const ROW = {
  id: PALETTE,
  user_id: OWNER,
  name: "Harbour",
  colors: ["#0F4C5C", "#E3B23C"],
  description: null,
  created_at: "2026-10-15T10:00:00.000000+00:00",
  updated_at: "2026-10-15T10:00:00.000000+00:00",
}
const WIRE = {
  id: PALETTE,
  name: "Harbour",
  colors: ["#0F4C5C", "#E3B23C"],
  description: null,
  createdAt: ROW.created_at,
  updatedAt: ROW.updated_at,
}
const MISSING_TABLE = { code: "42P01", message: 'relation "color_palettes" does not exist' }

let app: FastifyInstance

function queries(op?: string): RecordedQuery[] {
  return db.log.filter((q) => q.table === "color_palettes" && (!op || argOf(q, op)))
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
  await app.register(paletteRoutes)
  await app.ready()
})

afterEach(async () => {
  await app.close()
})

describe("POST /v1/palettes", () => {
  it("creates the caller's palette, colours upper case, name trimmed", async () => {
    db.respond = () => ({ data: ROW, error: null })
    const res = await app.inject({
      method: "POST", url: "/v1/palettes", headers: { "x-user-id": OWNER },
      payload: { name: "  Harbour ", colors: ["#0f4c5c", "#E3B23C"], description: "" },
    })
    expect(res.statusCode).toBe(201)
    expect(res.json()).toEqual(WIRE)
    const [insert] = queries("insert")
    expect(argOf(insert, "insert")![0]).toEqual({
      user_id: OWNER, name: "Harbour", colors: ["#0F4C5C", "#E3B23C"], description: null,
    })
  })

  it.each([
    ["one colour", { name: "x", colors: ["#000000"] }],
    ["thirteen colours", { name: "x", colors: Array.from({ length: 13 }, () => "#000000") }],
    ["a colour that is not #RRGGBB", { name: "x", colors: ["#000000", "teal"] }],
    ["a short hex", { name: "x", colors: ["#000000", "#FFF"] }],
    ["a blank name", { name: "   ", colors: ["#000000", "#FFFFFF"] }],
    ["an 81-character name", { name: "n".repeat(81), colors: ["#000000", "#FFFFFF"] }],
    ["a 501-character description", { name: "x", colors: ["#000000", "#FFFFFF"], description: "d".repeat(501) }],
  ])("refuses %s with a validation error and writes nothing", async (_label, payload) => {
    const res = await app.inject({ method: "POST", url: "/v1/palettes", headers: { "x-user-id": OWNER }, payload })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
    expect(queries("insert")).toHaveLength(0)
  })

  it("an OAuth app needs assets:write", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/palettes", headers: { "x-user-id": OWNER, "x-app-scopes": "assets:read" },
      payload: { name: "x", colors: ["#000000", "#FFFFFF"] },
    })
    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe("insufficient_scope")
    expect(queries("insert")).toHaveLength(0)
  })

  it("answers 503 while the database has no palettes table", async () => {
    db.respond = () => ({ data: null, error: MISSING_TABLE })
    const res = await app.inject({
      method: "POST", url: "/v1/palettes", headers: { "x-user-id": OWNER },
      payload: { name: "x", colors: ["#000000", "#FFFFFF"] },
    })
    expect(res.statusCode).toBe(503)
    expect(res.json().error.code).toBe("not_available")
  })

  it("needs a signed-in caller", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/palettes", payload: { name: "x", colors: ["#000000", "#FFFFFF"] } })
    expect(res.statusCode).toBe(401)
  })
})

describe("GET /v1/palettes", () => {
  it("lists the caller's palettes newest first, one probe row past the page", async () => {
    db.respond = () => ({ data: [ROW], error: null })
    const res = await app.inject({ method: "GET", url: "/v1/palettes?limit=10", headers: { "x-user-id": OWNER } })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ data: [WIRE], nextCursor: null })
    const [list] = queries()
    expect(has(list, "eq", "user_id", OWNER)).toBe(true)
    expect(has(list, "order", "created_at", { ascending: false })).toBe(true)
    expect(has(list, "order", "id", { ascending: false })).toBe(true)
    expect(has(list, "limit", 11)).toBe(true)
  })

  it("hands back a cursor when there is another page, and follows one", async () => {
    const second = { ...ROW, id: "00000000-0000-4000-8000-000000000032", created_at: "2026-10-14T10:00:00.000000+00:00" }
    db.respond = () => ({ data: [ROW, second], error: null })
    const res = await app.inject({ method: "GET", url: "/v1/palettes?limit=1", headers: { "x-user-id": OWNER } })
    const body = res.json()
    expect(body.data).toHaveLength(1)
    expect(body.nextCursor).toBe(encodeKeysetCursor({ createdAt: ROW.created_at, id: ROW.id }))

    db.log.length = 0
    db.respond = () => ({ data: [second], error: null })
    await app.inject({
      method: "GET", url: `/v1/palettes?limit=1&cursor=${encodeURIComponent(body.nextCursor)}`, headers: { "x-user-id": OWNER },
    })
    const [page2] = queries()
    expect(argOf(page2, "or")![0]).toBe(`created_at.lt.${ROW.created_at},and(created_at.eq.${ROW.created_at},id.lt.${ROW.id})`)
  })

  it("refuses a cursor this list did not hand out", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/palettes?cursor=not-a-cursor", headers: { "x-user-id": OWNER } })
    expect(res.statusCode).toBe(400)
    expect(queries()).toHaveLength(0)
  })

  it("reads as empty while the database has no palettes table", async () => {
    db.respond = () => ({ data: null, error: MISSING_TABLE })
    const res = await app.inject({ method: "GET", url: "/v1/palettes", headers: { "x-user-id": OWNER } })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ data: [], nextCursor: null })
  })

  it("an OAuth app needs assets:read", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/palettes", headers: { "x-user-id": OWNER, "x-app-scopes": "jobs:read" } })
    expect(res.statusCode).toBe(403)
    expect(queries()).toHaveLength(0)
  })
})

describe("GET /v1/palettes/:id", () => {
  it("answers the caller's own palette", async () => {
    db.respond = () => ({ data: ROW, error: null })
    const res = await app.inject({ method: "GET", url: `/v1/palettes/${PALETTE}`, headers: { "x-user-id": OWNER } })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual(WIRE)
    const [get] = queries()
    expect(has(get, "eq", "id", PALETTE)).toBe(true)
    expect(has(get, "eq", "user_id", OWNER)).toBe(true)
  })

  it("is 404 for a palette that is not the caller's (or none)", async () => {
    db.respond = () => ({ data: null, error: null })
    const res = await app.inject({ method: "GET", url: `/v1/palettes/${PALETTE}`, headers: { "x-user-id": OWNER } })
    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe("not_found")
  })

  it("is 400 for an id that is not a uuid", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/palettes/warm", headers: { "x-user-id": OWNER } })
    expect(res.statusCode).toBe(400)
  })
})

describe("PATCH /v1/palettes/:id", () => {
  it("writes only the fields sent, colours upper case, on the caller's row", async () => {
    db.respond = () => ({ data: { ...ROW, colors: ["#FFFFFF", "#000000"] }, error: null })
    const res = await app.inject({
      method: "PATCH", url: `/v1/palettes/${PALETTE}`, headers: { "x-user-id": OWNER },
      payload: { colors: ["#ffffff", "#000000"] },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().colors).toEqual(["#FFFFFF", "#000000"])
    const [update] = queries("update")
    const written = argOf(update, "update")![0] as Record<string, unknown>
    expect(written.colors).toEqual(["#FFFFFF", "#000000"])
    expect(written).not.toHaveProperty("name")
    expect(written).not.toHaveProperty("description")
    expect(typeof written.updated_at).toBe("string")
    expect(has(update, "eq", "id", PALETTE)).toBe(true)
    expect(has(update, "eq", "user_id", OWNER)).toBe(true)
  })

  it("clears the description with null", async () => {
    db.respond = () => ({ data: ROW, error: null })
    await app.inject({ method: "PATCH", url: `/v1/palettes/${PALETTE}`, headers: { "x-user-id": OWNER }, payload: { description: null } })
    const [update] = queries("update")
    expect((argOf(update, "update")![0] as Record<string, unknown>).description).toBeNull()
  })

  it("refuses an empty change", async () => {
    const res = await app.inject({ method: "PATCH", url: `/v1/palettes/${PALETTE}`, headers: { "x-user-id": OWNER }, payload: {} })
    expect(res.statusCode).toBe(400)
    expect(queries("update")).toHaveLength(0)
  })

  it("is 404 when no row of the caller's matched", async () => {
    db.respond = () => ({ data: null, error: null })
    const res = await app.inject({ method: "PATCH", url: `/v1/palettes/${PALETTE}`, headers: { "x-user-id": OWNER }, payload: { name: "New" } })
    expect(res.statusCode).toBe(404)
  })

  it("an OAuth app needs assets:write", async () => {
    const res = await app.inject({
      method: "PATCH", url: `/v1/palettes/${PALETTE}`, headers: { "x-user-id": OWNER, "x-app-scopes": "assets:read" }, payload: { name: "x" },
    })
    expect(res.statusCode).toBe(403)
    expect(queries("update")).toHaveLength(0)
  })
})

describe("DELETE /v1/palettes/:id", () => {
  it("deletes the caller's own palette", async () => {
    db.respond = () => ({ data: { id: PALETTE }, error: null })
    const res = await app.inject({ method: "DELETE", url: `/v1/palettes/${PALETTE}`, headers: { "x-user-id": OWNER } })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ success: true })
    const [del] = queries("delete")
    expect(has(del, "eq", "id", PALETTE)).toBe(true)
    expect(has(del, "eq", "user_id", OWNER)).toBe(true)
  })

  it("is 404 when nothing of the caller's was deleted", async () => {
    db.respond = () => ({ data: null, error: null })
    const res = await app.inject({ method: "DELETE", url: `/v1/palettes/${PALETTE}`, headers: { "x-user-id": OWNER } })
    expect(res.statusCode).toBe(404)
  })

  it("an OAuth app needs assets:write", async () => {
    const res = await app.inject({ method: "DELETE", url: `/v1/palettes/${PALETTE}`, headers: { "x-user-id": OWNER, "x-app-scopes": "assets:read" } })
    expect(res.statusCode).toBe(403)
    expect(queries("delete")).toHaveLength(0)
  })
})
