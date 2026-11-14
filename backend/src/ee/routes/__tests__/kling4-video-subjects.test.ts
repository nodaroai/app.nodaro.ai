// @test-units-by-name prices only the video run routes it names (text-to-video, generate-video)
import { describe, it, expect, vi, beforeEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"
import { z } from "zod"

/**
 * Video subjects on Kling 4.0 / Kling 4.0 Flash (decided 2026-11-13), through
 * the REAL routes, credit guard and pricing — only the DB, the reservation RPC,
 * the queue and ffprobe are stubbed.
 *
 * A character reference's `videoUrl` (a 3-8 s clip of the character) is seated
 * among the run's reference videos before anything is measured or priced, so:
 *  - quote = hold = charge: POST /v1/quote equals what the run reserves, the
 *    settlement of the delivered run charges that same amount, and all three
 *    equal the same run with the clip sent as a plain reference video (KIE
 *    bills a video subject's seconds as reference-video seconds);
 *  - the job the worker receives carries the seated clip and the character's
 *    `videoUrl`, and the KIE body built from it sends the clip as the
 *    character's element, not as a reference video;
 *  - every refusal is a 400 before the credit check and the reservation.
 */

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

const lengths = vi.hoisted(() => new Map<string, number>())
const probe = vi.hoisted(() => ({
  probeMediaDuration: vi.fn(async (url?: unknown): Promise<number> => {
    const sec = lengths.get(String(url))
    if (sec === undefined) throw new Error("ffprobe exited 1")
    return sec
  }),
}))
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
const checkSpy = vi.hoisted(() => vi.fn(() => Promise.resolve({ allowed: true, watermark: false })))
const jobInsert = vi.hoisted(() => vi.fn())
vi.mock("../../../lib/supabase.js", () => ({
  supabase: {
    from: vi.fn((table: string) => {
      if (table === "profiles") {
        return { select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: fakeProfile, error: null }) }) }) }
      }
      if (table === "jobs") {
        return {
          insert: () => { jobInsert(); return { select: () => ({ single: () => Promise.resolve({ data: { id: "job-1" }, error: null }) }) } },
          upsert: () => { jobInsert(); return { select: () => Promise.resolve({ data: [{ id: "job-1" }], error: null }) } },
          update: () => ({ eq: () => Promise.resolve({ data: null, error: null }) }),
        }
      }
      if (table === "model_pricing") {
        return { select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: null, error: { message: "no row" } }) }) }) }
      }
      return {}
    }),
  },
}))

const reserveSpy = vi.hoisted(() => vi.fn((..._args: unknown[]) => Promise.resolve({ usageLogId: "log-1", creditsReserved: 1, watermark: false })))
vi.mock("../../billing/credits.js", async () => {
  const actual = await vi.importActual<typeof import("../../billing/credits.js")>("../../billing/credits.js")
  return {
    ...actual,
    CreditsService: {
      checkStorageLimitWithProfile: () => ({ allowed: true, usedBytes: 0, limitBytes: 1e10 }),
      checkCreditsWithProfile: checkSpy,
      reserveCredits: reserveSpy,
    },
  }
})
const queueAdd = vi.hoisted(() => vi.fn((..._args: unknown[]) => Promise.resolve({ id: "queue-1" })))
vi.mock("../../../lib/queue.js", () => ({ videoQueue: { add: queueAdd } }))

import { buildKling4Request } from "../../../providers/kie/kling4.js"
import { measureSeedance2Settle } from "../../../lib/seedance2-ref-video-settle.js"
import { resetRefVideoProbeCache } from "../../../lib/ref-video-probe.js"

const CLIP = (n: number) => `https://cdn.example.com/maya-${n}.mp4`
const REF = (n: number) => `https://cdn.example.com/room-${n}.mp4`
const PORTRAIT = "https://cdn.example.com/maya.png"
const OUT = "https://kie.example.com/out.mp4"
const maya = (videoUrl: string | undefined = CLIP(1)) => ({
  imageUrl: PORTRAIT, description: "a woman in a red coat", name: "Maya", ...(videoUrl ? { videoUrl } : {}),
})

