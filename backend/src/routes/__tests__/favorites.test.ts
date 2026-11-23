import { beforeEach, describe, expect, it, vi } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"
import rateLimit from "@fastify/rate-limit"

// ---------------------------------------------------------------------------
// The favorites routes: owner-only, validated, scoped like each kind's own
// route, rate limited like the other favorites, and 503 until migration 688.
// The database is the libs' (each has its own test); here they are spies.
// ---------------------------------------------------------------------------

vi.mock("@/lib/supabase.js", () => ({ supabase: { from: vi.fn() } }))
vi.mock("@/lib/favorites-feed.js", () => ({ readFavoritesPage: vi.fn() }))
vi.mock("@/lib/catalog-favorites.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/catalog-favorites.js")>()),
  listCatalogFavorites: vi.fn(),
  addCatalogFavorite: vi.fn(),
  removeCatalogFavorite: vi.fn(),
}))

import { favoritesRoutes } from "../favorites.js"
import { readFavoritesPage } from "../../lib/favorites-feed.js"
import { addCatalogFavorite, listCatalogFavorites, removeCatalogFavorite } from "../../lib/catalog-favorites.js"
import { encodeFavoritesCursor } from "../../lib/favorites-cursor.js"
import { getRegisteredPickerCatalogs } from "@nodaro/prompts/picker-catalogs"

const USER = "00000000-0000-4000-8000-000000000001"
const asUser = `__userId=${USER}`
const feed = readFavoritesPage as ReturnType<typeof vi.fn>
const add = addCatalogFavorite as ReturnType<typeof vi.fn>
const remove = removeCatalogFavorite as ReturnType<typeof vi.fn>
const list = listCatalogFavorites as ReturnType<typeof vi.fn>

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify()
  await app.register(rateLimit, { global: false })
  app.addHook("onRequest", async (req) => {
    const q = req.query as Record<string, string | undefined>
    if (q.__userId) req.userId = q.__userId
    if (q.__scopes !== undefined) {
      ;(req as { appAuthorization?: unknown }).appAuthorization = { appId: "app1", authorizationId: "auth1", scopes: q.__scopes ? q.__scopes.split(",") : [] }
    }
  })
  await app.register(favoritesRoutes)
  await app.ready()
  return app
}

beforeEach(() => {
  vi.clearAllMocks()
  feed.mockResolvedValue({ data: [], nextCursor: null })
  add.mockImplementation(async (_u: string, key: { catalog: string; optionId: string }) => ({
    kind: "ok",
    favorite: { ...key, label: "x", createdAt: "2026-11-23T10:00:00+00:00" },
  }))
  remove.mockResolvedValue({ kind: "ok", favorite: null })
  list.mockResolvedValue([])
})

