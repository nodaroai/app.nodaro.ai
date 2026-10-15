import { describe, it, expect, vi, beforeEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

vi.mock("@/lib/supabase.js", () => {
  const mockFrom = vi.fn()
  return {
    supabase: {
      from: mockFrom,
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-123" } }, error: null }) },
    },
  }
})
vi.mock("@/lib/config.js", () => ({
  config: { EDITION: "cloud", SUPABASE_URL: "https://t.co", SUPABASE_SERVICE_ROLE_KEY: "k" },
  isCloud: () => true, hasCredits: () => true, isCommunity: () => false, isBusiness: () => false, hasAdmin: () => true,
}))

import { nodePresetGroupRoutes } from "../node-preset-groups.js"
import { supabase } from "../../lib/supabase.js"

const USER = "00000000-0000-4000-8000-000000000001"
const GROUP_ID = "00000000-0000-4000-8000-0000000000cd"

function makeQB(opts: { rows?: unknown; single?: unknown; error?: { code?: string; message?: string } | null }) {
  const result = { data: opts.rows ?? null, error: opts.error ?? null }
  const singleResult = { data: opts.single ?? null, error: opts.error ?? null }
  const qb: Record<string, unknown> = {}
  qb.select = vi.fn(() => qb)
  qb.insert = vi.fn(() => qb)
  qb.update = vi.fn(() => qb)
  qb.delete = vi.fn(() => qb)
  qb.eq = vi.fn(() => qb)
  qb.order = vi.fn(() => qb)
  qb.single = vi.fn(() => Promise.resolve(singleResult))
  qb.then = (resolve: (v: unknown) => unknown) => resolve(result)
  return qb
}

function buildApp(withUser = true): FastifyInstance {
  const app = Fastify()
  if (withUser) app.addHook("preHandler", async (req) => { (req as { userId?: string }).userId = USER })
  return app
}

const fromMock = supabase.from as ReturnType<typeof vi.fn>

describe("node-preset-groups routes", () => {
  beforeEach(() => vi.clearAllMocks())

  it("GET lists the caller's groups for a node type", async () => {
    const qb = makeQB({ rows: [{ id: "g1", user_id: USER, node_type: "generate-image", name: "Portraits", kind: "folder", sort_order: 0, created_at: "", updated_at: "" }] })
    fromMock.mockReturnValue(qb)
    const app = buildApp()
    await app.register(nodePresetGroupRoutes)
    const res = await app.inject({ method: "GET", url: "/v1/node-preset-groups?nodeType=generate-image" })
    expect(res.statusCode).toBe(200)
    expect(res.json().data[0]).toMatchObject({ name: "Portraits", kind: "folder" })
    expect(qb.eq).toHaveBeenCalledWith("user_id", USER)
  })

  it("POST creates a folder scoped to the user", async () => {
    const qb = makeQB({ single: { id: "g2", user_id: USER, node_type: "generate-image", name: "Looks", kind: "section", sort_order: 0, created_at: "", updated_at: "" } })
    fromMock.mockReturnValue(qb)
    const app = buildApp()
    await app.register(nodePresetGroupRoutes)
    const res = await app.inject({ method: "POST", url: "/v1/node-preset-groups", payload: { nodeType: "generate-image", name: "Looks", kind: "section" } })
    expect(res.statusCode).toBe(201)
    const inserted = (qb.insert as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<string, unknown>
    expect(inserted).toMatchObject({ user_id: USER, node_type: "generate-image", name: "Looks", kind: "section" })
  })

  it("POST rejects an invalid kind", async () => {
    const app = buildApp()
    await app.register(nodePresetGroupRoutes)
    const res = await app.inject({ method: "POST", url: "/v1/node-preset-groups", payload: { nodeType: "x", name: "y", kind: "bogus" } })
    expect(res.statusCode).toBe(400)
  })

  it("DELETE scopes to id + user_id", async () => {
    // .delete().eq().eq().select("id") resolves to the deleted rows.
    const qb = makeQB({ rows: [{ id: "g1" }] })
    fromMock.mockReturnValue(qb)
    const app = buildApp()
    await app.register(nodePresetGroupRoutes)
    const res = await app.inject({ method: "DELETE", url: `/v1/node-preset-groups/${GROUP_ID}` })
    expect(res.statusCode).toBe(200)
    expect(qb.eq).toHaveBeenCalledWith("id", GROUP_ID)
    expect(qb.eq).toHaveBeenCalledWith("user_id", USER)
  })

  it("DELETE answers 404 when the scoped delete matched nothing (someone else's group) — #699", async () => {
    const qb = makeQB({ rows: [] })
    fromMock.mockReturnValue(qb)
    const app = buildApp()
    await app.register(nodePresetGroupRoutes)
    const res = await app.inject({ method: "DELETE", url: `/v1/node-preset-groups/${GROUP_ID}` })
    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe("not_found")
  })

  it("DELETE answers 404 for a malformed id, before the database is asked", async () => {
    const app = buildApp()
    await app.register(nodePresetGroupRoutes)
    const res = await app.inject({ method: "DELETE", url: "/v1/node-preset-groups/g1" })
    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe("not_found")
    expect(fromMock).not.toHaveBeenCalled()
  })

  it("POST refuses a new group once the user keeps the most allowed (409 limit_reached), and writes nothing", async () => {
    const { MAX_PRESET_GROUPS_PER_USER } = await import("../../lib/presets/limits.js")
    const qb = makeQB({ rows: [] })
    ;(qb as { then: unknown }).then = (resolve: (v: unknown) => unknown) =>
      resolve({ data: null, error: null, count: MAX_PRESET_GROUPS_PER_USER })
    fromMock.mockReturnValue(qb)
    const app = buildApp()
    await app.register(nodePresetGroupRoutes)
    const res = await app.inject({ method: "POST", url: "/v1/node-preset-groups", payload: { nodeType: "generate-image", name: "One more" } })
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe("limit_reached")
    expect(qb.insert).not.toHaveBeenCalled()
  })

  it("rejects unauthenticated requests", async () => {
    const app = buildApp(false)
    await app.register(nodePresetGroupRoutes)
    const res = await app.inject({ method: "GET", url: "/v1/node-preset-groups" })
    expect(res.statusCode).toBe(401)
  })

  // Every credential kind on every write route: node-presets-write-access.test.ts.
  it("write routes refuse an OAuth app holding only presets:read, and accept the user's personal API key", async () => {
    type AuthReq = {
      userId?: string
      authKind?: string
      appAuthorization?: { appId: string; authorizationId: string; scopes: string[] }
      apiToken?: { userId: string; workflowIds: string[] }
    }
    const writes: Array<{ method: "POST" | "PATCH" | "DELETE"; url: string; payload?: Record<string, unknown> }> = [
      { method: "POST", url: "/v1/node-preset-groups", payload: { nodeType: "generate-image", name: "Looks", kind: "folder" } },
      { method: "PATCH", url: "/v1/node-preset-groups/00000000-0000-4000-8000-000000000bbb", payload: { name: "n" } },
      { method: "DELETE", url: "/v1/node-preset-groups/00000000-0000-4000-8000-000000000bbb" },
    ]
    const row = { id: "g", user_id: USER, node_type: "t", name: "n", kind: "folder", sort_order: 0, created_at: "", updated_at: "" }

    for (const [auth, allowed] of [
      [(r: AuthReq) => { r.authKind = "app_token"; r.appAuthorization = { appId: "a", authorizationId: "z", scopes: ["presets:read"] } }, false],
      [(r: AuthReq) => { r.authKind = "api_token"; r.apiToken = { userId: USER, workflowIds: [] } }, true],
    ] as const) {
      fromMock.mockReturnValue(makeQB({ single: row, rows: [row] }))
      const app = Fastify()
      app.addHook("preHandler", async (req) => { const r = req as AuthReq; r.userId = USER; auth(r) })
      await app.register(nodePresetGroupRoutes)
      for (const w of writes) {
        const res = await app.inject({ method: w.method, url: w.url, payload: w.payload })
        if (allowed) expect(res.statusCode, `${w.method} ${w.url}`).toBeLessThan(300)
        else expect(res.json().error.code, `${w.method} ${w.url}`).toBe("insufficient_scope")
      }
    }
  })
})
