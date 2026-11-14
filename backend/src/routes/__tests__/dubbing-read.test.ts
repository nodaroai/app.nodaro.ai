/**
 * GET /v1/dubbing/:jobId and GET /v1/dubbing/:jobId/captions: the two free
 * reads of a dub that is already made. What a dub reads as is proven in
 * lib/__tests__/dubbing-read-service.test.ts and dubbing-read-captions.test.ts;
 * this pins the routes' wiring: who may ask, what each refusal answers, and
 * that what failed underneath stays in the server log.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import Fastify, { type FastifyInstance, type LightMyRequestResponse } from "fastify"
import rateLimit from "@fastify/rate-limit"
import type { DubbingStructure } from "@nodaro/shared/media"

vi.mock("@/lib/supabase.js", () => ({ supabase: { from: vi.fn() } }))
vi.mock("@/lib/dubbing-read-service.js", () => ({ readDubbingStructure: vi.fn(), readDubbingCaptions: vi.fn() }))

import { dubbingReadRoutes } from "../dubbing-read.js"
import { DUBBING_PROBLEMS, dubbingAnswer, dubbingRefusal, type DubbingProblem } from "../../lib/dubbing-problems.js"
import { readDubbingCaptions, readDubbingStructure } from "../../lib/dubbing-read-service.js"
import { __flushHttpErrorTelemetry, __resetHttpErrorTelemetry } from "../../lib/http-errors.js"

const OWNER = "00000000-0000-4000-8000-000000000001"
const JOB = "00000000-0000-4000-8000-0000000000d1"
const ADDED = "00000000-0000-4000-8000-0000000000d2"

const STRUCTURE: DubbingStructure = {
  jobId: JOB,
  durationSec: 61.5,
  source: { language: "en", segments: [{ id: "s1", speakerId: "speaker_0", start: 0, end: 2.5, text: "Hello there." }] },
  languages: [
    {
      code: "es",
      jobId: JOB,
      status: "completed",
      segments: [{ id: "l1", speakerId: "speaker_0", start: 0, end: 2.5, sourceSegmentId: "s1", sourceText: "Hello there.", text: "Hola." }],
    },
    { code: "pt-BR", jobId: ADDED, status: "processing", segments: [] },
  ],
  speakers: [{ id: "speaker_0", name: null, voice: null, segmentCount: 1 }],
  capabilities: { editSegments: false, regenerate: false, setSpeakerVoice: false, render: false, addLanguage: true, captions: true },
  addLanguage: { billableMinutes: 2, creditId: "elevenlabs-dubbing:2u", creditIdByLanguage: { he: "elevenlabs-dubbing-v2:2u" } },
}

const SRT = "1\n00:00:00,000 --> 00:00:02,500\nHola.\n"
const VTT = "WEBVTT\n\n00:00:00.000 --> 00:00:02.500\nHola.\n"

let app: FastifyInstance
let logged: string[]
let limits: Record<string, unknown>

beforeEach(async () => {
  vi.clearAllMocks()
  __resetHttpErrorTelemetry()
  logged = []
  limits = {}
  app = Fastify({ logger: { level: "info", stream: { write: (line: string) => void logged.push(line) } } })
  // Every route the plugin serves, with the rate limit it declares (the HEAD twin of a GET aside).
  app.addHook("onRoute", (route) => {
    for (const method of [route.method].flat()) {
      if (method === "HEAD") continue
      limits = { ...limits, [`${method} ${route.url}`]: (route.config as { rateLimit?: unknown } | undefined)?.rateLimit }
    }
  })
  // Test identity from the query: `__userId`, an admin role, and OAuth-app scopes.
  app.addHook("onRequest", async (req) => {
    const q = req.query as Record<string, string | undefined>
    if (q.__userId) req.userId = q.__userId
    if (q.__admin) req.userRole = "admin"
    if (q.__scopes !== undefined) {
      ;(req as { appAuthorization?: unknown }).appAuthorization = {
        appId: "app1",
        authorizationId: "auth1",
        scopes: q.__scopes ? q.__scopes.split(",") : [],
      }
    }
  })
  await app.register(dubbingReadRoutes)
  await app.ready()
})

afterEach(async () => {
  await app.close()
  await __flushHttpErrorTelemetry()
})

const getStructure = (query: string, id = JOB) => app.inject({ method: "GET", url: `/v1/dubbing/${id}?${query}` })
const getCaptions = (query: string, id = JOB) => app.inject({ method: "GET", url: `/v1/dubbing/${id}/captions?${query}` })

/** Every refusal a read can answer, by the name it has in the table. */
const refusals = (names: ReadonlyArray<keyof typeof DUBBING_PROBLEMS>): Array<[string, DubbingProblem]> =>
  names.map((name) => [name, DUBBING_PROBLEMS[name]])

