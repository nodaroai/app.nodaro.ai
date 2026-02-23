import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

vi.mock("@/lib/supabase.js", () => {
  const mockFrom = vi.fn()
  return { supabase: { from: mockFrom } }
})

vi.mock("@/lib/config.js", () => ({
  config: { EDITION: "cloud", SUPABASE_URL: "https://test.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "test" },
  isCloud: () => true, hasCredits: () => true, isCommunity: () => false, isBusiness: () => false, hasAdmin: () => true,
}))

vi.mock("@/lib/admin-check.js", () => ({
  warmAdminCache: vi.fn(),
  checkIsAdmin: vi.fn().mockResolvedValue(true),
}))

vi.mock("@/lib/app-settings.js", () => ({
  invalidateSettingsCache: vi.fn(),
}))

// We need to mock require-admin properly - it imports checkIsAdmin
vi.mock("@/middleware/require-admin.js", async () => {
  const { checkIsAdmin } = await import("@/lib/admin-check.js")
  return {
    requireAdmin: async (req: any, reply: any) => {
      const userId = req.userId
      if (!userId) {
        reply.status(401).send({ error: { code: "unauthorized", message: "Authentication required" } })
        return
      }
      const isAdmin = await checkIsAdmin(userId)
      if (!isAdmin) {
        reply.status(403).send({ error: { code: "forbidden", message: "Admin access required" } })
        return
      }
    },
  }
})

import { adminSettingsRoutes } from "../admin-settings.js"
import { supabase } from "../../lib/supabase.js"
import { checkIsAdmin } from "../../lib/admin-check.js"
import { invalidateSettingsCache } from "../../lib/app-settings.js"

let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()
  vi.mocked(checkIsAdmin).mockResolvedValue(true)

  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    const query = req.query as Record<string, string | undefined>
    const body = req.body as Record<string, unknown> | undefined
    const userId = query?.userId ?? (body?.userId as string | undefined)
    if (userId) {
      req.userId = userId
      req.userRole = undefined
    }
  })
  await app.register(async (instance) => { await adminSettingsRoutes(instance) })
  await app.ready()
})

afterEach(async () => { await app.close() })

describe("GET /v1/admin/settings", () => {
  it("returns 401 when no userId", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/settings" })
    expect(res.statusCode).toBe(401)
  })

  it("returns 403 when user is not admin", async () => {
    vi.mocked(checkIsAdmin).mockResolvedValueOnce(false)
    const res = await app.inject({ method: "GET", url: "/v1/admin/settings?userId=user-1" })
    expect(res.statusCode).toBe(403)
  })

  it("returns 200 with settings object", async () => {
    const mockOrder = vi.fn().mockResolvedValue({
      data: [
        { key: "ai_provider", value: "kie", updated_at: "2024-01-01" },
        { key: "cost_markup_percent", value: 25, updated_at: "2024-01-01" },
      ],
      error: null,
    })
    const mockSelect = vi.fn().mockReturnValue({ order: mockOrder })
    vi.mocked(supabase.from).mockReturnValue({ select: mockSelect } as never)

    const res = await app.inject({ method: "GET", url: "/v1/admin/settings?userId=admin-1" })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.settings.ai_provider).toBe("kie")
    expect(body.settings.cost_markup_percent).toBe(25)
  })

  it("returns 500 on DB error", async () => {
    const mockOrder = vi.fn().mockResolvedValue({ data: null, error: { message: "DB error" } })
    const mockSelect = vi.fn().mockReturnValue({ order: mockOrder })
    vi.mocked(supabase.from).mockReturnValue({ select: mockSelect } as never)

    const res = await app.inject({ method: "GET", url: "/v1/admin/settings?userId=admin-1" })
    expect(res.statusCode).toBe(500)
  })
})

