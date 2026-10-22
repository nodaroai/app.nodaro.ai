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

const reserve = vi.fn().mockResolvedValue({ usageLogId: "u-1", creditsReserved: 48, watermark: false })
let guardedId: string | undefined
vi.mock("@/middleware/credit-guard.js", () => ({
  // Records the id the guard would price, as the real guard reads it from the request.
  creditGuard: (resolve: (req: unknown) => string) => async (req: unknown) => { guardedId = resolve(req) },
  reserveCreditsForJob: (...args: unknown[]) => reserve(...args),
}))

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
  return { safeUrlSchema: z.string().url().refine((u) => /^https?:/.test(u)) }
})

const probe = vi.fn()
vi.mock("@/providers/video/ffmpeg-utils.js", () => ({ probeVideoSource: (url: string) => probe(url) }))

import { videoMaskRoutes } from "../video-mask.js"
import { supabase } from "../../lib/supabase.js"
import { videoQueue } from "../../lib/queue.js"

const USER = "00000000-0000-4000-8000-000000000001"
let app: FastifyInstance
let inserted: Record<string, unknown> | undefined

beforeEach(async () => {
  vi.clearAllMocks()
  guardedId = undefined
  inserted = undefined
  vi.mocked(supabase.from).mockReturnValue({
    insert: vi.fn((row: Record<string, unknown>) => {
      inserted = row
      return { select: () => ({ single: () => Promise.resolve({ data: { id: "job-vm-1" }, error: null }) }) }
    }),
  } as never)
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    const body = req.body as Record<string, unknown> | undefined
    if (body?.userId && typeof body.userId === "string") req.userId = body.userId
  })
  await app.register(async (i) => { await videoMaskRoutes(i) })
  await app.ready()
})

afterEach(async () => { await app.close() })

const post = (payload: Record<string, unknown>) => app.inject({ method: "POST", url: "/v1/video-mask", payload })

