/**
 * `?q=` on the five saved-entity lists — characters, locations, objects,
 * creatures and faces — which share one search: up to five words, every one of
 * which must occur in the name or the description, ignoring case, every
 * character of a word literal.
 *
 * What the filter MATCHES is pinned by `lib/__tests__/text-search.test.ts`,
 * which reads it back the way PostgREST does. This suite pins what each ROUTE
 * does with it: the same columns everywhere, one `or=` per word applied on top
 * of the caller's own rows and every other filter, beside a keyset cursor's,
 * blank meaning no search, and the limits refused before any query runs.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

// ---------------------------------------------------------------------------
// Mocks — hoisted before any route import
// ---------------------------------------------------------------------------

interface Call {
  method: string
  args: unknown[]
}

/** Every builder call of every query, in order, and the rows the next query answers with. */
const db = vi.hoisted(() => ({
  queries: [] as Array<{ table: string; calls: Call[] }>,
  rows: [] as unknown[],
}))

vi.mock("@/lib/supabase.js", () => {
  const from = vi.fn((table: string) => {
    const query = { table, calls: [] as Call[] }
    db.queries.push(query)
    const proxy: unknown = new Proxy(
      {},
      {
        get(_target, prop) {
          if (prop === "then") {
            return (resolve: (value: unknown) => unknown) => Promise.resolve({ data: db.rows, error: null }).then(resolve)
          }
          return (...args: unknown[]) => {
            query.calls.push({ method: String(prop), args })
            return proxy
          }
        },
      },
    )
    return proxy
  })
  return { supabase: { from } }
})

vi.mock("@/lib/config.js", () => ({
  config: {
    EDITION: "cloud",
    SUPABASE_URL: "https://test.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "test",
    R2_PUBLIC_URL: "https://r2.example.com",
    R2_BUCKET_NAME: "test-bucket",
  },
  isCloud: () => true,
  hasCredits: () => true,
  isCommunity: () => false,
  isBusiness: () => false,
  hasAdmin: () => true,
}))

vi.mock("@/lib/storage.js", () => ({
  batchDeleteFromR2: vi.fn().mockResolvedValue({ deleted: 0, errors: 0 }),
}))

vi.mock("@/lib/relay-possible.js", () => ({ relayPossible: () => false }))

vi.mock("@/lib/admin-check.js", () => ({
  warmAdminCache: vi.fn(),
  checkIsAdmin: vi.fn().mockResolvedValue(false),
}))

vi.mock("@/lib/url-validator.js", async () => {
  const { z } = await import("zod")
  return { safeUrlSchema: z.string().url() }
})

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { characterRoutes } from "../characters.js"
import { locationRoutes } from "../locations.js"
import { objectRoutes } from "../objects.js"
import { creatureRoutes } from "../creatures.js"
import { faceRoutes } from "../faces.js"
import { supabase } from "../../lib/supabase.js"

const USER = "00000000-0000-4000-8000-000000000001"
const PROJECT = "00000000-0000-4000-8000-000000000010"
const ROW_1 = "00000000-0000-4000-8000-000000000021"
const ROW_2 = "00000000-0000-4000-8000-000000000022"
const CURSOR_ID = "00000000-0000-4000-8000-000000000020"

const ROUTES = [
  { url: "/v1/characters", table: "characters", register: characterRoutes, archive: true },
  { url: "/v1/locations", table: "locations", register: locationRoutes, archive: true },
  { url: "/v1/objects", table: "objects", register: objectRoutes, archive: true },
  { url: "/v1/creatures", table: "creatures", register: creatureRoutes, archive: true },
  { url: "/v1/faces", table: "faces", register: faceRoutes, archive: false },
] as const

const cursorFor = (createdAt: string, id: string) => Buffer.from(JSON.stringify({ createdAt, id })).toString("base64")

/** The one query a list request ran, and its `or` arguments in call order. */
function listQuery(table: string) {
  const queries = db.queries.filter((q) => q.table === table)
  expect(queries).toHaveLength(1)
  const calls = queries[0]!.calls
  return { calls, ors: calls.filter((c) => c.method === "or").map((c) => c.args[0]) }
}