beforeEach(() => {
  vi.clearAllMocks()
  resetRefVideoProbeCache()
  lengths.clear()
  for (const n of [1, 2, 3, 4, 5]) {
    lengths.set(CLIP(n), 5)
    lengths.set(REF(n), 6)
  }
  lengths.set(OUT, 5.04)
})

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify()
  app.addHook("preHandler", async (req) => {
    ;(req as unknown as { userId: string }).userId = "00000000-0000-4000-8000-000000000001"
  })
  const { textToVideoRoutes } = await import("../../../routes/text-to-video.js")
  const { generateVideoRoutes } = await import("../../../routes/generate-video.js")
  const { registerNodeQuote } = await import("../node-quote.js")
  await textToVideoRoutes(app)
  await generateVideoRoutes(app)
  registerNodeQuote(app)
  return app
}

/** BASE credits marked up 10%, the platform's integer rounding. */
const mk = (base: number) => Math.ceil((base * 110) / 100)

type Queued = Record<string, unknown> & { referenceVideoUrls?: string[]; refVideoDurationsSec?: number[]; characterReferences?: Array<Record<string, unknown>> }

/** Quote the body, run it, and settle the delivered run as the worker does. */
async function quoteRunSettle(route: "text-to-video" | "generate-video", params: Record<string, unknown>) {
  const app = await buildApp()
  const q = await app.inject({ method: "POST", url: "/v1/quote", payload: { type: route, params } })
  expect(q.statusCode, q.body).toBe(200)
  const quote = (q.json() as { data: { identifier: string; reserve: number } }).data
  expect(reserveSpy).not.toHaveBeenCalled()

  const run = await app.inject({ method: "POST", url: `/v1/${route}`, payload: params })
  expect(run.statusCode, run.body).toBe(200)
  expect(reserveSpy).toHaveBeenCalledTimes(1)
  const [, , identifier, , , options] = reserveSpy.mock.calls[0]! as [string, string, string, number, number, { creditOverride?: number }]
  const queued = queueAdd.mock.calls[0]![1] as Queued
  await app.close()

  // Without a route override the reservation prices the identifier through the
  // same charged lookup `reserveCredits` falls back to.
  const { getModelCreditCostFromDB } = await import("../../billing/credits.js")
  const reserved = options?.creditOverride ?? (await getModelCreditCostFromDB(identifier)).creditCost

  // The settlement, through the core shim every completing lane calls: the
  // delivered clip measured (5.04 s → the 5 s Kling bills), the reference clips
  // from the reservation's own probe and the character references, carried on
  // the job. Nothing measured = the reservation is committed.
  const settle = await measureSeedance2Settle({
    provider: params.provider as string,
    resolution: (params.resolution as string | undefined) ?? "720p",
    outputUrl: OUT,
    referenceVideoUrls: queued.referenceVideoUrls,
    refVideoDurationsSec: queued.refVideoDurationsSec,
    characterReferences: queued.characterReferences,
    duration: params.duration,
    referenceTaskType: undefined,
  })
  return { quote, identifier, reserved, charged: settle.baseCredits === undefined ? reserved : mk(settle.baseCredits), queued }
}

// Decided 2026-11-14, from a measured run: on Kling 4.0 Flash the provider bills
// a video subject like an image subject (no reference-video seconds, no
// reference rate); Kling 4.0 keeps pricing it as a reference video.
describe("quote = hold = charge: Kling 4.0 Flash prices a video subject like an image subject", () => {
  it("a run whose only clip is a character's: the plain kling-4-flash:5s:720p price, as with no clip", async () => {
    const params = { prompt: "Maya walks into the rain", provider: "kling-4-flash", duration: 5, characterReferences: [maya()] }
    const subject = await quoteRunSettle("text-to-video", params)
    expect(subject.identifier).toBe("kling-4-flash:5s:720p")
    // The seeded composite's charged price, not a reference-video base.
    const { getModelCreditCostFromDB } = await import("../../billing/credits.js")
    expect(subject.reserved).toBe((await getModelCreditCostFromDB("kling-4-flash:5s:720p")).creditCost)
    expect(subject.quote.identifier).toBe(subject.identifier)
    expect(subject.quote.reserve).toBe(subject.reserved)
    expect(subject.charged).toBe(subject.reserved)
    // The clip is still seated: measured and held to the caps, just not priced.
    expect(subject.queued.referenceVideoUrls).toEqual([CLIP(1)])

    vi.clearAllMocks()
    const imagesOnly = await quoteRunSettle("text-to-video", { ...params, characterReferences: [maya(undefined)] })
    expect(imagesOnly.identifier).toBe(subject.identifier)
    expect(imagesOnly.reserved).toBe(subject.reserved)
  })

  it("beside a plain reference video: priced on the reference video alone, the subject's seconds adding nothing", async () => {
    const params = { prompt: "@video_1 is the room; Maya crosses it", provider: "kling-4-flash", duration: 5, referenceVideoUrls: [REF(1)], characterReferences: [maya()] }
    lengths.set(REF(1), 9)
    const subject = await quoteRunSettle("text-to-video", params)
    expect(subject.quote.reserve).toBe(subject.reserved)
    expect(subject.charged).toBe(subject.reserved)
    // Flash 720p -ref: 230/8 a second × (5 out + max(5, 9 in)) = 402.5 → 403 base.
    expect(subject.reserved).toBe(mk(Math.ceil((230 / 8) * 14)))
    expect(subject.queued.referenceVideoUrls).toEqual([REF(1), CLIP(1)])
    expect(subject.queued.refVideoDurationsSec).toEqual([9, 5])

    vi.clearAllMocks()
    const noSubject = await quoteRunSettle("text-to-video", { ...params, characterReferences: [maya(undefined)] })
    expect(noSubject.reserved).toBe(subject.reserved)
  })
})

