/**
 * POST /v1/voice-changer is priced by the length of its audio as the server
 * reads it (decided 2026-11-22), before anything is held: one
 * `elevenlabs-voice-changer:per-10s` unit per started ten seconds, at least
 * one. The video is read when the request names one (a video wins, as the
 * worker does), else the audio. Audio past 5 minutes (0.05 s of grace) or that
 * cannot be read is refused with nothing held and no job row. The model that
 * runs is still `elevenlabs-voice-changer`. The probe, the guard and the queue
 * are stood in for; the guard runs its `beforePricing` step as the real one does.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

const state = vi.hoisted(() => ({
  /** What the audio reads as, in seconds, or why it cannot be read. */
  audio: 8 as number | "unreadable" | "no-audio-stream",
  read: [] as string[],
  guardCalls: [] as Array<{ identifier: string; base: number | undefined }>,
}))

vi.mock("@/lib/video-utility-probe.js", () => ({
  probeSoundLengthSec: vi.fn(async (src: string) => {
    state.read.push(src)
    if (state.audio === "unreadable") throw new Error("ffprobe: Invalid data found when processing input")
    if (state.audio === "no-audio-stream") throw Object.assign(new Error("clip unreadable: no audio stream"), { name: "ClipUnreadableError" })
    return state.audio
  }),
}))
vi.mock("@/lib/credit-base-cost.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/credit-base-cost.js")>()),
  // The row's base × the units, rounded up once (the real composition, with the seeded row).
  unitRateBaseCredits: async (rateId: string, units: number) => (rateId === "elevenlabs-voice-changer:per-10s" ? Math.ceil(10 * units) : 0),
}))
vi.mock("@/lib/supabase.js", () => ({ supabase: {} }))
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
// The voice lock is its own test (voice-changer-voice-lock.test.ts): every voice passes here.
vi.mock("@/lib/voice-gender.js", () => ({
  judgeVoice: vi.fn(async () => ({ allowed: true })),
  voiceNotAvailableBody: () => ({ error: { code: "voice_not_available", message: "The selected voice is not available on this deployment." } }),
}))

import { voiceChangerRoutes } from "../voice-changer.js"
import { insertJob } from "@/lib/insert-job.js"
import { videoQueue } from "@/lib/queue.js"
import { reserveCreditsForJob } from "@/middleware/credit-guard.js"

const USER = "00000000-0000-4000-8000-000000000001"
const AUDIO = "https://cdn.test/interview.mp3"
const VIDEO = "https://cdn.test/talking.mp4"
const RATE = "elevenlabs-voice-changer:per-10s"

describe("POST /v1/voice-changer — priced by the length of the audio the server reads", () => {
  let app: FastifyInstance

  beforeEach(async () => {
    vi.clearAllMocks()
    state.audio = 8
    state.read = []
    state.guardCalls = []
    app = Fastify({ logger: false })
    app.addHook("preHandler", async (req) => {
      const b = req.body as Record<string, unknown> | undefined
      if (typeof b?.userId === "string") req.userId = b.userId
    })
    await app.register(async (i) => { await voiceChangerRoutes(i) })
    await app.ready()
  })

  afterEach(async () => { await app.close() })

  const run = (over: Record<string, unknown> = {}) =>
    app.inject({ method: "POST", url: "/v1/voice-changer", payload: { audioUrl: AUDIO, voiceId: "Rachel", userId: USER, ...over } })

  function expectNothingHeld(): void {
    expect(state.guardCalls).toEqual([])
    expect(insertJob).not.toHaveBeenCalled()
    expect(reserveCreditsForJob).not.toHaveBeenCalled()
    expect(videoQueue.add).not.toHaveBeenCalled()
  }

  it.each([
    [8, 1, 10],
    [30, 3, 30],
    [61, 7, 70],
    [300, 30, 300],
  ])("%s s of audio is held on %s units: %s base", async (sec, units, base) => {
    state.audio = sec
    const res = await run()
    expect(res.statusCode).toBe(200)
    expect(res.json().jobId).toBe("job-1")
    expect(state.guardCalls).toEqual([{ identifier: RATE, base }])
    expect(vi.mocked(reserveCreditsForJob).mock.calls[0]![3]).toBe(RATE)
    // The job records the length read, the units held, and the model that runs; the worker is handed the units.
    const inserted = vi.mocked(insertJob).mock.calls[0]![1] as { input_data: Record<string, unknown> }
    expect(inserted.input_data).toMatchObject({ audioUrl: AUDIO, type: "voice-changer", resolvedModel: "elevenlabs-voice-changer", voiceChangerSec: sec, voiceChangerUnits: units })
    expect(vi.mocked(videoQueue.add).mock.calls[0]).toEqual(["voice-changer", expect.objectContaining({ jobId: "job-1", audioUrl: AUDIO, voiceId: "Rachel", voiceChangerSec: sec, voiceChangerUnits: units, usageLogId: "usage-1" })])
  })

  it("a video wins: its length is read, not the audio's", async () => {
    state.audio = 25
    const res = await run({ videoUrl: VIDEO })
    expect(res.statusCode).toBe(200)
    expect(state.read).toEqual([VIDEO])
    expect(state.guardCalls).toEqual([{ identifier: RATE, base: 30 }])
    expect(vi.mocked(videoQueue.add).mock.calls[0]![1]).toMatchObject({ videoUrl: VIDEO, voiceChangerUnits: 3 })
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
    await run({ voiceChangerSec: 1, voiceChangerUnits: 1 })
    expect(state.guardCalls).toEqual([{ identifier: RATE, base: 70 }])
    const inserted = vi.mocked(insertJob).mock.calls[0]![1] as { input_data: Record<string, unknown> }
    expect(inserted.input_data).toMatchObject({ voiceChangerSec: 61, voiceChangerUnits: 7 })
  })

  it("refuses a 6-minute audio with nothing held, naming the limit", async () => {
    state.audio = 6 * 60
    const res = await run()
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("audio_too_long")
    expect(res.json().error.message).toContain("5 minutes")
    expect(res.json().error.message).toContain("split or trim")
    expectNothingHeld()
  })

  it("refuses a video whose sound runs past 5 minutes the same way", async () => {
    state.audio = 5 * 60 + 1
    const res = await run({ videoUrl: VIDEO })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("audio_too_long")
    expectNothingHeld()
  })

  it("accepts audio within 0.05 s past 5 minutes and holds it at the cap", async () => {
    state.audio = 300.05
    const res = await run()
    expect(res.statusCode).toBe(200)
    expect(state.guardCalls).toEqual([{ identifier: RATE, base: 300 }])
  })

  it("refuses audio that cannot be read with nothing held, never priced on a guess", async () => {
    state.audio = "unreadable"
    const res = await run()
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("audio_unreadable")
    expectNothingHeld()
  })

  it("refuses a file with no sound track with nothing held, saying so", async () => {
    state.audio = "no-audio-stream"
    const res = await run({ videoUrl: VIDEO })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("audio_unreadable")
    expect(res.json().error.message).toContain("no audio track to revoice")
    expectNothingHeld()
  })

  it("a body the schema refuses is a 400 before anything is read", async () => {
    const res = await run({ audioUrl: undefined })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
    expect(state.read).toEqual([])
    expectNothingHeld()
  })

  it("returns 401 when no user is signed in", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/voice-changer", payload: { audioUrl: AUDIO, voiceId: "Rachel" } })
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
