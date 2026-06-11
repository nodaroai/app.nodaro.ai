import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

// ---------------------------------------------------------------------------
// Mocks — hoisted before any route import
// ---------------------------------------------------------------------------

vi.mock("@/lib/supabase.js", () => {
  const mockFrom = vi.fn().mockReturnValue({
    insert: vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValue({ data: { id: "job-1" }, error: null }) }) }),
    select: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValue({ data: { id: "user-123", tier: "pro" }, error: null }) }) }),
    update: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) }),
  })
  return {
    supabase: {
      from: mockFrom,
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-123" } }, error: null }) },
    },
  }
})

vi.mock("@/lib/queue.js", () => ({
  videoQueue: { add: vi.fn().mockResolvedValue({ id: "queue-job-1" }) },
  redis: {},
}))

vi.mock("@/middleware/credit-guard.js", () => ({
  creditGuard: () => async () => {},
  reserveCreditsForJob: vi.fn().mockResolvedValue({ usageLogId: "u-1", creditsReserved: 1, watermark: false }),
}))

vi.mock("@/lib/admin-check.js", () => ({ warmAdminCache: vi.fn(), checkIsAdmin: vi.fn().mockResolvedValue(false) }))

vi.mock("@/lib/config.js", () => ({
  config: { EDITION: "cloud", SUPABASE_URL: "https://test.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "test" },
  isCloud: () => true, hasCredits: () => true, isCommunity: () => false, isBusiness: () => false, hasAdmin: () => true,
}))

vi.mock("@/lib/url-validator.js", async () => {
  const { z } = await import("zod")
  return { safeUrlSchema: z.string().url() }
})

vi.mock("@/lib/request-helpers.js", () => ({
  extractWorkflowId: vi.fn().mockReturnValue(null),
  extractForcePrivate: vi.fn().mockReturnValue(false),
  extractProvider: vi.fn((body: any, fallback: string) => body?.provider ?? fallback),
  ACTIVE_EXECUTION_STATUSES: ["pending", "running", "stopping"],
}))

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { extendVideoRoutes } from "../extend-video.js"
import { videoQueue } from "@/lib/queue.js"
import { reserveCreditsForJob } from "@/middleware/credit-guard.js"
import { videoUpscaleRoutes } from "../video-upscale.js"
import { motionTransferRoutes } from "../motion-transfer.js"
import { lipSyncRoutes } from "../lip-sync.js"
import { speechToVideoRoutes } from "../speech-to-video.js"
import { videoToVideoRoutes } from "../video-to-video.js"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALID_UUID = "00000000-0000-4000-8000-000000000001"

function createApp(registerFn: (app: FastifyInstance) => Promise<void>) {
  const app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    const body = req.body as Record<string, unknown> | undefined
    if (body?.userId && typeof body.userId === "string") {
      req.userId = body.userId
      req.userRole = undefined
    }
  })
  return app
}

// ---------------------------------------------------------------------------
// 1. extend-video
// ---------------------------------------------------------------------------

