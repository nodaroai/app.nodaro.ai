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
          { url: "https://example.com/ref-front.png", kind: "front" },
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

  it("returns 500 when job insert fails on the first job", async () => {
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
