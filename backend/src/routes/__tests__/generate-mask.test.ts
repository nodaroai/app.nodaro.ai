import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

// ---------------------------------------------------------------------------
// Mocks — hoisted before any route import
// ---------------------------------------------------------------------------

vi.mock("@/lib/supabase.js", () => ({
  supabase: {
    from: vi.fn(),
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }) },
  },
}))

vi.mock("@/lib/queue.js", () => ({
  videoQueue: { add: vi.fn().mockResolvedValue({ id: "q-1" }) },
  redis: {},
}))

vi.mock("@/middleware/credit-guard.js", () => ({
  creditGuard: () => async () => {},
  reserveCreditsForJob: vi.fn().mockResolvedValue({ usageLogId: "u-1", creditsReserved: 2, watermark: false }),
}))

vi.mock("@/lib/config.js", () => ({
  config: { REPLICATE_API_TOKEN: "test", EDITION: "cloud" },
  isCommunity: () => false,
  isBusiness: () => false,
  isCloud: () => true,
  hasCredits: () => true,
  hasAdmin: () => true,
}))

vi.mock("@/lib/url-validator.js", async () => {
  const { z } = await import("zod")
  return { safeUrlSchema: z.string().url() }
})

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { generateMaskRoutes } from "../generate-mask.js"
import { supabase } from "../../lib/supabase.js"
import { videoQueue } from "../../lib/queue.js"

// ---------------------------------------------------------------------------
// Test app setup
// ---------------------------------------------------------------------------

let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    const body = req.body as Record<string, unknown> | undefined
    if (body?.userId && typeof body.userId === "string") req.userId = body.userId
  })
  await app.register(async (i) => { await generateMaskRoutes(i) })
  await app.ready()
})

afterEach(async () => { await app.close() })

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /v1/generate-mask", () => {
  it("returns 400 when prompt is missing", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-mask",
      payload: { imageUrl: "https://example.com/img.png", userId: "u1" },
    })
    expect(res.statusCode).toBe(400)
  })

  it("returns 401 when userId missing", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-mask",
      payload: { imageUrl: "https://example.com/img.png", prompt: "the person" },
    })
    expect(res.statusCode).toBe(401)
  })

  it("creates job and enqueues generate-mask with correct inputs", async () => {
    vi.mocked(supabase.from).mockReturnValue({
      insert: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: { id: "job-gm-1" }, error: null }),
        }),
      }),
    } as never)

    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-mask",
      payload: {
        imageUrl: "https://example.com/img.png",
        prompt: "the blonde woman",
        threshold: 0.3,
        userId: "00000000-0000-4000-8000-000000000001",
      },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().jobId).toBe("job-gm-1")
    expect(videoQueue.add).toHaveBeenCalledWith(
      "generate-mask",
      expect.objectContaining({
        jobId: "job-gm-1",
        imageUrl: "https://example.com/img.png",
        prompt: "the blonde woman",
        threshold: 0.3,
        usageLogId: "u-1",
      }),
    )
  })

  it("uses default threshold 0.3 when omitted", async () => {
    vi.mocked(supabase.from).mockReturnValue({
      insert: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: { id: "job-gm-2" }, error: null }),
        }),
      }),
    } as never)

    await app.inject({
      method: "POST",
      url: "/v1/generate-mask",
      payload: {
        imageUrl: "https://example.com/img.png",
        prompt: "the car",
        userId: "00000000-0000-4000-8000-000000000001",
      },
    })

    expect(videoQueue.add).toHaveBeenCalledWith(
      "generate-mask",
      expect.objectContaining({ threshold: 0.3 }),
    )
  })
})
