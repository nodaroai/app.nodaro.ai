// @test-units-by-name quotes only the node types it names (ai-avatar, cinematic-avatar, switchx)
/**
 * POST /v1/quote on AI Avatar, Cinematic Avatar and SwitchX: each is priced
 * with the chain its run route registers, and the quote equals what the run
 * reserves on the same body — AI Avatar's audio and SwitchX's frames measured
 * as the run measures them (the worst-case 240-frame tier when SwitchX's
 * cannot be read; AI Avatar's unreadable audio refused, as the run refuses it). The real credit guard,
 * the real routes and the real pricing; only the edges are stubbed (the DB,
 * the reservation, the queue, ffprobe).
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"
import { z } from "zod"

const frames = vi.hoisted(() => ({ probeVideoFrames: vi.fn(async (_url: string) => ({ frames: 96, width: 1280, height: 720 })), exactFrameCount: vi.fn(async (_url: string) => 96) }))
vi.mock("../../../lib/ffprobe-frames.js", () => frames)
const sound = vi.hoisted(() => ({ probeSoundLengthSec: vi.fn(async (_url: string, _opts?: unknown): Promise<number> => 10) }))
vi.mock("../../../lib/video-utility-probe.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/video-utility-probe.js")>()),
  probeSoundLengthSec: sound.probeSoundLengthSec,
}))
vi.mock("../../../lib/config.js", async () => {
  const actual = await vi.importActual<typeof import("../../../lib/config.js")>("../../../lib/config.js")
  return { ...actual, hasCredits: () => true, isCommunity: () => false, isBusiness: () => false, isCloud: () => true, hasAdmin: () => true }
})
vi.mock("../../../lib/admin-check.js", () => ({ warmAdminCache: vi.fn() }))
// The quote reads its run body through the app's own rule for a caller's body (spied, not changed).
vi.mock("../../../middleware/server-only-body-keys.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../middleware/server-only-body-keys.js")>()
  return { ...actual, callerBodyOf: vi.fn(actual.callerBodyOf) }
})
vi.mock("../../../lib/app-settings.js", () => ({
  // A real markup, so the quote has to mark up exactly as the reservation does.
  getAppSettings: vi.fn(() => Promise.resolve({ cost_markup_percent: 10 })),
}))
vi.mock("../../../lib/url-validator.js", () => ({ safeUrlSchema: z.string().url() }))
// One model this deployment does not offer, so the quote's deny is exercised.
const deniedModels = vi.hoisted(() => new Set<string>(["runway-aleph"]))
vi.mock("../../../lib/surface-deny.js", async () => {
  const actual = await vi.importActual<typeof import("../../../lib/surface-deny.js")>("../../../lib/surface-deny.js")
  return { ...actual, isModelDenied: (m: string) => deniedModels.has(m) }
})

const probe = vi.hoisted(() => ({ probeMediaDuration: vi.fn(async (_url?: unknown): Promise<number> => 10) }))
vi.mock("../../../providers/video/ffmpeg-utils.js", async () => {
  const actual = await vi.importActual<typeof import("../../../providers/video/ffmpeg-utils.js")>("../../../providers/video/ffmpeg-utils.js")
  return { ...actual, probeMediaDuration: probe.probeMediaDuration }
})

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
  frames.probeVideoFrames.mockImplementation(async () => ({ frames: 96, width: 1280, height: 720 }))
  sound.probeSoundLengthSec.mockImplementation(async () => 10)
})

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify()
  app.addHook("preHandler", async (req) => {
    ;(req as unknown as { userId: string }).userId = "00000000-0000-4000-8000-000000000001"
  })
  const { aiAvatarRoutes } = await import("../../../routes/ai-avatar.js")
  const { cinematicAvatarRoutes } = await import("../../../routes/cinematic-avatar.js")
  const { switchXRoutes } = await import("../../../routes/switchx.js")
  const { registerNodeQuote } = await import("../node-quote.js")
  await aiAvatarRoutes(app)
  await cinematicAvatarRoutes(app)
  await switchXRoutes(app)
  registerNodeQuote(app)
  return app
}

interface Quote { identifier: string; reserve: number }

/** Quote the body, then run it; returns the quote and what the run reserved. */
async function quoteThenRun(type: string, params: Record<string, unknown>) {
  const app = await buildApp()
  const q = await app.inject({ method: "POST", url: "/v1/quote", payload: { type, params } })
  expect(q.statusCode, q.body).toBe(200)
  const quote = (q.json() as { data: Quote }).data
  expect(reserveSpy).not.toHaveBeenCalled()
  const run = await app.inject({ method: "POST", url: `/v1/${type}`, payload: params })
  expect(run.statusCode, run.body).toBe(200)
  expect(reserveSpy).toHaveBeenCalledTimes(1)
  const [, , identifier, , , options] = reserveSpy.mock.calls[0]! as [string, string, string, number, number, { creditOverride?: number }]
  const { getModelCreditCostFromDB } = await import("../../billing/credits.js")
  const reserved = options?.creditOverride ?? (await getModelCreditCostFromDB(identifier)).creditCost
  await app.close()
  return { quote, identifier, reserved }
}

