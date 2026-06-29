import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

// ---------------------------------------------------------------------------
// Mocks — hoisted before any route import
// ---------------------------------------------------------------------------

const hoisted = vi.hoisted(() => ({
  // Captures the model identifier each creditGuard() preHandler is created with.
  creditGuardIds: [] as string[],
  reserveMock: vi.fn(),
  queueAddMock: vi.fn(),
  // Captures the exact payload passed to jobs.insert() so we can assert it
  // contains only real `jobs` columns — regression: a bogus top-level
  // `model_identifier` column errored the real insert → 500 on prod.
  jobsInsertArg: undefined as Record<string, unknown> | undefined,
}))

vi.mock("@/lib/supabase.js", () => {
  const mockFrom = vi.fn()
  return { supabase: { from: mockFrom } }
})

vi.mock("@/lib/video-director-queue.js", () => ({
  videoDirectorQueue: { add: hoisted.queueAddMock },
}))

vi.mock("@/middleware/credit-guard.js", () => ({
  // creditGuard is invoked at route-registration time with a model resolver.
  // We record the resolved id so the test can assert the route reserves
  // against "video-director", and return a no-op preHandler.
  creditGuard: (resolver: (req: unknown) => string) => {
    hoisted.creditGuardIds.push(resolver({} as never))
    return async () => {}
  },
  reserveCreditsForJob: hoisted.reserveMock,
}))

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { videoDirectorRoutes } from "../video-director.js"
import { supabase } from "../../lib/supabase.js"

// ---------------------------------------------------------------------------
// Test app setup
// ---------------------------------------------------------------------------

const TEST_USER_ID = "00000000-0000-4000-8000-000000000001"

let app: FastifyInstance

/** Mock the two `.from()` calls the route makes: profiles (tier lookup) and
 *  jobs (insert → select → single). */
function mockDb(jobId: string, tier = "pro") {
  vi.mocked(supabase.from).mockImplementation((table: string) => {
    if (table === "profiles") {
      return {
        select: () => ({
          eq: () => ({ single: vi.fn().mockResolvedValue({ data: { tier }, error: null }) }),
        }),
      } as never
    }
    // jobs
    return {
      insert: (payload: Record<string, unknown>) => {
        hoisted.jobsInsertArg = payload
        return {
          select: () => ({ single: vi.fn().mockResolvedValue({ data: { id: jobId }, error: null }) }),
        }
      },
    } as never
  })
}

beforeEach(async () => {
  vi.clearAllMocks()
  hoisted.creditGuardIds.length = 0
  hoisted.reserveMock.mockResolvedValue({ usageLogId: "usage-1", creditsReserved: 8, watermark: false })
  hoisted.queueAddMock.mockResolvedValue({ id: "q-1" })

  app = Fastify({ logger: false })
  // Bypass auth — set userId from request body (mirrors internal-secret path).
  app.addHook("preHandler", async (req) => {
    const body = req.body as Record<string, unknown> | undefined
    if (body?.userId && typeof body.userId === "string") req.userId = body.userId
  })
  await app.register(async (instance) => {
    await videoDirectorRoutes(instance)
  })
  await app.ready()
})

afterEach(async () => {
  await app.close()
})

// ---------------------------------------------------------------------------
// Tests — POST /v1/video-director/run
// ---------------------------------------------------------------------------

describe("POST /v1/video-director/run", () => {
  it("wires creditGuard with the video-director identifier", () => {
    expect(hoisted.creditGuardIds).toContain("video-director")
  })

  it("returns 400 on an invalid genre", async () => {
    mockDb("job-1")
    const res = await app.inject({
      method: "POST",
      url: "/v1/video-director/run",
      payload: { genre: "nope", brief: "x", userId: TEST_USER_ID },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
  })

  it("returns 400 on an empty brief", async () => {
    mockDb("job-1")
    const res = await app.inject({
      method: "POST",
      url: "/v1/video-director/run",
      payload: { genre: "explainer", brief: "", userId: TEST_USER_ID },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
  })

  it("returns 401 when no userId is resolved", async () => {
    mockDb("job-1")
    const res = await app.inject({
      method: "POST",
      url: "/v1/video-director/run",
      payload: { genre: "explainer", brief: "x" },
    })
    expect(res.statusCode).toBe(401)
    expect(res.json().error.code).toBe("unauthorized")
  })

  it("creates a job, reserves video-director credits, enqueues the director queue, returns jobId", async () => {
    mockDb("job-vd-1", "pro")

    const res = await app.inject({
      method: "POST",
      url: "/v1/video-director/run",
      payload: { genre: "explainer", brief: "How DNS works", userId: TEST_USER_ID, mcp_client: "Claude" },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().jobId).toBe("job-vd-1")

    // jobs insert happened
    expect(vi.mocked(supabase.from)).toHaveBeenCalledWith("jobs")

    // REGRESSION (prod 500): the insert payload must contain only real `jobs`
    // columns. `jobs` has NO `model_identifier` column — inserting one errors
    // the insert and returns 500. The model id lives in input_data + is passed
    // to reserveCreditsForJob; it must NOT be a top-level insert field.
    expect(hoisted.jobsInsertArg).toBeDefined()
    expect(hoisted.jobsInsertArg).not.toHaveProperty("model_identifier")
    expect(hoisted.jobsInsertArg).toMatchObject({ user_id: TEST_USER_ID, status: "pending" })
    expect(hoisted.jobsInsertArg?.input_data).toBeDefined()

    // reserved against the "video-director" identifier (what the worker later
    // commits/refunds against by jobId)
    expect(hoisted.reserveMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "job-vd-1",
      "video-director",
    )

    // enqueued with the worker payload contract { jobId, genre, brief, userId, tier }
    expect(hoisted.queueAddMock).toHaveBeenCalledWith(
      "video-director",
      expect.objectContaining({
        jobId: "job-vd-1",
        genre: "explainer",
        brief: "How DNS works",
        userId: TEST_USER_ID,
        tier: "pro",
      }),
    )
  })

  it("does not enqueue when the credit reservation already sent a reply (dedup race)", async () => {
    mockDb("job-vd-2")
    // Simulate reserveCreditsForJob short-circuiting the response.
    hoisted.reserveMock.mockImplementation(async (_req: unknown, reply: { sent: boolean; code: (n: number) => { send: (b: unknown) => void } }) => {
      reply.sent = true
      return undefined
    })

    const res = await app.inject({
      method: "POST",
      url: "/v1/video-director/run",
      payload: { genre: "product-launch", brief: "A smart bottle", userId: TEST_USER_ID },
    })

    // reply was sent by the reservation path; the route must not enqueue.
    expect(hoisted.queueAddMock).not.toHaveBeenCalled()
    // Fastify default when handler returns undefined after reply.sent: 200 with no body asserted here.
    void res
  })
})
