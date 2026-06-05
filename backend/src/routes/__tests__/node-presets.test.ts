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

  it("rejects unauthenticated requests with 401", async () => {
    const app = buildApp(false)
    await app.register(nodePresetRoutes)
    const res = await app.inject({ method: "GET", url: "/v1/node-presets" })
    expect(res.statusCode).toBe(401)
  })
})
