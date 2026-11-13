/**
 * POST /v1/add-captions on Nemotron 3.5 Transcribe (decided 2026-11-13): a
 * request that will transcribe on it is ONE charge, the render plus the video's
 * minutes — measured BEFORE the credit guard, so the guard and the reservation
 * hold `add-captions:kinetic:nemotron:<N>m` and the worker gets the hold to
 * settle against. Everything else is held on the renderer's own row, as before.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"
import { addCaptionsNemotronMinutesId } from "@nodaro/shared/credits"

vi.mock("@/lib/supabase.js", () => {
  const mockFrom = vi.fn()
  return {
    supabase: {
      from: mockFrom,
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "user-123" } },
          error: null,
        }),
      },
    },
  }
})

vi.mock("@/lib/queue.js", () => ({
  videoQueue: {
    add: vi.fn().mockResolvedValue({ id: "queue-job-1" }),
  },
  redis: {},
}))

// The ids the credit guard is asked to check, in order — the guard itself is a
// no-op here; recording its resolver's answer pins WHAT a request is priced on.
const guardIds = vi.hoisted(() => [] as string[])
vi.mock("@/middleware/credit-guard.js", () => ({
  creditGuard: (resolve: (req: unknown) => string) => async (req: unknown) => {
    guardIds.push(resolve(req))
  },
  reserveCreditsForJob: vi.fn().mockResolvedValue({
    usageLogId: "usage-1",
    creditsReserved: 1,
    watermark: false,
  }),
}))

vi.mock("@/lib/admin-check.js", () => ({
  warmAdminCache: vi.fn(),
  checkIsAdmin: vi.fn().mockResolvedValue(false),
}))

vi.mock("@/lib/config.js", () => ({
  config: {
    EDITION: "cloud",
    SUPABASE_URL: "https://test.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "test",
  },
  isCloud: () => true,
  hasCredits: () => true,
  isCommunity: () => false,
  isBusiness: () => false,
  hasAdmin: () => true,
}))

vi.mock("@/lib/url-validator.js", async (importOriginal) => {
  const { z } = await import("zod")
  // The real platform-host test: the route asks the gate exactly when the worker will import.
  const { isAllowedSocialVideoUrl } = await importOriginal<typeof import("@/lib/url-validator.js")>()
  return { safeUrlSchema: z.string().url(), isAllowedSocialVideoUrl }
})

// A Nemotron caption video is measured before the guard (lib/add-captions-nemotron.ts).
const probe = vi.hoisted(() => ({ probeMediaDurationAndSize: vi.fn() }))
vi.mock("@/providers/video/ffmpeg-utils.js", () => ({
  assertSafeProbeSource: vi.fn(async () => {}),
  probeMediaDurationAndSize: probe.probeMediaDurationAndSize,
}))

/** Whether this install relays a Nemotron transcription to the cloud (keyless, connected). */
const cloud = vi.hoisted(() => ({ relays: false }))
vi.mock("@/providers/nodaro/run-on-cloud.js", () => ({
  shouldRunOnCloud: async () => cloud.relays,
}))

import { addCaptionsRoutes } from "../add-captions.js"
import { supabase } from "../../lib/supabase.js"
import { videoQueue } from "../../lib/queue.js"
import { reserveCreditsForJob } from "../../middleware/credit-guard.js"

const USER = "00000000-0000-4000-8000-000000000001"
const VIDEO = "https://cdn.example/talk.mp4"
const NEMOTRON = "nemotron-3-5-transcribe"

let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()
  guardIds.length = 0
  cloud.relays = false
  probe.probeMediaDurationAndSize.mockResolvedValue({ durationSec: 600, sizeBytes: 900 * 1024 * 1024 })
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    const body = req.body as Record<string, unknown> | undefined
    if (body?.userId && typeof body.userId === "string") req.userId = body.userId
  })
  await app.register(async (instance) => {
    await addCaptionsRoutes(instance)
  })
  await app.ready()
})

afterEach(async () => {
  await app.close()
})

function mockJobInsert(jobId = "job-1", error: { message: string } | null = null) {
  const mockSingle = vi.fn().mockResolvedValue({
    data: error ? null : { id: jobId },
    error,
  })
  const mockSelect = vi.fn().mockReturnValue({ single: mockSingle })
  const mockInsert = vi.fn().mockReturnValue({ select: mockSelect })
  const mockFrom = vi.mocked(supabase.from)
  mockFrom.mockReturnValue({ insert: mockInsert } as never)
  return { mockFrom, mockInsert, mockSelect, mockSingle }
}

function post(body: Record<string, unknown>) {
  return app.inject({ method: "POST", url: "/v1/add-captions", payload: { userId: USER, videoUrl: VIDEO, ...body } })
}

function queued(): Record<string, unknown> {
  return vi.mocked(videoQueue.add).mock.calls[0]![1] as Record<string, unknown>
}