describe("Kling 4.0 Flash: the same clip wired as a reference video AND as the character's video", () => {
  it("goes to the model as the character only, so it is quoted, held and charged at the plain price", async () => {
    const params = { prompt: "Maya walks into the rain", provider: "kling-4-flash", duration: 5, referenceVideoUrls: [CLIP(1)], characterReferences: [maya()] }
    const twice = await quoteRunSettle("text-to-video", params)
    expect(twice.identifier).toBe("kling-4-flash:5s:720p")
    expect(twice.quote.reserve).toBe(twice.reserved)
    expect(twice.charged).toBe(twice.reserved)
    const { getModelCreditCostFromDB } = await import("../../billing/credits.js")
    expect(twice.reserved).toBe((await getModelCreditCostFromDB("kling-4-flash:5s:720p")).creditCost)
    expect(twice.queued.referenceVideoUrls).toEqual([CLIP(1)])
  })
})

describe("quote = hold = charge: Kling 4.0 prices a video subject as a reference video", () => {
  it("a run whose only clip is a character's: the reference rate on the clip's seconds", async () => {
    const params = { prompt: "Maya walks into the rain", provider: "kling-4", duration: 5, resolution: "720p", characterReferences: [maya()] }
    const subject = await quoteRunSettle("text-to-video", params)
    expect(subject.identifier).toMatch(/-ref$/)
    expect(subject.quote.reserve).toBe(subject.reserved)
    expect(subject.charged).toBe(subject.reserved)
    // 720p -ref: 340/8 a second × (5 out + max(5, 5 in)) = 425 base.
    expect(subject.reserved).toBe(mk(Math.ceil((340 / 8) * 10)))

    vi.clearAllMocks()
    const plain = await quoteRunSettle("text-to-video", { ...params, characterReferences: [maya(undefined)], referenceVideoUrls: [CLIP(1)] })
    expect(plain.reserved).toBe(subject.reserved)
    expect(plain.identifier).toBe(subject.identifier)
  })

  it("Kling 4.0 with a reference video and a character's clip (generate-video)", async () => {
    const params = {
      prompt: "@video_1 is the room; Maya crosses it", provider: "kling-4", duration: 5, resolution: "720p",
      imageUrl: "https://cdn.example.com/start.png", referenceVideoUrls: [REF(1)], characterReferences: [maya()],
    }
    const subject = await quoteRunSettle("generate-video", params)
    expect(subject.quote.reserve).toBe(subject.reserved)
    expect(subject.charged).toBe(subject.reserved)
    // 720p -ref: 340/8 a second × (5 out + max(5, 6 + 5 in)) = 680 base.
    expect(subject.reserved).toBe(mk(Math.ceil((340 / 8) * 16)))
    expect(subject.queued.referenceVideoUrls).toEqual([REF(1), CLIP(1)])
    expect(subject.queued.refVideoDurationsSec).toEqual([6, 5])
  })
})

