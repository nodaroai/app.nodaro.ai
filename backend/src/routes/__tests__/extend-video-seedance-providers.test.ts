// @test-units-by-name prices only the Extend Video providers it names (Seedance 2.5, Seedance 2.0, Kling 4)
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

// ---------------------------------------------------------------------------
// POST /v1/extend-video on its tail-recipe providers (Seedance 2.5, Seedance
// 2.0, Kling 4): what each is priced at
// (the guard's id and the reservation's id), what is refused before anything
// is reserved (a duration outside the provider's window, a source shorter than
// the tail it sends), and what the worker is queued with. The earlier single
// id `seedance-2-extend` runs and is priced as Seedance 2.5, through the
// app-wide retired-id hook — registered here as the app registers it.
// ---------------------------------------------------------------------------

const h = vi.hoisted(() => ({
  /** Each guard run: the credit id it priced and the video the free-credit limits judge. */
  guarded: [] as Array<{ id: string; video: unknown }>,
  /** Each guard run's computed BASE credits (`computeCredits`; undefined: the row prices it). */
  computed: [] as Array<number | undefined>,
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
  config: { EDITION: "cloud", SUPABASE_URL: "https://test.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "test" },
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
  }
})

vi.mock("@/providers/video/ffmpeg-utils.js", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  probeVideoSource: vi.fn(),
}))

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { extendVideoRoutes, checkExtendSource } from "../extend-video.js"
import { registerRetiredVideoProviderHook } from "../../middleware/retired-video-provider.js"
import { supabase } from "../../lib/supabase.js"
import { videoQueue } from "../../lib/queue.js"
import { reserveCreditsForJob } from "../../middleware/credit-guard.js"
import { probeVideoSource } from "../../providers/video/ffmpeg-utils.js"
import { tailRecipeSeconds } from "../../lib/extend-recipe.js"
import { seedanceExtendPrice } from "@nodaro/render-rules"
import { STATIC_CREDIT_COSTS } from "../../ee/billing/credits.js"
import { quoteBaseCredits } from "../../lib/credit-base-cost.js"

const USER = "00000000-0000-4000-8000-000000000001"
const SOURCE = "https://cdn.example.com/source.mp4"

let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()
  h.guarded.length = 0
  h.computed.length = 0
  // A 10 s clip whose sound runs past its picture.
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
  app.inject({ method: "POST", url: "/v1/extend-video", payload: { userId: USER, videoUrl: SOURCE, prompt: "she walks out of frame", ...payload } })

function queued(): Record<string, unknown> {
  expect(videoQueue.add).toHaveBeenCalledTimes(1)
  return vi.mocked(videoQueue.add).mock.calls[0]![1] as Record<string, unknown>
}

const reservedId = () => vi.mocked(reserveCreditsForJob).mock.calls[0]![3]

