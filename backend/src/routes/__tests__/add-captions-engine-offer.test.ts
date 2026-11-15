/**
 * POST /v1/add-captions and the transcription engine it runs on. Add Captions
 * transcribes on one of its own engines (`CAPTION_TRANSCRIBE_LANES`): the one
 * the request names, else the default. This records, for each engine, what a
 * deployment that restricts no model sees — the model the guard is told the
 * request runs on (`runModel`), the id it is checked and held on, and the
 * engine the job and its row carry — so the change that makes the engine
 * follow what a deployment offers can be shown to change none of it there —
 * and what a deployment that restricts models sees (decided 2026-11-15): a
 * request that names no engine runs the first one it offers, one that names
 * an engine it withholds is refused before anything is measured or held, and
 * one that must transcribe where no engine is offered is refused, saying what
 * its operator must list.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify"
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

// The guard itself is a no-op here: it records the id it is asked to check and
// the model the route says the request runs on (`CreditGuardOpts.runModel`).
const guard = vi.hoisted(() => ({ ids: [] as string[], runs: [] as unknown[] }))
vi.mock("@/middleware/credit-guard.js", () => ({
  creditGuard:
    (resolve: (req: FastifyRequest) => string, opts?: { runModel?: (req: FastifyRequest) => unknown }) =>
    async (req: FastifyRequest) => {
      guard.ids.push(resolve(req))
      guard.runs.push(opts?.runModel?.(req))
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
  const { isAllowedSocialVideoUrl } = await importOriginal<typeof import("@/lib/url-validator.js")>()
  return { safeUrlSchema: z.string().url(), isAllowedSocialVideoUrl }
})

// A Nemotron caption video is measured before the guard (lib/add-captions-nemotron.ts).
const probe = vi.hoisted(() => ({ probeMediaDurationAndSize: vi.fn() }))
vi.mock("@/providers/video/ffmpeg-utils.js", () => ({
  assertSafeProbeSource: vi.fn(async () => {}),
  probeMediaDurationAndSize: probe.probeMediaDurationAndSize,
}))

vi.mock("@/providers/nodaro/run-on-cloud.js", () => ({
  shouldRunOnCloud: async () => false,
}))

import { addCaptionsRoutes } from "../add-captions.js"
import { supabase } from "../../lib/supabase.js"
import { videoQueue } from "../../lib/queue.js"
import { reserveCreditsForJob } from "../../middleware/credit-guard.js"
import { __resetAvailabilityOverridesForTests, GATEABLE_MODEL_IDS } from "../../lib/availability-override.js"
import { NO_CAPTION_ENGINE_OFFERED_MESSAGE } from "@nodaro/render-rules"
import { defaultCaptionEngineCannotServeMessage } from "../../lib/add-captions-engine.js"

const USER = "00000000-0000-4000-8000-000000000001"
const VIDEO = "https://cdn.example/talk.mp4"
const ENGINES = ["whisper", "incredibly-fast-whisper", "elevenlabs-stt", "nemotron-3-5-transcribe"] as const

let app: FastifyInstance
let inserted: Array<Record<string, unknown>>

beforeEach(async () => {
  vi.clearAllMocks()
  guard.ids.length = 0
  guard.runs.length = 0
  inserted = []
  probe.probeMediaDurationAndSize.mockResolvedValue({ durationSec: 600, sizeBytes: 900 * 1024 * 1024 })
  const mockSingle = vi.fn().mockResolvedValue({ data: { id: "job-1" }, error: null })
  const mockInsert = vi.fn((row: Record<string, unknown>) => {
    inserted.push(row)
    return { select: () => ({ single: mockSingle }) }
  })
  vi.mocked(supabase.from).mockReturnValue({ insert: mockInsert } as never)
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
  __resetAvailabilityOverridesForTests()
})

/** An admin override that releases every model but `withheld` (Admin → Availability). */
function withhold(...withheld: string[]): void {
  __resetAvailabilityOverridesForTests({ models: new Set([...GATEABLE_MODEL_IDS].filter((m) => !withheld.includes(m))) })
}

function post(body: Record<string, unknown>) {
  return app.inject({ method: "POST", url: "/v1/add-captions", payload: { userId: USER, videoUrl: VIDEO, ...body } })
}

