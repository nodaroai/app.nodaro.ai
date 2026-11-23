import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

/**
 * LTX 2.5 through both video routes: the row each reserves and the levers each
 * queues (and records) for the worker must be the same run — the resolution and
 * length it bills, and the frame rate it sends. On Fast, 1440p or 48 / 50 fps
 * hold the length to 10 s on the SERVER (decided 2026-11-22): a JSON-written or
 * mapped request past it is priced and sent as 10 s, never refused mid-run.
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

describe("LTX 2.5 — the provider enum", () => {
  it("both routes accept both ids", async () => {
    for (const id of ["ltx-2.5-fast", "ltx-2.5-pro"]) {
      vi.clearAllMocks()
      expect((await i2v(id, {})).statusCode).toBe(200)
      vi.clearAllMocks()
      expect((await t2v(id, {})).statusCode).toBe(200)
    }
  })

  it("text-to-video takes its five ratios as asked, and moves another to the nearest of them", async () => {
    for (const aspectRatio of ["16:9", "9:16", "1:1", "3:2", "2:3"]) {
      vi.clearAllMocks()
      expect((await t2v("ltx-2.5-fast", { aspectRatio })).statusCode).toBe(200)
      expect(queued().aspectRatio).toBe(aspectRatio)
    }
    vi.clearAllMocks()
    expect((await t2v("ltx-2.5-fast", { aspectRatio: "21:9" })).statusCode).toBe(200)
    expect(queued().aspectRatio).toBe("16:9")
  })

  it("/v1/generate-video with no image points to the text-to-video lane (the model has one)", async () => {
    const res = await i2v("ltx-2.5-pro", { imageUrl: undefined })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.message).toMatch(/text-to-video/)
    expect(reserveCreditsForJob).not.toHaveBeenCalled()
  })

  it("a frame rate the model does not offer is not refused: it runs at 24 and is disclosed", async () => {
    const res = await t2v("ltx-2.5-fast", { fps: 500 })
    expect(res.statusCode).toBe(200)
    expect(queued().fps).toBe(24)
    expect(res.json().adjustments).toEqual([expect.objectContaining({ field: "fps", from: "500", to: 24 })])
  })
})

const CASES: Array<{ id: string; body: Record<string, unknown>; reserved: string; resolution: string; duration: number; fps: number }> = [
  { id: "ltx-2.5-fast", body: {}, reserved: "ltx-2.5-fast:10s:1080p", resolution: "1080p", duration: 10, fps: 24 },
  { id: "ltx-2.5-pro", body: {}, reserved: "ltx-2.5-pro:10s:1080p", resolution: "1080p", duration: 10, fps: 24 },
  { id: "ltx-2.5-fast", body: { duration: 20, resolution: "720p", fps: 25 }, reserved: "ltx-2.5-fast:20s:720p", resolution: "720p", duration: 20, fps: 25 },
  // The long-clip limit, held on the server.
  { id: "ltx-2.5-fast", body: { duration: 16, resolution: "1440p" }, reserved: "ltx-2.5-fast:10s:1440p", resolution: "1440p", duration: 10, fps: 24 },
  { id: "ltx-2.5-fast", body: { duration: 20, resolution: "720p", fps: 50 }, reserved: "ltx-2.5-fast:10s:720p", resolution: "720p", duration: 10, fps: 50 },
  { id: "ltx-2.5-fast", body: { duration: 14, resolution: "1080p", fps: 48 }, reserved: "ltx-2.5-fast:10s:1080p", resolution: "1080p", duration: 10, fps: 48 },
  // Pro: 48 / 50 fps take every length it has; its 1440p (not its own) runs at 1080p.
  { id: "ltx-2.5-pro", body: { duration: 8, resolution: "720p", fps: 50 }, reserved: "ltx-2.5-pro:8s:720p", resolution: "720p", duration: 8, fps: 50 },
  { id: "ltx-2.5-pro", body: { duration: 6, resolution: "1440p" }, reserved: "ltx-2.5-pro:6s:1080p", resolution: "1080p", duration: 6, fps: 24 },
  // A frame rate it does not render runs at 24.
  { id: "ltx-2.5-fast", body: { duration: 8, resolution: "720p", fps: 30 }, reserved: "ltx-2.5-fast:8s:720p", resolution: "720p", duration: 8, fps: 24 },
]

for (const [lane, post] of [["/v1/generate-video", i2v], ["/v1/text-to-video", t2v]] as const) {
  describe(`LTX 2.5 — ${lane} reserves the row the run renders, and sends its frame rate`, () => {
    for (const c of CASES) {
      it(`${c.id} ${JSON.stringify(c.body)} → ${c.reserved} @ ${c.fps} fps`, async () => {
        const res = await post(c.id, c.body)
        expect(res.statusCode, res.body).toBe(200)
        expect(reservedId()).toBe(c.reserved)
        const job = queued()
        expect(job.provider).toBe(c.id)
        expect(job.resolution).toBe(c.resolution)
        expect(job.duration).toBe(c.duration)
        expect(job.fps).toBe(c.fps)
        const input = recorded()
        expect(input.duration).toBe(c.duration)
        expect(input.fps).toBe(c.fps)
      })
    }
  })
}

describe("LTX 2.5 — what the routes disclose", () => {
  it("a length moved by the limit comes back in `adjustments`", async () => {
    const res = await t2v("ltx-2.5-fast", { duration: 20, resolution: "720p", fps: 50 })
    expect(res.statusCode).toBe(200)
    expect(res.json().adjustments).toEqual([expect.objectContaining({ field: "duration", from: 20, to: 10 })])
  })
})

describe("the frame rate on every other model", () => {
  it("is neither queued nor recorded — LTX 2.3 and PixVerse V6 Max keep their jobs as they were", async () => {
    for (const provider of ["ltx-2.3-fast", "ltx-2.3-pro", "pixverse-v6-max", "seedance-2-fast"]) {
      vi.clearAllMocks()
      mockInsert.mockClear()
      const res = await t2v(provider, { fps: 50, duration: 8 })
      expect(res.statusCode, `${provider}: ${res.body}`).toBe(200)
      expect("fps" in queued(), provider).toBe(false)
      expect("fps" in recorded(), provider).toBe(false)
    }
  })
})

describe("the frame rate is read leniently, one way, on both routes", () => {
  it("a numeric string on LTX 2.5 runs as its number; a fraction or 0 runs at 24 and is disclosed", async () => {
    for (const [post, lane] of [[t2v, "t2v"], [i2v, "i2v"]] as const) {
      vi.clearAllMocks()
      let res = await post("ltx-2.5-fast", { fps: "50", duration: 20, resolution: "720p" })
      expect(res.statusCode, `${lane}: ${res.body}`).toBe(200)
      expect(queued()).toMatchObject({ fps: 50, duration: 10 })
      expect(reservedId()).toBe("ltx-2.5-fast:10s:720p")
      for (const fps of [29.97, 0]) {
        vi.clearAllMocks()
        res = await post("ltx-2.5-fast", { fps, duration: 20, resolution: "720p" })
        expect(res.statusCode, `${lane} ${fps}: ${res.body}`).toBe(200)
        expect(queued()).toMatchObject({ fps: 24, duration: 20 })
        expect(res.json().adjustments).toEqual(expect.arrayContaining([expect.objectContaining({ field: "fps", from: String(fps), to: 24 })]))
      }
    }
  })

  it("a model without the setting ignores any value, as before: no 400, nothing queued or recorded", async () => {
    for (const provider of ["ltx-2.3-fast", "seedance-2-fast"]) {
      for (const fps of ["48", 29.97, 0]) {
        vi.clearAllMocks()
        mockInsert.mockClear()
        const res = await t2v(provider, { fps, duration: 8 })
        expect(res.statusCode, `${provider} ${fps}: ${res.body}`).toBe(200)
        expect("fps" in queued(), `${provider} ${fps}`).toBe(false)
        expect("fps" in recorded(), `${provider} ${fps}`).toBe(false)
      }
    }
  })
})