describe("POST /v1/quote prices AI Avatar, Cinematic Avatar and SwitchX as their runs reserve", () => {
  const AVATAR = { avatarSource: "avatar", engine: "avatar-iv", avatarId: "a1", speechMode: "audio", audioUrl: "https://cdn.example.com/voice.mp3", resolution: "720p" }

  it.each([
    [10, "heygen-avatar-iv:720p:10s"],
    [10.2, "heygen-avatar-iv:720p:15s"],
    [300, "heygen-avatar-iv:720p:360s"],
    [700, "heygen-avatar-iv:720p:600s"],
  ] as const)("AI Avatar in audio mode, audio measured at %s s: the %s bucket, the audio measured as the run measures it", async (sec, id) => {
    sound.probeSoundLengthSec.mockImplementation(async () => sec)
    const { quote, identifier, reserved } = await quoteThenRun("ai-avatar", AVATAR)
    expect(identifier).toBe(id)
    expect(quote).toMatchObject({ identifier, reserve: reserved })
    // The quote measured the audio as the run does: once each.
    expect(sound.probeSoundLengthSec).toHaveBeenCalledTimes(2)
  })

  it("AI Avatar in text mode: the script's bucket, no audio measured", async () => {
    const { quote, identifier, reserved } = await quoteThenRun("ai-avatar", {
      avatarSource: "avatar", engine: "avatar-v", avatarId: "a1", speechMode: "text", script: "x".repeat(600), voiceId: "v1", resolution: "1080p",
    })
    expect(identifier).toBe("heygen-avatar-v:1080p:60s")
    expect(quote).toMatchObject({ identifier, reserve: reserved })
    expect(sound.probeSoundLengthSec).not.toHaveBeenCalled()
  })

  it("AI Avatar whose audio cannot be read: the quote gives the run's own refusal, nothing priced", async () => {
    sound.probeSoundLengthSec.mockImplementation(async () => { throw new Error("no audio stream") })
    const app = await buildApp()
    const q = await app.inject({ method: "POST", url: "/v1/quote", payload: { type: "ai-avatar", params: AVATAR } })
    const run = await app.inject({ method: "POST", url: "/v1/ai-avatar", payload: AVATAR })
    expect(q.statusCode).toBe(400)
    expect(run.statusCode).toBe(400)
    expect(q.json().error).toEqual(run.json().error)
    expect(q.json().error.code).toBe("invalid_media_duration")
    expect(reserveSpy).not.toHaveBeenCalled()
    await app.close()
  })

  it("Cinematic Avatar: its exact (resolution, duration) id", async () => {
    const { quote, identifier, reserved } = await quoteThenRun("cinematic-avatar", {
      prompt: "she smiles and waves", avatarLooks: ["look-1"], duration: 8, resolution: "1080p",
    })
    expect(identifier).toBe("cinematic-avatar:1080p:8s")
    expect(quote).toMatchObject({ identifier, reserve: reserved })
  })

  it("Cinematic Avatar on Auto: the 15 s ceiling", async () => {
    const { quote, identifier } = await quoteThenRun("cinematic-avatar", { prompt: "a short hello", avatarLooks: ["look-1"], autoDuration: true })
    expect(identifier).toBe("cinematic-avatar:720p:15s")
    expect(quote.identifier).toBe(identifier)
  })

  it("SwitchX: the tier of the frames its preflight measures (96 frames: the 120-frame tier), as the run holds it", async () => {
    const { quote, identifier, reserved } = await quoteThenRun("switchx", {
      videoUrl: "https://cdn.example.com/clip.mp4", prompt: "golden hour light", alphaMode: "auto", maxResolution: 720,
    })
    expect(identifier).toBe("beeble-switchx:120f:720p")
    expect(quote).toMatchObject({ identifier, reserve: reserved })
    // The quote measured the clip as the run does: once each.
    expect(frames.probeVideoFrames).toHaveBeenCalledTimes(2)
  })

  it("SwitchX with a link the run refuses: the quote gives the run's 400 and probes nothing", async () => {
    const app = await buildApp()
    const params = { videoUrl: "not a link", prompt: "neon", alphaMode: "auto" }
    const q = await app.inject({ method: "POST", url: "/v1/quote", payload: { type: "switchx", params } })
    const run = await app.inject({ method: "POST", url: "/v1/switchx", payload: params })
    expect(q.statusCode).toBe(400)
    expect(run.statusCode).toBe(400)
    expect(q.json().error.code).toBe("validation_error")
    expect(frames.probeVideoFrames).not.toHaveBeenCalled()
    expect(reserveSpy).not.toHaveBeenCalled()
    await app.close()
  })

  it("SwitchX whose frames cannot be read: the worst-case 240-frame tier, on the quote and the run", async () => {
    frames.probeVideoFrames.mockImplementation(async () => { throw new Error("ffprobe failed") })
    const { quote, identifier } = await quoteThenRun("switchx", { videoUrl: "https://cdn.example.com/clip.mp4", prompt: "neon", alphaMode: "auto" })
    expect(identifier).toBe("beeble-switchx:240f:1080p")
    expect(quote.identifier).toBe(identifier)
  })
})