/** What one request did: its status, the guard's two answers, the hold, and the engine the job and its row carry. */
async function run(body: Record<string, unknown>) {
  const res = await post(body)
  const queued = vi.mocked(videoQueue.add).mock.calls[0]?.[1] as Record<string, unknown> | undefined
  return {
    status: res.statusCode,
    checkedOn: guard.ids[0],
    runsOn: guard.runs[0],
    heldOn: vi.mocked(reserveCreditsForJob).mock.calls[0]?.[3],
    jobEngine: queued?.transcribe_provider,
    rowEngine: (inserted[0]?.input_data as Record<string, unknown> | undefined)?.transcribe_provider,
  }
}

describe("with no model restricted, each engine runs as it always has", () => {
  it("a kinetic render that names no engine runs the default, Incredibly Fast Whisper, and the job carries no engine", async () => {
    expect(await run({ style: "word-highlight" })).toEqual({
      status: 200,
      checkedOn: "add-captions:kinetic",
      runsOn: "incredibly-fast-whisper",
      heldOn: "add-captions:kinetic",
      jobEngine: undefined,
      rowEngine: undefined,
    })
  })

  it("a transcribed subtitle that names no engine runs the default too", async () => {
    expect(await run({ style: "subtitle" })).toEqual({
      status: 200,
      checkedOn: "add-captions:kinetic",
      runsOn: "incredibly-fast-whisper",
      heldOn: "add-captions:kinetic",
      jobEngine: undefined,
      rowEngine: undefined,
    })
  })

  it.each(ENGINES.filter((e) => e !== "nemotron-3-5-transcribe" && e !== "whisper"))("a kinetic render on %s runs it, held on the render's row", async (engine) => {
    expect(await run({ style: "word-highlight", transcribe_provider: engine })).toEqual({
      status: 200,
      checkedOn: "add-captions:kinetic",
      runsOn: engine,
      heldOn: "add-captions:kinetic",
      jobEngine: engine,
      rowEngine: engine,
    })
  })

  it("a kinetic render on Nemotron 3.5 Transcribe holds the render plus the video's minutes", async () => {
    expect(await run({ style: "word-highlight", transcribe_provider: "nemotron-3-5-transcribe" })).toEqual({
      status: 200,
      checkedOn: addCaptionsNemotronMinutesId(10),
      runsOn: "nemotron-3-5-transcribe",
      heldOn: addCaptionsNemotronMinutesId(10),
      jobEngine: "nemotron-3-5-transcribe",
      rowEngine: "nemotron-3-5-transcribe",
    })
  })

  it("Whisper, which has no word timings, serves a subtitle, and is refused for a kinetic render with no other source", async () => {
    expect(await run({ style: "subtitle", transcribe_provider: "whisper" })).toMatchObject({ status: 200, runsOn: "whisper", jobEngine: "whisper" })
    vi.clearAllMocks()
    guard.ids.length = 0
    guard.runs.length = 0
    const refused = await post({ style: "word-highlight", transcribe_provider: "whisper" })
    expect(refused.statusCode).toBe(400)
    expect(vi.mocked(videoQueue.add)).not.toHaveBeenCalled()
  })

  it("a render that brings its own words runs no model, whatever engine it names", async () => {
    for (const body of [
      { style: "subtitle", text: "Hello there" },
      { style: "word-highlight", captions: [{ text: "hi", startMs: 0, endMs: 400 }], transcribe_provider: "elevenlabs-stt" },
      { style: "word-highlight", auto_transcribe: false, text: "Hello there" },
    ]) {
      vi.clearAllMocks()
      guard.ids.length = 0
      guard.runs.length = 0
      inserted = []
      const mockSingle = vi.fn().mockResolvedValue({ data: { id: "job-1" }, error: null })
      vi.mocked(supabase.from).mockReturnValue({ insert: () => ({ select: () => ({ single: mockSingle }) }) } as never)
      const res = await post(body)
      expect(res.statusCode, JSON.stringify(body)).toBe(200)
      expect(guard.runs[0], JSON.stringify(body)).toBeUndefined()
    }
  })
})

