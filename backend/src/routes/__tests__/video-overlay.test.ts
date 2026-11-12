import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

const redis = vi.hoisted(() => ({ incr: vi.fn(), expire: vi.fn(), ttl: vi.fn() }))

vi.mock("@/lib/supabase.js", () => ({ supabase: { from: vi.fn() } }))
vi.mock("@/lib/queue.js", () => ({
  videoQueue: { add: vi.fn().mockResolvedValue({ id: "queue-job-1" }) },
  redis,
}))
// What the guard prices each request at, read IN the request as the guard reads
// it: the row its resolver names and the BASE credits of its computeCredits hook.
const guardSeen = vi.hoisted(() => [] as Array<{ id: string; base: number | undefined }>)
vi.mock("@/middleware/credit-guard.js", () => ({
  creditGuard: vi.fn(
    (resolver: (req: unknown) => string, opts?: { computeCredits?: (body: unknown, req: unknown) => Promise<number | undefined> | number | undefined }) =>
      async (req: { body: unknown }) => {
        guardSeen.push({ id: resolver(req), base: await opts?.computeCredits?.(req.body, req) })
      },
  ),
  reserveCreditsForJob: vi.fn().mockResolvedValue({ usageLogId: "usage-1", creditsReserved: 20, watermark: false }),
}))
// The base of a run with a video layer is measured before the guard: its length by url.
const probe = vi.hoisted(() => ({ sec: new Map<string, number>(), urls: [] as string[] }))
vi.mock("@/providers/video/ffmpeg-utils.js", () => ({
  // The worker's own probe, on the link: its video stream's length.
  probeVideoOverlayBaseSource: vi.fn(async (url: string) => {
    probe.urls.push(url)
    const streamDurationSec = probe.sec.get(url)
    if (streamDurationSec === undefined) throw new Error(`unreadable: ${url}`)
    return { width: 1920, height: 1080, streamDurationSec }
  }),
}))
vi.mock("@/lib/credit-base-cost.js", () => ({ unitRateBaseCredits: vi.fn(async (_id: string, units: number) => units * 10) }))
vi.mock("@/lib/admin-check.js", () => ({
  warmAdminCache: vi.fn(),
  checkIsAdmin: vi.fn().mockResolvedValue(false),
}))
vi.mock("@/lib/config.js", () => ({
  config: { EDITION: "cloud", SUPABASE_URL: "https://test.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "test" },
  isCloud: () => true,
  hasCredits: () => true,
  isCommunity: () => false,
  isBusiness: () => false,
  hasAdmin: () => true,
}))
vi.mock("@/lib/url-validator.js", async () => {
  const { z } = await import("zod")
  return { safeUrlSchema: z.string().url() }
})

import { videoOverlayBody, videoOverlayRoutes } from "../video-overlay.js"
import { supabase } from "../../lib/supabase.js"
import { videoQueue } from "../../lib/queue.js"
import { reserveCreditsForJob } from "../../middleware/credit-guard.js"
import { unitRateBaseCredits } from "../../lib/credit-base-cost.js"
import {
  VIDEO_OVERLAY_MAX_COMPOSITION_KEY_LENGTH,
  assembleVideoOverlayRequest,
  validateVideoOverlayRequest,
  type VideoOverlayLayerInput,
} from "@nodaro/shared/video"

const USER = "00000000-0000-4000-8000-000000000001"
const VIDEO = "https://cdn.example/base.mp4"
const IMG = "https://cdn.example/card.png"
const CLIP = "https://cdn.example/b.mp4"

let app: FastifyInstance
let insert: ReturnType<typeof vi.fn>

beforeEach(async () => {
  vi.clearAllMocks()
  probe.sec = new Map([[VIDEO, 10]])
  probe.urls = []
  guardSeen.length = 0
  redis.incr.mockResolvedValue(1)
  redis.ttl.mockResolvedValue(60)
  const single = vi.fn().mockResolvedValue({ data: { id: "job-1" }, error: null })
  insert = vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ single }) })
  vi.mocked(supabase.from).mockReturnValue({ insert } as never)
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    const body = req.body as Record<string, unknown> | undefined
    if (typeof body?.userId === "string") req.userId = body.userId
  })
  await app.register(videoOverlayRoutes)
  await app.ready()
})

afterEach(async () => {
  await app.close()
})