describe("the routes the plugin serves", () => {
  it("are the two reads, each under the same limit of 60 a minute", () => {
    const limit = { max: 60, timeWindow: "1 minute" }
    expect(limits).toEqual({ "GET /v1/dubbing/:jobId": limit, "GET /v1/dubbing/:jobId/captions": limit })
  })
})

describe("no cache keeps an answer of either read", () => {
  const NO_STORE = "private, no-store"
  const asOwner = `__userId=${OWNER}`
  const kept = (answers: ReadonlyArray<{ statusCode: number; headers: Record<string, unknown> }>) =>
    answers.map((res) => [res.statusCode, res.headers["cache-control"]])

  it("a dub's structure and its captions", async () => {
    vi.mocked(readDubbingStructure).mockResolvedValue(dubbingAnswer(STRUCTURE))
    vi.mocked(readDubbingCaptions).mockResolvedValue(dubbingAnswer(VTT))
    const answers = [await getStructure(asOwner), await getCaptions(`${asOwner}&language=es&format=vtt`)]
    expect(kept(answers)).toEqual([
      [200, NO_STORE],
      [200, NO_STORE],
    ])
  })

  it("a refusal, which the next read may answer otherwise", async () => {
    vi.mocked(readDubbingStructure).mockResolvedValue(dubbingRefusal(DUBBING_PROBLEMS.notReady))
    vi.mocked(readDubbingCaptions).mockResolvedValue(dubbingRefusal(DUBBING_PROBLEMS.languageProcessing))
    const answers = [await getStructure(asOwner), await getCaptions(`${asOwner}&language=es`)]
    expect(kept(answers)).toEqual([
      [409, NO_STORE],
      [409, NO_STORE],
    ])
  })

  it("an answer given before the dub is read, and a failure of ours", async () => {
    vi.mocked(readDubbingStructure).mockRejectedValue(new Error("connection terminated"))
    const answers = [
      await getStructure(""),
      await getStructure(`${asOwner}&__scopes=jobs:read`),
      await getStructure(asOwner, "not-a-uuid"),
      await getCaptions(`${asOwner}&format=ass`),
      await getStructure(asOwner),
    ]
    expect(kept(answers)).toEqual([
      [401, NO_STORE],
      [403, NO_STORE],
      [404, NO_STORE],
      [400, NO_STORE],
      [500, NO_STORE],
    ])
  })

  it("a refusal given before the reads run: too many requests, or no sign-in", async () => {
    // Wired as the app wires them: the limiter, then the sign-in check on every route, then the reads.
    const wired = Fastify()
    await wired.register(rateLimit, { global: false })
    wired.addHook("preHandler", async (req, reply) => {
      const q = req.query as Record<string, string | undefined>
      if (!q.__userId) return reply.status(401).send({ error: { code: "unauthorized", message: "Sign in to read a dub" } })
      req.userId = q.__userId
    })
    await wired.register(dubbingReadRoutes)
    vi.mocked(readDubbingStructure).mockResolvedValue(dubbingAnswer(STRUCTURE))
    const ask = (query: string) => wired.inject({ method: "GET", url: `/v1/dubbing/${JOB}?${query}` })
    /** The owner's read, asked `times` times, one after the other. */
    const asked = async (times: number): Promise<LightMyRequestResponse[]> =>
      times === 0 ? [] : [...(await asked(times - 1)), await ask(asOwner)]

    const signedOut = await ask("")
    // One read more than a minute allows.
    const answers = await asked(61)
    await wired.close()

    expect(kept([signedOut])).toEqual([[401, NO_STORE]])
    expect(new Set(answers.map((res) => res.statusCode))).toEqual(new Set([200, 429]))
    expect(kept(answers).filter(([, cache]) => cache !== NO_STORE)).toEqual([])
  })

  it("and of these reads alone: a route registered beside them is left as it was", async () => {
    const beside = Fastify()
    beside.get("/beside", async () => ({ ok: true }))
    await beside.register(dubbingReadRoutes)
    const res = await beside.inject({ method: "GET", url: "/beside" })
    await beside.close()
    expect(res.statusCode).toBe(200)
    expect(res.headers["cache-control"]).toBeUndefined()
  })
})

