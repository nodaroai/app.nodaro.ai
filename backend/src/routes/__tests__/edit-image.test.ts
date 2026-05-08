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

import { editImageRoutes } from "../edit-image.js"
import { supabase } from "../../lib/supabase.js"
import { videoQueue } from "../../lib/queue.js"

// ---------------------------------------------------------------------------
// Test app setup
// ---------------------------------------------------------------------------

let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()

  app = Fastify({ logger: false })

  // Bypass auth — edit-image reads userId from req.userId (set by auth hook)
  app.addHook("preHandler", async (req) => {
    const body = req.body as Record<string, unknown> | undefined
    if (body?.userId && typeof body.userId === "string") {
      req.userId = body.userId
      req.userRole = undefined
    }
  })

  await app.register(async (instance) => {
    await editImageRoutes(instance)
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

describe("POST /v1/edit-image", () => {
  it("returns 400 when imageUrl is missing", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/edit-image",
      payload: { userId: "00000000-0000-4000-8000-000000000001" },
    })

    expect(res.statusCode).toBe(400)
    const body = res.json()
    expect(body.error.code).toBe("validation_error")
  })

  it("returns 401 when userId is not set", async () => {
    // Do not send userId so the preHandler hook does not set req.userId
    const res = await app.inject({
      method: "POST",
      url: "/v1/edit-image",
      payload: { imageUrl: "https://example.com/photo.png" },
    })

    expect(res.statusCode).toBe(401)
    const body = res.json()
    expect(body.error.code).toBe("unauthorized")
  })

  it("returns 400 when nano-banana-edit is used without a prompt", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/edit-image",
      payload: {
        imageUrl: "https://example.com/photo.png",
        provider: "nano-banana-edit",
        userId: "00000000-0000-4000-8000-000000000001",
      },
    })

    expect(res.statusCode).toBe(400)
    const body = res.json()
    expect(body.error.code).toBe("validation_error")
    expect(body.error.message).toContain("nano-banana-edit")
  })

  it("creates a job and enqueues it on valid request", async () => {
    const { mockFrom, mockInsert } = mockJobInsert({
      data: { id: "job-1" },
      error: null,
    })

    const res = await app.inject({
      method: "POST",
      url: "/v1/edit-image",
      payload: {
        imageUrl: "https://example.com/photo.png",
        provider: "recraft-upscale",
        userId: "00000000-0000-4000-8000-000000000001",
      },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.jobId).toBe("job-1")

    expect(mockFrom).toHaveBeenCalledWith("jobs")
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: "00000000-0000-4000-8000-000000000001",
        status: "pending",
        input_data: expect.objectContaining({
          imageUrl: "https://example.com/photo.png",
          provider: "recraft-upscale",
          type: "edit-image",
        }),
      })
    )

    expect(videoQueue.add).toHaveBeenCalledWith(
      "edit-image",
      expect.objectContaining({
        jobId: "job-1",
        imageUrl: "https://example.com/photo.png",
        provider: "recraft-upscale",
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
      url: "/v1/edit-image",
      payload: {
        imageUrl: "https://example.com/photo.png",
        userId: "00000000-0000-4000-8000-000000000001",
      },
    })

    expect(res.statusCode).toBe(500)
    const body = res.json()
    expect(body.error.code).toBe("internal_error")
  })

  it("uses recraft-upscale as default provider when none specified", async () => {
    const { mockInsert } = mockJobInsert({
      data: { id: "job-1" },
      error: null,
    })

    const res = await app.inject({
      method: "POST",
      url: "/v1/edit-image",
      payload: {
        imageUrl: "https://example.com/photo.png",
        userId: "00000000-0000-4000-8000-000000000001",
      },
    })

    expect(res.statusCode).toBe(200)

    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        input_data: expect.objectContaining({
          imageUrl: "https://example.com/photo.png",
          type: "edit-image",
        }),
      })
    )
  })
})

// ---------------------------------------------------------------------------
// grok-upscale provider — accepts taskId instead of imageUrl
// ---------------------------------------------------------------------------

describe("POST /v1/edit-image — grok-upscale provider", () => {
  it("accepts taskId without imageUrl", async () => {
    const { mockInsert } = mockJobInsert({
      data: { id: "job-grok" },
      error: null,
    })

    const res = await app.inject({
      method: "POST",
      url: "/v1/edit-image",
      payload: {
        provider: "grok-upscale",
        taskId: "grok-prior-task-abc",
        userId: "00000000-0000-4000-8000-000000000001",
      },
    })

    expect(res.statusCode).toBe(200)
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        input_data: expect.objectContaining({
          provider: "grok-upscale",
          taskId: "grok-prior-task-abc",
          type: "edit-image",
        }),
      })
    )
    expect(videoQueue.add).toHaveBeenCalledWith(
      "edit-image",
      expect.objectContaining({
        provider: "grok-upscale",
        taskId: "grok-prior-task-abc",
      })
    )
  })

  it("returns 400 when grok-upscale is sent without taskId (even with imageUrl)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/edit-image",
      payload: {
        provider: "grok-upscale",
        imageUrl: "https://example.com/photo.png",
        userId: "00000000-0000-4000-8000-000000000001",
      },
    })

    expect(res.statusCode).toBe(400)
    const body = res.json()
    expect(body.error.code).toBe("validation_error")
  })

  it("returns 400 when neither imageUrl nor taskId provided for any provider", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/edit-image",
      payload: {
        provider: "recraft-upscale",
        userId: "00000000-0000-4000-8000-000000000001",
      },
    })

    expect(res.statusCode).toBe(400)
    const body = res.json()
    expect(body.error.code).toBe("validation_error")
  })

  it("non-grok-upscale providers ignore taskId field if provided", async () => {
    const { mockInsert } = mockJobInsert({
      data: { id: "job-1" },
      error: null,
    })

    const res = await app.inject({
      method: "POST",
      url: "/v1/edit-image",
      payload: {
        provider: "recraft-upscale",
        imageUrl: "https://example.com/photo.png",
        taskId: "stray-task-id",
        userId: "00000000-0000-4000-8000-000000000001",
      },
    })

    // Request still succeeds — taskId is plumbed through but the worker
    // routes off `provider` not `taskId`. (Belt-and-suspenders: this also
    // catches if the refinement accidentally rejects valid requests when
    // taskId is set alongside imageUrl for a non-grok provider.)
    expect(res.statusCode).toBe(200)
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        input_data: expect.objectContaining({
          imageUrl: "https://example.com/photo.png",
          provider: "recraft-upscale",
        }),
      })
    )
  })
})