describe("POST /v1/video-mask", () => {
  it("prices the measured clip's row, stamps it on the job, and enqueues the run", async () => {
    probe.mockResolvedValue({ width: 1280, height: 720, durationSeconds: 8.4, fps: 30 })
    const res = await post({ videoUrl: "https://example.com/clip.mp4", prompt: "the dancer", userId: USER })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ jobId: "job-vm-1" })
    expect(guardedId).toBe("sam-3.1-video:10s")
    expect(reserve).toHaveBeenCalledWith(expect.anything(), expect.anything(), "job-vm-1", "sam-3.1-video:10s")
    expect(inserted?.input_data).toMatchObject({ type: "video-mask", prompt: "the dancer", billedSec: 9, bucketKey: "sam-3.1-video:10s", threshold: 0.5, provider: "sam-3.1" })
    expect(videoQueue.add).toHaveBeenCalledWith("video-mask", expect.objectContaining({
      jobId: "job-vm-1", videoUrl: "https://example.com/clip.mp4", prompt: "the dancer", threshold: 0.5, provider: "sam-3.1", usageLogId: "u-1",
    }))
    // The preHandler's stash never reaches the queue payload.
    expect(vi.mocked(videoQueue.add).mock.calls[0]![1]).not.toHaveProperty("__videoMaskCreditId")
  })

  it("prices a 60 fps clip at twice its length", async () => {
    probe.mockResolvedValue({ width: 1920, height: 1080, durationSeconds: 10, fps: 60 })
    const res = await post({ videoUrl: "https://example.com/fast.mp4", prompt: "the car", userId: USER })
    expect(res.statusCode).toBe(200)
    expect(guardedId).toBe("sam-3.1-video:30s")
  })

  it("prices SAM 3 on its own rows, and a 4-minute clip at its 240 s row", async () => {
    probe.mockResolvedValue({ width: 1920, height: 1080, durationSeconds: 238, fps: 30 })
    const res = await post({ videoUrl: "https://example.com/long.mp4", prompt: "the skater", provider: "sam-3", userId: USER })
    expect(res.statusCode).toBe(200)
    expect(guardedId).toBe("sam-3-video:240s")
  })

  it("refuses a clip over the cap before anything is priced or inserted", async () => {
    probe.mockResolvedValue({ width: 1280, height: 720, durationSeconds: 301, fps: 30 })
    const res = await post({ videoUrl: "https://example.com/long.mp4", prompt: "the dancer", userId: USER })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("video_duration_exceeds_limit")
    expect(guardedId).toBeUndefined()
    expect(inserted).toBeUndefined()
  })

  it("refuses a clip that cannot be read", async () => {
    probe.mockRejectedValue(new Error("ffprobe: invalid data"))
    const res = await post({ videoUrl: "https://example.com/bad.mp4", prompt: "the dancer", userId: USER })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("invalid_video_duration")
    expect(inserted).toBeUndefined()
  })

  it("returns 400 for a missing prompt and an out-of-range threshold", async () => {
    probe.mockResolvedValue({ width: 640, height: 360, durationSeconds: 3, fps: 30 })
    expect((await post({ videoUrl: "https://example.com/c.mp4", userId: USER })).statusCode).toBe(400)
    expect((await post({ videoUrl: "https://example.com/c.mp4", prompt: "x", threshold: 0.99, userId: USER })).statusCode).toBe(400)
    expect(inserted).toBeUndefined()
  })

  it("never probes a value that is not a safe URL (a bare path answers validation_error, not a probe verdict)", async () => {
    const res = await post({ videoUrl: "/app/secret.mp4", prompt: "the dog", userId: USER })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
    expect(probe).not.toHaveBeenCalled()
  })

  it("holdLastMask defaults to false, passes true through, and refuses a non-boolean", async () => {
    probe.mockResolvedValue({ width: 640, height: 360, durationSeconds: 3, fps: 30 })
    expect((await post({ videoUrl: "https://example.com/c.mp4", prompt: "the face", userId: USER })).statusCode).toBe(200)
    expect(videoQueue.add).toHaveBeenLastCalledWith("video-mask", expect.objectContaining({ holdLastMask: false }))
    expect((await post({ videoUrl: "https://example.com/c.mp4", prompt: "the face", holdLastMask: true, userId: USER })).statusCode).toBe(200)
    expect(videoQueue.add).toHaveBeenLastCalledWith("video-mask", expect.objectContaining({ holdLastMask: true }))
    expect((await post({ videoUrl: "https://example.com/c.mp4", prompt: "the face", holdLastMask: "yes", userId: USER })).statusCode).toBe(400)
  })

  it("perShot defaults to false, passes true through (onto the job's input too), and refuses a non-boolean", async () => {
    probe.mockResolvedValue({ width: 640, height: 360, durationSeconds: 3, fps: 30 })
    const body = { videoUrl: "https://example.com/c.mp4", prompt: "the face", userId: USER }
    expect((await post(body)).statusCode).toBe(200)
    expect(videoQueue.add).toHaveBeenLastCalledWith("video-mask", expect.objectContaining({ perShot: false }))
    expect((await post({ ...body, perShot: true })).statusCode).toBe(200)
    expect(videoQueue.add).toHaveBeenLastCalledWith("video-mask", expect.objectContaining({ perShot: true }))
    expect(inserted?.input_data).toMatchObject({ perShot: true })
    for (const v of ["yes", 1, null]) expect((await post({ ...body, perShot: v })).statusCode).toBe(400)
  })

  it("minSubjectHeightPct defaults to 0, passes 0–100 through, and refuses out of range", async () => {
    probe.mockResolvedValue({ width: 640, height: 360, durationSeconds: 3, fps: 30 })
    const body = { videoUrl: "https://example.com/c.mp4", prompt: "the face", userId: USER }
    expect((await post(body)).statusCode).toBe(200)
    expect(videoQueue.add).toHaveBeenLastCalledWith("video-mask", expect.objectContaining({ minSubjectHeightPct: 0 }))
    expect((await post({ ...body, minSubjectHeightPct: 15 })).statusCode).toBe(200)
    expect(videoQueue.add).toHaveBeenLastCalledWith("video-mask", expect.objectContaining({ minSubjectHeightPct: 15 }))
    for (const v of [-1, 101, "15"]) expect((await post({ ...body, minSubjectHeightPct: v })).statusCode).toBe(400)
  })

  it("maxSubjectHeightPct defaults to 0, passes through, and min above max is a 400", async () => {
    probe.mockResolvedValue({ width: 640, height: 360, durationSeconds: 3, fps: 30 })
    const body = { videoUrl: "https://example.com/c.mp4", prompt: "the face", userId: USER }
    expect((await post(body)).statusCode).toBe(200)
    expect(videoQueue.add).toHaveBeenLastCalledWith("video-mask", expect.objectContaining({ maxSubjectHeightPct: 0 }))
    expect((await post({ ...body, maxSubjectHeightPct: 20 })).statusCode).toBe(200)
    expect(videoQueue.add).toHaveBeenLastCalledWith("video-mask", expect.objectContaining({ maxSubjectHeightPct: 20 }))
    expect((await post({ ...body, minSubjectHeightPct: 5, maxSubjectHeightPct: 20 })).statusCode).toBe(200)
    expect((await post({ ...body, minSubjectHeightPct: 20, maxSubjectHeightPct: 20 })).statusCode).toBe(200)
    vi.mocked(videoQueue.add).mockClear()
    const bad = await post({ ...body, minSubjectHeightPct: 30, maxSubjectHeightPct: 20 })
    expect(bad.statusCode).toBe(400)
    expect(bad.json().error.code).toBe("validation_error")
    expect(bad.json().error.message).toMatch(/minSubjectHeightPct \(30\) is above maxSubjectHeightPct \(20\)/)
    for (const v of [-1, 101, "20"]) expect((await post({ ...body, maxSubjectHeightPct: v })).statusCode).toBe(400)
    expect(videoQueue.add).not.toHaveBeenCalled()
  })

  it("zone defaults to null, passes margins through, accepts null, and refuses a margin outside 0–49", async () => {
    probe.mockResolvedValue({ width: 640, height: 360, durationSeconds: 3, fps: 30 })
    const body = { videoUrl: "https://example.com/c.mp4", prompt: "the face", userId: USER }
    const zone = { leftPct: 10, rightPct: 10, topPct: 5, bottomPct: 0 }
    expect((await post(body)).statusCode).toBe(200)
    expect(videoQueue.add).toHaveBeenLastCalledWith("video-mask", expect.objectContaining({ zone: null }))
    expect((await post({ ...body, zone })).statusCode).toBe(200)
    expect(videoQueue.add).toHaveBeenLastCalledWith("video-mask", expect.objectContaining({ zone }))
    expect(inserted?.input_data).toMatchObject({ zone })
    expect((await post({ ...body, zone: null })).statusCode).toBe(200)
    expect(videoQueue.add).toHaveBeenLastCalledWith("video-mask", expect.objectContaining({ zone: null }))
    // A margin left out counts as 0.
    expect((await post({ ...body, zone: { leftPct: 10, rightPct: 10 } })).statusCode).toBe(200)
    expect(videoQueue.add).toHaveBeenLastCalledWith("video-mask", expect.objectContaining({ zone: { leftPct: 10, rightPct: 10, topPct: 0, bottomPct: 0 } }))
    vi.mocked(videoQueue.add).mockClear()
    const bad = await post({ ...body, zone: { ...zone, leftPct: 50 } })
    expect(bad.statusCode).toBe(400)
    expect(bad.json().error.code).toBe("validation_error")
    for (const z of [{ ...zone, topPct: -1 }, { ...zone, bottomPct: "5" }, "10", 10]) expect((await post({ ...body, zone: z })).statusCode).toBe(400)
    expect(videoQueue.add).not.toHaveBeenCalled()
  })

  it("returns 401 without a user", async () => {
    probe.mockResolvedValue({ width: 640, height: 360, durationSeconds: 3, fps: 30 })
    expect((await post({ videoUrl: "https://example.com/c.mp4", prompt: "the dog" })).statusCode).toBe(401)
  })
})
