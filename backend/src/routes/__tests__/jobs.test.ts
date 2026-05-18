import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

// ---------------------------------------------------------------------------
// Mocks — hoisted before any route/lib import
// ---------------------------------------------------------------------------

let mockIsCloud = false

vi.mock("@/lib/config.js", () => ({
  config: { EDITION: "cloud" },
  isCloud: () => mockIsCloud,
  hasCredits: () => mockIsCloud,
  isCommunity: () => !mockIsCloud,
  isBusiness: () => false,
  hasAdmin: () => mockIsCloud,
}))

vi.mock("@/lib/supabase.js", () => {
  const mockFrom = vi.fn(() => ({
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: null, error: null }),
  }))
  return {
    supabase: { from: mockFrom },
  }
})

// ---------------------------------------------------------------------------
// Import under test (after mocks are declared)
// ---------------------------------------------------------------------------

import { jobRoutes, sanitizeJobForPublic, type JobRecord } from "../jobs.js"
import { supabase } from "../../lib/supabase.js"

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const sampleJob: JobRecord = {
  id: "job-1",
  status: "completed",
  progress: 100,
  input_data: { prompt: "test" },
  output_data: { url: "https://example.com/result.png" },
  error_message: null,
  created_at: "2024-01-01T00:00:00Z",
  started_at: "2024-01-01T00:00:01Z",
  completed_at: "2024-01-01T00:00:05Z",
  user_id: "user-1",
  provider: "nano-banana",
  provider_cost: 0.02,
  display_cost: 0.025,
  credits: 1,
  credits_actual: null,
  job_type: "generate-image",
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("sanitizeJobForPublic", () => {
  it("returns the full job unchanged for admin users", () => {
    const result = sanitizeJobForPublic(sampleJob, true)

    expect(result).toEqual(sampleJob)
    expect("provider" in result).toBe(true)
    expect("provider_cost" in result).toBe(true)
    expect("credits_actual" in result).toBe(true)
  })

  it("strips provider and ALL USD cost details for regular users", () => {
    const result = sanitizeJobForPublic(sampleJob, false)

    // Sensitive fields should be removed
    expect("provider" in result).toBe(false)
    expect("provider_cost" in result).toBe(false)
    expect("display_cost" in result).toBe(false)
    expect("credits_actual" in result).toBe(false)
    // Per the api-wide policy, USD `cost` (formerly renamed from
    // display_cost) is also gone. Non-admins see only `credits`.
    expect("cost" in result).toBe(false)

    // Other fields should be preserved
    expect(result.id).toBe("job-1")
    expect(result.status).toBe("completed")
    expect(result.credits).toBe(1)
  })

  it("preserves credits when display_cost is null", () => {
    const jobWithNullCost: JobRecord = {
      ...sampleJob,
      display_cost: null,
    }

    const result = sanitizeJobForPublic(jobWithNullCost, false)
    expect("cost" in result).toBe(false)
    expect("display_cost" in result).toBe(false)
    expect(result.credits).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// GET /v1/jobs/status — batch status endpoint for studio polling
// ---------------------------------------------------------------------------

const TEST_USER_ID = "00000000-0000-4000-8000-000000000001"
const OTHER_USER_ID = "00000000-0000-4000-8000-000000000002"

let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()
  app = Fastify({ logger: false })
  // Bypass auth — set userId from query for protected routes
  app.addHook("preHandler", async (req) => {
    const q = req.query as Record<string, string | undefined> | undefined
    if (q?.__userId) {
      req.userId = q.__userId
      req.userRole = undefined
    }
  })
  await app.register(async (instance) => {
    await jobRoutes(instance)
  })
  await app.ready()
})

afterEach(async () => {
  await app.close()
})

/**
 * Build a chainable "jobs" select().in().eq() mock that returns the given rows.
 * The route only filters with `.in("id", ids).eq("user_id", userId)`, and the
 * test mock applies the same filter to the seed rows so we can assert that
 * cross-user rows are scoped out.
 */
function seedJobs(rows: Array<{ id: string; user_id: string; status: string; output_data: unknown }>) {
  vi.mocked(supabase.from).mockImplementation((table: string) => {
    if (table !== "jobs") throw new Error(`Unexpected table "${table}"`)
    let capturedIds: string[] = []
    let capturedUserId: string | undefined
    const eq = vi.fn().mockImplementation((_col: string, val: string) => {
      capturedUserId = val
      const filtered = rows
        .filter((r) => capturedIds.includes(r.id) && r.user_id === capturedUserId)
        .map((r) => ({ id: r.id, status: r.status, output_data: r.output_data }))
      return Promise.resolve({ data: filtered, error: null })
    })
    const inFn = vi.fn().mockImplementation((_col: string, ids: string[]) => {
      capturedIds = ids
      return { eq }
    })
    const select = vi.fn().mockReturnValue({ in: inFn })
    return { select } as never
  })
}

describe("GET /v1/jobs/status", () => {
  it("returns status + output_data for caller-owned ids", async () => {
    seedJobs([
      { id: "job-a", user_id: TEST_USER_ID, status: "completed", output_data: { url: "a" } },
      { id: "job-b", user_id: TEST_USER_ID, status: "processing", output_data: null },
      { id: "job-c", user_id: TEST_USER_ID, status: "completed", output_data: { url: "c" } },
    ])

    const res = await app.inject({
      method: "GET",
      url: `/v1/jobs/status?ids=job-a,job-b,job-c&__userId=${TEST_USER_ID}`,
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.jobs).toHaveLength(3)
    const ids = body.jobs.map((j: { id: string }) => j.id).sort()
    expect(ids).toEqual(["job-a", "job-b", "job-c"])
    const a = body.jobs.find((j: { id: string }) => j.id === "job-a")
    expect(a.status).toBe("completed")
    expect(a.output_data).toEqual({ url: "a" })
  })

  it("scopes by user_id — cross-user jobs are NOT in response", async () => {
    seedJobs([
      { id: "job-a", user_id: TEST_USER_ID, status: "completed", output_data: { url: "a" } },
      { id: "stolen", user_id: OTHER_USER_ID, status: "completed", output_data: { secret: "leak" } },
    ])

    const res = await app.inject({
      method: "GET",
      url: `/v1/jobs/status?ids=job-a,stolen&__userId=${TEST_USER_ID}`,
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.jobs.map((j: { id: string }) => j.id)).toEqual(["job-a"])
  })

  it("silently omits non-existent ids (no 404)", async () => {
    seedJobs([
      { id: "job-a", user_id: TEST_USER_ID, status: "completed", output_data: null },
    ])

    const res = await app.inject({
      method: "GET",
      url: `/v1/jobs/status?ids=job-a,does-not-exist&__userId=${TEST_USER_ID}`,
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.jobs.map((j: { id: string }) => j.id)).toEqual(["job-a"])
  })

  it("returns { jobs: [] } when ids is empty string", async () => {
    seedJobs([])

    const res = await app.inject({
      method: "GET",
      url: `/v1/jobs/status?ids=&__userId=${TEST_USER_ID}`,
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ jobs: [] })
  })

  it("returns 400 too_many_ids when ids count > 100", async () => {
    seedJobs([])
    const tooMany = Array.from({ length: 101 }, (_, i) => `id-${i}`).join(",")

    const res = await app.inject({
      method: "GET",
      url: `/v1/jobs/status?ids=${tooMany}&__userId=${TEST_USER_ID}`,
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("too_many_ids")
  })

  it("returns 400 when ids query param is missing", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/jobs/status?__userId=${TEST_USER_ID}`,
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("invalid_query")
  })

  it("returns 401 when no userId", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/jobs/status?ids=job-a`,
    })

    expect(res.statusCode).toBe(401)
    expect(res.json().error.code).toBe("unauthorized")
  })
})