describe("POST /v1/extend-video — each Seedance provider's price", () => {
  it("retired seedance-2-extend runs and is priced as seedance-2-5-extend", async () => {
    const res = await post({ provider: "seedance-2-extend", duration: 12, resolution: "480p" })
    expect(res.statusCode).toBe(200)
    expect(h.guarded.map((g) => g.id)).toEqual(["seedance-2-5-extend:480p:per-2s"])
    expect(reservedId()).toBe("seedance-2-5-extend:480p:per-2s")
    // The 10 s source's last 10 s + 12 s added: 11 of the 480p two-second row.
    expect(h.computed).toEqual([(10 + 12) / 2 * 85])
    expect(queued().provider).toBe("seedance-2-5-extend")
  })

  it("prices seedance-2-0-extend on its own rows", async () => {
    const res = await post({ provider: "seedance-2-0-extend" })
    expect(res.statusCode).toBe(200)
    expect(h.guarded.map((g) => g.id)).toEqual(["seedance-2-0-extend:8s:720p"])
    expect(reservedId()).toBe("seedance-2-0-extend:8s:720p")
    // Its row prices it: nothing computed.
    expect(h.computed).toEqual([undefined])
    expect(queued().provider).toBe("seedance-2-0-extend")
  })

  it("prices Seedance 2.5 per second sent and added, over its whole window", async () => {
    const res = await post({ provider: "seedance-2-5-extend", duration: 30, resolution: "1080p" })
    expect(res.statusCode).toBe(200)
    expect(reservedId()).toBe("seedance-2-5-extend:1080p:per-2s")
    expect(h.computed).toEqual([(10 + 30) / 2 * 475])
    expect(queued().duration).toBe(30)
  })

  // The reservation counts the source the route measured — its picture, not
  // its container — and is exactly the quote of a run on a source of that
  // length (`seedanceExtendPrice`, the rule every quote reads).
  it.each([
    // [picture, container, seconds added, resolution]
    [2, 2.3, 8, "720p"],
    [4, 4, 8, "720p"],
    [6.04, 6.2, 8, "720p"],
    [10, 10.2, 8, "720p"],
    [25, 25, 8, "720p"],
    [4.37, 4.5, 5, "480p"],
    [12, 12, 30, "1080p"],
  ] as const)("the reservation for a %s s picture (container %s s) + %s s at %s equals the quote for that source", async (picture, container, duration, resolution) => {
    vi.mocked(probeVideoSource).mockResolvedValue({ width: 1280, height: 720, durationSeconds: container, videoDurationSeconds: picture })
    const res = await post({ provider: "seedance-2-5-extend", duration, resolution })
    expect(res.statusCode).toBe(200)
    const quote = seedanceExtendPrice({ duration, resolution, sourcePictureSec: picture })
    expect(reservedId()).toBe(quote.rateId)
    expect(h.computed).toEqual([quoteBaseCredits(STATIC_CREDIT_COSTS[quote.rateId]!, quote.units)])
  })

  it("the decided examples: 8 s added at 720p on a 2 / 4 / 10 / 25 s source holds 950 / 1140 / 1710 / 1710 base", async () => {
    const held: Array<number | undefined> = []
    for (const picture of [2, 4, 10, 25]) {
      h.computed.length = 0
      vi.mocked(probeVideoSource).mockResolvedValue({ width: 1280, height: 720, durationSeconds: picture, videoDurationSeconds: picture })
      await post({ provider: "seedance-2-5-extend", duration: 8, resolution: "720p" })
      held.push(h.computed[0])
    }
    expect(held).toEqual([950, 1140, 1710, 1710])
  })

  it("the hold reads the source's picture by the container-overhang rule: 8.04 s holds as 8 s, 8.3 s as 8.3 s", async () => {
    const held: Array<number | undefined> = []
    for (const picture of [8.04, 8.3]) {
      h.computed.length = 0
      vi.mocked(probeVideoSource).mockResolvedValue({ width: 1280, height: 720, durationSeconds: picture + 0.1, videoDurationSeconds: picture })
      await post({ provider: "seedance-2-5-extend", duration: 8, resolution: "720p" })
      held.push(h.computed[0])
    }
    expect(held).toEqual([(8 + 8) / 2 * 190, Math.ceil((8.3 + 8) / 2 * 190)])
  })

  it("a source the route could not measure holds the whole 10 s window (the worker settles on the source it measures)", async () => {
    vi.mocked(probeVideoSource).mockRejectedValue(new Error("ffprobe timed out"))
    const res = await post({ provider: "seedance-2-5-extend", duration: 8 })
    expect(res.statusCode).toBe(200)
    expect(h.computed).toEqual([(10 + 8) / 2 * 190])
  })

  it("a length named in the body is never what the run is charged for", async () => {
    vi.mocked(probeVideoSource).mockResolvedValue({ width: 1280, height: 720, durationSeconds: 4, videoDurationSeconds: 4 })
    await post({ provider: "seedance-2-5-extend", duration: 8, sourcePictureSec: 0.1 })
    expect(h.computed).toEqual([(4 + 8) / 2 * 190])
    // …nor what the worker is told was held: the length the route measured.
    expect(queued().sourcePictureSec).toBe(4)
  })

  // The worker sends (and settles on) no more of the source than the hold was
  // priced on, so the route queues the length it measured — on Seedance 2.5
  // only, and only when it measured one.
  it("queues the source length the hold was priced on, for Seedance 2.5 only", async () => {
    vi.mocked(probeVideoSource).mockResolvedValue({ width: 1280, height: 720, durationSeconds: 6.3, videoDurationSeconds: 6.2 })
    await post({ provider: "seedance-2-5-extend", duration: 8 })
    expect(queued().sourcePictureSec).toBe(6.2)
    vi.mocked(videoQueue.add).mockClear()
    await post({ provider: "seedance-2-extend", duration: 8 })
    expect(queued().sourcePictureSec).toBe(6.2)
    for (const provider of ["seedance-2-0-extend", "kling-4-extend"]) {
      vi.mocked(videoQueue.add).mockClear()
      await post({ provider, duration: 8 })
      expect(queued(), provider).not.toHaveProperty("sourcePictureSec")
    }
    vi.mocked(videoQueue.add).mockClear()
    vi.mocked(probeVideoSource).mockRejectedValue(new Error("ffprobe timed out"))
    await post({ provider: "seedance-2-5-extend", duration: 8 })
    expect(queued()).not.toHaveProperty("sourcePictureSec")
  })

  it("hands the guard the request's video, marked an extension, so the free-credit limits judge what it runs", async () => {
    await post({ provider: "seedance-2-0-extend", duration: 4, resolution: "480p" })
    await post({ provider: "seedance-2-extend" })
    await post({ provider: "ltx-2.3-pro", duration: 6 })
    await post({ provider: "veo-extend", videoUrl: undefined, taskId: "kie-task-1" })
    expect(h.guarded.map((g) => g.video)).toEqual([
      { provider: "seedance-2-0-extend", duration: 4, resolution: "480p", videoSize: null, extend: true },
      { provider: "seedance-2-5-extend", duration: null, resolution: null, videoSize: null, extend: true },
      { provider: "ltx-2.3-pro", duration: 6, resolution: null, videoSize: null, extend: true },
      { provider: "veo-extend", duration: null, resolution: null, videoSize: null, extend: true },
    ])
  })

  it("queues the seconds the run is priced at (tailRecipeSeconds): the 8 s default when unset", async () => {
    await post({ provider: "seedance-2-0-extend" })
    expect(queued().duration).toBe(8)
    expect(queued().duration).toBe(tailRecipeSeconds("seedance-2-0-extend", undefined))
    vi.mocked(videoQueue.add).mockClear()
    await post({ provider: "seedance-2-5-extend", duration: 13 })
    expect(queued().duration).toBe(tailRecipeSeconds("seedance-2-5-extend", 13))
  })
})

