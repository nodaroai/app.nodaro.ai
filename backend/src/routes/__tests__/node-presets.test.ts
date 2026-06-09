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

import { nodePresetRoutes } from "../node-presets.js"
import { supabase } from "../../lib/supabase.js"

const USER = "00000000-0000-4000-8000-000000000001"

/** Flexible chainable + thenable Supabase query-builder mock. */
function makeQB(opts: { rows?: unknown; single?: unknown; error?: { code?: string; message?: string } | null }) {
  const result = { data: opts.rows ?? null, error: opts.error ?? null }
  const singleResult = { data: opts.single ?? null, error: opts.error ?? null }
  const qb: Record<string, unknown> = {}
  qb.select = vi.fn(() => qb)
  qb.insert = vi.fn(() => qb)
  qb.upsert = vi.fn(() => qb)
  qb.update = vi.fn(() => qb)
  qb.delete = vi.fn(() => qb)
  qb.eq = vi.fn(() => qb)
  qb.in = vi.fn(() => qb)
  qb.order = vi.fn(() => qb)
  qb.single = vi.fn(() => Promise.resolve(singleResult))
  qb.then = (resolve: (v: unknown) => unknown) => resolve(result)
  return qb
}

function buildApp(withUser = true): FastifyInstance {
  const app = Fastify()
  if (withUser) {
    app.addHook("preHandler", async (req) => {
      ;(req as { userId?: string }).userId = USER
    })
  }
  return app
}

const fromMock = supabase.from as ReturnType<typeof vi.fn>

