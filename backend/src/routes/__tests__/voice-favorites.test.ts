import { describe, it, expect, vi, beforeEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

// ---------------------------------------------------------------------------
// Mocks — hoisted before any route import
// ---------------------------------------------------------------------------
vi.mock("@/lib/supabase.js", () => {
  const mockFrom = vi.fn()
  return {
    supabase: {
      from: mockFrom,
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-123" } }, error: null }),
      },
    },
  }
})
vi.mock("@/lib/config.js", () => ({
  config: { EDITION: "cloud", SUPABASE_URL: "https://t.co", SUPABASE_SERVICE_ROLE_KEY: "k" },
  isCloud: () => true,
  hasCredits: () => true,
  isCommunity: () => false,
  isBusiness: () => false,
  hasAdmin: () => true,
}))

import { MAX_VOICE_FAVORITES_PER_USER, voiceFavoriteRoutes } from "../voice-favorites.js"
import { supabase } from "../../lib/supabase.js"

const USER = "00000000-0000-4000-8000-000000000001"

const ROW = {
  voice_id: "21m00Tcm4TlvDq8ikWAM",
  voice_type: "premade",
  name: "Rachel",
  preview_url: "https://cdn.example.com/rachel.mp3",
  created_at: "2026-11-08T12:00:00.000Z",
}

/**
 * A chainable + thenable Supabase query-builder mock. `rows` answers the
 * awaited chain, `single` the `.single()` leaf, `count` the head count,
 * `error` every leaf.
 */
function makeQB(opts: { rows?: unknown; single?: unknown; count?: number; error?: { code?: string; message?: string } | null }) {
  const result = { data: opts.rows ?? null, error: opts.error ?? null, count: opts.count ?? null }
  const singleResult = { data: opts.single ?? null, error: opts.error ?? null }
  const qb: Record<string, unknown> = {}
  qb.select = vi.fn(() => qb)
  qb.upsert = vi.fn(() => qb)
  qb.delete = vi.fn(() => qb)
  qb.eq = vi.fn(() => qb)
  qb.order = vi.fn(() => qb)
  qb.single = vi.fn(() => Promise.resolve(singleResult))
  qb.then = (resolve: (v: unknown) => unknown) => resolve(result)
  return qb
}

/**
 * The app under test. A request names its caller with `__userId` and, for an
 * OAuth app, its granted scopes with `__scopes` (the same shape the gallery's
 * favorites tests use); a request without `__userId` is anonymous.
 */
function buildApp(): FastifyInstance {
  // app.ts routes parameters up to 4096 characters (`maxParamLength`), so an over-long voice id
  // reaches the handler: the route's own check must refuse it, not the framework's default limit.
  const app = Fastify({ routerOptions: { maxParamLength: 4096 } })
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
  return app
}

const fromMock = supabase.from as ReturnType<typeof vi.fn>
const asUser = `__userId=${USER}`
const star = (app: FastifyInstance, voiceId: string, payload: unknown, query = asUser) =>
  app.inject({ method: "PUT", url: `/v1/voices/favorites/${voiceId}?${query}`, payload: payload as Record<string, unknown> })