describe("POST /v1/extend-video — Zod validation", () => {
  let app: FastifyInstance

  beforeEach(async () => {
    vi.clearAllMocks()
    app = createApp(extendVideoRoutes)
    await app.register(async (i) => { await extendVideoRoutes(i) })
    await app.ready()
  })

  afterEach(async () => { await app.close() })

  const validBody = {
    kieTaskId: "task-123",
    prompt: "extend this",
    provider: "veo-extend",
    userId: "user-123",
  }

  it("accepts a valid body", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/extend-video", payload: validBody })
    expect(res.statusCode).not.toBe(400)
  })

  it("rejects missing kieTaskId", async () => {
    const { kieTaskId: _, ...body } = validBody
    const res = await app.inject({ method: "POST", url: "/v1/extend-video", payload: body })
    expect(res.statusCode).toBe(400)
  })

  it("rejects missing prompt", async () => {
    const { prompt: _, ...body } = validBody
    const res = await app.inject({ method: "POST", url: "/v1/extend-video", payload: body })
    expect(res.statusCode).toBe(400)
  })

  it("rejects invalid provider", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/extend-video", payload: { ...validBody, provider: "invalid" } })
    expect(res.statusCode).toBe(400)
  })

  it("accepts provider runway-extend", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/extend-video", payload: { ...validBody, provider: "runway-extend" } })
    expect(res.statusCode).not.toBe(400)
  })

  it("accepts optional model 'fast'", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/extend-video", payload: { ...validBody, model: "fast" } })
    expect(res.statusCode).not.toBe(400)
  })

  it("accepts optional quality '720p'", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/extend-video", payload: { ...validBody, quality: "720p" } })
    expect(res.statusCode).not.toBe(400)
  })

  // — seedance-2-extend: URL-based trim-stitch extend —

  const seedanceBody = {
    videoUrl: "https://example.com/source.mp4",
    prompt: "the ball keeps rolling until it hits a cup",
    provider: "seedance-2-extend",
    userId: "user-123",
  }

  it("accepts a valid seedance-2-extend body (videoUrl + prompt, no kieTaskId)", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/extend-video", payload: seedanceBody })
    expect(res.statusCode).toBe(200)
    expect(res.json().jobId).toBe("job-1")
  })

  it("rejects seedance-2-extend without videoUrl", async () => {
    const { videoUrl: _, ...body } = seedanceBody
    const res = await app.inject({ method: "POST", url: "/v1/extend-video", payload: body })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.message).toMatch(/videoUrl/)
  })

  it("rejects seedance-2-extend without prompt (continuation content is required)", async () => {
    const { prompt: _, ...body } = seedanceBody
    const res = await app.inject({ method: "POST", url: "/v1/extend-video", payload: body })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.message).toMatch(/prompt/)
  })

  it("accepts seedance resolutions 480p/720p/1080p, rejects 4K", async () => {
    for (const resolution of ["480p", "720p", "1080p"]) {
      const res = await app.inject({ method: "POST", url: "/v1/extend-video", payload: { ...seedanceBody, resolution } })
      expect(res.statusCode).not.toBe(400)
    }
    const bad = await app.inject({ method: "POST", url: "/v1/extend-video", payload: { ...seedanceBody, resolution: "4K" } })
    expect(bad.statusCode).toBe(400)
  })

  it("rejects non-boolean generateAudio", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/extend-video", payload: { ...seedanceBody, generateAudio: "yes" } })
    expect(res.statusCode).toBe(400)
  })

  it("queues the URL-shaped seedance payload (video/prompt/duration/resolution/generateAudio)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/extend-video",
      payload: { ...seedanceBody, duration: 12, resolution: "1080p", generateAudio: false },
    })
    expect(res.statusCode).toBe(200)
    expect(vi.mocked(videoQueue.add)).toHaveBeenCalledWith("extend-video", expect.objectContaining({
      jobId: "job-1",
      provider: "seedance-2-extend",
      video: seedanceBody.videoUrl,
      prompt: seedanceBody.prompt,
      duration: 12,
      resolution: "1080p",
      generateAudio: false,
      usageLogId: "u-1",
    }))
    const payload = vi.mocked(videoQueue.add).mock.calls[0]![1] as Record<string, unknown>
    expect(payload.kieTaskId).toBeUndefined()
  })

  it("reserves credits at the duration×resolution composite (default 8s/720p)", async () => {
    await app.inject({ method: "POST", url: "/v1/extend-video", payload: seedanceBody })
    expect(vi.mocked(reserveCreditsForJob).mock.calls[0]![3]).toBe("seedance-2-extend:8s:720p")

    vi.clearAllMocks()
    await app.inject({ method: "POST", url: "/v1/extend-video", payload: { ...seedanceBody, duration: 12, resolution: "1080p" } })
    expect(vi.mocked(reserveCreditsForJob).mock.calls[0]![3]).toBe("seedance-2-extend:12s:1080p")
  })
})

// ---------------------------------------------------------------------------
// 2. video-upscale
// ---------------------------------------------------------------------------

