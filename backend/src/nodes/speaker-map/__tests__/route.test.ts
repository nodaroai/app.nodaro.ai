/**
 * POST /v1/speaker-map — validation and pricing at the REST ingress.
 *
 * What this pins:
 *  - 2..6 sources with unique ids, a master / wide that names one of them (the
 *    wide a camera, never the master too), a transcript, offsets that are an
 *    Audio Sync result — each refusal a 400 naming the problem, BEFORE the
 *    credit guard;
 *  - a transcript with no speaker labels is a 422 `no_speakers`, also before
 *    the guard, so nothing is reserved;
 *  - the guard and the reservation both name the one flat row, and the queued
 *    job carries the body with the lead defaulted to 3 dB.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify"

const m = vi.hoisted(() => ({
  guardMode: "pass" as "pass" | "insufficient",
  guardIds: [] as string[],
  insertJob: vi.fn(),
  reserve: vi.fn(),
  queueAdd: vi.fn(),
}))

vi.mock("@/lib/supabase.js", () => ({ supabase: { from: vi.fn() } }))
vi.mock("@/lib/insert-job.js", () => ({ insertJob: m.insertJob }))
vi.mock("@/lib/queue.js", () => ({ videoQueue: { add: m.queueAdd }, redis: {} }))
vi.mock("@/middleware/credit-guard.js", () => ({
  creditGuard: (resolve: (req: FastifyRequest) => string) =>
    async (req: FastifyRequest, reply: { status: (n: number) => { send: (b: unknown) => unknown } }) => {
      m.guardIds.push(resolve(req))
      if (m.guardMode === "insufficient") {
        return reply.status(402).send({ error: { code: "insufficient_credits", message: "Insufficient credits" } })
      }
    },
  reserveCreditsForJob: m.reserve,
}))

import { route } from "../route.js"

const USER_ID = "00000000-0000-4000-8000-000000000001"
const src = (id: string, kind?: "video" | "audio") => ({ id, url: `https://media.test/${id}.${kind === "audio" ? "m4a" : "mp4"}`, ...(kind ? { kind } : {}) })
const sources = (n: number) => Array.from({ length: n }, (_, i) => src(`cam${i + 1}`))
const TRANSCRIPT = { text: "hi there", words: [{ text: "hi", startMs: 0, endMs: 500, speaker: "A" }, { text: "there", startMs: 1000, endMs: 1500, speaker: "B" }] }
const OFFSETS = { version: 1, reference: "cam1", offsets: [{ sourceId: "cam1", offsetMs: 0, confidence: 1 }, { sourceId: "cam2", offsetMs: 80, confidence: 0.9 }], notes: [] }
const body = (over: Record<string, unknown> = {}) => ({ sources: sources(2), transcript: TRANSCRIPT, ...over })

async function makeApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    req.userId = USER_ID
  })
  await app.register(route)
  await app.ready()
  return app
}

async function post(payload: unknown) {
  const app = await makeApp()
  return app.inject({ method: "POST", url: "/v1/speaker-map", payload: payload as Record<string, unknown> })
}

const nothingDone = () => {
  expect(m.guardIds).toEqual([])
  expect(m.insertJob).not.toHaveBeenCalled()
  expect(m.reserve).not.toHaveBeenCalled()
  expect(m.queueAdd).not.toHaveBeenCalled()
}

beforeEach(() => {
  m.guardMode = "pass"
  m.guardIds = []
  m.insertJob.mockReset().mockResolvedValue({ data: { id: "job-1" }, error: null })
  m.reserve.mockReset().mockResolvedValue({ usageLogId: "ul-1", creditsReserved: 10, watermark: false })
  m.queueAdd.mockReset().mockResolvedValue({ id: "q-1" })
})

describe("POST /v1/speaker-map — validation", () => {
  it.each([
    ["one source", body({ sources: sources(1) }), /sources/],
    ["seven sources", body({ sources: sources(7) }), /sources/],
    ["no sources", { transcript: TRANSCRIPT }, /sources/],
    ["a source whose url is not a URL", body({ sources: [{ id: "a", url: "not a url" }, src("b")] }), /sources\.0\.url/],
    ["a private-network url", body({ sources: [{ id: "a", url: "http://127.0.0.1/a.mp4" }, src("b")] }), /sources\.0\.url/],
    ["a source kind that is neither video nor audio", body({ sources: [{ ...src("a"), kind: "image" }, src("b")] }), /sources\.0\.kind/],
    ["no transcript", { sources: sources(2) }, /transcript is required/],
    ["a lead past 30 dB", body({ marginDb: 31 }), /marginDb/],
  ])("%s → 400 validation_error naming it; nothing guarded, created, reserved or enqueued", async (_name, payload, field) => {
    const res = await post(payload)
    expect(res.statusCode).toBe(400)
    const err = (res.json() as { error: { code: string; message: string } }).error
    expect(err.code).toBe("validation_error")
    expect(err.message).toMatch(field)
    nothingDone()
  })

  it.each([
    ["duplicate source ids", body({ sources: [src("cam"), src("mic"), src("cam")] }), 'sources.2.id: source id "cam" appears more than once — every source needs its own id'],
    ["a master that is not one of the sources", body({ masterSourceId: "camX" }), 'masterSourceId: "camX" is not one of the sources\' ids'],
    ["a wide shot that is not one of the sources", body({ wideSourceId: "camX" }), 'wideSourceId: "camX" is not one of the sources\' ids'],
    ["a wide shot on a sound-only source", body({ sources: [src("cam1"), src("mic", "audio")], wideSourceId: "mic" }), 'wideSourceId: "mic" is a sound-only recording — the wide shot must be a camera'],
    ["master and wide on one source", body({ masterSourceId: "cam1", wideSourceId: "cam1" }), 'wideSourceId: "cam1" is also the master audio — pick a different recording for each'],
    ["offsets that are not an Audio Sync result", body({ offsets: { text: "a transcript" } }), "offsets: not an Audio Sync result (it has no offsets list)"],
  ])("%s → 400 naming the problem, before the guard", async (_name, payload, message) => {
    const res = await post(payload)
    expect(res.statusCode).toBe(400)
    expect((res.json() as { error: { code: string; message: string } }).error).toEqual(expect.objectContaining({ code: "validation_error", message }))
    nothingDone()
  })

  it("a transcript with no speaker labels → 422 no_speakers, before any reserve (as an object or as its JSON)", async () => {
    for (const transcript of [{ text: "hi", words: [{ text: "hi", startMs: 0, endMs: 900 }] }, JSON.stringify({ text: "hi" })]) {
      const res = await post(body({ transcript }))
      expect(res.statusCode).toBe(422)
      expect((res.json() as { error: { code: string; message: string } }).error).toEqual({
        code: "no_speakers",
        message: "The transcript has no speaker labels — turn on speaker detection in Transcribe so Speaker Map can tell who is talking.",
      })
      nothingDone()
    }
  })

  it("an invalid body is a 400 even for a caller who could not afford the run (validated before the guard)", async () => {
    m.guardMode = "insufficient"
    expect((await post(body({ sources: sources(1) }))).statusCode).toBe(400)
    expect((await post(body({ transcript: { text: "no labels" } }))).statusCode).toBe(422)
  })
})

describe("POST /v1/speaker-map — pricing and dispatch", () => {
  it("guards and reserves the flat row; inserts one job; queues speaker-map on the video queue with the lead defaulted to 3", async () => {
    const payload = body({ sources: [src("cam1"), src("cam2"), src("mic", "audio")], offsets: OFFSETS, masterSourceId: "mic", wideSourceId: "cam1" })
    const res = await post(payload)
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ jobId: "job-1" })
    expect(m.guardIds).toEqual(["speaker-map"])
    expect(m.reserve).toHaveBeenCalledTimes(1)
    expect(m.reserve.mock.calls[0]![2]).toBe("job-1")
    expect(m.reserve.mock.calls[0]![3]).toBe("speaker-map")
    expect(m.insertJob).toHaveBeenCalledTimes(1)
    const row = m.insertJob.mock.calls[0]![1] as { input_data: Record<string, unknown>; user_id: string; status: string }
    expect(row.user_id).toBe(USER_ID)
    expect(row.status).toBe("pending")
    // The transcript (up to 24 MB) stays OUT of input_data, which get_job /
    // list_jobs / admin return verbatim: its size is kept instead. The queue
    // job below carries it whole.
    const { transcript: _t, ...rest } = payload
    expect(row.input_data).toEqual({ ...rest, transcriptWordCount: 2, type: "speaker-map" })
    expect(m.queueAdd).toHaveBeenCalledWith("speaker-map", {
      jobId: "job-1",
      sources: payload.sources,
      transcript: TRANSCRIPT,
      offsets: OFFSETS,
      masterSourceId: "mic",
      wideSourceId: "cam1",
      marginDb: 3,
      usageLogId: "ul-1",
    })
  })

  it("a transcript sent as its JSON string is counted the same, and never stored on the row", async () => {
    await post(body({ transcript: JSON.stringify(TRANSCRIPT) }))
    const row = m.insertJob.mock.calls[0]![1] as { input_data: Record<string, unknown> }
    expect(row.input_data).not.toHaveProperty("transcript")
    expect(row.input_data.transcriptWordCount).toBe(2)
    expect((m.queueAdd.mock.calls[0]![1] as { transcript: unknown }).transcript).toBe(JSON.stringify(TRANSCRIPT))
  })

  it("a lead the caller sets is sent as given; an MCP caller's client name is kept on the row", async () => {
    await post({ ...body({ marginDb: 6 }), mcp_client: "Claude" })
    const [, job] = m.queueAdd.mock.calls[0] as [string, Record<string, unknown>]
    expect(job.marginDb).toBe(6)
    expect((m.insertJob.mock.calls[0]![1] as { mcp_client?: string }).mcp_client).toBe("Claude")
  })

  it("a 402 from the guard stops the run before anything is created", async () => {
    m.guardMode = "insufficient"
    const res = await post(body())
    expect(res.statusCode).toBe(402)
    expect(m.guardIds).toEqual(["speaker-map"])
    expect(m.insertJob).not.toHaveBeenCalled()
    expect(m.queueAdd).not.toHaveBeenCalled()
  })

  it("takes a multi-hour word-level transcript (the body limit is raised past the 1 MB default)", async () => {
    const words = Array.from({ length: 30_000 }, (_, i) => ({ text: "word", startMs: i * 300, endMs: i * 300 + 250, speaker: i % 2 ? "A" : "B" }))
    const res = await post(body({ transcript: { text: "", words } }))
    expect(res.statusCode).toBe(200)
  })
})