describe("POST /v1/extend-video — refused before anything is reserved", () => {
  it("rejects a duration outside the provider's window before reserving", async () => {
    const res = await post({ provider: "seedance-2-0-extend", duration: 25 })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
    expect(res.json().error.message).toMatch(/4.15/)
    expect(reserveCreditsForJob).not.toHaveBeenCalled()
    expect(h.guarded).toEqual([])
    expect(probeVideoSource).not.toHaveBeenCalled()
  })

  it("a duration Seedance 2.5 offers past 20 s is accepted", async () => {
    const res = await post({ provider: "seedance-2-5-extend", duration: 25 })
    expect(res.statusCode).toBe(200)
    expect(reservedId()).toBe("seedance-2-5-extend:720p:per-2s")
    expect(h.computed).toEqual([(10 + 25) / 2 * 190])
  })

  it.each(["seedance-2-5-extend", "seedance-2-0-extend"])("a duration under a Seedance window's 4 s is refused (%s)", async (provider) => {
    for (const duration of [1, 2, 3]) {
      const res = await post({ provider, duration })
      expect(res.statusCode, String(duration)).toBe(400)
      expect(res.json().error.code).toBe("validation_error")
    }
    expect(reserveCreditsForJob).not.toHaveBeenCalled()
    expect(h.guarded).toEqual([])
  })

  // The retired id took 1–20 s and snapped a short length up to its 4 s
  // floor; a caller still sending it keeps running, at Seedance 2.5's 4 s.
  it.each([1, 2, 3])("the retired seedance-2-extend with %i s runs as Seedance 2.5's 4 s, priced and queued alike", async (duration) => {
    const res = await post({ provider: "seedance-2-extend", duration })
    expect(res.statusCode).toBe(200)
    expect(h.guarded).toEqual([
      { id: "seedance-2-5-extend:720p:per-2s", video: { provider: "seedance-2-5-extend", duration: 4, resolution: null, videoSize: null, extend: true } },
    ])
    expect(reservedId()).toBe("seedance-2-5-extend:720p:per-2s")
    expect(h.computed).toEqual([(10 + 4) / 2 * 190])
    expect(queued()).toMatchObject({ provider: "seedance-2-5-extend", duration: 4 })
    const insert = vi.mocked(supabase.from).mock.results[0]!.value.insert as ReturnType<typeof vi.fn>
    expect((insert.mock.calls[0]![0] as { input_data: Record<string, unknown> }).input_data).toMatchObject({ provider: "seedance-2-5-extend", duration: 4 })
  })

  it("the retired id's length inside the window is left as sent", async () => {
    const res = await post({ provider: "seedance-2-extend", duration: 20 })
    expect(res.statusCode).toBe(200)
    expect(reservedId()).toBe("seedance-2-5-extend:720p:per-2s")
    expect(h.computed).toEqual([(10 + 20) / 2 * 190])
    expect(queued().duration).toBe(20)
  })

  it("LTX keeps its 1–20 s", async () => {
    const res = await post({ provider: "ltx-2.3-pro", duration: 25 })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
    expect(res.json().error.message).toBe("duration must be 1–20 seconds for ltx-2.3-pro")
    expect(reserveCreditsForJob).not.toHaveBeenCalled()
  })

  // VEO and Runway add a length of their own and ignore `duration`; they keep
  // exactly the 1–20 s the route accepted before Seedance 2.5 widened the
  // schema's ceiling to 30.
  it.each(["veo-extend", "runway-extend"])("%s still refuses 21–30 s and accepts 20", async (provider) => {
    const kie = { provider, videoUrl: undefined, taskId: "kie-task-1" }
    for (const duration of [21, 25, 30]) {
      const res = await post({ ...kie, duration })
      expect(res.statusCode, String(duration)).toBe(400)
      expect(res.json().error.message).toBe(`duration must be 1–20 seconds for ${provider}`)
    }
    expect(h.guarded).toEqual([])
    expect((await post({ ...kie, duration: 20 })).statusCode).toBe(200)
  })

  it("refuses a source shorter than the provider's reference floor before reserving", async () => {
    vi.mocked(probeVideoSource).mockResolvedValue({ width: 1280, height: 720, durationSeconds: 1.5, videoDurationSeconds: 1.5 })
    const res = await post({ provider: "seedance-2-5-extend" })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("video_too_short")
    expect(res.json().error.message).toBe(
      "Source video is too short to extend: Seedance 2.5 Extend needs at least 1.8s of footage to continue from (got 1.50s).",
    )
    expect(supabase.from).not.toHaveBeenCalled()
    expect(reserveCreditsForJob).not.toHaveBeenCalled()
    expect(h.guarded).toEqual([])
    expect(videoQueue.add).not.toHaveBeenCalled()
  })

  // A nominal 2 s clip whose stream ffprobe reports a frame short (59 frames
  // at 29.97 fps) has always run: the floor is the shortest reference Seedance
  // takes (1.8 s), not the 2 s tail the run asks for.
  it.each(["seedance-2-5-extend", "seedance-2-0-extend"])("accepts a 1.97 s source (%s)", async (provider) => {
    vi.mocked(probeVideoSource).mockResolvedValue({ width: 1280, height: 720, durationSeconds: 1.97, videoDurationSeconds: 1.97 })
    const res = await post({ provider })
    expect(res.statusCode).toBe(200)
    expect(videoQueue.add).toHaveBeenCalledTimes(1)
  })

  it("measures the source's picture, not its container (sound running past the last frame)", async () => {
    vi.mocked(probeVideoSource).mockResolvedValue({ width: 1280, height: 720, durationSeconds: 3, videoDurationSeconds: 1.5 })
    const res = await post({ provider: "seedance-2-0-extend" })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("video_too_short")
  })

  it("never probes a source that fails validation", async () => {
    for (const videoUrl of ["/etc/passwd", "file:///etc/passwd", "http://127.0.0.1/clip.mp4"]) {
      const res = await post({ provider: "seedance-2-5-extend", videoUrl })
      expect(res.statusCode, videoUrl).toBe(400)
    }
    expect(probeVideoSource).not.toHaveBeenCalled()
    expect(h.guarded).toEqual([])
  })

  it("names the provider a missing field is required for, never the retired id", async () => {
    const res = await post({ provider: "seedance-2-extend", videoUrl: undefined })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.message).toBe("videoUrl is required for seedance-2-5-extend")
  })
})