describe("POST /v1/video-upscale — Zod validation", () => {
  let app: FastifyInstance

  beforeEach(async () => {
    vi.clearAllMocks()
    app = createApp(videoUpscaleRoutes)
    await app.register(async (i) => { await videoUpscaleRoutes(i) })
    await app.ready()
  })

  afterEach(async () => { await app.close() })

  const validBody = {
    videoUrl: "https://example.com/v.mp4",
    provider: "topaz",
    userId: "user-123",
  }

  it("accepts a valid body", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/video-upscale", payload: validBody })
    expect(res.statusCode).not.toBe(400)
  })

  it("rejects invalid provider", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/video-upscale", payload: { ...validBody, provider: "invalid" } })
    expect(res.statusCode).toBe(400)
  })

  it("accepts provider veo-1080p", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/video-upscale", payload: { ...validBody, videoUrl: undefined, kieTaskId: "task-1", provider: "veo-1080p" } })
    expect(res.statusCode).not.toBe(400)
  })

  it("accepts provider veo-4k", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/video-upscale", payload: { ...validBody, videoUrl: undefined, kieTaskId: "task-1", provider: "veo-4k" } })
    expect(res.statusCode).not.toBe(400)
  })

  it("accepts upscaleFactor '1'", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/video-upscale", payload: { ...validBody, upscaleFactor: "1" } })
    expect(res.statusCode).not.toBe(400)
  })

  it("accepts upscaleFactor '2'", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/video-upscale", payload: { ...validBody, upscaleFactor: "2" } })
    expect(res.statusCode).not.toBe(400)
  })

  it("accepts upscaleFactor '4'", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/video-upscale", payload: { ...validBody, upscaleFactor: "4" } })
    expect(res.statusCode).not.toBe(400)
  })

  it("rejects upscaleFactor '5'", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/video-upscale", payload: { ...validBody, upscaleFactor: "5" } })
    expect(res.statusCode).toBe(400)
  })

  it("rejects when both videoUrl and kieTaskId are missing (topaz)", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/video-upscale", payload: { provider: "topaz", userId: "user-123" } })
    expect(res.statusCode).toBe(400)
  })
})

// ---------------------------------------------------------------------------
// 3. motion-transfer
// ---------------------------------------------------------------------------

describe("POST /v1/motion-transfer — Zod validation", () => {
  let app: FastifyInstance

  beforeEach(async () => {
    vi.clearAllMocks()
    app = createApp(motionTransferRoutes)
    await app.register(async (i) => { await motionTransferRoutes(i) })
    await app.ready()
  })

  afterEach(async () => { await app.close() })

  const validBody = {
    imageUrl: "https://example.com/img.jpg",
    videoUrl: "https://example.com/v.mp4",
    provider: "kling",
    userId: "user-123",
  }

  it("accepts a valid body", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/motion-transfer", payload: validBody })
    expect(res.statusCode).not.toBe(400)
  })

  it("rejects missing imageUrl", async () => {
    const { imageUrl: _, ...body } = validBody
    const res = await app.inject({ method: "POST", url: "/v1/motion-transfer", payload: body })
    expect(res.statusCode).toBe(400)
  })

  it("rejects missing videoUrl", async () => {
    const { videoUrl: _, ...body } = validBody
    const res = await app.inject({ method: "POST", url: "/v1/motion-transfer", payload: body })
    expect(res.statusCode).toBe(400)
  })

  it("rejects invalid provider", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/motion-transfer", payload: { ...validBody, provider: "invalid" } })
    expect(res.statusCode).toBe(400)
  })

  it("accepts provider kling-3.0", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/motion-transfer", payload: { ...validBody, provider: "kling-3.0" } })
    expect(res.statusCode).not.toBe(400)
  })

  it("accepts provider wan-animate-move", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/motion-transfer", payload: { ...validBody, provider: "wan-animate-move" } })
    expect(res.statusCode).not.toBe(400)
  })

  it("accepts provider wan-animate-replace", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/motion-transfer", payload: { ...validBody, provider: "wan-animate-replace" } })
    expect(res.statusCode).not.toBe(400)
  })

  it("accepts resolution 480p", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/motion-transfer", payload: { ...validBody, resolution: "480p" } })
    expect(res.statusCode).not.toBe(400)
  })

  it("accepts resolution 720p", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/motion-transfer", payload: { ...validBody, resolution: "720p" } })
    expect(res.statusCode).not.toBe(400)
  })

  it("accepts resolution 1080p", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/motion-transfer", payload: { ...validBody, resolution: "1080p" } })
    expect(res.statusCode).not.toBe(400)
  })

  it("rejects resolution '4K'", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/motion-transfer", payload: { ...validBody, resolution: "4K" } })
    expect(res.statusCode).toBe(400)
  })

  it("accepts characterOrientation 'image'", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/motion-transfer", payload: { ...validBody, characterOrientation: "image" } })
    expect(res.statusCode).not.toBe(400)
  })

  it("accepts characterOrientation 'video'", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/motion-transfer", payload: { ...validBody, characterOrientation: "video" } })
    expect(res.statusCode).not.toBe(400)
  })
})

