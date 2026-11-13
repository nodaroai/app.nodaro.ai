/**
 * POST /v1/lip-sync on every model priced by the length of its audio — the
 * per-second-rate model (OmniHuman 2.0) and the models priced by a length
 * bucket (decided 2026-11-13: Kling AI Avatar (Pro), OmniHuman 1.5, HeyGen
 * Lipsync Precision, Sync Lipsync 2 Pro / v3, Volcengine). The route measures
 * the audio before the credit guard and holds — and the job records — the
 * length it measured, never the `audioDurationSec` a request names (MCP's
 * `lip_sync` and the SDK reach this route). The figure the editor quotes for
 * a known length is the row held for it, and the charge is the hold
 * (lip-sync commits its reservation as it is). Damaged or cut-short audio is
 * refused before anything is held. The download, the decoded-length measure,
 * the image probe, the guard and the queue are stood in for.
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
}))

vi.mock("@/lib/image-source-probe.js", () => ({ probeImageSource: async () => ({ size: { width: 1024, height: 1536 }, sizeBytes: 2_000_000 }) }))
vi.mock("@/providers/video/ffmpeg-utils.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/providers/video/ffmpeg-utils.js")>()),
  downloadFile: async (_url: string, path: string) => {
    state.downloads++
    const { writeFile } = await import("node:fs/promises")
    await writeFile(path, "")
  },
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
  lipSyncFloorRefusal: async (_req: unknown, pricing: unknown) => {
    const { lipSyncFloorCreditId } = await importOriginal<typeof import("@/lib/lip-sync-floor-check.js")>()
    state.floorAsked.push(lipSyncFloorCreditId(pricing as never))
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

import { LIP_SYNC_PROVIDERS } from "@nodaro/shared/models"
import { buildLipSyncCreditId, lipSyncAudioRateOf, lipSyncEstimateSeconds, unitQuoteCreditId } from "@nodaro/shared/credits"
import { lipSyncRoutes } from "../lip-sync.js"
import { lipSyncAudioPricingOf } from "@/lib/lip-sync-inputs.js"
import { insertJob } from "@/lib/insert-job.js"
import { videoQueue } from "@/lib/queue.js"
import { reserveCreditsForJob } from "@/middleware/credit-guard.js"

const USER = "00000000-0000-4000-8000-000000000001"
/** Every model priced by its audio's length, with the face input it takes. */
const LENGTH_PRICED = LIP_SYNC_PROVIDERS.filter((p) => lipSyncAudioPricingOf(p) !== undefined)
const VIDEO_FACED = new Set(["heygen-lipsync-precision", "lipsync-2-pro", "sync-lipsync-v3", "volcengine-lipsync"])
const body = (provider: string, over: Record<string, unknown> = {}) => ({
  provider,
  ...(VIDEO_FACED.has(provider) ? { videoUrl: "https://cdn.test/face.mp4" } : { imageUrl: "https://cdn.test/face.png" }),
  audioUrl: "https://cdn.test/voice.mp3",
  userId: USER,
  ...over,
})

/** The row held, the base the guard computes, and the seconds held, for audio that plays `sec` on `provider`. */
function heldFor(provider: string, sec: number): { identifier: string; base: number | undefined; held: number } {
  const rate = lipSyncAudioRateOf(provider)
  if (rate) return { identifier: rate.rateId, base: 35 * Math.max(rate.minSeconds, Math.ceil(sec)), held: Math.max(rate.minSeconds, Math.ceil(sec)) }
  const identifier = buildLipSyncCreditId(provider, sec)
  return { identifier, base: undefined, held: Number(/:(\d+)s$/.exec(identifier)![1]) }
}

