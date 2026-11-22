// @test-units-by-name quotes only the node type it names (lip-sync)
/**
 * POST /v1/quote on Lip Sync: priced with the chain its run route registers,
 * the quote equals what the run reserves on the same body — the audio measured
 * as the run measures it, so a model priced by its audio's length is quoted on
 * the bucket the run holds. LatentSync, charged what its run used, says its
 * reserve is the most it costs (`settles_to_actual`); a model charged its hold
 * as it is says nothing of the kind. A refusal the run gives before anything is
 * held (a retired model, a reference voice line its model cannot take) is the
 * quote's too. The real credit guard, the real route and the real pricing;
 * only the edges are stubbed (the DB, the reservation, the queue, the audio
 * download and its decode).
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"
import { z } from "zod"

const state = vi.hoisted(() => ({
  /** What the audio decodes to, in seconds. */
  audioSec: 25,
  /** The reference voice line check's answer. */
  refAudio: { ok: true } as { ok: true } | { ok: false; code: string; message: string },
}))

vi.mock("../../../providers/video/ffmpeg-utils.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../providers/video/ffmpeg-utils.js")>()),
  downloadFile: async (_url: string, path: string) => {
    const { writeFile } = await import("node:fs/promises")
    await writeFile(path, "")
  },
}))
vi.mock("../../../providers/video/decoded-audio-length.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../providers/video/decoded-audio-length.js")>()),
  measureDecodedAudio: async () => ({ overCap: false, samples: Math.round(state.audioSec * 44_100), seconds: state.audioSec }),
}))
vi.mock("../../../lib/image-source-probe.js", () => ({ probeImageSource: async () => ({ size: { width: 1024, height: 1536 }, sizeBytes: 2_000_000 }) }))
vi.mock("../../../lib/lip-sync-floor-check.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/lip-sync-floor-check.js")>()),
  lipSyncFloorRefusal: async () => undefined,
}))
vi.mock("../../../lib/ref-audio-probe.js", () => ({
  sentReferenceAudioUrls: () => ["https://cdn.example.com/voice.mp3"],
  probeAndCheckRefAudio: async () => state.refAudio,
}))
vi.mock("../../../lib/config.js", async () => {
  const actual = await vi.importActual<typeof import("../../../lib/config.js")>("../../../lib/config.js")
  return { ...actual, hasCredits: () => true, isCommunity: () => false, isBusiness: () => false, isCloud: () => true, hasAdmin: () => true }
})
vi.mock("../../../lib/admin-check.js", () => ({ warmAdminCache: vi.fn() }))
vi.mock("../../../lib/app-settings.js", () => ({
  // A real markup, so the quote has to mark up exactly as the reservation does.
  getAppSettings: vi.fn(() => Promise.resolve({ cost_markup_percent: 10 })),
}))
vi.mock("../../../lib/url-validator.js", () => ({ safeUrlSchema: z.string().url() }))

const fakeProfile = {
  role: "user", tier: "standard", subscription_tier: "standard",
  subscription_credits: 100000, topup_credits: 0,
  daily_spent_credits: 0, last_daily_reset: null,
  storage_used_bytes: 0, storage_limit_bytes: 1e10,
}
const DB_PRICE = 19
vi.mock("../../../lib/supabase.js", () => ({
  supabase: {
    from: vi.fn((table: string) => {
      if (table === "profiles") {
        return { select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: fakeProfile, error: null }) }) }) }
      }
      if (table === "jobs") {
        return {
          insert: () => ({ select: () => ({ single: () => Promise.resolve({ data: { id: "job-1" }, error: null }) }) }),
          upsert: () => ({ select: () => Promise.resolve({ data: [{ id: "job-1" }], error: null }) }),
          update: () => ({ eq: () => Promise.resolve({ data: null, error: null }) }),
        }
      }
      if (table === "model_pricing") {
        return { select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: { credit_cost: DB_PRICE, is_enabled: true, tier_restriction: null }, error: null }) }) }) }
      }
      return {}
    }),
  },
}))

const reserveSpy = vi.fn((..._args: unknown[]) => Promise.resolve({ usageLogId: "log-1", creditsReserved: 1, watermark: false }))
vi.mock("../../billing/credits.js", async () => {
  const actual = await vi.importActual<typeof import("../../billing/credits.js")>("../../billing/credits.js")
  return {
    ...actual,
    CreditsService: {
      checkStorageLimitWithProfile: () => ({ allowed: true, usedBytes: 0, limitBytes: 1e10 }),
      checkCreditsWithProfile: vi.fn(() => Promise.resolve({ allowed: true, watermark: false })),
      reserveCredits: reserveSpy,
    },
  }
})
vi.mock("../../../lib/queue.js", () => ({
  videoQueue: { add: vi.fn(() => Promise.resolve({ id: "queue-1" })) },
}))