// ---------------------------------------------------------------------------
// 4. lip-sync
// ---------------------------------------------------------------------------

describe("POST /v1/lip-sync — Zod validation", () => {
  let app: FastifyInstance

  beforeEach(async () => {
    vi.clearAllMocks()
    app = createApp(lipSyncRoutes)
    await app.register(async (i) => { await lipSyncRoutes(i) })
    await app.ready()
  })

  afterEach(async () => { await app.close() })

  const validBody = {
    imageUrl: "https://example.com/img.jpg",
    audioUrl: "https://example.com/a.mp3",
    userId: VALID_UUID,
  }

  it("accepts a valid body", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/lip-sync", payload: validBody })
    expect(res.statusCode).not.toBe(400)
  })

  it("rejects missing imageUrl", async () => {
    const { imageUrl: _, ...body } = validBody
    const res = await app.inject({ method: "POST", url: "/v1/lip-sync", payload: body })
    expect(res.statusCode).toBe(400)
  })

  it("rejects missing audioUrl", async () => {
    const { audioUrl: _, ...body } = validBody
    const res = await app.inject({ method: "POST", url: "/v1/lip-sync", payload: body })
    expect(res.statusCode).toBe(400)
  })

  it("rejects invalid provider", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/lip-sync", payload: { ...validBody, provider: "invalid" } })
    expect(res.statusCode).toBe(400)
  })

  it("accepts provider kling-avatar", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/lip-sync", payload: { ...validBody, provider: "kling-avatar" } })
    expect(res.statusCode).not.toBe(400)
  })

  it("accepts provider kling-avatar-pro", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/lip-sync", payload: { ...validBody, provider: "kling-avatar-pro" } })
    expect(res.statusCode).not.toBe(400)
  })

  it("accepts provider infinitalk", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/lip-sync", payload: { ...validBody, provider: "infinitalk" } })
    expect(res.statusCode).not.toBe(400)
  })

  it("accepts resolution 480p", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/lip-sync", payload: { ...validBody, resolution: "480p" } })
    expect(res.statusCode).not.toBe(400)
  })

  it("accepts resolution 720p", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/lip-sync", payload: { ...validBody, resolution: "720p" } })
    expect(res.statusCode).not.toBe(400)
  })
})

// ---------------------------------------------------------------------------
// 5. speech-to-video
// ---------------------------------------------------------------------------

