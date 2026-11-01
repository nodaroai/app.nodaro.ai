/**
 * POST /v1/video-face-mesh (routes/video-face-mesh.ts): internal only — the
 * Cast Swap engine's worker-side child request (`tk.http.workerRequest` with a
 * parent job) is the one caller it serves; every other caller is refused
 * before the clip is probed or anything is priced. Priced by the clip's
 * length (`video-face-mesh:<n>s`, the 30 fps basis), always private.
 */
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

const reserve = vi.fn().mockResolvedValue({ usageLogId: "u-1", creditsReserved: 30, watermark: false })
let guardedId: string | undefined
vi.mock("@/middleware/credit-guard.js", () => ({
  creditGuard: (id: (req: unknown) => string) => async (req: unknown) => {
    guardedId = id(req)
  },
  reserveCreditsForJob: (...args: unknown[]) => reserve(...args),
}))

const probe = vi.fn()
vi.mock("@/providers/video/ffmpeg-utils.js", () => ({ probeVideoSource: (url: string) => probe(url) }))

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

import { videoFaceMeshRoutes } from "../video-face-mesh.js"
import { withJobSubmissionContext } from "../../lib/job-submission-context.js"
import { supabase } from "../../lib/supabase.js"
import { videoQueue } from "../../lib/queue.js"

const USER = "00000000-0000-4000-8000-000000000001"
const PARENT = "00000000-0000-4000-8000-0000000000aa"
const CLIP = "https://example.com/clip.mp4"
const BODY = { videoUrl: CLIP, forcePrivate: true }
let app: FastifyInstance
let inserted: Record<string, unknown> | undefined

beforeEach(async () => {
  vi.clearAllMocks()
  guardedId = undefined
  inserted = undefined
  probe.mockResolvedValue({ width: 720, height: 1280, durationSeconds: 21.04, fps: 24 })
  vi.mocked(supabase.from).mockReturnValue({
    insert: vi.fn().mockImplementation((row: Record<string, unknown>) => {
      inserted = row
      return { select: () => ({ single: () => Promise.resolve({ data: { id: "job-fm-1" }, error: null }) }) }
    }),
  } as never)
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    const kind = req.headers["x-test-auth"]
    if (typeof kind === "string") {
      req.userId = USER
      req.authKind = kind as never
    }
  })
  await app.register(async (i) => { await videoFaceMeshRoutes(i) })
  await app.ready()
})

afterEach(async () => { await app.close() })

const post = (payload: Record<string, unknown>, auth: string) =>
  app.inject({ method: "POST", url: "/v1/video-face-mesh", payload, headers: { "x-test-auth": auth } })
const asChild = (payload: Record<string, unknown>) =>
  withJobSubmissionContext({ userId: USER, method: "POST", url: "/v1/video-face-mesh", parentJobId: PARENT, trustedPluginCaller: true }, () =>
    post(payload, "internal"),
  )

describe("POST /v1/video-face-mesh — who may call it", () => {
  it.each(["jwt", "api_token", "app_token", "billing_key"])("refuses a %s caller 403, before probing or pricing anything", async (kind) => {
    const res = await post(BODY, kind)
    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe("forbidden")
    expect(probe).not.toHaveBeenCalled()
    expect(guardedId).toBeUndefined()
    expect(videoQueue.add).not.toHaveBeenCalled()
  })

  it("refuses an internal call with no parent job in its scope", async () => {
    expect((await post(BODY, "internal")).statusCode).toBe(403)
    const res = await withJobSubmissionContext({ userId: USER, method: "POST", url: "/v1/video-face-mesh", trustedPluginCaller: true }, () => post(BODY, "internal"))
    expect(res.statusCode).toBe(403)
    expect(probe).not.toHaveBeenCalled()
  })
})

