import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import Fastify from "fastify"

/**
 * POST /v1/pitch-tempo: the input's length is measured BEFORE the credit guard,
 * the guard prices `pitch-tempo:<N>m` from it, and every refusal (bad body,
 * unreadable length, over 30 minutes) happens with nothing reserved and no job.
 */

const state = vi.hoisted(() => ({
  probe: (async () => 190) as (url: string) => Promise<number>,
  probedUrls: [] as string[],
  guardIds: [] as string[],
  reserveIds: [] as string[],
  inserts: [] as Array<Record<string, unknown>>,
  queued: [] as Array<{ name: string; data: Record<string, unknown> }>,
}))

vi.mock("../../providers/video/ffmpeg-utils.js", () => ({
  probeMediaDuration: async (url: string) => {
    state.probedUrls.push(url)
    return state.probe(url)
  },
}))

vi.mock("../../middleware/credit-guard.js", () => ({
  creditGuard: (resolveModel: (req: unknown) => string) => async (req: { userId?: string }) => {
    state.guardIds.push(resolveModel(req))
    req.userId = "user-1"
  },
  reserveCreditsForJob: async (_req: unknown, _reply: unknown, _jobId: string, model: string) => {
    state.reserveIds.push(model)
    return { usageLogId: "ulog-1", creditsReserved: 1, watermark: false }
  },
}))

vi.mock("../../lib/insert-job.js", () => ({
  insertJob: async (_req: unknown, row: Record<string, unknown>) => {
    state.inserts.push(row)
    return { data: { id: "job-1" }, error: null }
  },
}))

vi.mock("../../lib/queue.js", () => ({
  videoQueue: {
    add: async (name: string, data: Record<string, unknown>) => {
      state.queued.push({ name, data })
      return { id: "q-1" }
    },
  },
}))

import { pitchTempoRoutes } from "../pitch-tempo.js"

let app: ReturnType<typeof Fastify>

beforeEach(async () => {
  state.probe = async () => 190
  state.probedUrls = []
  state.guardIds = []
  state.reserveIds = []
  state.inserts = []
  state.queued = []
  app = Fastify()
  await app.register(pitchTempoRoutes)
})

afterEach(async () => {
  await app.close()
})

const post = (payload: Record<string, unknown>) => app.inject({ method: "POST", url: "/v1/pitch-tempo", payload })

describe("POST /v1/pitch-tempo", () => {
  it("prices and reserves the started minutes of the measured input, and queues the job", async () => {
    const res = await post({ audioUrl: "https://cdn.example.com/a.mp3", semitones: 3 })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ jobId: "job-1" })
    expect(state.guardIds).toEqual(["pitch-tempo:4m"])
    expect(state.reserveIds).toEqual(["pitch-tempo:4m"])
    expect(state.inserts[0]!.input_data).toMatchObject({
      type: "pitch-tempo",
      audioUrl: "https://cdn.example.com/a.mp3",
      semitones: 3,
      tempo: 1,
      preserveFormants: true,
      duration_seconds: 190,
      bucketKey: "pitch-tempo:4m",
    })
    expect(state.queued).toEqual([
      {
        name: "pitch-tempo",
        data: { jobId: "job-1", audioUrl: "https://cdn.example.com/a.mp3", semitones: 3, tempo: 1, preserveFormants: true, usageLogId: "ulog-1" },
      },
    ])
    expect(JSON.stringify(state.queued)).not.toContain("__probedDuration")
  })

  it("measures the video when a video is given", async () => {
    await post({ videoUrl: "https://cdn.example.com/v.mp4" })
    expect(state.probedUrls).toEqual(["https://cdn.example.com/v.mp4"])
  })

  it.each([
    [60, "pitch-tempo:1m"],
    [60.01, "pitch-tempo:2m"],
    [1800, "pitch-tempo:30m"],
  ])("a %ss input reserves %s", async (sec, id) => {
    state.probe = async () => sec
    await post({ audioUrl: "https://cdn.example.com/a.mp3" })
    expect(state.reserveIds).toEqual([id])
  })

  it("refuses an input over 30 minutes before the guard, with no job", async () => {
    state.probe = async () => 1800.4
    const res = await post({ audioUrl: "https://cdn.example.com/a.mp3" })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("media_duration_exceeds_limit")
    expect(state.guardIds).toEqual([])
    expect(state.inserts).toEqual([])
  })

  it("refuses media whose length can't be read, with no job (no fallback length)", async () => {
    state.probe = async () => {
      throw new Error("ffprobe failed")
    }
    const res = await post({ audioUrl: "https://cdn.example.com/a.mp3" })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("invalid_media_duration")
    expect(state.guardIds).toEqual([])
    expect(state.inserts).toEqual([])
  })

  it.each([
    [{}],
    [{ audioUrl: "https://cdn.example.com/a.mp3", videoUrl: "https://cdn.example.com/v.mp4" }],
    [{ audioUrl: "https://cdn.example.com/a.mp3", semitones: 13 }],
    [{ audioUrl: "https://cdn.example.com/a.mp3", tempo: 0.4 }],
    [{ audioUrl: "https://cdn.example.com/a.mp3", tempo: 2.5 }],
    [{ audioUrl: "http://127.0.0.1/a.mp3" }],
  ])("rejects an invalid body %j before measuring anything", async (body) => {
    const res = await post(body)
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
    expect(state.probedUrls).toEqual([])
    expect(state.guardIds).toEqual([])
  })
})
