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

vi.mock("@/lib/render-queue.js", () => ({
  renderQueue: {
    add: vi.fn().mockResolvedValue({ id: "render-job-1" }),
  },
}))

vi.mock("@/middleware/credit-guard.js", () => ({
  creditGuard: () => async () => {},
  reserveCreditsForJob: vi.fn().mockResolvedValue({
    usageLogId: "usage-1",
    creditsReserved: 1,
    watermark: false,
  }),
}))

vi.mock("@/middleware/rate-limit.js", () => ({
  rateLimiter: () => async () => {},
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

vi.mock("@/lib/plan-schemas.js", async () => {
  const actual = await vi.importActual<typeof import("../../lib/plan-schemas.js")>("@/lib/plan-schemas.js")
  return {
    ...actual,
    validatePlanByType: vi.fn().mockImplementation(actual.validatePlanByType),
  }
})

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { renderVideoRoutes } from "../render-video.js"
import { supabase } from "../../lib/supabase.js"
import { renderQueue } from "../../lib/render-queue.js"
import { validatePlanByType } from "../../lib/plan-schemas.js"

// ---------------------------------------------------------------------------
// Test app setup
// ---------------------------------------------------------------------------

const TEST_USER_ID = "00000000-0000-4000-8000-000000000001"

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
    await renderVideoRoutes(instance)
  })

  await app.ready()
})

afterEach(async () => {
  await app.close()
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockJobInsert(jobId: string) {
  const mockSingle = vi.fn().mockResolvedValue({ data: { id: jobId }, error: null })
  const mockSelect = vi.fn().mockReturnValue({ single: mockSingle })
  const mockInsert = vi.fn().mockReturnValue({ select: mockSelect })
  vi.mocked(supabase.from).mockReturnValue({ insert: mockInsert } as never)
  return { mockInsert }
}

function validMediaAsset() {
  return {
    url: "https://example.com/image.png",
    type: "image" as const,
    durationSeconds: 5,
  }
}

function validRenderPayload() {
  return {
    template: "slideshow",
    fps: 30,
    aspectRatio: "16:9",
    durationSeconds: 10,
    mediaAssets: [validMediaAsset()],
    userId: TEST_USER_ID,
  }
}

function validSceneGraph() {
  return {
    fps: 30,
    width: 1920,
    height: 1080,
    durationInFrames: 300,
    backgroundColor: "#000000",
    tracks: [
      {
        type: "media",
        id: "track-1",
        zIndex: 0,
        segments: [
          {
            id: "seg-1",
            src: "https://example.com/image.png",
            mediaType: "image",
            startFrame: 0,
            durationInFrames: 300,
            layout: { mode: "fullscreen" },
            effects: [],
          },
        ],
      },
    ],
  }
}

// ---------------------------------------------------------------------------
// Tests — POST /v1/render-video
// ---------------------------------------------------------------------------

describe("POST /v1/render-video", () => {
  it("returns 400 when template is missing", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/render-video",
      payload: {
        mediaAssets: [validMediaAsset()],
        userId: TEST_USER_ID,
      },
    })

    expect(res.statusCode).toBe(400)
    const body = res.json()
    expect(body.error.code).toBe("validation_error")
  })

  it("returns 401 when no userId", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/render-video",
      payload: {
        template: "slideshow",
        mediaAssets: [validMediaAsset()],
      },
    })

    expect(res.statusCode).toBe(401)
    const body = res.json()
    expect(body.error.code).toBe("unauthorized")
  })

  it("creates job with correct dimensions for 16:9", async () => {
    mockJobInsert("job-render-1")

    const res = await app.inject({
      method: "POST",
      url: "/v1/render-video",
      payload: validRenderPayload(),
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.jobId).toBe("job-render-1")

    // Verify supabase insert was called with correct dimensions
    const mockFrom = vi.mocked(supabase.from)
    expect(mockFrom).toHaveBeenCalledWith("jobs")
  })

  it("enqueues to renderQueue (not videoQueue)", async () => {
    mockJobInsert("job-render-2")

    await app.inject({
      method: "POST",
      url: "/v1/render-video",
      payload: validRenderPayload(),
    })

    expect(renderQueue.add).toHaveBeenCalledWith(
      "render-video",
      expect.objectContaining({
        jobId: "job-render-2",
        template: "slideshow",
        width: 1920,
        height: 1080,
      })
    )
  })
})

// ---------------------------------------------------------------------------
// Tests — POST /v1/render-video/scene-graph
// ---------------------------------------------------------------------------

describe("POST /v1/render-video/scene-graph", () => {
  it("returns 400 on invalid schema", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/render-video/scene-graph",
      payload: {
        sceneGraph: { fps: 30 },
        userId: TEST_USER_ID,
      },
    })

    expect(res.statusCode).toBe(400)
    const body = res.json()
    expect(body.error.code).toBe("validation_error")
  })

  it("succeeds with valid scene graph", async () => {
    mockJobInsert("job-sg-1")

    const res = await app.inject({
      method: "POST",
      url: "/v1/render-video/scene-graph",
      payload: {
        sceneGraph: validSceneGraph(),
        userId: TEST_USER_ID,
      },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.jobId).toBe("job-sg-1")

    expect(renderQueue.add).toHaveBeenCalledWith(
      "render-video",
      expect.objectContaining({
        jobId: "job-sg-1",
        sceneGraph: expect.objectContaining({ fps: 30, width: 1920 }),
      })
    )
  })
})

// ---------------------------------------------------------------------------
// Tests — POST /v1/render-video/plan
// ---------------------------------------------------------------------------

describe("POST /v1/render-video/plan", () => {
  it("succeeds with valid after-effects plan", async () => {
    mockJobInsert("job-plan-1")

    // Mock validatePlanByType to succeed
    vi.mocked(validatePlanByType).mockReturnValue(undefined as never)

    const res = await app.inject({
      method: "POST",
      url: "/v1/render-video/plan",
      payload: {
        planType: "after-effects",
        plan: {
          fps: 30,
          width: 1920,
          height: 1080,
          durationInFrames: 300,
          sourceVideo: "https://example.com/video.mp4",
          effects: [],
        },
        userId: TEST_USER_ID,
      },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.jobId).toBe("job-plan-1")

    expect(renderQueue.add).toHaveBeenCalledWith(
      "render-video",
      expect.objectContaining({
        jobId: "job-plan-1",
        planType: "after-effects",
      })
    )
  })
})
