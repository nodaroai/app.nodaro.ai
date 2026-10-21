import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

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

const reserve = vi.fn().mockResolvedValue({ usageLogId: "u-1", creditsReserved: 20, watermark: false })
let guardedCredits: number | undefined
vi.mock("@/middleware/credit-guard.js", () => ({
  // Records the BASE credits the real guard would price, from the hook the route gives it.
  creditGuard: (_id: unknown, opts?: { computeCredits?: (body: unknown) => Promise<number> }) =>
    async (req: { body: unknown }) => { guardedCredits = opts?.computeCredits ? await opts.computeCredits(req.body) : undefined },
  reserveCreditsForJob: (...args: unknown[]) => reserve(...args),
}))

const probe = vi.fn()
vi.mock("@/providers/video/ffmpeg-utils.js", () => ({ probeVideoSource: (url: string) => probe(url) }))
// The row lookup, stubbed; the per-unit charge composes it the way the real module does (row × units, rounded up once).
vi.mock("@/lib/credit-base-cost.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/credit-base-cost.js")>()
  const baseCreditCostFor = async (id: string) => (id === "mask-composite" ? 10 : 0)
  return {
    baseCreditCostFor,
    quoteBaseCredits: real.quoteBaseCredits,
    unitRateBaseCredits: async (id: string, units: number) => real.quoteBaseCredits(await baseCreditCostFor(id), units),
  }
})

vi.mock("@/lib/config.js", () => ({
  config: { EDITION: "cloud" },
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

import { maskCompositeRoutes } from "../mask-composite.js"
import { supabase } from "../../lib/supabase.js"
import { videoQueue } from "../../lib/queue.js"

const USER = "00000000-0000-4000-8000-000000000001"
const URLS = { foregroundUrl: "https://example.com/fg.mp4", backgroundUrl: "https://example.com/bg.mp4", maskUrl: "https://example.com/mask.mp4" }
let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()
  guardedCredits = undefined
  probe.mockResolvedValue({ width: 1280, height: 720, durationSeconds: 12, fps: 30 })
  vi.mocked(supabase.from).mockReturnValue({
    insert: vi.fn().mockReturnValue({ select: () => ({ single: () => Promise.resolve({ data: { id: "job-mc-1" }, error: null }) }) }),
  } as never)
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    const body = req.body as Record<string, unknown> | undefined
    if (body?.userId && typeof body.userId === "string") req.userId = body.userId
  })
  await app.register(async (i) => { await maskCompositeRoutes(i) })
  await app.ready()
})

afterEach(async () => { await app.close() })

const post = (payload: Record<string, unknown>) => app.inject({ method: "POST", url: "/v1/mask-composite", payload })

