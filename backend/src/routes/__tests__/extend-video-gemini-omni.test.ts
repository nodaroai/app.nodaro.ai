// @test-units-by-name prices only the Extend Video provider it names (Gemini Omni Flash 1.2 Extend)
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

// ---------------------------------------------------------------------------
// POST /v1/extend-video on Gemini Omni Flash 1.2 Extend (decided 2026-11-17):
// what it holds (its two rows, rounded up to 10, on the source the route
// measured), what is refused before anything is held (a shape other than 16:9
// or 9:16, a source under 4 s, a length or resolution it does not take, an
// empty prompt, reference images), and what the worker is queued with.
// ---------------------------------------------------------------------------

const h = vi.hoisted(() => ({
  /** Each guard run: the credit id it priced and the video the free-credit limits judge. */
  guarded: [] as Array<{ id: string; video: unknown }>,
  /** Each guard run's computed BASE credits (`computeCredits`; undefined: the row prices it). */
  computed: [] as Array<number | undefined>,
  /** The install's config: a fal key unless a test removes it. */
  config: { EDITION: "cloud", SUPABASE_URL: "https://test.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "test", FAL_KEY: "test-fal-key" } as Record<string, string>,
}))

vi.mock("@/lib/supabase.js", () => ({
  supabase: {
    from: vi.fn(),
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-123" } }, error: null }) },
  },
}))

vi.mock("@/lib/queue.js", () => ({
  videoQueue: { add: vi.fn().mockResolvedValue({ id: "queue-job-1" }) },
  redis: {},
}))

// The guard records what it would price, the video it would judge, and the
// base credits its `computeCredits` gives (the amount it holds, before the markup).
vi.mock("@/middleware/credit-guard.js", () => ({
  creditGuard: (
    resolve: (req: unknown) => string,
    opts?: { computeCredits?: (body: unknown, req: unknown) => Promise<number | undefined> | number | undefined },
  ) => async (req: { freeVideoRequest?: unknown; body?: unknown }) => {
    h.guarded.push({ id: resolve(req), video: req.freeVideoRequest })
    h.computed.push(await opts?.computeCredits?.(req.body, req))
  },
  reserveCreditsForJob: vi.fn().mockResolvedValue({ usageLogId: "usage-1", creditsReserved: 1, watermark: false }),
}))

vi.mock("@/lib/kie-task-ownership.js", () => ({ kieTaskOwnedByAnother: vi.fn().mockResolvedValue(false) }))
vi.mock("@/lib/admin-check.js", () => ({ warmAdminCache: vi.fn(), checkIsAdmin: vi.fn().mockResolvedValue(false) }))
vi.mock("@/lib/config.js", () => ({
  config: h.config,
  isCloud: () => true,
  hasCredits: () => true,
  isCommunity: () => false,
  isBusiness: () => false,
  hasAdmin: () => true,
}))

// The price rows the guard reads, from the static table (no database here).
// (The table is read when a price is asked for, never while the mock is built:
// the billing module imports this one, so loading it here would deadlock.)
vi.mock("@/lib/credit-base-cost.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/credit-base-cost.js")>()
  return {
    ...actual,
    unitRateBaseCredits: async (id: string, units: number) => {
      const { STATIC_CREDIT_COSTS } = await import("@/ee/billing/credits.js")
      return actual.quoteBaseCredits(STATIC_CREDIT_COSTS[id]!, units)
    },
    baseCreditCostFor: async (id: string) => {
      const { STATIC_CREDIT_COSTS } = await import("@/ee/billing/credits.js")
      const row = STATIC_CREDIT_COSTS[id]
      if (row === undefined) throw new Error(`no row ${id}`)
      return row
    },
  }
})

vi.mock("@/providers/video/ffmpeg-utils.js", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  probeVideoSource: vi.fn(),
}))

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------
import { extendVideoRoutes, checkExtendSource, resolveExtendVideoIdentifier, extendVideoComputeCredits } from "../extend-video.js"
import { registerRetiredVideoProviderHook } from "../../middleware/retired-video-provider.js"
import { supabase } from "../../lib/supabase.js"
import { videoQueue } from "../../lib/queue.js"
import { reserveCreditsForJob } from "../../middleware/credit-guard.js"
import { probeVideoSource } from "../../providers/video/ffmpeg-utils.js"

const USER = "00000000-0000-4000-8000-000000000001"
const SOURCE = "https://cdn.example.com/source.mp4"
const P = "gemini-omni-flash-1-2-extend"