const post = (payload: Record<string, unknown>) => app.inject({ method: "POST", url: "/v1/video-overlay", payload })
const queued = () => vi.mocked(videoQueue.add).mock.calls[0]![1] as Record<string, unknown> & { layers: Array<Record<string, unknown>> }

describe("POST /v1/video-overlay — accepted", () => {
  it("expands { imageUrl, start: 2 } alone into the bottom-right corner badge (D8) — keeping start 2 — before the job is enqueued", async () => {
    // start 2, not 0: the default layer's own start is 0, so only a non-zero start proves the
    // layer's start wins over the default's (D8's "keeps its own times").
    const res = await post({ userId: USER, videoUrl: VIDEO, layers: [{ imageUrl: IMG, start: 2 }] })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ jobId: "job-1" })
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ user_id: USER, status: "pending", input_data: expect.objectContaining({ type: "video-overlay" }) }))
    expect(vi.mocked(reserveCreditsForJob)).toHaveBeenCalledWith(expect.anything(), expect.anything(), "job-1", "video-overlay")
    expect(videoQueue.add).toHaveBeenCalledWith("video-overlay", expect.objectContaining({ jobId: "job-1", videoUrl: VIDEO, usageLogId: "usage-1" }))
    expect(queued().layers).toEqual([
      { imageUrl: IMG, start: 2, preset: "corner-badge", corner: "bottom-right", anchor: "bottom-right", x: -4, y: -4, width: 18, fit: "contain", opacity: 1, animate: true },
    ])
    expect(queued()).not.toHaveProperty("userId")
  })

  it("a layer with no preset and no box but its own corner gets THAT corner's badge box (D8)", async () => {
    await post({ userId: USER, videoUrl: VIDEO, layers: [{ imageUrl: IMG, start: 2, corner: "top-left" }] })
    expect(queued().layers).toEqual([
      { imageUrl: IMG, start: 2, preset: "corner-badge", corner: "top-left", anchor: "top-left", x: 4, y: 4, width: 18, fit: "contain", opacity: 1, animate: true },
    ])
  })

  it("keeps a preset's tag — the schema sets no defaults for the normaliser to trip on (card)", async () => {
    await post({ userId: USER, videoUrl: VIDEO, layers: [{ imageUrl: IMG, start: 1, end: 3, preset: "card" }] })
    expect(queued().layers).toEqual([
      { imageUrl: IMG, start: 1, end: 3, preset: "card", anchor: "center", x: 0, y: -4, width: 78, height: 60, fit: "contain", opacity: 1, animate: true },
    ])
  })

  it("passes a canvas slot through to the worker", async () => {
    await post({ userId: USER, videoUrl: VIDEO, layers: [{ imageUrl: IMG, start: 0, slot: 3 }] })
    expect(queued().layers[0]!.slot).toBe(3)
  })

  // The layer-COUNT limit (20) is the bound; `slot` is the 1-based position the
  // layer holds on the node. A 24-layer node whose layers 1–4 were removed keeps
  // its 20 imaged layers at slots 5–24 (removal never re-numbers), and the DAG
  // path renders it — the REST Run must accept the same request.
  it("accepts 20 layers when one sits past slot 20 (slot 24) and passes the slot through", async () => {
    const layers = Array.from({ length: 20 }, (_, i) => ({ imageUrl: IMG, start: 0, slot: i + 5 }))
    const res = await post({ userId: USER, videoUrl: VIDEO, layers })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ jobId: "job-1" })
    expect(queued().layers.map((l) => l.slot)).toEqual(Array.from({ length: 20 }, (_, i) => i + 5))
  })

  it("REST and DAG accept the same node: a 24-layer node with slots 1–4 removed, through the shared assembly, parses with the route body", async () => {
    const stored: Array<VideoOverlayLayerInput | null> = Array.from({ length: 24 }, (_, i) => ({ imageUrl: `https://cdn.example/${i}.png`, start: 0 }))
    for (const i of [0, 1, 2, 3]) stored[i] = null
    const request = assembleVideoOverlayRequest({ videoUrl: VIDEO, data: { layers: stored }, wiredImageUrls: [] })
    expect(request.layers.map((l) => l.slot)).toEqual(Array.from({ length: 20 }, (_, i) => i + 5))
    expect(validateVideoOverlayRequest(request)).toEqual({ ok: true })
    const parsed = videoOverlayBody.safeParse(request)
    expect(parsed.success).toBe(true)
    const res = await post({ userId: USER, ...request })
    expect(res.statusCode).toBe(200)
    expect(queued().layers.at(-1)).toMatchObject({ slot: 24, imageUrl: "https://cdn.example/23.png" })
  })

  it("carries the canvas's freshness key (resultCompositionKey) opaquely to the worker, which echoes it into output_data", async () => {
    await post({ userId: USER, videoUrl: VIDEO, layers: [{ imageUrl: IMG, start: 0 }], resultCompositionKey: "[\"K\"]" })
    expect(queued().resultCompositionKey).toBe("[\"K\"]")
    // Only the queue payload carries it (the worker echoes it into output_data);
    // the job's recorded config (input_data) does not keep a copy.
    expect((insert.mock.calls[0]![0] as { input_data: Record<string, unknown> }).input_data).not.toHaveProperty("resultCompositionKey")
    vi.mocked(videoQueue.add).mockClear()
    await post({ userId: USER, videoUrl: VIDEO, layers: [{ imageUrl: IMG, start: 0 }] })
    expect(queued()).not.toHaveProperty("resultCompositionKey")
  })

  it("carries the target-aspect options", async () => {
    await post({ userId: USER, videoUrl: VIDEO, layers: [{ imageUrl: IMG, start: 0 }], outputAspect: "9:16", baseFit: "contain", backgroundColor: "#112233" })
    expect(queued()).toMatchObject({ outputAspect: "9:16", baseFit: "contain", backgroundColor: "#112233" })
  })

  // Guard (green before and after video layers): an image-only body queues and
  // records EXACTLY what it did before — whole objects, so any new key fails.
  it("an image-only body enqueues exactly today's payload and records exactly today's config", async () => {
    await post({ userId: USER, videoUrl: VIDEO, layers: [{ imageUrl: IMG, start: 1, preset: "card", slot: 2 }], outputAspect: "9:16", baseFit: "contain", backgroundColor: "#112233", resultCompositionKey: "K" })
    const layer = { imageUrl: IMG, start: 1, preset: "card", slot: 2, anchor: "center", x: 0, y: -4, width: 78, height: 60, fit: "contain", opacity: 1, animate: true }
    expect(vi.mocked(videoQueue.add).mock.calls).toEqual([
      ["video-overlay", { jobId: "job-1", videoUrl: VIDEO, layers: [layer], outputAspect: "9:16", baseFit: "contain", backgroundColor: "#112233", resultCompositionKey: "K", usageLogId: "usage-1" }],
    ])
    expect((insert.mock.calls[0]![0] as { input_data: unknown }).input_data).toEqual({
      videoUrl: VIDEO, layers: [layer], outputAspect: "9:16", baseFit: "contain", backgroundColor: "#112233", type: "video-overlay",
    })
  })
})

