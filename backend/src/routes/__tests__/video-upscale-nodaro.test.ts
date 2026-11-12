import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

/**
 * /v1/video-upscale provider `nodaro-video-upscale` (decided 2026-11-11): the
 * provider is refused where the deployment does not serve it, and an outside
 * link where the deployment turned them off, before the clip is fetched;
 * otherwise the clip is copied to our storage and measured by the credit
 * guard's `beforePricing` step (past its cheaper gates, before the price), a
 * clip past a limit is refused, and so is one the deployment plans no run for
 * — each before anything is reserved or a job exists. The stored
 * clip's URL is what the job records and the worker sends. The
 * guard holds the tier's row at the clip's exact price, and the job carries
 * the tier and the measured seconds, never a frame rate or a factor.
 */

const STORED = "https://cdn.example.com/tmp/provider-input/outside-input-x.mp4"
const plan = vi.hoisted(() => ({
  result: { tier: "2k", creditId: "nodaro-video-upscale:2k:per-4s", videoUrl: "https://cdn.example.com/tmp/provider-input/outside-input-x.mp4", sourceDurationSec: 9.4, billedSec: 10, sourceSizeBytes: 12_000_000 } as Record<string, unknown>,
  error: undefined as Error | undefined,
  calls: [] as unknown[][],
}))
vi.mock("@/lib/nodaro-video-upscale-plan.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/nodaro-video-upscale-plan.js")>()),
  planNodaroVideoUpscale: vi.fn(async (...args: unknown[]) => {
    plan.calls.push(args)
    if (plan.error) throw plan.error
    return plan.result
  }),
  // The 2K row × 10 s ÷ 4, as the real helper reads it.
  nodaroVideoUpscaleBaseCredits: vi.fn().mockResolvedValue(75),
}))
const seam = vi.hoisted(() => ({ served: true, planned: true, linksOff: false }))
vi.mock("@/lib/house-models.js", () => ({
  houseModelServed: vi.fn(() => seam.served),
  planHouseModelRun: vi.fn(() => (seam.planned ? { providerCostUsd: 0.25 } : null)),
  runHouseModelTask: vi.fn(),
}))
vi.mock("@/lib/link-imports.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/link-imports.js")>()),
  linkImportRefusal: vi.fn(() => (seam.linksOff ? { code: "link_imports_disabled", message: "Importing media from a link to another site is turned off on this deployment. Upload the file instead." } : null)),
}))
vi.mock("@/lib/topaz-video-plan.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/topaz-video-plan.js")>()),
  planTopazVideoUpscale: vi.fn().mockResolvedValue({ resolution: "1080p", fps: 30, holdUnits: 3, sourceDurationSec: 5 }),
  topazVideoHoldBaseCredits: vi.fn().mockResolvedValue(120),
}))
vi.mock("@/lib/insert-job.js", () => ({
  insertJob: vi.fn().mockResolvedValue({ data: { id: "job-nvu" }, error: null }),
}))
vi.mock("@/lib/queue.js", () => ({ videoQueue: { add: vi.fn().mockResolvedValue({ id: "q" }) }, redis: {} }))
vi.mock("@/middleware/credit-guard.js", () => ({
  // As the real guard: its `beforePricing` step past the gates, then the price.
  creditGuard: (
    resolve: (req: unknown) => string,
    opts?: {
      computeCredits?: (body: unknown, req: unknown) => Promise<number | undefined>
      beforePricing?: (req: unknown, reply: unknown) => Promise<unknown>
    },
  ) => async (req: { body: unknown }, reply: { sent: boolean }) => {
    await opts?.beforePricing?.(req, reply)
    if (reply.sent) return
    const computed = await opts?.computeCredits?.(req.body, req)
    ;(globalThis as { __guardSeen?: unknown[] }).__guardSeen?.push({ id: resolve(req), base: computed })
  },
  reserveCreditsForJob: vi.fn().mockResolvedValue({ usageLogId: "u-1", creditsReserved: 83, watermark: false }),
}))
vi.mock("@/lib/url-validator.js", async () => {
  const { z } = await import("zod")
  return { safeUrlSchema: z.string().url() }
})
vi.mock("@/lib/request-helpers.js", () => ({
  extractWorkflowId: () => null,
  extractNodeId: () => null,
  extractForcePrivate: () => false,
}))

import { videoUpscaleRoutes, videoUpscalePricing } from "../video-upscale.js"
import { EMPTY_PRICE_NOTES } from "@/lib/price-notes.js"
import { videoQueue } from "@/lib/queue.js"
import { insertJob } from "@/lib/insert-job.js"
import { planHouseModelRun } from "@/lib/house-models.js"
import { planTopazVideoUpscale } from "@/lib/topaz-video-plan.js"
import { planNodaroVideoUpscale } from "@/lib/nodaro-video-upscale-plan.js"
import { NodaroVideoUpscaleTooLongError, NodaroVideoUpscaleTryAgainError } from "@/lib/nodaro-video-upscale-plan.js"