describe("POST /v1/add-captions on Nemotron 3.5 Transcribe", () => {
  it("measures the video first and holds the render plus its minutes, in the guard and the reservation alike", async () => {
    const { mockInsert } = mockJobInsert()
    const res = await post({ style: "word-highlight", transcribe_provider: NEMOTRON })
    expect(res.statusCode).toBe(200)
    expect(guardIds).toEqual([addCaptionsNemotronMinutesId(10)])
    expect(vi.mocked(reserveCreditsForJob).mock.calls[0]![3]).toBe(addCaptionsNemotronMinutesId(10))
    // The worker gets the hold and the measured length to settle against; the job records them.
    expect(queued()).toMatchObject({ bucketKey: addCaptionsNemotronMinutesId(10), duration_seconds: 600, transcribe_provider: NEMOTRON })
    expect(mockInsert.mock.calls[0]![0].input_data).toMatchObject({ bucketKey: addCaptionsNemotronMinutesId(10), duration_seconds: 600 })
    expect(probe.probeMediaDurationAndSize).toHaveBeenCalledWith(VIDEO)
  })

  it("never refuses a large video: only its audio track is sent", async () => {
    mockJobInsert()
    probe.probeMediaDurationAndSize.mockResolvedValue({ durationSec: 61, sizeBytes: 4 * 1024 * 1024 * 1024 })
    const res = await post({ style: "karaoke", transcribe_provider: NEMOTRON })
    expect(res.statusCode).toBe(200)
    expect(guardIds).toEqual([addCaptionsNemotronMinutesId(2)])
  })

  it("refuses a video over 60 minutes before anything is held", async () => {
    mockJobInsert()
    probe.probeMediaDurationAndSize.mockResolvedValue({ durationSec: 3700 })
    const res = await post({ style: "karaoke", transcribe_provider: NEMOTRON })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("media_duration_exceeds_limit")
    expect(guardIds).toEqual([])
    expect(vi.mocked(reserveCreditsForJob)).not.toHaveBeenCalled()
    expect(vi.mocked(videoQueue.add)).not.toHaveBeenCalled()
  })

  it("holds 60 minutes for a video whose length cannot be read", async () => {
    mockJobInsert()
    probe.probeMediaDurationAndSize.mockRejectedValue(new Error("ffprobe: invalid data"))
    const res = await post({ style: "karaoke", transcribe_provider: NEMOTRON })
    expect(res.statusCode).toBe(200)
    expect(guardIds).toEqual([addCaptionsNemotronMinutesId(60)])
    expect(queued().duration_seconds).toBeUndefined()
  })

  it("a keyless install that relays the transcription holds the render alone (the cloud bills the minutes) — nothing charged twice", async () => {
    mockJobInsert()
    cloud.relays = true
    const res = await post({ style: "karaoke", transcribe_provider: NEMOTRON })
    expect(res.statusCode).toBe(200)
    expect(guardIds).toEqual(["add-captions:kinetic"])
    expect(vi.mocked(reserveCreditsForJob).mock.calls[0]![3]).toBe("add-captions:kinetic")
    expect(queued().bucketKey).toBeUndefined()
    expect(probe.probeMediaDurationAndSize).not.toHaveBeenCalled()
  })

  it("a Nemotron request that transcribes nothing (its own captions) holds the render alone and measures nothing", async () => {
    mockJobInsert()
    const res = await post({ style: "karaoke", transcribe_provider: NEMOTRON, captions: [{ text: "hi", startMs: 0, endMs: 400 }] })
    expect(res.statusCode).toBe(200)
    expect(guardIds).toEqual(["add-captions:kinetic"])
    expect(probe.probeMediaDurationAndSize).not.toHaveBeenCalled()
  })

  it("the body's userId never decides whether the video is measured (a malformed one is refused by the handler, nothing reserved)", async () => {
    mockJobInsert()
    const res = await app.inject({
      method: "POST",
      url: "/v1/add-captions",
      payload: { userId: "not-a-uuid", videoUrl: VIDEO, style: "karaoke", transcribe_provider: NEMOTRON },
    })
    expect(guardIds).toEqual([addCaptionsNemotronMinutesId(10)])
    expect(res.statusCode).toBe(400)
    expect(vi.mocked(reserveCreditsForJob)).not.toHaveBeenCalled()
  })

  it("no caller can name a hold: a bucketKey in the body is dropped, and another engine stays on the render's row", async () => {
    mockJobInsert()
    const res = await post({ style: "karaoke", transcribe_provider: "elevenlabs-stt", bucketKey: addCaptionsNemotronMinutesId(1) })
    expect(res.statusCode).toBe(200)
    expect(guardIds).toEqual(["add-captions:kinetic"])
    expect(queued().bucketKey).toBeUndefined()
  })
})