describe("POST /v1/lip-sync — every model priced by its audio's length holds the length it measures", () => {
  let app: FastifyInstance

  beforeEach(async () => {
    vi.clearAllMocks()
    state.audio = 42
    state.broke = false
    state.floorAsked = []
    state.downloads = 0
    state.guardCalls = []
    state.guardSawLength = []
    app = Fastify({ logger: false })
    app.addHook("preHandler", async (req) => {
      const b = req.body as Record<string, unknown> | undefined
      if (typeof b?.userId === "string") req.userId = b.userId
    })
    await app.register(async (i) => { await lipSyncRoutes(i) })
    await app.ready()
  })

  afterEach(async () => { await app.close() })

  it("covers the per-second-rate model and every bucketed one", () => {
    expect(LENGTH_PRICED).toEqual([
      "kling-avatar", "kling-avatar-pro", "omnihuman-1-5", "omnihuman-2-0",
      "heygen-lipsync-precision", "lipsync-2-pro", "sync-lipsync-v3", "volcengine-lipsync",
    ])
  })

  it.each(LENGTH_PRICED)("%s: a request naming 1 s for audio that plays 42 s is held, recorded and quoted on 42 s", async (provider) => {
    const res = await app.inject({ method: "POST", url: "/v1/lip-sync", payload: body(provider, { audioDurationSec: 1 }) })
    expect(res.statusCode).toBe(200)
    expect(state.downloads).toBe(1)
    const want = heldFor(provider, 42)
    expect(state.guardCalls).toEqual([{ identifier: want.identifier, base: want.base }])
    // Nothing the guard prices with can read the length the request named.
    expect(state.guardSawLength).toEqual([undefined])
    // The job's own reservation reads the same row as the guard: the hold is one figure.
    expect(vi.mocked(reserveCreditsForJob).mock.calls[0]![3]).toBe(want.identifier)
    const row = vi.mocked(insertJob).mock.calls[0]![1] as { input_data: Record<string, unknown> }
    expect(row.input_data).toMatchObject({ audioDurationSec: 42, lipSyncBilledSeconds: want.held })
    const queued = vi.mocked(videoQueue.add).mock.calls[0]![1] as Record<string, unknown>
    expect(queued).toMatchObject({ provider, audioDurationSec: 42, lipSyncBilledSeconds: want.held })
    // What the editor quotes once it knows the audio plays 42 s is what is held.
    const rate = lipSyncAudioRateOf(provider)
    if (rate) expect(unitQuoteCreditId(rate.rateId, lipSyncEstimateSeconds(rate, 42))).toBe(`${rate.rateId}:${want.held}u`)
    else expect(buildLipSyncCreditId(provider, 42)).toBe(want.identifier)
  })

  it.each(LENGTH_PRICED.filter((p) => lipSyncAudioPricingOf(p)?.kind === "bucket"))(
    "%s: a request naming 400 s for audio that plays 10 s is held on 10 s (the 15 s bucket), and one naming none on the same",
    async (provider) => {
      state.audio = 10
      for (const over of [{ audioDurationSec: 400 }, {}]) {
        state.guardCalls = []
        const res = await app.inject({ method: "POST", url: "/v1/lip-sync", payload: body(provider, over) })
        expect(res.statusCode).toBe(200)
        expect(state.guardCalls).toEqual([{ identifier: `${provider}:15s`, base: undefined }])
      }
    },
  )

  it.each(LENGTH_PRICED)("%s: damaged or cut-short audio is a 400 before the guard, the job row and the queue", async (provider) => {
    state.audio = "damaged"
    const res = await app.inject({ method: "POST", url: "/v1/lip-sync", payload: body(provider, { audioDurationSec: 12 }) })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toMatchObject({ code: "audio_unreadable" })
    expect(res.json().error.message).toMatch(/could not read the audio to its end/)
    expect(state.guardCalls).toEqual([])
    expect(insertJob).not.toHaveBeenCalled()
    expect(videoQueue.add).not.toHaveBeenCalled()
  })

  it.each(LENGTH_PRICED)("%s: a payer who cannot cover even its cheapest run is refused with the guard's 402 before any download", async (provider) => {
    state.broke = true
    const res = await app.inject({ method: "POST", url: "/v1/lip-sync", payload: body(provider) })
    expect(res.statusCode).toBe(402)
    expect(res.json().error.code).toBe("insufficient_credits")
    expect(state.downloads).toBe(0)
    expect(state.guardCalls).toEqual([])
    expect(state.floorAsked).toEqual([lipSyncAudioRateOf(provider) ? "omnihuman-2-0:per-second:4u" : `${provider}:15s`])
  })

  it.each(LENGTH_PRICED.filter((p) => lipSyncAudioPricingOf(p)?.kind === "bucket"))("%s: a request with no face input is a 400 before any download", async (provider) => {
    const res = await app.inject({ method: "POST", url: "/v1/lip-sync", payload: { provider, audioUrl: "https://cdn.test/voice.mp3", userId: USER } })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toEqual({ code: "validation_error", message: "Either imageUrl or videoUrl is required" })
    expect(state.downloads).toBe(0)
    expect(insertJob).not.toHaveBeenCalled()
  })

  it("Volcengine with an image but no video is a 400 before any download", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/lip-sync", payload: { provider: "volcengine-lipsync", imageUrl: "https://cdn.test/face.png", audioUrl: "https://cdn.test/voice.mp3", userId: USER } })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.message).toBe("Volcengine lip sync requires a video input (videoUrl)")
    expect(state.downloads).toBe(0)
  })

  it.each(LENGTH_PRICED)("%s: a measurement stopped by its own time limit is our failure — a 503 to retry, never a 400 about the file", async (provider) => {
    state.audio = "stopped"
    const res = await app.inject({ method: "POST", url: "/v1/lip-sync", payload: body(provider) })
    expect(res.statusCode).toBe(503)
    expect(res.json().error.code).toBe("lip_sync_audio_measure_stopped")
    expect(state.guardCalls).toEqual([])
    expect(insertJob).not.toHaveBeenCalled()
  })

  it("a model whose price reads no length is never measured: its job is what it was", async () => {
    for (const provider of ["infinitalk", "seedance-2", "minimax-h3", "latentsync"]) {
      state.guardCalls = []
      vi.mocked(videoQueue.add).mockClear()
      const res = await app.inject({ method: "POST", url: "/v1/lip-sync", payload: body(provider, { audioDurationSec: 12 }) })
      expect(res.statusCode, provider).toBe(200)
      const queued = vi.mocked(videoQueue.add).mock.calls[0]![1] as Record<string, unknown>
      expect(queued.audioDurationSec, provider).toBe(12)
      expect(queued.lipSyncBilledSeconds, provider).toBeUndefined()
    }
    expect(state.downloads).toBe(0)
  })
})
