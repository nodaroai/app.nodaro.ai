/**
 * Who may change a user's presets, on every write route (presets, favorites,
 * import, reorder, groups):
 *
 *   - the editor's browser session            → yes
 *   - the user's own personal API key          → yes
 *   - an OAuth app granted `assets:write`      → yes
 *   - an OAuth app without it                  → 403 insufficient_scope
 *   - a personal key limited to some workflows → 403 (the routes declare no
 *     `workflowScope`, so the root guard refuses it before anything runs)
 *   - the deployment's billing integration key → 403
 *
 * Every refusal is also checked to have written nothing.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

const h = vi.hoisted(() => {
  const ROW = {
    id: "00000000-0000-4000-8000-000000000aaa",
    user_id: "00000000-0000-4000-8000-000000000001",
    node_type: "generate-image",
    name: "Mine",
    description: null,
    data: { prompt: "a fox" },
    group_id: null,
    tags: [],
    sort_order: 0,
    kind: "folder",
    preview_url: null,
    created_at: "2026-10-15T00:00:00Z",
    updated_at: "2026-10-15T00:00:00Z",
  }
  const writes: string[] = []
  function chain(table: string): Record<string, unknown> {
    const c: Record<string, unknown> = {}
    for (const m of ["select", "eq", "in", "order"]) c[m] = () => c
    for (const m of ["insert", "update", "delete", "upsert"]) {
      c[m] = () => {
        writes.push(`${m} ${table}`)
        return c
      }
    }
    c.single = async () => ({ data: ROW, error: null })
    c.maybeSingle = async () => ({ data: ROW, error: null })
    c.then = (resolve: (v: unknown) => unknown) => resolve({ data: [ROW], error: null })
    return c
  }
  return { ROW, writes, from: vi.fn((table: string) => chain(table)) }
})

vi.mock("../../lib/supabase.js", () => ({
  supabase: { from: h.from, auth: { getUser: vi.fn() } },
}))

const { nodePresetRoutes } = await import("../node-presets.js")
const { nodePresetGroupRoutes } = await import("../node-preset-groups.js")
const { registerTokenWorkflowScopeGuard, LIMITED_KEY_MESSAGE } = await import("../../middleware/token-workflow-scope.js")

const USER = h.ROW.user_id
const ID = h.ROW.id

type Credential = (req: Record<string, unknown>) => void

const CREDENTIALS: Record<string, Credential> = {
  session: (r) => {
    r.authKind = "jwt"
  },
  "personal key": (r) => {
    r.authKind = "api_token"
    r.apiToken = { id: "t1", userId: USER, workflowIds: [] }
  },
  "OAuth app with assets:write": (r) => {
    r.authKind = "app_token"
    r.appAuthorization = { appId: "a", authorizationId: "z", scopes: ["presets:read", "assets:write"] }
  },
  "OAuth app without assets:write": (r) => {
    r.authKind = "app_token"
    r.appAuthorization = { appId: "a", authorizationId: "z", scopes: ["presets:read", "assets:read"] }
  },
  "workflow-limited key": (r) => {
    r.authKind = "api_token"
    r.apiToken = { id: "t2", userId: USER, workflowIds: ["0b9a6f8e-1111-4222-8333-444455556666"] }
  },
  "billing key": (r) => {
    r.authKind = "billing_key"
    r.billingKey = { id: "b1", name: "billing" }
  },
}

const WRITES: Array<{ method: "POST" | "PATCH" | "DELETE"; url: string; payload?: Record<string, unknown> }> = [
  { method: "POST", url: "/v1/node-presets", payload: { nodeType: "generate-image", name: "Mine", data: { prompt: "a fox" } } },
  { method: "PATCH", url: `/v1/node-presets/${ID}`, payload: { name: "Renamed" } },
  { method: "DELETE", url: `/v1/node-presets/${ID}` },
  { method: "POST", url: "/v1/node-presets/import", payload: { presets: [{ nodeType: "generate-image", name: "Imported", data: { prompt: "x" } }] } },
  { method: "POST", url: "/v1/node-presets/reorder", payload: { presets: [{ id: ID, sortOrder: 2 }] } },
  { method: "POST", url: "/v1/node-presets/favorites", payload: { nodeType: "generate-image", presetId: "generate-image/character-board" } },
  { method: "DELETE", url: "/v1/node-presets/favorites?nodeType=generate-image&presetId=generate-image%2Fcharacter-board" },
  { method: "POST", url: "/v1/node-preset-groups", payload: { nodeType: "generate-image", name: "Looks", kind: "folder" } },
  { method: "PATCH", url: `/v1/node-preset-groups/${ID}`, payload: { name: "Looks 2" } },
  { method: "DELETE", url: `/v1/node-preset-groups/${ID}` },
]

async function appFor(credential: Credential): Promise<FastifyInstance> {
  const app = Fastify()
  // Stands in for the auth hook: identifies the caller, as the real one does.
  app.addHook("preHandler", async (req) => {
    const r = req as unknown as Record<string, unknown>
    r.userId = USER
    credential(r)
  })
  // The real limited-key guard, registered right after auth as app.ts does.
  registerTokenWorkflowScopeGuard(app)
  await app.register(nodePresetRoutes)
  await app.register(nodePresetGroupRoutes)
  return app
}

beforeEach(() => {
  h.writes.length = 0
  h.from.mockClear()
})

describe("preset write routes — who may write", () => {
  for (const kind of ["session", "personal key", "OAuth app with assets:write"]) {
    it.each(WRITES)(`${kind}: $method $url is allowed`, async (w) => {
      const app = await appFor(CREDENTIALS[kind]!)
      const res = await app.inject({ method: w.method, url: w.url, payload: w.payload })
      expect(res.statusCode, res.body).toBeLessThan(300)
      expect(h.writes.length).toBeGreaterThan(0)
      await app.close()
    })
  }

  it.each(WRITES)("an OAuth app without assets:write is refused on $method $url, and nothing is written", async (w) => {
    const app = await appFor(CREDENTIALS["OAuth app without assets:write"]!)
    const res = await app.inject({ method: w.method, url: w.url, payload: w.payload })
    expect(res.statusCode).toBe(403)
    expect(res.json().error).toMatchObject({ code: "insufficient_scope", missingScope: "assets:write" })
    expect(h.writes).toEqual([])
    await app.close()
  })

  it.each(WRITES)("a personal key limited to some workflows is refused on $method $url, and nothing is written", async (w) => {
    const app = await appFor(CREDENTIALS["workflow-limited key"]!)
    const res = await app.inject({ method: w.method, url: w.url, payload: w.payload })
    expect(res.statusCode).toBe(403)
    expect(res.json().error).toEqual({ code: "forbidden", message: LIMITED_KEY_MESSAGE })
    expect(h.from).not.toHaveBeenCalled()
    await app.close()
  })

  it.each(WRITES)("the billing integration key is refused on $method $url, and nothing is written", async (w) => {
    const app = await appFor(CREDENTIALS["billing key"]!)
    const res = await app.inject({ method: w.method, url: w.url, payload: w.payload })
    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe("forbidden")
    expect(h.from).not.toHaveBeenCalled()
    await app.close()
  })

  it("reads stay on presets:read — an OAuth app with only assets:write cannot list", async () => {
    const app = await appFor((r) => {
      r.authKind = "app_token"
      r.appAuthorization = { appId: "a", authorizationId: "z", scopes: ["assets:write"] }
    })
    const res = await app.inject({ method: "GET", url: "/v1/node-presets" })
    expect(res.statusCode).toBe(403)
    expect(res.json().error.missingScope).toBe("presets:read")
    await app.close()
  })

  it("an unauthenticated write is a 401 and writes nothing", async () => {
    const app = Fastify()
    await app.register(nodePresetRoutes)
    const res = await app.inject({ method: "POST", url: "/v1/node-presets", payload: WRITES[0]!.payload })
    expect(res.statusCode).toBe(401)
    expect(h.writes).toEqual([])
    await app.close()
  })
})
