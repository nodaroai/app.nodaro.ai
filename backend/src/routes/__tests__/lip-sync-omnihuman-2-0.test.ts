/**
 * POST /v1/lip-sync on OmniHuman 2.0 (decided 2026-11-11): the route measures
 * the audio (downloaded and DECODED, decided 2026-11-12) and the image itself
 * before the credit guard, refuses what the model cannot take with a 400 before
 * anything is held, and records the MEASURED length — never one the request
 * sent, and never held seconds a request smuggled in — and none of 1.5's
 * levers. The download, the decoded-length measure, the image probe, the guard
 * and the queue are stood in for.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

const state = vi.hoisted(() => ({
  image: { size: { width: 1024, height: 1536 }, sizeBytes: 2_000_000 } as { size?: { width: number; height: number }; sizeBytes?: number },
  /** The audio: what it decodes to (seconds, or "over" the cap) and the bytes downloaded. */
  audio: { seconds: 10.04, bytes: 300_000 } as { seconds: number | "over"; bytes: number },
  downloads: 0,
  routeConfig: undefined as unknown,
  guardCalls: [] as Array<{ identifier: string; base: number | undefined }>,
  /** Every one of this process's measuring-download slots is taken. */
  busy: false,
}))

vi.mock("@/lib/image-source-probe.js", () => ({ probeImageSource: async () => state.image }))
vi.mock("@/lib/lip-sync-download-slots.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/lip-sync-download-slots.js")>()
  return {
    ...orig,
    lipSyncMeasureSlots: {
      ...orig.lipSyncMeasureSlots,
      acquire: async (userId: string | undefined, opts: { waitMs: number }) => (state.busy ? false : orig.lipSyncMeasureSlots.acquire(userId, opts)),
      release: (userId: string | undefined) => orig.lipSyncMeasureSlots.release(userId),
    },
  }
})
vi.mock("@/providers/video/ffmpeg-utils.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/providers/video/ffmpeg-utils.js")>()),
  downloadFile: async (_url: string, path: string) => {
    state.downloads++
    // A sparse file of that size: what the size check reads, without the disk.
    const { truncate, writeFile } = await import("node:fs/promises")
    await writeFile(path, "")
    await truncate(path, state.audio.bytes)
  },
}))
vi.mock("@/providers/video/decoded-audio-length.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/providers/video/decoded-audio-length.js")>()),
  measureDecodedAudio: async () =>
    state.audio.seconds === "over"
      ? { overCap: true }
      : { overCap: false, samples: Math.round(state.audio.seconds * 44_100), seconds: state.audio.seconds },
}))
vi.mock("@/lib/credit-base-cost.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/credit-base-cost.js")>()),
  unitRateBaseCredits: async (rateId: string, units: number) => (rateId === "omnihuman-2-0:per-second" ? 35 * units : 0),
}))
vi.mock("@/lib/insert-job.js", () => ({
  insertJob: vi.fn(async () => ({ data: { id: "job-1" }, error: null })),
}))
vi.mock("@/lib/queue.js", () => ({
  videoQueue: { add: vi.fn().mockResolvedValue({ id: "queue-job-1" }) },
  redis: {},
}))
// The guard records what it would price: the identifier and the route's computeCredits.
vi.mock("@/middleware/credit-guard.js", () => ({
  creditGuard: (resolve: (req: unknown) => string, opts?: { computeCredits?: (body: unknown, req: unknown) => Promise<number | undefined> }) =>
    async (req: { body: unknown }) => {
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

import rateLimit from "@fastify/rate-limit"
import { LIP_SYNC_RATE_MODEL_REQUESTS_PER_MINUTE, lipSyncRateLimitSkips, lipSyncRoutes, resolveLipSyncIdentifier } from "../lip-sync.js"
import { insertJob } from "@/lib/insert-job.js"
import { videoQueue } from "@/lib/queue.js"

const USER = "00000000-0000-4000-8000-000000000001"
const body = (over: Record<string, unknown> = {}) => ({
  provider: "omnihuman-2-0",
  imageUrl: "https://cdn.test/face.png",
  audioUrl: "https://cdn.test/voice.mp3",
  userId: USER,
  ...over,
})

describe("POST /v1/lip-sync — OmniHuman 2.0", () => {
  let app: FastifyInstance

  beforeEach(async () => {
    vi.clearAllMocks()
    state.image = { size: { width: 1024, height: 1536 }, sizeBytes: 2_000_000 }
    state.audio = { seconds: 10.04, bytes: 300_000 }
    state.downloads = 0
    state.guardCalls = []
    state.busy = false
    app = Fastify({ logger: false })
    app.addHook("onRoute", (route) => { if (route.url === "/v1/lip-sync") state.routeConfig = route.config })
    app.addHook("preHandler", async (req) => {
      const b = req.body as Record<string, unknown> | undefined
      if (typeof b?.userId === "string") req.userId = b.userId
    })
    await app.register(async (i) => { await lipSyncRoutes(i) })
    await app.ready()
  })

  afterEach(async () => { await app.close() })

  it("prices the audio it measured itself (10.04 s → 11 s at the rate), not the length the request sent", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/lip-sync", payload: body({ audioDurationSec: 3, resolution: "1080p", seed: 7, fastMode: true }) })
    expect(res.statusCode).toBe(200)
    expect(state.guardCalls).toEqual([{ identifier: "omnihuman-2-0:per-second", base: 35 * 11 }])

    const row = vi.mocked(insertJob).mock.calls[0]![1] as { input_data: Record<string, unknown> }
    expect(row.input_data).toMatchObject({ provider: "omnihuman-2-0", audioDurationSec: 10.04, lipSyncBilledSeconds: 11 })
    expect(row.input_data.resolution).toBeUndefined()
    expect(row.input_data.seed).toBeUndefined()
    expect(row.input_data.fastMode).toBeUndefined()

    const queued = vi.mocked(videoQueue.add).mock.calls[0]![1] as Record<string, unknown>
    expect(queued).toMatchObject({ provider: "omnihuman-2-0", audioDurationSec: 10.04, lipSyncBilledSeconds: 11 })
    expect(queued.resolution).toBeUndefined()
    expect(queued.seed).toBeUndefined()
    expect(queued.fastMode).toBeUndefined()
  })

  it("3.2 s of audio is held as 4 s", async () => {
    state.audio = { seconds: 3.2, bytes: 600_000 }
    expect((await app.inject({ method: "POST", url: "/v1/lip-sync", payload: body() })).statusCode).toBe(200)
    expect(state.guardCalls[0]!.base).toBe(35 * 4)
  })

  it.each([
    ["audio of 300.5 s", () => { state.audio = { seconds: 300.5, bytes: 5_000_000 } }, "audio_too_long"],
    ["audio that plays past the cap (decoding stopped there)", () => { state.audio = { seconds: "over", bytes: 1_200_000 } }, "audio_too_long"],
    ["a file of 100 MB", () => { state.audio = { seconds: 290, bytes: 100_000_000 } }, "audio_too_large"],
    ["an image 250 px wide", () => { state.image = { size: { width: 250, height: 400 }, sizeBytes: 100_000 } }, "image_out_of_bounds"],
    ["an image that cannot be read", () => { state.image = {} }, "image_unreadable"],
  ])("refuses %s with a 400 before the credit guard — nothing held, no job", async (_label, arrange, code) => {
    arrange()
    const res = await app.inject({ method: "POST", url: "/v1/lip-sync", payload: body() })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe(code)
    expect(state.guardCalls).toEqual([])
    expect(insertJob).not.toHaveBeenCalled()
  })

  it("a 40 MB WAV is accepted (the 15 MB is held after conversion, by the provider)", async () => {
    state.audio = { seconds: 226.7, bytes: 40_000_000 }
    expect((await app.inject({ method: "POST", url: "/v1/lip-sync", payload: body() })).statusCode).toBe(200)
    expect(state.guardCalls[0]!.base).toBe(35 * 227)
  })

  it("every measuring download taken: a 429 'try again in a moment' before the credit guard — nothing held, no job", async () => {
    state.busy = true
    const res = await app.inject({ method: "POST", url: "/v1/lip-sync", payload: body() })
    expect(res.statusCode).toBe(429)
    expect(res.json().error.code).toBe("lip_sync_audio_busy")
    expect(state.guardCalls).toEqual([])
    expect(insertJob).not.toHaveBeenCalled()
  })

  it("leaves 1.5 as it was: its bucket id from the sent length, its levers, no download — and no held seconds a request smuggled in", async () => {
    state.audio = { seconds: 999, bytes: 1 }
    const res = await app.inject({
      method: "POST",
      url: "/v1/lip-sync",
      payload: body({ provider: "omnihuman-1-5", audioDurationSec: 25, resolution: "1080p", seed: 7, __lipSyncBilledSeconds: 1, __lipSyncAudioSec: 1 }),
    })
    expect(res.statusCode).toBe(200)
    expect(state.downloads).toBe(0)
    expect(state.guardCalls).toEqual([{ identifier: "omnihuman-1-5:30s", base: undefined }])
    const row = vi.mocked(insertJob).mock.calls[0]![1] as { input_data: Record<string, unknown> }
    expect(row.input_data.lipSyncBilledSeconds).toBeUndefined()
    const queued = vi.mocked(videoQueue.add).mock.calls[0]![1] as Record<string, unknown>
    expect(queued).toMatchObject({ provider: "omnihuman-1-5", audioDurationSec: 25, resolution: "1080p", seed: 7 })
    expect(queued.lipSyncBilledSeconds).toBeUndefined()
  })

  it("held seconds a 2.0 request sends are replaced by the measured ones", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/lip-sync", payload: body({ __lipSyncBilledSeconds: 4, __lipSyncAudioSec: 3, lipSyncBilledSeconds: 4 }) })
    expect(res.statusCode).toBe(200)
    expect(state.guardCalls).toEqual([{ identifier: "omnihuman-2-0:per-second", base: 35 * 11 }])
    const queued = vi.mocked(videoQueue.add).mock.calls[0]![1] as Record<string, unknown>
    expect(queued).toMatchObject({ audioDurationSec: 10.04, lipSyncBilledSeconds: 11 })
  })

  it.each([
    ["an image link that is not a URL", { imageUrl: "face.png" }],
    ["no audio", { audioUrl: undefined }],
    ["an unknown field type", { prompt: 42 }],
  ])("a 2.0 request the handler's schema refuses (%s) is a 400 before any download — nothing held, no job", async (_label, over) => {
    const res = await app.inject({ method: "POST", url: "/v1/lip-sync", payload: body(over) })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
    expect(state.downloads).toBe(0)
    expect(state.guardCalls).toEqual([])
    expect(insertJob).not.toHaveBeenCalled()
  })

  it("limits per caller at preValidation — before any preHandler downloads — 30 a minute", () => {
    expect(state.routeConfig).toMatchObject({ rateLimit: { max: 30, timeWindow: "1 minute", hook: "preValidation" } })
  })

  it("resolves the rate id for 2.0 before the bucket branch", () => {
    expect(resolveLipSyncIdentifier({ provider: "omnihuman-2-0", audioDurationSec: 8 })).toBe("omnihuman-2-0:per-second")
    expect(resolveLipSyncIdentifier({ provider: "omnihuman-1-5", audioDurationSec: 8 })).toBe("omnihuman-1-5:15s")
  })
})

describe("POST /v1/lip-sync — the rate limit is for per-second-rate models only (decided 2026-11-12)", () => {
  let app: FastifyInstance

  beforeEach(async () => {
    vi.clearAllMocks()
    state.image = { size: { width: 1024, height: 1536 }, sizeBytes: 2_000_000 }
    state.audio = { seconds: 10.04, bytes: 300_000 }
    state.downloads = 0
    state.guardCalls = []
    state.busy = false
    app = Fastify({ logger: false })
    // As the app registers it: opt-in per route, one bucket per caller.
    await app.register(rateLimit, { global: false, keyGenerator: (req) => String(req.headers["x-caller"] ?? "anonymous") })
    app.addHook("preHandler", async (req) => {
      const b = req.body as Record<string, unknown> | undefined
      if (typeof b?.userId === "string") req.userId = b.userId
    })
    await app.register(async (i) => { await lipSyncRoutes(i) })
    await app.ready()
  })

  afterEach(async () => { await app.close() })

  const send = (caller: string, over: Record<string, unknown> = {}) =>
    app.inject({ method: "POST", url: "/v1/lip-sync", headers: { "x-caller": caller }, payload: body(over) })

  it("an OmniHuman 2.0 request past 30 a minute is a 429 before its audio is downloaded; another caller is not held up", async () => {
    expect(LIP_SYNC_RATE_MODEL_REQUESTS_PER_MINUTE).toBe(30)
    for (let i = 0; i < 30; i++) expect((await send("a")).statusCode, `request ${i + 1}`).toBe(200)
    expect(state.downloads).toBe(30)
    expect((await send("a")).statusCode).toBe(429)
    expect(state.downloads).toBe(30)
    expect((await send("b")).statusCode).toBe(200)
  })

  it("a Kling Avatar request is never limited (an editor list fanning out, a connected install), and does not use up 2.0's allowance", async () => {
    const kling = { provider: "kling-avatar", audioDurationSec: 12 }
    for (let i = 0; i < 40; i++) expect((await send("a", kling)).statusCode, `request ${i + 1}`).toBe(200)
    expect(state.downloads).toBe(0)
    expect((await send("a")).statusCode).toBe(200)
  })

  it("only a per-second-rate model is counted; no model named is the default, which is not one", () => {
    expect(lipSyncRateLimitSkips({ body: { provider: "omnihuman-2-0" } })).toBe(false)
    for (const provider of ["kling-avatar", "kling-avatar-pro", "omnihuman-1-5", "infinitalk", "seedance-2", "latentsync", undefined]) {
      expect(lipSyncRateLimitSkips({ body: { provider } }), String(provider)).toBe(true)
    }
    expect(lipSyncRateLimitSkips({ body: undefined })).toBe(true)
  })
})