describe("the job the worker receives, and the KIE body built from it", () => {
  it("text-to-video on Flash: the clip is seated and the character keeps its videoUrl; KIE gets a video element", async () => {
    const { queued } = await quoteRunSettle("text-to-video", {
      prompt: "Maya walks into the rain", provider: "kling-4-flash", duration: 5,
      referenceAudioUrls: ["https://cdn.example.com/voice.mp3"], characterReferences: [maya()],
    })
    expect(queued.referenceVideoUrls).toEqual([CLIP(1)])
    expect(queued.characterReferences?.[0]).toMatchObject({ name: "Maya", videoUrl: CLIP(1) })
    const { input } = buildKling4Request({
      provider: "kling-4-flash",
      prompt: queued.prompt as string,
      durationSec: 5,
      referenceVideoUrls: queued.referenceVideoUrls,
      referenceAudioUrls: queued.referenceAudioUrls as string[],
      characterReferences: queued.characterReferences as never,
    })
    expect(input.video_urls).toBeUndefined()
    expect(input.elements).toEqual([
      { name: "Maya", video_url: CLIP(1), type: "video", tag: "character", description: "a woman in a red coat", voice_url: "https://cdn.example.com/voice.mp3" },
    ])
  })

  it("generate-video on Kling 4.0: the reference video stays @video_1; the character is its own element without a type", async () => {
    const { queued } = await quoteRunSettle("generate-video", {
      prompt: "@video_1 is the room; Maya crosses it", provider: "kling-4", duration: 5, resolution: "720p",
      imageUrl: "https://cdn.example.com/start.png", referenceVideoUrls: [REF(1)], characterReferences: [maya()],
    })
    const { input } = buildKling4Request({
      provider: "kling-4",
      prompt: queued.prompt as string,
      durationSec: 5,
      startFrameUrl: queued.imageUrl as string,
      referenceImageUrls: queued.referenceImageUrls as string[] | undefined,
      referenceVideoUrls: queued.referenceVideoUrls,
      characterReferences: queued.characterReferences as never,
    })
    expect(input.video_urls).toEqual([REF(1)])
    expect(input.elements).toEqual([{ name: "Maya", video_url: CLIP(1), tag: "character", description: "a woman in a red coat" }])
    expect(String(input.prompt)).toContain("@video_1 is the room")
  })
})