describe("POST /v1/speech-to-video — Zod validation", () => {
  let app: FastifyInstance

  beforeEach(async () => {
    vi.clearAllMocks()
    app = createApp(speechToVideoRoutes)
    await app.register(async (i) => { await speechToVideoRoutes(i) })
    await app.ready()
  })

  afterEach(async () => { await app.close() })

  const validBody = {
    imageUrl: "https://example.com/img.jpg",
    audioUrl: "https://example.com/a.mp3",
    prompt: "talking head",
    userId: VALID_UUID,
  }

  it("accepts a valid body", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/speech-to-video", payload: validBody })
    expect(res.statusCode).not.toBe(400)
  })

  it("rejects missing prompt", async () => {
    const { prompt: _, ...body } = validBody
    const res = await app.inject({ method: "POST", url: "/v1/speech-to-video", payload: body })
    expect(res.statusCode).toBe(400)
  })

  it("rejects missing imageUrl", async () => {
    const { imageUrl: _, ...body } = validBody
    const res = await app.inject({ method: "POST", url: "/v1/speech-to-video", payload: body })
    expect(res.statusCode).toBe(400)
  })

  it("accepts resolution 480p", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/speech-to-video", payload: { ...validBody, resolution: "480p" } })
    expect(res.statusCode).not.toBe(400)
  })

  it("accepts resolution 580p", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/speech-to-video", payload: { ...validBody, resolution: "580p" } })
    expect(res.statusCode).not.toBe(400)
  })

  it("accepts resolution 720p", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/speech-to-video", payload: { ...validBody, resolution: "720p" } })
    expect(res.statusCode).not.toBe(400)
  })

  it("rejects resolution 1080p", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/speech-to-video", payload: { ...validBody, resolution: "1080p" } })
    expect(res.statusCode).toBe(400)
  })

  it("accepts numFrames 16 (lower bound)", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/speech-to-video", payload: { ...validBody, numFrames: 16 } })
    expect(res.statusCode).not.toBe(400)
  })

  it("accepts numFrames 81 (upper bound)", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/speech-to-video", payload: { ...validBody, numFrames: 81 } })
    expect(res.statusCode).not.toBe(400)
  })

  it("rejects numFrames 82 (above upper bound)", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/speech-to-video", payload: { ...validBody, numFrames: 82 } })
    expect(res.statusCode).toBe(400)
  })

  it("rejects numFrames 15 (below lower bound)", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/speech-to-video", payload: { ...validBody, numFrames: 15 } })
    expect(res.statusCode).toBe(400)
  })
})

// ---------------------------------------------------------------------------
// 6. video-to-video — wan-videoedit params
// ---------------------------------------------------------------------------

describe("POST /v1/video-to-video — wan-videoedit Zod validation", () => {
  let app: FastifyInstance

  beforeEach(async () => {
    vi.clearAllMocks()
    app = createApp(videoToVideoRoutes)
    await app.register(async (i) => { await videoToVideoRoutes(i) })
    await app.ready()
  })

  afterEach(async () => { await app.close() })

  const validBody = {
    videoUrl: "https://example.com/v.mp4",
    provider: "wan-videoedit",
    prompt: "remove the background",
    negativePrompt: "blur, artifacts",
    videoEditDuration: "5",
    audioSetting: "auto",
    promptExtend: true,
    userId: "user-123",
  }

  it("accepts a valid wan-videoedit body with all new fields", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/video-to-video", payload: validBody })
    expect(res.statusCode).toBe(200)
    expect(res.json().jobId).toBe("job-1")
  })

  it("accepts videoEditDuration '0'", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/video-to-video", payload: { ...validBody, videoEditDuration: "0" } })
    expect(res.statusCode).not.toBe(400)
  })

  it("accepts videoEditDuration '10'", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/video-to-video", payload: { ...validBody, videoEditDuration: "10" } })
    expect(res.statusCode).not.toBe(400)
  })

  it("accepts audioSetting 'origin'", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/video-to-video", payload: { ...validBody, audioSetting: "origin" } })
    expect(res.statusCode).not.toBe(400)
  })

  it("rejects invalid audioSetting", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/video-to-video", payload: { ...validBody, audioSetting: "invalid-value" } })
    expect(res.statusCode).toBe(400)
  })

  it("rejects videoEditDuration not in enum", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/video-to-video", payload: { ...validBody, videoEditDuration: "99" } })
    expect(res.statusCode).toBe(400)
  })

  it("rejects negativePrompt longer than 500 chars", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/video-to-video", payload: { ...validBody, negativePrompt: "x".repeat(501) } })
    expect(res.statusCode).toBe(400)
  })

  it("rejects non-boolean promptExtend", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/video-to-video", payload: { ...validBody, promptExtend: "yes" } })
    expect(res.statusCode).toBe(400)
  })
})
