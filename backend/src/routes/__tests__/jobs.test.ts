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

vi.mock("@/lib/workflow-delete.js", () => ({
  deleteJobWithPrivateMedia: vi.fn(),
}))

// ---------------------------------------------------------------------------
// Import under test (after mocks are declared)
// ---------------------------------------------------------------------------

import { jobRoutes, sanitizeJobForPublic, type JobRecord } from "../jobs.js"
import { supabase } from "../../lib/supabase.js"
import { deleteJobWithPrivateMedia } from "../../lib/workflow-delete.js"

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
  error_detail: "task failed: [400] aspect_ratio 3:2 not allowed",
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("sanitizeJobForPublic", () => {
  it("returns the full job unchanged for admin users", () => {
    const result = sanitizeJobForPublic(sampleJob, true)

    expect(result).toEqual({ ...sampleJob })
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

  it("redacts private remux bases recursively even for administrators", () => {
    const sensitive = {
      ...sampleJob,
      input_data: {
        unscoredUrl: "https://private.example/child-base.mp4",
        requested: [{ unscoredUrl: "https://private.example/nested.mp4", gain: 35 }],
      },
      output_data: {
        pro: {
          unscoredUrl: "https://private.example/gvp-base.mp4",
          finalUrl: "https://public.example/final.mp4",
        },
      },
    }

    const admin = sanitizeJobForPublic(sensitive, true)
    const regular = sanitizeJobForPublic(sensitive, false)

    expect(JSON.stringify(admin)).not.toContain("unscoredUrl")
    expect(JSON.stringify(regular)).not.toContain("unscoredUrl")
    expect(admin.output_data).toEqual({
      pro: { finalUrl: "https://public.example/final.mp4" },
    })
    expect(regular.input_data).toEqual({ requested: [{ gain: 35 }] })
  })

  it("is an allowlist: unknown columns never reach any caller, error_detail reaches admins only", () => {
    const withExtra = { ...sampleJob, future_secret_column: "x" } as unknown as JobRecord
    const admin = sanitizeJobForPublic(withExtra, true) as unknown as Record<string, unknown>
    const regular = sanitizeJobForPublic(withExtra, false) as unknown as Record<string, unknown>

    expect("future_secret_column" in admin).toBe(false)
    expect("future_secret_column" in regular).toBe(false)
    expect(admin.error_detail).toBe("task failed: [400] aspect_ratio 3:2 not allowed")
    expect("error_detail" in regular).toBe(false)
  })

  it("admins keep input_data internals; regular users get them stripped (parity with the pre-allowlist code)", () => {
    const withInternals = {
      ...sampleJob,
      input_data: { prompt: "test", userId: "u-1", jobId: "j-1", usageLogId: "ul-1", force_private: true, provider: "nano-banana" },
    } as JobRecord
    const admin = sanitizeJobForPublic(withInternals, true) as unknown as { input_data: Record<string, unknown> }
    const regular = sanitizeJobForPublic(withInternals, false) as unknown as { input_data: Record<string, unknown> }
    expect(admin.input_data).toEqual(withInternals.input_data)
    expect(regular.input_data).toEqual({ prompt: "test" })
  })

  it("returns exactly the public key set for regular users", () => {
    const regular = sanitizeJobForPublic(sampleJob, false) as unknown as Record<string, unknown>
    expect(Object.keys(regular).sort()).toEqual(
      [
        "id", "status", "progress", "input_data", "output_data", "error_message",
        "created_at", "started_at", "completed_at", "user_id", "credits", "job_type",
      ].sort(),
    )
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
  vi.mocked(deleteJobWithPrivateMedia).mockResolvedValue(true)
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

describe("DELETE /v1/jobs/:id", () => {
  it("uses the atomic private-media cleanup boundary for an owner", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: "/v1/jobs/job-1?__userId=00000000-0000-4000-8000-000000000001",
    })

    expect(res.statusCode).toBe(200)
    expect(deleteJobWithPrivateMedia).toHaveBeenCalledWith(expect.objectContaining({
      jobId: "job-1",
      actorUserId: "00000000-0000-4000-8000-000000000001",
      isAdmin: false,
    }))
  })

  it("returns 500 when the atomic job delete fails", async () => {
    vi.mocked(deleteJobWithPrivateMedia).mockRejectedValue(new Error("database down"))

    const res = await app.inject({
      method: "DELETE",
      url: "/v1/jobs/job-1?__userId=00000000-0000-4000-8000-000000000001",
    })

    expect(res.statusCode).toBe(500)
  })
})

afterEach(async () => {
  await app.close()
})

interface SeedJob {
  id: string
  user_id: string
  status: string
  output_data: unknown
  progress?: number
  error_message?: string | null
}

/** The projection the route last asked Supabase for, as a column list. */
let capturedSelect: string[] = []

/**
 * Build a chainable "jobs" select().in().eq() mock that returns the given rows.
 * The route only filters with `.in("id", ids).eq("user_id", userId)`, and the
 * test mock applies the same filter to the seed rows so we can assert that
 * cross-user rows are scoped out.
 *
 * The mock PROJECTS to the columns the route actually selected, exactly as
 * PostgREST would. That matters: a mock that returns whole seed rows makes a
 * missing column invisible to every response assertion, which is precisely how
 * `progress` and `error_message` went missing from this endpoint unnoticed
 * while the tests stayed green.
 */
function seedJobs(rows: SeedJob[]) {
  capturedSelect = []
  vi.mocked(supabase.from).mockImplementation((table: string) => {
    if (table !== "jobs") throw new Error(`Unexpected table "${table}"`)
    let capturedIds: string[] = []
    let capturedUserId: string | undefined
    const eq = vi.fn().mockImplementation((_col: string, val: string) => {
      capturedUserId = val
      const filtered = rows
        .filter((r) => capturedIds.includes(r.id) && r.user_id === capturedUserId)
        .map((r) =>
          Object.fromEntries(
            capturedSelect
              .filter((col) => col in r)
              .map((col) => [col, r[col as keyof SeedJob]]),
          ),
        )
      return Promise.resolve({ data: filtered, error: null })
    })
    const inFn = vi.fn().mockImplementation((_col: string, ids: string[]) => {
      capturedIds = ids
      return { eq }
    })
    const select = vi.fn().mockImplementation((cols: string) => {
      capturedSelect = cols.split(",").map((c) => c.trim())
      return { in: inFn }
    })
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

  it("never projects a private remux base from output_data", async () => {
    seedJobs([
      {
        id: "job-a",
        user_id: TEST_USER_ID,
        status: "completed",
        output_data: {
          pro: {
            unscoredUrl: "https://private.example/base.mp4",
            finalUrl: "https://public.example/final.mp4",
          },
        },
      },
    ])

    const res = await app.inject({
      method: "GET",
      url: `/v1/jobs/status?ids=job-a&__userId=${TEST_USER_ID}`,
    })

    expect(res.statusCode).toBe(200)
    expect(JSON.stringify(res.json())).not.toContain("unscoredUrl")
    expect(res.json().jobs[0].output_data.pro.finalUrl).toBe("https://public.example/final.mp4")
  })

  it("reports per-job progress — a batch poller must see which jobs are MOVING", async () => {
    // Without this the only readable signal is "finished / not finished", so a
    // client watching 4 jobs shows four identical placeholders for two minutes
    // and cannot tell a job that is 90% done from one that has not started.
    seedJobs([
      { id: "job-a", user_id: TEST_USER_ID, status: "processing", output_data: null, progress: 72 },
      { id: "job-b", user_id: TEST_USER_ID, status: "processing", output_data: null, progress: 15 },
      { id: "job-c", user_id: TEST_USER_ID, status: "queued", output_data: null, progress: 0 },
    ])

    const res = await app.inject({
      method: "GET",
      url: `/v1/jobs/status?ids=job-a,job-b,job-c&__userId=${TEST_USER_ID}`,
    })

    expect(res.statusCode).toBe(200)
    const byId = Object.fromEntries(
      res.json().jobs.map((j: { id: string; progress?: number }) => [j.id, j.progress]),
    )
    expect(byId).toEqual({ "job-a": 72, "job-b": 15, "job-c": 0 })
  })

  it("reports error_message, so a failure says WHY rather than just 'failed'", async () => {
    seedJobs([
      {
        id: "job-a",
        user_id: TEST_USER_ID,
        status: "failed",
        output_data: null,
        error_message: "Provider rejected the prompt",
      },
    ])

    const res = await app.inject({
      method: "GET",
      url: `/v1/jobs/status?ids=job-a&__userId=${TEST_USER_ID}`,
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().jobs[0].error_message).toBe("Provider rejected the prompt")
  })

  it("asks Supabase for exactly the columns a poller needs, and no cost columns", async () => {
    // Pinned directly, because the projection is where the two fields above
    // were silently missing. Cost/provider columns stay out: this route does
    // no sanitization, so anything selected here is returned verbatim.
    seedJobs([{ id: "job-a", user_id: TEST_USER_ID, status: "queued", output_data: null }])
    await app.inject({
      method: "GET",
      url: `/v1/jobs/status?ids=job-a&__userId=${TEST_USER_ID}`,
    })

    expect(capturedSelect).toEqual(["id", "status", "progress", "output_data", "error_message"])
    for (const secret of ["provider_cost", "display_cost", "credits", "provider"]) {
      expect(capturedSelect).not.toContain(secret)
    }
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

describe("GET /v1/jobs/:id/status", () => {
  it("redacts private remux bases from the single-job status projection", async () => {
    const row = {
      id: "job-a",
      user_id: TEST_USER_ID,
      status: "completed",
      progress: 100,
      output_data: {
        pro: {
          unscoredUrl: "https://private.example/base.mp4",
          finalUrl: "https://public.example/final.mp4",
        },
      },
      error_message: null,
      reconcile_attempts: 0,
    }
    let chain: Record<string, unknown>
    chain = new Proxy({}, {
      get(_target, prop) {
        if (prop === "single") return vi.fn().mockResolvedValue({ data: row, error: null })
        return vi.fn().mockReturnValue(chain)
      },
    })
    vi.mocked(supabase.from).mockReturnValue(chain as never)

    const res = await app.inject({
      method: "GET",
      url: `/v1/jobs/job-a/status?__userId=${TEST_USER_ID}`,
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().data.output_data).toEqual({
      pro: { finalUrl: "https://public.example/final.mp4" },
    })
  })
})

// ---------------------------------------------------------------------------
// GET /v1/jobs — durable per-character listing
// ---------------------------------------------------------------------------

/**
 * Chainable mock for the LIST route. Records every filter call so a test can
 * assert which predicates were applied, and resolves with the seeded rows.
 */
function seedJobsList(rows: Array<Record<string, unknown>>) {
  const calls: Array<{ method: string; args: unknown[] }> = []
  vi.mocked(supabase.from).mockImplementation((table: string) => {
    if (table !== "jobs") throw new Error(`Unexpected table "${table}"`)
    const handler: ProxyHandler<Record<string, unknown>> = {
      get(_t, prop) {
        if (prop === "then") {
          return (resolve: (v: unknown) => void) => resolve({ data: rows, error: null })
        }
        return (...args: unknown[]) => {
          calls.push({ method: String(prop), args })
          return proxy
        }
      },
    }
    const proxy: Record<string, unknown> = new Proxy({}, handler)
    return proxy as never
  })
  return calls
}

const CHARACTER_ID = "00000000-0000-4000-8000-0000000000aa"

function characterJob(id: string, skipPortraitAttach?: boolean) {
  return {
    id,
    status: "completed",
    progress: 100,
    input_data: {
      type: "generate-character",
      attachToCharacterId: CHARACTER_ID,
      ...(skipPortraitAttach === undefined ? {} : { skipPortraitAttach }),
    },
    output_data: { imageUrl: `https://r2/${id}.png` },
    error_message: null,
    created_at: "2026-07-30T00:00:00Z",
    started_at: null,
    completed_at: "2026-07-30T00:00:05Z",
    user_id: TEST_USER_ID,
    credits: 2,
    job_type: "generate-character",
  }
}

describe("GET /v1/jobs — attachToCharacterId (durable per-character listing)", () => {
  it("filters by the character id via the input_data JSONB path", async () => {
    const calls = seedJobsList([])

    const res = await app.inject({
      method: "GET",
      url: `/v1/jobs?__userId=${TEST_USER_ID}&attachToCharacterId=${CHARACTER_ID}`,
    })

    expect(res.statusCode).toBe(200)
    expect(calls).toContainEqual({
      method: "filter",
      args: ["input_data->>attachToCharacterId", "eq", CHARACTER_ID],
    })
  })

  it("does NOT apply the filter when the param is absent (plain job list unchanged)", async () => {
    const calls = seedJobsList([])

    const res = await app.inject({ method: "GET", url: `/v1/jobs?__userId=${TEST_USER_ID}` })

    expect(res.statusCode).toBe(200)
    expect(calls.filter((c) => c.method === "filter")).toEqual([])
  })

  it("INCLUDES scene renders — this listing is the archive the portrait strip is not — and flags them", async () => {
    // The characters route deliberately hides skipPortraitAttach jobs so they
    // can never be promoted to the identity anchor; that left them with no
    // per-character path at all. They belong here, marked so a client renders
    // them without a promote affordance.
    seedJobsList([characterJob("job-portrait"), characterJob("job-scene", true)])

    const res = await app.inject({
      method: "GET",
      url: `/v1/jobs?__userId=${TEST_USER_ID}&attachToCharacterId=${CHARACTER_ID}`,
    })

    expect(res.statusCode).toBe(200)
    const data = res.json().data as Array<Record<string, unknown>>
    expect(data.map((j) => j.id)).toEqual(["job-portrait", "job-scene"])
    expect(data[0].isSceneRender).toBe(false)
    expect(data[1].isSceneRender).toBe(true)
  })

  it("omits isSceneRender entirely on an unfiltered list (no new field for existing callers)", async () => {
    seedJobsList([characterJob("job-1")])

    const res = await app.inject({ method: "GET", url: `/v1/jobs?__userId=${TEST_USER_ID}` })

    expect(res.statusCode).toBe(200)
    expect(res.json().data[0]).not.toHaveProperty("isSceneRender")
  })
})

describe("POST /v1/jobs/batch-status", () => {
  it("redacts private remux bases from the direct status projection", async () => {
    seedJobs([
      {
        id: "job-a",
        user_id: TEST_USER_ID,
        status: "completed",
        output_data: {
          unscoredUrl: "https://private.example/base.mp4",
          url: "https://public.example/final.mp4",
        },
      },
    ])

    const res = await app.inject({
      method: "POST",
      url: `/v1/jobs/batch-status?__userId=${TEST_USER_ID}`,
      payload: { jobIds: ["job-a"] },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().data[0].output_data).toEqual({ url: "https://public.example/final.mp4" })
  })
})