let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()
  h.config.FAL_KEY = "test-fal-key"
  h.guarded.length = 0
  h.computed.length = 0
  // A 10 s 16:9 clip whose sound runs past its picture.
  vi.mocked(probeVideoSource).mockResolvedValue({ width: 1280, height: 720, durationSeconds: 10.2, videoDurationSeconds: 10 })

  app = Fastify({ logger: false })
  registerRetiredVideoProviderHook(app)
  app.addHook("preHandler", async (req) => {
    const body = req.body as Record<string, unknown> | undefined
    if (typeof body?.userId === "string") req.userId = body.userId
  })
  await app.register(async (instance) => {
    await extendVideoRoutes(instance)
  })
  await app.ready()

  const single = vi.fn().mockResolvedValue({ data: { id: "job-1" }, error: null })
  const insert = vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ single }) })
  vi.mocked(supabase.from).mockReturnValue({ insert } as never)
})

afterEach(async () => {
  await app.close()
})

const post = (payload: Record<string, unknown>) =>
  app.inject({ method: "POST", url: "/v1/extend-video", payload: { userId: USER, videoUrl: SOURCE, prompt: "she walks out of frame", provider: P, ...payload } })

function queued(): Record<string, unknown> {
  expect(videoQueue.add).toHaveBeenCalledTimes(1)
  return vi.mocked(videoQueue.add).mock.calls[0]![1] as Record<string, unknown>
}

const reservedId = () => vi.mocked(reserveCreditsForJob).mock.calls[0]![3]

describe("POST /v1/extend-video — gemini-omni-flash-1-2-extend's hold", () => {
  it("is accepted, held on its two rows and marked up at its resolution's per-second-added row, and queued as itself with the measured source", async () => {
    const res = await post({ duration: 8, resolution: "720p" })
    expect(res.statusCode).toBe(200)
    expect(h.guarded.map((g) => g.id)).toEqual(["gemini-omni-flash-1-2-extend:720p:per-second"])
    expect(reservedId()).toBe("gemini-omni-flash-1-2-extend:720p:per-second")
    // 10 s sent × 5 + 8 s added × 42 = 386 → 390.
    expect(h.computed).toEqual([390])
    expect(queued()).toMatchObject({ provider: P, duration: 8, resolution: "720p", sourcePictureSec: 10, video: SOURCE })
    // An extend is locked on free credits, as every engine's.
    expect(h.guarded[0]!.video).toMatchObject({ provider: P, extend: true })
  })

  // The decided examples (base credits): [source picture, seconds added, resolution, base].
  it.each([
    [10, 5, "360p", 130],
    [10, 5, "720p", 260],
    [10, 10, "720p", 470],
    [4, 3, "720p", 150],
    [10, 5, "1080p", 370],
    [10, 5, "4k", 680],
    [10, 8, "720p", 390],
    // A longer source sends only its last 10 s.
    [42, 8, "720p", 390],
    // 4.06 s reads as 4 s (the overhang rule); 4.37 s as itself: 21.85 + 123 → 150.
    [4.06, 3, "720p", 150],
    [4.37, 3, "720p", 150],
  ] as const)("a %s s source + %s s at %s holds %s base", async (picture, duration, resolution, expected) => {
    vi.mocked(probeVideoSource).mockResolvedValue({ width: 3840, height: 2160, durationSeconds: picture + 0.1, videoDurationSeconds: picture })
    const res = await post({ duration, resolution })
    expect(res.statusCode).toBe(200)
    expect(h.computed).toEqual([expected])
  })

  it("holds the whole 10 s window when the source cannot be measured, and stamps no length", async () => {
    vi.mocked(probeVideoSource).mockRejectedValue(new Error("unreachable"))
    const res = await post({ duration: 5, resolution: "4k" })
    expect(res.statusCode).toBe(200)
    expect(h.computed).toEqual([680])
    expect(queued().sourcePictureSec).toBeUndefined()
  })

  it("names its resolution's per-second-added row for the guard and the reservation alike; another resolution is 720p's", () => {
    expect(resolveExtendVideoIdentifier({ provider: P, duration: 5, resolution: "4k" })).toBe("gemini-omni-flash-1-2-extend:4k:per-second")
    expect(resolveExtendVideoIdentifier({ provider: P, duration: 3, resolution: "360p" })).toBe("gemini-omni-flash-1-2-extend:360p:per-second")
    expect(resolveExtendVideoIdentifier({ provider: P, resolution: "480p" })).toBe("gemini-omni-flash-1-2-extend:720p:per-second")
  })

  it("computes no base for any other provider", async () => {
    expect(await extendVideoComputeCredits({ provider: "kling-4-extend" }, {} as never)).toBeUndefined()
  })
})