describe.each(ROUTES)("GET $url?q=", ({ url, table, register, archive }) => {
  let app: FastifyInstance

  beforeEach(async () => {
    vi.clearAllMocks()
    db.queries = []
    db.rows = []
    app = Fastify({ logger: false })
    app.addHook("preHandler", async (req) => {
      const header = req.headers["x-user-id"]
      if (typeof header === "string") req.userId = header
    })
    await app.register(async (instance) => {
      await register(instance)
    })
    await app.ready()
  })

  afterEach(async () => {
    await app.close()
  })

  const get = (query: string) =>
    app.inject({ method: "GET", url: `${url}?${query}`, headers: { "x-user-id": USER } })

  it("searches the name and the description, ignoring case, with every character literal", async () => {
    const res = await get(`q=${encodeURIComponent("  50%_off*  ")}`)

    expect(res.statusCode).toBe(200)
    // Trimmed, regex-escaped, double-quoted: `%`, `_` and `*` match only themselves.
    expect(listQuery(table).ors).toEqual([String.raw`name.imatch."50%_off\\*",description.imatch."50%_off\\*"`])
  })

  it("needs every word: one or= per word, which PostgREST ANDs", async () => {
    const res = await get(`q=${encodeURIComponent("red  car,")}`)

    expect(res.statusCode).toBe(200)
    expect(listQuery(table).ors).toEqual([
      'name.imatch."red",description.imatch."red"',
      'name.imatch."car,",description.imatch."car,"',
    ])
  })

  it("searches only the caller's own rows", async () => {
    await get("q=hero")

    const { calls, ors } = listQuery(table)
    expect(calls).toContainEqual({ method: "eq", args: ["user_id", USER] })
    expect(ors).toEqual(['name.imatch."hero",description.imatch."hero"'])
  })

  it("combines with the project filter and the archive view", async () => {
    await get(`q=hero&projectId=${PROJECT}${archive ? "&archived=true" : ""}`)

    const { calls, ors } = listQuery(table)
    expect(calls).toContainEqual({ method: "eq", args: ["project_id", PROJECT] })
    if (archive) expect(calls).toContainEqual({ method: "not", args: ["deleted_at", "is", null] })
    expect(ors).toEqual(['name.imatch."hero",description.imatch."hero"'])
  })

  it("pages a search: the cursor is one more or=, which PostgREST ANDs with the words'", async () => {
    db.rows = [
      { id: ROW_1, name: "Hero", created_at: "2026-10-01T10:00:02Z" },
      { id: ROW_2, name: "Hero 2", created_at: "2026-10-01T10:00:01Z" }, // the has-more probe
    ]

    const res = await get(`q=hero%20red&limit=1&cursor=${encodeURIComponent(cursorFor("2026-10-01T10:00:03Z", CURSOR_ID))}`)

    expect(res.statusCode).toBe(200)
    const { calls, ors } = listQuery(table)
    expect(ors).toEqual([
      'name.imatch."hero",description.imatch."hero"',
      'name.imatch."red",description.imatch."red"',
      `created_at.lt.2026-10-01T10:00:03Z,and(created_at.eq.2026-10-01T10:00:03Z,id.lt.${CURSOR_ID})`,
    ])
    expect(calls).toContainEqual({ method: "limit", args: [2] })
    const body = res.json() as Record<string, unknown>
    expect((body[table] as unknown[]).length).toBe(1)
    // The next page's cursor is the last row returned, not the probe.
    expect(body.nextCursor).toBe(cursorFor("2026-10-01T10:00:02Z", ROW_1))
  })

  it("reads a blank q as no search", async () => {
    const res = await get("q=%20%20%20")

    expect(res.statusCode).toBe(200)
    expect(listQuery(table).ors).toEqual([])
  })

  it("refuses q over 200 characters before running a query", async () => {
    const res = await get(`q=${"a".repeat(201)}`)

    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
    expect(supabase.from).not.toHaveBeenCalled()
  })

  it("refuses a NUL in q before running a query", async () => {
    const res = await get("q=a%00b")

    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
    expect(supabase.from).not.toHaveBeenCalled()
  })
})
