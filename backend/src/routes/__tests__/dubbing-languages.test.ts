import { beforeEach, describe, expect, it, vi } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"
import type { ResolvedDubFamily } from "@/lib/dubbing-family.js"
import type { DubbingOutcome } from "@/lib/dubbing-problems.js"

// POST /v1/dubbing/:jobId/languages adds a language to a dub that is already
// made. The dub is read as the reads read it (stubbed here at withDubFamily,
// which hands the route the dub's family); what that comes to is decided by
// the real planner, priced by the real computeCredits and filed through the
// real create route for a regular dub. Only the edges are stubbed: the job
// insert, the queue, the guard's reservation, the probes and the import gate.

const FAMILY = "00000000-0000-4000-8000-0000000000aa"
const ADDED_JOB = "00000000-0000-4000-8000-0000000000ab"
const USER_ID = "00000000-0000-4000-8000-000000000001"
const UPLOAD = "https://cdn.example.com/source.mp4"

const mocks = vi.hoisted(() => ({
  family: null as unknown,
  refusal: null as unknown,
  asked: [] as Array<{ owner: string; jobId: string }>,
  guardCalls: [] as Array<{ model: string; runModel: unknown; credits: number | undefined }>,
  reservedOn: [] as string[],
  insert: vi.fn(),
  queueAdd: vi.fn(),
  probe: vi.fn(),
  postProbe: vi.fn(),
  requireImportAllowed: vi.fn(async (_url: string, _rights: Record<string, unknown>): Promise<void> => undefined),
  voicesAllowed: true,
  bodies: [] as unknown[],
  recentJob: vi.fn(async (_userId: string, _key: string): Promise<{ id: string } | null> => null),
}))

vi.mock("@/lib/dubbing-read-service.js", () => ({
  withDubFamily: vi.fn(async (owner: string, jobId: string, read: (family: unknown) => Promise<unknown>) => {
    mocks.asked.push({ owner, jobId })
    return mocks.refusal ?? read(mocks.family)
  }),
}))
vi.mock("@/lib/supabase.js", () => ({ supabase: { from: vi.fn(), auth: { getUser: vi.fn() } } }))
vi.mock("@/lib/insert-job.js", () => ({
  insertJob: vi.fn(async (req: { body: unknown }, row: Record<string, unknown>) => {
    mocks.insert(row)
    mocks.bodies.push(req.body)
    return { data: { id: "job-new" }, error: null }
  }),
}))
vi.mock("@/lib/queue.js", () => ({ videoQueue: { add: mocks.queueAdd }, redis: {} }))
vi.mock("@/lib/dedup-fingerprint.js", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  findRecentMatchingJob: mocks.recentJob,
}))
vi.mock("@/middleware/credit-guard.js", () => ({
  creditGuard:
    (
      resolver: (req: unknown) => string,
      opts?: { runModel?: (req: unknown) => unknown; computeCredits?: (body: unknown, req: unknown) => Promise<number> | number },
    ) =>
    async (req: { body: unknown }) => {
      mocks.guardCalls.push({
        model: resolver(req),
        runModel: opts?.runModel?.(req),
        credits: opts?.computeCredits ? await opts.computeCredits(req.body, req) : undefined,
      })
    },
  reserveCreditsForJob: vi.fn(async (_req: unknown, _reply: unknown, _jobId: string, modelId: string) => {
    mocks.reservedOn.push(modelId)
    return { usageLogId: "u-1", creditsReserved: 1, watermark: false }
  }),
}))
vi.mock("@/lib/credit-base-cost.js", () => ({
  baseCreditCostFor: vi.fn(async (id: string) => (id === "elevenlabs-dubbing" ? 40 : id === "elevenlabs-dubbing-v2" ? 99 : 0)),
}))
vi.mock("@/lib/config.js", () => ({
  config: { EDITION: "cloud", SUPABASE_URL: "https://test.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "test" },
  isCloud: () => true, hasCredits: () => true, isCommunity: () => false, isBusiness: () => false, hasAdmin: () => true,
}))
vi.mock("@/lib/url-validator.js", async (importOriginal) => {
  const { z } = await import("zod")
  return { ...(await importOriginal<Record<string, unknown>>()), safeUrlSchema: z.string().url() }
})
vi.mock("@/providers/video/ffmpeg-utils.js", () => ({ probeMediaDuration: mocks.probe }))
vi.mock("@/services/workflow-engine/video-analysis-post-probe.js", () => ({ probeSocialPostDurationSec: mocks.postProbe }))
vi.mock("@/lib/import-gate.js", () => ({
  isImportRefusal: (e: unknown) => e instanceof Error && "code" in e,
  requireImportAllowed: mocks.requireImportAllowed,
}))
vi.mock("@/lib/voice-policy.js", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  judgeUnnamedVoices: () => (mocks.voicesAllowed ? { allowed: true } : { allowed: false, reason: "voice lock" }),
}))

