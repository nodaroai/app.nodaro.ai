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

vi.mock("@/lib/url-validator.js", async () => {
  const { z } = await import("zod")
  return { safeUrlSchema: z.string().url() }
})

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { transcribeRoutes } from "../transcribe.js"
import { supabase } from "../../lib/supabase.js"
import { videoQueue } from "../../lib/queue.js"

// ---------------------------------------------------------------------------
// Test app setup
// ---------------------------------------------------------------------------

const VALID_UUID = "00000000-0000-4000-8000-000000000001"

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
    await transcribeRoutes(instance)
  })

  await app.ready()
})

afterEach(async () => {
  await app.close()
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockJobInsert(jobId = "job-1", error: { message: string } | null = null) {
  const mockSingle = vi.fn().mockResolvedValue({
    data: error ? null : { id: jobId },
    error,
  })
  const mockSelect = vi.fn().mockReturnValue({ single: mockSingle })
  const mockInsert = vi.fn().mockReturnValue({ select: mockSelect })
  const mockFrom = vi.mocked(supabase.from)
  mockFrom.mockReturnValue({ insert: mockInsert } as never)
  return { mockFrom, mockInsert, mockSelect, mockSingle }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /v1/transcribe", () => {
  it("returns 400 when audioUrl is missing", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/transcribe",
      payload: {
        userId: VALID_UUID,
      },
    })

    expect(res.statusCode).toBe(400)
    const body = res.json()
    expect(body.error.code).toBe("validation_error")
  })

  it("returns 401 when userId is not provided", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/transcribe",
      payload: {
        audioUrl: "https://example.com/audio.mp3",
      },
    })

    expect(res.statusCode).toBe(401)
    const body = res.json()
    expect(body.error.code).toBe("unauthorized")
  })

  it("creates a job and enqueues it with default provider (whisper)", async () => {
    const { mockFrom, mockInsert } = mockJobInsert("job-1")

    const res = await app.inject({
      method: "POST",
      url: "/v1/transcribe",
      payload: {
        audioUrl: "https://example.com/audio.mp3",
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
          audioUrl: "https://example.com/audio.mp3",
          type: "transcribe",
        }),
      })
    )

    // Verify job was enqueued with default provider
    expect(videoQueue.add).toHaveBeenCalledWith(
      "transcribe",
      expect.objectContaining({
        jobId: "job-1",
        audioUrl: "https://example.com/audio.mp3",
      })
    )
  })

  it("passes language param through to input_data and queue", async () => {
    mockJobInsert("job-2")

    const res = await app.inject({
      method: "POST",
      url: "/v1/transcribe",
      payload: {
        audioUrl: "https://example.com/audio.mp3",
        userId: VALID_UUID,
        language: "es",
      },
    })

    expect(res.statusCode).toBe(200)

    // Verify language in queue payload
    expect(videoQueue.add).toHaveBeenCalledWith(
      "transcribe",
      expect.objectContaining({
        jobId: "job-2",
        language: "es",
      })
    )
  })

  it("passes non-default provider (incredibly-fast-whisper) through", async () => {
    mockJobInsert("job-3")

    const res = await app.inject({
      method: "POST",
      url: "/v1/transcribe",
      payload: {
        audioUrl: "https://example.com/audio.mp3",
        userId: VALID_UUID,
        provider: "incredibly-fast-whisper",
      },
    })

    expect(res.statusCode).toBe(200)

    // Verify provider in queue payload
    expect(videoQueue.add).toHaveBeenCalledWith(
      "transcribe",
      expect.objectContaining({
        jobId: "job-3",
        provider: "incredibly-fast-whisper",
      })
    )
  })

  it("returns 500 when job insert fails", async () => {
    mockJobInsert("job-1", { message: "DB connection failed" })

    const res = await app.inject({
      method: "POST",
      url: "/v1/transcribe",
      payload: {
        audioUrl: "https://example.com/audio.mp3",
        userId: VALID_UUID,
      },
    })

    expect(res.statusCode).toBe(500)
    const body = res.json()
    expect(body.error.code).toBe("internal_error")
  })
})
