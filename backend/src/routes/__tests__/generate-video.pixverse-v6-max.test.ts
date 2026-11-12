import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

/**
 * PixVerse V6 Max through both video routes: the row each reserves and the
 * levers each queues for the worker must be the same run — the quality it
 * bills, the length it bills and, above all, the audio state it bills (the
 * `:audio` rows cost more). A request that names no audio setting renders and
 * bills audio on.
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
import { textToVideoRoutes } from "../text-to-video.js"
import { supabase } from "../../lib/supabase.js"
import { videoQueue } from "../../lib/queue.js"
import { reserveCreditsForJob } from "../../middleware/credit-guard.js"

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
    await textToVideoRoutes(instance)
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

const USER = "00000000-0000-4000-8000-000000000001"
const ID = "pixverse-v6-max"

const reservedId = () => vi.mocked(reserveCreditsForJob).mock.calls[0]?.[3]
const queued = () => vi.mocked(videoQueue.add).mock.calls[0]?.[1] as Record<string, unknown>

function i2v(body: Record<string, unknown>) {
  return app.inject({
    method: "POST",
    url: "/v1/generate-video",
    payload: { userId: USER, provider: ID, prompt: "the lighthouse beam sweeps the sea", imageUrl: "https://cdn.example/start.png", ...body },
  })
}

function t2v(body: Record<string, unknown>) {
  return app.inject({
    method: "POST",
    url: "/v1/text-to-video",
    payload: { userId: USER, provider: ID, prompt: "a lighthouse in a storm, waves crashing", ...body },
  })
}

describe("PixVerse V6 Max — the provider enum", () => {
  it("both routes accept the id", async () => {
    expect((await i2v({})).statusCode).toBe(200)
    vi.clearAllMocks()
    expect((await t2v({})).statusCode).toBe(200)
  })

  it("both routes take its 2:3 and 3:2 ratios, and text-to-video sends them as asked", async () => {
    for (const aspectRatio of ["2:3", "3:2", "21:9"]) {
      vi.clearAllMocks()
      const res = await t2v({ aspectRatio })
      expect(res.statusCode, `${aspectRatio}: ${res.body}`).toBe(200)
      expect(queued().aspectRatio).toBe(aspectRatio)
      vi.clearAllMocks()
      expect((await i2v({ aspectRatio })).statusCode, aspectRatio).toBe(200)
    }
  })

  it("/v1/generate-video with no image points to the text-to-video lane (the model has one)", async () => {
    const res = await i2v({ imageUrl: undefined })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.message).toMatch(/text-to-video/)
    expect(reserveCreditsForJob).not.toHaveBeenCalled()
  })
})

const CASES: Array<{ body: Record<string, unknown>; reserved: string; resolution: string; duration: number; sound: boolean | undefined; generateAudio?: boolean }> = [
  { body: {}, reserved: `${ID}:5s:720p:audio`, resolution: "720p", duration: 5, sound: undefined },
  { body: { sound: false }, reserved: `${ID}:5s:720p`, resolution: "720p", duration: 5, sound: false },
  { body: { sound: true, duration: 15, resolution: "1080p" }, reserved: `${ID}:15s:1080p:audio`, resolution: "1080p", duration: 15, sound: true },
  { body: { duration: 1, resolution: "360p", sound: false }, reserved: `${ID}:1s:360p`, resolution: "360p", duration: 1, sound: false },
  { body: { duration: 7, resolution: "540p" }, reserved: `${ID}:7s:540p:audio`, resolution: "540p", duration: 7, sound: undefined },
  // `generateAudio` turns the switch when `sound` is not sent, and the row follows it.
  { body: { generateAudio: false, duration: 3, resolution: "720p" }, reserved: `${ID}:3s:720p`, resolution: "720p", duration: 3, sound: undefined, generateAudio: false },
  { body: { generateAudio: true, duration: 3, resolution: "540p" }, reserved: `${ID}:3s:540p:audio`, resolution: "540p", duration: 3, sound: undefined, generateAudio: true },
  // `sound` wins over `generateAudio` on both sides.
  { body: { sound: true, generateAudio: false, duration: 4, resolution: "360p" }, reserved: `${ID}:4s:360p:audio`, resolution: "360p", duration: 4, sound: true, generateAudio: false },
]

for (const [lane, post] of [["/v1/generate-video", i2v], ["/v1/text-to-video", t2v]] as const) {
  describe(`PixVerse V6 Max — ${lane} reserves the row the run renders`, () => {
    for (const c of CASES) {
      it(`${JSON.stringify(c.body)} → ${c.reserved}`, async () => {
        const res = await post(c.body)
        expect(res.statusCode, res.body).toBe(200)
        expect(reservedId()).toBe(c.reserved)
        const job = queued()
        expect(job.provider).toBe(ID)
        expect(job.resolution).toBe(c.resolution)
        expect(job.duration).toBe(c.duration)
        expect(job.sound).toBe(c.sound)
        expect(job.generateAudio).toBe(c.generateAudio)
      })
    }
  })
}
