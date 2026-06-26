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
    creditsReserved: 5,
    watermark: false,
  }),
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

// The ffprobe preflight is mocked so the route can be driven deterministically:
// probeVideoFrames returns a controllable { frames, width, height }. Default is
// a small, in-bounds clip (90 frames, 1280x720). Individual tests override.
const mockProbeVideoFrames = vi.fn().mockResolvedValue({ frames: 90, width: 1280, height: 720 })
// exactFrameCount is the boundary confirm — defaults to undefined (the caller
// falls back to the cheap estimate). Over-limit tests set the precise count.
const mockExactFrameCount = vi.fn().mockResolvedValue(undefined)
vi.mock("@/lib/ffprobe-frames.js", () => ({
  probeVideoFrames: (...args: unknown[]) => mockProbeVideoFrames(...args),
  exactFrameCount: (...args: unknown[]) => mockExactFrameCount(...args),
}))

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { switchXRoutes } from "../switchx.js"
import { reserveCreditsForJob } from "../../middleware/credit-guard.js"
import { supabase } from "../../lib/supabase.js"
import { videoQueue } from "../../lib/queue.js"

// ---------------------------------------------------------------------------
// Test app setup
// ---------------------------------------------------------------------------

let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()
  // clearAllMocks resets the default implementation set at module scope.
  mockProbeVideoFrames.mockResolvedValue({ frames: 90, width: 1280, height: 720 })
  mockExactFrameCount.mockResolvedValue(undefined)

  app = Fastify({ logger: false })

  // Bypass auth — set userId from request body for protected routes.
  app.addHook("preHandler", async (req) => {
    const body = req.body as Record<string, unknown> | undefined
    if (body?.userId && typeof body.userId === "string") {
      req.userId = body.userId
      req.userRole = undefined
    }
  })

  await app.register(async (instance) => {
    await switchXRoutes(instance)
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
const VALID_VIDEO_URL = "https://example.com/source.mp4"
const VALID_REF_URL = "https://example.com/style.png"

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /v1/switchx", () => {
  it("returns 400 MISSING_ALPHA when alphaMode is 'select' without a maskUrl", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/switchx",
      payload: {
        videoUrl: VALID_VIDEO_URL,
        referenceImageUrl: VALID_REF_URL,
        alphaMode: "select",
        // maskUrl intentionally omitted
        userId: VALID_USER_ID,
      },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("MISSING_ALPHA")
    expect(videoQueue.add).not.toHaveBeenCalled()
  })

  it("returns 400 MISSING_STYLE_INPUT when neither prompt nor referenceImageUrl is given", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/switchx",
      payload: {
        videoUrl: VALID_VIDEO_URL,
        alphaMode: "auto",
        // no prompt, no referenceImageUrl
        userId: VALID_USER_ID,
      },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("MISSING_STYLE_INPUT")
    expect(videoQueue.add).not.toHaveBeenCalled()
  })

  it("returns 400 VIDEO_TOO_MANY_FRAMES when the source is well over the cap (> auto-trim zone)", async () => {
    mockProbeVideoFrames.mockResolvedValueOnce({ frames: 300, width: 1280, height: 720 })
    mockExactFrameCount.mockResolvedValueOnce(300) // exact decode confirms it's past the 270 trim cap

    const res = await app.inject({
      method: "POST",
      url: "/v1/switchx",
      payload: {
        videoUrl: VALID_VIDEO_URL,
        prompt: "noir lighting",
        alphaMode: "auto",
        userId: VALID_USER_ID,
      },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("VIDEO_TOO_MANY_FRAMES")
    expect(videoQueue.add).not.toHaveBeenCalled()
  })

  it("auto-trims a small overage: flags trimSourceToFrames=240, bills the 240f tier, enqueues (no reject)", async () => {
    // Estimate 250; exact decode confirms 250 — inside the ≤270 trim zone.
    mockProbeVideoFrames.mockResolvedValueOnce({ frames: 250, width: 1280, height: 720 })
    mockExactFrameCount.mockResolvedValueOnce(250)
    mockJobInsert({ data: { id: "job-trim" }, error: null })

    const res = await app.inject({
      method: "POST",
      url: "/v1/switchx",
      payload: { videoUrl: VALID_VIDEO_URL, prompt: "relight", alphaMode: "auto", maxResolution: 720, userId: VALID_USER_ID },
    })

    expect(res.statusCode).toBe(200)
    // Billed the 240-frame tier (the trimmed length), not a worst case.
    expect(vi.mocked(reserveCreditsForJob).mock.calls[0]?.[3]).toBe("beeble-switchx:240f:720p")
    // Worker is told to trim the source.
    expect(videoQueue.add).toHaveBeenCalledWith(
      "switchx",
      expect.objectContaining({ trimSourceToFrames: 240 }),
    )
  })

  it("does NOT trim when the exact decode shows the estimate over-counted (really ≤240)", async () => {
    // Cheap estimate 245, but the precise decode is 240 — proceed untouched.
    mockProbeVideoFrames.mockResolvedValueOnce({ frames: 245, width: 1280, height: 720 })
    mockExactFrameCount.mockResolvedValueOnce(240)
    mockJobInsert({ data: { id: "job-notrim" }, error: null })

    const res = await app.inject({
      method: "POST",
      url: "/v1/switchx",
      payload: { videoUrl: VALID_VIDEO_URL, prompt: "relight", alphaMode: "auto", maxResolution: 720, userId: VALID_USER_ID },
    })

    expect(res.statusCode).toBe(200)
    expect(vi.mocked(reserveCreditsForJob).mock.calls[0]?.[3]).toBe("beeble-switchx:240f:720p")
    expect(videoQueue.add).toHaveBeenCalledWith(
      "switchx",
      expect.objectContaining({ trimSourceToFrames: undefined }),
    )
  })

  it("returns 400 SOURCE_TOO_LARGE when width*height exceeds the pixel cap", async () => {
    // 1920*1450 = 2,784,000 > 2,770,000
    mockProbeVideoFrames.mockResolvedValueOnce({ frames: 90, width: 1920, height: 1450 })

    const res = await app.inject({
      method: "POST",
      url: "/v1/switchx",
      payload: {
        videoUrl: VALID_VIDEO_URL,
        prompt: "noir lighting",
        alphaMode: "auto",
        userId: VALID_USER_ID,
      },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("SOURCE_TOO_LARGE")
    expect(videoQueue.add).not.toHaveBeenCalled()
  })

  it("enqueues 'switchx' with the parsed fields on a valid auto request", async () => {
    const { mockFrom, mockInsert } = mockJobInsert({ data: { id: "job-sx" }, error: null })

    const res = await app.inject({
      method: "POST",
      url: "/v1/switchx",
      payload: {
        videoUrl: VALID_VIDEO_URL,
        prompt: "warm golden hour relight",
        alphaMode: "auto",
        maxResolution: 720,
        seed: 42,
        userId: VALID_USER_ID,
      },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().jobId).toBe("job-sx")
    expect(mockProbeVideoFrames).toHaveBeenCalledWith(VALID_VIDEO_URL)

    expect(mockFrom).toHaveBeenCalledWith("jobs")
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: VALID_USER_ID,
        status: "pending",
        input_data: expect.objectContaining({
          videoUrl: VALID_VIDEO_URL,
          prompt: "warm golden hour relight",
          alphaMode: "auto",
          type: "switchx",
        }),
      }),
    )

    expect(videoQueue.add).toHaveBeenCalledWith(
      "switchx",
      expect.objectContaining({
        jobId: "job-sx",
        videoUrl: VALID_VIDEO_URL,
        prompt: "warm golden hour relight",
        alphaMode: "auto",
        maxResolution: 720,
        seed: 42,
        usageLogId: "usage-1",
      }),
    )
    // The internal probe stash must NOT leak into the enqueued payload.
    const payload = vi.mocked(videoQueue.add).mock.calls[0]?.[1] as Record<string, unknown>
    expect(payload.__probedFrameCount).toBeUndefined()
  })

  it("reserves credits against the frame-tier composite resolved from the probed count", async () => {
    // 90 frames → 90f block tier; maxResolution 1080 (default) → beeble-switchx:90f:1080p
    mockProbeVideoFrames.mockResolvedValueOnce({ frames: 90, width: 1280, height: 720 })
    mockJobInsert({ data: { id: "job-res" }, error: null })

    const res = await app.inject({
      method: "POST",
      url: "/v1/switchx",
      payload: {
        videoUrl: VALID_VIDEO_URL,
        referenceImageUrl: VALID_REF_URL,
        alphaMode: "auto",
        userId: VALID_USER_ID,
      },
    })

    expect(res.statusCode).toBe(200)
    // reserveCreditsForJob(req, reply, jobId, modelId) — 4th arg is the credit id.
    const modelId = vi.mocked(reserveCreditsForJob).mock.calls[0]?.[3]
    expect(modelId).toBe("beeble-switchx:90f:1080p")
  })

  it("still reserves (worst-case 240f tier) and enqueues when the probe FAILS", async () => {
    mockProbeVideoFrames.mockRejectedValueOnce(new Error("ffprobe blew up"))
    mockJobInsert({ data: { id: "job-probefail" }, error: null })

    const res = await app.inject({
      method: "POST",
      url: "/v1/switchx",
      payload: {
        videoUrl: VALID_VIDEO_URL,
        prompt: "relight",
        alphaMode: "auto",
        maxResolution: 720,
        userId: VALID_USER_ID,
      },
    })

    expect(res.statusCode).toBe(200)
    const modelId = vi.mocked(reserveCreditsForJob).mock.calls[0]?.[3]
    expect(modelId).toBe("beeble-switchx:240f:720p")
    expect(videoQueue.add).toHaveBeenCalledWith("switchx", expect.objectContaining({ jobId: "job-probefail" }))
  })

  it("returns 401 when unauthenticated", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/switchx",
      payload: {
        videoUrl: VALID_VIDEO_URL,
        prompt: "relight",
        alphaMode: "auto",
        // no userId → no req.userId
      },
    })

    expect(res.statusCode).toBe(401)
    expect(res.json().error.code).toBe("unauthorized")
  })
})
