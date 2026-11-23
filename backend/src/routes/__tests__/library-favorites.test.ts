/**
 * Favorites in the library: each file's `favorited`, and
 * `POST /v1/library/:id/favorite`. The rule itself (a file a job made by its
 * job's favorite, an upload by its own star) is lib/asset-favorites.ts's,
 * tested there; here: the route never says `false` for a state it could not
 * read. The `favorited` FILTER's requests are pinned in
 * library-favorites-request.test.ts (a real query builder).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

const calls = vi.hoisted(() => ({
  ops: [] as Array<{ table: string; head: boolean; op: string; args: unknown[] }>,
  rows: [] as Array<Record<string, unknown>>,
  fromCalls: 0,
}))

vi.mock("@/lib/supabase.js", () => {
  function from(table: string) {
    calls.fromCalls += 1
    let head = false
    const proxy: unknown = new Proxy(
      {},
      {
        get(_t, prop) {
          if (prop === "then") {
            return (resolve: (v: unknown) => void) => resolve({ data: head ? null : calls.rows, error: null, count: calls.rows.length })
          }
          if (prop === "single" || prop === "maybeSingle") {
            return async () => ({ data: { created_at: "2026-08-01T00:00:00+00:00" }, error: null })
          }
          return (...args: unknown[]) => {
            if (prop === "select" && (args[1] as { head?: boolean } | undefined)?.head) head = true
            calls.ops.push({ table, head, op: String(prop), args })
            return proxy
          }
        },
      },
    )
    return proxy
  }
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
vi.mock("@/lib/render-label-fill.js", () => ({ fillAssetRenderQuality: async <T>(rows: T[]) => rows }))
vi.mock("@/lib/asset-favorites.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/asset-favorites.js")>()),
  favoriteStateOfFiles: vi.fn(),
  setFileFavorite: vi.fn(),
}))

const { libraryRoutes } = await import("../library.js")
const { libraryFavoriteRoutes } = await import("../library-favorite.js")
const fav = await import("../../lib/asset-favorites.js")
const stateOf = fav.favoriteStateOfFiles as ReturnType<typeof vi.fn>
const setFav = fav.setFileFavorite as ReturnType<typeof vi.fn>

const USER = "11111111-1111-4111-8111-111111111111"
const JOB = "33333333-3333-4333-8333-333333333333"
const UPLOAD = "44444444-4444-4444-8444-444444444444"
const MADE = "55555555-5555-4555-8555-555555555555"
const CURSOR = "22222222-2222-4222-8222-222222222222"

const row = (id: string, jobId: string | null) => ({
  id,
  user_id: USER,
  type: "image",
  filename: `${id}.png`,
  mime_type: "image/png",
  size_bytes: 1,
  r2_key: `uploads/${id}.png`,
  r2_url: `https://cdn.test/${id}.png`,
  metadata: {},
  is_library_item: false,
  upload_source: "manual_upload",
  source: null,
  source_detail: null,
  created_at: "2026-08-01T00:00:00+00:00",
  job_id: jobId,
})

let app: FastifyInstance
beforeEach(async () => {
  calls.ops = []
  calls.fromCalls = 0
  calls.rows = [row(UPLOAD, null), row(MADE, JOB)]
  vi.clearAllMocks()
  stateOf.mockResolvedValue(new Map([[UPLOAD, true], [MADE, false]]))
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    const q = req.query as Record<string, unknown> | undefined
    if (typeof q?.userId === "string") req.userId = q.userId
    if (typeof q?.scopes === "string") {
      ;(req as { appAuthorization?: unknown }).appAuthorization = { appId: "a", authorizationId: "b", scopes: q.scopes.split(",") }
    }
  })
  await app.register(async (i) => libraryRoutes(i))
  await app.register(async (i) => libraryFavoriteRoutes(i))
  await app.ready()
})
afterEach(async () => app.close())

const assetOps = (head: boolean, op: string) =>
  calls.ops.filter((c) => c.table === "assets" && c.head === head && c.op === op).map((c) => c.args)

describe("GET /v1/library's favorited flag", () => {
  it("is read once for the page when the list is not filtered by it", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/library?userId=${USER}` })
    expect(stateOf).toHaveBeenCalledTimes(1)
    expect(res.json().data.map((a: { favorited: boolean }) => a.favorited)).toEqual([true, false])
  })

  it("is left OUT when it cannot be read — never `false` for a starred file — and the list still answers", async () => {
    stateOf.mockRejectedValue(new Error("db down"))
    const res = await app.inject({ method: "GET", url: `/v1/library?userId=${USER}` })
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toHaveLength(2)
    for (const a of res.json().data) expect(a).not.toHaveProperty("favorited")
  })
})

describe("POST /v1/library/:id/favorite", () => {
  const post = (id: string, payload?: unknown, query = `userId=${USER}`) =>
    app.inject({ method: "POST", url: `/v1/library/${id}/favorite?${query}`, ...(payload !== undefined ? { payload: payload as Record<string, unknown> } : {}) })

  it("sets the wanted state, or toggles with no body", async () => {
    setFav.mockResolvedValue({ kind: "ok", favorited: true, jobId: null })
    const res = await post(UPLOAD, { favorited: true })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ favorited: true, jobId: null })
    expect(setFav).toHaveBeenLastCalledWith(USER, UPLOAD, true, { isAdmin: false })
    await post(UPLOAD)
    expect(setFav).toHaveBeenLastCalledWith(USER, UPLOAD, undefined, { isAdmin: false })
  })

  it("is owner-only: 401 without a caller, 404 for no file of theirs (or a non-uuid id)", async () => {
    expect((await post(UPLOAD, { favorited: true }, "")).statusCode).toBe(401)
    setFav.mockResolvedValue({ kind: "not_found" })
    expect((await post(UPLOAD, { favorited: true })).statusCode).toBe(404)
    expect((await post("not-a-uuid", { favorited: true })).statusCode).toBe(404)
  })

  it("refuses a body other than { favorited?: boolean }", async () => {
    expect((await post(UPLOAD, { favorited: "yes" })).statusCode).toBe(400)
    expect((await post(UPLOAD, { favorited: true, extra: 1 })).statusCode).toBe(400)
    expect(setFav).not.toHaveBeenCalled()
  })

  it("answers 503 not_available for an upload before migration 688", async () => {
    setFav.mockResolvedValue({ kind: "not_available" })
    const res = await post(UPLOAD, { favorited: true })
    expect(res.statusCode).toBe(503)
    expect(res.json().error.code).toBe("not_available")
  })

  it("an OAuth app needs assets:write", async () => {
    const res = await post(UPLOAD, { favorited: true }, `userId=${USER}&scopes=assets:read`)
    expect(res.statusCode).toBe(403)
    expect(setFav).not.toHaveBeenCalled()
  })
})
