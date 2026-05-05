import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance, type FastifyPluginAsync } from "fastify"

// ---------------------------------------------------------------------------
// Mocks -- hoisted before any route import
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
    creditsReserved: 0,
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

import { trimVideoRoutes } from "../trim-video.js"
import { combineVideosRoutes } from "../combine-videos.js"
import { resizeVideoRoutes } from "../resize-video.js"
import { speedRampRoutes } from "../speed-ramp.js"
import { fadeVideoRoutes } from "../fade-video.js"
import { loopVideoRoutes } from "../loop-video.js"
import { mergeVideoAudioRoutes } from "../merge-video-audio.js"
import { trimAudioRoutes } from "../trim-audio.js"
import { mixAudioRoutes } from "../mix-audio.js"
import { adjustVolumeRoutes } from "../adjust-volume.js"
import { addCaptionsRoutes } from "../add-captions.js"
import { transcodeVideoRoutes } from "../transcode-video.js"
import { supabase } from "../../lib/supabase.js"
import { videoQueue } from "../../lib/queue.js"

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VALID_UUID = "00000000-0000-4000-8000-000000000001"
const EXAMPLE_VIDEO_URL = "https://example.com/video.mp4"
const EXAMPLE_AUDIO_URL = "https://example.com/audio.mp3"

// ---------------------------------------------------------------------------
// Route configuration table
// ---------------------------------------------------------------------------

interface FFmpegRouteConfig {
  name: string
  path: string
  routeFn: (app: FastifyInstance) => Promise<void>
  /** The field name whose absence triggers a 400 validation error */
  requiredField: string
  /** A payload missing the required field (but including userId) */
  invalidPayload: Record<string, unknown>
  /** A complete valid payload including userId */
  validPayload: Record<string, unknown>
  /** The queue job type string (matches the first arg to videoQueue.add) */
  queueJobType: string
}

const FFMPEG_ROUTES: FFmpegRouteConfig[] = [
  {
    name: "trim-video",
    path: "/v1/trim-video",
    routeFn: trimVideoRoutes,
    requiredField: "videoUrl",
    invalidPayload: { userId: VALID_UUID, startTime: 0, endTime: 10 },
    validPayload: { userId: VALID_UUID, videoUrl: EXAMPLE_VIDEO_URL, startTime: 0, endTime: 10 },
    queueJobType: "trim-video",
  },
  {
    name: "combine-videos",
    path: "/v1/combine-videos",
    routeFn: combineVideosRoutes,
    requiredField: "videoUrls",
    invalidPayload: { userId: VALID_UUID },
    validPayload: {
      userId: VALID_UUID,
      videoUrls: [EXAMPLE_VIDEO_URL, "https://example.com/video2.mp4"],
    },
    queueJobType: "combine-videos",
  },
  {
    name: "resize-video",
    path: "/v1/resize-video",
    routeFn: resizeVideoRoutes,
    requiredField: "targetAspect",
    invalidPayload: { userId: VALID_UUID, videoUrl: EXAMPLE_VIDEO_URL },
    validPayload: {
      userId: VALID_UUID,
      videoUrl: EXAMPLE_VIDEO_URL,
      targetAspect: "16:9",
    },
    queueJobType: "resize-video",
  },
  {
    name: "speed-ramp",
    path: "/v1/speed-ramp",
    routeFn: speedRampRoutes,
    requiredField: "speed",
    invalidPayload: { userId: VALID_UUID, videoUrl: EXAMPLE_VIDEO_URL },
    validPayload: {
      userId: VALID_UUID,
      videoUrl: EXAMPLE_VIDEO_URL,
      speed: 2.0,
    },
    queueJobType: "speed-ramp",
  },
  {
    name: "fade-video",
    path: "/v1/fade-video",
    routeFn: fadeVideoRoutes,
    requiredField: "fadeIn",
    invalidPayload: { userId: VALID_UUID, videoUrl: EXAMPLE_VIDEO_URL },
    validPayload: {
      userId: VALID_UUID,
      videoUrl: EXAMPLE_VIDEO_URL,
      fadeIn: true,
      fadeInDuration: 1.0,
      fadeOut: false,
      fadeOutDuration: 1.0,
      color: "black",
    },
    queueJobType: "fade-video",
  },
  {
    name: "loop-video",
    path: "/v1/loop-video",
    routeFn: loopVideoRoutes,
    requiredField: "mode",
    invalidPayload: { userId: VALID_UUID, videoUrl: EXAMPLE_VIDEO_URL },
    validPayload: {
      userId: VALID_UUID,
      videoUrl: EXAMPLE_VIDEO_URL,
      mode: "repeat",
      repeatCount: 3,
    },
    queueJobType: "loop-video",
  },
  {
    name: "merge-video-audio",
    path: "/v1/merge-video-audio",
    routeFn: mergeVideoAudioRoutes,
    requiredField: "videoUrl",
    invalidPayload: { userId: VALID_UUID, audioUrl: EXAMPLE_AUDIO_URL },
    validPayload: {
      userId: VALID_UUID,
      videoUrl: EXAMPLE_VIDEO_URL,
      audioUrl: EXAMPLE_AUDIO_URL,
    },
    queueJobType: "merge-video-audio",
  },
  {
    name: "trim-audio",
    path: "/v1/trim-audio",
    routeFn: trimAudioRoutes,
    requiredField: "videoUrl",
    invalidPayload: { userId: VALID_UUID },
    validPayload: {
      userId: VALID_UUID,
      videoUrl: EXAMPLE_VIDEO_URL,
    },
    queueJobType: "trim-audio",
  },
  {
    name: "mix-audio",
    path: "/v1/mix-audio",
    routeFn: mixAudioRoutes,
    requiredField: "audioUrls",
    invalidPayload: { userId: VALID_UUID },
    validPayload: {
      userId: VALID_UUID,
      audioUrls: [EXAMPLE_AUDIO_URL, "https://example.com/audio2.mp3"],
    },
    queueJobType: "mix-audio",
  },
  {
    name: "adjust-volume",
    path: "/v1/adjust-volume",
    routeFn: adjustVolumeRoutes,
    requiredField: "audioUrl or videoUrl",
    invalidPayload: { userId: VALID_UUID },
    validPayload: {
      userId: VALID_UUID,
      audioUrl: EXAMPLE_AUDIO_URL,
      volume: 150,
    },
    queueJobType: "adjust-volume",
  },
  {
    name: "add-captions",
    path: "/v1/add-captions",
    routeFn: addCaptionsRoutes,
    // text is optional (kinetic styles can use captions[] or auto_transcribe).
    // The schema's superRefine rejects only when ALL caption sources are absent
    // AND auto_transcribe is explicitly disabled — represent that as the missing-field case.
    requiredField: "any caption source",
    invalidPayload: { userId: VALID_UUID, videoUrl: EXAMPLE_VIDEO_URL, auto_transcribe: false },
    validPayload: {
      userId: VALID_UUID,
      videoUrl: EXAMPLE_VIDEO_URL,
      text: "Hello world captions",
    },
    queueJobType: "add-captions",
  },
  {
    name: "transcode-video",
    path: "/v1/transcode-video",
    routeFn: transcodeVideoRoutes,
    requiredField: "videoUrl",
    invalidPayload: { userId: VALID_UUID },
    validPayload: {
      userId: VALID_UUID,
      videoUrl: EXAMPLE_VIDEO_URL,
    },
    queueJobType: "transcode-video",
  },
]

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockJobInsert(result: { data: unknown; error: unknown }): {
  mockFrom: ReturnType<typeof vi.fn>
  mockInsert: ReturnType<typeof vi.fn>
} {
  const mockSingle = vi.fn().mockResolvedValue(result)
  const mockSelect = vi.fn().mockReturnValue({ single: mockSingle })
  const mockInsert = vi.fn().mockReturnValue({ select: mockSelect })
  const mockFrom = vi.mocked(supabase.from)
  mockFrom.mockReturnValue({ insert: mockInsert } as never)
  return { mockFrom, mockInsert }
}