describe("POST /v1/video-overlay — video layers, a base box and layouts", () => {
  it("a layer with videoUrl and no imageUrl returns a jobId; it expands like an image layer but with its fade off", async () => {
    const res = await post({ userId: USER, videoUrl: VIDEO, layers: [{ videoUrl: CLIP, start: 2 }] })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ jobId: "job-1" })
    expect(queued().layers).toEqual([
      { videoUrl: CLIP, start: 2, preset: "corner-badge", corner: "bottom-right", anchor: "bottom-right", x: -4, y: -4, width: 18, fit: "contain", opacity: 1, animate: false },
    ])
  })

  // The design's three worked examples, as written.
  it("example 1 — video at the bottom, an image above it", async () => {
    const res = await post({
      userId: USER, videoUrl: VIDEO, outputAspect: "9:16", layout: "video-bottom",
      layers: [{ imageUrl: IMG, start: 0, anchor: "top", x: 0, y: 8, width: 80 }],
    })
    expect(res.statusCode).toBe(200)
    expect(queued()).toMatchObject({ layout: "video-bottom", outputAspect: "9:16" })
  })

  it("example 2 — two videos stacked whole", async () => {
    const res = await post({ userId: USER, videoUrl: VIDEO, outputAspect: "9:16", layout: "stack-whole", layers: [{ videoUrl: CLIP, start: 0 }] })
    expect(res.statusCode).toBe(200)
    expect(queued()).toMatchObject({ layout: "stack-whole", layers: [{ videoUrl: CLIP }] })
  })

  it("example 3 — a fixed picture in picture with the inset's sound on", async () => {
    const res = await post({ userId: USER, videoUrl: VIDEO, layout: "pip", layers: [{ videoUrl: CLIP, start: 0, sound: { volume: 0.8 } }] })
    expect(res.statusCode).toBe(200)
    expect(queued()).toMatchObject({ layout: "pip", layers: [{ videoUrl: CLIP, sound: { volume: 0.8 } }] })
  })

  it("strips nothing: a layer's videoUrl and sound, the baseBox and the layout reach the worker and the recorded config", async () => {
    const baseBox = { anchor: "top", x: 0, y: 2, width: 100, height: 40, fit: "cover" }
    await post({ userId: USER, videoUrl: VIDEO, outputAspect: "9:16", layout: "pip", baseBox, layers: [{ videoUrl: CLIP, start: 0, sound: { volume: 0.5 } }] })
    const sent = { videoUrl: CLIP, sound: { volume: 0.5 } }
    expect(queued()).toMatchObject({ baseBox, layout: "pip", layers: [sent] })
    expect((insert.mock.calls[0]![0] as { input_data: Record<string, unknown> }).input_data).toMatchObject({ baseBox, layout: "pip", layers: [sent] })
  })

  it("an .svg path on a video layer is not the image refusal (the SVG check reads imageUrl only)", async () => {
    const res = await post({ userId: USER, videoUrl: VIDEO, layers: [{ videoUrl: "https://cdn.example/clip.svg", start: 0 }] })
    expect(res.statusCode).toBe(200)
  })
})

