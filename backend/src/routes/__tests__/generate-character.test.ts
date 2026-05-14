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
    creditsReserved: 6,
    watermark: false,
  }),
}))

// Mock the dynamic import path the route uses to load CreditsService for
// rollback refunds. The route does `await import("../ee/services/credits.js")`
// in the mid-batch failure path; this mock intercepts that lazy load.
const mockRefundCredits = vi.fn().mockResolvedValue(undefined)
vi.mock("@/ee/services/credits.js", () => ({
  CreditsService: { refundCredits: mockRefundCredits },
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

import { generateCharacterRoutes } from "../generate-character.js"
import { supabase } from "../../lib/supabase.js"
import { videoQueue } from "../../lib/queue.js"
import { reserveCreditsForJob } from "../../middleware/credit-guard.js"

// ---------------------------------------------------------------------------
// Test app setup
// ---------------------------------------------------------------------------

const TEST_USER_ID = "00000000-0000-4000-8000-000000000001"
const TEST_CHARACTER_ID = "00000000-0000-4000-8000-000000000099"

let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()
  app = Fastify({ logger: false })
  // Bypass auth — set userId from header
  app.addHook("preHandler", async (req) => {
    const header = req.headers["x-user-id"]
    if (typeof header === "string") req.userId = header
  })
  await app.register(async (instance) => {
    await generateCharacterRoutes(instance)
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
 *
 * Also supports `.delete().in("id", [...])` for rollback paths — the same
 * `from()` value carries both `.insert(...)` and `.delete()` shapes, which
 * mirrors how Supabase chains work in the real client.
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
  // `.delete().in("id", [...])` returns a thenable that resolves to { error: null }
  const inFn = vi.fn().mockResolvedValue({ error: null })
  const del = vi.fn().mockReturnValue({ in: inFn })
  return { insert, select, single, delete: del, in: inFn }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /v1/generate-character", () => {
  it("count=1 (default) returns { jobId, jobIds } dual shape — jobIds has length 1", async () => {
    const { insert } = mockJobsInsertChain()
    vi.mocked(supabase.from).mockReturnValue({ insert } as never)

    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-character",
      headers: { "x-user-id": TEST_USER_ID },
      payload: {
        name: "Kira",
        seedPrompt: "young woman, designer glasses",
        attachToCharacterId: TEST_CHARACTER_ID,
      },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.jobIds).toHaveLength(1)
    expect(body.jobId).toBe(body.jobIds[0])
    expect(insert).toHaveBeenCalledTimes(1)
    expect(videoQueue.add).toHaveBeenCalledTimes(1)
  })

  it("count=4 inserts 4 jobs and returns { jobId, jobIds } with length 4", async () => {
    const { insert } = mockJobsInsertChain()
    vi.mocked(supabase.from).mockReturnValue({ insert } as never)

    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-character",
      headers: { "x-user-id": TEST_USER_ID },
      payload: {
        name: "Kira",
        seedPrompt: "young woman",
        count: 4,
        attachToCharacterId: TEST_CHARACTER_ID,
      },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.jobIds).toHaveLength(4)
    expect(body.jobId).toBe(body.jobIds[0])
    expect(insert).toHaveBeenCalledTimes(4)
    expect(videoQueue.add).toHaveBeenCalledTimes(4)
  })

  it("count=2 returns jobIds length 2", async () => {
    const { insert } = mockJobsInsertChain()
    vi.mocked(supabase.from).mockReturnValue({ insert } as never)

    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-character",
      headers: { "x-user-id": TEST_USER_ID },
      payload: { name: "Kira", seedPrompt: "y w", count: 2 },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().jobIds).toHaveLength(2)
    expect(insert).toHaveBeenCalledTimes(2)
  })

  it("force_private: true on every inserted job (ignores body forcePrivate=false)", async () => {
    const { insert } = mockJobsInsertChain()
    vi.mocked(supabase.from).mockReturnValue({ insert } as never)

    await app.inject({
      method: "POST",
      url: "/v1/generate-character",
      headers: { "x-user-id": TEST_USER_ID },
      payload: {
        name: "Kira",
        seedPrompt: "y w",
        count: 2,
        forcePrivate: false, // route must ignore this and still set force_private: true
      },
    })

    expect(insert).toHaveBeenCalledTimes(2)
    for (const call of insert.mock.calls) {
      expect(call[0]).toEqual(expect.objectContaining({ force_private: true }))
    }
  })

  it("returns 400 when seedPrompt, referencePhotos, and description are all absent", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-character",
      headers: { "x-user-id": TEST_USER_ID },
      payload: { name: "Kira" },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
  })

  it("returns 400 for invalid count value (3)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-character",
      headers: { "x-user-id": TEST_USER_ID },
      payload: { name: "Kira", seedPrompt: "x", count: 3 },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
  })

  it("accepts referencePhotos (legacy seedPrompt absent)", async () => {
    const { insert } = mockJobsInsertChain()
    vi.mocked(supabase.from).mockReturnValue({ insert } as never)

    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-character",
      headers: { "x-user-id": TEST_USER_ID },
      payload: {
        name: "Kira",
        referencePhotos: [
          { url: "https://example.com/ref-front.png", kind: "frontFace" },
        ],
      },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().jobIds).toHaveLength(1)
  })

  it("accepts legacy description-only payload", async () => {
    const { insert } = mockJobsInsertChain()
    vi.mocked(supabase.from).mockReturnValue({ insert } as never)

    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-character",
      headers: { "x-user-id": TEST_USER_ID },
      payload: { name: "Kira", description: "tall woman with red hair" },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().jobIds).toHaveLength(1)
  })

  it("returns 401 when unauthenticated", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-character",
      payload: { name: "Kira", seedPrompt: "x" },
    })

    expect(res.statusCode).toBe(401)
    expect(res.json().error.code).toBe("unauthorized")
  })

  it("seedPrompt produces a portrait prompt with studio scaffolding", async () => {
    const { insert } = mockJobsInsertChain()
    vi.mocked(supabase.from).mockReturnValue({ insert } as never)

    await app.inject({
      method: "POST",
      url: "/v1/generate-character",
      headers: { "x-user-id": TEST_USER_ID },
      payload: { name: "Kira", seedPrompt: "young woman, glasses" },
    })

    const insertedPayload = insert.mock.calls[0][0] as { input_data: { prompt: string } }
    // Studio portrait scaffolding from buildPortraitPrompt
    expect(insertedPayload.input_data.prompt).toContain("young woman, glasses")
    expect(insertedPayload.input_data.prompt).toContain("studio lighting")
    expect(insertedPayload.input_data.prompt).toContain("plain background")
  })

  it("returns 500 when job insert fails on the first job (no credits reserved, no queue.add)", async () => {
    const single = vi.fn().mockResolvedValueOnce({ data: null, error: { message: "DB down" } })
    const select = vi.fn().mockReturnValue({ single })
    const insert = vi.fn().mockReturnValue({ select })
    vi.mocked(supabase.from).mockReturnValue({ insert } as never)

    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-character",
      headers: { "x-user-id": TEST_USER_ID },
      payload: { name: "Kira", seedPrompt: "x" },
    })

    expect(res.statusCode).toBe(500)
    expect(res.json().error.code).toBe("internal_error")
    // No credits reserved and nothing enqueued when Phase 1 fails on job 0.
    expect(videoQueue.add).not.toHaveBeenCalled()
    expect(vi.mocked(reserveCreditsForJob)).not.toHaveBeenCalled()
  })

  it("rollback on mid-batch insert failure (count=4, job 2 insert fails)", async () => {
    // Job 1 succeeds, job 2 fails — must delete the orphan job 1.
    const single = vi
      .fn()
      .mockResolvedValueOnce({ data: { id: "job-1" }, error: null })
      .mockResolvedValueOnce({ data: null, error: { message: "DB blip on job 2" } })
    const select = vi.fn().mockReturnValue({ single })
    const insert = vi.fn().mockReturnValue({ select })
    const inFn = vi.fn().mockResolvedValue({ error: null })
    const del = vi.fn().mockReturnValue({ in: inFn })
    vi.mocked(supabase.from).mockReturnValue({ insert, delete: del } as never)

    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-character",
      headers: { "x-user-id": TEST_USER_ID },
      payload: { name: "Kira", seedPrompt: "y w", count: 4 },
    })

    expect(res.statusCode).toBe(500)
    expect(res.json().error.code).toBe("internal_error")
    // Phase 1 cleanup: job-1 deleted, Phase 2 never reached.
    expect(del).toHaveBeenCalledTimes(1)
    expect(inFn).toHaveBeenCalledWith("id", ["job-1"])
    expect(videoQueue.add).not.toHaveBeenCalled()
    expect(vi.mocked(reserveCreditsForJob)).not.toHaveBeenCalled()
    expect(mockRefundCredits).not.toHaveBeenCalled()
  })

  it("rollback on mid-batch credit-reservation failure (count=4, job 2 reservation fails)", async () => {
    // Phase 1 inserts succeed for all 4 jobs; Phase 2A: reserveCredits succeeds for
    // job-1, then job-2's reservation fails (reply.sent set). Expect:
    //   - response = 402 from reserveCreditsForJob's mock
    //   - mockRefundCredits called once (job-1's log-1)
    //   - delete("id", ["job-3","job-4"]) — job-2 already deleted by reserveCreditsForJobImpl
    //   - videoQueue.add NEVER called (Phase 2B unreached)
    vi.mocked(reserveCreditsForJob)
      .mockResolvedValueOnce({ usageLogId: "log-1", creditsReserved: 6, watermark: false })
      .mockImplementationOnce(async (_req, reply) => {
        reply.status(402).send({ error: { code: "insufficient_credits" } })
        return undefined
      })

    const chain = mockJobsInsertChain()
    vi.mocked(supabase.from).mockReturnValue({
      insert: chain.insert,
      delete: chain.delete,
    } as never)

    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-character",
      headers: { "x-user-id": TEST_USER_ID },
      payload: { name: "Kira", seedPrompt: "y w", count: 4 },
    })

    expect(res.statusCode).toBe(402)
    expect(res.json().error.code).toBe("insufficient_credits")
    // All 4 jobs inserted, but only 2 reservation attempts.
    expect(chain.insert).toHaveBeenCalledTimes(4)
    expect(vi.mocked(reserveCreditsForJob)).toHaveBeenCalledTimes(2)
    // Refund the one reservation that succeeded.
    expect(mockRefundCredits).toHaveBeenCalledTimes(1)
    expect(mockRefundCredits).toHaveBeenCalledWith("log-1")
    // Orphan delete: jobs 3 & 4 (job-2 already deleted by reserveCreditsForJobImpl).
    expect(chain.delete).toHaveBeenCalledTimes(1)
    expect(chain.in).toHaveBeenCalledWith("id", ["job-3", "job-4"])
    // Critical: nothing enqueued — Phase 2B never reached.
    expect(videoQueue.add).not.toHaveBeenCalled()
  })

  it("enqueues videoQueue with provider, prompt, attachToCharacterId, usageLogId", async () => {
    const { insert } = mockJobsInsertChain()
    vi.mocked(supabase.from).mockReturnValue({ insert } as never)

    await app.inject({
      method: "POST",
      url: "/v1/generate-character",
      headers: { "x-user-id": TEST_USER_ID },
      payload: {
        name: "Kira",
        seedPrompt: "young woman",
        provider: "nano-banana-pro",
        attachToCharacterId: TEST_CHARACTER_ID,
      },
    })

    expect(videoQueue.add).toHaveBeenCalledWith(
      "generate-character",
      expect.objectContaining({
        jobId: "job-1",
        provider: "nano-banana-pro",
        attachToCharacterId: TEST_CHARACTER_ID,
        usageLogId: "log-1",
      }),
    )
  })
})
