/**
 * `GET /v1/library` search: `q` (the documented name) and `search` (the
 * original one, kept as an alias). Both keep the files whose filename contains
 * every word, ignoring case, every character literal — the shared filter of
 * `lib/text-search.ts`, which before this matched `%` and `_` as wildcards.
 *
 * The first page runs two queries, the page and its exact count, and they must
 * carry the same filter or `totalCount` stops describing the list.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

interface Call {
  method: string
  args: unknown[]
}

const db = vi.hoisted(() => ({ queries: [] as Array<{ table: string; calls: Call[] }> }))

vi.mock("@/lib/supabase.js", () => {
  const from = vi.fn((table: string) => {
    const query = { table, calls: [] as Call[] }
    db.queries.push(query)
    const proxy: unknown = new Proxy(
      {},
      {
        get(_target, prop) {
          if (prop === "then") {
            return (resolve: (value: unknown) => unknown) =>
              Promise.resolve({ data: [], error: null, count: 0 }).then(resolve)
          }
          if (prop === "single" || prop === "maybeSingle") {
            // The cursor lookup: the row whose id the client sent.
            return async () => ({ data: { created_at: "2026-08-01T00:00:00+00:00" }, error: null })
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
  config: { EDITION: "cloud", R2_PUBLIC_URL: "https://pub-test.r2.dev" },
  isCloud: () => true,
  hasCredits: () => true,
  isCommunity: () => false,
  isBusiness: () => false,
  hasAdmin: () => true,
}))
vi.mock("@/lib/admin-check.js", () => ({ warmAdminCache: vi.fn(), checkIsAdmin: vi.fn().mockResolvedValue(false) }))

const { libraryRoutes } = await import("../library.js")
const { supabase } = await import("../../lib/supabase.js")

const USER = "11111111-1111-4111-8111-111111111111"
const CURSOR = "22222222-2222-4222-8222-222222222222"
let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()
  db.queries = []
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    const q = req.query as Record<string, unknown> | undefined
    if (typeof q?.userId === "string") req.userId = q.userId
  })
  await app.register(async (i) => libraryRoutes(i))
  await app.ready()
})
afterEach(async () => app.close())

const get = (query: string) => app.inject({ method: "GET", url: `/v1/library?userId=${USER}&${query}` })

/** The `or` arguments of each `assets` listing query (the page, and the count on a first page). */
function searchFilters(): string[][] {
  return db.queries
    .filter((q) => q.table === "assets" && q.calls.some((c) => c.method === "select" && c.args[0] !== "created_at"))
    .map((q) => q.calls.filter((c) => c.method === "or").map((c) => String(c.args[0])).filter((o) => o.includes(".imatch.")))
}

describe("GET /v1/library search", () => {
  it("q keeps the files whose filename contains it, every character literal, on the page and its count", async () => {
    const res = await get(`q=${encodeURIComponent(" 50%_off*.png ")}`)

    expect(res.statusCode).toBe(200)
    const filter = String.raw`filename.imatch."50%_off\\*\\.png"`
    expect(searchFilters()).toEqual([[filter], [filter]])
  })

  it("needs every word: one or= per word, on the page and its count", async () => {
    await get(`q=${encodeURIComponent("summer  poster")}`)

    const words = ['filename.imatch."summer"', 'filename.imatch."poster"']
    expect(searchFilters()).toEqual([words, words])
  })

  it("search is still accepted, as an alias of q", async () => {
    await get("search=report")

    expect(searchFilters()).toEqual([['filename.imatch."report"'], ['filename.imatch."report"']])
  })

  it("a non-blank q wins when both are sent", async () => {
    await get("q=poster&search=report")

    expect(searchFilters()).toEqual([['filename.imatch."poster"'], ['filename.imatch."poster"']])
  })

  it("a blank q is no q, so search applies", async () => {
    await get("q=%20&search=report")

    expect(searchFilters()).toEqual([['filename.imatch."report"'], ['filename.imatch."report"']])
  })

  it("reads a blank q as no search", async () => {
    const res = await get("q=%20%20")

    expect(res.statusCode).toBe(200)
    expect(searchFilters()).toEqual([[], []])
  })

  it("keeps the library's own rule beside the search: the caller's saved files and the shared items", async () => {
    await get("q=poster")

    const page = db.queries.find((q) => q.table === "assets" && q.calls.some((c) => c.method === "limit"))!
    const ors = page.calls.filter((c) => c.method === "or").map((c) => c.args[0])
    expect(ors).toEqual([
      `and(user_id.eq.${USER},in_library.eq.true),is_library_item.eq.true`,
      'filename.imatch."poster"',
    ])
  })

  it("searches only the caller's own files with owned=true", async () => {
    await get("q=poster&owned=true")

    const page = db.queries.find((q) => q.table === "assets" && q.calls.some((c) => c.method === "limit"))!
    expect(page.calls).toContainEqual({ method: "eq", args: ["user_id", USER] })
    expect(page.calls.filter((c) => c.method === "or").map((c) => c.args[0])).toEqual(['filename.imatch."poster"'])
  })

  it("pages a search: the cursor's predicate is ANDed with it", async () => {
    await get(`q=poster&cursor=${CURSOR}`)

    const page = db.queries.find((q) => q.table === "assets" && q.calls.some((c) => c.method === "limit"))!
    const ors = page.calls.filter((c) => c.method === "or").map((c) => String(c.args[0]))
    expect(ors).toContain('filename.imatch."poster"')
    expect(ors).toContain(`created_at.lt.2026-08-01T00:00:00+00:00,and(created_at.eq.2026-08-01T00:00:00+00:00,id.lt.${CURSOR})`)
  })

  it("refuses q or search over 200 characters before running a query", async () => {
    for (const param of ["q", "search"]) {
      vi.mocked(supabase.from).mockClear()
      const res = await get(`${param}=${"a".repeat(201)}`)
      expect(res.statusCode, param).toBe(400)
      expect(res.json().error.code).toBe("validation_error")
      expect(supabase.from).not.toHaveBeenCalled()
    }
  })
})