describe("POST /v1/video-overlay — REST and DAG accept the same video-layer node", () => {
  it("the shared assembly's request — a wired video slot, a stored base box with a null field, a layout — validates and parses unchanged", async () => {
    const request = assembleVideoOverlayRequest({
      videoUrl: VIDEO,
      data: {
        layers: [{ imageUrl: IMG, start: 0 }, { start: 0, sound: { volume: 0.7 } }],
        outputAspect: "9:16",
        baseBox: { anchor: "bottom", x: 0, y: 0, width: 100, height: null, fit: "contain" },
        layout: "pip",
      },
      wiredImageUrls: [undefined, "https://cdn.example/wired.mp4"],
      wiredVideoSlots: new Set([2]),
    })
    expect(validateVideoOverlayRequest(request)).toEqual({ ok: true })
    const parsed = videoOverlayBody.safeParse(request)
    expect(parsed.success).toBe(true)
    if (!parsed.success) return
    expect(parsed.data.layers).toEqual(request.layers)
    expect(parsed.data.baseBox).toEqual(request.baseBox)
    expect(parsed.data.layout).toBe("pip")
    const res = await post({ userId: USER, ...request })
    expect(res.statusCode).toBe(200)
    expect(queued().layers[1]).toMatchObject({ videoUrl: "https://cdn.example/wired.mp4", slot: 2, sound: { volume: 0.7 } })
  })

  it("a stored layer with an image and an empty videoUrl runs as an image layer through the route too, not only on the DAG", async () => {
    const request = assembleVideoOverlayRequest({ videoUrl: VIDEO, data: { layers: [{ imageUrl: IMG, videoUrl: "", start: 0 }] }, wiredImageUrls: [] })
    expect(validateVideoOverlayRequest(request)).toEqual({ ok: true })
    const res = await post({ userId: USER, ...request })
    expect(res.statusCode).toBe(200)
    expect(queued().layers[0]).toMatchObject({ imageUrl: IMG, slot: 1, animate: true })
    expect(queued().layers[0]).not.toHaveProperty("videoUrl")
  })
})

