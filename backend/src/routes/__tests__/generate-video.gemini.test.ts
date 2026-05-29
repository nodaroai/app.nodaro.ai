import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

// ---------------------------------------------------------------------------
// Mocks — hoisted before any route import (mirrors generate-video.test.ts)
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

vi.mock("@/lib/video-schemas.js", async () => {
  const { z } = await import("zod")
  return {
    shotsSchema: z.array(z.object({ prompt: z.string(), duration: z.number() })),
    elementsSchema: z.array(z.object({ name: z.string() })),
  }
})

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { generateVideoRoutes } from "../generate-video.js"
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
    await generateVideoRoutes(instance)
  })

  await app.ready()
})

afterEach(async () => {
  await app.close()
})

// ---------------------------------------------------------------------------
// Helper — mirrors generate-video.test.ts mockJobInsert
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

describe("POST /v1/generate-video — gemini-omni-video V2V", () => {
  // 1. V2V request with referenceVideoUrls and NO imageUrl should NOT 400 "imageUrl is required"
  it("accepts gemini V2V with referenceVideoUrls and no imageUrl", async () => {
    mockJobInsert({ data: { id: "job-1" }, error: null })

    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-video",
      payload: {
        provider: "gemini-omni-video",
        referenceVideoUrls: ["https://example.com/v.mp4"],
        prompt: "edit it",
        userId: "00000000-0000-4000-8000-000000000001",
      },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().jobId).toBeTruthy()
  })

  // 2. Trim window > 10 seconds should 400 with validation_error
  it("rejects trim window > 10 seconds", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-video",
      payload: {
        provider: "gemini-omni-video",
        imageUrl: "https://example.com/i.png",
        videoTrimStart: 0,
        videoTrimEnd: 12,
        userId: "00000000-0000-4000-8000-000000000001",
      },
    })

    expect(res.statusCode).toBe(400)
    const body = res.json()
    expect(body.error.code).toBe("validation_error")
  })

  // 3. Valid trim window (0–8) is accepted and payload threaded to queue
  it("accepts valid trim window and threads it to the queue payload", async () => {
    mockJobInsert({ data: { id: "job-2" }, error: null })

    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-video",
      payload: {
        provider: "gemini-omni-video",
        referenceVideoUrls: ["https://example.com/v.mp4"],
        videoTrimStart: 0,
        videoTrimEnd: 8,
        userId: "00000000-0000-4000-8000-000000000001",
      },
    })

    expect(res.statusCode).toBe(200)

    const queueCall = vi.mocked(videoQueue.add).mock.calls[0]
    expect(queueCall).toBeDefined()
    const queuePayload = queueCall[1] as Record<string, unknown>
    expect(queuePayload.videoTrimStart).toBe(0)
    expect(queuePayload.videoTrimEnd).toBe(8)
  })

  // 4. No imageUrl AND no reference arrays → still 400 "imageUrl is required"
  it("still rejects gemini-omni-video with no imageUrl and no refs", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-video",
      payload: {
        provider: "gemini-omni-video",
        prompt: "make a video",
        userId: "00000000-0000-4000-8000-000000000001",
      },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error.message).toBe("imageUrl is required")
  })

  // 5. One-sided over-window rejected: videoTrimEnd:30 alone (→ 0..30) must be 400
  it("rejects one-sided videoTrimEnd=30 (effective window 0..30 > 10)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-video",
      payload: {
        provider: "gemini-omni-video",
        referenceVideoUrls: ["https://example.com/v.mp4"],
        videoTrimEnd: 30,
        userId: "00000000-0000-4000-8000-000000000001",
      },
    })

    expect(res.statusCode).toBe(400)
    const body = res.json()
    expect(body.error.code).toBe("validation_error")
  })

  // 6. One-sided valid: videoTrimStart:5 alone (→ 5..15 = 10s window) must be accepted
  it("accepts one-sided videoTrimStart=5 (effective window 5..15 = 10s, valid)", async () => {
    mockJobInsert({ data: { id: "job-3" }, error: null })

    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-video",
      payload: {
        provider: "gemini-omni-video",
        referenceVideoUrls: ["https://example.com/v.mp4"],
        videoTrimStart: 5,
        userId: "00000000-0000-4000-8000-000000000001",
      },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().jobId).toBeTruthy()
  })
})