describe("POST /v1/extend-video — gemini-omni-flash-1-2-extend's refusals, before anything is held", () => {
  it.each([[640, 640], [1440, 1080], [2560, 1080], [1080, 1440]])("refuses a %s×%s source, naming the two shapes", async (width, height) => {
    vi.mocked(probeVideoSource).mockResolvedValue({ width, height, durationSeconds: 10, videoDurationSeconds: 10 })
    const res = await post({})
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("video_aspect_unsupported")
    expect(res.json().error.message).toMatch(/16:9 or 9:16/)
    expect(res.json().error.message).toMatch(/Seedance/)
    expect(reserveCreditsForJob).not.toHaveBeenCalled()
    expect(h.guarded).toEqual([])
    expect(videoQueue.add).not.toHaveBeenCalled()
  })

  it.each([[1920, 1080], [1080, 1920], [854, 480]])("takes a %s×%s source", async (width, height) => {
    vi.mocked(probeVideoSource).mockResolvedValue({ width, height, durationSeconds: 10, videoDurationSeconds: 10 })
    expect((await post({})).statusCode).toBe(200)
  })

  it("the Seedance engines keep any shape: a square source runs on Seedance 2.5", async () => {
    vi.mocked(probeVideoSource).mockResolvedValue({ width: 640, height: 640, durationSeconds: 10, videoDurationSeconds: 10 })
    expect((await post({ provider: "seedance-2-5-extend" })).statusCode).toBe(200)
  })

  it("refuses a source under 4 s", async () => {
    vi.mocked(probeVideoSource).mockResolvedValue({ width: 1280, height: 720, durationSeconds: 3.5, videoDurationSeconds: 3.5 })
    const res = await post({})
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("video_too_short")
    expect(res.json().error.message).toMatch(/at least 3\.75s/)
    expect(reserveCreditsForJob).not.toHaveBeenCalled()
  })

  it("accepts 3–10 s added, refuses a length outside it", async () => {
    expect((await post({ duration: 3 })).statusCode).toBe(200)
    vi.mocked(videoQueue.add).mockClear()
    expect((await post({ duration: 10 })).statusCode).toBe(200)
    expect((await post({ duration: 2 })).statusCode).toBe(400)
    expect((await post({ duration: 11 })).statusCode).toBe(400)
  })

  it("accepts 360p, 720p, 1080p and 4k; refuses 480p", async () => {
    for (const resolution of ["360p", "720p", "1080p", "4k"]) {
      vi.mocked(videoQueue.add).mockClear()
      expect((await post({ resolution })).statusCode, resolution).toBe(200)
    }
    const res = await post({ resolution: "480p" })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.message).toMatch(/360p, 720p, 1080p or 4k/)
  })

  it("4k stays refused on every provider that does not render it, as before it joined the field", async () => {
    // Seedance 2.5 Extend renders 4K on a 4K source (decided 2026-11-25), refused here as `extend_source_below_4k`.
    for (const provider of ["seedance-2-5-flash-extend", "kling-4-extend", "pixverse-v6-extend", "ltx-2.3-pro"]) {
      const res = await post({ provider, resolution: "4k" })
      expect(res.statusCode, provider).toBe(400)
      expect(res.json().error.code, provider).toBe("validation_error")
    }
    for (const provider of ["veo-extend", "runway-extend", "grok-extend"]) {
      const res = await post({ provider, resolution: "4k", taskId: "task-1" })
      expect(res.statusCode, provider).toBe(400)
    }
    expect(reserveCreditsForJob).not.toHaveBeenCalled()
    expect(h.guarded).toEqual([])
  })

  it("refuses a blank prompt (spaces only), as a workflow run does", async () => {
    const res = await post({ prompt: "   " })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.message).toMatch(/prompt \(what happens next\) is required for gemini-omni-flash-1-2-extend/)
    expect(reserveCreditsForJob).not.toHaveBeenCalled()
  })

  it("an install with no fal key is refused before anything is probed or held", async () => {
    h.config.FAL_KEY = ""
    const res = await post({})
    expect(res.statusCode).toBe(503)
    expect(res.json().error.code).toBe("provider_unavailable")
    expect(res.json().error.message).toMatch(/FAL_KEY/)
    expect(probeVideoSource).not.toHaveBeenCalled()
    expect(h.guarded).toEqual([])
    expect(reserveCreditsForJob).not.toHaveBeenCalled()
    // Every other extend engine is untouched by it.
    expect((await post({ provider: "seedance-2-5-extend" })).statusCode).toBe(200)
  })

  it("refuses a request with no prompt, as every tail engine does", async () => {
    const res = await post({ prompt: undefined })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.message).toMatch(/prompt \(what happens next\) is required for gemini-omni-flash-1-2-extend/)
    expect(reserveCreditsForJob).not.toHaveBeenCalled()
  })

  it("refuses reference images (it takes none)", async () => {
    const res = await post({ referenceImageUrls: ["https://cdn.example.com/a.png"] })
    expect(res.statusCode).toBe(400)
    expect(reserveCreditsForJob).not.toHaveBeenCalled()
  })
})

