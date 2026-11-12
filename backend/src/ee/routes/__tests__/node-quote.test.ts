// @test-units-by-name prices only the video run routes it names (text-to-video, generate-video, video-to-video, video-upscale), and lists the quotable types (split-into-layers among them)
import { describe, it, expect, vi, beforeEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"
import { z } from "zod"

// The real credit guard, the real routes and the real pricing — only the
// edges are stubbed: the DB, the reservation RPC, the queue and ffprobe. Each
// case sends ONE body twice: to POST /v1/quote, then to the run route, and the
// quote must equal what the run reserved. No generation runs.

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

beforeEach(() => { vi.clearAllMocks() })

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify()
  app.addHook("preHandler", async (req) => {
    ;(req as unknown as { userId: string }).userId = "00000000-0000-4000-8000-000000000001"
  })
  const { textToVideoRoutes } = await import("../../../routes/text-to-video.js")
  const { generateVideoRoutes } = await import("../../../routes/generate-video.js")
  const { videoToVideoRoutes } = await import("../../../routes/video-to-video.js")
  const { registerNodeQuote } = await import("../node-quote.js")
  await textToVideoRoutes(app)
  await generateVideoRoutes(app)
  await videoToVideoRoutes(app)
  registerNodeQuote(app)
  return app
}

/** BASE credits marked up 10%, the platform's integer rounding. */
const mk = (base: number) => Math.ceil((base * 110) / 100)

interface Quote { identifier: string; reserve: number; expected?: number; adjustments: { code: string }[]; warnings: { code: string }[] }

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
  // Without a route override the reservation prices the identifier through
  // the same charged lookup `reserveCredits` falls back to.
  const { getModelCreditCostFromDB } = await import("../../billing/credits.js")
  const reserved = options?.creditOverride ?? (await getModelCreditCostFromDB(identifier)).creditCost
  await app.close()
  return { quote, identifier, reserved }
}

const CLIP = "https://cdn.example.com/clip.mp4"

