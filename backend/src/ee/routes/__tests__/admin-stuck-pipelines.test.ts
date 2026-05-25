import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

vi.mock("@/lib/supabase.js", () => {
  const mockFrom = vi.fn()
  return { supabase: { from: mockFrom } }
})

vi.mock("@/lib/config.js", () => ({
  config: {
    EDITION: "cloud",
    SUPABASE_URL: "https://test.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "test",
  },
  isCloud: () => true,
  hasCredits: () => true,
  isCommunity: () => false,
  isBusiness: () => false,
  hasAdmin: () => true,
}))

vi.mock("@/ee/middleware/require-admin.js", () => ({
  requireAdmin: async () => {},
}))

import { adminStuckPipelinesRoutes } from "../admin-stuck-pipelines.js"
import { supabase } from "../../../lib/supabase.js"

let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    const header = req.headers["x-user-id"]
    if (header && typeof header === "string") {
      req.userId = header
    }
  })
  await app.register(async (instance) => {
    await adminStuckPipelinesRoutes(instance)
  })
  await app.ready()
})

afterEach(async () => {
  await app.close()
})

function buildSelectChainReturning(rows: unknown[], error: unknown = null) {
  const mockLimit = vi.fn().mockResolvedValue({ data: rows, error })
  const mockOrder = vi.fn().mockReturnValue({ limit: mockLimit })
  const mockLt = vi.fn().mockReturnValue({ order: mockOrder })
  const mockEq = vi.fn().mockReturnValue({ lt: mockLt })
  const mockSelect = vi.fn().mockReturnValue({ eq: mockEq })
  return { mockSelect, mockEq, mockLt, mockOrder, mockLimit }
}

describe("GET /v1/admin/stuck-pipelines", () => {
  it("returns stuck pipelines with computed stuck-for minutes", async () => {
    const twoHoursAgo = new Date(Date.now() - 120 * 60_000).toISOString()
    const row = {
      id: "00000000-0000-4000-8000-000000000aaa",
      user_id: "00000000-0000-4000-8000-000000000bbb",
      status: "running",
      current_stage: "characters",
      mode: "manual",
      reserved_credits: 63,
      spent_credits: 12,
      created_at: twoHoursAgo,
      updated_at: twoHoursAgo,
      failure_reason: null,
    }
    const { mockSelect, mockEq, mockLt } = buildSelectChainReturning([row])
    vi.mocked(supabase.from).mockReturnValue({ select: mockSelect } as never)

    const res = await app.inject({
      method: "GET",
      url: "/v1/admin/stuck-pipelines",
      headers: { "x-user-id": "00000000-0000-4000-8000-000000000001" },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.data).toHaveLength(1)
    expect(body.data[0].pipelineId).toBe(row.id)
    expect(body.data[0].currentStage).toBe("characters")
    expect(body.data[0].mode).toBe("manual")
    expect(body.data[0].reservedCredits).toBe(63)
    expect(body.data[0].spentCredits).toBe(12)
    // 120 ± 1 min tolerance for the test/asserter clock drift.
    expect(body.data[0].stuckForMinutes).toBeGreaterThanOrEqual(119)
    expect(body.data[0].stuckForMinutes).toBeLessThanOrEqual(121)

    // Filter chain — only status=running rows past the cutoff.
    expect(mockEq).toHaveBeenCalledWith("status", "running")
    const ltCall = mockLt.mock.calls[0]
    expect(ltCall[0]).toBe("updated_at")
    // Default cutoff 30 min — cutoff ISO is roughly now-30min.
    const cutoffMs = new Date(ltCall[1]).getTime()
    expect(Date.now() - cutoffMs).toBeGreaterThan(29 * 60_000)
    expect(Date.now() - cutoffMs).toBeLessThan(31 * 60_000)
  })

  it("uses olderThanMinutes query param to widen/narrow the cutoff", async () => {
    const { mockSelect, mockLt } = buildSelectChainReturning([])
    vi.mocked(supabase.from).mockReturnValue({ select: mockSelect } as never)

    const res = await app.inject({
      method: "GET",
      url: "/v1/admin/stuck-pipelines?olderThanMinutes=60&limit=10",
      headers: { "x-user-id": "00000000-0000-4000-8000-000000000001" },
    })

    expect(res.statusCode).toBe(200)
    const cutoffMs = new Date(mockLt.mock.calls[0][1]).getTime()
    expect(Date.now() - cutoffMs).toBeGreaterThan(59 * 60_000)
    expect(Date.now() - cutoffMs).toBeLessThan(61 * 60_000)
    expect(res.json().olderThanMinutes).toBe(60)
  })

  it("rejects an invalid olderThanMinutes with 400", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/admin/stuck-pipelines?olderThanMinutes=0",
      headers: { "x-user-id": "00000000-0000-4000-8000-000000000001" },
    })
    expect(res.statusCode).toBe(400)
  })

  it("returns 500 on supabase error", async () => {
    const { mockSelect } = buildSelectChainReturning([], { message: "db boom" })
    vi.mocked(supabase.from).mockReturnValue({ select: mockSelect } as never)

    const res = await app.inject({
      method: "GET",
      url: "/v1/admin/stuck-pipelines",
      headers: { "x-user-id": "00000000-0000-4000-8000-000000000001" },
    })
    expect(res.statusCode).toBe(500)
    expect(res.json().error.code).toBe("internal_error")
  })

  it("returns empty data when no pipelines stuck", async () => {
    const { mockSelect } = buildSelectChainReturning([])
    vi.mocked(supabase.from).mockReturnValue({ select: mockSelect } as never)

    const res = await app.inject({
      method: "GET",
      url: "/v1/admin/stuck-pipelines",
      headers: { "x-user-id": "00000000-0000-4000-8000-000000000001" },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.data).toEqual([])
    expect(body.total).toBe(0)
  })
})
