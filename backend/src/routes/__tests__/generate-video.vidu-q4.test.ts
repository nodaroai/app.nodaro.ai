import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

/**
 * /v1/generate-video for Vidu Q4 — the two refusals that must land BEFORE the
 * credit reservation:
 *   - the reference-audio contract (MP3 only, 3-12 s each), checked by the
 *     audio preHandler through the shared core probe;
 *   - the reference endpoint's prompt + image requirement (viduQ4InputProblem).
 */

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

// The voiced path computes the audio addon in the route handler body via
// getModelCreditBaseCost (creditGuard's computeCredits is bypassed by the mock
// above). Stub it so the addon math is deterministic and never touches the DB.
vi.mock("@/ee/billing/credits.js", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return { ...actual, getModelCreditBaseCost: vi.fn().mockResolvedValue({ creditCost: 4 }) }
})

vi.mock("@/providers/video/ffmpeg-utils.js", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return { ...actual, probeMediaDuration: vi.fn(), probeMediaFormatAndDuration: vi.fn() }
})

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
  // Flag off: the voiced add-on reads the flat dialogue row (the mocked 4), as today.
  speechLengthPricingEnabled: () => false,
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

import { generateVideoRoutes } from "../generate-video.js"
import { supabase } from "../../lib/supabase.js"
import { reserveCreditsForJob } from "../../middleware/credit-guard.js"
import { probeMediaFormatAndDuration } from "../../providers/video/ffmpeg-utils.js"

let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    const body = req.body as Record<string, unknown> | undefined
    if (body?.userId && typeof body.userId === "string") {
      req.userId = body.userId
      req.userRole = undefined
    }
  })
  await app.register(async (instance) => {
    await generateVideoRoutes(instance)
  })
  await app.ready()
  const mockSingle = vi.fn().mockResolvedValue({ data: { id: "job-1" }, error: null })
  const mockSelect = vi.fn().mockReturnValue({ single: mockSingle })
  const mockInsert = vi.fn().mockReturnValue({ select: mockSelect })
  vi.mocked(supabase.from).mockReturnValue({ insert: mockInsert } as never)
})

afterEach(async () => {
  await app.close()
})

const BASE = {
  userId: "00000000-0000-4000-8000-000000000001",
  provider: "vidu-q4",
  prompt: "the man from @image_1 says hello in the voice of @audio_1",
  imageUrl: "https://cdn.example/start.png",
}

function post(body: Record<string, unknown>) {
  return app.inject({ method: "POST", url: "/v1/generate-video", payload: body })
}

describe("POST /v1/generate-video — Vidu Q4 reference audio", () => {
  it("refuses a WAV reference clip with 400 audio_format_unsupported before any reservation", async () => {
    vi.mocked(probeMediaFormatAndDuration).mockResolvedValue({ formatNames: ["wav"], durationSec: 5 })
    const res = await post({ ...BASE, referenceAudioUrls: ["https://cdn.example/voice.wav"] })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("audio_format_unsupported")
    expect(res.json().error.message).toContain("MP3")
    expect(reserveCreditsForJob).not.toHaveBeenCalled()
  })

  it("refuses an MP3 clip over 12 s, and one under 3 s", async () => {
    vi.mocked(probeMediaFormatAndDuration).mockResolvedValue({ formatNames: ["mp3"], durationSec: 13 })
    const long = await post({ ...BASE, referenceAudioUrls: ["https://cdn.example/voice.mp3"] })
    expect(long.statusCode).toBe(400)
    expect(long.json().error.code).toBe("audio_too_long")

    vi.mocked(probeMediaFormatAndDuration).mockResolvedValue({ formatNames: ["mp3"], durationSec: 2 })
    const short = await post({ ...BASE, referenceAudioUrls: ["https://cdn.example/voice.mp3"] })
    expect(short.statusCode).toBe(400)
    expect(short.json().error.code).toBe("audio_too_short")
    expect(reserveCreditsForJob).not.toHaveBeenCalled()
  })

  it("passes a legal MP3 clip through to the reservation", async () => {
    vi.mocked(probeMediaFormatAndDuration).mockResolvedValue({ formatNames: ["mp3"], durationSec: 6 })
    const res = await post({ ...BASE, referenceAudioUrls: ["https://cdn.example/voice.mp3"] })
    expect(res.statusCode, res.body).toBe(200)
    expect(reserveCreditsForJob).toHaveBeenCalledTimes(1)
  })
})

describe("POST /v1/generate-video — Vidu Q4 reference-mode inputs", () => {
  it("refuses references with an empty prompt (400) before any reservation", async () => {
    const res = await post({ ...BASE, prompt: "   ", referenceImageUrls: ["https://cdn.example/r1.png"] })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.message).toMatch(/needs a prompt/)
    expect(reserveCreditsForJob).not.toHaveBeenCalled()
  })

  it("a start frame with no prompt and no references is legal (image-to-video)", async () => {
    const res = await post({ ...BASE, prompt: undefined })
    expect(res.statusCode).toBe(200)
    expect(reserveCreditsForJob).toHaveBeenCalledTimes(1)
  })

  it("reserves the ladder composite the run will render", async () => {
    const res = await post({ ...BASE, resolution: "4K", duration: 9, referenceImageUrls: ["https://cdn.example/r1.png"] })
    expect(res.statusCode).toBe(200)
    expect(vi.mocked(reserveCreditsForJob).mock.calls[0]?.[3]).toBe("vidu-q4:9s:4k")
  })
})