describe("GET /v1/favorites", () => {
  it("is rate limited like the other list routes (120 a minute), and so is the catalog list", async () => {
    const app = await buildApp()
    for (const url of [`/v1/favorites?${asUser}`, `/v1/favorites/catalog?${asUser}`]) {
      const answers: number[] = []
      for (let i = 0; i < 121; i++) answers.push((await app.inject({ method: "GET", url })).statusCode)
      expect(answers.slice(0, 120).every((s) => s === 200), url).toBe(true)
      expect(answers[120], url).toBe(429)
    }
  })

  it("is the caller's own: 401 without a caller", async () => {
    const app = await buildApp()
    expect((await app.inject({ method: "GET", url: "/v1/favorites" })).statusCode).toBe(401)
    expect(feed).not.toHaveBeenCalled()
  })

  it("reads every kind by default, with the page size and the decoded cursor", async () => {
    const app = await buildApp()
    const cursor = encodeFavoritesCursor({ createdAt: "2026-11-23T10:00:00.5+00:00", kind: "voice", rowId: "00000000-0000-4000-8000-00000000000a" })
    const res = await app.inject({ method: "GET", url: `/v1/favorites?${asUser}&limit=10&cursor=${cursor}` })
    expect(res.statusCode).toBe(200)
    expect(feed).toHaveBeenCalledWith(USER, ["job", "asset", "voice", "preset", "catalog"], 10, {
      createdAt: "2026-11-23T10:00:00.5+00:00",
      kind: "voice",
      rowId: "00000000-0000-4000-8000-00000000000a",
    })
  })

  it("narrows to `kinds`; refuses an unknown kind, a bad cursor and a page over 100", async () => {
    const app = await buildApp()
    await app.inject({ method: "GET", url: `/v1/favorites?${asUser}&kinds=catalog,job,catalog` })
    expect(feed).toHaveBeenCalledWith(USER, ["catalog", "job"], 50, null)
    for (const q of ["kinds=job,albums", "cursor=garbage", "limit=101", "limit=0"]) {
      const res = await app.inject({ method: "GET", url: `/v1/favorites?${asUser}&${q}` })
      expect(res.statusCode, q).toBe(400)
      expect(res.json().error.code).toBe("validation_error")
    }
  })

  it("an OAuth app reads only the kinds its grant reads through their own routes", async () => {
    const app = await buildApp()
    // presets:read alone: the preset favorites, nothing else.
    await app.inject({ method: "GET", url: `/v1/favorites?${asUser}&__scopes=presets:read` })
    expect(feed).toHaveBeenLastCalledWith(USER, ["preset"], 50, null)
    // jobs:read reads the job favorites (it shows `favorited` on every job).
    await app.inject({ method: "GET", url: `/v1/favorites?${asUser}&__scopes=jobs:read` })
    expect(feed).toHaveBeenLastCalledWith(USER, ["job"], 50, null)
    // Asking by name for a kind the grant may not read is refused.
    const refused = await app.inject({ method: "GET", url: `/v1/favorites?${asUser}&__scopes=presets:read&kinds=preset,voice` })
    expect(refused.statusCode).toBe(403)
    expect(refused.json().error).toMatchObject({ code: "insufficient_scope", missingScope: "assets:read" })
    // No read scope at all.
    const none = await app.inject({ method: "GET", url: `/v1/favorites?${asUser}&__scopes=workflows:read` })
    expect(none.statusCode).toBe(403)
  })
})

