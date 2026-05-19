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
    creditsReserved: 22,
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

import { generateLocationMotionRoutes } from "../generate-location-motion.js"
import { supabase } from "../../lib/supabase.js"
import { videoQueue } from "../../lib/queue.js"
import { reserveCreditsForJob } from "../../middleware/credit-guard.js"

// ---------------------------------------------------------------------------
// Test app setup
// ---------------------------------------------------------------------------

const TEST_USER_ID = "00000000-0000-4000-8000-000000000001"
const TEST_LOCATION_ID = "00000000-0000-4000-8000-000000000077"
const SOURCE_URL = "https://example.com/establishing.png"

let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()
  vi.mocked(reserveCreditsForJob).mockResolvedValue({
    usageLogId: "log-1",
    creditsReserved: 22,
    watermark: false,
  } as never)

  app = Fastify({ logger: false })
  // Bypass auth — read userId from header so test cases can opt in/out.
  app.addHook("preHandler", async (req) => {
    const header = req.headers["x-user-id"]
    if (typeof header === "string") req.userId = header
  })
  await app.register(async (instance) => {
    await generateLocationMotionRoutes(instance)
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
 *   - "locations" -> fetch chain returning the supplied row (or null for the
 *     "not found / cross-user / soft-deleted" cases)
 *   - "jobs"      -> insert chain returning job-1 by default
 */
function setupSupabaseMock(opts: {
  locationRow?: { id: string } | null
  jobInsertResult?: { data: { id: string } | null; error: { message: string } | null }
}) {
  const locationSingle = vi.fn().mockResolvedValue({
    data: opts.locationRow ?? null,
    error: opts.locationRow ? null : { message: "row not found" },
  })
  // locations select chain:
  //   .select("id").eq("id", ...).eq("user_id", ...).is("deleted_at", null).single()
  const locationIs = vi.fn().mockReturnValue({ single: locationSingle })
  const locationEq2 = vi.fn().mockReturnValue({ is: locationIs })
  const locationEq1 = vi.fn().mockReturnValue({ eq: locationEq2 })
  const locationSelect = vi.fn().mockReturnValue({ eq: locationEq1 })

  const jobInsertResult = opts.jobInsertResult ?? { data: { id: "job-1" }, error: null }
  const jobSingle = vi.fn().mockResolvedValue(jobInsertResult)
  const jobSelect = vi.fn().mockReturnValue({ single: jobSingle })
  const jobInsert = vi.fn().mockReturnValue({ select: jobSelect })

  vi.mocked(supabase.from).mockImplementation((table: string) => {
    if (table === "locations") return { select: locationSelect } as never
    if (table === "jobs") return { insert: jobInsert } as never
    return {} as never
  })

  return { locationSelect, locationEq1, locationEq2, locationIs, locationSingle, jobInsert, jobSelect, jobSingle }
}

function basePayload(extra: Record<string, unknown> = {}) {
  return {
    motionPrompt: "slow push-in toward the lighthouse",
    sourceImageUrl: SOURCE_URL,
    name: "Lighthouse Cove",
    ...extra,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /v1/generate-location-motion — Task 4 behavior", () => {
  it("happy path: returns { jobId } and enqueues a video job", async () => {
    setupSupabaseMock({ locationRow: { id: TEST_LOCATION_ID } })

    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-location-motion",
      headers: { "x-user-id": TEST_USER_ID },
      payload: basePayload({
        attachToLocationId: TEST_LOCATION_ID,
        attachName: "push-in",
      }),
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().jobId).toBe("job-1")
    expect(videoQueue.add).toHaveBeenCalledTimes(1)
    expect(videoQueue.add).toHaveBeenCalledWith(
      "generate-location-motion",
      expect.objectContaining({
        jobId: "job-1",
        sourceImageUrl: SOURCE_URL,
        provider: "kling",
        attachToLocationId: TEST_LOCATION_ID,
        attachToColumn: "atmosphere_motions",
        attachName: "push-in",
        usageLogId: "log-1",
      }),
    )
  })

  it("returns 401 when unauthenticated", async () => {
    setupSupabaseMock({ locationRow: { id: TEST_LOCATION_ID } })

    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-location-motion",
      // intentionally no x-user-id header
      payload: basePayload(),
    })

    expect(res.statusCode).toBe(401)
    expect(res.json().error.code).toBe("unauthorized")
  })

  it("returns 404 location_not_found when attachToLocationId is cross-user (or non-existent)", async () => {
    // locationRow null + error -> ownership check fails
    setupSupabaseMock({ locationRow: null })

    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-location-motion",
      headers: { "x-user-id": TEST_USER_ID },
      payload: basePayload({
        attachToLocationId: TEST_LOCATION_ID,
        attachName: "push-in",
      }),
    })

    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe("location_not_found")
    expect(videoQueue.add).not.toHaveBeenCalled()
    expect(vi.mocked(reserveCreditsForJob)).not.toHaveBeenCalled()
  })

  it("returns 404 location_not_found when target location is soft-deleted", async () => {
    // Soft-deleted rows are filtered by `.is("deleted_at", null)` so the
    // mock's null row simulates "the row exists but is hidden by the filter".
    setupSupabaseMock({ locationRow: null })

    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-location-motion",
      headers: { "x-user-id": TEST_USER_ID },
      payload: basePayload({
        attachToLocationId: TEST_LOCATION_ID,
        attachName: "push-in",
      }),
    })

    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe("location_not_found")
  })

  it("verifies the ownership query is scoped by user_id AND deleted_at IS NULL", async () => {
    const { locationSelect, locationEq1, locationEq2, locationIs } = setupSupabaseMock({
      locationRow: { id: TEST_LOCATION_ID },
    })

    await app.inject({
      method: "POST",
      url: "/v1/generate-location-motion",
      headers: { "x-user-id": TEST_USER_ID },
      payload: basePayload({
        attachToLocationId: TEST_LOCATION_ID,
        attachName: "push-in",
      }),
    })

    // .select("id") -> .eq("id", locationId) -> .eq("user_id", userId) -> .is("deleted_at", null)
    expect(locationSelect).toHaveBeenCalled()
    expect(locationEq1).toHaveBeenCalledWith("id", TEST_LOCATION_ID)
    expect(locationEq2).toHaveBeenCalledWith("user_id", TEST_USER_ID)
    expect(locationIs).toHaveBeenCalledWith("deleted_at", null)
  })

  it("returns 400 validation_error when provider is not in LOCATION_ATMOSPHERE_PROVIDERS", async () => {
    setupSupabaseMock({ locationRow: { id: TEST_LOCATION_ID } })

    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-location-motion",
      headers: { "x-user-id": TEST_USER_ID },
      payload: basePayload({
        provider: "veo3", // not in LOCATION_ATMOSPHERE_PROVIDERS
      }),
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
    expect(videoQueue.add).not.toHaveBeenCalled()
  })

  it("returns 400 validation_error when sourceImageUrl is missing (motion requires an i2v frame)", async () => {
    setupSupabaseMock({ locationRow: { id: TEST_LOCATION_ID } })

    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-location-motion",
      headers: { "x-user-id": TEST_USER_ID },
      payload: {
        // motionPrompt + name present, but no sourceImageUrl
        motionPrompt: "slow push-in",
        name: "Lighthouse Cove",
      },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
    expect(videoQueue.add).not.toHaveBeenCalled()
  })

  it("creditGuard reserves credits and usageLogId is forwarded into the queue payload", async () => {
    setupSupabaseMock({ locationRow: { id: TEST_LOCATION_ID } })

    await app.inject({
      method: "POST",
      url: "/v1/generate-location-motion",
      headers: { "x-user-id": TEST_USER_ID },
      payload: basePayload({
        attachToLocationId: TEST_LOCATION_ID,
        attachName: "push-in",
      }),
    })

    expect(reserveCreditsForJob).toHaveBeenCalledTimes(1)
    // 3rd arg is the jobId, 4th is the model identifier (provider).
    expect(vi.mocked(reserveCreditsForJob).mock.calls[0][2]).toBe("job-1")
    expect(vi.mocked(reserveCreditsForJob).mock.calls[0][3]).toBe("kling")

    const enqueuedPayload = vi.mocked(videoQueue.add).mock.calls[0][1] as Record<string, unknown>
    expect(enqueuedPayload.usageLogId).toBe("log-1")
  })

  it("force_private: true is hardcoded on the inserted job row (even when forcePrivate: false in body)", async () => {
    const { jobInsert } = setupSupabaseMock({ locationRow: { id: TEST_LOCATION_ID } })

    await app.inject({
      method: "POST",
      url: "/v1/generate-location-motion",
      headers: { "x-user-id": TEST_USER_ID },
      payload: basePayload({
        attachToLocationId: TEST_LOCATION_ID,
        attachName: "push-in",
        forcePrivate: false,
      }),
    })

    expect(jobInsert).toHaveBeenCalledTimes(1)
    expect(jobInsert.mock.calls[0][0]).toEqual(
      expect.objectContaining({ force_private: true }),
    )
  })

  it("stores mcp_client when provided in the raw body", async () => {
    const { jobInsert } = setupSupabaseMock({ locationRow: { id: TEST_LOCATION_ID } })

    await app.inject({
      method: "POST",
      url: "/v1/generate-location-motion",
      headers: { "x-user-id": TEST_USER_ID },
      payload: basePayload({
        attachToLocationId: TEST_LOCATION_ID,
        attachName: "push-in",
        mcp_client: "Claude",
      }),
    })

    expect(jobInsert).toHaveBeenCalledTimes(1)
    expect(jobInsert.mock.calls[0][0]).toEqual(
      expect.objectContaining({ mcp_client: "Claude" }),
    )
  })

  it("omits mcp_client from the row when not in the body", async () => {
    const { jobInsert } = setupSupabaseMock({ locationRow: { id: TEST_LOCATION_ID } })

    await app.inject({
      method: "POST",
      url: "/v1/generate-location-motion",
      headers: { "x-user-id": TEST_USER_ID },
      payload: basePayload({
        attachToLocationId: TEST_LOCATION_ID,
        attachName: "push-in",
      }),
    })

    const inserted = jobInsert.mock.calls[0][0] as Record<string, unknown>
    expect(Object.prototype.hasOwnProperty.call(inserted, "mcp_client")).toBe(false)
  })

  it("aspectRatio defaults to '16:9' when not provided (cinematic establishing shot)", async () => {
    setupSupabaseMock({ locationRow: { id: TEST_LOCATION_ID } })

    await app.inject({
      method: "POST",
      url: "/v1/generate-location-motion",
      headers: { "x-user-id": TEST_USER_ID },
      payload: basePayload({
        attachToLocationId: TEST_LOCATION_ID,
        attachName: "push-in",
      }),
    })

    const enqueuedPayload = vi.mocked(videoQueue.add).mock.calls[0][1] as Record<string, unknown>
    expect(enqueuedPayload.aspectRatio).toBe("16:9")
  })

  it("explicit aspectRatio overrides the 16:9 default", async () => {
    setupSupabaseMock({ locationRow: { id: TEST_LOCATION_ID } })

    await app.inject({
      method: "POST",
      url: "/v1/generate-location-motion",
      headers: { "x-user-id": TEST_USER_ID },
      payload: basePayload({
        attachToLocationId: TEST_LOCATION_ID,
        attachName: "push-in",
        aspectRatio: "9:16",
      }),
    })

    const enqueuedPayload = vi.mocked(videoQueue.add).mock.calls[0][1] as Record<string, unknown>
    expect(enqueuedPayload.aspectRatio).toBe("9:16")
  })

  it("non-studio path (no attachToLocationId) skips ownership check and still enqueues", async () => {
    const { locationSelect } = setupSupabaseMock({ locationRow: { id: TEST_LOCATION_ID } })

    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-location-motion",
      headers: { "x-user-id": TEST_USER_ID },
      payload: basePayload(), // no attachToLocationId
    })

    expect(res.statusCode).toBe(200)
    expect(locationSelect).not.toHaveBeenCalled()
    expect(videoQueue.add).toHaveBeenCalledTimes(1)
  })

  it("worker queue payload includes the built prompt from buildLocationMotionPrompt", async () => {
    setupSupabaseMock({ locationRow: { id: TEST_LOCATION_ID } })

    await app.inject({
      method: "POST",
      url: "/v1/generate-location-motion",
      headers: { "x-user-id": TEST_USER_ID },
      payload: basePayload({
        attachToLocationId: TEST_LOCATION_ID,
        attachName: "push-in",
        category: "exterior",
        canonicalDescription: "A weathered lighthouse on a rocky shore at dusk",
      }),
    })

    const enqueuedPayload = vi.mocked(videoQueue.add).mock.calls[0][1] as Record<string, unknown>
    expect(typeof enqueuedPayload.prompt).toBe("string")
    expect((enqueuedPayload.prompt as string).length).toBeGreaterThan(0)
    // The canonical description (preferred over name+category) should appear
    // in the rendered prompt.
    expect(enqueuedPayload.prompt as string).toContain("weathered lighthouse")
    expect(enqueuedPayload.prompt as string).toContain("slow push-in")
  })
})