describe("POST /v1/quote equals what the run reserves on the same body", () => {
  it("Seedance with a reference video", async () => {
    const { quote, identifier, reserved } = await quoteThenRun("text-to-video", {
      prompt: "a fox runs through snow", provider: "seedance-2-5", resolution: "480p", duration: 5,
      referenceVideoUrls: [CLIP],
    })
    expect(quote.identifier).toBe(identifier)
    expect(quote.reserve).toBe(reserved)
    // 480p -ref is 42.5 base a second: input 10s + output max(5, 10s) = 850 base.
    expect(quote.reserve).toBe(mk(850))
    // A style run is expected to render the 5s it asked for: 10 + 5 = 638 base.
    expect(quote.expected).toBe(mk(Math.ceil(42.5 * 15)))
    expect(quote.adjustments.map((a) => a.code)).toContain("ref_video_length")
    expect(quote.warnings.map((w) => w.code)).toContain("settles_to_actual")
  })

  it("MiniMax Hailuo 3 with more than 5 reference images", async () => {
    const images = Array.from({ length: 7 }, (_, i) => `https://cdn.example.com/ref-${i}.png`)
    const { quote, identifier, reserved } = await quoteThenRun("text-to-video", {
      prompt: "a product turntable", provider: "minimax-h3", referenceImageUrls: images,
    })
    expect(quote.identifier).toBe(identifier)
    expect(quote.reserve).toBe(reserved)
    expect(quote.adjustments.map((a) => a.code)).toContain("extra_reference_images")
    expect(quote.expected).toBeUndefined()
  })

  it("a Seedance edit (duration -1): reserves the worst case, expects the clip's own length", async () => {
    const { quote, identifier, reserved } = await quoteThenRun("text-to-video", {
      prompt: "edit {video:1} as follows:\nmake it black and white",
      provider: "seedance-2-5", resolution: "480p", duration: -1, aspectRatio: "adaptive",
      referenceVideoUrls: [CLIP],
    })
    expect(quote.identifier).toBe(identifier)
    expect(quote.reserve).toBe(reserved)
    // An edit renders the 10s source: input 10 + output 10.
    expect(quote.expected).toBe(mk(Math.ceil(42.5 * 20)))
    expect(quote.expected!).toBeLessThan(quote.reserve)
  })

  it("outputFormat never moves the price: a Seedance edit quotes and reserves the same with mov", async () => {
    const edit = {
      prompt: "edit {video:1} as follows:\nmake it black and white",
      provider: "seedance-2-5", resolution: "480p", duration: -1, aspectRatio: "adaptive",
      referenceVideoUrls: [CLIP],
    }
    const plain = await quoteThenRun("text-to-video", edit)
    vi.clearAllMocks()
    const mov = await quoteThenRun("text-to-video", { ...edit, outputFormat: "mov" })
    expect(mov.identifier).toBe(plain.identifier)
    expect(mov.reserved).toBe(plain.reserved)
    expect(mov.quote.reserve).toBe(plain.quote.reserve)
    expect(mov.quote.expected).toBe(plain.quote.expected)
  })

  it("a plain text-to-video run", async () => {
    const { quote, identifier, reserved } = await quoteThenRun("text-to-video", { prompt: "a quiet street at dawn" })
    expect(quote.identifier).toBe(identifier)
    expect(quote.reserve).toBe(reserved)
    expect(probe.probeMediaDuration).not.toHaveBeenCalled()
  })

  it("generate-video with a reference video", async () => {
    const { quote, identifier, reserved } = await quoteThenRun("generate-video", {
      prompt: "she turns to camera", provider: "seedance-2-5", resolution: "480p", duration: 5,
      referenceVideoUrls: [CLIP],
    })
    expect(quote.identifier).toBe(identifier)
    expect(quote.reserve).toBe(reserved)
  })

  // `grok` is Grok Imagine's text-to-video id; /v1/generate-video runs it as
  // `grok-i2v` (`imageToVideoModelPreHandler`), and the quote prices that id too.
  it.each(["grok", "grok-i2v"])("generate-video naming %s is quoted and reserved as grok-i2v", async (provider) => {
    const { quote, identifier, reserved } = await quoteThenRun("generate-video", {
      prompt: "the waves roll in", provider, imageUrl: "https://cdn.example.com/start.png", duration: 6,
    })
    expect(quote.identifier).toBe(identifier)
    expect(quote.reserve).toBe(reserved)
    expect(identifier).toMatch(/^grok-i2v(:|$)/)
  })

  it("video-to-video (a flat per-model price)", async () => {
    const { quote, identifier, reserved } = await quoteThenRun("video-to-video", {
      videoUrl: CLIP, prompt: "make it noir", provider: "luma-modify",
    })
    expect(quote).toMatchObject({ identifier: "luma-modify", reserve: reserved, adjustments: [], warnings: [] })
    expect(identifier).toBe("luma-modify")
  })
})