const CLIP = "https://cdn.example.com/clip.mp4"

describe("POST /v1/video-upscale — nodaro-video-upscale", () => {
  let app: FastifyInstance
  let guardSeen: Array<{ id: string; base: number | undefined }>

  beforeEach(async () => {
    vi.clearAllMocks()
    plan.error = undefined
    plan.calls = []
    seam.served = true
    seam.planned = true
    seam.linksOff = false
    guardSeen = []
    ;(globalThis as { __guardSeen?: unknown[] }).__guardSeen = guardSeen
    app = Fastify({ logger: false })
    app.addHook("preHandler", async (req) => {
      const body = req.body as Record<string, unknown> | undefined
      if (typeof body?.userId === "string") req.userId = body.userId
    })
    await app.register(async (i) => { await videoUpscaleRoutes(i) })
    await app.ready()
  })
  afterEach(async () => { await app.close() })

  const post = (payload: Record<string, unknown>) =>
    app.inject({ method: "POST", url: "/v1/video-upscale", payload: { provider: "nodaro-video-upscale", userId: "user-a", videoUrl: CLIP, ...payload } })

  it("served: holds the tier's row at the clip's exact price, and queues the measured plan", async () => {
    const res = await post({ targetResolution: "2k", targetFps: 60, upscaleFactor: "2" })
    expect(res.statusCode).toBe(200)
    expect(plan.calls).toEqual([[CLIP, "2k", { userId: "user-a", quote: false, signal: expect.any(AbortSignal) }]])
    // Planned, and run, on the STORED clip — never the caller's link.
    expect(planHouseModelRun).toHaveBeenCalledWith("nodaro-video-upscale", { videoUrl: STORED, tier: "2k", billedSec: 10 })
    expect(guardSeen).toEqual([{ id: "nodaro-video-upscale:2k:per-4s", base: 75 }])
    const inputData = (vi.mocked(insertJob).mock.calls[0]![1] as { input_data: Record<string, unknown> }).input_data
    expect(inputData).toMatchObject({ provider: "nodaro-video-upscale", videoUrl: STORED, targetResolution: "2k", tier: "2k", billedSec: 10, sourceSizeBytes: 12_000_000 })
    expect(inputData.targetFps).toBeUndefined()
    expect(inputData.upscaleFactor).toBeUndefined()
    expect(videoQueue.add).toHaveBeenCalledWith("video-upscale", {
      jobId: "job-nvu",
      videoUrl: STORED,
      provider: "nodaro-video-upscale",
      targetResolution: "2k",
      tier: "2k",
      sourceDurationSec: 9.4,
      billedSec: 10,
      sourceSizeBytes: 12_000_000,
      usageLogId: "u-1",
    })
  })

  it("not served: refused first — the clip never fetched, nothing reserved — in a sentence that names nothing behind it, with the 403 every refused model gets", async () => {
    seam.served = false
    // Even a clip that would be past a limit hears the deployment's answer, not the limit's.
    plan.error = new NodaroVideoUpscaleTooLongError(72.3)
    const res = await post({ targetResolution: "4k" })
    expect(res.statusCode).toBe(403)
    expect(res.json().error).toEqual({
      code: "model_not_available",
      message: "Nodaro Video Upscale is not available on this server. Choose Topaz to upscale this clip. You were not charged.",
    })
    expect(plan.calls).toEqual([])
    expect(planHouseModelRun).not.toHaveBeenCalled()
    expect(guardSeen).toEqual([])
    expect(insertJob).not.toHaveBeenCalled()
    expect(videoQueue.add).not.toHaveBeenCalled()
  })

  it("served but no run planned for the clip: refused the same way", async () => {
    seam.planned = false
    const res = await post({})
    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe("model_not_available")
    expect(insertJob).not.toHaveBeenCalled()
  })

  it("refused where the deployment turned links to outside content off, before the clip is copied", async () => {
    seam.linksOff = true
    const res = await post({})
    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe("link_imports_disabled")
    expect(plan.calls).toEqual([])
    expect(insertJob).not.toHaveBeenCalled()
  })

  it("a fetch that is busy on our side reads as try again in a moment (429; a slow or failed step 503), nothing reserved", async () => {
    plan.error = new NodaroVideoUpscaleTryAgainError("input_busy")
    const res = await post({})
    expect(res.statusCode).toBe(429)
    expect(res.json().error).toEqual({ code: "input_busy", message: "Couldn't fetch the clip just now. Try again in a moment." })
    plan.error = new NodaroVideoUpscaleTryAgainError("input_timed_out")
    expect((await post({})).statusCode).toBe(503)
    expect(guardSeen).toEqual([])
    expect(insertJob).not.toHaveBeenCalled()
  })

  it("a quote runs the same checks without storing a copy, and leaves the caller's URL as it was", async () => {
    const quoteApp = Fastify({ logger: false })
    quoteApp.addHook("preHandler", async (req) => { req.userId = "user-a" })
    // As POST /v1/quote runs a route's pricing: its pre-checks and its `beforePricing` step, a
    // quote (`quoteOnly`) with the notes open, never its handler.
    quoteApp.post("/q", async (req, reply) => {
      req.priceNotes = EMPTY_PRICE_NOTES
      req.quoteOnly = true
      for (const precheck of videoUpscalePricing.prechecks) {
        await precheck(req, reply)
        if (reply.sent) return reply
      }
      await videoUpscalePricing.opts?.beforePricing?.(req, reply)
      if (reply.sent) return reply
      return { body: req.body, planned: req.nodaroVideoUpscale }
    })
    await quoteApp.ready()
    try {
      const res = await quoteApp.inject({ method: "POST", url: "/q", payload: { provider: "nodaro-video-upscale", videoUrl: CLIP, targetResolution: "2k" } })
      expect(res.statusCode).toBe(200)
      expect(plan.calls).toEqual([[CLIP, "2k", { userId: "user-a", quote: true, signal: expect.any(AbortSignal) }]])
      expect(res.json().body.videoUrl).toBe(CLIP)
      expect(insertJob).not.toHaveBeenCalled()
      expect(videoQueue.add).not.toHaveBeenCalled()
    } finally {
      await quoteApp.close()
    }
  })

  it("a clip past a limit is refused with the limit, before anything is reserved", async () => {
    plan.error = new NodaroVideoUpscaleTooLongError(72.3)
    const res = await post({})
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("video_too_long")
    expect(res.json().error.message).toMatch(/up to 60 seconds/)
    expect(guardSeen).toEqual([])
    expect(insertJob).not.toHaveBeenCalled()
  })

  it("Topaz (and every provider but this one) still refuses another provider's 2k with the 400 it always gave", async () => {
    for (const payload of [
      { provider: "topaz", videoUrl: CLIP },
      { videoUrl: CLIP },
      { provider: "veo-1080p", taskId: "t-1" },
    ]) {
      const res = await app.inject({ method: "POST", url: "/v1/video-upscale", payload: { ...payload, userId: "user-a", targetResolution: "2k" } })
      expect(res.statusCode, JSON.stringify(payload)).toBe(400)
      expect(res.json().error).toEqual({
        code: "validation_error",
        message: 'targetResolution: Invalid option: expected one of "720p"|"1080p"|"4k"',
        issues: [{ path: "targetResolution", message: 'Invalid option: expected one of "720p"|"1080p"|"4k"' }],
      })
    }
    // Topaz's plan is read from the request as sent (nothing coerced on its way in).
    expect(vi.mocked(planTopazVideoUpscale).mock.calls[0]![1]).toMatchObject({ targetResolution: "2k" })
    expect(plan.calls).toEqual([])
    expect(insertJob).not.toHaveBeenCalled()
  })

  it("this provider reads a target it does not take (Topaz's 720p) as its default, never a 400", async () => {
    const res = await post({ targetResolution: "720p" })
    expect(res.statusCode).toBe(200)
    expect(plan.calls).toEqual([[CLIP, "720p", { userId: "user-a", quote: false, signal: expect.any(AbortSignal) }]])
  })

  it("a client that leaves mid-fetch stops the clip's fetch: the plan is handed a live signal of the request", async () => {
    let abortedDuringPlan: boolean | undefined
    vi.mocked(planNodaroVideoUpscale).mockImplementationOnce(async (...args: unknown[]) => {
      plan.calls.push(args)
      abortedDuringPlan = (args[2] as { signal?: AbortSignal }).signal?.aborted
      return plan.result as never
    })
    expect((await post({})).statusCode).toBe(200)
    expect((plan.calls[0]![2] as { signal?: AbortSignal }).signal).toBeInstanceOf(AbortSignal)
    // A connected client: the fetch runs on a signal that has not fired.
    expect(abortedDuringPlan).toBe(false)
  })

  it("a fetch stopped because the client left ends the request (499 client_closed), nothing reserved", async () => {
    vi.mocked(planNodaroVideoUpscale).mockImplementationOnce(async (...args: unknown[]) => {
      plan.calls.push(args)
      // Stands in for the client leaving (the route's own reply cannot be closed under inject):
      // the signal has fired, and the copy throws its stop as it is.
      const signal = (args[2] as { signal: AbortSignal }).signal
      Object.defineProperty(signal, "aborted", { value: true })
      throw new DOMException("This operation was aborted", "AbortError")
    })
    const res = await post({})
    expect(res.statusCode).toBe(499)
    expect(res.json().error.code).toBe("client_closed")
    expect(guardSeen).toEqual([])
    expect(insertJob).not.toHaveBeenCalled()
  })
})