describe("node-presets routes", () => {
  beforeEach(() => vi.clearAllMocks())

  it("GET /v1/node-presets returns the caller's presets scoped to user_id", async () => {
    const qb = makeQB({
      rows: [
        { id: "p1", user_id: USER, node_type: "generate-image", name: "X", description: null, data: { prompt: "a" }, created_at: "", updated_at: "" },
      ],
    })
    fromMock.mockReturnValue(qb)

    const app = buildApp()
    await app.register(nodePresetRoutes)
    const res = await app.inject({ method: "GET", url: "/v1/node-presets?nodeType=generate-image" })

    expect(res.statusCode).toBe(200)
    expect(res.json().data[0].name).toBe("X")
    expect(qb.eq).toHaveBeenCalledWith("user_id", USER)
    expect(qb.eq).toHaveBeenCalledWith("node_type", "generate-image")
  })

  it("POST /v1/node-presets strips runtime keys before insert and scopes user_id", async () => {
    const qb = makeQB({
      single: { id: "p2", user_id: USER, node_type: "generate-image", name: "Y", description: null, data: { prompt: "b" }, created_at: "", updated_at: "" },
    })
    fromMock.mockReturnValue(qb)

    const app = buildApp()
    await app.register(nodePresetRoutes)
    const res = await app.inject({
      method: "POST",
      url: "/v1/node-presets",
      payload: { nodeType: "generate-image", name: "Y", data: { prompt: "b", generatedResults: [1], currentJobId: "j" } },
    })

    expect(res.statusCode).toBe(201)
    const inserted = (qb.insert as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<string, unknown>
    expect(inserted.data).toEqual({ prompt: "b" }) // runtime keys stripped server-side
    expect(inserted.user_id).toBe(USER)
    expect(inserted.node_type).toBe("generate-image")
  })

  it("POST returns 409 on duplicate name (unique violation 23505)", async () => {
    const qb = makeQB({ error: { code: "23505", message: "dup" } })
    fromMock.mockReturnValue(qb)

    const app = buildApp()
    await app.register(nodePresetRoutes)
    const res = await app.inject({
      method: "POST",
      url: "/v1/node-presets",
      payload: { nodeType: "t", name: "dup", data: {} },
    })
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe("name_taken")
  })

  it("POST returns 400 on invalid body", async () => {
    const app = buildApp()
    await app.register(nodePresetRoutes)
    const res = await app.inject({ method: "POST", url: "/v1/node-presets", payload: { name: "no type", data: {} } })
    expect(res.statusCode).toBe(400)
  })

  it("PATCH overrides data (runtime keys stripped) scoped to id + user_id", async () => {
    const qb = makeQB({
      single: { id: "p1", user_id: USER, node_type: "generate-image", name: "X", description: null, data: { prompt: "new" }, created_at: "", updated_at: "" },
    })
    fromMock.mockReturnValue(qb)
    const app = buildApp()
    await app.register(nodePresetRoutes)
    const res = await app.inject({
      method: "PATCH",
      url: "/v1/node-presets/p1",
      payload: { data: { prompt: "new", generatedResults: [1] } },
    })
    expect(res.statusCode).toBe(200)
    const updated = (qb.update as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<string, unknown>
    expect(updated.data).toEqual({ prompt: "new" }) // runtime key stripped
    expect(qb.eq).toHaveBeenCalledWith("id", "p1")
    expect(qb.eq).toHaveBeenCalledWith("user_id", USER)
  })

  it("PATCH returns 404 when the preset is not owned/found", async () => {
    const qb = makeQB({ error: { code: "PGRST116", message: "no rows" } })
    fromMock.mockReturnValue(qb)
    const app = buildApp()
    await app.register(nodePresetRoutes)
    const res = await app.inject({ method: "PATCH", url: "/v1/node-presets/p9", payload: { name: "Z" } })
    expect(res.statusCode).toBe(404)
  })

  it("DELETE scopes to id + user_id", async () => {
    const qb = makeQB({})
    fromMock.mockReturnValue(qb)
    const app = buildApp()
    await app.register(nodePresetRoutes)
    const res = await app.inject({ method: "DELETE", url: "/v1/node-presets/abc" })
    expect(res.statusCode).toBe(200)
    expect(qb.eq).toHaveBeenCalledWith("id", "abc")
    expect(qb.eq).toHaveBeenCalledWith("user_id", USER)
  })

  const GROUP1 = "00000000-0000-4000-8000-000000000111"
  const PRESET1 = "00000000-0000-4000-8000-000000000222"

  it("POST persists groupId, tags and sortOrder", async () => {
    const qb = makeQB({
      rows: [{ id: GROUP1 }], // ownership check: GROUP1 is owned by the user
      single: { id: "p3", user_id: USER, node_type: "generate-image", name: "Z", description: null, data: { prompt: "x" }, group_id: GROUP1, tags: ["hero"], sort_order: 2, created_at: "", updated_at: "" },
    })
    fromMock.mockReturnValue(qb)
    const app = buildApp()
    await app.register(nodePresetRoutes)
    const res = await app.inject({
      method: "POST",
      url: "/v1/node-presets",
      payload: { nodeType: "generate-image", name: "Z", data: { prompt: "x" }, groupId: GROUP1, tags: ["hero"], sortOrder: 2 },
    })
    expect(res.statusCode).toBe(201)
    const inserted = (qb.insert as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<string, unknown>
    expect(inserted).toMatchObject({ group_id: GROUP1, tags: ["hero"], sort_order: 2 })
    expect(res.json().data).toMatchObject({ groupId: GROUP1, tags: ["hero"], sortOrder: 2 })
  })

  it("POST /reorder updates groups + presets scoped to the user", async () => {
    const qb = makeQB({ rows: [{ id: GROUP1 }] }) // ownership check sees GROUP1 as owned
    fromMock.mockReturnValue(qb)
    const app = buildApp()
    await app.register(nodePresetRoutes)
    const res = await app.inject({
      method: "POST",
      url: "/v1/node-presets/reorder",
      payload: { groups: [{ id: GROUP1, sortOrder: 0 }], presets: [{ id: PRESET1, groupId: GROUP1, sortOrder: 1 }] },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toEqual({ ok: true })
    expect(qb.eq).toHaveBeenCalledWith("user_id", USER)
  })

  it("POST /reorder rejects moving a preset into a group the user does not own", async () => {
    const qb = makeQB({ rows: [] }) // ownership check finds no owned group → unowned
    fromMock.mockReturnValue(qb)
    const app = buildApp()
    await app.register(nodePresetRoutes)
    const res = await app.inject({
      method: "POST",
      url: "/v1/node-presets/reorder",
      payload: { presets: [{ id: PRESET1, groupId: GROUP1, sortOrder: 0 }] },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("invalid_group")
  })

  it("rejects unauthenticated requests with 401", async () => {
    const app = buildApp(false)
    await app.register(nodePresetRoutes)
    const res = await app.inject({ method: "GET", url: "/v1/node-presets" })
    expect(res.statusCode).toBe(401)
  })

  it("GET /v1/node-presets/factory returns the built-in catalog (no popularIds — Popular removed)", async () => {
    const app = buildApp()
    await app.register(nodePresetRoutes)
    const res = await app.inject({ method: "GET", url: "/v1/node-presets/factory?nodeType=generate-image" })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(Array.isArray(body.data)).toBe(true)
    expect(body.data.length).toBeGreaterThan(0)
    expect(body.popularIds).toBeUndefined()
  })

  it("GET /v1/node-presets/factory requires a nodeType", async () => {
    const app = buildApp()
    await app.register(nodePresetRoutes)
    const res = await app.inject({ method: "GET", url: "/v1/node-presets/factory" })
    expect(res.statusCode).toBe(400)
  })

  // ── Favorites ────────────────────────────────────────────────────────────
  it("GET /v1/node-presets/favorites returns the user's favorite ids, most-recent first", async () => {
    fromMock.mockReturnValue(
      makeQB({ rows: [{ preset_id: "generate-image/character-board" }, { preset_id: "p-uuid" }] }),
    )
    const app = buildApp()
    await app.register(nodePresetRoutes)
    const res = await app.inject({ method: "GET", url: "/v1/node-presets/favorites?nodeType=generate-image" })
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toEqual(["generate-image/character-board", "p-uuid"])
  })

  it("GET /v1/node-presets/favorites requires a nodeType", async () => {
    const app = buildApp()
    await app.register(nodePresetRoutes)
    const res = await app.inject({ method: "GET", url: "/v1/node-presets/favorites" })
    expect(res.statusCode).toBe(400)
  })

  it("POST /v1/node-presets/favorites adds a favorite (idempotent upsert)", async () => {
    const qb = makeQB({})
    fromMock.mockReturnValue(qb)
    const app = buildApp()
    await app.register(nodePresetRoutes)
    const res = await app.inject({
      method: "POST",
      url: "/v1/node-presets/favorites",
      payload: { nodeType: "generate-image", presetId: "generate-image/character-board" },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toEqual({ success: true })
    expect(qb.upsert).toHaveBeenCalled()
  })

  it("DELETE /v1/node-presets/favorites requires nodeType and presetId", async () => {
    const app = buildApp()
    await app.register(nodePresetRoutes)
    const res = await app.inject({ method: "DELETE", url: "/v1/node-presets/favorites?nodeType=generate-image" })
    expect(res.statusCode).toBe(400)
  })

  it("DELETE /v1/node-presets/favorites removes a favorite", async () => {
    const qb = makeQB({})
    fromMock.mockReturnValue(qb)
    const app = buildApp()
    await app.register(nodePresetRoutes)
    const url = "/v1/node-presets/favorites?nodeType=generate-image&presetId=" + encodeURIComponent("generate-image/character-board")
    const res = await app.inject({ method: "DELETE", url })
    expect(res.statusCode).toBe(200)
    expect(qb.delete).toHaveBeenCalled()
  })

  it("favorites writes reject programmatic (OAuth app) tokens with 403", async () => {
    const app = Fastify()
    app.addHook("preHandler", async (req) => {
      const r = req as { userId?: string; appAuthorization?: { appId: string; authorizationId: string; scopes: string[] } }
      r.userId = USER
      r.appAuthorization = { appId: "a", authorizationId: "z", scopes: ["presets:read"] }
    })
    await app.register(nodePresetRoutes)
    const res = await app.inject({
      method: "POST",
      url: "/v1/node-presets/favorites",
      payload: { nodeType: "generate-image", presetId: "x" },
    })
    expect(res.statusCode).toBe(403)
  })

  it("LIST enforces presets:read for OAuth app tokens (403 without, 200 with)", async () => {
    type AuthReq = { userId?: string; appAuthorization?: { appId: string; authorizationId: string; scopes: string[] } }
    fromMock.mockReturnValue(makeQB({ rows: [] }))

    const noScope = Fastify()
    noScope.addHook("preHandler", async (req) => {
      const r = req as AuthReq
      r.userId = USER
      r.appAuthorization = { appId: "a", authorizationId: "z", scopes: [] }
    })
    await noScope.register(nodePresetRoutes)
    const r1 = await noScope.inject({ method: "GET", url: "/v1/node-presets" })
    expect(r1.statusCode).toBe(403)
    expect(r1.json().error.code).toBe("insufficient_scope")

    const withScope = Fastify()
    withScope.addHook("preHandler", async (req) => {
      const r = req as AuthReq
      r.userId = USER
      r.appAuthorization = { appId: "a", authorizationId: "z", scopes: ["presets:read"] }
    })
    await withScope.register(nodePresetRoutes)
    const r2 = await withScope.inject({ method: "GET", url: "/v1/node-presets" })
    expect(r2.statusCode).toBe(200)
  })

  // Presets are READ-ONLY over the API (SDK/CLI expose reads only). Write routes
  // must reject programmatic tokens — an OAuth app the user approved with only
  // `presets:read` (the sole preset scope) must not be able to mutate/delete the
  // owner's presets, and personal API tokens are read-only here too.
  const WRITE_ROUTES: Array<{ method: "POST" | "PATCH" | "DELETE"; url: string; payload?: Record<string, unknown> }> = [
    { method: "POST", url: "/v1/node-presets", payload: { nodeType: "t", name: "n", data: { prompt: "x" } } },
    { method: "PATCH", url: "/v1/node-presets/00000000-0000-4000-8000-000000000aaa", payload: { name: "n" } },
    { method: "DELETE", url: "/v1/node-presets/00000000-0000-4000-8000-000000000aaa" },
    { method: "POST", url: "/v1/node-presets/import", payload: { presets: [{ nodeType: "t", name: "n", data: { prompt: "x" } }] } },
    { method: "POST", url: "/v1/node-presets/reorder", payload: { presets: [] } },
  ]

  it("write routes reject OAuth app tokens (presets:read cannot write)", async () => {
    type AuthReq = { userId?: string; appAuthorization?: { appId: string; authorizationId: string; scopes: string[] } }
    fromMock.mockReturnValue(makeQB({ single: { id: "p", user_id: USER, node_type: "t", name: "n", description: null, data: {}, created_at: "", updated_at: "" } }))
    const app = Fastify()
    app.addHook("preHandler", async (req) => {
      const r = req as AuthReq
      r.userId = USER
      r.appAuthorization = { appId: "a", authorizationId: "z", scopes: ["presets:read"] }
    })
    await app.register(nodePresetRoutes)
    for (const route of WRITE_ROUTES) {
      const res = await app.inject({ method: route.method, url: route.url, payload: route.payload })
      expect(res.statusCode, `${route.method} ${route.url}`).toBe(403)
    }
  })

  it("write routes reject personal API tokens (read-only over the API)", async () => {
    type AuthReq = { userId?: string; apiToken?: { userId: string } }
    fromMock.mockReturnValue(makeQB({ single: { id: "p", user_id: USER, node_type: "t", name: "n", description: null, data: {}, created_at: "", updated_at: "" } }))
    const app = Fastify()
    app.addHook("preHandler", async (req) => {
      const r = req as AuthReq
      r.userId = USER
      r.apiToken = { userId: USER }
    })
    await app.register(nodePresetRoutes)
    const res = await app.inject({ method: "POST", url: "/v1/node-presets", payload: { nodeType: "t", name: "n", data: { prompt: "x" } } })
    expect(res.statusCode).toBe(403)
  })

  it("write routes still work for first-party JWT sessions (no appAuthorization / apiToken)", async () => {
    // Guard must NOT block the editor (Supabase JWT → neither field set).
    fromMock.mockReturnValue(makeQB({ single: { id: "p", user_id: USER, node_type: "t", name: "n", description: null, data: { prompt: "x" }, created_at: "", updated_at: "" } }))
    const app = buildApp()
    await app.register(nodePresetRoutes)
    const res = await app.inject({ method: "POST", url: "/v1/node-presets", payload: { nodeType: "t", name: "n", data: { prompt: "x" } } })
    expect(res.statusCode).toBe(201)
  })
})
