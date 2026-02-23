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

import { adminGalleryReportsRoutes } from "../admin-gallery-reports.js"
import { supabase } from "../../lib/supabase.js"
import { checkIsAdmin } from "../../lib/admin-check.js"

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
  await app.register(async (instance) => { await adminGalleryReportsRoutes(instance) })
  await app.ready()
})

afterEach(async () => { await app.close() })

describe("GET /v1/admin/gallery-reports", () => {
  it("returns 401 when no userId", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/gallery-reports" })
    expect(res.statusCode).toBe(401)
  })

  it("returns 403 when user is not admin", async () => {
    vi.mocked(checkIsAdmin).mockResolvedValueOnce(false)
    const res = await app.inject({ method: "GET", url: "/v1/admin/gallery-reports?userId=user-1" })
    expect(res.statusCode).toBe(403)
  })

  it("returns 200 with empty data", async () => {
    const mockRange = vi.fn().mockResolvedValue({ data: [], count: 0, error: null })
    const mockOrder = vi.fn().mockReturnValue({ range: mockRange })
    const mockSelect = vi.fn().mockReturnValue({ order: mockOrder })
    vi.mocked(supabase.from).mockReturnValue({ select: mockSelect } as never)

    const res = await app.inject({ method: "GET", url: "/v1/admin/gallery-reports?userId=admin-1" })
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toEqual([])
    expect(res.json().total).toBe(0)
  })

  it("returns 200 with reports and pagination", async () => {
    const reports = [{ id: "r1", status: "pending", job_id: "j1" }]
    const mockRange = vi.fn().mockResolvedValue({ data: reports, count: 1, error: null })
    const mockOrder = vi.fn().mockReturnValue({ range: mockRange })
    const mockSelect = vi.fn().mockReturnValue({ order: mockOrder })
    vi.mocked(supabase.from).mockReturnValue({ select: mockSelect } as never)

    const res = await app.inject({ method: "GET", url: "/v1/admin/gallery-reports?userId=admin-1" })
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toHaveLength(1)
    expect(res.json().total).toBe(1)
    expect(res.json().page).toBe(1)
    expect(res.json().limit).toBe(50)
  })

  it("applies status filter", async () => {
    const mockEq = vi.fn().mockResolvedValue({ data: [], count: 0, error: null })
    const mockRange = vi.fn().mockReturnValue({ eq: mockEq })
    const mockOrder = vi.fn().mockReturnValue({ range: mockRange })
    const mockSelect = vi.fn().mockReturnValue({ order: mockOrder })
    vi.mocked(supabase.from).mockReturnValue({ select: mockSelect } as never)

    const res = await app.inject({ method: "GET", url: "/v1/admin/gallery-reports?userId=admin-1&status=pending" })
    expect(res.statusCode).toBe(200)
    expect(mockEq).toHaveBeenCalledWith("status", "pending")
  })

  it("returns 500 on DB error", async () => {
    const mockRange = vi.fn().mockResolvedValue({ data: null, count: null, error: { message: "DB error" } })
    const mockOrder = vi.fn().mockReturnValue({ range: mockRange })
    const mockSelect = vi.fn().mockReturnValue({ order: mockOrder })
    vi.mocked(supabase.from).mockReturnValue({ select: mockSelect } as never)

    const res = await app.inject({ method: "GET", url: "/v1/admin/gallery-reports?userId=admin-1" })
    expect(res.statusCode).toBe(500)
  })
})

