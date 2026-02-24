import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

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

vi.mock("@/lib/app-settings.js", () => ({
  getAppSettings: vi.fn().mockResolvedValue({ ai_provider: "kie" }),
}))

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { audioIsolationRoutes } from "../audio-isolation.js"
import { lipSyncRoutes } from "../lip-sync.js"
import { videoToVideoRoutes } from "../video-to-video.js"
import { videoUpscaleRoutes } from "../video-upscale.js"
import { motionTransferRoutes } from "../motion-transfer.js"
import { transcribeRoutes } from "../transcribe.js"
import { supabase } from "../../lib/supabase.js"
import { videoQueue } from "../../lib/queue.js"

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VALID_UUID = "00000000-0000-4000-8000-000000000001"
const EXAMPLE_VIDEO_URL = "https://example.com/video.mp4"
const EXAMPLE_AUDIO_URL = "https://example.com/audio.mp3"
const EXAMPLE_IMAGE_URL = "https://example.com/image.png"

// ---------------------------------------------------------------------------
// Route configuration table
// ---------------------------------------------------------------------------

interface AIRouteConfig {
  name: string
  path: string
  routeFn: (app: FastifyInstance) => Promise<void>
  requiredField: string
  invalidPayload: Record<string, unknown>
  validPayload: Record<string, unknown>
  queueJobType: string
}

const AI_ROUTES: AIRouteConfig[] = [
  {
    name: "audio-isolation",
    path: "/v1/audio-isolation",
    routeFn: audioIsolationRoutes,
    requiredField: "audioUrl",
    invalidPayload: { userId: VALID_UUID },
    validPayload: { userId: VALID_UUID, audioUrl: EXAMPLE_AUDIO_URL },
    queueJobType: "audio-isolation",
  },
  {
    name: "lip-sync",
    path: "/v1/lip-sync",
    routeFn: lipSyncRoutes,
    requiredField: "audioUrl",
    invalidPayload: { userId: VALID_UUID, imageUrl: EXAMPLE_IMAGE_URL },
    validPayload: {
      userId: VALID_UUID,
      imageUrl: EXAMPLE_IMAGE_URL,
      audioUrl: EXAMPLE_AUDIO_URL,
    },
    queueJobType: "lip-sync",
  },
  {
    name: "video-to-video",
    path: "/v1/video-to-video",
    routeFn: videoToVideoRoutes,
    requiredField: "videoUrl",
    invalidPayload: { userId: VALID_UUID },
    validPayload: { userId: VALID_UUID, videoUrl: EXAMPLE_VIDEO_URL },
    queueJobType: "video-to-video",
  },
  {
    name: "video-upscale",
    path: "/v1/video-upscale",
    routeFn: videoUpscaleRoutes,
    requiredField: "videoUrl",
    invalidPayload: { userId: VALID_UUID },
    validPayload: { userId: VALID_UUID, videoUrl: EXAMPLE_VIDEO_URL },
    queueJobType: "video-upscale",
  },
  {
    name: "motion-transfer",
    path: "/v1/motion-transfer",
    routeFn: motionTransferRoutes,
    requiredField: "videoUrl",
    invalidPayload: { userId: VALID_UUID, imageUrl: EXAMPLE_IMAGE_URL },
    validPayload: {
      userId: VALID_UUID,
      imageUrl: EXAMPLE_IMAGE_URL,
      videoUrl: EXAMPLE_VIDEO_URL,
    },
    queueJobType: "motion-transfer",
  },
  {
    name: "transcribe",
    path: "/v1/transcribe",
    routeFn: transcribeRoutes,
    requiredField: "audioUrl",
    invalidPayload: { userId: VALID_UUID },
    validPayload: { userId: VALID_UUID, audioUrl: EXAMPLE_AUDIO_URL },
    queueJobType: "transcribe",
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
// Test app setup
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

  for (const route of AI_ROUTES) {
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

describe.each(AI_ROUTES)(
  "POST $path ($name)",
  ({ path, requiredField, invalidPayload, validPayload, queueJobType }) => {
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

    it("creates job and enqueues to videoQueue", async () => {
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

      expect(mockFrom).toHaveBeenCalledWith("jobs")
      expect(mockInsert).toHaveBeenCalledWith(
        expect.objectContaining({
          user_id: VALID_UUID,
          status: "pending",
          input_data: expect.objectContaining({
            type: queueJobType,
          }),
        }),
      )

      expect(videoQueue.add).toHaveBeenCalledWith(
        queueJobType,
        expect.objectContaining({
          jobId: "job-1",
          usageLogId: "usage-1",
        }),
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
  },
)
