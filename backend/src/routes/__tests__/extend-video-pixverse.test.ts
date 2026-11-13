// @test-units-by-name prices and validates only the extend-video node it names
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

// ---------------------------------------------------------------------------
// POST /v1/extend-video on PixVerse V6 (`pixverse-v6-extend`), the native
// extend: what it is priced at (the guard's id and the reservation's, its own
// rows with `:audio` when the sound is on), what is refused before anything is
// reserved (a prompt under 3 characters, a length or a quality it does not
// offer), and what the worker is queued with.
// ---------------------------------------------------------------------------

const h = vi.hoisted(() => ({
  /** Each guard run: the credit id it priced and the video the free-credit limits judge. */
  guarded: [] as Array<{ id: string; video: unknown }>,
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

// The guard records what it would price, and the video it would judge.
vi.mock("@/middleware/credit-guard.js", () => ({
  creditGuard: (resolve: (req: unknown) => string) => async (req: { freeVideoRequest?: unknown }) => {
    h.guarded.push({ id: resolve(req), video: req.freeVideoRequest })
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

vi.mock("@/providers/video/ffmpeg-utils.js", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  probeVideoSource: vi.fn(),
}))

import { extendVideoRoutes } from "../extend-video.js"
import { registerRetiredVideoProviderHook } from "../../middleware/retired-video-provider.js"
import { supabase } from "../../lib/supabase.js"
import { videoQueue } from "../../lib/queue.js"
import { reserveCreditsForJob } from "../../middleware/credit-guard.js"
import { probeVideoSource } from "../../providers/video/ffmpeg-utils.js"
import { pixverseExtendCreditId } from "@nodaro/shared/credits"
import { STATIC_CREDIT_COSTS } from "../../ee/billing/credits.js"

const USER = "00000000-0000-4000-8000-000000000001"
const SOURCE = "https://cdn.example.com/source.mp4"

let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()
  h.guarded.length = 0
  vi.mocked(probeVideoSource).mockResolvedValue({ width: 1280, height: 720, durationSeconds: 8.1, videoDurationSeconds: 8.06 })

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
  app.inject({
    method: "POST",
    url: "/v1/extend-video",
    payload: { userId: USER, provider: "pixverse-v6-extend", videoUrl: SOURCE, prompt: "she walks out of frame", ...payload },
  })

function queued(): Record<string, unknown> {
  expect(videoQueue.add).toHaveBeenCalledTimes(1)
  return vi.mocked(videoQueue.add).mock.calls[0]![1] as Record<string, unknown>
}

const reservedId = () => vi.mocked(reserveCreditsForJob).mock.calls[0]![3]

/** Nothing was priced against a balance, reserved, or queued. */
function nothingReserved(): void {
  expect(h.guarded).toEqual([])
  expect(reserveCreditsForJob).not.toHaveBeenCalled()
  expect(videoQueue.add).not.toHaveBeenCalled()
}

describe("POST /v1/extend-video — PixVerse V6's price", () => {
  it("prices pixverse-v6-extend on its own rows: the guard and the reservation name one id", async () => {
    const res = await post({ duration: 5, resolution: "540p", generateAudio: true })
    expect(res.statusCode).toBe(200)
    expect(h.guarded.map((g) => g.id)).toEqual(["pixverse-v6-extend:5s:540p:audio"])
    expect(reservedId()).toBe("pixverse-v6-extend:5s:540p:audio")
    expect(STATIC_CREDIT_COSTS["pixverse-v6-extend:5s:540p:audio"]).toBeGreaterThan(0)
  })

  it("picks the :audio row when the sound is on, and when the request says nothing of it", async () => {
    await post({ duration: 8, resolution: "1080p" })
    expect(reservedId()).toBe("pixverse-v6-extend:8s:1080p:audio")
    vi.mocked(reserveCreditsForJob).mockClear()
    await post({ duration: 8, resolution: "1080p", generateAudio: true })
    expect(reservedId()).toBe("pixverse-v6-extend:8s:1080p:audio")
  })

  it("picks the silent row when the sound is off", async () => {
    const res = await post({ duration: 8, resolution: "1080p", generateAudio: false })
    expect(res.statusCode).toBe(200)
    expect(h.guarded.map((g) => g.id)).toEqual(["pixverse-v6-extend:8s:1080p"])
    expect(reservedId()).toBe("pixverse-v6-extend:8s:1080p")
  })

  it("an unset length and quality are priced at its 5 s default, 720p", async () => {
    await post({})
    expect(reservedId()).toBe("pixverse-v6-extend:5s:720p:audio")
    expect(reservedId()).toBe(pixverseExtendCreditId())
  })

  it("every length and quality it offers is a priced row", async () => {
    for (const duration of [1, 7, 15]) {
      for (const resolution of ["360p", "540p", "720p", "1080p"]) {
        for (const generateAudio of [true, false]) {
          h.guarded.length = 0
          vi.mocked(reserveCreditsForJob).mockClear()
          const res = await post({ duration, resolution, generateAudio })
          expect(res.statusCode, `${duration} ${resolution} ${generateAudio}`).toBe(200)
          const id = pixverseExtendCreditId(duration, resolution, generateAudio)
          expect(h.guarded.map((g) => g.id)).toEqual([id])
          expect(reservedId()).toBe(id)
          expect(STATIC_CREDIT_COSTS[id], id).toBeGreaterThan(0)
        }
      }
    }
  })

  it("hands the guard the request's video, marked an extension", async () => {
    await post({ duration: 5, resolution: "360p" })
    expect(h.guarded.map((g) => g.video)).toEqual([
      { provider: "pixverse-v6-extend", duration: 5, resolution: "360p", videoSize: null, extend: true },
    ])
  })
})

describe("POST /v1/extend-video — what PixVerse V6 is queued with", () => {
  it("queues the source, the prompt as written, the seconds, the quality and the sound", async () => {
    await post({ duration: 12, resolution: "540p", generateAudio: false })
    expect(queued()).toEqual({
      jobId: "job-1",
      provider: "pixverse-v6-extend",
      video: SOURCE,
      prompt: "she walks out of frame",
      duration: 12,
      resolution: "540p",
      generateAudio: false,
      usageLogId: "usage-1",
    })
  })

  it("queues the seconds and quality it is priced at when none are set: 5 s, 720p, sound on", async () => {
    await post({})
    expect(queued()).toMatchObject({ duration: 5, resolution: "720p", generateAudio: true })
  })

  it("never probes the source (PixVerse continues any clip; it has no tail to cut)", async () => {
    await post({})
    expect(probeVideoSource).not.toHaveBeenCalled()
  })
})

describe("POST /v1/extend-video — PixVerse V6 refuses before reserving", () => {
  it.each(["", "a", "ab", "  ab  ", "\n\t a "])("refuses a prompt under 3 characters before reserving (%j)", async (prompt) => {
    const res = await post({ prompt })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
    nothingReserved()
  })

  it("names the 3-character floor in its refusal", async () => {
    const res = await post({ prompt: "ab" })
    expect(res.json().error.message).toBe("prompt (what happens next) must be at least 3 characters for pixverse-v6-extend")
  })

  it("takes a prompt of exactly 3 characters", async () => {
    const res = await post({ prompt: "run" })
    expect(res.statusCode).toBe(200)
    expect(queued().prompt).toBe("run")
  })

  it("refuses a request with no prompt or no video", async () => {
    const noPrompt = await app.inject({ method: "POST", url: "/v1/extend-video", payload: { userId: USER, provider: "pixverse-v6-extend", videoUrl: SOURCE } })
    expect(noPrompt.statusCode).toBe(400)
    const noVideo = await app.inject({ method: "POST", url: "/v1/extend-video", payload: { userId: USER, provider: "pixverse-v6-extend", prompt: "she walks out of frame" } })
    expect(noVideo.statusCode).toBe(400)
    expect(noVideo.json().error.message).toBe("videoUrl is required for pixverse-v6-extend")
    nothingReserved()
  })

  it.each([0, 16, 2.5, 30, -1])("refuses a duration of %s before reserving (it adds a whole 1–15 seconds)", async (duration) => {
    const res = await post({ duration })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
    nothingReserved()
  })

  it("says which lengths it takes", async () => {
    const res = await post({ duration: 16 })
    expect(res.json().error.message).toBe("duration must be 1–15 seconds for pixverse-v6-extend")
  })

  it("refuses 480p on the API, naming the qualities it renders", async () => {
    const res = await post({ resolution: "480p" })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toEqual({ code: "validation_error", message: "resolution must be 360p, 540p, 720p or 1080p for pixverse-v6-extend" })
    nothingReserved()
  })

  it("refuses reference images (PixVerse V6's extend takes none)", async () => {
    const res = await post({ referenceImageUrls: ["https://cdn.example.com/ref.png"] })
    expect(res.statusCode).toBe(400)
    nothingReserved()
  })
})

describe("POST /v1/extend-video — the qualities only PixVerse V6 renders", () => {
  it.each(["seedance-2-5-extend", "seedance-2-0-extend", "kling-4-extend"])("refuses 360p and 540p on %s", async (provider) => {
    for (const resolution of ["360p", "540p"]) {
      const res = await post({ provider, resolution, duration: 5 })
      expect(res.statusCode, resolution).toBe(400)
      expect(res.json().error.message, resolution).toMatch(new RegExp(`^resolution must be .* for ${provider}$`))
    }
    nothingReserved()
  })
})
