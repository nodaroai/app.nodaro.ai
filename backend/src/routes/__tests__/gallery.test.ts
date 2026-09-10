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

vi.mock("@/config/content-filter.js", () => ({
  isPromptBlocked: vi.fn().mockReturnValue(false),
}))

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { galleryRoutes } from "../gallery.js"
import { supabase } from "../../lib/supabase.js"
import { checkIsAdmin } from "../../lib/admin-check.js"

// ---------------------------------------------------------------------------
// Test app setup
// ---------------------------------------------------------------------------

const TEST_USER_ID = "00000000-0000-4000-8000-000000000001"

let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()

  app = Fastify({ logger: false })

  // Bypass auth — set userId from request body or query for protected routes.
  // An `x-user-id` header (when present) wins, so tests can simulate an
  // AUTHENTICATED caller different from the `?userId=` filter (cross-user).
  app.addHook("preHandler", async (req) => {
    const body = req.body as Record<string, unknown> | undefined
    const query = req.query as Record<string, unknown> | undefined
    const headerId = req.headers["x-user-id"]
    const userId = (typeof headerId === "string" && headerId) || body?.userId || query?.userId
    if (userId && typeof userId === "string") {
      req.userId = userId
      req.userRole = undefined
    }
  })

  await app.register(async (instance) => {
    await galleryRoutes(instance)
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
 * Create a self-chaining mock that resolves to the given result when awaited.
 * Every method call returns the same chainable object, and the final `.then()`
 * resolves with `result`. This handles arbitrary Supabase chain lengths.
 */
function createChainMock(result: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {}
  const handler: ProxyHandler<Record<string, unknown>> = {
    get(target, prop) {
      if (prop === "then") {
        return (resolve: (v: unknown) => void) => resolve(result)
      }
      // Every other property returns a function that returns the proxy
      return (..._args: unknown[]) => proxy
    },
  }
  const proxy = new Proxy(chain, handler)
  return proxy
}

/**
 * Like `createChainMock`, but records every method call + args so a test can
 * assert WHICH filters were applied (e.g. whether `.eq("is_public", true)`
 * was part of the chain). One recorder serves every `.from()` in the request.
 */
function createRecordingChainMock(result: { data: unknown; error: unknown }) {
  const calls: Array<{ method: string; args: unknown[] }> = []
  const handler: ProxyHandler<Record<string, unknown>> = {
    get(_target, prop) {
      if (prop === "then") {
        return (resolve: (v: unknown) => void) => resolve(result)
      }
      return (...args: unknown[]) => {
        calls.push({ method: String(prop), args })
        return proxy
      }
    },
  }
  const proxy = new Proxy({}, handler)
  return { proxy, calls }
}

// ---------------------------------------------------------------------------
// Tests — GET /v1/gallery
// ---------------------------------------------------------------------------

describe("GET /v1/gallery", () => {
  it("returns empty data array when no jobs exist", async () => {
    vi.mocked(supabase.from).mockReturnValue(
      createChainMock({ data: [], error: null }) as never
    )

    const res = await app.inject({
      method: "GET",
      url: "/v1/gallery",
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.data).toEqual([])
    expect(body.nextCursor).toBeNull()
  })

  it("returns correct response shape with gallery items", async () => {
    const mockJobs = [
      {
        id: "job-1",
        job_type: "generate-image",
        input_data: { prompt: "a sunset", provider: "nano-banana" },
        output_data: { imageUrl: "https://example.com/img.png" },
        completed_at: "2026-01-01T00:00:00Z",
        user_id: TEST_USER_ID,
        provider: "kie",
      },
    ]

    vi.mocked(supabase.from).mockReturnValue(
      createChainMock({ data: mockJobs, error: null }) as never
    )

    const res = await app.inject({
      method: "GET",
      url: "/v1/gallery",
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.data).toHaveLength(1)
    expect(body.data[0]).toHaveProperty("id", "job-1")
    expect(body.data[0]).toHaveProperty("type", "image")
    expect(body.data[0]).toHaveProperty("outputUrl", "https://example.com/img.png")
    expect(body.data[0]).toHaveProperty("prompt", "a sunset")
    expect(body.data[0]).toHaveProperty("model", "nano-banana")
  })

  it("returns type-filtered results for image type", async () => {
    vi.mocked(supabase.from).mockReturnValue(
      createChainMock({ data: [], error: null }) as never
    )

    const res = await app.inject({
      method: "GET",
      url: "/v1/gallery?type=image",
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.data).toEqual([])
    expect(supabase.from).toHaveBeenCalledWith("jobs")
  })

  it("limits results to max 50", async () => {
    vi.mocked(supabase.from).mockReturnValue(
      createChainMock({ data: [], error: null }) as never
    )

    const res = await app.inject({
      method: "GET",
      url: "/v1/gallery?limit=100",
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.data).toEqual([])
  })

  it("returns 500 when database query fails", async () => {
    vi.mocked(supabase.from).mockReturnValue(
      createChainMock({ data: null, error: { message: "DB error" } }) as never
    )

    const res = await app.inject({
      method: "GET",
      url: "/v1/gallery",
    })

    expect(res.statusCode).toBe(500)
  })
})

// ---------------------------------------------------------------------------
// Tests — POST /v1/gallery/report
// ---------------------------------------------------------------------------

describe("GET /v1/gallery — force_private is discovery-only, never owner-invisible", () => {
  const OTHER_USER_ID = "00000000-0000-4000-8000-000000000002"

  it("drops the is_public gate when the authenticated caller IS the requested user", async () => {
    // "My items only": the owner must see their own force_private outputs —
    // every other layer (/v1/jobs, RLS 032, MCP browse_gallery scope=mine)
    // already treats the flag as discovery-only.
    const rec = createRecordingChainMock({ data: [], error: null })
    vi.mocked(supabase.from).mockReturnValue(rec.proxy as never)

    const res = await app.inject({ method: "GET", url: `/v1/gallery?userId=${TEST_USER_ID}` })

    expect(res.statusCode).toBe(200)
    const isPublicFilters = rec.calls.filter((c) => c.method === "eq" && c.args[0] === "is_public")
    expect(isPublicFilters).toEqual([])
    const userScope = rec.calls.filter((c) => c.method === "eq" && c.args[0] === "user_id")
    expect(userScope.length).toBeGreaterThan(0)
  })

  it("keeps the public-only gate when a DIFFERENT authenticated user requests someone's items", async () => {
    const rec = createRecordingChainMock({ data: [], error: null })
    vi.mocked(supabase.from).mockReturnValue(rec.proxy as never)

    const res = await app.inject({
      method: "GET",
      url: `/v1/gallery?userId=${TEST_USER_ID}`,
      headers: { "x-user-id": OTHER_USER_ID },
    })

    expect(res.statusCode).toBe(200)
    const isPublicFilters = rec.calls.filter(
      (c) => c.method === "eq" && c.args[0] === "is_public" && c.args[1] === true,
    )
    expect(isPublicFilters.length).toBeGreaterThan(0)
  })

  it("keeps the public-only gate for the anonymous global gallery", async () => {
    const rec = createRecordingChainMock({ data: [], error: null })
    vi.mocked(supabase.from).mockReturnValue(rec.proxy as never)

    const res = await app.inject({ method: "GET", url: "/v1/gallery" })

    expect(res.statusCode).toBe(200)
    const isPublicFilters = rec.calls.filter(
      (c) => c.method === "eq" && c.args[0] === "is_public" && c.args[1] === true,
    )
    expect(isPublicFilters.length).toBeGreaterThan(0)
  })
})

describe("POST /v1/gallery/report", () => {
  it("returns 400 for invalid UUID", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/gallery/report",
      payload: {
        jobId: "not-a-uuid",
        reason: "spam",
      },
    })

    expect(res.statusCode).toBe(400)
    const body = res.json()
    expect(body.error.code).toBe("validation_error")
  })

  it("returns success on valid report", async () => {
    const validJobId = "00000000-0000-4000-8000-000000000002"
    const mockFrom = vi.mocked(supabase.from)

    let callCount = 0
    mockFrom.mockImplementation(() => {
      callCount++
      if (callCount === 1) {
        // Job lookup: from("jobs").select("id").eq().eq().eq().single()
        const chain: Record<string, unknown> = {}
        chain.select = vi.fn().mockReturnValue(chain)
        chain.eq = vi.fn().mockReturnValue(chain)
        chain.single = vi.fn().mockResolvedValue({ data: { id: validJobId }, error: null })
        return chain as never
      }
      if (callCount === 2) {
        // Duplicate check: from("gallery_reports").select("id").eq().eq().gte().limit()
        const chain: Record<string, unknown> = {}
        chain.select = vi.fn().mockReturnValue(chain)
        chain.eq = vi.fn().mockReturnValue(chain)
        chain.gte = vi.fn().mockReturnValue(chain)
        chain.limit = vi.fn().mockResolvedValue({ data: [], error: null })
        return chain as never
      }
      // Report insert: from("gallery_reports").insert({...})
      return { insert: vi.fn().mockResolvedValue({ error: null }) } as never
    })

    const res = await app.inject({
      method: "POST",
      url: "/v1/gallery/report",
      payload: {
        jobId: validJobId,
        reason: "spam",
      },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.success).toBe(true)
  })

  it("returns 404 when reported job does not exist", async () => {
    const validJobId = "00000000-0000-4000-8000-000000000099"

    vi.mocked(supabase.from).mockImplementation(() => {
      const chain: Record<string, unknown> = {}
      chain.select = vi.fn().mockReturnValue(chain)
      chain.eq = vi.fn().mockReturnValue(chain)
      chain.single = vi.fn().mockResolvedValue({ data: null, error: { message: "not found" } })
      return chain as never
    })

    const res = await app.inject({
      method: "POST",
      url: "/v1/gallery/report",
      payload: {
        jobId: validJobId,
        reason: "inappropriate",
      },
    })

    expect(res.statusCode).toBe(404)
    const body = res.json()
    expect(body.error.code).toBe("not_found")
  })
})

// ---------------------------------------------------------------------------
// Tests — DELETE /v1/gallery/:jobId
// ---------------------------------------------------------------------------

describe("DELETE /v1/gallery/:jobId", () => {
  it("returns 403 when not admin", async () => {
    const validJobId = "00000000-0000-4000-8000-000000000002"
    vi.mocked(checkIsAdmin).mockResolvedValue(false)

    const res = await app.inject({
      method: "DELETE",
      url: `/v1/gallery/${validJobId}?userId=${TEST_USER_ID}`,
    })

    expect(res.statusCode).toBe(403)
    const body = res.json()
    expect(body.error.code).toBe("forbidden")
  })

  it("returns success on admin delete", async () => {
    const validJobId = "00000000-0000-4000-8000-000000000002"
    vi.mocked(checkIsAdmin).mockResolvedValue(true)

    let callCount = 0
    vi.mocked(supabase.from).mockImplementation(() => {
      callCount++
      if (callCount === 1) {
        // Update jobs: from("jobs").update({is_public: false}).eq("id", jobId)
        const mockEq = vi.fn().mockResolvedValue({ error: null })
        return { update: vi.fn().mockReturnValue({ eq: mockEq }) } as never
      }
      // Update gallery_reports: from("gallery_reports").update({status: "reviewed"}).eq("job_id", ...).eq("status", "pending")
      const mockEq2 = vi.fn().mockResolvedValue({ error: null })
      const mockEq1 = vi.fn().mockReturnValue({ eq: mockEq2 })
      return { update: vi.fn().mockReturnValue({ eq: mockEq1 }) } as never
    })

    const res = await app.inject({
      method: "DELETE",
      url: `/v1/gallery/${validJobId}?userId=${TEST_USER_ID}`,
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.success).toBe(true)
  })

  it("returns 401 when not authenticated for delete", async () => {
    const validJobId = "00000000-0000-4000-8000-000000000002"

    const res = await app.inject({
      method: "DELETE",
      url: `/v1/gallery/${validJobId}`,
    })

    expect(res.statusCode).toBe(401)
    const body = res.json()
    expect(body.error.code).toBe("unauthorized")
  })
})

// ---------------------------------------------------------------------------
// The pickup-overwrite dependency, asserted from the gallery's own side.
//
// `jobs.job_type` is OVERWRITTEN with the BullMQ job name by the pickup CAS in
// `workers/video-worker.ts` (`job_type: job.name` — unconditional, not a
// backfill of a null column; `video-worker.test.ts` guards that write). This
// suite is the other half of the contract: it proves the gallery's allowlist is
// spelled in QUEUE-NAME vocabulary, so a DAG row inserted with
// `job_type = node.type` (`services/workflow-engine/node-executor.ts`) is
// reachable ONLY after that rewrite.
//
// If someone "fixes" the worker to preserve the inserted value, these three
// pairs are what breaks — silently, since a row that matches no allowlist entry
// is simply absent rather than an error. A production sample had 225 of 400
// completed DAG rows depending on the rewrite.
// ---------------------------------------------------------------------------

describe("GET /v1/gallery — job_type allowlist is QUEUE-NAME vocabulary", () => {
  /**
   * What `node-executor.ts` INSERTS vs what the worker picks the row up as.
   * The queue name is whatever `payload-builder.ts` dispatched under:
   *   modify-image   → image-to-image (and → edit-image on the gpt-image lane;
   *                    payload-builder has both branches and BOTH names are in
   *                    IMAGE_JOBS, so either pickup lands in the gallery)
   *   upscale-image  → edit-image
   *   generate-video → image-to-video (start frame wired) / text-to-video
   */
  const RENAMES = [
    { nodeType: "modify-image", queueName: "image-to-image" },
    { nodeType: "upscale-image", queueName: "edit-image" },
    { nodeType: "generate-video", queueName: "image-to-video" },
  ] as const

  /** Every `.in("job_type", […])` the route applied for this request — the
   *  count query and the page query each contribute one. */
  async function jobTypeAllowlists(url: string): Promise<string[][]> {
    const { proxy, calls } = createRecordingChainMock({ data: [], error: null })
    vi.mocked(supabase.from).mockReturnValue(proxy as never)

    const res = await app.inject({ method: "GET", url })
    expect(res.statusCode).toBe(200)

    const lists = calls
      .filter((c) => c.method === "in" && c.args[0] === "job_type")
      .map((c) => c.args[1] as string[])
    expect(
      lists.length,
      `GET ${url} applied no job_type allowlist at all — the gallery no longer filters on the column, so this suite can no longer protect the pickup-overwrite dependency. Re-point it at whatever replaced the filter.`,
    ).toBeGreaterThan(0)
    return lists
  }

  it("admits the PICKED-UP queue name and never the inserted DAG node type", async () => {
    const lists = await jobTypeAllowlists("/v1/gallery")

    for (const list of lists) {
      for (const { nodeType, queueName } of RENAMES) {
        expect(
          list,
          `The gallery allowlist is missing the queue name "${queueName}". DAG rows for the "${nodeType}" node are inserted with job_type="${nodeType}" and reach the gallery only because the pickup CAS in workers/video-worker.ts rewrites job_type to the BullMQ name "${queueName}". Drop "${queueName}" here and that output silently disappears from the gallery.`,
        ).toContain(queueName)
        expect(
          list,
          `The gallery allowlist contains the NODE type "${nodeType}". That string never survives on a completed jobs row: the pickup CAS in workers/video-worker.ts overwrites job_type with the BullMQ job name ("${queueName}"), so this entry matches nothing and reads as coverage the gallery does not have. Allowlist the QUEUE name instead.`,
        ).not.toContain(nodeType)
      }
    }
  })

  it("keeps the same vocabulary under ?type=image", async () => {
    const lists = await jobTypeAllowlists("/v1/gallery?type=image")
    for (const list of lists) {
      expect(list).toContain("image-to-image")
      expect(list).toContain("edit-image")
      expect(list).not.toContain("modify-image")
      expect(list).not.toContain("upscale-image")
    }
  })

  it("keeps the same vocabulary under ?type=video", async () => {
    const lists = await jobTypeAllowlists("/v1/gallery?type=video")
    for (const list of lists) {
      expect(list).toContain("image-to-video")
      expect(list).toContain("text-to-video")
      expect(list).not.toContain("generate-video")
    }
  })
})
