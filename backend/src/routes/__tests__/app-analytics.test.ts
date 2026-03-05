import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
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
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "user-123" } },
          error: null,
        }),
      },
    },
  }
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

vi.mock("@/lib/admin-check.js", () => ({
  warmAdminCache: vi.fn(),
  checkIsAdmin: vi.fn().mockResolvedValue(false),
}))

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { appAnalyticsRoutes } from "../app-analytics.js"
import { supabase } from "../../lib/supabase.js"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_USER_ID = "00000000-0000-4000-8000-000000000001"
const OTHER_USER_ID = "00000000-0000-4000-8000-000000000099"
const TEST_APP_ID = "00000000-0000-4000-8000-000000000010"

/**
 * Build a mock chain for: supabase.from("published_apps").select(...).eq("id", appId).single()
 */
function buildPublishedAppsMock(result: { data: unknown; error: unknown }) {
  const mockSingle = vi.fn().mockResolvedValue(result)
  const mockEq = vi.fn().mockReturnValue({ single: mockSingle })
  const mockSelect = vi.fn().mockReturnValue({ eq: mockEq })
  return { select: mockSelect }
}

/**
 * Build a mock chain for: supabase.from("app_analytics").select(...).eq("app_id", ...).order(...)
 */
function buildAnalyticsMock(result: { data: unknown; error: unknown }) {
  const mockOrder = vi.fn().mockResolvedValue(result)
  const mockEq = vi.fn().mockReturnValue({ order: mockOrder })
  const mockSelect = vi.fn().mockReturnValue({ eq: mockEq })
  return { select: mockSelect }
}

/**
 * Build a mock chain for: supabase.from("app_runs").select(...).eq("app_id", ...).order(...).limit(...)
 */
function buildRunsMock(result: { data: unknown; error: unknown }) {
  const mockLimit = vi.fn().mockResolvedValue(result)
  const mockOrder = vi.fn().mockReturnValue({ limit: mockLimit })
  const mockEq = vi.fn().mockReturnValue({ order: mockOrder })
  const mockSelect = vi.fn().mockReturnValue({ eq: mockEq })
  return { select: mockSelect }
}

let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()

  app = Fastify({ logger: false })

  // Bypass auth — set userId from header
  app.addHook("preHandler", async (req) => {
    const header = req.headers["x-user-id"]
    if (header && typeof header === "string") {
      req.userId = header
      req.userRole = undefined
    }
  })

  await app.register(async (instance) => {
    await appAnalyticsRoutes(instance)
  })

  await app.ready()
})

afterEach(async () => {
  await app.close()
})

// ---------------------------------------------------------------------------
// GET /v1/apps/:appId/analytics
// ---------------------------------------------------------------------------

