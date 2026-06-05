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

// ffprobe is mocked so the audio-mode reserve preHandler can be driven
// deterministically. probeMediaDuration returns a controllable duration; the
// default below (a short 12.3s clip) exercises the tight-bucket path.
const mockProbeMediaDuration = vi.fn().mockResolvedValue(12.3)
vi.mock("@/providers/video/ffmpeg-utils.js", () => ({
  probeMediaDuration: (...args: unknown[]) => mockProbeMediaDuration(...args),
}))

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { aiAvatarRoutes, probeAudioDurationPreHandler } from "../ai-avatar.js"
import { reserveCreditsForJob } from "../../middleware/credit-guard.js"
import { resolveAiAvatarCreditId } from "@nodaro/shared"
import { supabase } from "../../lib/supabase.js"
import { videoQueue } from "../../lib/queue.js"

// ---------------------------------------------------------------------------
// Test app setup
// ---------------------------------------------------------------------------

let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()
  // clearAllMocks resets the default implementation set at module scope.
  mockProbeMediaDuration.mockResolvedValue(12.3)

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

  it("returns 400 when image source mode is missing imageUrl", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/ai-avatar",
      payload: {
        avatarSource: "image",
        speechMode: "text",
        script: "Hello world",
        voiceId: "voice-abc",
        // imageUrl intentionally omitted
        userId: VALID_USER_ID,
      },
    })

    expect(res.statusCode).toBe(400)
    const body = res.json()
    expect(body.error.code).toBe("validation_error")
  })

  it("returns 400 when avatar source mode is missing avatarId", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/ai-avatar",
      payload: {
        // avatarSource defaults to "avatar"; avatarId intentionally omitted
        speechMode: "audio",
        audioUrl: VALID_AUDIO_URL,
        userId: VALID_USER_ID,
      },
    })

    expect(res.statusCode).toBe(400)
    const body = res.json()
    expect(body.error.code).toBe("validation_error")
  })

  it("image source mode: creates a job and enqueues avatarSource + imageUrl (no avatarId)", async () => {
    mockJobInsert({ data: { id: "job-img" }, error: null })

    const res = await app.inject({
      method: "POST",
      url: "/v1/ai-avatar",
      payload: {
        avatarSource: "image",
        imageUrl: "https://example.com/portrait.png",
        speechMode: "text",
        script: "Hello from a photo",
        voiceId: "voice-abc",
        resolution: "720p",
        aspectRatio: "16:9",
        userId: VALID_USER_ID,
      },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().jobId).toBe("job-img")

    expect(videoQueue.add).toHaveBeenCalledWith(
      "ai-avatar",
      expect.objectContaining({
        jobId: "job-img",
        avatarSource: "image",
        imageUrl: "https://example.com/portrait.png",
        speechMode: "text",
        script: "Hello from a photo",
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

// ---------------------------------------------------------------------------
// Audio-mode reserve: ffprobe preHandler buckets by ACTUAL clip length.
//
// The user-reported bug reserved the 900s TOP bucket for audio mode (clip
// length unknown at reserve), holding ~4020 credits for a sub-minute clip.
// The fix: an ffprobe preHandler stashes __probedDurationSec so the reserve
// buckets by the real duration; un-probed audio falls back to a modest 120s,
// never 900s. These tests assert the reserve credit id is the tight bucket.
// ---------------------------------------------------------------------------

describe("ai-avatar audio-mode reserve bucketing", () => {
  it("reserves the tight probed bucket (15s) for a ~12.3s clip, NOT the 900s top bucket", async () => {
    mockProbeMediaDuration.mockResolvedValueOnce(12.3) // ceil → 13s → 15s bucket
    mockJobInsert({ data: { id: "job-audio" }, error: null })

    const res = await app.inject({
      method: "POST",
      url: "/v1/ai-avatar",
      payload: {
        avatarId: "avatar-123",
        engine: "avatar-iv",
        speechMode: "audio",
        audioUrl: VALID_AUDIO_URL,
        resolution: "720p",
        userId: VALID_USER_ID,
      },
    })

    expect(res.statusCode).toBe(200)
    expect(mockProbeMediaDuration).toHaveBeenCalledWith(VALID_AUDIO_URL)

    // reserveCreditsForJob(req, reply, jobId, modelId) — 4th arg is the model id.
    const modelId = vi.mocked(reserveCreditsForJob).mock.calls[0]?.[3]
    expect(modelId).toBe("heygen-avatar-iv:720p:15s")
    expect(modelId).not.toBe("heygen-avatar-iv:720p:900s")
  })

  it("falls back to the 120s bucket (NOT 900s) when the audio probe fails", async () => {
    mockProbeMediaDuration.mockRejectedValueOnce(new Error("ffprobe failed"))
    mockJobInsert({ data: { id: "job-audio-fail" }, error: null })

    const res = await app.inject({
      method: "POST",
      url: "/v1/ai-avatar",
      payload: {
        avatarId: "avatar-123",
        engine: "avatar-iv",
        speechMode: "audio",
        audioUrl: VALID_AUDIO_URL,
        resolution: "720p",
        userId: VALID_USER_ID,
      },
    })

    expect(res.statusCode).toBe(200)
    const modelId = vi.mocked(reserveCreditsForJob).mock.calls[0]?.[3]
    expect(modelId).toBe("heygen-avatar-iv:720p:120s")
    expect(modelId).not.toBe("heygen-avatar-iv:720p:900s")
  })
})

describe("probeAudioDurationPreHandler", () => {
  const makeReq = (body: Record<string, unknown>) =>
    ({ body, log: { warn: vi.fn() } }) as never
  const makeReply = () => ({}) as never

  beforeEach(() => {
    mockProbeMediaDuration.mockReset().mockResolvedValue(12.3)
  })

  it("stashes ceil(__probedDurationSec) on the body in audio mode", async () => {
    mockProbeMediaDuration.mockResolvedValueOnce(12.3)
    const body: Record<string, unknown> = { speechMode: "audio", audioUrl: VALID_AUDIO_URL }
    await probeAudioDurationPreHandler(makeReq(body), makeReply())
    expect(body.__probedDurationSec).toBe(13)
    expect(resolveAiAvatarCreditId(body)).toBe("heygen-avatar-iv:720p:15s")
  })

  it("does NOT probe in text mode", async () => {
    const body: Record<string, unknown> = { speechMode: "text", script: "hi", voiceId: "v" }
    await probeAudioDurationPreHandler(makeReq(body), makeReply())
    expect(mockProbeMediaDuration).not.toHaveBeenCalled()
    expect(body.__probedDurationSec).toBeUndefined()
  })

  it("does NOT probe when audioUrl is missing", async () => {
    const body: Record<string, unknown> = { speechMode: "audio" }
    await probeAudioDurationPreHandler(makeReq(body), makeReply())
    expect(mockProbeMediaDuration).not.toHaveBeenCalled()
    expect(body.__probedDurationSec).toBeUndefined()
  })

  it("leaves __probedDurationSec unset on probe failure (120s fallback path)", async () => {
    mockProbeMediaDuration.mockRejectedValueOnce(new Error("boom"))
    const body: Record<string, unknown> = { speechMode: "audio", audioUrl: VALID_AUDIO_URL }
    await probeAudioDurationPreHandler(makeReq(body), makeReply())
    expect(body.__probedDurationSec).toBeUndefined()
    expect(resolveAiAvatarCreditId(body)).toBe("heygen-avatar-iv:720p:120s")
  })
})