describe("GET /v1/admin/gallery-reports/count", () => {
  it("returns 403 when user is not admin", async () => {
    vi.mocked(checkIsAdmin).mockResolvedValueOnce(false)
    const res = await app.inject({ method: "GET", url: "/v1/admin/gallery-reports/count?userId=user-1" })
    expect(res.statusCode).toBe(403)
  })

  it("returns 200 with count", async () => {
    const mockEq = vi.fn().mockResolvedValue({ count: 5, error: null })
    const mockSelect = vi.fn().mockReturnValue({ eq: mockEq })
    vi.mocked(supabase.from).mockReturnValue({ select: mockSelect } as never)

    const res = await app.inject({ method: "GET", url: "/v1/admin/gallery-reports/count?userId=admin-1" })
    expect(res.statusCode).toBe(200)
    expect(res.json().count).toBe(5)
  })

  it("returns 500 on DB error", async () => {
    const mockEq = vi.fn().mockResolvedValue({ count: null, error: { message: "DB error" } })
    const mockSelect = vi.fn().mockReturnValue({ eq: mockEq })
    vi.mocked(supabase.from).mockReturnValue({ select: mockSelect } as never)

    const res = await app.inject({ method: "GET", url: "/v1/admin/gallery-reports/count?userId=admin-1" })
    expect(res.statusCode).toBe(500)
  })
})

describe("PATCH /v1/admin/gallery-reports/:reportId", () => {
  const REPORT_ID = "00000000-0000-4000-8000-000000000001"

  it("returns 400 when status is invalid", async () => {
    const res = await app.inject({
      method: "PATCH", url: `/v1/admin/gallery-reports/${REPORT_ID}`,
      payload: { status: "invalid", userId: "admin-1" },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
  })

  it("returns 400 when reportId is not a UUID", async () => {
    const res = await app.inject({
      method: "PATCH", url: "/v1/admin/gallery-reports/not-a-uuid",
      payload: { status: "reviewed", userId: "admin-1" },
    })
    expect(res.statusCode).toBe(400)
  })

  it("returns 404 when report not found", async () => {
    const mockSingle = vi.fn().mockResolvedValue({ data: null, error: { code: "PGRST116", message: "not found" } })
    const mockSelect = vi.fn().mockReturnValue({ single: mockSingle })
    const mockEq = vi.fn().mockReturnValue({ select: mockSelect })
    const mockUpdate = vi.fn().mockReturnValue({ eq: mockEq })
    vi.mocked(supabase.from).mockReturnValue({ update: mockUpdate } as never)

    const res = await app.inject({
      method: "PATCH", url: `/v1/admin/gallery-reports/${REPORT_ID}`,
      payload: { status: "reviewed", userId: "admin-1" },
    })
    expect(res.statusCode).toBe(404)
  })

  it("returns 200 on successful update", async () => {
    const updatedReport = { id: REPORT_ID, status: "reviewed" }
    const mockSingle = vi.fn().mockResolvedValue({ data: updatedReport, error: null })
    const mockSelect = vi.fn().mockReturnValue({ single: mockSingle })
    const mockEq = vi.fn().mockReturnValue({ select: mockSelect })
    const mockUpdate = vi.fn().mockReturnValue({ eq: mockEq })
    vi.mocked(supabase.from).mockReturnValue({ update: mockUpdate } as never)

    const res = await app.inject({
      method: "PATCH", url: `/v1/admin/gallery-reports/${REPORT_ID}`,
      payload: { status: "reviewed", userId: "admin-1" },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().data.status).toBe("reviewed")
  })

  it("returns 500 on DB error", async () => {
    const mockSingle = vi.fn().mockResolvedValue({ data: null, error: { code: "OTHER", message: "DB error" } })
    const mockSelect = vi.fn().mockReturnValue({ single: mockSingle })
    const mockEq = vi.fn().mockReturnValue({ select: mockSelect })
    const mockUpdate = vi.fn().mockReturnValue({ eq: mockEq })
    vi.mocked(supabase.from).mockReturnValue({ update: mockUpdate } as never)

    const res = await app.inject({
      method: "PATCH", url: `/v1/admin/gallery-reports/${REPORT_ID}`,
      payload: { status: "dismissed", userId: "admin-1" },
    })
    expect(res.statusCode).toBe(500)
  })
})