describe("POST /v1/video-face-mesh — a child step", () => {
  it("prices the clip's length bucket, writes a private child job and queues it with the spec's fields", async () => {
    const payload = {
      videoUrl: CLIP,
      drawOnUrl: "https://example.com/masked.mp4",
      maskUrl: "https://example.com/mask.mp4",
      minFaceHeightPct: 4,
      maxFaceHeightPct: 60,
      zone: { leftPct: 10, rightPct: 10 },
      forcePrivate: true,
    }
    const res = await asChild(payload)
    expect(res.statusCode).toBe(202)
    expect(res.json()).toEqual({ jobId: "job-fm-1" })
    expect(probe).toHaveBeenCalledWith(CLIP)
    // 21.04 s at 24 fps → 22 s priced → the 30 s row.
    expect(guardedId).toBe("video-face-mesh:30s")
    expect(reserve).toHaveBeenCalledWith(expect.anything(), expect.anything(), "job-fm-1", "video-face-mesh:30s")
    expect(inserted).toMatchObject({ force_private: true, user_id: USER, status: "pending" })
    expect(inserted!.input_data).toMatchObject({ type: "video-face-mesh", videoUrl: CLIP, billedSec: 22, bucketKey: "video-face-mesh:30s" })
    expect(videoQueue.add).toHaveBeenCalledWith("video-face-mesh", {
      jobId: "job-fm-1",
      videoUrl: CLIP,
      drawOnUrl: "https://example.com/masked.mp4",
      maskUrl: "https://example.com/mask.mp4",
      minFaceHeightPct: 4,
      maxFaceHeightPct: 60,
      zone: { leftPct: 10, rightPct: 10, topPct: 0, bottomPct: 0 },
      usageLogId: "u-1",
    })
  })

  it("the bare request: draw on the clip itself, no mask, no limits, no zone", async () => {
    const res = await asChild({ videoUrl: CLIP })
    expect(res.statusCode).toBe(202)
    expect(videoQueue.add).toHaveBeenCalledWith("video-face-mesh", {
      jobId: "job-fm-1", videoUrl: CLIP, minFaceHeightPct: 0, maxFaceHeightPct: 0, zone: null, usageLogId: "u-1",
    })
    // Private whatever the body says.
    expect(inserted).toMatchObject({ force_private: true })
  })

  it("a 60 fps clip is priced at twice its length", async () => {
    probe.mockResolvedValue({ width: 720, height: 1280, durationSeconds: 6, fps: 60 })
    await asChild(BODY)
    expect(guardedId).toBe("video-face-mesh:15s")
  })

  it("a 30 s clip at 60 fps (1,801 frames) is taken, at the 120 s row", async () => {
    probe.mockResolvedValue({ width: 720, height: 1280, durationSeconds: 30.0167, fps: 60 })
    expect((await asChild(BODY)).statusCode).toBe(202)
    expect(guardedId).toBe("video-face-mesh:120s")
  })

  it("refuses a clip past 300 s (priced, Video Mask's cap), or one it cannot read, 400 before anything is reserved", async () => {
    probe.mockResolvedValue({ width: 720, height: 1280, durationSeconds: 301, fps: 30 })
    const long = await asChild(BODY)
    expect(long.statusCode).toBe(400)
    expect(long.json().error.code).toBe("video_duration_exceeds_limit")
    probe.mockRejectedValue(new Error("not a video"))
    const bad = await asChild(BODY)
    expect(bad.statusCode).toBe(400)
    expect(bad.json().error.code).toBe("invalid_video_duration")
    expect(guardedId).toBeUndefined()
    expect(reserve).not.toHaveBeenCalled()
  })

  it("a coloured depth map: colormap and the gray depth render ride to the worker as sent", async () => {
    const res = await asChild({ ...BODY, colormap: "turbo", depthUrl: "https://example.com/depth-gray.mp4" })
    expect(res.statusCode).toBe(202)
    expect(videoQueue.add).toHaveBeenCalledWith("video-face-mesh", expect.objectContaining({
      colormap: "turbo", depthUrl: "https://example.com/depth-gray.mp4",
    }))
  })

  it("grayscale needs no depth render; a depth render alone is taken (grayscale)", async () => {
    expect((await asChild({ ...BODY, colormap: "grayscale" })).statusCode).toBe(202)
    expect((await asChild({ ...BODY, depthUrl: "https://example.com/depth-gray.mp4" })).statusCode).toBe(202)
  })

  it("refuses a coloured map with no depth render (a line's colour is read from it), an unknown map and a bad depth url", async () => {
    const noDepth = await asChild({ ...BODY, colormap: "inferno" })
    expect(noDepth.statusCode).toBe(400)
    expect(JSON.stringify(noDepth.json())).toContain("depthUrl")
    expect((await asChild({ ...BODY, colormap: "jet", depthUrl: "https://example.com/d.mp4" })).statusCode).toBe(400)
    expect((await asChild({ ...BODY, colormap: "turbo", depthUrl: "not a url" })).statusCode).toBe(400)
    expect(videoQueue.add).not.toHaveBeenCalled()
  })

  it("refuses an empty size band and out-of-range values", async () => {
    expect((await asChild({ ...BODY, minFaceHeightPct: 50, maxFaceHeightPct: 10 })).statusCode).toBe(400)
    expect((await asChild({ ...BODY, minFaceHeightPct: 101 })).statusCode).toBe(400)
    expect((await asChild({ ...BODY, zone: { leftPct: 50 } })).statusCode).toBe(400)
    expect((await asChild({ ...BODY, drawOnUrl: "not a url" })).statusCode).toBe(400)
    expect(videoQueue.add).not.toHaveBeenCalled()
  })
})
