import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

/**
 * LTX 2.5 Fast audio-to-video through both video routes (decided 2026-11-23):
 * with an audio clip the run is priced on the clip's length as the SERVER
 * measures it (rounded up to a whole second), the length sent is the measured
 * one, and a clip the endpoint would not take is refused before the hold.
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
  speechLengthPricingEnabled: () => false,
}))

vi.mock("@/lib/lip-sync-inputs.js", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return { ...actual, measureAudio: vi.fn() }
})

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

import { generateVideoRoutes, generateVideoPricing } from "../generate-video.js"
import { textToVideoRoutes } from "../text-to-video.js"
import { supabase } from "../../lib/supabase.js"
import { videoQueue } from "../../lib/queue.js"
import { reserveCreditsForJob } from "../../middleware/credit-guard.js"
import { measureAudio } from "../../lib/lip-sync-inputs.js"
import { DRIVING_AUDIO_FORMATS } from "../../lib/driving-audio-measure.js"

let app: FastifyInstance
let mockInsert: ReturnType<typeof vi.fn>

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
    await textToVideoRoutes(instance)
  })
  await app.ready()
  const mockSingle = vi.fn().mockResolvedValue({ data: { id: "job-1" }, error: null })
  const mockSelect = vi.fn().mockReturnValue({ single: mockSingle })
  mockInsert = vi.fn().mockReturnValue({ select: mockSelect })
  vi.mocked(supabase.from).mockReturnValue({ insert: mockInsert } as never)
})

afterEach(async () => {
  await app.close()
})

const USER = "00000000-0000-4000-8000-000000000001"

const reservedId = () => vi.mocked(reserveCreditsForJob).mock.calls[0]?.[3]
const queued = () => vi.mocked(videoQueue.add).mock.calls[0]?.[1] as Record<string, unknown>
const recorded = () => (mockInsert.mock.calls[0]?.[0] as { input_data: Record<string, unknown> }).input_data

function i2v(provider: string, body: Record<string, unknown>) {
  return app.inject({
    method: "POST",
    url: "/v1/generate-video",
    payload: { userId: USER, provider, prompt: "the baker knocks twice and says \"Hear that?\"", imageUrl: "https://cdn.example/start.png", ...body },
  })
}

function t2v(provider: string, body: Record<string, unknown>) {
  return app.inject({
    method: "POST",
    url: "/v1/text-to-video",
    payload: { userId: USER, provider, prompt: "a street food vendor flips noodles in a flaming wok", ...body },
  })
}

const AUDIO = "https://cdn.example/voice.mp3"
const measured = (seconds: number) => vi.mocked(measureAudio).mockResolvedValue({ kind: "measured", length: { overCap: false, samples: Math.round(seconds * 48000), seconds } } as never)

describe("LTX 2.5 Fast — audio-to-video on both routes", () => {
  for (const [lane, post] of [["/v1/generate-video", i2v], ["/v1/text-to-video", t2v]] as const) {
    it(`${lane}: a 7.2 s clip at 720p holds the 8 s row and sends 7.15 s to the audio endpoint`, async () => {
      measured(7.2)
      const res = await post("ltx-2.5-fast", { referenceAudioUrls: [AUDIO], resolution: "720p", duration: 20 })
      expect(res.statusCode).toBe(200)
      expect(reservedId()).toBe("ltx-2.5-fast:8s:720p")
      expect(queued()).toMatchObject({ audioToVideo: true, duration: 7.15, resolution: "720p", referenceAudioUrls: [AUDIO] })
      expect(recorded()).toMatchObject({ audioToVideo: true, drivingAudioSec: 7.2, drivingAudioBilledSec: 8 })
      // Measured with the endpoint's formats, under its 50 MB limit.
      const call = vi.mocked(measureAudio).mock.calls[0]!
      expect(call[2]).toEqual({ audio: { maxSourceBytes: 50_000_000 } })
      expect(call[5]).toEqual(DRIVING_AUDIO_FORMATS)
      expect(call[6]).toEqual({ audioOnly: true })
    })

    it(`${lane}: a length the body states is never read`, async () => {
      measured(3.5)
      const res = await post("ltx-2.5-fast", { referenceAudioUrls: [AUDIO], resolution: "1080p", duration: 6 })
      expect(res.statusCode).toBe(200)
      expect(reservedId()).toBe("ltx-2.5-fast:4s:1080p")
      expect(queued().duration).toBe(3.45)
    })

    it(`${lane}: a clip under 2 s is refused before anything is held`, async () => {
      measured(1.4)
      const res = await post("ltx-2.5-fast", { referenceAudioUrls: [AUDIO] })
      expect(res.statusCode).toBe(400)
      expect(res.json().error.code).toBe("audio_too_short")
      expect(reserveCreditsForJob).not.toHaveBeenCalled()
      expect(videoQueue.add).not.toHaveBeenCalled()
    })

    it(`${lane}: a 14 s clip at 1440p is refused, naming the setting to change`, async () => {
      measured(14)
      const res = await post("ltx-2.5-fast", { referenceAudioUrls: [AUDIO], resolution: "1440p" })
      expect(res.statusCode).toBe(400)
      expect(res.json().error.code).toBe("audio_too_long")
      expect(res.json().error.message).toMatch(/720p or 1080p/)
      expect(reserveCreditsForJob).not.toHaveBeenCalled()
    })

    it(`${lane}: a clip it cannot read is refused, never priced on a guess`, async () => {
      vi.mocked(measureAudio).mockResolvedValue({ kind: "unreadable", why: "decode" } as never)
      const res = await post("ltx-2.5-fast", { referenceAudioUrls: [AUDIO] })
      expect(res.statusCode).toBe(400)
      expect(res.json().error.code).toBe("audio_unreadable")
      expect(reserveCreditsForJob).not.toHaveBeenCalled()
    })

    it(`${lane}: two clips are refused (the endpoint takes one)`, async () => {
      measured(5)
      const res = await post("ltx-2.5-fast", { referenceAudioUrls: [AUDIO, "https://cdn.example/b.mp3"] })
      expect(res.statusCode).toBe(400)
      expect(reserveCreditsForJob).not.toHaveBeenCalled()
    })

    it(`${lane}: Pro has no audio-to-video — the model is not switched, the clip is not measured`, async () => {
      const res = await post("ltx-2.5-pro", { referenceAudioUrls: [AUDIO], resolution: "720p", duration: 6 })
      expect(res.statusCode).toBe(200)
      expect(reservedId()).toBe("ltx-2.5-pro:6s:720p")
      expect(queued().audioToVideo).toBeUndefined()
      expect(queued().provider).toBe("ltx-2.5-pro")
      expect(measureAudio).not.toHaveBeenCalled()
    })

    it(`${lane}: without an audio clip nothing changes`, async () => {
      const res = await post("ltx-2.5-fast", { resolution: "720p", duration: 6 })
      expect(res.statusCode).toBe(200)
      expect(reservedId()).toBe("ltx-2.5-fast:6s:720p")
      expect(queued().audioToVideo).toBeUndefined()
      expect(measureAudio).not.toHaveBeenCalled()
    })
  }

  it("a length or ratio in the body is not read, so its move is not reported", async () => {
    measured(8)
    const res = await t2v("ltx-2.5-fast", { referenceAudioUrls: [AUDIO], resolution: "1440p", duration: 20, aspectRatio: "21:9" })
    expect(res.statusCode).toBe(200)
    expect(reservedId()).toBe("ltx-2.5-fast:8s:1440p")
    const fields = ((res.json().adjustments ?? []) as Array<{ field: string }>).map((a) => a.field)
    expect(fields).not.toContain("duration")
    expect(fields).not.toContain("aspectRatio")
  })

  it("/v1/generate-video takes an audio clip without a start frame", async () => {
    measured(5)
    const res = await i2v("ltx-2.5-fast", { imageUrl: undefined, referenceAudioUrls: [AUDIO], resolution: "720p" })
    expect(res.statusCode).toBe(200)
    expect(reservedId()).toBe("ltx-2.5-fast:5s:720p")
  })
})

describe("LTX 2.5 Fast audio-to-video — the hold", () => {
  it("the loop-trim add-on rides on the audio row, as on every other run", async () => {
    const computeCredits = generateVideoPricing.opts!.computeCredits!
    const drivingAudio = { ok: true, billedSec: 8, sentSec: 7.2, audioSec: 7.2, creditId: "ltx-2.5-fast:8s:720p", resolution: "720p", fps: 24 }
    const body = { provider: "ltx-2.5-fast", resolution: "720p", referenceAudioUrls: [AUDIO] }
    const plain = await computeCredits(body, { drivingAudio } as never)
    const trimmed = await computeCredits({ ...body, loopTrim: { enabled: true, framesToTest: 16 } }, { drivingAudio } as never)
    expect(plain).toBe(4)
    expect(trimmed!).toBeGreaterThan(plain!)
  })
})
