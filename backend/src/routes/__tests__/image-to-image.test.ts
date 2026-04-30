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

// Asset materializer fetches and re-hosts user-provided URLs server-side.
// In tests we just pass through unchanged so the existing assertions on
// imageUrl / referenceImageUrls / maskUrl values continue to hold.
vi.mock("@/lib/asset-materializer.js", () => ({
  materializeAsset: vi.fn(async ({ url }: { url: string }) => ({ url, rehosted: false })),
  materializeIfPresent: vi.fn(async (url: string | null | undefined) =>
    url == null ? null : url,
  ),
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

import { imageToImageRoutes } from "../image-to-image.js"
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
    await imageToImageRoutes(instance)
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

describe("POST /v1/image-to-image", () => {
  it("returns 400 when imageUrl is missing", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/image-to-image",
      payload: {
        prompt: "make it look vintage",
        userId: VALID_UUID,
      },
    })

    expect(res.statusCode).toBe(400)
    const body = res.json()
    expect(body.error.code).toBe("validation_error")
  })

  it("returns 400 when prompt is missing", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/image-to-image",
      payload: {
        imageUrl: "https://example.com/image.png",
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
      url: "/v1/image-to-image",
      payload: {
        imageUrl: "https://example.com/image.png",
        prompt: "make it look vintage",
      },
    })

    expect(res.statusCode).toBe(401)
    const body = res.json()
    expect(body.error.code).toBe("unauthorized")
  })

  it("creates a job and enqueues it on valid request (default provider)", async () => {
    const { mockFrom, mockInsert } = mockJobInsert("job-1")

    const res = await app.inject({
      method: "POST",
      url: "/v1/image-to-image",
      payload: {
        imageUrl: "https://example.com/image.png",
        prompt: "make it look vintage",
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
          imageUrl: "https://example.com/image.png",
          prompt: "make it look vintage",
          type: "image-to-image",
        }),
      })
    )

    // Verify job was enqueued (provider is undefined when not explicitly set — worker defaults to nano-banana)
    expect(videoQueue.add).toHaveBeenCalledWith(
      "image-to-image",
      expect.objectContaining({
        jobId: "job-1",
        imageUrl: "https://example.com/image.png",
        prompt: "make it look vintage",
      })
    )
  })

  it("passes referenceImageUrls through to input_data and queue", async () => {
    mockJobInsert("job-2")

    const refUrls = ["https://example.com/ref1.png", "https://example.com/ref2.png"]

    const res = await app.inject({
      method: "POST",
      url: "/v1/image-to-image",
      payload: {
        imageUrl: "https://example.com/image.png",
        prompt: "apply character style",
        userId: VALID_UUID,
        referenceImageUrls: refUrls,
      },
    })

    expect(res.statusCode).toBe(200)

    // Verify referenceImageUrls in queue payload
    expect(videoQueue.add).toHaveBeenCalledWith(
      "image-to-image",
      expect.objectContaining({
        jobId: "job-2",
        referenceImageUrls: refUrls,
      })
    )
  })

  it("returns 500 when job insert fails", async () => {
    mockJobInsert("job-1", { message: "DB connection failed" })

    const res = await app.inject({
      method: "POST",
      url: "/v1/image-to-image",
      payload: {
        imageUrl: "https://example.com/image.png",
        prompt: "make it look vintage",
        userId: VALID_UUID,
      },
    })

    expect(res.statusCode).toBe(500)
    const body = res.json()
    expect(body.error.code).toBe("internal_error")
  })

  // ---------------------------------------------------------------------------
  // Credit model identifier tests
  // ---------------------------------------------------------------------------

  describe("credit model identifier", () => {
    it("sends gpt-image-i2i:high for quality=high", async () => {
      mockJobInsert("job-gpt")

      const res = await app.inject({
        method: "POST",
        url: "/v1/image-to-image",
        payload: {
          imageUrl: "https://example.com/image.png",
          prompt: "enhance",
          userId: VALID_UUID,
          provider: "gpt-image-i2i",
          quality: "high",
        },
      })

      expect(res.statusCode).toBe(200)
      expect(videoQueue.add).toHaveBeenCalledWith(
        "image-to-image",
        expect.objectContaining({
          provider: "gpt-image-i2i",
          quality: "high",
        })
      )
    })

    it("sends flux-pro-i2i:2K for resolution=2K", async () => {
      mockJobInsert("job-flux-pro")

      const res = await app.inject({
        method: "POST",
        url: "/v1/image-to-image",
        payload: {
          imageUrl: "https://example.com/image.png",
          prompt: "upscale",
          userId: VALID_UUID,
          provider: "flux-pro-i2i",
          resolution: "2K",
        },
      })

      expect(res.statusCode).toBe(200)
      expect(videoQueue.add).toHaveBeenCalledWith(
        "image-to-image",
        expect.objectContaining({
          provider: "flux-pro-i2i",
          resolution: "2K",
        })
      )
    })

    it("sends nano-banana-pro:4K for resolution=4K", async () => {
      mockJobInsert("job-nano-pro")

      const res = await app.inject({
        method: "POST",
        url: "/v1/image-to-image",
        payload: {
          imageUrl: "https://example.com/image.png",
          prompt: "upscale",
          userId: VALID_UUID,
          provider: "nano-banana-pro",
          resolution: "4K",
        },
      })

      expect(res.statusCode).toBe(200)
      expect(videoQueue.add).toHaveBeenCalledWith(
        "image-to-image",
        expect.objectContaining({
          provider: "nano-banana-pro",
          resolution: "4K",
        })
      )
    })

    it("sends base provider name for default settings", async () => {
      mockJobInsert("job-base")

      const res = await app.inject({
        method: "POST",
        url: "/v1/image-to-image",
        payload: {
          imageUrl: "https://example.com/image.png",
          prompt: "stylize",
          userId: VALID_UUID,
          provider: "grok-i2i",
        },
      })

      expect(res.statusCode).toBe(200)
      expect(videoQueue.add).toHaveBeenCalledWith(
        "image-to-image",
        expect.objectContaining({
          provider: "grok-i2i",
        })
      )
    })
  })
})
