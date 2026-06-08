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
    creditsReserved: 10,
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
  // Mirror the protocol gate of the real safeUrlSchema so cap-exceeding
  // and obvious bad-protocol cases get the same treatment as in prod.
  const safeUrlSchema = z
    .string()
    .url()
    .refine((url) => {
      try {
        const { protocol } = new URL(url)
        return protocol === "http:" || protocol === "https:"
      } catch {
        return false
      }
    })
  return { safeUrlSchema }
})

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { generateCreatureMotionRoutes } from "../generate-creature-motion.js"
import { supabase } from "../../lib/supabase.js"
import { videoQueue } from "../../lib/queue.js"
import { reserveCreditsForJob } from "../../middleware/credit-guard.js"

// ---------------------------------------------------------------------------
// Test app setup
// ---------------------------------------------------------------------------

const TEST_USER_ID = "00000000-0000-4000-8000-000000000001"
const TEST_CREATURE_ID = "00000000-0000-4000-8000-000000000088"
const SOURCE_URL = "https://example.com/creature-shot.png"

let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()
  vi.mocked(reserveCreditsForJob).mockResolvedValue({
    usageLogId: "log-1",
    creditsReserved: 10,
    watermark: false,
  } as never)

  app = Fastify({ logger: false })
  // Bypass auth — read userId from header so test cases can opt in/out.
  app.addHook("preHandler", async (req) => {
    const header = req.headers["x-user-id"]
    if (typeof header === "string") req.userId = header
  })
  await app.register(async (instance) => {
    await generateCreatureMotionRoutes(instance)
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
 * Build a chainable supabase mock that routes by table name.
 *   - "creatures" -> fetch chain returning the supplied row (or null for the
 *     "not found / cross-user / soft-deleted" cases)
 *   - "jobs"      -> insert chain returning job-1 by default
 */
function setupSupabaseMock(opts: {
  creatureRow?: { id: string } | null
  jobInsertResult?: { data: { id: string } | null; error: { message: string } | null }
}) {
  const creatureSingle = vi.fn().mockResolvedValue({
    data: opts.creatureRow ?? null,
    error: opts.creatureRow ? null : { message: "row not found" },
  })
  // creatures select chain:
  //   .select("id").eq("id", ...).eq("user_id", ...).is("deleted_at", null).single()
  const creatureIs = vi.fn().mockReturnValue({ single: creatureSingle })
  const creatureEq2 = vi.fn().mockReturnValue({ is: creatureIs })
  const creatureEq1 = vi.fn().mockReturnValue({ eq: creatureEq2 })
  const creatureSelect = vi.fn().mockReturnValue({ eq: creatureEq1 })

  const jobInsertResult = opts.jobInsertResult ?? { data: { id: "job-1" }, error: null }
  const jobSingle = vi.fn().mockResolvedValue(jobInsertResult)
  const jobSelect = vi.fn().mockReturnValue({ single: jobSingle })
  const jobInsert = vi.fn().mockReturnValue({ select: jobSelect })

  vi.mocked(supabase.from).mockImplementation((table: string) => {
    if (table === "creatures") return { select: creatureSelect } as never
    if (table === "jobs") return { insert: jobInsert } as never
    return {} as never
  })

  return { creatureSelect, creatureEq1, creatureEq2, creatureIs, creatureSingle, jobInsert, jobSelect, jobSingle }
}

function basePayload(extra: Record<string, unknown> = {}) {
  return {
    motionPrompt: "slow prowling walk across the frame",
    sourceImageUrl: SOURCE_URL,
    name: "Frost Fox",
    ...extra,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /v1/generate-creature-motion", () => {
  it("happy path: returns { jobId } and enqueues a video job (job name generate-creature-motion, motion_clips)", async () => {
    setupSupabaseMock({ creatureRow: { id: TEST_CREATURE_ID } })

    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-creature-motion",
      headers: { "x-user-id": TEST_USER_ID },
      payload: basePayload({
        attachToCreatureId: TEST_CREATURE_ID,
        attachName: "prowl",
      }),
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().jobId).toBe("job-1")
    expect(videoQueue.add).toHaveBeenCalledTimes(1)
    expect(videoQueue.add).toHaveBeenCalledWith(
      "generate-creature-motion",
      expect.objectContaining({
        jobId: "job-1",
        sourceImageUrl: SOURCE_URL,
        provider: "kling-turbo",
        attachToCreatureId: TEST_CREATURE_ID,
        attachToColumn: "motion_clips",
        attachName: "prowl",
        usageLogId: "log-1",
      }),
    )
  })

  it("returns 401 when unauthenticated", async () => {
    setupSupabaseMock({ creatureRow: { id: TEST_CREATURE_ID } })

    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-creature-motion",
      // intentionally no x-user-id header
      payload: basePayload(),
    })

    expect(res.statusCode).toBe(401)
    expect(res.json().error.code).toBe("unauthorized")
  })

  it("returns 404 not_found when attachToCreatureId is cross-user (or non-existent)", async () => {
    // creatureRow null + error -> ownership check fails. Uniform `"not_found"`
    // for cross-user / missing / soft-deleted to prevent ID enumeration.
    setupSupabaseMock({ creatureRow: null })

    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-creature-motion",
      headers: { "x-user-id": TEST_USER_ID },
      payload: basePayload({
        attachToCreatureId: TEST_CREATURE_ID,
        attachName: "prowl",
      }),
    })

    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe("not_found")
    expect(videoQueue.add).not.toHaveBeenCalled()
    // Ownership pre-check MUST happen BEFORE reserveCreditsForJob — verify
    // credits were never reserved.
    expect(vi.mocked(reserveCreditsForJob)).not.toHaveBeenCalled()
  })

  it("returns 404 not_found when target creature is soft-deleted (uniform code)", async () => {
    // Soft-deleted rows are filtered by `.is("deleted_at", null)` so the
    // mock's null row simulates "the row exists but is hidden by the filter".
    setupSupabaseMock({ creatureRow: null })

    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-creature-motion",
      headers: { "x-user-id": TEST_USER_ID },
      payload: basePayload({
        attachToCreatureId: TEST_CREATURE_ID,
        attachName: "prowl",
      }),
    })

    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe("not_found")
  })

  it("verifies the ownership query is scoped by user_id AND deleted_at IS NULL", async () => {
    const { creatureSelect, creatureEq1, creatureEq2, creatureIs } = setupSupabaseMock({
      creatureRow: { id: TEST_CREATURE_ID },
    })

    await app.inject({
      method: "POST",
      url: "/v1/generate-creature-motion",
      headers: { "x-user-id": TEST_USER_ID },
      payload: basePayload({
        attachToCreatureId: TEST_CREATURE_ID,
        attachName: "prowl",
      }),
    })

    // .select("id") -> .eq("id", creatureId) -> .eq("user_id", userId) -> .is("deleted_at", null)
    expect(creatureSelect).toHaveBeenCalled()
    expect(creatureEq1).toHaveBeenCalledWith("id", TEST_CREATURE_ID)
    expect(creatureEq2).toHaveBeenCalledWith("user_id", TEST_USER_ID)
    expect(creatureIs).toHaveBeenCalledWith("deleted_at", null)
  })

  it("returns 400 validation_error when provider is not in OBJECT_MOTION_PROVIDERS", async () => {
    setupSupabaseMock({ creatureRow: { id: TEST_CREATURE_ID } })

    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-creature-motion",
      headers: { "x-user-id": TEST_USER_ID },
      payload: basePayload({
        provider: "veo3", // not in OBJECT_MOTION_PROVIDERS
      }),
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
    expect(videoQueue.add).not.toHaveBeenCalled()
  })

  it("returns 400 validation_error when sourceImageUrl is missing (motion requires an i2v frame)", async () => {
    setupSupabaseMock({ creatureRow: { id: TEST_CREATURE_ID } })

    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-creature-motion",
      headers: { "x-user-id": TEST_USER_ID },
      payload: {
        // motionPrompt + name present, but no sourceImageUrl
        motionPrompt: "slow prowl",
        name: "Frost Fox",
      },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
    expect(videoQueue.add).not.toHaveBeenCalled()
  })

  it("force_private: true is hardcoded on the inserted job row (even when forcePrivate: false in body)", async () => {
    const { jobInsert } = setupSupabaseMock({ creatureRow: { id: TEST_CREATURE_ID } })

    await app.inject({
      method: "POST",
      url: "/v1/generate-creature-motion",
      headers: { "x-user-id": TEST_USER_ID },
      payload: basePayload({
        attachToCreatureId: TEST_CREATURE_ID,
        attachName: "prowl",
        forcePrivate: false,
      }),
    })

    expect(jobInsert).toHaveBeenCalledTimes(1)
    expect(jobInsert.mock.calls[0][0]).toEqual(
      expect.objectContaining({ force_private: true }),
    )
  })

  it("aspectRatio defaults to '1:1' when not provided (centered reference framing)", async () => {
    setupSupabaseMock({ creatureRow: { id: TEST_CREATURE_ID } })

    await app.inject({
      method: "POST",
      url: "/v1/generate-creature-motion",
      headers: { "x-user-id": TEST_USER_ID },
      payload: basePayload({
        attachToCreatureId: TEST_CREATURE_ID,
        attachName: "prowl",
      }),
    })

    const enqueuedPayload = vi.mocked(videoQueue.add).mock.calls[0][1] as Record<string, unknown>
    expect(enqueuedPayload.aspectRatio).toBe("1:1")
  })

  it("explicit aspectRatio overrides the 1:1 default", async () => {
    setupSupabaseMock({ creatureRow: { id: TEST_CREATURE_ID } })

    await app.inject({
      method: "POST",
      url: "/v1/generate-creature-motion",
      headers: { "x-user-id": TEST_USER_ID },
      payload: basePayload({
        attachToCreatureId: TEST_CREATURE_ID,
        attachName: "prowl",
        aspectRatio: "16:9",
      }),
    })

    const enqueuedPayload = vi.mocked(videoQueue.add).mock.calls[0][1] as Record<string, unknown>
    expect(enqueuedPayload.aspectRatio).toBe("16:9")
  })

  it("non-studio path (no attachToCreatureId) skips ownership check and still enqueues", async () => {
    const { creatureSelect } = setupSupabaseMock({ creatureRow: { id: TEST_CREATURE_ID } })

    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-creature-motion",
      headers: { "x-user-id": TEST_USER_ID },
      payload: basePayload(), // no attachToCreatureId
    })

    expect(res.statusCode).toBe(200)
    expect(creatureSelect).not.toHaveBeenCalled()
    expect(videoQueue.add).toHaveBeenCalledTimes(1)
  })

  it("worker queue payload includes the built prompt from buildObjectMotionPrompt", async () => {
    setupSupabaseMock({ creatureRow: { id: TEST_CREATURE_ID } })

    await app.inject({
      method: "POST",
      url: "/v1/generate-creature-motion",
      headers: { "x-user-id": TEST_USER_ID },
      payload: basePayload({
        attachToCreatureId: TEST_CREATURE_ID,
        attachName: "prowl",
        category: "arctic predator",
        canonicalDescription: "A russet frost fox with white-tipped tail and ice-blue eyes",
      }),
    })

    const enqueuedPayload = vi.mocked(videoQueue.add).mock.calls[0][1] as Record<string, unknown>
    expect(typeof enqueuedPayload.prompt).toBe("string")
    expect((enqueuedPayload.prompt as string).length).toBeGreaterThan(0)
    // The canonical description (preferred over name+category) should appear
    // in the rendered prompt.
    expect(enqueuedPayload.prompt as string).toContain("russet frost fox")
    expect(enqueuedPayload.prompt as string).toContain("prowling")
  })
})
