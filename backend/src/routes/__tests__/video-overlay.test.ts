import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

const redis = vi.hoisted(() => ({ incr: vi.fn(), expire: vi.fn(), ttl: vi.fn() }))

vi.mock("@/lib/supabase.js", () => ({ supabase: { from: vi.fn() } }))
vi.mock("@/lib/queue.js", () => ({
  videoQueue: { add: vi.fn().mockResolvedValue({ id: "queue-job-1" }) },
  redis,
}))
vi.mock("@/middleware/credit-guard.js", () => ({
  creditGuard: () => async () => {},
  reserveCreditsForJob: vi.fn().mockResolvedValue({ usageLogId: "usage-1", creditsReserved: 20, watermark: false }),
}))
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
import {
  VIDEO_OVERLAY_MAX_COMPOSITION_KEY_LENGTH,
  assembleVideoOverlayRequest,
  validateVideoOverlayRequest,
  type VideoOverlayLayerInput,
} from "@nodaro/shared"

const USER = "00000000-0000-4000-8000-000000000001"
const VIDEO = "https://cdn.example/base.mp4"
const IMG = "https://cdn.example/card.png"

let app: FastifyInstance
let insert: ReturnType<typeof vi.fn>

beforeEach(async () => {
  vi.clearAllMocks()
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
