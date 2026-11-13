// @test-units-by-name prices and validates only the extend-video node it names
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

// ---------------------------------------------------------------------------
// POST /v1/extend-video on Grok (`grok-extend`), which extends only Grok's
// own clips, named by their task: the source check runs before anything is
// priced against a balance or reserved, and the run is priced on the SOURCE's
// resolution row — never a resolution the request names — and queued with
// the task id the check matched.
// ---------------------------------------------------------------------------

const h = vi.hoisted(() => ({
  /** Each guard run: the credit id it priced and the video the free-credit limits judge. */
  guarded: [] as Array<{ id: string; video: unknown }>,
  /** Each job the route inserted. */
  inserted: [] as Array<Record<string, unknown>>,
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

// The source check itself is held by its own tests (lib/__tests__/grok-extend-source.test.ts).
vi.mock("@/lib/grok-extend-source.js", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  resolveGrokExtendSource: vi.fn(),
}))

import { extendVideoRoutes, resolveExtendVideoIdentifier } from "../extend-video.js"
import { registerRetiredVideoProviderHook } from "../../middleware/retired-video-provider.js"
import { supabase } from "../../lib/supabase.js"
import { videoQueue } from "../../lib/queue.js"
import { reserveCreditsForJob } from "../../middleware/credit-guard.js"
import { probeVideoSource } from "../../providers/video/ffmpeg-utils.js"
import { GROK_EXTEND_SOURCE_CODE, GROK_EXTEND_SOURCE_MESSAGE, resolveGrokExtendSource } from "../../lib/grok-extend-source.js"
import { STATIC_CREDIT_COSTS } from "../../ee/billing/credits.js"

const USER = "00000000-0000-4000-8000-000000000001"
const TASK = "task-grok-src"
const REFUSAL = { ok: false as const, code: GROK_EXTEND_SOURCE_CODE as typeof GROK_EXTEND_SOURCE_CODE, message: GROK_EXTEND_SOURCE_MESSAGE }

let app: FastifyInstance

/** The source check answers a Grok clip of this resolution and length. */
function source(resolution: "480p" | "720p", sourceSec = 6.041667, taskId = TASK): void {
  vi.mocked(resolveGrokExtendSource).mockResolvedValue({ ok: true, sourceSec, resolution, taskId })
}

beforeEach(async () => {
  vi.clearAllMocks()
  h.guarded.length = 0
  h.inserted.length = 0
  source("480p")

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
  const insert = vi.fn((row: Record<string, unknown>) => {
    h.inserted.push(row)
    return { select: vi.fn().mockReturnValue({ single }) }
  })
  vi.mocked(supabase.from).mockReturnValue({ insert } as never)
})

afterEach(async () => {
  await app.close()
})

const post = (payload: Record<string, unknown>) =>
  app.inject({
    method: "POST",
    url: "/v1/extend-video",
    payload: { userId: USER, provider: "grok-extend", taskId: TASK, prompt: "the fox turns and runs into the snow", ...payload },
  })

function queued(): Record<string, unknown> {
  expect(videoQueue.add).toHaveBeenCalledTimes(1)
  return vi.mocked(videoQueue.add).mock.calls[0]![1] as Record<string, unknown>
}

const reservedId = () => vi.mocked(reserveCreditsForJob).mock.calls[0]![3]

/** Nothing was priced against a balance, reserved, inserted or queued. */
function nothingReserved(): void {
  expect(h.guarded).toEqual([])
  expect(reserveCreditsForJob).not.toHaveBeenCalled()
  expect(h.inserted).toEqual([])
  expect(videoQueue.add).not.toHaveBeenCalled()
}

describe("POST /v1/extend-video — Grok's price", () => {
  it("prices grok-extend on the source's resolution row", async () => {
    // The guard and the reservation name one id: the seconds added at the source's resolution.
    for (const [resolution, duration, id] of [
      ["480p", 6, "grok-extend:6s:480p"],
      ["480p", 10, "grok-extend:10s:480p"],
      ["720p", 6, "grok-extend:6s:720p"],
      ["720p", 10, "grok-extend:10s:720p"],
    ] as const) {
      h.guarded.length = 0
      vi.mocked(reserveCreditsForJob).mockClear()
      source(resolution)
      const res = await post({ duration })
      expect(res.statusCode, id).toBe(200)
      expect(h.guarded.map((g) => g.id), id).toEqual([id])
      expect(reservedId(), id).toBe(id)
      expect(STATIC_CREDIT_COSTS[id], id).toBeGreaterThan(0)
    }
  })

  it("never prices a resolution the request names: a 720p source is held at 720p whatever the body says, and a 480p source at 480p", async () => {
    source("720p")
    await post({ duration: 6, resolution: "480p" })
    expect(h.guarded.map((g) => g.id)).toEqual(["grok-extend:6s:720p"])
    expect(reservedId()).toBe("grok-extend:6s:720p")

    h.guarded.length = 0
    vi.mocked(reserveCreditsForJob).mockClear()
    vi.mocked(videoQueue.add).mockClear()
    source("480p")
    await post({ duration: 10, resolution: "1080p" })
    expect(h.guarded.map((g) => g.id)).toEqual(["grok-extend:10s:480p"])
    expect(reservedId()).toBe("grok-extend:10s:480p")
    expect(queued().resolution).toBe("480p")
  })

  it("an unset length is its default, 6 s", async () => {
    await post({})
    expect(reservedId()).toBe("grok-extend:6s:480p")
    expect(queued().duration).toBe(6)
  })

  it("hands the guard the run's video, at the source's resolution, marked an extension", async () => {
    source("720p")
    await post({ duration: 10, resolution: "480p" })
    expect(h.guarded.map((g) => g.video)).toEqual([
      { provider: "grok-extend", duration: 10, resolution: "720p", videoSize: null, extend: true },
    ])
  })

  it("a request that never met the source check is quoted at the dearer row, never the body's resolution", () => {
    expect(resolveExtendVideoIdentifier({ provider: "grok-extend", duration: 6, resolution: "480p" })).toBe("grok-extend:6s:720p")
    expect(resolveExtendVideoIdentifier({ provider: "grok-extend", duration: 10 }, "480p")).toBe("grok-extend:10s:480p")
    expect(resolveExtendVideoIdentifier({ provider: "grok-extend", duration: 10, resolution: "480p" }, "720p")).toBe("grok-extend:10s:720p")
  })
})

describe("POST /v1/extend-video — Grok's source", () => {
  it("checks the source by the task id it names, within 20 seconds, before pricing", async () => {
    await post({})
    expect(resolveGrokExtendSource).toHaveBeenCalledTimes(1)
    expect(resolveGrokExtendSource).toHaveBeenCalledWith({ taskId: TASK, userId: USER, probeTimeoutMs: 20_000 })
  })

  it("refuses a source Grok cannot extend before reserving, in the approved words", async () => {
    vi.mocked(resolveGrokExtendSource).mockResolvedValue(REFUSAL)
    const res = await post({})
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toEqual({ code: "grok_extend_source", message: GROK_EXTEND_SOURCE_MESSAGE })
    nothingReserved()
  })

  it("refuses a request that names no source task (an uploaded video wired in) the same way, before reserving", async () => {
    const res = await post({ taskId: undefined, videoUrl: "https://cdn.example.com/upload.mp4" })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toEqual({ code: "grok_extend_source", message: GROK_EXTEND_SOURCE_MESSAGE })
    nothingReserved()
  })

  it("accepts the deprecated kieTaskId spelling of the source task", async () => {
    const res = await post({ taskId: undefined, kieTaskId: TASK })
    expect(res.statusCode).toBe(200)
    expect(resolveGrokExtendSource).toHaveBeenCalledWith({ taskId: TASK, userId: USER, probeTimeoutMs: 20_000 })
  })

  it("never probes the video itself: the check measures the stored clip", async () => {
    await post({ videoUrl: "https://cdn.example.com/x.mp4" })
    expect(probeVideoSource).not.toHaveBeenCalled()
  })
})

describe("POST /v1/extend-video — what Grok is queued with", () => {
  it("queues the task id the check matched, the prompt as written, the seconds, and the source's length and resolution", async () => {
    source("720p", 10.041667, TASK)
    await post({ taskId: `  ${TASK} `, duration: 10, resolution: "480p" })
    expect(queued()).toEqual({
      jobId: "job-1",
      provider: "grok-extend",
      kieTaskId: TASK,
      prompt: "the fox turns and runs into the snow",
      duration: 10,
      resolution: "720p",
      sourceSec: 10.041667,
      usageLogId: "usage-1",
    })
  })

  it("records the job as a grok-extend run, at the source's resolution — never as the Grok model it extends", async () => {
    source("720p")
    await post({ duration: 6, resolution: "480p" })
    expect(h.inserted).toHaveLength(1)
    const input = h.inserted[0]!.input_data as Record<string, unknown>
    expect(input.provider).toBe("grok-extend")
    expect(input.resolvedModel).toBe("grok-extend")
    expect(input.resolution).toBe("720p")
    expect(h.inserted[0]!.job_type).toBe("extend-video")
  })
})

describe("POST /v1/extend-video — Grok refuses before reserving", () => {
  it.each([5, 8, 15, 1, 20])("refuses a duration of %s (it adds 6 or 10 seconds)", async (duration) => {
    const res = await post({ duration })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toEqual({ code: "validation_error", message: "duration must be 6 or 10 seconds for grok-extend" })
    expect(resolveGrokExtendSource).not.toHaveBeenCalled()
    nothingReserved()
  })

  it("refuses a request with no prompt", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/extend-video", payload: { userId: USER, provider: "grok-extend", taskId: TASK } })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toEqual({ code: "validation_error", message: "prompt (what happens next) is required for grok-extend" })
    nothingReserved()
  })

  it("refuses reference images (Grok's extend takes none)", async () => {
    const res = await post({ referenceImageUrls: ["https://cdn.example.com/ref.png"] })
    expect(res.statusCode).toBe(400)
    nothingReserved()
  })
})
