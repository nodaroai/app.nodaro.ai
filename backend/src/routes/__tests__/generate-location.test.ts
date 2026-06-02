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
  },
  redis: {},
}))

vi.mock("@/middleware/credit-guard.js", () => ({
  creditGuard: () => async () => undefined,
  reserveCreditsForJob: vi.fn().mockResolvedValue({
    usageLogId: "log-1",
    creditsReserved: 2,
    watermark: false,
  }),
}))

vi.mock("@/lib/admin-check.js", () => ({
  warmAdminCache: vi.fn(),
  checkIsAdmin: vi.fn().mockResolvedValue(false),
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

vi.mock("@/lib/url-validator.js", async () => {
  const { z } = await import("zod")
  return { safeUrlSchema: z.string().url() }
})

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { generateLocationRoutes } from "../generate-location.js"
import { supabase } from "../../lib/supabase.js"
import { videoQueue } from "../../lib/queue.js"

// ---------------------------------------------------------------------------
// Test app setup
// ---------------------------------------------------------------------------

const TEST_USER_ID = "00000000-0000-4000-8000-000000000001"
const TEST_LOCATION_ID = "00000000-0000-4000-8000-000000000077"

let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()
  app = Fastify({ logger: false })
  // Bypass auth — set userId from header.
  app.addHook("preHandler", async (req) => {
    const header = req.headers["x-user-id"]
    if (typeof header === "string") req.userId = header
  })
  await app.register(async (instance) => {
    await generateLocationRoutes(instance)
  })
  await app.ready()
})

afterEach(async () => {
  await app.close()
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a fresh `from("jobs").insert(...).select("id").single()` chain whose
 * `.single()` resolves with a different job id for each call (job-1, job-2, …).
 * Returns the top-level insert mock so tests can assert on payload + call count.
 */
function mockJobsInsertChain() {
  const single = vi
    .fn()
    .mockResolvedValueOnce({ data: { id: "job-1" }, error: null })
    .mockResolvedValueOnce({ data: { id: "job-2" }, error: null })
    .mockResolvedValueOnce({ data: { id: "job-3" }, error: null })
    .mockResolvedValueOnce({ data: { id: "job-4" }, error: null })
  const select = vi.fn().mockReturnValue({ single })
  const insert = vi.fn().mockReturnValue({ select })
  return { insert, select, single }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /v1/generate-location — multi-candidate (Task 10)", () => {
  it("count=1 (default) returns { jobId } single shape — backward compat", async () => {
    const { insert } = mockJobsInsertChain()
    vi.mocked(supabase.from).mockReturnValue({ insert } as never)

    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-location",
      headers: { "x-user-id": TEST_USER_ID },
      payload: { name: "Forest Glade" },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.jobId).toBe("job-1")
    expect(body.jobIds).toBeUndefined()
    expect(insert).toHaveBeenCalledTimes(1)
    expect(videoQueue.add).toHaveBeenCalledTimes(1)
  })

  it("count=4 inserts 4 jobs and returns { jobIds } with length 4", async () => {
    const { insert } = mockJobsInsertChain()
    vi.mocked(supabase.from).mockReturnValue({ insert } as never)

    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-location",
      headers: { "x-user-id": TEST_USER_ID },
      payload: { name: "Forest Glade", count: 4 },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.jobIds).toEqual(["job-1", "job-2", "job-3", "job-4"])
    // Multi-candidate shape: no single `jobId` field.
    expect(body.jobId).toBeUndefined()
    expect(insert).toHaveBeenCalledTimes(4)
    expect(videoQueue.add).toHaveBeenCalledTimes(4)
  })

  it("count=2 returns { jobIds } with length 2", async () => {
    const { insert } = mockJobsInsertChain()
    vi.mocked(supabase.from).mockReturnValue({ insert } as never)

    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-location",
      headers: { "x-user-id": TEST_USER_ID },
      payload: { name: "Forest Glade", count: 2 },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.jobIds).toEqual(["job-1", "job-2"])
    expect(body.jobId).toBeUndefined()
    expect(insert).toHaveBeenCalledTimes(2)
    expect(videoQueue.add).toHaveBeenCalledTimes(2)
  })

  it("count=1 + attachToLocationId — attach id IS in the job input_data", async () => {
    const { insert } = mockJobsInsertChain()
    vi.mocked(supabase.from).mockReturnValue({ insert } as never)

    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-location",
      headers: { "x-user-id": TEST_USER_ID },
      payload: {
        name: "Forest Glade",
        attachToLocationId: TEST_LOCATION_ID,
      },
    })

    expect(res.statusCode).toBe(200)
    expect(insert).toHaveBeenCalledTimes(1)
    const insertedPayload = insert.mock.calls[0][0] as { input_data: Record<string, unknown> }
    expect(insertedPayload.input_data.attachToLocationId).toBe(TEST_LOCATION_ID)
  })

  it("count=4 + attachToLocationId — none of the 4 jobs include attach id (must go through approval)", async () => {
    const { insert } = mockJobsInsertChain()
    vi.mocked(supabase.from).mockReturnValue({ insert } as never)

    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-location",
      headers: { "x-user-id": TEST_USER_ID },
      payload: {
        name: "Forest Glade",
        count: 4,
        attachToLocationId: TEST_LOCATION_ID,
      },
    })

    expect(res.statusCode).toBe(200)
    expect(insert).toHaveBeenCalledTimes(4)
    for (const call of insert.mock.calls) {
      const payload = call[0] as { input_data: Record<string, unknown> }
      expect(payload.input_data.attachToLocationId).toBeUndefined()
    }
  })

  it("count=2 + attachToLocationId — neither of the 2 jobs include attach id", async () => {
    const { insert } = mockJobsInsertChain()
    vi.mocked(supabase.from).mockReturnValue({ insert } as never)

    await app.inject({
      method: "POST",
      url: "/v1/generate-location",
      headers: { "x-user-id": TEST_USER_ID },
      payload: {
        name: "Forest Glade",
        count: 2,
        attachToLocationId: TEST_LOCATION_ID,
      },
    })

    expect(insert).toHaveBeenCalledTimes(2)
    for (const call of insert.mock.calls) {
      const payload = call[0] as { input_data: Record<string, unknown> }
      expect(payload.input_data.attachToLocationId).toBeUndefined()
    }
  })

  it("returns 400 for invalid count value (5)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-location",
      headers: { "x-user-id": TEST_USER_ID },
      // 1/2/3/4 are valid; 5 is out of range.
      payload: { name: "Forest Glade", count: 5 },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
  })

  it("returns 401 when unauthenticated", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-location",
      payload: { name: "Forest Glade" },
    })

    expect(res.statusCode).toBe(401)
    expect(res.json().error.code).toBe("unauthorized")
  })
})