describe("GET /v1/dubbing/:jobId", () => {
  it("answers the owner the dub's structure as it is, with no envelope", async () => {
    vi.mocked(readDubbingStructure).mockResolvedValue(dubbingAnswer(STRUCTURE))
    const res = await getStructure(`__userId=${OWNER}`)
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual(STRUCTURE)
    expect(readDubbingStructure).toHaveBeenCalledExactlyOnceWith(OWNER, JOB)
  })

  it("needs a signed-in caller", async () => {
    const res = await getStructure("")
    expect(res.statusCode).toBe(401)
    expect(res.json().error.code).toBe("unauthorized")
    expect(readDubbingStructure).not.toHaveBeenCalled()
  })

  it("an OAuth app needs assets:read; a write scope alone does not read", async () => {
    vi.mocked(readDubbingStructure).mockResolvedValue(dubbingAnswer(STRUCTURE))
    for (const scopes of ["", "jobs:read", "assets:write"]) {
      const refused = await getStructure(`__userId=${OWNER}&__scopes=${scopes}`)
      expect(refused.statusCode).toBe(403)
      expect(refused.json().error).toMatchObject({ code: "insufficient_scope", missingScope: "assets:read" })
    }
    expect(readDubbingStructure).not.toHaveBeenCalled()
    expect((await getStructure(`__userId=${OWNER}&__scopes=jobs:read,assets:read`)).statusCode).toBe(200)
  })

  it("the read is asked in the caller's own name, an admin's request included", async () => {
    vi.mocked(readDubbingStructure).mockResolvedValue(dubbingRefusal(DUBBING_PROBLEMS.notFound))
    const res = await getStructure(`__userId=${OWNER}&__admin=1`)
    expect(res.statusCode).toBe(404)
    expect(readDubbingStructure).toHaveBeenCalledExactlyOnceWith(OWNER, JOB)
  })

  it("an id that cannot be a job is the same 404 a missing job is, and nothing is read", async () => {
    const res = await getStructure(`__userId=${OWNER}`, "not-a-uuid")
    expect(res.statusCode).toBe(404)
    expect(res.json()).toEqual({ error: { code: "not_found", message: "Job not found" } })
    expect(readDubbingStructure).not.toHaveBeenCalled()
  })

  it.each(refusals(["notFound", "notADub", "notReady", "failed", "unavailable", "readFailed"]))(
    "a refusal answers its own status and code: %s",
    async (_name, problem) => {
      vi.mocked(readDubbingStructure).mockResolvedValue(dubbingRefusal(problem))
      const res = await getStructure(`__userId=${OWNER}`)
      expect(res.statusCode).toBe(problem.status)
      expect(res.json()).toEqual({ error: { code: problem.code, message: problem.message } })
    },
  )

  it("what the dubbing service said stays in the server log", async () => {
    const cause = new Error("upstream said: quota exceeded for workspace w-123")
    vi.mocked(readDubbingStructure).mockResolvedValue(dubbingRefusal(DUBBING_PROBLEMS.readFailed, cause))
    const res = await getStructure(`__userId=${OWNER}`)
    expect(res.statusCode).toBe(502)
    expect(res.json()).toEqual({ error: { code: "dubbing_read_failed", message: DUBBING_PROBLEMS.readFailed.message } })
    expect(res.body).not.toContain("quota")
    const warned = logged.map((line) => JSON.parse(line) as { level: number; jobId?: string; err?: { message?: string } })
    expect(warned.filter((entry) => entry.level === 40)).toEqual([
      expect.objectContaining({ jobId: JOB, err: expect.objectContaining({ message: cause.message }) }),
    ])
  })

  it("a refusal with nothing underneath logs no warning", async () => {
    vi.mocked(readDubbingStructure).mockResolvedValue(dubbingRefusal(DUBBING_PROBLEMS.notReady))
    await getStructure(`__userId=${OWNER}`)
    expect(logged.map((line) => (JSON.parse(line) as { level: number }).level).filter((level) => level >= 40)).toEqual([])
  })

  it("a failure of ours is a 500 that tells nothing of what failed", async () => {
    vi.mocked(readDubbingStructure).mockRejectedValue(new Error("relation jobs does not exist"))
    const res = await getStructure(`__userId=${OWNER}`)
    expect(res.statusCode).toBe(500)
    expect(res.json().error.code).toBe("internal_error")
    expect(res.body).not.toContain("relation")
  })
})

