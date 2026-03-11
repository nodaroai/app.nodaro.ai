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
  creditGuard: () => async () => {},
  reserveCreditsForJob: vi.fn().mockResolvedValue({
    usageLogId: "usage-1",
    creditsReserved: 1,
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

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { textToAudioRoutes } from "../text-to-audio.js"
import { supabase } from "../../lib/supabase.js"
import { videoQueue } from "../../lib/queue.js"

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VALID_UUID = "00000000-0000-4000-8000-000000000001"

// ---------------------------------------------------------------------------
// Test app setup
// ---------------------------------------------------------------------------

let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()

  app = Fastify({ logger: false })

  // Bypass auth — set userId from request body for protected routes
  app.addHook("preHandler", async (req) => {
    const body = req.body as Record<string, unknown> | undefined
    if (body?.userId && typeof body.userId === "string") {
      req.userId = body.userId
      req.userRole = undefined
    }
  })

  await app.register(async (instance) => {
    await textToAudioRoutes(instance)
  })

  await app.ready()
})

afterEach(async () => {
  await app.close()
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockJobInsert(result: { data: unknown; error: unknown }) {
  const mockSingle = vi.fn().mockResolvedValue(result)
  const mockSelect = vi.fn().mockReturnValue({ single: mockSingle })
  const mockInsert = vi.fn().mockReturnValue({ select: mockSelect })
  const mockFrom = vi.mocked(supabase.from)
  mockFrom.mockReturnValue({ insert: mockInsert } as never)
  return { mockFrom, mockInsert, mockSelect, mockSingle }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /v1/text-to-audio", () => {
  it("returns 400 when prompt is missing", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/text-to-audio",
      payload: { userId: VALID_UUID },
    })

    expect(res.statusCode).toBe(400)
    const body = res.json()
    expect(body.error.code).toBe("validation_error")
  })

  it("returns 401 when userId is not provided", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/text-to-audio",
      payload: { prompt: "birds chirping in a forest" },
    })

    expect(res.statusCode).toBe(401)
    const body = res.json()
    expect(body.error.code).toBe("unauthorized")
  })

  it("creates a job with default provider tangoflux", async () => {
    const { mockFrom, mockInsert } = mockJobInsert({
      data: { id: "job-1" },
      error: null,
    })

    const res = await app.inject({
      method: "POST",
      url: "/v1/text-to-audio",
      payload: {
        prompt: "birds chirping in a forest",
        userId: VALID_UUID,
      },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.jobId).toBe("job-1")

    // Verify supabase was called to insert the job
    expect(mockFrom).toHaveBeenCalledWith("jobs")
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: VALID_UUID,
        status: "pending",
        input_data: expect.objectContaining({
          prompt: "birds chirping in a forest",
          type: "text-to-audio",
        }),
      })
    )

    // Verify job was enqueued
    expect(videoQueue.add).toHaveBeenCalledWith(
      "text-to-audio",
      expect.objectContaining({
        jobId: "job-1",
        prompt: "birds chirping in a forest",
      })
    )
  })

  it("passes optional params (duration, loop, promptInfluence) through to input_data and queue", async () => {
    const { mockInsert } = mockJobInsert({
      data: { id: "job-1" },
      error: null,
    })

    const res = await app.inject({
      method: "POST",
      url: "/v1/text-to-audio",
      payload: {
        prompt: "thunder rolling",
        provider: "elevenlabs-sfx",
        duration: 10,
        loop: true,
        promptInfluence: 0.7,
        userId: VALID_UUID,
      },
    })

    expect(res.statusCode).toBe(200)

    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        input_data: expect.objectContaining({
          prompt: "thunder rolling",
          provider: "elevenlabs-sfx",
          duration: 10,
          loop: true,
          promptInfluence: 0.7,
          type: "text-to-audio",
        }),
      })
    )

    expect(videoQueue.add).toHaveBeenCalledWith(
      "text-to-audio",
      expect.objectContaining({
        jobId: "job-1",
        prompt: "thunder rolling",
        provider: "elevenlabs-sfx",
        duration: 10,
        loop: true,
        promptInfluence: 0.7,
      })
    )
  })

  it("accepts elevenlabs-sfx provider", async () => {
    const { mockInsert } = mockJobInsert({
      data: { id: "job-1" },
      error: null,
    })

    const res = await app.inject({
      method: "POST",
      url: "/v1/text-to-audio",
      payload: {
        prompt: "glass shattering",
        provider: "elevenlabs-sfx",
        userId: VALID_UUID,
      },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.jobId).toBe("job-1")

    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        input_data: expect.objectContaining({
          provider: "elevenlabs-sfx",
          type: "text-to-audio",
        }),
      })
    )

    expect(videoQueue.add).toHaveBeenCalledWith(
      "text-to-audio",
      expect.objectContaining({
        provider: "elevenlabs-sfx",
      })
    )
  })

  it("returns 500 when job insert fails", async () => {
    mockJobInsert({
      data: null,
      error: { message: "DB connection failed" },
    })

    const res = await app.inject({
      method: "POST",
      url: "/v1/text-to-audio",
      payload: {
        prompt: "birds chirping in a forest",
        userId: VALID_UUID,
      },
    })

    expect(res.statusCode).toBe(500)
    const body = res.json()
    expect(body.error.code).toBe("internal_error")
  })
})