import { dubbingLanguageRoutes } from "../dubbing-languages.js"
import { registerServerOnlyBodyKeysHook } from "../../middleware/server-only-body-keys.js"
import { DUBBING_PROBLEMS } from "@/lib/dubbing-problems.js"

function projectFamily(over: Partial<ResolvedDubFamily> = {}): ResolvedDubFamily {
  return {
    familyId: FAMILY,
    anchor: {
      id: FAMILY,
      status: "completed",
      providerTaskId: "project:p1",
      input: { type: "dubbing", targetLanguage: "he", videoUrl: UPLOAD, probedDurationSec: 61 },
      createdAt: "2026-11-01T00:00:00Z",
    },
    engine: "project",
    durationSec: 61,
    sourceLanguage: "en",
    languages: [{ code: "he", jobId: FAMILY, status: "completed", ref: { kind: "project", taskId: "project:p1", languageId: "l_he" } }],
    ...over,
  }
}

function regularFamily(input: Record<string, unknown>): ResolvedDubFamily {
  return {
    familyId: FAMILY,
    anchor: { id: FAMILY, status: "completed", providerTaskId: "dub_1", input, createdAt: "2026-11-01T00:00:00Z" },
    engine: "regular",
    durationSec: 95,
    sourceLanguage: "en",
    languages: [{ code: "fr", jobId: FAMILY, status: "completed", ref: { kind: "regular", dubbingId: "dub_1", code: "fr" } }],
  }
}

let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()
  mocks.family = projectFamily()
  mocks.refusal = null
  mocks.asked.length = 0
  mocks.guardCalls.length = 0
  mocks.reservedOn.length = 0
  mocks.voicesAllowed = true
  mocks.bodies.length = 0
  mocks.recentJob.mockImplementation(async () => null)
  mocks.requireImportAllowed.mockImplementation(async () => undefined)
  app = Fastify({ logger: false })
  // As the app drops them: a body's server-only keys never reach the route.
  registerServerOnlyBodyKeysHook(app)
  app.addHook("preHandler", async (req) => {
    // A request with no account behind it, as the auth hook would leave it.
    if (req.headers["x-no-account"] === "1") return
    req.userId = USER_ID
    const scopes = req.headers["x-app-scopes"]
    if (typeof scopes === "string") (req as { appAuthorization?: unknown }).appAuthorization = { scopes: scopes.split(",") }
  })
  await app.register(dubbingLanguageRoutes)
  await app.ready()
})

const add = (payload: Record<string, unknown>, jobId = FAMILY, headers: Record<string, string> = {}) =>
  app.inject({ method: "POST", url: `/v1/dubbing/${jobId}/languages`, payload, headers })
const inserted = () => mocks.insert.mock.calls[0]![0] as { input_data: Record<string, unknown>; user_id: string }
const queued = () => mocks.queueAdd.mock.calls[0] as [string, Record<string, unknown>]

describe("adding a language to a project dub", () => {
  it("files a job that joins the project, charged on the project's row for the dub's own length", async () => {
    const res = await add({ targetLanguage: "es" })
    expect(res.statusCode, res.body).toBe(200)
    expect(res.json()).toEqual({ jobId: "job-new" })
    // 61 s is 2 started minutes on the project's row (99 base a minute).
    expect(mocks.guardCalls).toEqual([{ model: "elevenlabs-dubbing-v2", runModel: "elevenlabs-dubbing-v2", credits: 198 }])
    expect(mocks.reservedOn).toEqual(["elevenlabs-dubbing-v2"])
    expect(inserted().user_id).toBe(USER_ID)
    expect(inserted().input_data).toEqual({
      type: "dubbing",
      videoUrl: UPLOAD,
      targetLanguage: "es",
      sourceDubJobId: FAMILY,
      projectTaskId: "project:p1",
      dubbingModelId: "elevenlabs-dubbing-v2",
      probedDurationSec: 61,
    })
    expect(queued()).toEqual([
      "dubbing",
      {
        jobId: "job-new",
        videoUrl: UPLOAD,
        targetLanguage: "es",
        sourceDubJobId: FAMILY,
        projectTaskId: "project:p1",
        dubbingModelId: "elevenlabs-dubbing-v2",
        probedDurationSec: 61,
        usageLogId: "u-1",
      },
    ])
    expect(mocks.probe).not.toHaveBeenCalled()
  })

  it("names the dub the language joins by its family, whichever of its jobs the path asks", async () => {
    const res = await add({ targetLanguage: "es" }, ADDED_JOB)
    expect(res.statusCode).toBe(200)
    expect(mocks.asked).toEqual([{ owner: USER_ID, jobId: ADDED_JOB }])
    expect(inserted().input_data.sourceDubJobId).toBe(FAMILY)
  })

  it("delivers a language the project holds and no job delivers, instead of making it again", async () => {
    mocks.family = projectFamily({
      languages: [
        { code: "he", jobId: FAMILY, status: "completed", ref: { kind: "project", taskId: "project:p1", languageId: "l_he" } },
        { code: "es", jobId: null, status: "completed", ref: { kind: "project", taskId: "project:p1", languageId: "l_es" } },
      ],
    })
    const res = await add({ targetLanguage: "es" })
    expect(res.statusCode).toBe(200)
    expect(inserted().input_data).toMatchObject({ adoptLanguageId: "l_es", projectTaskId: "project:p1" })
    expect(queued()[1]).toMatchObject({ adoptLanguageId: "l_es" })
  })

  it("never prices a length the request states", async () => {
    const res = await add({ targetLanguage: "es", __probedDurationSec: 1, probedDurationSec: 1, dubbingModelId: "elevenlabs-dubbing" })
    expect(res.statusCode).toBe(200)
    expect(mocks.guardCalls[0]).toMatchObject({ model: "elevenlabs-dubbing-v2", credits: 198 })
    expect(inserted().input_data).toMatchObject({ probedDurationSec: 61, dubbingModelId: "elevenlabs-dubbing-v2" })
  })
})