function stripUserId(payload: Record<string, unknown>): Record<string, unknown> {
  const { userId, ...rest } = payload
  return rest
}

// ---------------------------------------------------------------------------
// Test app setup -- register ALL FFmpeg routes in a single instance
// ---------------------------------------------------------------------------

let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()

  app = Fastify({ logger: false })

  // Bypass auth -- set userId from request body for protected routes
  app.addHook("preHandler", async (req) => {
    const body = req.body as Record<string, unknown> | undefined
    if (body?.userId && typeof body.userId === "string") {
      req.userId = body.userId
      req.userRole = undefined
    }
  })

  for (const route of FFMPEG_ROUTES) {
    await app.register(async (instance) => {
      await route.routeFn(instance)
    })
  }

  await app.ready()
})

afterEach(async () => {
  await app.close()
})

// ---------------------------------------------------------------------------
// Parameterized tests
// ---------------------------------------------------------------------------

describe.each(FFMPEG_ROUTES)(
  "POST $path ($name)",
  ({ name, path, requiredField, invalidPayload, validPayload, queueJobType }) => {
    it(`returns 400 when ${requiredField} is missing`, async () => {
      const res = await app.inject({
        method: "POST",
        url: path,
        payload: invalidPayload,
      })

      expect(res.statusCode).toBe(400)
      const body = res.json()
      expect(body.error.code).toBe("validation_error")
    })

    it("returns 401 when userId is not provided", async () => {
      // Send a valid payload minus the userId field
      const payloadWithoutUser = stripUserId(validPayload)

      const res = await app.inject({
        method: "POST",
        url: path,
        payload: payloadWithoutUser,
      })

      expect(res.statusCode).toBe(401)
      const body = res.json()
      expect(body.error.code).toBe("unauthorized")
    })

    it("creates job with node-specific modelIdentifier and enqueues to videoQueue", async () => {
      const { mockFrom, mockInsert } = mockJobInsert({
        data: { id: "job-1" },
        error: null,
      })

      const res = await app.inject({
        method: "POST",
        url: path,
        payload: validPayload,
      })

      expect(res.statusCode).toBe(200)
      const body = res.json()
      expect(body.jobId).toBe("job-1")

      // Verify supabase job insert
      expect(mockFrom).toHaveBeenCalledWith("jobs")
      expect(mockInsert).toHaveBeenCalledWith(
        expect.objectContaining({
          user_id: VALID_UUID,
          status: "pending",
          input_data: expect.objectContaining({
            type: queueJobType,
          }),
        })
      )

      // Verify job was enqueued to videoQueue with correct type
      expect(videoQueue.add).toHaveBeenCalledWith(
        queueJobType,
        expect.objectContaining({
          jobId: "job-1",
          usageLogId: "usage-1",
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
        url: path,
        payload: validPayload,
      })

      expect(res.statusCode).toBe(500)
      const body = res.json()
      expect(body.error.code).toBe("internal_error")
    })
  }
)
