/**
 * POST /v1/lip-sync on LTX 2.5 Fast (decided 2026-11-23): Generate Video's
 * audio-to-video run with the portrait as its start frame. The route reads the
 * voice inside the guard's pricing step (Generate Video's own measurement),
 * holds the row of its length rounded up to a whole second, judges free
 * credits only from that reading, and queues the job with the server's stamp.
 * Harness: lip-sync-measured-length.test.ts.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

const state = vi.hoisted(() => ({
  /** What the audio decodes to, in seconds, "damaged" (it does not decode to its end) or "stopped" (its decode hit its own time limit). */
  audio: 42 as number | "damaged" | "stopped",
  /** The payer cannot cover the model's cheapest run: the guard's 402 for it. */
  broke: false,
  /** The models the floor check was asked about. */
  floorAsked: [] as string[],
  downloads: 0,
  guardCalls: [] as Array<{ identifier: string; base: number | undefined }>,
  /** The length the request named, as the guard sees the body. */
  guardSawLength: [] as unknown[],
  /** The voice file carries a picture (a video wired as the voice). */
  hasVideo: false,
  /** The free-credit request the route left for the guard. */
  freeVideo: [] as unknown[],
}))

vi.mock("@/lib/image-source-probe.js", () => ({ probeImageSource: async () => ({ size: { width: 1024, height: 1536 }, sizeBytes: 2_000_000 }) }))
vi.mock("@/providers/video/ffmpeg-utils.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/providers/video/ffmpeg-utils.js")>()),
  downloadFile: async (_url: string, path: string) => {
    state.downloads++
    const { writeFile } = await import("node:fs/promises")
    await writeFile(path, "")
  },
  probeMediaStreams: async () => ({ hasVideo: state.hasVideo, hasAudio: true }),
}))
vi.mock("@/providers/video/decoded-audio-length.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/providers/video/decoded-audio-length.js")>()
  return {
    ...orig,
    measureDecodedAudio: async () => {
      if (state.audio === "damaged") throw new orig.AudioReadStoppedError("decoded 4.000 s of the 42.000 s the flac file states")
      if (state.audio === "stopped") throw Object.assign(new Error("ffmpeg failed: killed"), { killed: true, timedOut: true })
      return { overCap: false, samples: Math.round(state.audio * 44_100), seconds: state.audio }
    },
  }
})
vi.mock("@/lib/lip-sync-floor-check.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/lip-sync-floor-check.js")>()),
  lipSyncFloorRefusal: async (_req: unknown, pricing: { floorCreditId?: string }) => {
    state.floorAsked.push(pricing.floorCreditId ?? "?")
    return state.broke ? { statusCode: 402, body: { error: { code: "insufficient_credits", message: "Insufficient credits." } } } : undefined
  },
}))
vi.mock("@/lib/credit-base-cost.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/credit-base-cost.js")>()),
  unitRateBaseCredits: async (rateId: string, units: number) => (rateId === "omnihuman-2-0:per-second" ? 35 * units : 0),
}))
vi.mock("@/lib/insert-job.js", () => ({ insertJob: vi.fn(async () => ({ data: { id: "job-1" }, error: null })) }))
vi.mock("@/lib/queue.js", () => ({ videoQueue: { add: vi.fn().mockResolvedValue({ id: "queue-job-1" }) }, redis: {} }))
vi.mock("@/middleware/credit-guard.js", () => ({
  // As the real guard: its `beforePricing` step (the audio measurement) after its doors, then the pricing.
  creditGuard: (
    resolve: (req: unknown) => string,
    opts?: { computeCredits?: (body: unknown, req: unknown) => Promise<number | undefined>; beforePricing?: (req: unknown, reply: unknown) => Promise<unknown> },
  ) =>
    async (req: { body: unknown }, reply: { sent: boolean }) => {
      await opts?.beforePricing?.(req, reply)
      if (reply.sent) return
      state.guardSawLength.push((req.body as Record<string, unknown>).audioDurationSec)
      state.freeVideo.push((req as { freeVideoRequest?: unknown }).freeVideoRequest)
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

import { lipSyncRoutes } from "../lip-sync.js"
import { insertJob } from "@/lib/insert-job.js"
import { videoQueue } from "@/lib/queue.js"
import { reserveCreditsForJob } from "@/middleware/credit-guard.js"

const USER = "00000000-0000-4000-8000-000000000001"
const VOICE = "https://cdn.test/voice.mp3"
const body = (over: Record<string, unknown> = {}) => ({ provider: "ltx-2.5-fast", imageUrl: "https://cdn.test/face.png", audioUrl: VOICE, userId: USER, ...over })

describe("POST /v1/lip-sync — LTX 2.5 Fast", () => {
  let app: FastifyInstance

  beforeEach(async () => {
    vi.clearAllMocks()
    Object.assign(state, { audio: 7.2, broke: false, floorAsked: [], downloads: 0, guardCalls: [], guardSawLength: [], hasVideo: false, freeVideo: [] })
    app = Fastify({ logger: false })
    app.addHook("preHandler", async (req) => {
      const b = req.body as Record<string, unknown> | undefined
      if (typeof b?.userId === "string") req.userId = b.userId
    })
    await app.register(async (i) => { await lipSyncRoutes(i) })
    await app.ready()
  })

  afterEach(async () => { await app.close() })

  const post = (b: Record<string, unknown>) => app.inject({ method: "POST", url: "/v1/lip-sync", payload: b })
  const queued = () => vi.mocked(videoQueue.add).mock.calls[0]![1] as Record<string, unknown>
  const recorded = () => (vi.mocked(insertJob).mock.calls[0]![1] as { input_data: Record<string, unknown> }).input_data

  it("holds the row of the voice's length rounded up, at the node's 720p, and queues the stamped run", async () => {
    const res = await post(body({ audioDurationSec: 3 }))
    expect(res.statusCode).toBe(200)
    expect(state.guardCalls).toEqual([{ identifier: "ltx-2.5-fast:8s:720p", base: undefined }])
    expect(vi.mocked(reserveCreditsForJob).mock.calls[0]![3]).toBe("ltx-2.5-fast:8s:720p")
    expect(state.floorAsked).toEqual(["ltx-2.5-fast:2s:720p"])
    expect(state.guardSawLength).toEqual([undefined])
    const stamp = { audioToVideo: true, referenceAudioUrls: [VOICE], duration: 7.15, drivingAudioSec: 7.2, drivingAudioBilledSec: 8, resolution: "720p" }
    expect(queued()).toMatchObject({ provider: "ltx-2.5-fast", ...stamp })
    expect(recorded()).toMatchObject({ ...stamp, audioDurationSec: 7.2 })
  })

  it("judges free credits only from its reading: audio-driven, the seconds held, the resolution sent", async () => {
    await post(body({ resolution: "1440p" }))
    expect(state.freeVideo).toEqual([{ provider: "ltx-2.5-fast", duration: 8, resolution: "1440p", videoSize: null, audioDriven: true }])
  })

  it.each([
    ["no portrait", { imageUrl: undefined }, "lip_sync_image_required"],
    ["a video face input", { videoUrl: "https://cdn.test/face.mp4" }, "lip_sync_image_required"],
  ])("%s is refused before the voice is downloaded or anything is held", async (_why, over, code) => {
    const res = await post(body(over))
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe(code)
    expect(state.downloads).toBe(0)
    expect(reserveCreditsForJob).not.toHaveBeenCalled()
  })

  it.each([
    ["a voice under 2.05 s", { audio: 2.02 }, {}, "audio_too_short"],
    ["14 s at 1440p", { audio: 14 }, { resolution: "1440p" }, "audio_too_long"],
    ["a video file as the voice", { hasVideo: true }, {}, "audio_has_video"],
  ])("%s is refused before the hold, not trimmed", async (_why, st, over, code) => {
    Object.assign(state, st)
    const res = await post(body(over))
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe(code)
    expect(reserveCreditsForJob).not.toHaveBeenCalled()
    expect(videoQueue.add).not.toHaveBeenCalled()
  })

  it("a stopped reading is the server's (503); a payer who cannot cover the shortest clip is refused before the download", async () => {
    state.audio = "stopped"
    expect((await post(body())).statusCode).toBe(503)
    state.broke = true
    state.downloads = 0
    expect((await post(body())).statusCode).toBe(402)
    expect(state.downloads).toBe(0)
  })
})

describe("POST /v1/lip-sync — 1440p is LTX 2.5 Fast's alone (decided 2026-11-23)", () => {
  let app: FastifyInstance
  beforeEach(async () => {
    vi.clearAllMocks()
    Object.assign(state, { audio: 7.2, broke: false, floorAsked: [], downloads: 0, guardCalls: [], guardSawLength: [], hasVideo: false, freeVideo: [] })
    app = Fastify({ logger: false })
    app.addHook("preHandler", async (req) => {
      const b = req.body as Record<string, unknown> | undefined
      if (typeof b?.userId === "string") req.userId = b.userId
    })
    await app.register(async (i) => { await lipSyncRoutes(i) })
    await app.ready()
  })
  afterEach(async () => { await app.close() })

  it.each(["seedance-2", "kling-avatar", "infinitalk"])("%s with a stale 1440p is refused before anything is held", async (provider) => {
    const res = await app.inject({ method: "POST", url: "/v1/lip-sync", payload: { provider, imageUrl: "https://cdn.test/face.png", audioUrl: VOICE, userId: USER, resolution: "1440p" } })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.message).toMatch(/does not render 1440p/)
    expect(state.guardCalls).toEqual([])
    expect(reserveCreditsForJob).not.toHaveBeenCalled()
  })
})