describe("GET /v1/admin/settings/:key", () => {
  it("returns 404 when key not found (PGRST116)", async () => {
    const mockSingle = vi.fn().mockResolvedValue({ data: null, error: { code: "PGRST116", message: "not found" } })
    const mockEq = vi.fn().mockReturnValue({ single: mockSingle })
    const mockSelect = vi.fn().mockReturnValue({ eq: mockEq })
    vi.mocked(supabase.from).mockReturnValue({ select: mockSelect } as never)

    const res = await app.inject({ method: "GET", url: "/v1/admin/settings/nonexistent?userId=admin-1" })
    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe("not_found")
  })

  it("returns 200 with key value", async () => {
    const mockSingle = vi.fn().mockResolvedValue({
      data: { key: "ai_provider", value: "kie", updated_at: "2024-01-01" },
      error: null,
    })
    const mockEq = vi.fn().mockReturnValue({ single: mockSingle })
    const mockSelect = vi.fn().mockReturnValue({ eq: mockEq })
    vi.mocked(supabase.from).mockReturnValue({ select: mockSelect } as never)

    const res = await app.inject({ method: "GET", url: "/v1/admin/settings/ai_provider?userId=admin-1" })
    expect(res.statusCode).toBe(200)
    expect(res.json().key).toBe("ai_provider")
    expect(res.json().value).toBe("kie")
  })

  it("returns 500 on DB error", async () => {
    const mockSingle = vi.fn().mockResolvedValue({ data: null, error: { code: "OTHER", message: "DB error" } })
    const mockEq = vi.fn().mockReturnValue({ single: mockSingle })
    const mockSelect = vi.fn().mockReturnValue({ eq: mockEq })
    vi.mocked(supabase.from).mockReturnValue({ select: mockSelect } as never)

    const res = await app.inject({ method: "GET", url: "/v1/admin/settings/test?userId=admin-1" })
    expect(res.statusCode).toBe(500)
  })
})

describe("PUT /v1/admin/settings/:key", () => {
  it("returns 400 when ai_provider value is invalid", async () => {
    const res = await app.inject({
      method: "PUT", url: "/v1/admin/settings/ai_provider",
      payload: { value: "invalid_provider", userId: "admin-1" },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.message).toContain("ai_provider")
  })

  it("returns 400 when cost_markup_percent is negative", async () => {
    const res = await app.inject({
      method: "PUT", url: "/v1/admin/settings/cost_markup_percent",
      payload: { value: -5, userId: "admin-1" },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.message).toContain("cost_markup_percent")
  })

  it("returns 400 when cost_markup_percent exceeds 500", async () => {
    const res = await app.inject({
      method: "PUT", url: "/v1/admin/settings/cost_markup_percent",
      payload: { value: 501, userId: "admin-1" },
    })
    expect(res.statusCode).toBe(400)
  })

  it("returns 200 and invalidates cache on successful upsert", async () => {
    const mockSingle = vi.fn().mockResolvedValue({
      data: { key: "ai_provider", value: "replicate", updated_at: "2024-01-01" },
      error: null,
    })
    const mockSelect = vi.fn().mockReturnValue({ single: mockSingle })
    const mockUpsert = vi.fn().mockReturnValue({ select: mockSelect })
    vi.mocked(supabase.from).mockReturnValue({ upsert: mockUpsert } as never)

    const res = await app.inject({
      method: "PUT", url: "/v1/admin/settings/ai_provider",
      payload: { value: "replicate", userId: "admin-1" },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().value).toBe("replicate")
    expect(invalidateSettingsCache).toHaveBeenCalled()
  })

  it("returns 500 on DB error", async () => {
    const mockSingle = vi.fn().mockResolvedValue({ data: null, error: { message: "DB error" } })
    const mockSelect = vi.fn().mockReturnValue({ single: mockSingle })
    const mockUpsert = vi.fn().mockReturnValue({ select: mockSelect })
    vi.mocked(supabase.from).mockReturnValue({ upsert: mockUpsert } as never)

    const res = await app.inject({
      method: "PUT", url: "/v1/admin/settings/test_key",
      payload: { value: "test_value", userId: "admin-1" },
    })
    expect(res.statusCode).toBe(500)
  })

  it("accepts valid ai_provider values", async () => {
    const mockSingle = vi.fn().mockResolvedValue({
      data: { key: "ai_provider", value: "kie", updated_at: "2024-01-01" },
      error: null,
    })
    const mockSelect = vi.fn().mockReturnValue({ single: mockSingle })
    const mockUpsert = vi.fn().mockReturnValue({ select: mockSelect })
    vi.mocked(supabase.from).mockReturnValue({ upsert: mockUpsert } as never)

    const res = await app.inject({
      method: "PUT", url: "/v1/admin/settings/ai_provider",
      payload: { value: "kie", userId: "admin-1" },
    })
    expect(res.statusCode).toBe(200)
  })
})