beforeEach(() => {
  vi.clearAllMocks()
  state.audioSec = 25
  state.refAudio = { ok: true }
})

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify()
  app.addHook("preHandler", async (req) => {
    ;(req as unknown as { userId: string }).userId = "00000000-0000-4000-8000-000000000001"
  })
  const { lipSyncRoutes } = await import("../../../routes/lip-sync.js")
  const { registerNodeQuote } = await import("../node-quote.js")
  await lipSyncRoutes(app)
  registerNodeQuote(app)
  return app
}

interface Quote { identifier: string; reserve: number; warnings: { code: string }[] }

/** Quote the body, then run it; returns the quote and what the run reserved. */
async function quoteThenRun(params: Record<string, unknown>) {
  const app = await buildApp()
  const q = await app.inject({ method: "POST", url: "/v1/quote", payload: { type: "lip-sync", params } })
  expect(q.statusCode, q.body).toBe(200)
  const quote = (q.json() as { data: Quote }).data
  expect(reserveSpy).not.toHaveBeenCalled()
  const run = await app.inject({ method: "POST", url: "/v1/lip-sync", payload: params })
  expect(run.statusCode, run.body).toBe(200)
  expect(reserveSpy).toHaveBeenCalledTimes(1)
  const [, , identifier, , , options] = reserveSpy.mock.calls[0]! as [string, string, string, number, number, { creditOverride?: number }]
  const { getModelCreditCostFromDB } = await import("../../billing/credits.js")
  const reserved = options?.creditOverride ?? (await getModelCreditCostFromDB(identifier)).creditCost
  await app.close()
  return { quote, identifier, reserved }
}

const LATENTSYNC = { provider: "latentsync", videoUrl: "https://cdn.example.com/clip.mp4", audioUrl: "https://cdn.example.com/voice.mp3" }

describe("POST /v1/quote prices Lip Sync as its run reserves", () => {
  it.each([
    [12, "latentsync:15s"],
    [25, "latentsync:30s"],
    [30.03, "latentsync:30s"],
    [200, "latentsync:300s"],
  ] as const)("LatentSync on audio that decodes to %s s: the %s hold, the most the run costs", async (sec, id) => {
    state.audioSec = sec
    const { quote, identifier, reserved } = await quoteThenRun(LATENTSYNC)
    expect(identifier).toBe(id)
    expect(quote).toMatchObject({ identifier, reserve: reserved })
    expect(quote.warnings.map((w) => w.code)).toContain("settles_to_actual")
  })

  it("Kling AI Avatar: the bucket of the measured audio, charged as it is held (no settles_to_actual)", async () => {
    state.audioSec = 42
    const { quote, identifier, reserved } = await quoteThenRun({ provider: "kling-avatar", imageUrl: "https://cdn.example.com/face.png", audioUrl: "https://cdn.example.com/voice.mp3" })
    expect(identifier).toBe("kling-avatar:60s")
    expect(quote).toMatchObject({ identifier, reserve: reserved })
    expect(quote.warnings.map((w) => w.code)).not.toContain("settles_to_actual")
  })

  it("a retired model: the quote gives the run's own 400, nothing priced", async () => {
    const app = await buildApp()
    const params = { ...LATENTSYNC, provider: "wav2lip" }
    const q = await app.inject({ method: "POST", url: "/v1/quote", payload: { type: "lip-sync", params } })
    const run = await app.inject({ method: "POST", url: "/v1/lip-sync", payload: params })
    expect(q.statusCode).toBe(400)
    expect(run.statusCode).toBe(400)
    expect(q.json().error).toEqual(run.json().error)
    expect(reserveSpy).not.toHaveBeenCalled()
    await app.close()
  })

  it("a reference voice line its model cannot take: the quote and the run give the same 400, before anything is held", async () => {
    state.refAudio = { ok: false, code: "ref_audio_too_short", message: "The voice line is 1 s long; this model takes 2 to 30 seconds." }
    const app = await buildApp()
    const q = await app.inject({ method: "POST", url: "/v1/quote", payload: { type: "lip-sync", params: LATENTSYNC } })
    const run = await app.inject({ method: "POST", url: "/v1/lip-sync", payload: LATENTSYNC })
    expect(q.statusCode).toBe(400)
    expect(run.statusCode).toBe(400)
    expect(q.json().error).toEqual({ code: "ref_audio_too_short", message: "The voice line is 1 s long; this model takes 2 to 30 seconds." })
    expect(run.json().error).toEqual(q.json().error)
    expect(reserveSpy).not.toHaveBeenCalled()
    await app.close()
  })
})
