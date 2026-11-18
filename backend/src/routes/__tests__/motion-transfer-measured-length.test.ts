/**
 * POST /v1/motion-transfer is priced from its DRIVING video as the server
 * measures it (decided 2026-11-18), never the `videoDuration` a request names
 * (MCP's `motion_transfer` and the SDK reach this route). The video is
 * measured inside the credit guard (`beforePricing`), before anything is held:
 * under 3 s, past the model's limit (10 s keeping the image's orientation, 30 s
 * following the video's, 30 s on Wan Animate — each with 0.05 s of grace), or
 * unreadable is refused with nothing held and no job row. Kling 3.0 at 720p is
 * charged its four-second row × the billed seconds ÷ 4; every other model and
 * size keeps its rows, read from the measured length. The probe, the guard and
 * the queue are stood in for.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

const state = vi.hoisted(() => ({
  /** What the driving video measures, in seconds, or "unreadable". */
  video: 10 as number | "unreadable",
  guardCalls: [] as Array<{ identifier: string; base: number | undefined }>,
  /** The length the request named, as the guard sees the body. */
  guardSawLength: [] as unknown[],
}))

vi.mock("@/lib/video-utility-probe.js", () => ({
  probeClipLengthSec: vi.fn(async () => {
    if (state.video === "unreadable") throw new Error("ffprobe: Invalid data found when processing input")
    return state.video
  }),
}))
vi.mock("@/lib/credit-base-cost.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/credit-base-cost.js")>()),
  // The row's base × the units, rounded up once (the real composition, with the seeded row).
  unitRateBaseCredits: async (rateId: string, units: number) => (rateId === "kling-3.0-motion:720p:per-4s" ? Math.ceil(228 * units) : 0),
}))
vi.mock("@/lib/insert-job.js", () => ({ insertJob: vi.fn(async () => ({ data: { id: "job-1" }, error: null })) }))
vi.mock("@/lib/queue.js", () => ({ videoQueue: { add: vi.fn().mockResolvedValue({ id: "queue-job-1" }) }, redis: {} }))
vi.mock("@/middleware/credit-guard.js", () => ({
  // As the real guard: its `beforePricing` step (the measurement) after its doors, then the pricing.
  creditGuard: (
    resolve: (req: unknown) => string,
    opts?: { computeCredits?: (body: unknown, req: unknown) => Promise<number | undefined>; beforePricing?: (req: unknown, reply: unknown) => Promise<unknown> },
  ) =>
    async (req: { body: unknown }, reply: { sent: boolean }) => {
      await opts?.beforePricing?.(req, reply)
      if (reply.sent) return
      state.guardSawLength.push((req.body as Record<string, unknown>).videoDuration)
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

import { motionTransferRoutes } from "../motion-transfer.js"
import { insertJob } from "@/lib/insert-job.js"
import { videoQueue } from "@/lib/queue.js"
import { reserveCreditsForJob } from "@/middleware/credit-guard.js"

const USER = "00000000-0000-4000-8000-000000000001"
const body = (over: Record<string, unknown> = {}) => ({
  imageUrl: "https://cdn.test/character.png",
  videoUrl: "https://cdn.test/dance.mp4",
  provider: "kling-3.0",
  resolution: "720p",
  userId: USER,
  ...over,
})

describe("POST /v1/motion-transfer — priced on the driving video the server measures", () => {
  let app: FastifyInstance

  beforeEach(async () => {
    vi.clearAllMocks()
    state.video = 10
    state.guardCalls = []
    state.guardSawLength = []
    app = Fastify({ logger: false })
    app.addHook("preHandler", async (req) => {
      const b = req.body as Record<string, unknown> | undefined
      if (typeof b?.userId === "string") req.userId = b.userId
    })
    await app.register(async (i) => { await motionTransferRoutes(i) })
    await app.ready()
  })

  afterEach(async () => { await app.close() })

  const run = (over: Record<string, unknown> = {}) => app.inject({ method: "POST", url: "/v1/motion-transfer", payload: body(over) })

  function expectNothingHeld(): void {
    expect(state.guardCalls).toEqual([])
    expect(insertJob).not.toHaveBeenCalled()
    expect(reserveCreditsForJob).not.toHaveBeenCalled()
    expect(videoQueue.add).not.toHaveBeenCalled()
  }

  it("a request declaring 1 s for a 10 s video is held on 10 s: Kling 3.0 720p, ceil(228 × 10 / 4) = 570 base", async () => {
    const res = await run({ videoDuration: 1 })
    expect(res.statusCode).toBe(200)
    expect(state.guardCalls).toEqual([{ identifier: "kling-3.0-motion:720p:per-4s", base: 570 }])
    // The declared length never reaches the guard.
    expect(state.guardSawLength).toEqual([undefined])
    expect(vi.mocked(reserveCreditsForJob).mock.calls[0]![3]).toBe("kling-3.0-motion:720p:per-4s")
    // The job records the measured length and the seconds it was held for; the worker is handed them.
    const inserted = vi.mocked(insertJob).mock.calls[0]![1] as { input_data: Record<string, unknown> }
    expect(inserted.input_data).toMatchObject({ videoDuration: 10, motionTransferBilledSeconds: 10 })
    expect(vi.mocked(videoQueue.add).mock.calls[0]![1]).toMatchObject({ videoDuration: 10, motionTransferBilledSeconds: 10 })
  })

  it("3 s: ceil(228 × 3 / 4) = 171 base", async () => {
    state.video = 3
    const res = await run()
    expect(res.statusCode).toBe(200)
    expect(state.guardCalls).toEqual([{ identifier: "kling-3.0-motion:720p:per-4s", base: 171 }])
  })

  it("rounds the measured length up after 0.05 s of grace: 6.2 s is billed 7 s, 10.04 s is billed 10 s", async () => {
    state.video = 6.2
    await run()
    state.video = 10.04
    await run()
    expect(state.guardCalls.map((c) => c.base)).toEqual([Math.ceil(228 * 7 / 4), 570])
  })

  it("every other model and size keeps its rows, from the measured length (no per-second base)", async () => {
    state.video = 12
    await run({ resolution: "1080p", characterOrientation: "video", videoDuration: 3 })
    await run({ provider: "kling", resolution: "720p", characterOrientation: "video", videoDuration: 3 })
    await run({ provider: "wan-animate-move", resolution: "580p" })
    expect(state.guardCalls).toEqual([
      { identifier: "kling-3.0-motion:1080p:15s", base: undefined },
      { identifier: "motion-transfer:15s", base: undefined },
      { identifier: "wan-animate-move:580p", base: undefined },
    ])
  })

  it.each([
    ["Kling 3.0, keeping the image's orientation (the default)", { provider: "kling-3.0" }, 10.1, "at most 10 seconds"],
    ["Kling 2.6, keeping the image's orientation", { provider: "kling", characterOrientation: "image" }, 11, "at most 10 seconds"],
    ["Kling 3.0, following the video's orientation", { provider: "kling-3.0", characterOrientation: "video" }, 30.1, "at most 30 seconds"],
    ["Wan Animate", { provider: "wan-animate-replace" }, 31, "at most 30 seconds"],
  ])("refuses a video past the limit with nothing held: %s", async (_label, over, sec, says) => {
    state.video = sec
    const res = await run(over)
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("video_too_long")
    expect(res.json().error.message).toContain(says)
    expect(res.json().error.message).toContain("Trim the video first")
    expectNothingHeld()
  })

  it("accepts a video within 0.05 s past the limit and holds it at the limit", async () => {
    state.video = 10.05
    const res = await run()
    expect(res.statusCode).toBe(200)
    expect(state.guardCalls).toEqual([{ identifier: "kling-3.0-motion:720p:per-4s", base: 570 }])
  })

  it("refuses a video under 3 s with nothing held", async () => {
    state.video = 2.5
    const res = await run()
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("video_too_short")
    expect(res.json().error.message).toContain("at least 3 seconds")
    expectNothingHeld()
  })

  it("refuses a video that cannot be read with nothing held, never priced on a guess", async () => {
    state.video = "unreadable"
    const res = await run({ videoDuration: 5 })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("video_unreadable")
    expect(res.json().error.message).toContain("could not be read")
    expectNothingHeld()
  })

  it("a body the schema refuses is a 400 before anything is measured", async () => {
    const res = await run({ provider: "not-a-model" })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
    expectNothingHeld()
  })
})