// One body for every edit model: a Seedance edit sent to /v1/video-to-video is
// rewritten server-side into the Seedance reference-lane body the canvas node
// and MCP send, and priced and run by that lane.
describe("/v1/video-to-video with a Seedance edit model", () => {
  const EDIT = { videoUrl: CLIP, prompt: "make it black and white", provider: "seedance-2-5", resolution: "480p" }

  it("is priced under the edit credit id, by the clip, and the quote equals the reservation", async () => {
    const { seedanceVideoEditCreditId } = await import("@nodaro/shared/credits")
    const { quote, identifier, reserved } = await quoteThenRun("video-to-video", EDIT)
    expect(identifier).toBe(seedanceVideoEditCreditId("seedance-2-5", "480p"))
    expect(quote.identifier).toBe(identifier)
    expect(quote.reserve).toBe(reserved)
    expect(quote.expected).toBe(mk(Math.ceil(42.5 * 20)))
  })

  it("runs on the reference lane with the edit shape — the same job the text-to-video edit makes", async () => {
    const { videoQueue } = await import("../../../lib/queue.js")
    const app = await buildApp()
    const res = await app.inject({ method: "POST", url: "/v1/video-to-video", payload: { ...EDIT, audio: true, referenceImageUrl: "https://cdn.example.com/hat.png" } })
    expect(res.statusCode, res.body).toBe(200)
    const [name, payload] = vi.mocked(videoQueue.add).mock.calls.at(-1)! as [string, Record<string, unknown>]
    expect(name).toBe("text-to-video")
    expect(payload).toMatchObject({
      provider: "seedance-2-5",
      prompt: "edit @video_1 as follows:\nmake it black and white",
      duration: -1,
      aspectRatio: "adaptive",
      referenceVideoUrls: [CLIP],
      referenceImageUrls: ["https://cdn.example.com/hat.png"],
      generateAudio: true,
    })
    await app.close()
  })

  // The route REQUESTS the edit task type; the reference lane resolves it on the
  // clip's measured length, so a clip outside 4–30 s goes out undeclared.
  /** The job one edit request queues, and what it reserved. */
  async function queuedEdit(payload: Record<string, unknown>) {
    const { videoQueue } = await import("../../../lib/queue.js")
    const app = await buildApp()
    const res = await app.inject({ method: "POST", url: "/v1/video-to-video", payload })
    expect(res.statusCode, res.body).toBe(200)
    const [name, queued] = vi.mocked(videoQueue.add).mock.calls.at(-1)! as [string, Record<string, unknown>]
    expect(name).toBe("text-to-video")
    expect(reserveSpy).toHaveBeenCalledTimes(1)
    const [, , identifier, , , options] = reserveSpy.mock.calls[0]! as [string, string, string, number, number, { creditOverride?: number }]
    await app.close()
    return { queued, identifier, creditOverride: options?.creditOverride }
  }

  it("declares the edit task type for a 6 s clip, at the same price as without it", async () => {
    probe.probeMediaDuration.mockImplementation(async () => 6)
    try {
      const { queued, identifier, creditOverride } = await queuedEdit(EDIT)
      expect(queued).toMatchObject({ provider: "seedance-2-5", referenceTaskType: "edit", aspectRatio: "adaptive", duration: -1, referenceVideoUrls: [CLIP] })
      const { seedanceVideoEditCreditId } = await import("@nodaro/shared/credits")
      expect(identifier).toBe(seedanceVideoEditCreditId("seedance-2-5", "480p"))
      // The same edit sent straight to the reference lane, undeclared, reserves the same.
      vi.clearAllMocks()
      const app = await buildApp()
      const plain = await app.inject({
        method: "POST", url: "/v1/text-to-video",
        payload: { prompt: "edit {video:1} as follows:\nmake it black and white", provider: "seedance-2-5", resolution: "480p", duration: -1, aspectRatio: "adaptive", referenceVideoUrls: [CLIP] },
      })
      expect(plain.statusCode, plain.body).toBe(200)
      const [, , plainId, , , plainOptions] = reserveSpy.mock.calls[0]! as [string, string, string, number, number, { creditOverride?: number }]
      await app.close()
      expect(identifier).toBe(plainId)
      expect(creditOverride).toBe(plainOptions?.creditOverride)
    } finally {
      probe.probeMediaDuration.mockImplementation(async () => 10)
    }
  })

  it("queues a 3 s clip's edit without the task type, and otherwise unchanged", async () => {
    probe.probeMediaDuration.mockImplementation(async () => 3)
    try {
      const { queued } = await queuedEdit(EDIT)
      expect(queued).not.toHaveProperty("referenceTaskType")
      expect(queued).toMatchObject({ provider: "seedance-2-5", aspectRatio: "adaptive", duration: -1, referenceVideoUrls: [CLIP], refVideoDurationsSec: [3] })
    } finally {
      probe.probeMediaDuration.mockImplementation(async () => 10)
    }
  })

  it("an edit always requests the edit task type: a caller's own referenceTaskType does not turn it into an extension", async () => {
    probe.probeMediaDuration.mockImplementation(async () => 6)
    try {
      const { queued } = await queuedEdit({ ...EDIT, referenceTaskType: "extend" })
      expect(queued).toMatchObject({ referenceTaskType: "edit", aspectRatio: "adaptive", duration: -1 })
    } finally {
      probe.probeMediaDuration.mockImplementation(async () => 10)
    }
  })

  it("a model of the route's own queues no task type", async () => {
    const { videoQueue } = await import("../../../lib/queue.js")
    const app = await buildApp()
    const res = await app.inject({ method: "POST", url: "/v1/video-to-video", payload: { videoUrl: CLIP, prompt: "make it noir", provider: "luma-modify" } })
    expect(res.statusCode, res.body).toBe(200)
    const [name, queued] = vi.mocked(videoQueue.add).mock.calls.at(-1)! as [string, Record<string, unknown>]
    expect(name).toBe("video-to-video")
    expect(queued).not.toHaveProperty("referenceTaskType")
    await app.close()
  })

  const CLIP2 = "https://cdn.example.com/sky.mp4"
  const HAT = "https://cdn.example.com/hat.png"
  const COAT = "https://cdn.example.com/coat.png"
  const SONG = "https://cdn.example.com/song.mp3"

  it("takes every reference: extra clips after the source, images after referenceImageUrl, audio as sent", async () => {
    const { videoQueue } = await import("../../../lib/queue.js")
    const app = await buildApp()
    const res = await app.inject({
      method: "POST", url: "/v1/video-to-video",
      payload: {
        ...EDIT,
        prompt: "put the sky of {video:2} behind her, the hat of {image:1} and the coat of {image:2} on her, to the beat of {audio:1}, like {video:5}",
        referenceImageUrl: HAT, referenceImageUrls: [COAT], referenceVideoUrls: [CLIP2], referenceAudioUrls: [SONG],
      },
    })
    expect(res.statusCode, res.body).toBe(200)
    const [name, payload] = vi.mocked(videoQueue.add).mock.calls.at(-1)! as [string, Record<string, unknown>]
    expect(name).toBe("text-to-video")
    expect(payload).toMatchObject({
      referenceVideoUrls: [CLIP, CLIP2],
      referenceImageUrls: [HAT, COAT],
      referenceAudioUrls: [SONG],
    })
    // The source stays @video_1; the extras number on from it; an
    // out-of-range token degrades to its label (nothing, unlabelled).
    expect(payload.prompt).toBe(
      "edit @video_1 as follows:\nput the sky of @video_2 behind her, the hat of @image_1 and the coat of @image_2 on her, to the beat of @audio_1, like",
    )
    await app.close()
  })

  it("quotes an edit with extra clips and images at exactly what the run reserves, expecting the SOURCE clip's length", async () => {
    // The extra clip is longer than the source: an edit still renders the source.
    probe.probeMediaDuration.mockImplementation(async (url: unknown) => (url === CLIP2 ? 12 : 10))
    try {
      const { quote, reserved } = await quoteThenRun("video-to-video", {
        ...EDIT, referenceImageUrl: HAT, referenceImageUrls: [COAT], referenceVideoUrls: [CLIP2],
      })
      expect(quote.reserve).toBe(reserved)
      // Reserved for the LONGEST clip, the extra one (the model may edit it): input 10 + 12, output 12 + 1 s.
      expect(reserved).toBe(mk(Math.ceil(42.5 * (22 + 13))))
      // input 10 + 12, output the source's 10 s
      expect(quote.expected).toBe(mk(Math.ceil(42.5 * 32)))
    } finally {
      probe.probeMediaDuration.mockImplementation(async () => 10)
    }
  })

  it("refuses the reference lists on a model that is not a Seedance edit", async () => {
    const app = await buildApp()
    for (const extra of [{ referenceImageUrls: [HAT] }, { referenceVideoUrls: [CLIP2] }, { referenceAudioUrls: [SONG] }]) {
      const res = await app.inject({ method: "POST", url: "/v1/video-to-video", payload: { videoUrl: CLIP, provider: "wan", prompt: "x", ...extra } })
      expect(res.statusCode, JSON.stringify(extra)).toBe(400)
    }
    expect(reserveSpy).not.toHaveBeenCalled()
    await app.close()
  })

  it("leaves the lane's own caps in charge — on the run AND the quote: the source counts as one of the videos", async () => {
    const { SEEDANCE_2_5_REF_LIMITS: CAP } = await import("@nodaro/shared/models")
    const many = (n: number, ext: string) => Array.from({ length: n }, (_, i) => `https://cdn.example.com/r${i}.${ext}`)
    const app = await buildApp()
    const overCap = [
      { referenceVideoUrls: many(CAP.videos, "mp4") },
      { referenceImageUrl: HAT, referenceImageUrls: many(CAP.images, "png") },
      { referenceAudioUrls: many(CAP.audio + 1, "mp3") },
    ]
    for (const extra of overCap) {
      const run = await app.inject({ method: "POST", url: "/v1/video-to-video", payload: { ...EDIT, ...extra } })
      expect(run.statusCode, `run ${Object.keys(extra).join()}`).toBe(400)
      const quote = await app.inject({ method: "POST", url: "/v1/quote", payload: { type: "video-to-video", params: { ...EDIT, ...extra } } })
      expect(quote.statusCode, `quote ${Object.keys(extra).join()}`).toBe(400)
    }
    // At each cap is fine (ten 3 s clips, inside the model's 30 s total).
    probe.probeMediaDuration.mockImplementation(async () => 3)
    const atCap = await app.inject({
      method: "POST", url: "/v1/quote",
      payload: { type: "video-to-video", params: { ...EDIT, referenceVideoUrls: many(CAP.videos - 1, "mp4"), referenceImageUrl: HAT, referenceImageUrls: many(CAP.images - 1, "png"), referenceAudioUrls: many(CAP.audio, "mp3") } },
    })
    probe.probeMediaDuration.mockImplementation(async () => 10)
    expect(atCap.statusCode, atCap.body).toBe(200)
    expect(reserveSpy).not.toHaveBeenCalled()
    await app.close()
  })

  it("refuses an over-long reference audio before anything is reserved — run and quote", async () => {
    probe.probeMediaDuration.mockImplementation(async (url: unknown) => (url === SONG ? 60 : 10))
    try {
      const app = await buildApp()
      const body = { ...EDIT, referenceAudioUrls: [SONG] }
      const run = await app.inject({ method: "POST", url: "/v1/video-to-video", payload: body })
      expect(run.statusCode, run.body).toBe(400)
      const quote = await app.inject({ method: "POST", url: "/v1/quote", payload: { type: "video-to-video", params: body } })
      expect(quote.statusCode, quote.body).toBe(400)
      expect(quote.json().error.code).toBe(run.json().error.code)
      expect(reserveSpy).not.toHaveBeenCalled()
      await app.close()
    } finally {
      probe.probeMediaDuration.mockImplementation(async () => 10)
    }
  })

  it("refuses an edit with no instruction before anything is reserved", async () => {
    const app = await buildApp()
    const res = await app.inject({ method: "POST", url: "/v1/video-to-video", payload: { videoUrl: CLIP, provider: "seedance-2-5", prompt: "  " } })
    expect(res.statusCode).toBe(400)
    expect(reserveSpy).not.toHaveBeenCalled()
    await app.close()
  })

  it("keeps 480p for the Seedance edit models only", async () => {
    const app = await buildApp()
    const res = await app.inject({ method: "POST", url: "/v1/video-to-video", payload: { videoUrl: CLIP, provider: "wan", resolution: "480p" } })
    expect(res.statusCode).toBe(400)
    expect(reserveSpy).not.toHaveBeenCalled()
    await app.close()
  })
})