describe("adding a language to a regular dub", () => {
  it("is a dub of the same source with the same settings, measured and priced as a new dub", async () => {
    mocks.family = regularFamily({ type: "dubbing", targetLanguage: "fr", videoUrl: UPLOAD, numSpeakers: 2, probedDurationSec: 95 })
    mocks.probe.mockResolvedValue(95)
    const res = await add({ targetLanguage: "de" })
    expect(res.statusCode, res.body).toBe(200)
    expect(mocks.probe).toHaveBeenCalledWith(UPLOAD)
    // 95 s is 2 started minutes on the regular row (40 base a minute).
    expect(mocks.guardCalls).toEqual([{ model: "elevenlabs-dubbing", runModel: "elevenlabs-dubbing", credits: 80 }])
    expect(mocks.reservedOn).toEqual(["elevenlabs-dubbing"])
    expect(inserted().input_data).toMatchObject({
      type: "dubbing",
      videoUrl: UPLOAD,
      targetLanguage: "de",
      numSpeakers: 2,
      sourceDubJobId: FAMILY,
      probedDurationSec: 95,
    })
    expect(queued()[1]).toMatchObject({ videoUrl: UPLOAD, targetLanguage: "de", numSpeakers: 2, probedDurationSec: 95 })
  })

  it("into Hebrew, is charged on the project's row as a new Hebrew dub is", async () => {
    mocks.family = regularFamily({ type: "dubbing", targetLanguage: "fr", videoUrl: UPLOAD, probedDurationSec: 95 })
    mocks.probe.mockResolvedValue(95)
    const res = await add({ targetLanguage: "he" })
    expect(res.statusCode, res.body).toBe(200)
    expect(mocks.guardCalls).toEqual([{ model: "elevenlabs-dubbing-v2", runModel: "elevenlabs-dubbing-v2", credits: 198 }])
  })

  it("holds a link to the import gate again, with the confirmation the request gives", async () => {
    const link = "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
    const confirmationId = "00000000-0000-4000-8000-0000000000ee"
    mocks.family = regularFamily({ type: "dubbing", targetLanguage: "fr", sourceUrl: link, probedDurationSec: 95, confirmationId: "00000000-0000-4000-8000-0000000000ff" })
    mocks.postProbe.mockResolvedValue(95)
    const res = await add({ targetLanguage: "de", confirmationId })
    expect(res.statusCode, res.body).toBe(200)
    expect(mocks.requireImportAllowed).toHaveBeenCalledWith(link, expect.objectContaining({ userId: USER_ID, confirmationId }))
    expect(queued()[1]).toMatchObject({ sourceUrl: link, confirmationId })
  })

  it("from a link into Hebrew, is refused before the link is read", async () => {
    mocks.family = regularFamily({ type: "dubbing", targetLanguage: "fr", sourceUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", probedDurationSec: 95 })
    const res = await add({ targetLanguage: "he" })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("unsupported_dubbing_settings")
    expect(mocks.requireImportAllowed).not.toHaveBeenCalled()
    expect(mocks.guardCalls).toEqual([])
    expect(mocks.insert).not.toHaveBeenCalled()
  })
})

describe("where the new job is shown", () => {
  const placed = {
    workflowId: "00000000-0000-4000-8000-0000000000f1",
    nodeId: "node-7",
    forcePrivate: true,
    mcp_client: "Claude",
  }
  const row = { workflow_id: placed.workflowId, node_id: placed.nodeId, force_private: true, mcp_client: "Claude" }

  it("a Hebrew dub's language keeps the caller's flow, node and client", async () => {
    const res = await add({ targetLanguage: "es", ...placed })
    expect(res.statusCode).toBe(200)
    expect(mocks.insert.mock.calls[0]![0]).toMatchObject(row)
  })

  it("a regular dub's language keeps them too", async () => {
    mocks.family = regularFamily({ type: "dubbing", targetLanguage: "fr", videoUrl: UPLOAD, probedDurationSec: 95 })
    mocks.probe.mockResolvedValue(95)
    const res = await add({ targetLanguage: "de", ...placed })
    expect(res.statusCode).toBe(200)
    expect(mocks.insert.mock.calls[0]![0]).toMatchObject(row)
  })

  it("both kinds keep the caller's generation session and app for the job funnel to read", async () => {
    const session = { sessionId: "00000000-0000-4000-8000-0000000000f2", origin: "tools" }
    await add({ targetLanguage: "es", ...session })
    mocks.family = regularFamily({ type: "dubbing", targetLanguage: "fr", videoUrl: UPLOAD, probedDurationSec: 95 })
    mocks.probe.mockResolvedValue(95)
    await add({ targetLanguage: "de", ...session })
    expect(mocks.bodies).toHaveLength(2)
    for (const body of mocks.bodies) expect(body).toMatchObject(session)
  })
})

describe("refusals", () => {
  it("a request with no account is a 401 before the dub is read", async () => {
    const res = await add({ targetLanguage: "es" }, FAMILY, { "x-no-account": "1" })
    expect(res.statusCode).toBe(401)
    expect(mocks.asked).toEqual([])
  })

  it("an OAuth app without assets:write is a 403 before the dub is read", async () => {
    const res = await add({ targetLanguage: "es" }, FAMILY, { "x-app-scopes": "assets:read" })
    expect(res.statusCode).toBe(403)
    expect(mocks.asked).toEqual([])
  })

  it("an id that is not a job id is a 404, in the words a missing job is told in", async () => {
    const res = await add({ targetLanguage: "es" }, "not-a-job")
    expect(res.statusCode).toBe(404)
    expect(res.json()).toEqual({ error: { code: "not_found", message: "Job not found" } })
    expect(mocks.asked).toEqual([])
  })

  it("a missing or malformed language is a 400 before the dub is read", async () => {
    const bad = [
      {},
      { targetLanguage: "x" },
      { targetLanguage: "es/../x" },
      { targetLanguage: "es?a=1" },
      { targetLanguage: "español" },
      { targetLanguage: "es", confirmationId: "nope" },
    ]
    for (const payload of bad) {
      const res = await add(payload)
      expect(res.statusCode).toBe(400)
      expect(res.json().error.code).toBe("validation_error")
    }
    expect(mocks.asked).toEqual([])
  })

  it("takes a language code with a region or a script", async () => {
    for (const targetLanguage of ["pt-BR", "zh-Hans", "heb"]) {
      const res = await add({ targetLanguage })
      expect(res.statusCode, targetLanguage).not.toBe(400)
    }
  })

  it("a dub that cannot be read answers the read's own refusal, and nothing is charged", async () => {
    const refused: DubbingOutcome<never> = { ok: false, problem: DUBBING_PROBLEMS.notReady }
    mocks.refusal = refused
    const res = await add({ targetLanguage: "es" })
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe("dubbing_not_ready")
    expect(mocks.guardCalls).toEqual([])
    expect(mocks.insert).not.toHaveBeenCalled()
  })

  it("a language the dub has is a 409, and nothing is charged", async () => {
    const res = await add({ targetLanguage: "HE" })
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe("dubbing_language_exists")
    expect(mocks.guardCalls).toEqual([])
  })

  it("a request repeated with the same Idempotency-Key answers the first one's job, before the dub is read", async () => {
    mocks.recentJob.mockImplementation(async () => ({ id: "job-earlier" }))
    const res = await add({ targetLanguage: "es" }, FAMILY, { "idempotency-key": "click-123456" })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ jobId: "job-earlier", deduped: true })
    expect(mocks.recentJob).toHaveBeenCalledWith(USER_ID, "click-123456")
    expect(mocks.asked).toEqual([])
    expect(mocks.insert).not.toHaveBeenCalled()
  })

  it("a key too short to be one is not looked up", async () => {
    const res = await add({ targetLanguage: "es" }, FAMILY, { "idempotency-key": "short" })
    expect(res.statusCode).toBe(200)
    expect(mocks.recentJob).not.toHaveBeenCalled()
  })

  it("a voice lock refuses before the dub is read", async () => {
    mocks.voicesAllowed = false
    const res = await add({ targetLanguage: "es" })
    expect(res.statusCode).toBe(400)
    expect(mocks.asked).toEqual([])
    expect(mocks.guardCalls).toEqual([])
  })
})