describe("checkExtendSource", () => {
  it("passes a source at the provider's floor (TAIL_RECIPES[p].minSourceSec, 1.8 s) and refuses one under it", async () => {
    for (const provider of ["seedance-2-5-extend", "seedance-2-0-extend"]) {
      vi.mocked(probeVideoSource).mockResolvedValue({ width: 1280, height: 720, durationSeconds: 1.8, videoDurationSeconds: 1.8 })
      await expect(checkExtendSource(provider, SOURCE), provider).resolves.toEqual({ ok: true, pictureSec: 1.8 })
      vi.mocked(probeVideoSource).mockResolvedValue({ width: 1280, height: 720, durationSeconds: 1.79, videoDurationSeconds: 1.79 })
      await expect(checkExtendSource(provider, SOURCE), provider).resolves.toMatchObject({ ok: false, code: "video_too_short" })
    }
  })

  it("answers with the picture's length a run is charged for (its stream's, not the container's)", async () => {
    vi.mocked(probeVideoSource).mockResolvedValue({ width: 1280, height: 720, durationSeconds: 6.2, videoDurationSeconds: 6.04 })
    await expect(checkExtendSource("seedance-2-5-extend", SOURCE)).resolves.toEqual({ ok: true, pictureSec: 6.04 })
  })

  it("reads the container's length when the stream reports none", async () => {
    vi.mocked(probeVideoSource).mockResolvedValue({ width: 1280, height: 720, durationSeconds: 1.2 })
    const out = await checkExtendSource("seedance-2-0-extend", SOURCE)
    expect(out).toMatchObject({ ok: false, code: "video_too_short" })
  })

  it("a probe that fails lets the run through (the worker measures the source again)", async () => {
    vi.mocked(probeVideoSource).mockRejectedValue(new Error("ffprobe timed out"))
    await expect(checkExtendSource("seedance-2-5-extend", SOURCE)).resolves.toEqual({ ok: true })
  })

  it("probes nothing for a provider with no tail", async () => {
    await expect(checkExtendSource("veo-extend", SOURCE)).resolves.toEqual({ ok: true })
    await expect(checkExtendSource("ltx-2.3-pro", SOURCE)).resolves.toEqual({ ok: true })
    expect(probeVideoSource).not.toHaveBeenCalled()
  })
})