describe("POST /v1/quote refusals", () => {
  it("answers an invalid body with the run's own 400 and reserves nothing", async () => {
    const app = await buildApp()
    const res = await app.inject({ method: "POST", url: "/v1/quote", payload: { type: "video-to-video", params: { prompt: "no clip" } } })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
    expect(reserveSpy).not.toHaveBeenCalled()
    await app.close()
  })

  it("refuses a model this deployment does not offer, as the run does", async () => {
    const app = await buildApp()
    const res = await app.inject({ method: "POST", url: "/v1/quote", payload: { type: "video-to-video", params: { videoUrl: CLIP, provider: "runway-aleph" } } })
    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe("model_not_available")
    await app.close()
  })

  it("refuses a body that names no model when the default it would run is withheld — run and quote alike, and only where models are restricted", async () => {
    const { DEFAULT_VIDEO_PROVIDER } = await import("@nodaro/shared/models")
    const { __resetSurfaceProfileCacheForTests } = await import("../../../lib/surface-profile.js")
    const params = { prompt: "a fox runs through snow" }
    deniedModels.add(DEFAULT_VIDEO_PROVIDER)
    try {
      // No restriction configured: the run model is never asked, so nothing changes.
      const open = await buildApp()
      expect((await open.inject({ method: "POST", url: "/v1/quote", payload: { type: "text-to-video", params } })).statusCode).toBe(200)
      await open.close()

      process.env.NODARO_SURFACE_PROFILE = JSON.stringify({ models: { deny: ["runway-aleph"] } })
      __resetSurfaceProfileCacheForTests()
      const app = await buildApp()
      for (const [url, payload] of [["/v1/quote", { type: "text-to-video", params }], ["/v1/text-to-video", params]] as const) {
        const res = await app.inject({ method: "POST", url, payload })
        expect(res.statusCode, url).toBe(403)
        expect(res.json().error.code).toBe("model_not_available")
        expect(res.json().error.message).toContain(DEFAULT_VIDEO_PROVIDER)
      }
      expect(reserveSpy).not.toHaveBeenCalled()
      await app.close()
    } finally {
      deniedModels.delete(DEFAULT_VIDEO_PROVIDER)
      delete process.env.NODARO_SURFACE_PROFILE
      __resetSurfaceProfileCacheForTests()
    }
  })

  it("answers a house model this deployment does not serve as the run does: the same 403 every refused model gets, in the route's own sentence", async () => {
    // The real surface-deny denies an unserved house model; this stub's set stands in for it.
    deniedModels.add("nodaro-video-upscale")
    try {
      const app = await buildApp()
      const { videoUpscaleRoutes } = await import("../../../routes/video-upscale.js")
      await videoUpscaleRoutes(app)
      const params = { videoUrl: CLIP, provider: "nodaro-video-upscale", targetResolution: "2k" }
      const quote = await app.inject({ method: "POST", url: "/v1/quote", payload: { type: "video-upscale", params } })
      const run = await app.inject({ method: "POST", url: "/v1/video-upscale", payload: params })
      expect(quote.statusCode).toBe(403)
      expect(quote.json().error).toEqual({
        code: "model_not_available",
        message: "Nodaro Video Upscale is not available on this server. Choose Topaz to upscale this clip. You were not charged.",
      })
      expect(run.statusCode).toBe(403)
      expect(run.json().error).toEqual(quote.json().error)
      expect(reserveSpy).not.toHaveBeenCalled()
      await app.close()
    } finally {
      deniedModels.delete("nodaro-video-upscale")
    }
  })

  it("answers an unserved house model with no usable link as the run does too: the guard's 403, never the body's 400", async () => {
    deniedModels.add("nodaro-video-upscale")
    try {
      const app = await buildApp()
      const { videoUpscaleRoutes } = await import("../../../routes/video-upscale.js")
      await videoUpscaleRoutes(app)
      for (const params of [{ provider: "nodaro-video-upscale" }, { provider: "nodaro-video-upscale", videoUrl: "not a link" }]) {
        const quote = await app.inject({ method: "POST", url: "/v1/quote", payload: { type: "video-upscale", params } })
        const run = await app.inject({ method: "POST", url: "/v1/video-upscale", payload: params })
        expect(quote.statusCode, JSON.stringify(params)).toBe(403)
        expect(quote.json().error.code).toBe("model_not_available")
        expect(run.statusCode, JSON.stringify(params)).toBe(403)
        expect(run.json().error).toEqual(quote.json().error)
      }
      expect(reserveSpy).not.toHaveBeenCalled()
      await app.close()
    } finally {
      deniedModels.delete("nodaro-video-upscale")
    }
  })

  it("names the quotable types for one it cannot price", async () => {
    const app = await buildApp()
    const res = await app.inject({ method: "POST", url: "/v1/quote", payload: { type: "generate-music", params: {} } })
    expect(res.statusCode).toBe(400)
    // The hand-written rows, then each node unit with a quote.ts.
    expect(res.json().error).toMatchObject({ code: "quote_unsupported", supported: ["text-to-video", "generate-video", "video-to-video", "video-upscale", "edit-image", "split-into-layers"] })
    await app.close()
  })

  it("answers an over-long reference clip with the run's 400 video_too_long", async () => {
    probe.probeMediaDuration.mockResolvedValue(45)
    const app = await buildApp()
    const res = await app.inject({
      method: "POST", url: "/v1/quote",
      payload: { type: "text-to-video", params: { prompt: "x", provider: "seedance-2-5", referenceVideoUrls: [CLIP] } },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("video_too_long")
    await app.close()
    probe.probeMediaDuration.mockResolvedValue(10)
  })
})

describe("a declared edit with several reference videos", () => {
  const SHORT = "https://cdn.example.com/short.mp4"
  const LONG = "https://cdn.example.com/long.mp4"

  it("reserves its automatic length for the longest clip: [5, 25] holds 26 s, and the quote equals the reservation", async () => {
    probe.probeMediaDuration.mockImplementation(async (url: unknown) => (url === LONG ? 25 : 5))
    try {
      const params = {
        prompt: "make it night", provider: "seedance-2-5", resolution: "480p", aspectRatio: "16:9", duration: 8,
        referenceVideoUrls: [SHORT, LONG], referenceTaskType: "edit",
      }
      const { quote, reserved } = await quoteThenRun("text-to-video", params)
      const { videoQueue } = await import("../../../lib/queue.js")
      const [, queued] = vi.mocked(videoQueue.add).mock.calls.at(-1)! as [string, Record<string, unknown>]
      expect(queued).toMatchObject({ referenceTaskType: "edit", aspectRatio: "adaptive", duration: -1, refVideoDurationsSec: [5, 25] })
      // 480p -ref is 42.5 a second: input 5 + 25, output the longest clip 25 + 1 s.
      expect(reserved).toBe(mk(Math.ceil(42.5 * (30 + 26))))
      expect(quote.reserve).toBe(reserved)
    } finally {
      probe.probeMediaDuration.mockImplementation(async () => 10)
    }
  })
})

describe("a declared reference with an automatic length", () => {
  const CLIP = "https://cdn.example.com/five.mp4"
  const LONG = "https://cdn.example.com/twelve.mp4"
  const params = { prompt: "a cat in the style of {video:1}", provider: "seedance-2-5", resolution: "720p", duration: -1, referenceVideoUrls: [CLIP], referenceTaskType: "reference" }
  /** The worst case, through the reservation's own function: the model's longest output, the clips as input. */
  async function worstBase(durationsSec: number[]) {
    const { seedance2RefVideoBaseCreditsFromDurations } = await import("../../billing/seedance2-ref-video-credits.js")
    return seedance2RefVideoBaseCreditsFromDurations({ provider: "seedance-2-5", resolution: "720p", outputDurationSec: 30, requestedDuration: -1, referenceTaskType: "reference", durationsSec })
  }

  it.each(["text-to-video", "generate-video"])("%s: one 5 s clip at 720p — the quote and the reservation are the worst case", async (type) => {
    probe.probeMediaDuration.mockImplementation(async () => 5)
    try {
      const { quote, identifier, reserved } = await quoteThenRun(type, params)
      const base = await worstBase([5])
      expect(base).toBe(Math.ceil(95 * (5 + 30)))
      expect(identifier).toBe("seedance-2-5:30s:720p-ref")
      expect(reserved).toBe(mk(base))
      expect(quote.reserve).toBe(reserved)
      expect(quote.identifier).toBe(identifier)
    } finally {
      probe.probeMediaDuration.mockImplementation(async () => 10)
    }
  })

  it("two clips: the quote and the reservation are the worst case, both clips as input", async () => {
    probe.probeMediaDuration.mockImplementation(async (url: unknown) => (url === LONG ? 12 : 5))
    try {
      const { quote, reserved } = await quoteThenRun("text-to-video", { ...params, referenceVideoUrls: [CLIP, LONG] })
      expect(reserved).toBe(mk(await worstBase([5, 12])))
      expect(quote.reserve).toBe(reserved)
    } finally {
      probe.probeMediaDuration.mockImplementation(async () => 10)
    }
  })

  it("undeclared, the same body keeps the edit hold it had: 5 + (5 + 1) s", async () => {
    probe.probeMediaDuration.mockImplementation(async () => 5)
    try {
      const { referenceTaskType: _declared, ...plain } = params
      const { quote, reserved } = await quoteThenRun("text-to-video", plain)
      expect(reserved).toBe(mk(Math.ceil(95 * (5 + 6))))
      expect(quote.reserve).toBe(reserved)
    } finally {
      probe.probeMediaDuration.mockImplementation(async () => 10)
    }
  })
})
