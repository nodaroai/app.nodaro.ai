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

import { workflowCostRoutes } from "../workflow-costs.js"
import { supabase } from "../../lib/supabase.js"

// ---------------------------------------------------------------------------
// Test app setup
// ---------------------------------------------------------------------------

const TEST_USER_ID = "00000000-0000-4000-8000-000000000001"

let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()

  app = Fastify({ logger: false })

  // Bypass auth — set userId from request body for protected routes
  app.addHook("preHandler", async (req) => {
    const body = req.body as Record<string, unknown> | undefined
    if (body?.userId && typeof body.userId === "string") {
      req.userId = body.userId
      req.userRole = undefined
    }
  })

  await app.register(async (instance) => {
    await workflowCostRoutes(instance)
  })

  await app.ready()
})

afterEach(async () => {
  await app.close()
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /v1/jobs/cost-summary", () => {
  it("returns 400 for empty jobIds array", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/jobs/cost-summary",
      payload: { jobIds: [], userId: TEST_USER_ID },
    })

    expect(res.statusCode).toBe(400)
    const body = res.json()
    expect(body.error.code).toBe("validation_error")
  })

  it("returns 400 for >500 jobIds", async () => {
    const jobIds = Array.from({ length: 501 }, (_, i) => `job-${i}`)

    const res = await app.inject({
      method: "POST",
      url: "/v1/jobs/cost-summary",
      payload: { jobIds, userId: TEST_USER_ID },
    })

    expect(res.statusCode).toBe(400)
    const body = res.json()
    expect(body.error.code).toBe("validation_error")
  })

  it("returns 401 when unauthenticated (IDOR fix — never queries jobs without an owner)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/jobs/cost-summary",
      payload: { jobIds: ["job-1"] }, // no userId → preHandler leaves req.userId unset
    })
    expect(res.statusCode).toBe(401)
    expect(supabase.from).not.toHaveBeenCalled()
  })

  it("returns aggregated breakdown for completed jobs", async () => {
    const mockJobs = [
      {
        id: "job-1",
        status: "completed",
        input_data: { type: "generate-image", provider: "nano-banana" },
        provider_cost: 0.02,
        display_cost: 0.025,
        credits: 4,
      },
      {
        id: "job-2",
        status: "completed",
        input_data: { type: "generate-image", provider: "nano-banana" },
        provider_cost: 0.02,
        display_cost: 0.025,
        credits: 4,
      },
    ]

    // Non-admin path appends .eq("user_id", ...) after .in (owner-scoping / IDOR fix).
    const mockEq = vi.fn().mockResolvedValue({ data: mockJobs, error: null })
    const mockIn = vi.fn().mockReturnValue({ eq: mockEq })
    const mockSelect = vi.fn().mockReturnValue({ in: mockIn })
    vi.mocked(supabase.from).mockReturnValue({ select: mockSelect } as never)

    const res = await app.inject({
      method: "POST",
      url: "/v1/jobs/cost-summary",
      payload: { jobIds: ["job-1", "job-2"], userId: TEST_USER_ID },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.data.total_credits).toBe(8)
    expect(body.data.total_jobs).toBe(2)
    expect(body.data.breakdown).toHaveLength(1)
    expect(body.data.breakdown[0].node_type).toBe("generate-image")
    expect(body.data.breakdown[0].model).toBe("nano-banana")
    expect(body.data.breakdown[0].runs).toBe(2)
    expect(body.data.breakdown[0].successful).toBe(2)
    expect(body.data.breakdown[0].avg_credits_per_run).toBe(4)
  })

  it("returns zeros for mix of completed and failed jobs", async () => {
    const mockJobs = [
      {
        id: "job-1",
        status: "completed",
        input_data: { type: "generate-image", provider: "flux" },
        provider_cost: 0.05,
        display_cost: 0.0625,
        credits: 10,
      },
      {
        id: "job-2",
        status: "failed",
        input_data: { type: "generate-image", provider: "flux" },
        provider_cost: null,
        display_cost: null,
        credits: 10,
      },
    ]

    // Non-admin path appends .eq("user_id", ...) after .in (owner-scoping / IDOR fix).
    const mockEq = vi.fn().mockResolvedValue({ data: mockJobs, error: null })
    const mockIn = vi.fn().mockReturnValue({ eq: mockEq })
    const mockSelect = vi.fn().mockReturnValue({ in: mockIn })
    vi.mocked(supabase.from).mockReturnValue({ select: mockSelect } as never)

    const res = await app.inject({
      method: "POST",
      url: "/v1/jobs/cost-summary",
      payload: { jobIds: ["job-1", "job-2"], userId: TEST_USER_ID },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.data.total_jobs).toBe(2)
    expect(body.data.breakdown[0].successful).toBe(1)
    expect(body.data.breakdown[0].failed).toBe(1)
  })

  it("returns 500 on DB error", async () => {
    const mockEq = vi.fn().mockResolvedValue({
      data: null,
      error: { message: "DB connection failed" },
    })
    const mockIn = vi.fn().mockReturnValue({ eq: mockEq })
    const mockSelect = vi.fn().mockReturnValue({ in: mockIn })
    vi.mocked(supabase.from).mockReturnValue({ select: mockSelect } as never)

    const res = await app.inject({
      method: "POST",
      url: "/v1/jobs/cost-summary",
      payload: { jobIds: ["job-1"], userId: TEST_USER_ID },
    })

    expect(res.statusCode).toBe(500)
    const body = res.json()
    expect(body.error.code).toBe("internal_error")
  })
})
