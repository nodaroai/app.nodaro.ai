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

  it("passes error_hint through for non-admin callers — user-safe by construction (PR9)", () => {
    const withHint = {
      ...sampleJob,
      error_hint: { kind: "safety-block", class: "safety", retried: true, suggestedProvider: "nano-banana-pro" },
    } as JobRecord
    const regular = sanitizeJobForPublic(withHint, false) as unknown as Record<string, unknown>
    const admin = sanitizeJobForPublic(withHint, true) as unknown as Record<string, unknown>
    expect(regular.error_hint).toEqual({
      kind: "safety-block",
      class: "safety",
      retried: true,
      suggestedProvider: "nano-banana-pro",
    })
    expect(admin.error_hint).toEqual(regular.error_hint)
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
  error_hint?: unknown
  usage_log_id?: string | null
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
 *
 * `usageLogStatuses` (id -> status) backs the route's follow-up
 * `usage_logs` lookup for `credit_status` — omit it (or a job's
 * `usage_log_id`) to exercise the "no usage log" -> null path.
 */
function seedJobs(rows: SeedJob[], usageLogStatuses: Record<string, string> = {}) {
  capturedSelect = []
  vi.mocked(supabase.from).mockImplementation((table: string) => {
    if (table === "usage_logs") {
      return {
        select: vi.fn().mockReturnValue({
          in: vi.fn().mockImplementation((_col: string, ids: string[]) => {
            const data = ids
              .filter((id) => id in usageLogStatuses)
              .map((id) => ({ id, status: usageLogStatuses[id] }))
            return Promise.resolve({ data, error: null })
          }),
        }),
      } as never
    }
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

  it("carries error_hint (PR9 migration 376) so a safety-block failure is machine-readable", async () => {
    seedJobs([
      {
        id: "job-a",
        user_id: TEST_USER_ID,
        status: "failed",
        output_data: null,
        error_message: "The provider's safety filter blocked this output.",
        error_hint: { kind: "safety-block", class: "safety", retried: true, suggestedProvider: "nano-banana-pro" },
      },
    ])

    const res = await app.inject({
      method: "GET",
      url: `/v1/jobs/status?ids=job-a&__userId=${TEST_USER_ID}`,
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().jobs[0].error_hint).toEqual({
      kind: "safety-block",
      class: "safety",
      retried: true,
      suggestedProvider: "nano-banana-pro",
    })
  })

  it("derives credit_status from usage_logs.status, one extra query for every id in the response", async () => {
    seedJobs(
      [
        { id: "job-a", user_id: TEST_USER_ID, status: "failed", output_data: null, usage_log_id: "ul-a" },
        { id: "job-b", user_id: TEST_USER_ID, status: "completed", output_data: null, usage_log_id: "ul-b" },
        { id: "job-c", user_id: TEST_USER_ID, status: "queued", output_data: null },
      ],
      { "ul-a": "refunded", "ul-b": "committed" },
    )

    const res = await app.inject({
      method: "GET",
      url: `/v1/jobs/status?ids=job-a,job-b,job-c&__userId=${TEST_USER_ID}`,
    })

    expect(res.statusCode).toBe(200)
    const byId = Object.fromEntries(
      res.json().jobs.map((j: { id: string; credit_status: unknown }) => [j.id, j.credit_status]),
    )
    expect(byId).toEqual({ "job-a": "refunded", "job-b": "committed", "job-c": null })
    // The raw usage_log_id never leaks — only the derived status.
    expect(JSON.stringify(res.json())).not.toContain("usage_log_id")
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

    expect(capturedSelect).toEqual([
      "id", "status", "progress", "output_data", "error_message", "error_hint", "usage_log_id",
    ])
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

  it("carries error_hint and derives credit_status from usage_logs.status", async () => {
    const row = {
      id: "job-a",
      user_id: TEST_USER_ID,
      status: "failed",
      progress: 0,
      output_data: null,
      error_message: "The provider's safety filter blocked this output.",
      error_hint: { kind: "safety-block", class: "safety", retried: true },
      reconcile_attempts: 0,
      usage_log_id: "ul-a",
    }
    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === "usage_logs") {
        return {
          select: vi.fn().mockReturnValue({
            in: vi.fn().mockResolvedValue({ data: [{ id: "ul-a", status: "refunded" }], error: null }),
          }),
        } as never
      }
      // Chainable jobs mock — the route calls `.eq()` twice for a non-admin
      // caller (`.eq("id", id)` then `.eq("user_id", userId)`).
      const chain = {
        select: vi.fn(() => chain),
        eq: vi.fn(() => chain),
        single: vi.fn().mockResolvedValue({ data: row, error: null }),
      }
      return chain as never
    })

    const res = await app.inject({
      method: "GET",
      url: `/v1/jobs/job-a/status?__userId=${TEST_USER_ID}`,
    })

    expect(res.statusCode).toBe(200)
    const data = res.json().data
    expect(data.error_hint).toEqual({ kind: "safety-block", class: "safety", retried: true })
    expect(data.credit_status).toBe("refunded")
    expect(data).not.toHaveProperty("usage_log_id")
  })

  it("credit_status is null when the job has no usage_log_id", async () => {
    const row = {
      id: "job-b",
      user_id: TEST_USER_ID,
      status: "completed",
      progress: 100,
      output_data: null,
      error_message: null,
      reconcile_attempts: 0,
    }
    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === "usage_logs") throw new Error("must not query usage_logs with no usage_log_id")
      const chain = {
        select: vi.fn(() => chain),
        eq: vi.fn(() => chain),
        single: vi.fn().mockResolvedValue({ data: row, error: null }),
      }
      return chain as never
    })

    const res = await app.inject({
      method: "GET",
      url: `/v1/jobs/job-b/status?__userId=${TEST_USER_ID}`,
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().data.credit_status).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// GET /v1/jobs — durable per-character listing
// ---------------------------------------------------------------------------

/**
 * Chainable mock for the LIST route. Records every filter call so a test can
 * assert which predicates were applied, and resolves with the seeded rows.
 *
 * Pass `error` to resolve the PostgREST failure shape instead (`data: null`) —
 * that is the case the route used to swallow into an empty 200.
 */
function seedJobsList(rows: Array<Record<string, unknown>>, error: unknown = null) {
  const calls: Array<{ method: string; args: unknown[] }> = []
  vi.mocked(supabase.from).mockImplementation((table: string) => {
    if (table !== "jobs") throw new Error(`Unexpected table "${table}"`)
    const handler: ProxyHandler<Record<string, unknown>> = {
      get(_t, prop) {
        if (prop === "then") {
          return (resolve: (v: unknown) => void) =>
            resolve(error ? { data: null, error } : { data: rows, error: null })
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

/**
 * A jobs row as the LIST query returns it, with the `workflow_executions!left`
 * embed PostgREST attaches for a to-one FK (an object, or null when the job
 * belongs to no execution).
 */
function executionJob(
  id: string,
  workflowExecutionId: string | null,
  isComponentExecution?: boolean,
) {
  return {
    id,
    status: "completed",
    progress: 100,
    input_data: { type: "generate-image" },
    output_data: { imageUrl: `https://r2/${id}.png` },
    error_message: null,
    created_at: `2026-09-04T00:00:0${id.slice(-1)}Z`,
    started_at: null,
    completed_at: null,
    user_id: TEST_USER_ID,
    credits: 1,
    job_type: "generate-image",
    workflow_execution_id: workflowExecutionId,
    workflow_executions:
      workflowExecutionId === null ? null : { is_component_execution: isComponentExecution ?? false },
  }
}

describe("GET /v1/jobs — component-execution exclusion", () => {
  it("is applied in code, never as a PostgREST or() over the embedded column", async () => {
    // The `.or(...)` this replaces named the embedded column as
    // `workflow_executions.is_component_execution` and could not parse
    // (PGRST100): inside or() the dot is the SEPARATOR, so an embedded path is
    // not a field at all. A reintroduced or() here is the bug coming back.
    const calls = seedJobsList([])

    const res = await app.inject({ method: "GET", url: `/v1/jobs?__userId=${TEST_USER_ID}` })

    expect(res.statusCode).toBe(200)
    expect(calls.filter((c) => c.method === "or")).toEqual([])
  })

  it("keeps jobs with no execution and non-component executions, drops the component ones", async () => {
    seedJobsList([
      executionJob("job-1", null),
      executionJob("job-2", "exec-a", false),
      executionJob("job-3", "exec-b", true),
    ])

    const res = await app.inject({ method: "GET", url: `/v1/jobs?__userId=${TEST_USER_ID}` })

    expect(res.statusCode).toBe(200)
    const data = res.json().data as Array<Record<string, unknown>>
    expect(data.map((j) => j.id)).toEqual(["job-1", "job-2"])
    // The embed is a filtering detail — it never reaches the wire, and neither
    // does the id it was joined on (outside both key allowlists).
    expect(data[0]).not.toHaveProperty("workflow_executions")
    expect(data[0]).not.toHaveProperty("workflow_execution_id")
  })

  it("reads a one-element array embed the same as an object", async () => {
    const asArray = (job: ReturnType<typeof executionJob>) => ({
      ...job,
      workflow_executions: job.workflow_executions ? [job.workflow_executions] : [],
    })
    seedJobsList([asArray(executionJob("job-1", "exec-a", false)), asArray(executionJob("job-2", "exec-b", true))])

    const res = await app.inject({ method: "GET", url: `/v1/jobs?__userId=${TEST_USER_ID}` })

    expect(res.statusCode).toBe(200)
    expect((res.json().data as Array<{ id: string }>).map((j) => j.id)).toEqual(["job-1"])
  })

  it("pages off the RAW last row, so a page shortened by the exclusion still advances", async () => {
    // Two rows came back for limit=2 — a FULL page — but one is excluded. The
    // cursor must still be the raw last row's created_at, or the next call
    // re-reads the excluded tail forever.
    seedJobsList([executionJob("job-1", null), executionJob("job-2", "exec-b", true)])

    const res = await app.inject({ method: "GET", url: `/v1/jobs?__userId=${TEST_USER_ID}&limit=2` })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.data.map((j: { id: string }) => j.id)).toEqual(["job-1"])
    expect(body.next).toBe("2026-09-04T00:00:02Z")
  })
})

describe("GET /v1/jobs — a failed query", () => {
  it("answers 500 instead of an empty list", async () => {
    // The list route read only `data`, so a failing query became `[]` and the
    // caller saw a healthy 200 with no rows — a user with jobs looked like a
    // user with none. Staging smoke: GET /v1/jobs?limit=3 -> 200, zero rows.
    seedJobsList([], { message: "boom" })

    const res = await app.inject({ method: "GET", url: `/v1/jobs?__userId=${TEST_USER_ID}` })

    expect(res.statusCode).toBe(500)
    expect(res.json()).toEqual({
      error: { code: "internal_error", message: "Failed to list jobs" },
    })
  })
})

describe("GET /v1/jobs — type / origin (client-app run lists)", () => {
  it("filters on the input_data JSONB paths, never the job_type column", async () => {
    const calls = seedJobsList([])

    const res = await app.inject({
      method: "GET",
      url: `/v1/jobs?__userId=${TEST_USER_ID}&type=llm-structured&origin=studio`,
    })

    expect(res.statusCode).toBe(200)
    expect(calls).toContainEqual({ method: "filter", args: ["input_data->>type", "eq", "llm-structured"] })
    expect(calls).toContainEqual({ method: "filter", args: ["input_data->>origin", "eq", "studio"] })
    // The column is null on every row a synchronous route inserted — a
    // column filter would hide exactly the history a run list exists to show.
    expect(calls.filter((c) => c.method === "eq" && c.args[0] === "job_type")).toEqual([])
  })

  it("applies each filter independently and none when absent", async () => {
    const originOnly = seedJobsList([])
    await app.inject({ method: "GET", url: `/v1/jobs?__userId=${TEST_USER_ID}&origin=studio` })
    expect(originOnly.filter((c) => c.method === "filter")).toEqual([
      { method: "filter", args: ["input_data->>origin", "eq", "studio"] },
    ])

    const none = seedJobsList([])
    await app.inject({ method: "GET", url: `/v1/jobs?__userId=${TEST_USER_ID}` })
    expect(none.filter((c) => c.method === "filter")).toEqual([])
  })
})

describe("GET /v1/jobs/:id — job_type", () => {
  it("selects job_type (allowlisted and typed in the SDK, previously never selected)", async () => {
    let selected = ""
    vi.mocked(supabase.from).mockImplementation(() => {
      const chain = {
        select: vi.fn((cols: string) => { selected = cols; return chain }),
        eq: vi.fn(() => chain),
        single: vi.fn().mockResolvedValue({ data: { ...sampleJob, user_id: TEST_USER_ID }, error: null }),
      }
      return chain as never
    })

    const res = await app.inject({ method: "GET", url: `/v1/jobs/job-1?__userId=${TEST_USER_ID}` })

    expect(res.statusCode).toBe(200)
    expect(selected.split(",").map((s) => s.trim())).toContain("job_type")
    expect(res.json().data.job_type).toBe("generate-image")
  })
})

/**
 * A held job over the wire (spec D6, D14).
 *
 * Two things are being proved at once, and both would be silent failures:
 *  - `pending_review` passes the response schema, because routes/jobs.ts
 *    derives its z.enum from JOB_STATUSES. A hand-rolled enum here would 500 on
 *    every GET of a held job — the owner's canvas would see an API error
 *    instead of "awaiting review".
 *  - not one `held_*` key reaches the caller, admin or not. The columns are on
 *    neither key list and in none of the five explicit selects, so this is a
 *    property of the schema, not of eleven readers remembering.
 */
describe("GET /v1/jobs/:id — a job held for review", () => {
  const heldRow = {
    ...sampleJob,
    status: "pending_review",
    output_data: null,
    held_output_data: { imageUrl: "https://cdn.example.com/images/job-1.png" },
    held_completion_fields: { provider: "kie", provider_cost: 0.4, metered: true },
    held_objects: [{ key: "images/job-1.png", kind: "image", index: 0 }],
    held_at: "2026-09-03T10:00:00Z",
  }

  it("returns 200 with status pending_review and no withheld payload", async () => {
    let selected = ""
    vi.mocked(supabase.from).mockImplementation(() => {
      const chain = {
        select: vi.fn((cols: string) => { selected = cols; return chain }),
        eq: vi.fn(() => chain),
        single: vi.fn().mockResolvedValue({ data: { ...heldRow, user_id: TEST_USER_ID }, error: null }),
      }
      return chain as never
    })

    const res = await app.inject({ method: "GET", url: `/v1/jobs/job-1?__userId=${TEST_USER_ID}` })

    expect(res.statusCode).toBe(200)
    expect(res.json().data.status).toBe("pending_review")
    // the select never asks for them in the first place
    expect(selected).not.toContain("held_")
    expect(res.payload).not.toContain("held_")
    expect(res.payload).not.toContain("cdn.example.com")
  })
})

describe("GET /v1/jobs/:id — credit_status (PR9)", () => {
  it("returns credit_status: \"refunded\" when the job's usage log was refunded", async () => {
    const row = { ...sampleJob, user_id: TEST_USER_ID, usage_log_id: "ul-refunded" }
    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === "usage_logs") {
        return {
          select: vi.fn().mockReturnValue({
            in: vi.fn().mockResolvedValue({ data: [{ id: "ul-refunded", status: "refunded" }], error: null }),
          }),
        } as never
      }
      const chain = {
        select: vi.fn(() => chain),
        eq: vi.fn(() => chain),
        single: vi.fn().mockResolvedValue({ data: row, error: null }),
      }
      return chain as never
    })

    const res = await app.inject({ method: "GET", url: `/v1/jobs/job-1?__userId=${TEST_USER_ID}` })

    expect(res.statusCode).toBe(200)
    expect(res.json().data.credit_status).toBe("refunded")
  })

  it("returns credit_status: null when the job has no usage log", async () => {
    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === "usage_logs") throw new Error("must not query usage_logs with no usage_log_id")
      const chain = {
        select: vi.fn(() => chain),
        eq: vi.fn(() => chain),
        single: vi.fn().mockResolvedValue({ data: { ...sampleJob, user_id: TEST_USER_ID }, error: null }),
      }
      return chain as never
    })

    const res = await app.inject({ method: "GET", url: `/v1/jobs/job-1?__userId=${TEST_USER_ID}` })

    expect(res.statusCode).toBe(200)
    expect(res.json().data.credit_status).toBeNull()
  })

  it("never leaks the raw usage_log_id", async () => {
    const row = { ...sampleJob, user_id: TEST_USER_ID, usage_log_id: "ul-committed" }
    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === "usage_logs") {
        return {
          select: vi.fn().mockReturnValue({
            in: vi.fn().mockResolvedValue({ data: [{ id: "ul-committed", status: "committed" }], error: null }),
          }),
        } as never
      }
      const chain = {
        select: vi.fn(() => chain),
        eq: vi.fn(() => chain),
        single: vi.fn().mockResolvedValue({ data: row, error: null }),
      }
      return chain as never
    })

    const res = await app.inject({ method: "GET", url: `/v1/jobs/job-1?__userId=${TEST_USER_ID}` })

    expect(res.statusCode).toBe(200)
    expect(res.json().data).not.toHaveProperty("usage_log_id")
    expect(res.json().data.credit_status).toBe("committed")
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

  it("carries error_hint (PR9 migration 376)", async () => {
    seedJobs([
      {
        id: "job-a",
        user_id: TEST_USER_ID,
        status: "failed",
        output_data: null,
        error_message: "Blocked for copyright.",
        error_hint: { kind: "safety-block", class: "copyright", retried: false },
      },
    ])

    const res = await app.inject({
      method: "POST",
      url: `/v1/jobs/batch-status?__userId=${TEST_USER_ID}`,
      payload: { jobIds: ["job-a"] },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().data[0].error_hint).toEqual({ kind: "safety-block", class: "copyright", retried: false })
  })
})