describe("checkExtendSource — gemini-omni-flash-1-2-extend", () => {
  it("answers the measured picture for a 16:9 source, a refusal for 4:3", async () => {
    vi.mocked(probeVideoSource).mockResolvedValue({ width: 1920, height: 1080, durationSeconds: 7.2, videoDurationSeconds: 7 })
    // …and its display size, which caps the tier the run is held at.
    expect(await checkExtendSource(P, SOURCE)).toEqual({ ok: true, pictureSec: 7, size: { width: 1920, height: 1080 } })
    vi.mocked(probeVideoSource).mockResolvedValue({ width: 1440, height: 1080, durationSeconds: 7, videoDurationSeconds: 7 })
    expect(await checkExtendSource(P, SOURCE)).toMatchObject({ ok: false, code: "video_aspect_unsupported" })
  })
})

// Decided 2026-11-17: a tier above the source's runs, and is charged, at the source's.
describe("POST /v1/extend-video — gemini-omni-flash-1-2-extend's tier, capped at the source's", () => {
  it.each([
    // [width, height, asked, the tier that runs, base for a 10 s source + 5 s]
    [1280, 720, "4k", "720p", 260],
    [1920, 1080, "4k", "1080p", 370],
    [1080, 1920, "4k", "1080p", 370],
    [854, 480, "1080p", "720p", 260],
    // A source a few lines over a tier is that tier, never the next one up.
    [1920, 1088, "4k", "1080p", 370],
    [1296, 736, "4k", "720p", 260],
    [480, 270, "720p", "360p", 130],
    // A tier below the source's runs, and is charged, as asked.
    [3840, 2160, "720p", "720p", 260],
  ] as const)("a %s×%s source asked for %s is held, queued and charged at %s", async (width, height, asked, tier, base) => {
    vi.mocked(probeVideoSource).mockResolvedValue({ width, height, durationSeconds: 10, videoDurationSeconds: 10 })
    const res = await post({ duration: 5, resolution: asked })
    expect(res.statusCode).toBe(200)
    expect(h.guarded.map((g) => g.id)).toEqual([`gemini-omni-flash-1-2-extend:${tier}:per-second`])
    expect(reservedId()).toBe(`gemini-omni-flash-1-2-extend:${tier}:per-second`)
    expect(h.computed).toEqual([base])
    expect(queued().resolution).toBe(tier)
  })

  it("a source whose size is not known is held at the asked tier (the worker settles at the tier it measures)", async () => {
    vi.mocked(probeVideoSource).mockRejectedValue(new Error("unreachable"))
    const res = await post({ duration: 5, resolution: "4k" })
    expect(res.statusCode).toBe(200)
    expect(queued().resolution).toBe("4k")
    expect(h.computed).toEqual([680])
  })

  it("judges an anamorphic source by its display shape: 1440×1080 with a 4:3 sample aspect plays as 16:9", async () => {
    vi.mocked(probeVideoSource).mockResolvedValue({ width: 1440, height: 1080, sampleAspectRatio: 4 / 3, durationSeconds: 10, videoDurationSeconds: 10 })
    const res = await post({ duration: 5, resolution: "4k" })
    expect(res.statusCode).toBe(200)
    // Its display size is 1920×1080: the 1080p tier.
    expect(queued().resolution).toBe("1080p")
    // The same stored size with square pixels is 4:3, refused.
    vi.mocked(videoQueue.add).mockClear()
    vi.mocked(probeVideoSource).mockResolvedValue({ width: 1440, height: 1080, durationSeconds: 10, videoDurationSeconds: 10 })
    expect((await post({})).statusCode).toBe(400)
  })
})
