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

vi.mock("@/lib/queue.js", () => ({
  videoQueue: {
    add: vi.fn().mockResolvedValue({ id: "queue-job-1" }),
    getJob: vi.fn(),
    remove: vi.fn(),
  },
  tryRemoveFromQueue: vi.fn().mockResolvedValue(undefined),
  redis: {},
}))

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

import { cancelJobsRoutes } from "../cancel-jobs.js"
import { supabase } from "../../lib/supabase.js"
import { tryRemoveFromQueue } from "../../lib/queue.js"

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
    await cancelJobsRoutes(instance)
  })

  await app.ready()
})

afterEach(async () => {
  await app.close()
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Mock the select chain: from("jobs").select(...).eq("id", jobId).single() */
function mockJobLookup(result: { data: unknown; error: unknown }) {
  const mockSingle = vi.fn().mockResolvedValue(result)
  const mockEq = vi.fn().mockReturnValue({ single: mockSingle })
  const mockSelect = vi.fn().mockReturnValue({ eq: mockEq })
  return { select: mockSelect, mockSingle }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /v1/jobs/:jobId/cancel", () => {
  it("returns 401 when no userId", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/jobs/job-1/cancel",
      payload: {},
    })

    expect(res.statusCode).toBe(401)
    const body = res.json()
    expect(body.error.code).toBe("unauthorized")
  })

  it("returns 404 when job not found", async () => {
    const chain = mockJobLookup({ data: null, error: { message: "not found" } })
    vi.mocked(supabase.from).mockReturnValue(chain as never)

    const res = await app.inject({
      method: "POST",
      url: "/v1/jobs/nonexistent-job/cancel",
      payload: { userId: TEST_USER_ID },
    })

    expect(res.statusCode).toBe(404)
    const body = res.json()
    expect(body.error.code).toBe("not_found")
  })

  it("returns 403 when job belongs to different user", async () => {
    const chain = mockJobLookup({
      data: { id: "job-1", status: "pending", user_id: "other-user-id", input_data: {}, output_data: {} },
      error: null,
    })
    vi.mocked(supabase.from).mockReturnValue(chain as never)

    const res = await app.inject({
      method: "POST",
      url: "/v1/jobs/job-1/cancel",
      payload: { userId: TEST_USER_ID },
    })

    expect(res.statusCode).toBe(403)
    const body = res.json()
    expect(body.error.code).toBe("forbidden")
  })

  it("returns 400 when job already completed", async () => {
    const chain = mockJobLookup({
      data: { id: "job-1", status: "completed", user_id: TEST_USER_ID, input_data: {}, output_data: {} },
      error: null,
    })
    vi.mocked(supabase.from).mockReturnValue(chain as never)

    const res = await app.inject({
      method: "POST",
      url: "/v1/jobs/job-1/cancel",
      payload: { userId: TEST_USER_ID },
    })

    expect(res.statusCode).toBe(400)
    const body = res.json()
    expect(body.error.code).toBe("invalid_status")
  })

  it("returns success and removes from queue for pending job", async () => {
    // Mock select chain for job lookup
    const selectChain = mockJobLookup({
      data: { id: "job-1", status: "pending", user_id: TEST_USER_ID, input_data: {}, output_data: {} },
      error: null,
    })

    // Mock update chain: from("jobs").update({...}).eq("id", jobId)
    const mockUpdateEq = vi.fn().mockResolvedValue({ error: null })
    const mockUpdate = vi.fn().mockReturnValue({ eq: mockUpdateEq })

    // Both select and update go through from("jobs"), so provide both
    vi.mocked(supabase.from).mockReturnValue({
      ...selectChain,
      update: mockUpdate,
    } as never)

    const res = await app.inject({
      method: "POST",
      url: "/v1/jobs/job-1/cancel",
      payload: { userId: TEST_USER_ID },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.success).toBe(true)
    expect(body.cancelled).toBe(1)

    // Verify queue removal was attempted
    expect(tryRemoveFromQueue).toHaveBeenCalledWith("job-1")
  })
})

describe("POST /v1/jobs/cancel-all", () => {
  it("returns 401 when no userId", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/jobs/cancel-all",
      payload: {},
    })

    expect(res.statusCode).toBe(401)
    const body = res.json()
    expect(body.error.code).toBe("unauthorized")
  })

  it("returns { cancelled: 0 } when no pending jobs", async () => {
    // Chain: from("jobs").select("id").eq("user_id", ...).in("status", [...])
    const mockIn = vi.fn().mockResolvedValue({ data: [], error: null })
    const mockEq = vi.fn().mockReturnValue({ in: mockIn })
    const mockSelect = vi.fn().mockReturnValue({ eq: mockEq })
    vi.mocked(supabase.from).mockReturnValue({ select: mockSelect } as never)

    const res = await app.inject({
      method: "POST",
      url: "/v1/jobs/cancel-all",
      payload: { userId: TEST_USER_ID },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.success).toBe(true)
    expect(body.cancelled).toBe(0)
  })

  it("cancels all pending jobs for user", async () => {
    // Mock select: from("jobs").select("id").eq("user_id", ...).in("status", [...])
    const mockIn = vi.fn().mockResolvedValue({
      data: [{ id: "job-1" }, { id: "job-2" }],
      error: null,
    })
    const mockEq = vi.fn().mockReturnValue({ in: mockIn })
    const mockSelect = vi.fn().mockReturnValue({ eq: mockEq })

    // Mock update: from("jobs").update({...}).in("id", [...])
    const mockUpdateIn = vi.fn().mockResolvedValue({ error: null })
    const mockUpdate = vi.fn().mockReturnValue({ in: mockUpdateIn })

    vi.mocked(supabase.from).mockReturnValue({
      select: mockSelect,
      update: mockUpdate,
    } as never)

    const res = await app.inject({
      method: "POST",
      url: "/v1/jobs/cancel-all",
      payload: { userId: TEST_USER_ID },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.success).toBe(true)
    expect(body.cancelled).toBe(2)

    // Verify queue removal was attempted for each job
    expect(tryRemoveFromQueue).toHaveBeenCalledWith("job-1")
    expect(tryRemoveFromQueue).toHaveBeenCalledWith("job-2")
  })
})
