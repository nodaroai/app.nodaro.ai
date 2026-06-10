import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

// ---------------------------------------------------------------------------
// Mocks — hoisted before any route import. Mirrors generate-image.test.ts so
// `videoQueue.add` is a spy, the credit guard is a no-op, and the supabase
// jobs insert returns a stable job id. (safeUrlSchema is relaxed to
// `z.string().url()` here too — same as the sibling test — so the inpaint
// base/mask URLs only need to be syntactically valid public URLs.)
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
    CHARACTER_LORA_ROUTING_ENABLED: true,
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

import { generateImageRoutes, generateImageBody } from "../generate-image.js"
import { supabase } from "../../lib/supabase.js"
import { videoQueue } from "../../lib/queue.js"

// ---------------------------------------------------------------------------
// Test app setup (copied from generate-image.test.ts)
// ---------------------------------------------------------------------------

let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()

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
    await generateImageRoutes(instance)
  })

  await app.ready()
})

afterEach(async () => {
  await app.close()
})

// Wire supabase.from("jobs").insert().select().single() → { id: "job-1" }.
function setupJobsInsert() {
  const mockSingle = vi.fn().mockResolvedValue({ data: { id: "job-1" }, error: null })
  const mockSelect = vi.fn().mockReturnValue({ single: mockSingle })
  const mockInsert = vi.fn().mockReturnValue({ select: mockSelect })
  vi.mocked(supabase.from).mockReturnValue({ insert: mockInsert } as never)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const VALID_UUID = "00000000-0000-4000-8000-000000000001"
const BASE_IMAGE_URL = "https://r2.nodaro.ai/base.png"
const MASK_URL = "https://r2.nodaro.ai/mask.png"

describe("POST /v1/generate-image inpaint fields", () => {
  // Schema-level: the four optional fields parse with the documented bounds.
  it("accepts baseImageUrl/maskUrl/strength/guidanceScale in generateImageBody", () => {
    const result = generateImageBody.safeParse({
      prompt: "a red car",
      baseImageUrl: BASE_IMAGE_URL,
      maskUrl: MASK_URL,
      strength: 0.7,
      guidanceScale: 7,
    })
    expect(result.success).toBe(true)
  })

  it("rejects strength > 1 and guidanceScale > 20", () => {
    expect(
      generateImageBody.safeParse({ prompt: "x", strength: 1.5 }).success,
    ).toBe(false)
    expect(
      generateImageBody.safeParse({ prompt: "x", guidanceScale: 21 }).success,
    ).toBe(false)
  })

  // The load-bearing assertion: the four fields reach the BullMQ queue payload.
  it("forwards baseImageUrl/maskUrl/strength/guidanceScale into the videoQueue.add payload", async () => {
    setupJobsInsert()

    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-image",
      payload: {
        prompt: "a red car",
        userId: VALID_UUID,
        provider: "gpt-image-2",
        baseImageUrl: BASE_IMAGE_URL,
        maskUrl: MASK_URL,
        strength: 0.7,
        guidanceScale: 7,
      },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().jobId).toBe("job-1")

    const queued = vi.mocked(videoQueue.add).mock.calls.at(-1)?.[1] as Record<string, unknown>
    expect(queued).toMatchObject({
      baseImageUrl: BASE_IMAGE_URL,
      maskUrl: MASK_URL,
      strength: 0.7,
      guidanceScale: 7,
    })
  })

  // When omitted, the fields ride the queue as `undefined` (no inpaint).
  it("leaves the inpaint fields undefined on the queue payload when not supplied", async () => {
    setupJobsInsert()

    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-image",
      payload: { prompt: "a red car", userId: VALID_UUID, provider: "gpt-image-2" },
    })

    expect(res.statusCode).toBe(200)
    const queued = vi.mocked(videoQueue.add).mock.calls.at(-1)?.[1] as Record<string, unknown>
    expect(queued.baseImageUrl).toBeUndefined()
    expect(queued.maskUrl).toBeUndefined()
    expect(queued.strength).toBeUndefined()
    expect(queued.guidanceScale).toBeUndefined()
  })
})