describe("voice favorites routes", () => {
  beforeEach(() => vi.clearAllMocks())

  it("GET /v1/voices/favorites answers the caller's favorites as the SDK shape, newest first", async () => {
    const qb = makeQB({ rows: [ROW] })
    fromMock.mockReturnValue(qb)
    const app = buildApp()
    await app.register(voiceFavoriteRoutes)
    const res = await app.inject({ method: "GET", url: `/v1/voices/favorites?${asUser}` })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({
      favorites: [{ voiceId: ROW.voice_id, voiceType: "premade", name: "Rachel", previewUrl: ROW.preview_url, createdAt: ROW.created_at }],
    })
    expect(qb.eq).toHaveBeenCalledWith("user_id", USER)
    expect(qb.order).toHaveBeenCalledWith("created_at", { ascending: false })
  })

  it("every route needs a signed-in user", async () => {
    const app = buildApp()
    await app.register(voiceFavoriteRoutes)
    for (const [method, url] of [
      ["GET", "/v1/voices/favorites"],
      ["PUT", "/v1/voices/favorites/abc"],
      ["DELETE", "/v1/voices/favorites/abc"],
    ] as const) {
      const res = await app.inject({ method, url, ...(method === "PUT" ? { payload: { voiceType: "premade", name: "Rachel" } } : {}) })
      expect(res.statusCode, `${method} ${url}`).toBe(401)
    }
  })

  it("an OAuth app needs assets:read to list and assets:write to star or unstar", async () => {
    fromMock.mockReturnValue(makeQB({ rows: [], count: 0, single: ROW }))
    const app = buildApp()
    await app.register(voiceFavoriteRoutes)

    const listRefused = await app.inject({ method: "GET", url: `/v1/voices/favorites?${asUser}&__scopes=jobs:read` })
    expect(listRefused.statusCode).toBe(403)
    expect(listRefused.json().error).toMatchObject({ code: "insufficient_scope", missingScope: "assets:read" })
    expect((await app.inject({ method: "GET", url: `/v1/voices/favorites?${asUser}&__scopes=assets:read` })).statusCode).toBe(200)

    const starRefused = await star(app, ROW.voice_id, { voiceType: "premade", name: "Rachel" }, `${asUser}&__scopes=assets:read`)
    expect(starRefused.statusCode).toBe(403)
    expect(starRefused.json().error).toMatchObject({ code: "insufficient_scope", missingScope: "assets:write" })
    expect((await star(app, ROW.voice_id, { voiceType: "premade", name: "Rachel" }, `${asUser}&__scopes=assets:write`)).statusCode).toBe(200)

    const unstarRefused = await app.inject({ method: "DELETE", url: `/v1/voices/favorites/${ROW.voice_id}?${asUser}&__scopes=assets:read` })
    expect(unstarRefused.statusCode).toBe(403)
  })

  it("PUT /v1/voices/favorites/:voiceId stars a voice (an upsert on user + voice) and answers the row", async () => {
    const qb = makeQB({ count: 3, single: ROW })
    fromMock.mockReturnValue(qb)
    const app = buildApp()
    await app.register(voiceFavoriteRoutes)
    const res = await star(app, ROW.voice_id, { voiceType: "premade", name: "Rachel", previewUrl: ROW.preview_url })
    expect(res.statusCode).toBe(200)
    expect(res.json().favorite).toEqual({ voiceId: ROW.voice_id, voiceType: "premade", name: "Rachel", previewUrl: ROW.preview_url, createdAt: ROW.created_at })
    expect(qb.upsert).toHaveBeenCalledWith(
      { user_id: USER, voice_id: ROW.voice_id, voice_type: "premade", name: "Rachel", preview_url: ROW.preview_url },
      { onConflict: "user_id,voice_id" },
    )
  })

  it("a re-star without a preview keeps the stored one; an empty preview (the catalog's 'none') clears it", async () => {
    const qb = makeQB({ count: 3, single: ROW })
    fromMock.mockReturnValue(qb)
    const app = buildApp()
    await app.register(voiceFavoriteRoutes)

    await star(app, ROW.voice_id, { voiceType: "premade", name: "Rachel" })
    expect(qb.upsert).toHaveBeenLastCalledWith(
      { user_id: USER, voice_id: ROW.voice_id, voice_type: "premade", name: "Rachel" },
      { onConflict: "user_id,voice_id" },
    )

    const cleared = await star(app, ROW.voice_id, { voiceType: "premade", name: "Rachel", previewUrl: "" })
    expect(cleared.statusCode).toBe(200)
    expect(qb.upsert).toHaveBeenLastCalledWith(
      { user_id: USER, voice_id: ROW.voice_id, voice_type: "premade", name: "Rachel", preview_url: null },
      { onConflict: "user_id,voice_id" },
    )
  })

  it("PUT rejects a body without the voice's kind or name, an unknown kind, and a preview that is not an https URL", async () => {
    fromMock.mockReturnValue(makeQB({ count: 0, single: ROW }))
    const app = buildApp()
    await app.register(voiceFavoriteRoutes)
    for (const payload of [
      { name: "Rachel" },
      { voiceType: "premade" },
      { voiceType: "cloned", name: "Rachel" },
      { voiceType: "premade", name: "" },
      { voiceType: "premade", name: "Rachel", previewUrl: "javascript:alert(1)" },
      { voiceType: "premade", name: "Rachel", previewUrl: "http://cdn.example.com/rachel.mp3" },
      { voiceType: "premade", name: "Rachel", previewUrl: "data:audio/mpeg;base64,AAAA" },
    ]) {
      const res = await star(app, "abc", payload)
      expect(res.statusCode, JSON.stringify(payload)).toBe(400)
    }
  })

  it("an over-long voice id (routed, as app.ts routes ids up to 4096 characters) is refused with 400 before any query", async () => {
    const qb = makeQB({ count: 0, single: ROW })
    fromMock.mockReturnValue(qb)
    const app = buildApp()
    await app.register(voiceFavoriteRoutes)
    const tooLong = "v".repeat(201)
    const put = await star(app, tooLong, { voiceType: "premade", name: "Rachel" })
    expect(put.statusCode).toBe(400)
    expect(put.json()).toMatchObject({ error: { code: "validation_error" } })
    const del = await app.inject({ method: "DELETE", url: `/v1/voices/favorites/${tooLong}?${asUser}` })
    expect(del.statusCode).toBe(400)
    expect(del.json()).toMatchObject({ error: { code: "validation_error" } })
    expect(fromMock).not.toHaveBeenCalled()
    expect(qb.upsert).not.toHaveBeenCalled()
    expect(qb.delete).not.toHaveBeenCalled()
  })

  it("PUT at the cap refuses a NEW voice with 409 limit_reached, but re-starring a starred one still succeeds", async () => {
    // A new voice: the count is at the cap and the lookup finds nothing.
    fromMock.mockReturnValue(makeQB({ count: MAX_VOICE_FAVORITES_PER_USER, rows: [], single: ROW }))
    const app = buildApp()
    await app.register(voiceFavoriteRoutes)
    const refused = await star(app, "new-voice", { voiceType: "library", name: "New" })
    expect(refused.statusCode).toBe(409)
    expect(refused.json().error.code).toBe("limit_reached")

    // An already-starred voice: the lookup finds it, so the refresh goes through.
    fromMock.mockReturnValue(makeQB({ count: MAX_VOICE_FAVORITES_PER_USER, rows: [{ voice_id: ROW.voice_id }], single: ROW }))
    const refreshed = await star(app, ROW.voice_id, { voiceType: "premade", name: "Rachel" })
    expect(refreshed.statusCode).toBe(200)
  })

  it("a database error answers 500 with a plain message, on the list and on the star", async () => {
    fromMock.mockReturnValue(makeQB({ error: { code: "XX000", message: "boom" } }))
    const app = buildApp()
    await app.register(voiceFavoriteRoutes)
    const list = await app.inject({ method: "GET", url: `/v1/voices/favorites?${asUser}` })
    expect(list.statusCode).toBe(500)
    expect(JSON.stringify(list.json())).not.toContain("boom")
    expect((await star(app, ROW.voice_id, { voiceType: "premade", name: "Rachel" })).statusCode).toBe(500)
  })

  it("DELETE /v1/voices/favorites/:voiceId unstars within the caller's own rows and is idempotent", async () => {
    const qb = makeQB({})
    fromMock.mockReturnValue(qb)
    const app = buildApp()
    await app.register(voiceFavoriteRoutes)
    const res = await app.inject({ method: "DELETE", url: `/v1/voices/favorites/${ROW.voice_id}?${asUser}` })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ success: true })
    expect(qb.delete).toHaveBeenCalled()
    expect(qb.eq).toHaveBeenCalledWith("user_id", USER)
    expect(qb.eq).toHaveBeenCalledWith("voice_id", ROW.voice_id)
  })
})