describe("favorite picker options", () => {
  it("PUT validates both ids against the real catalogs and stores the canonical spelling", async () => {
    const app = await buildApp()
    const move = getRegisteredPickerCatalogs().find((c) => c.catalogId === "camera-motions")!.options![0]!
    // `camera-motion` is the node type of the `camera-motions` catalog.
    const res = await app.inject({ method: "PUT", url: `/v1/favorites/catalog/camera-motion/${move.id}?${asUser}` })
    expect(res.statusCode).toBe(200)
    expect(add).toHaveBeenCalledWith(USER, { catalog: "camera-motions", optionId: move.id, label: move.label })
    expect(res.json().data).toMatchObject({ catalog: "camera-motions", optionId: move.id, label: move.label, favorited: true })

    const genre = getRegisteredPickerCatalogs().find((c) => c.catalogId === "music-genre")!.dimensions![0]!
    const multi = await app.inject({ method: "PUT", url: `/v1/favorites/catalog/music-genre/${genre.options[0]!.id}?${asUser}` })
    expect(multi.json().data.optionId).toBe(`${genre.field}:${genre.options[0]!.id}`)
  })

  it("PUT refuses an unknown catalog or option with a 400 and writes nothing", async () => {
    const app = await buildApp()
    for (const url of ["/v1/favorites/catalog/albums/x", "/v1/favorites/catalog/style/no-such-style", "/v1/favorites/catalog/shot-shapes/nope"]) {
      const res = await app.inject({ method: "PUT", url: `${url}?${asUser}` })
      expect(res.statusCode, url).toBe(400)
      expect(res.json().error.code).toBe("validation_error")
    }
    expect(add).not.toHaveBeenCalled()
  })

  it("PUT stars a shot shape by its own id; a multi-field option as <field>:<id>", async () => {
    const app = await buildApp()
    const shape = await app.inject({ method: "PUT", url: `/v1/favorites/catalog/shot-shapes/kinetic-type-beats?${asUser}` })
    expect(shape.statusCode).toBe(200)
    expect(shape.json().data).toMatchObject({ catalog: "shot-shapes", optionId: "kinetic-type-beats", label: "Kinetic Type Beats" })
  })

  it("is owner-only, scoped assets:write for writes and assets:read for reads", async () => {
    const app = await buildApp()
    expect((await app.inject({ method: "PUT", url: "/v1/favorites/catalog/shot-shapes/kinetic-type-beats" })).statusCode).toBe(401)
    expect((await app.inject({ method: "DELETE", url: "/v1/favorites/catalog/shot-shapes/kinetic-type-beats" })).statusCode).toBe(401)
    expect((await app.inject({ method: "GET", url: "/v1/favorites/catalog" })).statusCode).toBe(401)
    const readOnly = await app.inject({ method: "PUT", url: `/v1/favorites/catalog/shot-shapes/kinetic-type-beats?${asUser}&__scopes=assets:read` })
    expect(readOnly.statusCode).toBe(403)
    expect(readOnly.json().error.missingScope).toBe("assets:write")
    const noRead = await app.inject({ method: "GET", url: `/v1/favorites/catalog?${asUser}&__scopes=presets:read` })
    expect(noRead.statusCode).toBe(403)
    expect(add).not.toHaveBeenCalled()
  })

  it("answers 503 not_available before migration 688, and 409 at the cap", async () => {
    const app = await buildApp()
    add.mockResolvedValueOnce({ kind: "not_available" })
    const before = await app.inject({ method: "PUT", url: `/v1/favorites/catalog/shot-shapes/kinetic-type-beats?${asUser}` })
    expect(before.statusCode).toBe(503)
    expect(before.json().error.code).toBe("not_available")
    remove.mockResolvedValueOnce({ kind: "not_available" })
    expect((await app.inject({ method: "DELETE", url: `/v1/favorites/catalog/shot-shapes/kinetic-type-beats?${asUser}` })).statusCode).toBe(503)
    add.mockResolvedValueOnce({ kind: "limit_reached" })
    const cap = await app.inject({ method: "PUT", url: `/v1/favorites/catalog/shot-shapes/kinetic-type-beats?${asUser}` })
    expect(cap.statusCode).toBe(409)
    expect(cap.json().error.code).toBe("limit_reached")
  })

  it("DELETE is idempotent and takes back a star its catalog has since dropped, as given", async () => {
    const app = await buildApp()
    const res = await app.inject({ method: "DELETE", url: `/v1/favorites/catalog/camera-motion/dropped-move?${asUser}` })
    expect(res.statusCode).toBe(200)
    expect(remove).toHaveBeenCalledWith(USER, "camera-motions", "dropped-move")
    expect(res.json().data).toEqual({ catalog: "camera-motions", optionId: "dropped-move", favorited: false })
  })

  it("GET lists the caller's options, one catalog's by its canonical id; an unknown catalog is a 400", async () => {
    const app = await buildApp()
    await app.inject({ method: "GET", url: `/v1/favorites/catalog?${asUser}&catalog=camera-motion` })
    expect(list).toHaveBeenLastCalledWith(USER, "camera-motions")
    await app.inject({ method: "GET", url: `/v1/favorites/catalog?${asUser}` })
    expect(list).toHaveBeenLastCalledWith(USER, undefined)
    expect((await app.inject({ method: "GET", url: `/v1/favorites/catalog?${asUser}&catalog=albums` })).statusCode).toBe(400)
  })

  it("writes are rate limited like the other favorites", async () => {
    const app = await buildApp()
    let last = 0
    for (let i = 0; i < 61; i++) {
      last = (await app.inject({ method: "PUT", url: `/v1/favorites/catalog/shot-shapes/kinetic-type-beats?${asUser}` })).statusCode
    }
    expect(last).toBe(429)
  })
})