describe("POST /v1/extend-video — Kling 4 (kling-4-extend)", () => {
  it("is priced on its own rows: the 5 s, 720p default, and any length and resolution it offers", async () => {
    expect((await post({ provider: "kling-4-extend" })).statusCode).toBe(200)
    expect(h.guarded.map((g) => g.id)).toEqual(["kling-4-extend:5s:720p"])
    expect(reservedId()).toBe("kling-4-extend:5s:720p")
    expect(queued()).toMatchObject({ provider: "kling-4-extend", duration: 5, video: SOURCE })
    vi.mocked(videoQueue.add).mockClear()
    vi.mocked(reserveCreditsForJob).mockClear()
    expect((await post({ provider: "kling-4-extend", duration: 30, resolution: "1080p" })).statusCode).toBe(200)
    expect(reservedId()).toBe("kling-4-extend:30s:1080p")
    expect(queued()).toMatchObject({ duration: 30, resolution: "1080p" })
  })

  it("hands the guard the request's video, marked an extension (no extension on free credits)", async () => {
    await post({ provider: "kling-4-extend", duration: 8, resolution: "720p" })
    expect(h.guarded.map((g) => g.video)).toEqual([
      { provider: "kling-4-extend", duration: 8, resolution: "720p", videoSize: null, extend: true },
    ])
  })

  it("offers 3–30 s: refuses 1, 2 and anything past 30 before reserving, accepts 3", async () => {
    for (const duration of [1, 2, 31]) {
      const res = await post({ provider: "kling-4-extend", duration })
      expect(res.statusCode, String(duration)).toBe(400)
      expect(res.json().error.code).toBe("validation_error")
    }
    expect(h.guarded).toEqual([])
    expect(reserveCreditsForJob).not.toHaveBeenCalled()
    expect((await post({ provider: "kling-4-extend", duration: 3 })).statusCode).toBe(200)
    expect(reservedId()).toBe("kling-4-extend:3s:720p")
  })

  it("refuses a resolution Kling 4 does not render (480p) before reserving, never pricing it at another", async () => {
    const res = await post({ provider: "kling-4-extend", resolution: "480p" })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
    expect(res.json().error.message).toBe("resolution must be 720p or 1080p for kling-4-extend")
    expect(h.guarded).toEqual([])
    expect(reserveCreditsForJob).not.toHaveBeenCalled()
  })

  it("refuses a source shorter than 2 s on Kling before reserving", async () => {
    vi.mocked(probeVideoSource).mockResolvedValue({ width: 1280, height: 720, durationSeconds: 1.97, videoDurationSeconds: 1.97 })
    const res = await post({ provider: "kling-4-extend" })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("video_too_short")
    expect(res.json().error.message).toBe(
      "Source video is too short to extend: Kling 4 Extend needs at least 2s of footage to continue from (got 1.97s).",
    )
    expect(supabase.from).not.toHaveBeenCalled()
    expect(reserveCreditsForJob).not.toHaveBeenCalled()
    expect(h.guarded).toEqual([])
    expect(videoQueue.add).not.toHaveBeenCalled()
  })

  // Between Kling's 2 s reference floor and its 3 s tail the run sends the
  // whole picture: the source is continued, at the same price.
  it("accepts a 2.5 s source on Kling, priced as any other run", async () => {
    vi.mocked(probeVideoSource).mockResolvedValue({ width: 1280, height: 720, durationSeconds: 2.6, videoDurationSeconds: 2.5 })
    const res = await post({ provider: "kling-4-extend" })
    expect(res.statusCode).toBe(200)
    expect(reservedId()).toBe("kling-4-extend:5s:720p")
    expect(videoQueue.add).toHaveBeenCalledTimes(1)
  })

  it.each([2, 3])("continues a source of exactly %i s", async (seconds) => {
    vi.mocked(probeVideoSource).mockResolvedValue({ width: 1280, height: 720, durationSeconds: seconds, videoDurationSeconds: seconds })
    expect((await post({ provider: "kling-4-extend" })).statusCode).toBe(200)
    expect(videoQueue.add).toHaveBeenCalledTimes(1)
  })

  it("takes no reference images (only the Seedance extend providers do)", async () => {
    const res = await post({ provider: "kling-4-extend", referenceImageUrls: ["https://cdn.example.com/ref.png"] })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.message).toMatch(/only supported by the Seedance extend providers \(seedance-2-5-extend, seedance-2-0-extend\)/)
    expect(reserveCreditsForJob).not.toHaveBeenCalled()
  })

  it("requires the video and what happens next", async () => {
    expect((await post({ provider: "kling-4-extend", videoUrl: undefined })).json().error.message).toBe("videoUrl is required for kling-4-extend")
    expect((await post({ provider: "kling-4-extend", prompt: undefined })).json().error.message).toBe(
      "prompt (what happens next) is required for kling-4-extend",
    )
  })
})