describe("GET /v1/apps/:appId/analytics", () => {
  it("returns 401 when no auth", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/apps/${TEST_APP_ID}/analytics`,
    })
    expect(res.statusCode).toBe(401)
  })

  it("returns 400 for invalid UUID", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/apps/not-a-uuid/analytics",
      headers: { "x-user-id": TEST_USER_ID },
    })
    expect(res.statusCode).toBe(400)
  })

  it("returns 404 when app not found", async () => {
    vi.mocked(supabase.from).mockReturnValue(
      buildPublishedAppsMock({
        data: null,
        error: { code: "PGRST116", message: "not found" },
      }) as never
    )

    const res = await app.inject({
      method: "GET",
      url: `/v1/apps/${TEST_APP_ID}/analytics`,
      headers: { "x-user-id": TEST_USER_ID },
    })
    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe("not_found")
  })

  it("returns 403 when not creator", async () => {
    vi.mocked(supabase.from).mockReturnValue(
      buildPublishedAppsMock({
        data: { id: TEST_APP_ID, creator_id: OTHER_USER_ID },
        error: null,
      }) as never
    )

    const res = await app.inject({
      method: "GET",
      url: `/v1/apps/${TEST_APP_ID}/analytics`,
      headers: { "x-user-id": TEST_USER_ID },
    })
    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe("forbidden")
  })

  it("returns 200 with aggregated analytics", async () => {
    const today = new Date()
    today.setUTCHours(0, 0, 0, 0)
    const todayStr = today.toISOString().split("T")[0]

    const d3 = new Date(today)
    d3.setUTCDate(d3.getUTCDate() - 3)
    const d3Str = d3.toISOString().split("T")[0]

    const d10 = new Date(today)
    d10.setUTCDate(d10.getUTCDate() - 10)
    const d10Str = d10.toISOString().split("T")[0]

    const d60 = new Date(today)
    d60.setUTCDate(d60.getUTCDate() - 60)
    const d60Str = d60.toISOString().split("T")[0]

    const analyticsRows = [
      { date: todayStr, total_runs: 5, unique_runners: 3, total_credits: 10, successful_runs: 4, failed_runs: 1 },
      { date: d3Str, total_runs: 10, unique_runners: 7, total_credits: 20, successful_runs: 8, failed_runs: 2 },
      { date: d10Str, total_runs: 15, unique_runners: 12, total_credits: 30, successful_runs: 13, failed_runs: 2 },
      { date: d60Str, total_runs: 20, unique_runners: 18, total_credits: 40, successful_runs: 17, failed_runs: 3 },
    ]

    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === "published_apps") {
        return buildPublishedAppsMock({
          data: { id: TEST_APP_ID, creator_id: TEST_USER_ID },
          error: null,
        }) as never
      }
      if (table === "app_analytics") {
        return buildAnalyticsMock({
          data: analyticsRows,
          error: null,
        }) as never
      }
      return {} as never
    })

    const res = await app.inject({
      method: "GET",
      url: `/v1/apps/${TEST_APP_ID}/analytics`,
      headers: { "x-user-id": TEST_USER_ID },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()

    // today: only todayStr row
    expect(body.today.totalRuns).toBe(5)
    expect(body.today.uniqueRunners).toBe(3)
    expect(body.today.totalCredits).toBe(10)
    expect(body.today.successfulRuns).toBe(4)
    expect(body.today.failedRuns).toBe(1)

    // last7Days: todayStr + d3Str
    expect(body.last7Days.totalRuns).toBe(15)
    expect(body.last7Days.uniqueRunners).toBe(10)
    expect(body.last7Days.totalCredits).toBe(30)
    expect(body.last7Days.successfulRuns).toBe(12)
    expect(body.last7Days.failedRuns).toBe(3)

    // last30Days: todayStr + d3Str + d10Str
    expect(body.last30Days.totalRuns).toBe(30)
    expect(body.last30Days.uniqueRunners).toBe(22)
    expect(body.last30Days.totalCredits).toBe(60)
    expect(body.last30Days.successfulRuns).toBe(25)
    expect(body.last30Days.failedRuns).toBe(5)

    // allTime: all 4 rows
    expect(body.allTime.totalRuns).toBe(50)
    expect(body.allTime.uniqueRunners).toBe(40)
    expect(body.allTime.totalCredits).toBe(100)
    expect(body.allTime.successfulRuns).toBe(42)
    expect(body.allTime.failedRuns).toBe(8)

    // daily: returns up to 30 rows in camelCase
    expect(body.daily).toHaveLength(4)
    expect(body.daily[0]).toEqual({
      date: todayStr,
      totalRuns: 5,
      uniqueRunners: 3,
      totalCredits: 10,
      successfulRuns: 4,
      failedRuns: 1,
    })
  })
})

// ---------------------------------------------------------------------------
// GET /v1/apps/:appId/analytics/runs
// ---------------------------------------------------------------------------

describe("GET /v1/apps/:appId/analytics/runs", () => {
  it("returns 401 when no auth", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/apps/${TEST_APP_ID}/analytics/runs`,
    })
    expect(res.statusCode).toBe(401)
  })

  it("returns 404 when app not found", async () => {
    vi.mocked(supabase.from).mockReturnValue(
      buildPublishedAppsMock({
        data: null,
        error: { code: "PGRST116", message: "not found" },
      }) as never
    )

    const res = await app.inject({
      method: "GET",
      url: `/v1/apps/${TEST_APP_ID}/analytics/runs`,
      headers: { "x-user-id": TEST_USER_ID },
    })
    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe("not_found")
  })

  it("returns 403 when not creator", async () => {
    vi.mocked(supabase.from).mockReturnValue(
      buildPublishedAppsMock({
        data: { id: TEST_APP_ID, creator_id: OTHER_USER_ID },
        error: null,
      }) as never
    )

    const res = await app.inject({
      method: "GET",
      url: `/v1/apps/${TEST_APP_ID}/analytics/runs`,
      headers: { "x-user-id": TEST_USER_ID },
    })
    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe("forbidden")
  })

  it("returns 200 with paginated run data", async () => {
    const runRows = [
      {
        id: "00000000-0000-4000-8000-000000000051",
        runner_id: "00000000-0000-4000-8000-000000000002",
        credits_used: 5,
        created_at: "2026-03-05T12:00:00Z",
        workflow_executions: {
          status: "completed",
          completed_nodes: 3,
          total_nodes: 3,
          completed_at: "2026-03-05T12:05:00Z",
        },
      },
      {
        id: "00000000-0000-4000-8000-000000000052",
        runner_id: "00000000-0000-4000-8000-000000000003",
        credits_used: 10,
        created_at: "2026-03-05T11:00:00Z",
        workflow_executions: {
          status: "failed",
          completed_nodes: 1,
          total_nodes: 3,
          completed_at: null,
        },
      },
    ]

    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === "published_apps") {
        return buildPublishedAppsMock({
          data: { id: TEST_APP_ID, creator_id: TEST_USER_ID },
          error: null,
        }) as never
      }
      if (table === "app_runs") {
        return buildRunsMock({
          data: runRows,
          error: null,
        }) as never
      }
      return {} as never
    })

    const res = await app.inject({
      method: "GET",
      url: `/v1/apps/${TEST_APP_ID}/analytics/runs?limit=20`,
      headers: { "x-user-id": TEST_USER_ID },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.data).toHaveLength(2)
    expect(body.nextCursor).toBeNull()

    expect(body.data[0]).toEqual({
      id: "00000000-0000-4000-8000-000000000051",
      runnerId: "00000000-0000-4000-8000-000000000002",
      creditsUsed: 5,
      createdAt: "2026-03-05T12:00:00Z",
      status: "completed",
      completedNodes: 3,
      totalNodes: 3,
      completedAt: "2026-03-05T12:05:00Z",
    })

    expect(body.data[1]).toEqual({
      id: "00000000-0000-4000-8000-000000000052",
      runnerId: "00000000-0000-4000-8000-000000000003",
      creditsUsed: 10,
      createdAt: "2026-03-05T11:00:00Z",
      status: "failed",
      completedNodes: 1,
      totalNodes: 3,
      completedAt: null,
    })
  })
})