describe("refused with a 400 before the credit check, the job and the reservation", () => {
  async function refused(route: "text-to-video" | "generate-video", params: Record<string, unknown>) {
    const app = await buildApp()
    const res = await app.inject({ method: "POST", url: `/v1/${route}`, payload: params })
    await app.close()
    expect(res.statusCode, res.body).toBe(400)
    expect(checkSpy).not.toHaveBeenCalled()
    expect(reserveSpy).not.toHaveBeenCalled()
    expect(jobInsert).not.toHaveBeenCalled()
    expect(queueAdd).not.toHaveBeenCalled()
    return res.json().error as { code: string; message: string }
  }
  const t2v = (over: Record<string, unknown>) => ({ prompt: "Maya walks into the rain", provider: "kling-4-flash", duration: 5, ...over })

  it("a model that takes no video subjects (nothing measured)", async () => {
    const err = await refused("text-to-video", t2v({ provider: "gemini-omni-video", characterReferences: [maya()] }))
    expect(err.code).toBe("character_video_unsupported")
    expect(probe.probeMediaDuration).not.toHaveBeenCalled()
  })

  it("more than 3 characters made from a video", async () => {
    const characters = [1, 2, 3, 4].map((n) => ({ ...maya(CLIP(n)), name: `C${n}` }))
    expect((await refused("text-to-video", t2v({ characterReferences: characters }))).code).toBe("character_videos_over_limit")
  })

  it("two characters on the same clip", async () => {
    expect((await refused("text-to-video", t2v({ characterReferences: [maya(), { ...maya(), name: "Noa" }] }))).code).toBe("character_video_shared")
  })

  it("reference videos and clips past 5 (nothing measured)", async () => {
    const err = await refused("text-to-video", t2v({ referenceVideoUrls: [1, 2, 3, 4, 5].map(REF), characterReferences: [maya()] }))
    expect(err.code).toBe("reference_videos_over_limit")
    expect(probe.probeMediaDuration).not.toHaveBeenCalled()
  })

  it("a clip URL the route's URL rule refuses", async () => {
    expect((await refused("text-to-video", t2v({ characterReferences: [maya("not a url")] }))).code).toBe("validation_error")
    expect(probe.probeMediaDuration).not.toHaveBeenCalled()
  })

  it("a clip measured longer than 8 s, or shorter than 3 s — on both routes", async () => {
    lengths.set(CLIP(1), 12.4)
    const long = await refused("text-to-video", t2v({ characterReferences: [maya()] }))
    expect(long.code).toBe("video_too_long")
    expect(long.message).toContain("between 3 and 8 seconds")
    expect(long.message).toContain("one is 12.40 s")
    lengths.set(CLIP(1), 2.2)
    vi.clearAllMocks()
    const short = await refused("generate-video", { ...t2v({ characterReferences: [maya()] }), provider: "kling-4", imageUrl: "https://cdn.example.com/start.png" })
    expect(short.message).toContain("one is 2.20 s")
  })

  // Decided 2026-11-13: a character's clip must be measured; a reference video's need not.
  it("a character's clip the probe cannot read — while an unreadable plain reference video still runs", async () => {
    lengths.delete(CLIP(1))
    const err = await refused("text-to-video", t2v({ characterReferences: [maya()] }))
    expect(err.code).toBe("character_video_unreadable")
    vi.clearAllMocks()
    const app = await buildApp()
    const res = await app.inject({ method: "POST", url: "/v1/text-to-video", payload: t2v({ referenceVideoUrls: [CLIP(1)] }) })
    await app.close()
    expect(res.statusCode, res.body).toBe(200)
    expect(reserveSpy).toHaveBeenCalledTimes(1)
  })

  // Decided 2026-11-13: a 6th video is refused, never dropped without a word.
  it("6 plain reference videos on Kling 4.0 and on Flash, on both routes (nothing measured)", async () => {
    const six = [1, 2, 3, 4, 5].map(REF).concat([CLIP(1)])
    for (const [route, provider] of [["text-to-video", "kling-4"], ["text-to-video", "kling-4-flash"], ["generate-video", "kling-4"], ["generate-video", "kling-4-flash"]] as const) {
      vi.clearAllMocks()
      const err = await refused(route, { ...t2v({ provider, referenceVideoUrls: six }), ...(route === "generate-video" ? { imageUrl: "https://cdn.example.com/start.png" } : {}) })
      expect(err.code, `${route} ${provider}`).toBe("reference_videos_over_limit")
      expect(err.message).toContain("This run has 6")
      expect(probe.probeMediaDuration).not.toHaveBeenCalled()
    }
  })

  it("the shared 20 s total on Flash counts the character's clip", async () => {
    lengths.set(REF(1), 16)
    const err = await refused("text-to-video", t2v({ referenceVideoUrls: [REF(1)], characterReferences: [maya()] }))
    expect(err.code).toBe("video_too_long")
    expect(err.message).toContain("20 seconds in total")
  })
})

describe("the 15-material budget counts a video subject once", () => {
  const images = Array.from({ length: 9 }, (_, i) => `https://cdn.example.com/img-${i}.png`)
  /** 9 images + the portrait's seat + 4 reference videos + the clip's seat + `voices` voice clips. */
  const body = (voices: number) => ({
    prompt: "Maya in the gallery", provider: "kling-4", duration: 5,
    referenceImageUrls: [...images, PORTRAIT],
    referenceVideoUrls: [1, 2, 3, 4].map(REF),
    referenceAudioUrls: Array.from({ length: voices }, (_, i) => `https://cdn.example.com/voice-${i}.mp3`),
    characterReferences: [maya()],
    audioSoundtrack: false,
  })

  it("Kling 4.0: with 1 voice clip that is 15 materials, not 16 — it runs", async () => {
    const app = await buildApp()
    const res = await app.inject({ method: "POST", url: "/v1/text-to-video", payload: body(1) })
    await app.close()
    expect(res.statusCode, res.body).toBe(200)
  })

  it("Kling 4.0: with 2 voice clips that is 16 materials — refused before anything is reserved", async () => {
    const app = await buildApp()
    const res = await app.inject({ method: "POST", url: "/v1/text-to-video", payload: body(2) })
    await app.close()
    expect(res.statusCode, res.body).toBe(400)
    expect(res.json().error.code).toBe("character_references_quota")
    expect(res.json().error.message).toContain("This request uses 16")
    expect(reserveSpy).not.toHaveBeenCalled()
    expect(jobInsert).not.toHaveBeenCalled()
  })
})