describe("POST /v1/video-overlay — refused before any insert or reservation", () => {
  const L = { imageUrl: IMG, start: 0 }
  it.each([
    ["no videoUrl", { layers: [L] }, null],
    ["no layers", { videoUrl: VIDEO, layers: [] }, "layers: At least 1 layer is required"],
    ["21 layers", { videoUrl: VIDEO, layers: Array.from({ length: 21 }, () => L) }, "layers: At most 20 layers"],
    ["end before start", { videoUrl: VIDEO, layers: [{ imageUrl: IMG, start: 5, end: 4 }] }, "layers[0]: end (4 s) must be after start (5 s)"],
    ["end before start on a canvas slot", { videoUrl: VIDEO, layers: [L, { imageUrl: IMG, start: 5, end: 4, slot: 7 }] }, "Layer 7: end (4 s) must be after start (5 s)"],
    ["a partial box", { videoUrl: VIDEO, layers: [{ imageUrl: IMG, start: 0, anchor: "top-left" }] }, "layers[0]: anchor and width are required without a preset"],
    ["baseFit without outputAspect", { videoUrl: VIDEO, layers: [L], baseFit: "cover" }, "baseFit and backgroundColor need an outputAspect"],
    ["an .svg image path", { videoUrl: VIDEO, layers: [{ imageUrl: "https://cdn.example/logo.SVG?v=2", start: 0 }] }, "layers[0]: SVG images are not supported by Video Overlay yet — rasterise it with Image Overlay first"],
    ["start past 3600 s", { videoUrl: VIDEO, layers: [{ imageUrl: IMG, start: 3601 }] }, null],
    ["x out of bounds", { videoUrl: VIDEO, layers: [{ imageUrl: IMG, start: 0, anchor: "center", width: 10, x: 101 }] }, null],
    ["an unknown preset", { videoUrl: VIDEO, layers: [{ imageUrl: IMG, start: 0, preset: "banner" }] }, null],
    ["a non-string resultCompositionKey", { videoUrl: VIDEO, layers: [L], resultCompositionKey: 7 }, null],
    ["an empty resultCompositionKey", { videoUrl: VIDEO, layers: [L], resultCompositionKey: "" }, null],
    ["an over-long resultCompositionKey", { videoUrl: VIDEO, layers: [L], resultCompositionKey: "k".repeat(VIDEO_OVERLAY_MAX_COMPOSITION_KEY_LENGTH + 1) }, null],
    // Video layers, a base box and layouts — the shared validator's text, one finding.
    ["a layer with both an image and a video", { videoUrl: VIDEO, layers: [{ imageUrl: IMG, videoUrl: CLIP, start: 0 }] }, "layers[0]: has both an image and a video — keep one (imageUrl or videoUrl)"],
    ["a layer with neither an image nor a video", { videoUrl: VIDEO, layers: [{ start: 0 }] }, "layers[0]: no image or video — connect one to the layer's handle or set imageUrl or videoUrl"],
    ["sound on an image layer", { videoUrl: VIDEO, layers: [{ imageUrl: IMG, start: 0, sound: { volume: 1 } }] }, "layers[0]: sound is only for a video layer — remove it or set videoUrl"],
    ["three video layers", { videoUrl: VIDEO, layers: Array.from({ length: 3 }, () => ({ videoUrl: CLIP, start: 0 })) }, "At most 2 video layers (got 3)"],
    ["stack-whole with no outputAspect", { videoUrl: VIDEO, layout: "stack-whole", layers: [{ videoUrl: CLIP, start: 0 }] }, "layout stack-whole needs an outputAspect"],
    ["pip with no video layer", { videoUrl: VIDEO, layout: "pip", layers: [L] }, "layout pip needs a video layer — set videoUrl on a layer or connect a video to a layer's handle"],
    ["a stack with a baseBox", { videoUrl: VIDEO, outputAspect: "9:16", layout: "stack-filled", baseBox: { anchor: "top", width: 100 }, layers: [{ videoUrl: CLIP, start: 0 }] }, "A stack layout places the base itself — remove baseBox or choose Custom"],
    ["a baseBox with no width", { videoUrl: VIDEO, outputAspect: "9:16", baseBox: { anchor: "top" }, layers: [L] }, "baseBox needs an anchor and a width"],
    ["a baseBox with no outputAspect", { videoUrl: VIDEO, baseBox: { anchor: "top", width: 100 }, layers: [L] }, "baseBox needs an outputAspect"],
    ["a volume above 1", { videoUrl: VIDEO, layers: [{ videoUrl: CLIP, start: 0, sound: { volume: 1.5 } }] }, null],
    ["a sound with no volume", { videoUrl: VIDEO, layers: [{ videoUrl: CLIP, start: 0, sound: {} }] }, null],
    ["a videoUrl that is not a URL", { videoUrl: VIDEO, layers: [{ videoUrl: "not a url", start: 0 }] }, null],
    ["an unknown layout", { videoUrl: VIDEO, layout: "stack", layers: [L] }, null],
    ["a baseBox x out of bounds", { videoUrl: VIDEO, outputAspect: "9:16", baseBox: { anchor: "top", width: 100, x: 101 }, layers: [L] }, null],
    ["a baseBox with an unknown fit", { videoUrl: VIDEO, outputAspect: "9:16", baseBox: { anchor: "top", width: 100, fit: "stretch" }, layers: [L] }, null],
  ])("%s → 400 validation_error", async (_name, body, message) => {
    const res = await post({ userId: USER, ...body })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
    // One finding: the shared validator speaks only for a body the schema accepted.
    expect(res.json().error.issues).toHaveLength(1)
    if (message) expect(res.json().error.message).toBe(message)
    expect(insert).not.toHaveBeenCalled()
    expect(vi.mocked(reserveCreditsForJob)).not.toHaveBeenCalled()
    expect(videoQueue.add).not.toHaveBeenCalled()
  })

  it("401 without a user", async () => {
    const res = await post({ videoUrl: VIDEO, layers: [L] })
    expect(res.statusCode).toBe(401)
    expect(res.json().error.code).toBe("unauthorized")
  })

  it("429 past 30 requests a minute (D4), before the credit guard", async () => {
    redis.incr.mockResolvedValueOnce(31)
    const res = await post({ userId: USER, videoUrl: VIDEO, layers: [L] })
    expect(res.statusCode).toBe(429)
    expect(res.json().error.code).toBe("rate_limit_exceeded")
    expect(insert).not.toHaveBeenCalled()
  })
})