describe("POST /v1/mask-composite", () => {
  it("prices one unit per started 5 s of the measured foreground, fills the defaults and enqueues", async () => {
    const res = await post({ ...URLS, userId: USER })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ jobId: "job-mc-1" })
    expect(probe).toHaveBeenCalledWith("https://example.com/fg.mp4")
    // 12 s → 3 units × the 10-credit row.
    expect(guardedCredits).toBe(30)
    expect(reserve).toHaveBeenCalledWith(expect.anything(), expect.anything(), "job-mc-1", "mask-composite")
    expect(videoQueue.add).toHaveBeenCalledWith("mask-composite", {
      jobId: "job-mc-1", ...URLS, invertMask: false, feather: 2, grow: 0, opacity: 1, fill: "video", pixelSizePct: 1.25, blurStrengthPct: 2, backgroundFit: "cover", audioSource: "foreground", usageLogId: "u-1",
    })
  })

  it("passes explicit settings through", async () => {
    await post({ ...URLS, invertMask: true, feather: 8, grow: -3, backgroundFit: "contain", audioSource: "mix", userId: USER })
    expect(videoQueue.add).toHaveBeenCalledWith("mask-composite", expect.objectContaining({ invertMask: true, feather: 8, grow: -3, backgroundFit: "contain", audioSource: "mix" }))
  })

  it("accepts an opacity from 0 to 1 and passes it through", async () => {
    for (const opacity of [0, 1, 0.85]) {
      vi.mocked(videoQueue.add).mockClear()
      expect((await post({ ...URLS, opacity, userId: USER })).statusCode).toBe(200)
      expect(videoQueue.add).toHaveBeenCalledWith("mask-composite", expect.objectContaining({ opacity }))
    }
  })

  it("refuses an opacity outside 0–1 or not a number", async () => {
    expect((await post({ ...URLS, opacity: 1.5, userId: USER })).statusCode).toBe(400)
    expect((await post({ ...URLS, opacity: -0.1, userId: USER })).statusCode).toBe(400)
    expect((await post({ ...URLS, opacity: "0.5", userId: USER })).statusCode).toBe(400)
    expect(videoQueue.add).not.toHaveBeenCalled()
  })

  describe("fill", () => {
    const { foregroundUrl: _f, ...NO_FG } = URLS

    it("defaults to video, which still needs a foreground (400, nothing probed or queued)", async () => {
      const res = await post({ ...NO_FG, userId: USER })
      expect(res.statusCode).toBe(400)
      expect(res.json().error.code).toBe("validation_error")
      expect(res.json().error.message).toMatch(/foregroundUrl/)
      expect((await post({ ...NO_FG, fill: "video", userId: USER })).statusCode).toBe(400)
      expect(probe).not.toHaveBeenCalled()
      expect(videoQueue.add).not.toHaveBeenCalled()
    })

    it.each(["pixelate", "blur"] as const)("%s runs without a foreground, measuring and pricing the background", async (fill) => {
      probe.mockResolvedValue({ width: 1280, height: 720, durationSeconds: 21, fps: 30 })
      const res = await post({ ...NO_FG, fill, userId: USER })
      expect(res.statusCode).toBe(200)
      expect(probe).toHaveBeenCalledTimes(1)
      expect(probe).toHaveBeenCalledWith("https://example.com/bg.mp4")
      // 21 s of background → 5 units × the 10-credit row.
      expect(guardedCredits).toBe(50)
      expect(videoQueue.add).toHaveBeenCalledWith("mask-composite", expect.objectContaining({ fill, backgroundUrl: URLS.backgroundUrl, maskUrl: URLS.maskUrl }))
      expect(vi.mocked(videoQueue.add).mock.calls[0]![1]).not.toHaveProperty("foregroundUrl")
    })

    it("ignores a foreground sent with pixelate: the background is measured, and the foreground is neither probed nor queued", async () => {
      probe.mockImplementation(async (url: string) => ({ width: 1280, height: 720, durationSeconds: url.endsWith("bg.mp4") ? 6 : 200, fps: 30 }))
      const res = await post({ ...URLS, fill: "pixelate", userId: USER })
      expect(res.statusCode).toBe(200)
      expect(probe).toHaveBeenCalledTimes(1)
      expect(probe).toHaveBeenCalledWith("https://example.com/bg.mp4")
      expect(guardedCredits).toBe(20)
      expect(vi.mocked(videoQueue.add).mock.calls[0]![1]).not.toHaveProperty("foregroundUrl")
      const insert = vi.mocked(supabase.from).mock.results[0]!.value.insert as ReturnType<typeof vi.fn>
      expect(insert.mock.calls[0]![0].input_data).not.toHaveProperty("foregroundUrl")
    })

    it("ignores even a malformed foreground with blur (dropped, never validated or probed)", async () => {
      const res = await post({ ...URLS, foregroundUrl: "not a url", fill: "blur", userId: USER })
      expect(res.statusCode).toBe(200)
      expect(probe).toHaveBeenCalledWith("https://example.com/bg.mp4")
      expect(vi.mocked(videoQueue.add).mock.calls[0]![1]).not.toHaveProperty("foregroundUrl")
      // The video fill still validates it.
      expect((await post({ ...URLS, foregroundUrl: "not a url", userId: USER })).statusCode).toBe(400)
    })

    it("refuses a background over 300 s or unreadable with the background named, before anything is priced", async () => {
      probe.mockResolvedValueOnce({ width: 1280, height: 720, durationSeconds: 301, fps: 30 })
      const over = await post({ ...NO_FG, fill: "blur", userId: USER })
      expect(over.statusCode).toBe(400)
      expect(over.json().error.code).toBe("video_duration_exceeds_limit")
      expect(over.json().error.message).toMatch(/background/)
      probe.mockRejectedValueOnce(new Error("bad"))
      const bad = await post({ ...NO_FG, fill: "blur", userId: USER })
      expect(bad.json().error.code).toBe("invalid_video_duration")
      expect(bad.json().error.message).toMatch(/background/)
      expect(guardedCredits).toBeUndefined()
      expect(videoQueue.add).not.toHaveBeenCalled()
    })

    it("passes pixelSizePct and blurStrengthPct through, with their defaults", async () => {
      expect((await post({ ...NO_FG, fill: "pixelate", pixelSizePct: 0.2, userId: USER })).statusCode).toBe(200)
      expect(videoQueue.add).toHaveBeenLastCalledWith("mask-composite", expect.objectContaining({ pixelSizePct: 0.2, blurStrengthPct: 2 }))
      expect((await post({ ...NO_FG, fill: "blur", blurStrengthPct: 5, userId: USER })).statusCode).toBe(200)
      expect(videoQueue.add).toHaveBeenLastCalledWith("mask-composite", expect.objectContaining({ pixelSizePct: 1.25, blurStrengthPct: 5 }))
      expect((await post({ ...NO_FG, fill: "blur", blurStrengthPct: 0.1, pixelSizePct: 10, userId: USER })).statusCode).toBe(200)
    })

    it("refuses an unknown fill and out-of-bounds pixelSizePct / blurStrengthPct", async () => {
      expect((await post({ ...URLS, fill: "mosaic", userId: USER })).statusCode).toBe(400)
      for (const pixelSizePct of [0.1, 10.5, "2"]) expect((await post({ ...NO_FG, fill: "pixelate", pixelSizePct, userId: USER })).statusCode).toBe(400)
      for (const blurStrengthPct of [0, 5.5, "2"]) expect((await post({ ...NO_FG, fill: "blur", blurStrengthPct, userId: USER })).statusCode).toBe(400)
      expect(videoQueue.add).not.toHaveBeenCalled()
    })
  })

  it("refuses a missing input and out-of-range settings", async () => {
    const { maskUrl: _m, ...noMask } = URLS
    expect((await post({ ...noMask, userId: USER })).statusCode).toBe(400)
    expect((await post({ ...URLS, feather: 21, userId: USER })).statusCode).toBe(400)
    expect((await post({ ...URLS, grow: 11, userId: USER })).statusCode).toBe(400)
    expect((await post({ ...URLS, backgroundFit: "tile", userId: USER })).statusCode).toBe(400)
    expect(videoQueue.add).not.toHaveBeenCalled()
  })

  it("refuses a foreground over 300 s or unreadable before anything is priced", async () => {
    probe.mockResolvedValueOnce({ width: 1280, height: 720, durationSeconds: 301, fps: 30 })
    const over = await post({ ...URLS, userId: USER })
    expect(over.statusCode).toBe(400)
    expect(over.json().error.code).toBe("video_duration_exceeds_limit")
    probe.mockRejectedValueOnce(new Error("bad"))
    const bad = await post({ ...URLS, userId: USER })
    expect(bad.json().error.code).toBe("invalid_video_duration")
    expect(guardedCredits).toBeUndefined()
    expect(videoQueue.add).not.toHaveBeenCalled()
  })

  it("never probes a value that is not a safe URL", async () => {
    const res = await post({ ...URLS, foregroundUrl: "not a url", userId: USER })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
    expect(probe).not.toHaveBeenCalled()
  })

  it("returns 401 without a user", async () => {
    expect((await post(URLS)).statusCode).toBe(401)
  })
})