describe("on a deployment that restricts models, the engine follows what it offers", () => {
  it("a request that names no engine runs the first engine offered, written into the job and its row", async () => {
    withhold("incredibly-fast-whisper")
    expect(await run({ style: "word-highlight" })).toEqual({
      status: 200,
      checkedOn: "add-captions:kinetic",
      runsOn: "elevenlabs-stt",
      heldOn: "add-captions:kinetic",
      jobEngine: "elevenlabs-stt",
      rowEngine: "elevenlabs-stt",
    })
  })

  it("a default that lands on Nemotron 3.5 Transcribe is measured and held per minute, like a named one", async () => {
    withhold("incredibly-fast-whisper", "elevenlabs-stt")
    expect(await run({ style: "word-highlight" })).toEqual({
      status: 200,
      checkedOn: addCaptionsNemotronMinutesId(10),
      runsOn: "nemotron-3-5-transcribe",
      heldOn: addCaptionsNemotronMinutesId(10),
      jobEngine: "nemotron-3-5-transcribe",
      rowEngine: "nemotron-3-5-transcribe",
    })
    expect(probe.probeMediaDurationAndSize).toHaveBeenCalledWith(VIDEO)
  })

  it("a default on Whisper is refused for a kinetic render it cannot serve, before anything is measured or held", async () => {
    withhold("incredibly-fast-whisper", "elevenlabs-stt", "nemotron-3-5-transcribe")
    const res = await post({ style: "word-highlight" })
    expect(res.statusCode).toBe(403)
    expect(res.json().error).toEqual({ code: "model_not_available", message: defaultCaptionEngineCannotServeMessage("whisper") })
    expect(guard.ids).toEqual([])
    expect(vi.mocked(reserveCreditsForJob)).not.toHaveBeenCalled()
  })

  it("a default on Whisper serves a subtitle, and a kinetic render with text to fall back to", async () => {
    withhold("incredibly-fast-whisper", "elevenlabs-stt", "nemotron-3-5-transcribe")
    expect(await run({ style: "subtitle" })).toMatchObject({ status: 200, runsOn: "whisper", jobEngine: "whisper" })
    vi.clearAllMocks()
    guard.ids.length = 0
    guard.runs.length = 0
    const mockSingle = vi.fn().mockResolvedValue({ data: { id: "job-1" }, error: null })
    vi.mocked(supabase.from).mockReturnValue({ insert: () => ({ select: () => ({ single: mockSingle }) }) } as never)
    const res = await post({ style: "word-highlight", text: "Hello there" })
    expect(res.statusCode).toBe(200)
    expect(guard.runs[0]).toBe("whisper")
  })

  it.each(ENGINES)("a request that names %s where it is withheld is refused before anything is measured or held", async (engine) => {
    withhold(engine)
    const res = await post({ style: "word-highlight", transcribe_provider: engine })
    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe("model_not_available")
    expect(res.json().error.message).toContain(engine)
    expect(probe.probeMediaDurationAndSize).not.toHaveBeenCalled()
    expect(guard.ids).toEqual([])
    expect(vi.mocked(reserveCreditsForJob)).not.toHaveBeenCalled()
    expect(vi.mocked(videoQueue.add)).not.toHaveBeenCalled()
  })

  it("a request that names an offered engine runs it as named", async () => {
    withhold("incredibly-fast-whisper")
    expect(await run({ style: "word-highlight", transcribe_provider: "elevenlabs-stt" })).toMatchObject({ status: 200, runsOn: "elevenlabs-stt", jobEngine: "elevenlabs-stt" })
  })

  it("where no engine is offered, a render that must transcribe is refused, saying what to list", async () => {
    withhold(...ENGINES)
    const res = await post({ style: "word-highlight" })
    expect(res.statusCode).toBe(403)
    expect(res.json().error).toEqual({ code: "model_not_available", message: NO_CAPTION_ENGINE_OFFERED_MESSAGE })
    expect(guard.ids).toEqual([])
    expect(vi.mocked(videoQueue.add)).not.toHaveBeenCalled()
    for (const engine of ENGINES) expect(NO_CAPTION_ENGINE_OFFERED_MESSAGE).toContain(engine)
  })

  it("where no engine is offered, a render that brings its own words still runs, on no model", async () => {
    withhold(...ENGINES)
    const res = await post({ style: "subtitle", text: "Hello there" })
    expect(res.statusCode).toBe(200)
    expect(guard.runs[0]).toBeUndefined()
  })

  it("the guard's own run model, asked alone, answers every engine where none is offered, so it refuses too", async () => {
    withhold(...ENGINES)
    const { resolveAddCaptionsRunModel } = await import("../add-captions.js")
    expect(resolveAddCaptionsRunModel({ body: { style: "karaoke" } } as FastifyRequest)).toEqual(ENGINES)
  })
})
