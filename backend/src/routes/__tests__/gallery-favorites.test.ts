/**
 * The gallery's favorite routes: POST /v1/gallery/favorite toggles one,
 * GET /v1/gallery/favorites lists them. The database side is proven in
 * lib/__tests__/gallery-favorites.test.ts; these pin the HTTP contract —
 * auth, OAuth scopes (the same ones MCP favorite_asset / list_favorites need),
 * validation, 404 for a job the caller may not see, and sanitized 500s.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

vi.mock("@/lib/supabase.js", () => ({ supabase: { from: vi.fn() } }))
vi.mock("@/lib/admin-check.js", () => ({ warmAdminCache: vi.fn(), checkIsAdmin: vi.fn().mockResolvedValue(false) }))
vi.mock("@/lib/gallery-favorites.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/gallery-favorites.js")>()
  return { ...actual, toggleGalleryFavorite: vi.fn(), listFavoriteJobIds: vi.fn() }
})
vi.mock("@/lib/gallery-listing.js", () => ({
  readGalleryPage: vi.fn(async () => ({ rows: [], nextCursor: null, totalCount: 0 })),
}))

import { galleryRoutes } from "../gallery.js"
import { listFavoriteJobIds, toggleGalleryFavorite } from "../../lib/gallery-favorites.js"
import { readGalleryPage } from "../../lib/gallery-listing.js"

const USER = "00000000-0000-4000-8000-000000000001"
const OTHER = "00000000-0000-4000-8000-000000000002"
const JOB = "00000000-0000-4000-8000-0000000000c1"

let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()
  app = Fastify({ logger: false })
  app.addHook("onRequest", async (req) => {
    const q = req.query as Record<string, string | undefined>
    if (q.__userId) req.userId = q.__userId
    if (q.__scopes !== undefined) {
      ;(req as { appAuthorization?: unknown }).appAuthorization = {
        appId: "app1",
        authorizationId: "auth1",
        scopes: q.__scopes ? q.__scopes.split(",") : [],
      }
    }
  })
  await app.register(async (instance) => {
    await galleryRoutes(instance)
  })
  await app.ready()
})

afterEach(async () => {
  await app.close()
})

describe("POST /v1/gallery/favorite", () => {
  const toggle = (body: unknown, qs = `__userId=${USER}`) =>
    app.inject({ method: "POST", url: `/v1/gallery/favorite?${qs}`, payload: body as never })

  it("favorites, then un-favorites — the answer says which", async () => {
    vi.mocked(toggleGalleryFavorite).mockResolvedValueOnce({ kind: "toggled", favorited: true })
    const on = await toggle({ jobId: JOB })
    expect(on.statusCode).toBe(200)
    expect(on.json()).toEqual({ favorited: true })
    expect(toggleGalleryFavorite).toHaveBeenCalledWith(USER, JOB)

    vi.mocked(toggleGalleryFavorite).mockResolvedValueOnce({ kind: "toggled", favorited: false })
    expect((await toggle({ jobId: JOB })).json()).toEqual({ favorited: false })
  })

  it("refuses an anonymous caller", async () => {
    const res = await toggle({ jobId: JOB }, "")
    expect(res.statusCode).toBe(401)
    expect(toggleGalleryFavorite).not.toHaveBeenCalled()
  })

  it("an OAuth app needs assets:write, like MCP favorite_asset", async () => {
    const refused = await toggle({ jobId: JOB }, `__userId=${USER}&__scopes=assets:read,jobs:read`)
    expect(refused.statusCode).toBe(403)
    expect(refused.json().error).toMatchObject({ code: "insufficient_scope", missingScope: "assets:write" })
    expect(toggleGalleryFavorite).not.toHaveBeenCalled()

    vi.mocked(toggleGalleryFavorite).mockResolvedValueOnce({ kind: "toggled", favorited: true })
    expect((await toggle({ jobId: JOB }, `__userId=${USER}&__scopes=assets:write`)).statusCode).toBe(200)
  })

  it("validates the job id", async () => {
    const res = await toggle({ jobId: "not-a-uuid" })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
    expect(toggleGalleryFavorite).not.toHaveBeenCalled()
  })

  it("a job the caller may not see — another person's private work — is a 404, and nothing is stored", async () => {
    vi.mocked(toggleGalleryFavorite).mockResolvedValueOnce({ kind: "not_found" })
    const res = await toggle({ jobId: JOB })
    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe("not_found")
  })

  it("a database failure is a sanitized 500 in the standard envelope", async () => {
    vi.mocked(toggleGalleryFavorite).mockRejectedValueOnce(new Error("insert into gallery_favorites failed"))
    const res = await toggle({ jobId: JOB })
    expect(res.statusCode).toBe(500)
    expect(res.json()).toEqual({ error: { code: "internal_error", message: "Failed to favorite item" } })
  })
})

describe("GET /v1/gallery/favorites", () => {
  const favorites = (qs = `__userId=${USER}`) => app.inject({ method: "GET", url: `/v1/gallery/favorites?${qs}` })

  it("lists the caller's favorited job ids, newest first", async () => {
    vi.mocked(listFavoriteJobIds).mockResolvedValueOnce(["j2", "j1"])
    const res = await favorites()
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ data: ["j2", "j1"] })
    expect(listFavoriteJobIds).toHaveBeenCalledWith(USER)
  })

  it("refuses an anonymous caller", async () => {
    expect((await favorites("")).statusCode).toBe(401)
  })

  it("an OAuth app needs assets:read (like MCP list_favorites) or jobs:read (which already shows favorited on every job)", async () => {
    const refused = await favorites(`__userId=${USER}&__scopes=presets:read`)
    expect(refused.statusCode).toBe(403)
    expect(refused.json().error).toMatchObject({ code: "insufficient_scope", missingScope: "assets:read" })
    expect(listFavoriteJobIds).not.toHaveBeenCalled()

    vi.mocked(listFavoriteJobIds).mockResolvedValue([])
    expect((await favorites(`__userId=${USER}&__scopes=assets:read`)).statusCode).toBe(200)
    expect((await favorites(`__userId=${USER}&__scopes=jobs:read`)).statusCode).toBe(200)
  })

  it("a database failure is a sanitized 500 in the standard envelope", async () => {
    vi.mocked(listFavoriteJobIds).mockRejectedValueOnce(new Error("timeout"))
    const res = await favorites()
    expect(res.statusCode).toBe(500)
    expect(res.json()).toEqual({ error: { code: "internal_error", message: "Failed to fetch favorites" } })
  })
})

describe("GET /v1/gallery?favoritesOnly=true — your own favorites, and nobody else's", () => {
  const browse = (qs: string) => app.inject({ method: "GET", url: `/v1/gallery?${qs}` })

  it("lists your own favorited items: your userId, with your token — a private answer, never cached for others", async () => {
    vi.mocked(listFavoriteJobIds).mockResolvedValueOnce(["j2", "j1"])

    const res = await browse(`userId=${USER}&favoritesOnly=true&__userId=${USER}`)

    expect(res.statusCode).toBe(200)
    expect(listFavoriteJobIds).toHaveBeenCalledWith(USER)
    expect(readGalleryPage).toHaveBeenCalledWith(
      expect.objectContaining({ userId: USER, favoriteJobIds: ["j2", "j1"], includePrivate: true }),
    )
    expect(res.headers["cache-control"]).toBe("private, no-store")
  })

  it("answers an empty page without reading the gallery when you have no favorites", async () => {
    vi.mocked(listFavoriteJobIds).mockResolvedValueOnce([])
    const res = await browse(`userId=${USER}&favoritesOnly=true&__userId=${USER}`)
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ data: [], nextCursor: null, totalCount: 0 })
    expect(readGalleryPage).not.toHaveBeenCalled()
  })

  it("refuses an anonymous request for someone's favorites (401) — and reads nothing", async () => {
    const res = await browse(`userId=${USER}&favoritesOnly=true`)
    expect(res.statusCode).toBe(401)
    expect(listFavoriteJobIds).not.toHaveBeenCalled()
    expect(readGalleryPage).not.toHaveBeenCalled()
  })

  it("refuses another person's favorites, and favorites with no userId (403) — and reads nothing", async () => {
    for (const qs of [`userId=${USER}&favoritesOnly=true&__userId=${OTHER}`, `favoritesOnly=true&__userId=${USER}`]) {
      const res = await browse(qs)
      expect(res.statusCode, qs).toBe(403)
      expect(res.json().error.code, qs).toBe("forbidden")
    }
    expect(listFavoriteJobIds).not.toHaveBeenCalled()
    expect(readGalleryPage).not.toHaveBeenCalled()
  })

  it("a failed favorites read is a sanitized 500", async () => {
    vi.mocked(listFavoriteJobIds).mockRejectedValueOnce(new Error("gallery_favorites timeout"))
    const res = await browse(`userId=${USER}&favoritesOnly=true&__userId=${USER}`)
    expect(res.statusCode).toBe(500)
    expect(res.json()).toEqual({ error: { code: "internal_error", message: "Failed to fetch gallery" } })
  })
})
