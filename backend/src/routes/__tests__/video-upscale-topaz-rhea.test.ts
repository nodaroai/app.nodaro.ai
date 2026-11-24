/**
 * `/v1/video-upscale` with provider `topaz-rhea`: the clip is measured and its
 * factor planned before anything is held; the guard prices the target's
 * one-second row × the billed seconds (the hold is the charge); the job and
 * the queue carry exactly the planned factor, target and seconds. Refusals come
 * before anything is read, created or held.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify"

vi.mock("@/lib/url-validator.js", async () => ({ safeUrlSchema: (await import("zod")).z.string().url() }))
vi.mock("@/lib/supabase.js", () => ({ supabase: { from: vi.fn(), auth: { getUser: vi.fn() } } }))
vi.mock("@/lib/queue.js", () => ({ videoQueue: { add: vi.fn().mockResolvedValue({ id: "queue-job-1" }) }, redis: {} }))
vi.mock("@/lib/admin-check.js", () => ({ warmAdminCache: vi.fn(), checkIsAdmin: vi.fn(async () => false) }))
vi.mock("@/lib/insert-job.js", () => ({ insertJob: vi.fn(async () => ({ data: { id: "job-1" }, error: null })) }))
vi.mock("@/middleware/credit-guard.js", () => ({
  // As the real guard: its `beforePricing` step (where the clip is copied and planned), then the price.
  creditGuard: (_resolve: unknown, opts?: { beforePricing?: (req: unknown, reply: unknown) => Promise<unknown> }) =>
    async (req: unknown, reply: { sent: boolean }) => { await opts?.beforePricing?.(req, reply) },
  reserveCreditsForJob: vi.fn(async () => ({ usageLogId: "usage-1", creditsReserved: 1, watermark: false })),
}))
// The outside-input copy: "copies" the clip to STORED and runs its inspect on a local path.
const STORED = "https://cdn.example/tmp/provider-input/copy.mp4"
vi.mock("@/lib/outside-input-copy.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/outside-input-copy.js")>()
  const run = async (opts: { inspect: (p: string, s: AbortSignal) => Promise<unknown> }) => {
    try {
      await opts.inspect("/tmp/outside-input/input", new AbortController().signal)
    } catch (reason) {
      throw new actual.OutsideInputInspectRefusedError(reason)
    }
  }
  return {
    ...actual,
    copyOutsideInput: vi.fn(async (_url: string, opts: { inspect: (p: string, s: AbortSignal) => Promise<unknown> }) => { await run(opts); return { url: STORED, bytes: 1, copied: true } }),
    inspectOutsideInput: vi.fn(async (_url: string, opts: { inspect: (p: string, s: AbortSignal) => Promise<unknown> }) => { await run(opts); return { bytes: 1 } }),
  }
})
vi.mock("@/lib/credit-base-cost.js", () => ({ unitRateBaseCredits: vi.fn(async (id: string, units: number) => Math.ceil(({ "topaz-rhea:720p:per-sec": 5, "topaz-rhea:1080p:per-sec": 10, "topaz-rhea:4k:per-sec": 30 }[id] ?? 0) * units)) }))
const fal = vi.hoisted(() => ({ enabled: true }))
vi.mock("@/providers/fal/enabled.js", () => ({ falEnabled: () => fal.enabled }))
vi.mock("@/providers/video/ffmpeg-utils.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../providers/video/ffmpeg-utils.js")>()),
  probeVideoSource: vi.fn(async () => ({ width: 480, height: 854, durationSeconds: 4, videoDurationSeconds: 4, fps: 24 })),
}))

import { videoUpscaleBody, videoUpscalePricing, videoUpscaleRoutes } from "../video-upscale.js"
import { probeVideoSource } from "../../providers/video/ffmpeg-utils.js"
import { insertJob } from "../../lib/insert-job.js"
import { videoQueue } from "../../lib/queue.js"
import { reserveCreditsForJob } from "../../middleware/credit-guard.js"

const USER = "00000000-0000-4000-8000-000000000001"
const CLIP = "https://cdn.example/take.mp4"
let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()
  fal.enabled = true
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    req.userId = USER
    req.authKind = "jwt"
  })
  await app.register(async (instance) => {
    await videoUpscaleRoutes(instance)
  })
  await app.ready()
})

afterEach(async () => {
  await app?.close()
})

const post = (payload: Record<string, unknown>) => app.inject({ method: "POST", url: "/v1/video-upscale", payload })

describe("the schema", () => {
  it("takes topaz-rhea with Topaz's targets, and refuses 2k as it does for Topaz", () => {
    expect(videoUpscaleBody.safeParse({ provider: "topaz-rhea", videoUrl: CLIP, targetResolution: "4k" }).success).toBe(true)
    expect(videoUpscaleBody.safeParse({ provider: "topaz-rhea", videoUrl: CLIP }).success).toBe(true)
    expect(videoUpscaleBody.safeParse({ provider: "topaz-rhea", videoUrl: CLIP, targetResolution: "2k" }).success).toBe(false)
    expect(videoUpscaleBody.safeParse({ provider: "topaz-rhea" }).success).toBe(false)
  })
})

describe("POST /v1/video-upscale with topaz-rhea", () => {
  it("measures the clip, stamps the factor, target and billed seconds on the job, and queues exactly them", async () => {
    const res = await post({ provider: "topaz-rhea", videoUrl: CLIP, targetResolution: "720p" })
    expect(res.statusCode, res.body).toBe(200)
    // Measured from the local copy; the job and the worker carry the STORED copy, never the caller's link.
    expect(probeVideoSource).toHaveBeenCalledWith("/tmp/outside-input/input", expect.anything())
    expect(vi.mocked(insertJob).mock.calls[0]![1].input_data).toMatchObject({
      provider: "topaz-rhea",
      videoUrl: STORED,
      targetResolution: "720p",
      upscaleRatio: 1.5,
      upscaleBilledSec: 4,
      upscaleFrameWidth: 720,
      upscaleFrameHeight: 1280,
      upscaleRateTier: "720p",
    })
    expect(vi.mocked(reserveCreditsForJob).mock.calls[0]![3]).toBe("topaz-rhea:720p:per-sec")
    expect(videoQueue.add).toHaveBeenCalledWith("video-upscale", {
      jobId: "job-1",
      provider: "topaz-rhea",
      videoUrl: STORED,
      targetResolution: "720p",
      upscaleRatio: 1.5,
      upscaleBilledSec: 4,
      upscaleFrameWidth: 720,
      upscaleFrameHeight: 1280,
      upscaleRateTier: "720p",
      usageLogId: "usage-1",
    })
  })

  it("no target runs at 1080p", async () => {
    const res = await post({ provider: "topaz-rhea", videoUrl: CLIP })
    expect(res.statusCode, res.body).toBe(200)
    expect(videoQueue.add).toHaveBeenCalledWith("video-upscale", expect.objectContaining({ targetResolution: "1080p", upscaleRatio: 2.25 }))
  })

  it("refuses a clip already at or above the target (400), before anything is created or held", async () => {
    vi.mocked(probeVideoSource).mockResolvedValueOnce({ width: 1920, height: 1080, durationSeconds: 4, videoDurationSeconds: 4, fps: 24 })
    const refused = await post({ provider: "topaz-rhea", videoUrl: CLIP, targetResolution: "1080p" })
    expect(refused.statusCode).toBe(400)
    expect(refused.json().error).toEqual({
      code: "video_already_at_target",
      message: "This clip is already 1920×1080, at or above 1080p — there is nothing to upscale. Choose a larger target resolution.",
    })
    expect(insertJob).not.toHaveBeenCalled()
    expect(videoQueue.add).not.toHaveBeenCalled()
  })

  it("refuses a frame rate or a legacy factor (400), before the clip is read", async () => {
    for (const extra of [{ targetFps: 30 }, { upscaleFactor: "2" }]) {
      const res = await post({ provider: "topaz-rhea", videoUrl: CLIP, ...extra })
      expect(res.statusCode).toBe(400)
      expect(res.json().error.code).toBe("validation_error")
    }
    expect(probeVideoSource).not.toHaveBeenCalled()
    expect(insertJob).not.toHaveBeenCalled()
  })

  it("refuses 2k as a validation error", async () => {
    const res = await post({ provider: "topaz-rhea", videoUrl: CLIP, targetResolution: "2k" })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
    expect(insertJob).not.toHaveBeenCalled()
  })

  it("an install with no fal key: 503 provider_unavailable, before the clip is read", async () => {
    fal.enabled = false
    const res = await post({ provider: "topaz-rhea", videoUrl: CLIP })
    expect(res.statusCode).toBe(503)
    expect(res.json().error.code).toBe("provider_unavailable")
    expect(probeVideoSource).not.toHaveBeenCalled()
    expect(insertJob).not.toHaveBeenCalled()
  })

  it("Topaz's own lane is untouched: no Rhea plan, the unit row", async () => {
    const res = await post({ provider: "topaz", videoUrl: CLIP, targetResolution: "1080p", targetFps: 24 })
    expect(res.statusCode, res.body).toBe(200)
    expect(vi.mocked(reserveCreditsForJob).mock.calls[0]![3]).toBe("topaz-video:per-unit")
    expect(vi.mocked(videoQueue.add).mock.calls[0]![1]).not.toHaveProperty("upscaleRatio")
  })
})

describe("the pricing chain (the route's guard, and POST /v1/quote)", () => {
  it("prices the target's row × the billed seconds, the hold being the charge", async () => {
    const req = { body: { provider: "topaz-rhea", videoUrl: CLIP, targetResolution: "4k" }, userId: "u-1" } as unknown as FastifyRequest
    vi.mocked(probeVideoSource).mockResolvedValueOnce({ width: 1080, height: 1920, durationSeconds: 9.5, videoDurationSeconds: 9.5, fps: 30 })
    const reply = { status: () => ({ send: () => undefined }), sent: false, raw: { on: () => undefined, once: () => undefined, off: () => undefined, removeListener: () => undefined }, request: { raw: { on: () => undefined, once: () => undefined, off: () => undefined, removeListener: () => undefined } } } as never
    for (const pre of videoUpscalePricing.prechecks) await pre(req, reply)
    await videoUpscalePricing.opts!.beforePricing!(req, reply)
    // The exact length: 9.5 s, billed 9.5 s (not 10).
    expect(req.topazRheaUpscale).toMatchObject({ target: "4k", upscaleFactor: 2, billedSec: 9.5, outputWidth: 2160, outputHeight: 3840, creditId: "topaz-rhea:4k:per-sec" })
    expect(videoUpscalePricing.modelResolver(req)).toBe("topaz-rhea:4k:per-sec")
    expect(await videoUpscalePricing.opts!.computeCredits!(req.body as never, req)).toBe(285)
  })
})