describe("GET /v1/dubbing/:jobId/captions", () => {
  it("answers the file's text as SubRip when no format is asked for", async () => {
    vi.mocked(readDubbingCaptions).mockResolvedValue(dubbingAnswer(SRT))
    const res = await getCaptions(`__userId=${OWNER}&language=es`)
    expect(res.statusCode).toBe(200)
    expect(res.headers["content-type"]).toBe("application/x-subrip; charset=utf-8")
    expect(res.body).toBe(SRT)
    expect(readDubbingCaptions).toHaveBeenCalledExactlyOnceWith(OWNER, JOB, { language: "es", format: "srt" })
  })

  it("answers WebVTT under its own content type", async () => {
    vi.mocked(readDubbingCaptions).mockResolvedValue(dubbingAnswer(VTT))
    const res = await getCaptions(`__userId=${OWNER}&language=pt-BR&format=vtt`)
    expect(res.statusCode).toBe(200)
    expect(res.headers["content-type"]).toBe("text/vtt; charset=utf-8")
    expect(res.body).toBe(VTT)
    expect(readDubbingCaptions).toHaveBeenCalledExactlyOnceWith(OWNER, JOB, { language: "pt-BR", format: "vtt" })
  })

  it("passes `source` on as the language, and a padded code trimmed", async () => {
    vi.mocked(readDubbingCaptions).mockResolvedValue(dubbingAnswer(SRT))
    await getCaptions(`__userId=${OWNER}&language=source`)
    await getCaptions(`__userId=${OWNER}&language=%20es%20`)
    expect(vi.mocked(readDubbingCaptions).mock.calls.map((call) => call[2])).toEqual([
      { language: "source", format: "srt" },
      { language: "es", format: "srt" },
    ])
  })

  it.each([
    ["no language", ""],
    ["an empty language", "&language="],
    ["a one-letter language", "&language=e"],
    ["a language no code is as long as", `&language=${"x".repeat(11)}`],
    ["a format that is not exported", "&language=es&format=ass"],
  ])("refuses %s as a 400, and nothing is read", async (_name, query) => {
    const res = await getCaptions(`__userId=${OWNER}${query}`)
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
    expect(readDubbingCaptions).not.toHaveBeenCalled()
  })

  it.each(refusals(["notFound", "notADub", "notReady", "failed", "unavailable", "languageNotFound", "languageProcessing", "captionsUnavailable", "readFailed"]))(
    "a refusal answers its own status and code as JSON: %s",
    async (_name, problem) => {
      vi.mocked(readDubbingCaptions).mockResolvedValue(dubbingRefusal(problem))
      const res = await getCaptions(`__userId=${OWNER}&language=es`)
      expect(res.statusCode).toBe(problem.status)
      expect(res.headers["content-type"]).toContain("application/json")
      expect(res.json()).toEqual({ error: { code: problem.code, message: problem.message } })
    },
  )

  it("needs a signed-in caller, an OAuth app needs assets:read, and an id that cannot be a job is a 404", async () => {
    vi.mocked(readDubbingCaptions).mockResolvedValue(dubbingAnswer(SRT))
    expect((await getCaptions("language=es")).statusCode).toBe(401)
    expect((await getCaptions(`__userId=${OWNER}&__scopes=assets:write&language=es`)).statusCode).toBe(403)
    const notAJob = await getCaptions(`__userId=${OWNER}&language=es`, "not-a-uuid")
    expect(notAJob.statusCode).toBe(404)
    expect(notAJob.json()).toEqual({ error: { code: "not_found", message: "Job not found" } })
    expect(readDubbingCaptions).not.toHaveBeenCalled()
    expect((await getCaptions(`__userId=${OWNER}&__scopes=assets:read&language=es`)).statusCode).toBe(200)
  })

  it("what the dubbing service said stays in the server log", async () => {
    const cause = new Error("upstream said: transcript store unreachable")
    vi.mocked(readDubbingCaptions).mockResolvedValue(dubbingRefusal(DUBBING_PROBLEMS.readFailed, cause))
    const res = await getCaptions(`__userId=${OWNER}&language=es`)
    expect(res.statusCode).toBe(502)
    expect(res.body).not.toContain("transcript store")
    expect(logged.some((line) => line.includes("transcript store unreachable"))).toBe(true)
  })

  it("a failure of ours is a 500 that tells nothing of what failed", async () => {
    vi.mocked(readDubbingCaptions).mockRejectedValue(new Error("connection terminated"))
    const res = await getCaptions(`__userId=${OWNER}&language=es`)
    expect(res.statusCode).toBe(500)
    expect(res.json().error.code).toBe("internal_error")
    expect(res.body).not.toContain("connection terminated")
  })
})
