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

import { textToVideoRoutes } from "../text-to-video.js"
import { supabase } from "../../lib/supabase.js"
import { videoQueue } from "../../lib/queue.js"
import { registerPromptPolicy, clearPromptPolicies } from "../../lib/prompt-policy.js"
import { getStylePromptHint } from "@nodaro/prompts"

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
    await textToVideoRoutes(instance)
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

describe("POST /v1/text-to-video", () => {
  it("returns 400 when prompt is missing", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/text-to-video",
      payload: { userId: "00000000-0000-4000-8000-000000000001" },
    })

    expect(res.statusCode).toBe(400)
    const body = res.json()
    expect(body.error.code).toBe("validation_error")
  })

  it("returns 400 when provider is invalid", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/text-to-video",
      payload: {
        prompt: "a cat walking",
        provider: "nonexistent-provider",
        userId: "00000000-0000-4000-8000-000000000001",
      },
    })

    expect(res.statusCode).toBe(400)
    const body = res.json()
    expect(body.error.code).toBe("validation_error")
  })

  it("returns 401 when userId is not provided", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/text-to-video",
      payload: { prompt: "a cat walking" },
    })

    expect(res.statusCode).toBe(401)
    const body = res.json()
    expect(body.error.code).toBe("unauthorized")
  })

  it("creates a job and enqueues it on valid request", async () => {
    const { mockFrom, mockInsert } = mockJobInsert({
      data: { id: "job-1" },
      error: null,
    })

    const res = await app.inject({
      method: "POST",
      url: "/v1/text-to-video",
      payload: {
        prompt: "a cat walking in the park",
        userId: "00000000-0000-4000-8000-000000000001",
        provider: "kling",
        duration: 5,
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
          prompt: "a cat walking in the park",
          provider: "kling",
          type: "text-to-video",
        }),
      })
    )

    expect(videoQueue.add).toHaveBeenCalledWith(
      "text-to-video",
      expect.objectContaining({
        jobId: "job-1",
        prompt: "a cat walking in the park",
        provider: "kling",
        duration: 5,
      })
    )
  })

  describe("PromptPolicy (B4b)", () => {
    afterEach(() => clearPromptPolicies())

    it("applies a registered video PromptPolicy to the direct-route prompt", async () => {
      mockJobInsert({ data: { id: "job-1" }, error: null })
      registerPromptPolicy({
        id: "vid",
        apply: (a) => (a.kind === "video" ? { ...a, prompt: `${a.prompt} VID` } : a),
      })
      const res = await app.inject({
        method: "POST",
        url: "/v1/text-to-video",
        payload: {
          prompt: "a cat walking",
          userId: "00000000-0000-4000-8000-000000000001",
          provider: "kling",
          duration: 5,
        },
      })
      expect(res.statusCode).toBe(200)
      const queued = vi.mocked(videoQueue.add).mock.calls[0][1] as Record<string, unknown>
      expect(queued.prompt).toBe("a cat walking VID")
    })
  })

  it("assembles connectedReferences server-side into the queued prompt + referenceImageUrls", async () => {
    mockJobInsert({ data: { id: "job-cr" }, error: null })

    const res = await app.inject({
      method: "POST",
      url: "/v1/text-to-video",
      payload: {
        prompt: "a chase scene",
        userId: "00000000-0000-4000-8000-000000000001",
        provider: "seedance-2",
        connectedReferences: [
          {
            id: "r1",
            defaultName: "Car",
            source: "wired-image",
            url: "https://cdn.nodaro.ai/uploads/car.png",
            description: "a red car",
          },
        ],
      },
    })

    expect(res.statusCode).toBe(200)
    const queued = vi.mocked(videoQueue.add).mock.calls.at(-1)?.[1] as Record<string, unknown>
    // The unmentioned wired-image ref auto-attaches its URL + emits an @image_N directive.
    expect(queued.referenceImageUrls).toEqual(["https://cdn.nodaro.ai/uploads/car.png"])
    expect(queued.prompt).toContain("@image_1")
    expect(queued.prompt).toContain("a red car")
    expect(queued.prompt).toContain("a chase scene")
  })

  it("returns 500 when job insert fails", async () => {
    mockJobInsert({
      data: null,
      error: { message: "DB connection failed" },
    })

    const res = await app.inject({
      method: "POST",
      url: "/v1/text-to-video",
      payload: {
        prompt: "a cat walking",
        userId: "00000000-0000-4000-8000-000000000001",
      },
    })

    expect(res.statusCode).toBe(500)
    const body = res.json()
    expect(body.error.code).toBe("internal_error")
  })

  it("uses minimax as default provider when none specified", async () => {
    const { mockInsert } = mockJobInsert({
      data: { id: "job-1" },
      error: null,
    })

    const res = await app.inject({
      method: "POST",
      url: "/v1/text-to-video",
      payload: {
        prompt: "a sunset timelapse",
        userId: "00000000-0000-4000-8000-000000000001",
      },
    })

    expect(res.statusCode).toBe(200)

    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        input_data: expect.objectContaining({
          type: "text-to-video",
          prompt: "a sunset timelapse",
        }),
      })
    )

    // provider should be undefined in the queue payload (route passes through raw value)
    expect(videoQueue.add).toHaveBeenCalledWith(
      "text-to-video",
      expect.objectContaining({
        jobId: "job-1",
        prompt: "a sunset timelapse",
      })
    )
  })
})

/**
 * The cinematic `direction` channel, at parity with /v1/generate-video (same
 * shared schema, same composer, same fold site — before reference assembly).
 * The composer's semantics are pinned in `@nodaro/prompts`; the two cases that
 * matter for THIS route are that the fold lands and that its absence changes
 * nothing.
 */
describe("POST /v1/text-to-video — the direction channel", () => {
  const USER = "00000000-0000-4000-8000-000000000001"
  const STYLE = "cinematic"

  it("folds the direction ids into the queued prompt, recording the source in userPrompt", async () => {
    const { mockInsert } = mockJobInsert({ data: { id: "job-dir" }, error: null })
    const res = await app.inject({
      method: "POST",
      url: "/v1/text-to-video",
      payload: { prompt: "a sunset timelapse", userId: USER, direction: { style: STYLE } },
    })
    expect(res.statusCode).toBe(200)
    const folded = `a sunset timelapse. ${getStylePromptHint(STYLE)}`
    expect(vi.mocked(videoQueue.add).mock.calls.at(-1)![1].prompt).toBe(folded)
    expect(mockInsert.mock.calls.at(-1)![0].input_data).toEqual(
      expect.objectContaining({
        prompt: folded,
        userPrompt: "a sunset timelapse",
        direction: { style: STYLE },
      }),
    )
  })

  it("is byte-identical when `direction` is absent", async () => {
    mockJobInsert({ data: { id: "job-nodir" }, error: null })
    await app.inject({
      method: "POST",
      url: "/v1/text-to-video",
      payload: { prompt: "a sunset timelapse", userId: USER },
    })
    expect(vi.mocked(videoQueue.add).mock.calls.at(-1)![1].prompt).toBe("a sunset timelapse")
  })
})
