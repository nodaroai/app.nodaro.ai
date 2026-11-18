/**
 * POST /v1/audio-isolation is priced by the length of its audio as the server
 * reads it (decided 2026-11-18), before anything is held: one
 * `elevenlabs-isolation:per-10s` unit per started ten seconds, at least one.
 * Audio past 30 minutes (0.05 s of grace) or that cannot be read is refused
 * with nothing held and no job row. The probe, the guard and the queue are
 * stood in for; the guard runs its `beforePricing` step as the real one does.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

const state = vi.hoisted(() => ({
  /** What the audio reads as, in seconds, or "unreadable". */
  audio: 8 as number | "unreadable",
  guardCalls: [] as Array<{ identifier: string; base: number | undefined }>,
}))

vi.mock("@/lib/video-utility-probe.js", () => ({
  probeSoundLengthSec: vi.fn(async () => {
    if (state.audio === "unreadable") throw new Error("ffprobe: Invalid data found when processing input")
    return state.audio
  }),
}))
vi.mock("@/lib/credit-base-cost.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/credit-base-cost.js")>()),
  // The row's base × the units, rounded up once (the real composition, with the seeded row).
  unitRateBaseCredits: async (rateId: string, units: number) => (rateId === "elevenlabs-isolation:per-10s" ? Math.ceil(10 * units) : 0),
}))
vi.mock("@/lib/insert-job.js", () => ({ insertJob: vi.fn(async () => ({ data: { id: "job-1" }, error: null })) }))
vi.mock("@/lib/queue.js", () => ({ videoQueue: { add: vi.fn().mockResolvedValue({ id: "queue-job-1" }) }, redis: {} }))
vi.mock("@/middleware/credit-guard.js", () => ({
  // As the real guard: its `beforePricing` step (the length) after its doors, then the pricing.
  creditGuard: (
    resolve: (req: unknown) => string,
    opts?: { computeCredits?: (body: unknown, req: unknown) => Promise<number | undefined>; beforePricing?: (req: unknown, reply: unknown) => Promise<unknown> },
  ) =>
    async (req: { body: unknown }, reply: { sent: boolean }) => {
      await opts?.beforePricing?.(req, reply)
      if (reply.sent) return
      state.guardCalls.push({ identifier: resolve(req), base: await opts?.computeCredits?.(req.body, req) })
    },
  reserveCreditsForJob: vi.fn().mockResolvedValue({ usageLogId: "usage-1", creditsReserved: 1, watermark: false }),
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

import { audioIsolationRoutes } from "../audio-isolation.js"
import { insertJob } from "@/lib/insert-job.js"
import { videoQueue } from "@/lib/queue.js"
import { reserveCreditsForJob } from "@/middleware/credit-guard.js"

const USER = "00000000-0000-4000-8000-000000000001"

describe("POST /v1/audio-isolation — priced by the length of the audio the server reads", () => {
  let app: FastifyInstance

  beforeEach(async () => {
    vi.clearAllMocks()
    state.audio = 8
    state.guardCalls = []
    app = Fastify({ logger: false })
    app.addHook("preHandler", async (req) => {
      const b = req.body as Record<string, unknown> | undefined
      if (typeof b?.userId === "string") req.userId = b.userId
    })
    await app.register(async (i) => { await audioIsolationRoutes(i) })
    await app.ready()
  })

  afterEach(async () => { await app.close() })

  const run = (over: Record<string, unknown> = {}) =>
    app.inject({ method: "POST", url: "/v1/audio-isolation", payload: { audioUrl: "https://cdn.test/interview.mp3", userId: USER, ...over } })

  function expectNothingHeld(): void {
    expect(state.guardCalls).toEqual([])
    expect(insertJob).not.toHaveBeenCalled()
    expect(reserveCreditsForJob).not.toHaveBeenCalled()
    expect(videoQueue.add).not.toHaveBeenCalled()
  }

  it.each([
    [8, 1, 10],
    [30, 3, 30],
    [300, 30, 300],
    [1800, 180, 1800],
  ])("%s s of audio is held on %s units: %s base", async (sec, units, base) => {
    state.audio = sec
    const res = await run()
    expect(res.statusCode).toBe(200)
    expect(res.json().jobId).toBe("job-1")
    expect(state.guardCalls).toEqual([{ identifier: "elevenlabs-isolation:per-10s", base }])
    expect(vi.mocked(reserveCreditsForJob).mock.calls[0]![3]).toBe("elevenlabs-isolation:per-10s")
    // The job records the length read and the units held; the worker is handed them.
    const inserted = vi.mocked(insertJob).mock.calls[0]![1] as { input_data: Record<string, unknown> }
    expect(inserted.input_data).toMatchObject({ audioUrl: "https://cdn.test/interview.mp3", type: "audio-isolation", audioIsolationSec: sec, audioIsolationUnits: units })
    expect(vi.mocked(videoQueue.add).mock.calls[0]).toEqual(["audio-isolation", expect.objectContaining({ jobId: "job-1", audioUrl: "https://cdn.test/interview.mp3", audioIsolationUnits: units, usageLogId: "usage-1" })])
  })

  it("forgives 0.05 s past a mark: 30.04 s is 3 units, 30.06 s is 4", async () => {
    state.audio = 30.04
    await run()
    state.audio = 30.06
    await run()
    expect(state.guardCalls.map((c) => c.base)).toEqual([30, 40])
  })

  it("a length or unit count the request names is dropped: the server's reading prices the run", async () => {
    state.audio = 61
    await run({ audioIsolationSec: 1, audioIsolationUnits: 1 })
    expect(state.guardCalls).toEqual([{ identifier: "elevenlabs-isolation:per-10s", base: 70 }])
  })

  it("refuses a 31-minute audio with nothing held, naming the limit", async () => {
    state.audio = 31 * 60
    const res = await run()
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("audio_too_long")
    expect(res.json().error.message).toContain("30 minutes")
    expect(res.json().error.message).toContain("split or trim")
    expectNothingHeld()
  })

  it("accepts audio within 0.05 s past 30 minutes and holds it at the cap", async () => {
    state.audio = 1800.05
    const res = await run()
    expect(res.statusCode).toBe(200)
    expect(state.guardCalls).toEqual([{ identifier: "elevenlabs-isolation:per-10s", base: 1800 }])
  })

  it("refuses audio that cannot be read with nothing held, never priced on a guess", async () => {
    state.audio = "unreadable"
    const res = await run()
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("audio_unreadable")
    expectNothingHeld()
  })

  it("a body the schema refuses is a 400 before anything is read", async () => {
    const res = await run({ audioUrl: undefined })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
    expectNothingHeld()
  })

  it("returns 401 when no user is signed in", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/audio-isolation", payload: { audioUrl: "https://cdn.test/interview.mp3" } })
    expect(res.statusCode).toBe(401)
    expect(res.json().error.code).toBe("unauthorized")
  })

  it("returns 500 when the job insert fails", async () => {
    vi.mocked(insertJob).mockResolvedValueOnce({ data: null, error: { message: "DB connection failed" } } as never)
    const res = await run()
    expect(res.statusCode).toBe(500)
    expect(res.json().error.code).toBe("internal_error")
  })
})