describe("POST /v1/video-overlay — the price: an image-only run is the flat row, a run with a video layer is per started 5 s of the base", () => {
  const recorded = () => (insert.mock.calls[0]![0] as { input_data: Record<string, unknown> }).input_data

  it("an image-only body is never measured: the flat video-overlay row, priced by its own row (no BASE override), no billedUnits", async () => {
    const body = { userId: USER, videoUrl: VIDEO, layers: [{ imageUrl: IMG, start: 0 }] }
    const res = await post(body)
    expect(res.statusCode).toBe(200)
    expect(probe.urls).toEqual([])
    expect(vi.mocked(reserveCreditsForJob)).toHaveBeenCalledWith(expect.anything(), expect.anything(), "job-1", "video-overlay")
    expect(recorded()).not.toHaveProperty("billedUnits")
    expect(guardSeen).toEqual([{ id: "video-overlay", base: undefined }])
  })

  it("a 10 s base with a video layer: 2 units of the video row, reserved and recorded", async () => {
    const res = await post({ userId: USER, videoUrl: VIDEO, layers: [{ videoUrl: CLIP, start: 0 }] })
    expect(res.statusCode).toBe(200)
    expect(probe.urls).toEqual([VIDEO])
    expect(vi.mocked(reserveCreditsForJob)).toHaveBeenCalledWith(expect.anything(), expect.anything(), "job-1", "video-overlay:video")
    expect(recorded()).toMatchObject({ billedUnits: 2, type: "video-overlay" })
    // The worker is told the units it was charged for, to refuse a base that has grown since.
    expect(queued().billedUnits).toBe(2)
    expect(queued()).not.toHaveProperty("__videoOverlayUnits")
  })

  it("the guard prices the measured units on the video row: BASE = the row × the units (the markup is the guard's)", async () => {
    await post({ userId: USER, videoUrl: VIDEO, layers: [{ videoUrl: CLIP, start: 0 }] })
    expect(guardSeen).toEqual([{ id: "video-overlay:video", base: 20 }])
    expect(vi.mocked(unitRateBaseCredits)).toHaveBeenCalledWith("video-overlay:video", 2)
  })

  // The units are the server's own measurement: a client cannot send them.
  it("an image-only body carrying a forged __videoOverlayUnits is still the flat row: no BASE override, no billedUnits", async () => {
    const res = await post({ userId: USER, videoUrl: VIDEO, layers: [{ imageUrl: IMG, start: 0 }], __videoOverlayUnits: 1 })
    expect(res.statusCode).toBe(200)
    expect(guardSeen).toEqual([{ id: "video-overlay", base: undefined }])
    expect(vi.mocked(reserveCreditsForJob)).toHaveBeenCalledWith(expect.anything(), expect.anything(), "job-1", "video-overlay")
    expect(recorded()).not.toHaveProperty("billedUnits")
    expect(recorded()).not.toHaveProperty("__videoOverlayUnits")
  })

  it("a video body carrying a forged __videoOverlayUnits is charged its MEASURED units", async () => {
    probe.sec.set(VIDEO, 30)
    const res = await post({ userId: USER, videoUrl: VIDEO, layers: [{ videoUrl: CLIP, start: 0 }], __videoOverlayUnits: 1 })
    expect(res.statusCode).toBe(200)
    expect(guardSeen).toEqual([{ id: "video-overlay:video", base: 60 }])
    expect(recorded()).toMatchObject({ billedUnits: 6 })
  })

  it("a forged body billedUnits is never the charge or the worker's check: stripped, and replaced by the measured units", async () => {
    await post({ userId: USER, videoUrl: VIDEO, layers: [{ imageUrl: IMG, start: 0 }], billedUnits: 12 })
    expect(queued()).not.toHaveProperty("billedUnits")
    expect(recorded()).not.toHaveProperty("billedUnits")
    vi.clearAllMocks()
    probe.sec.set(VIDEO, 30)
    await post({ userId: USER, videoUrl: VIDEO, layers: [{ videoUrl: CLIP, start: 0 }], billedUnits: 99 })
    expect(queued().billedUnits).toBe(6)
    expect(recorded()).toMatchObject({ billedUnits: 6 })
  })

  it("a body the schema refuses, carrying a forged __videoOverlayUnits, is priced on the flat row and then refused", async () => {
    const res = await post({ userId: USER, videoUrl: VIDEO, layers: [], __videoOverlayUnits: 1 })
    expect(res.statusCode).toBe(400)
    expect(guardSeen).toEqual([{ id: "video-overlay", base: undefined }])
  })

  it("a 60 s base is 12 units; a 60.04 s cut still 12", async () => {
    probe.sec.set(VIDEO, 60)
    await post({ userId: USER, videoUrl: VIDEO, layers: [{ videoUrl: CLIP, start: 0 }] })
    expect(recorded()).toMatchObject({ billedUnits: 12 })
    vi.clearAllMocks()
    probe.sec.set(VIDEO, 60.04)
    await post({ userId: USER, videoUrl: VIDEO, layers: [{ videoUrl: CLIP, start: 0 }] })
    expect(recorded()).toMatchObject({ billedUnits: 12 })
  })

  it.each([
    ["a 61 s base", () => probe.sec.set(VIDEO, 61), { videoUrl: VIDEO, layers: [{ videoUrl: CLIP, start: 0 }] }, "video_overlay_too_long", "The base video is 61 seconds. A Video Overlay with a video layer takes a base of up to 60 seconds — trim it first."],
    ["a base that cannot be read", () => probe.sec.delete(VIDEO), { videoUrl: VIDEO, layers: [{ videoUrl: CLIP, start: 0 }] }, "invalid_media_duration", "Could not read the base video. The file may be corrupted or an unsupported format."],
    [
      "a stack whose first video layer starts after the base ends",
      () => undefined,
      { videoUrl: VIDEO, outputAspect: "9:16", layout: "stack-whole", layers: [{ imageUrl: IMG, start: 0 }, { videoUrl: CLIP, start: 12 }] },
      "video_overlay_starts_after_end",
      "layers[1]: the stacked video starts at 12 s, after the video ends (10.00 s)",
    ],
  ])("%s → 400, before anything is inserted or reserved", async (_name, arrange, body, code, message) => {
    arrange()
    const res = await post({ userId: USER, ...body })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toEqual({ code, message })
    expect(insert).not.toHaveBeenCalled()
    expect(vi.mocked(reserveCreditsForJob)).not.toHaveBeenCalled()
    expect(videoQueue.add).not.toHaveBeenCalled()
  })

  it("an image-only body over the cap is not refused — the cap is for a run with a video layer", async () => {
    probe.sec.set(VIDEO, 600)
    const res = await post({ userId: USER, videoUrl: VIDEO, layers: [{ imageUrl: IMG, start: 0 }] })
    expect(res.statusCode).toBe(200)
    expect(probe.urls).toEqual([])
  })

  it("a body the schema refuses is never measured: the 400 is the validation error, one finding", async () => {
    const res = await post({ userId: USER, videoUrl: VIDEO, layers: Array.from({ length: 3 }, () => ({ videoUrl: CLIP, start: 0 })) })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
    expect(probe.urls).toEqual([])
  })

  it("the rate limit answers before anything is measured", async () => {
    redis.incr.mockResolvedValueOnce(31)
    const res = await post({ userId: USER, videoUrl: VIDEO, layers: [{ videoUrl: CLIP, start: 0 }] })
    expect(res.statusCode).toBe(429)
    expect(probe.urls).toEqual([])
  })
})
