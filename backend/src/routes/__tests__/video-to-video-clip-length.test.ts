/**
 * POST /v1/video-to-video on HappyHorse Edit and Wan 2.7 VideoEdit is priced
 * from the length of its clip as the server reads it (decided 2026-11-18),
 * inside the credit guard (`beforePricing`), before anything is held. A clip
 * outside the model's limits, or one that cannot be read, is refused with
 * nothing held and no job row. Every other model is never probed and keeps
 * its flat row. The probe, the guard and the queue are stood in for.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

const ROWS: Record<string, number> = {
  "wan-videoedit": 320,
  "wan-videoedit:1080p:per-4s": 240,
  "happyhorse-edit:720p:per-4s": 560,
  "happyhorse-edit:1080p:per-4s": 960,
}

const state = vi.hoisted(() => ({
  /** The clip's length, in seconds, or "unreadable". */
  video: 10 as number | "unreadable",
  probes: 0,
  guardCalls: [] as Array<{ identifier: string; base: number | undefined }>,
}))

vi.mock("@/lib/video-utility-probe.js", () => ({
  probeClipLengthSec: vi.fn(async () => {
    state.probes++
    if (state.video === "unreadable") throw new Error("ffprobe: Invalid data found when processing input")
    return state.video
  }),
}))
vi.mock("@/lib/credit-base-cost.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/credit-base-cost.js")>()),
  // The seeded rows, and the real composition: the row × the units, rounded up once.
  baseCreditCostFor: async (id: string) => ROWS[id] ?? 0,
  unitRateBaseCredits: async (rateId: string, units: number) => Math.ceil((ROWS[rateId] ?? 0) * units),
}))
vi.mock("@/lib/insert-job.js", () => ({ insertJob: vi.fn(async () => ({ data: { id: "job-1" }, error: null })) }))
vi.mock("@/lib/queue.js", () => ({ videoQueue: { add: vi.fn().mockResolvedValue({ id: "queue-job-1" }) }, redis: {} }))
vi.mock("@/middleware/credit-guard.js", () => ({
  // As the real guard: its `beforePricing` step after its doors, then the pricing.
  creditGuard: (
    resolve: (req: unknown) => string,
    opts?: { computeCredits?: (body: unknown, req: unknown) => Promise<number | undefined>; beforePricing?: (req: unknown, reply: unknown) => Promise<unknown> },
  ) =>
    async (req: { body: unknown }, reply: { sent: boolean }) => {
      await opts?.beforePricing?.(req, reply)
      if (reply.sent) return
      state.guardCalls.push({ identifier: resolve(req), base: await opts?.computeCredits?.(req.body, req) })
    },
  reserveCreditsForJob: vi.fn().mockResolvedValue({ usageLogId: "u-1", creditsReserved: 1, watermark: false }),
}))
vi.mock("@/lib/config.js", () => ({
  config: { EDITION: "cloud", SUPABASE_URL: "https://test.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "test" },
  isCloud: () => true, hasCredits: () => true, isCommunity: () => false, isBusiness: () => false, hasAdmin: () => true,
}))
vi.mock("@/lib/url-validator.js", async () => {
  const { z } = await import("zod")
  return { safeUrlSchema: z.string().url() }
})
vi.mock("@/lib/request-helpers.js", () => ({
  extractWorkflowId: vi.fn().mockReturnValue(null),
  extractNodeId: vi.fn().mockReturnValue(null),
  extractForcePrivate: vi.fn().mockReturnValue(false),
}))

import { videoToVideoRoutes } from "../video-to-video.js"
import { insertJob } from "@/lib/insert-job.js"
import { videoQueue } from "@/lib/queue.js"
import { reserveCreditsForJob } from "@/middleware/credit-guard.js"

const USER = "00000000-0000-4000-8000-000000000001"
const body = (over: Record<string, unknown> = {}) => ({
  videoUrl: "https://cdn.test/clip.mp4",
  prompt: "make it night",
  provider: "happyhorse-edit",
  userId: USER,
  ...over,
})

describe("POST /v1/video-to-video — HappyHorse Edit and Wan 2.7 VideoEdit priced by their clip's length", () => {
  let app: FastifyInstance

  beforeEach(async () => {
    vi.clearAllMocks()
    state.video = 10
    state.probes = 0
    state.guardCalls = []
    app = Fastify({ logger: false })
    app.addHook("preHandler", async (req) => {
      const b = req.body as Record<string, unknown> | undefined
      if (typeof b?.userId === "string") req.userId = b.userId
    })
    await app.register(async (i) => { await videoToVideoRoutes(i) })
    await app.ready()
  })

  afterEach(async () => { await app.close() })

  const run = (over: Record<string, unknown> = {}) => app.inject({ method: "POST", url: "/v1/video-to-video", payload: body(over) })

  function expectNothingHeld(): void {
    expect(state.guardCalls).toEqual([])
    expect(insertJob).not.toHaveBeenCalled()
    expect(reserveCreditsForJob).not.toHaveBeenCalled()
    expect(videoQueue.add).not.toHaveBeenCalled()
  }

  it("HappyHorse Edit, a 10 s clip with a request claiming 1 s: held on 10 s at 720p, ceil(560 × 20 / 8) = 1,400 base", async () => {
    const res = await run({ videoDuration: 1 })
    expect(res.statusCode).toBe(200)
    expect(state.guardCalls).toEqual([{ identifier: "happyhorse-edit:720p:per-4s", base: 1400 }])
    expect(vi.mocked(reserveCreditsForJob).mock.calls[0]![3]).toBe("happyhorse-edit:720p:per-4s")
    const inserted = vi.mocked(insertJob).mock.calls[0]![1] as { input_data: Record<string, unknown> }
    expect(inserted.input_data).toMatchObject({ videoDuration: 10, videoToVideoBilledSeconds: 10, resolution: "720p" })
    // The worker runs the model it names, at the size it was priced at, with the length recorded.
    expect(vi.mocked(videoQueue.add).mock.calls[0]![1]).toMatchObject({ provider: "happyhorse-edit", resolution: "720p", videoDuration: 10, videoToVideoBilledSeconds: 10 })
  })

  it("HappyHorse Edit worked examples: 3.00 s → 420, 10.04 s → 1,470 at 720p; 3.00 s at 1080p → 720 (base)", async () => {
    state.video = 3
    await run()
    state.video = 10.04
    await run({ resolution: "720p" })
    state.video = 3
    await run({ resolution: "1080p" })
    expect(state.guardCalls).toEqual([
      { identifier: "happyhorse-edit:720p:per-4s", base: 420 },
      { identifier: "happyhorse-edit:720p:per-4s", base: 1470 },
      { identifier: "happyhorse-edit:1080p:per-4s", base: 720 },
    ])
    // The size priced is the size sent.
    expect(vi.mocked(videoQueue.add).mock.calls.map((c) => (c[1] as { resolution?: string }).resolution)).toEqual(["720p", "720p", "1080p"])
  })

  it("Wan 2.7 VideoEdit is charged the larger of its flat row and its rate: 3 s and 5 s stay 320, 6 s is 360, 10 s is 600 (base)", async () => {
    for (const sec of [3, 5, 6, 10]) {
      state.video = sec
      expect((await run({ provider: "wan-videoedit" })).statusCode).toBe(200)
    }
    expect(state.guardCalls).toEqual([
      { identifier: "wan-videoedit", base: undefined },
      { identifier: "wan-videoedit", base: undefined },
      { identifier: "wan-videoedit:1080p:per-4s", base: 360 },
      { identifier: "wan-videoedit:1080p:per-4s", base: 600 },
    ])
    expect(vi.mocked(reserveCreditsForJob).mock.calls.map((c) => c[3])).toEqual(["wan-videoedit", "wan-videoedit", "wan-videoedit:1080p:per-4s", "wan-videoedit:1080p:per-4s"])
    // Wan 2.7 VideoEdit's resolution is sent as given (absent stays absent: the model renders 1080p).
    expect((vi.mocked(videoQueue.add).mock.calls[0]![1] as { resolution?: string }).resolution).toBeUndefined()
  })

  it("Wan 2.7 VideoEdit asked for 5 s of a 10 s clip is billed 5 s (its flat row)", async () => {
    const res = await run({ provider: "wan-videoedit", videoEditDuration: "5" })
    expect(res.statusCode).toBe(200)
    expect(state.guardCalls).toEqual([{ identifier: "wan-videoedit", base: undefined }])
  })

  it.each([
    ["HappyHorse Edit, under 3 s", { provider: "happyhorse-edit" }, 2.9, "video_too_short", "at least 3 seconds"],
    ["HappyHorse Edit, past 60 s", { provider: "happyhorse-edit" }, 60.02, "video_too_long", "at most 60 seconds"],
    ["Wan 2.7 VideoEdit, under 2 s", { provider: "wan-videoedit" }, 1.9, "video_too_short", "at least 2 seconds"],
    ["Wan 2.7 VideoEdit, past 10.05 s", { provider: "wan-videoedit" }, 10.1, "video_too_long", "at most 10 seconds"],
  ])("refuses a clip outside the model's limits with nothing held: %s", async (_label, over, sec, code, says) => {
    state.video = sec
    const res = await run(over)
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe(code)
    expect(res.json().error.message).toContain(says)
    expectNothingHeld()
  })

  it("refuses a clip that cannot be read with nothing held, never priced on a guess", async () => {
    state.video = "unreadable"
    const res = await run()
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("video_unreadable")
    expectNothingHeld()
  })

  it("every other model is never probed and keeps its flat row", async () => {
    for (const provider of ["wan", "wan-flash", "runway-aleph", "luma-modify"]) {
      expect((await run({ provider })).statusCode).toBe(200)
    }
    expect(state.probes).toBe(0)
    expect(state.guardCalls).toEqual([
      { identifier: "wan", base: undefined },
      { identifier: "wan-flash", base: undefined },
      { identifier: "runway-aleph", base: undefined },
      { identifier: "luma-modify", base: undefined },
    ])
  })
})
