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

import { aiAvatarRoutes } from "../ai-avatar.js"
import { supabase } from "../../lib/supabase.js"
import { videoQueue } from "../../lib/queue.js"

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
    await aiAvatarRoutes(instance)
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

const VALID_USER_ID = "00000000-0000-4000-8000-000000000001"
const VALID_AUDIO_URL = "https://example.com/audio.mp3"

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /v1/ai-avatar", () => {
  it("returns 400 when text mode is missing script", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/ai-avatar",
      payload: {
        avatarId: "avatar-123",
        speechMode: "text",
        voiceId: "voice-abc",
        // script intentionally omitted
        userId: VALID_USER_ID,
      },
    })

    expect(res.statusCode).toBe(400)
    const body = res.json()
    expect(body.error.code).toBe("validation_error")
  })

  it("returns 400 when text mode is missing voiceId", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/ai-avatar",
      payload: {
        avatarId: "avatar-123",
        speechMode: "text",
        script: "Hello world",
        // voiceId intentionally omitted
        userId: VALID_USER_ID,
      },
    })

    expect(res.statusCode).toBe(400)
    const body = res.json()
    expect(body.error.code).toBe("validation_error")
  })

  it("returns 400 when audio mode is missing audioUrl", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/ai-avatar",
      payload: {
        avatarId: "avatar-123",
        speechMode: "audio",
        // audioUrl intentionally omitted
        userId: VALID_USER_ID,
      },
    })

    expect(res.statusCode).toBe(400)
    const body = res.json()
    expect(body.error.code).toBe("validation_error")
  })

  it("creates a job and enqueues it on valid text mode request", async () => {
    const { mockFrom, mockInsert } = mockJobInsert({
      data: { id: "job-1" },
      error: null,
    })

    const res = await app.inject({
      method: "POST",
      url: "/v1/ai-avatar",
      payload: {
        avatarId: "avatar-123",
        speechMode: "text",
        script: "Hello, this is a test script",
        voiceId: "voice-abc",
        resolution: "720p",
        aspectRatio: "16:9",
        userId: VALID_USER_ID,
      },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.jobId).toBe("job-1")

    expect(mockFrom).toHaveBeenCalledWith("jobs")
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: VALID_USER_ID,
        status: "pending",
        input_data: expect.objectContaining({
          avatarId: "avatar-123",
          speechMode: "text",
          type: "ai-avatar",
        }),
      }),
    )

    expect(videoQueue.add).toHaveBeenCalledWith(
      "ai-avatar",
      expect.objectContaining({
        jobId: "job-1",
        engine: "avatar-iv",
        avatarId: "avatar-123",
        speechMode: "text",
        script: "Hello, this is a test script",
        voiceId: "voice-abc",
        resolution: "720p",
        aspectRatio: "16:9",
      }),
    )
  })

  it("enqueued payload carries engine, avatarId, speechMode and other fields", async () => {
    mockJobInsert({ data: { id: "job-2" }, error: null })

    await app.inject({
      method: "POST",
      url: "/v1/ai-avatar",
      payload: {
        engine: "avatar-v",
        avatarId: "av-99",
        speechMode: "audio",
        audioUrl: VALID_AUDIO_URL,
        resolution: "1080p",
        aspectRatio: "9:16",
        caption: true,
        userId: VALID_USER_ID,
      },
    })

    expect(videoQueue.add).toHaveBeenCalledWith(
      "ai-avatar",
      expect.objectContaining({
        jobId: "job-2",
        engine: "avatar-v",
        avatarId: "av-99",
        speechMode: "audio",
        audioUrl: VALID_AUDIO_URL,
        resolution: "1080p",
        aspectRatio: "9:16",
        caption: true,
      }),
    )
  })
})
