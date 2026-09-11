/**
 * POST /v1/llm/structured/jobs — the async twin of the structured route.
 * What must hold, in the order money moves: the refusals that cost nothing
 * (proxying install, bad body, no key, unknown model); the parent row and its
 * reservation; for a movie run, the analysis child created THROUGH the
 * analysis route with the caller's auth forwarded, its refusal propagated
 * verbatim and the parent undone; the enqueue payload the worker reads.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

const mocks = vi.hoisted(() => ({
  shouldProxyLlmToCloud: vi.fn(),
  insertJob: vi.fn(),
  reserveCreditsForJob: vi.fn(),
  refundReservedCreditsForJob: vi.fn(),
  queueAdd: vi.fn(),
  jobUpdate: vi.fn(),
  jobDelete: vi.fn(),
  /** The caller's own analysis child, as `readOwnAnalysisChild` reads it. */
  jobRead: vi.fn(),
}))

vi.mock("@/lib/config.js", () => ({
  config: { EDITION: "cloud", ANTHROPIC_API_KEY: "test-key", KIE_API_KEY: "", SUPABASE_URL: "https://test.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "test" },
  isCloud: () => true, hasCredits: () => true, isCommunity: () => false, isBusiness: () => false, hasAdmin: () => true,
}))
vi.mock("@/lib/cloud-llm-proxy.js", () => ({ shouldProxyLlmToCloud: mocks.shouldProxyLlmToCloud }))
vi.mock("@/lib/insert-job.js", () => ({ insertJob: mocks.insertJob }))
vi.mock("@/middleware/credit-guard.js", () => ({
  creditGuard: () => async () => {},
  reserveCreditsForJob: mocks.reserveCreditsForJob,
}))
vi.mock("@/lib/credits-job-lifecycle.js", () => ({ refundReservedCreditsForJob: mocks.refundReservedCreditsForJob }))
vi.mock("@/lib/queue.js", () => ({ videoQueue: { add: mocks.queueAdd }, tryRemoveFromQueue: vi.fn(), redis: {} }))
vi.mock("@/lib/supabase.js", () => {
  // update({...}).eq("id").eq("user_id") and delete().eq("id").eq("user_id")
  const terminal = vi.fn().mockResolvedValue({ data: null, error: null })
  const eq1 = vi.fn(() => ({ eq: terminal }))
  // select("…").eq("id").eq("user_id").maybeSingle() → the caller's own child
  const maybeSingle = async () => ({ data: mocks.jobRead(), error: null })
  const selectEq2 = vi.fn(() => ({ maybeSingle }))
  const selectEq1 = vi.fn(() => ({ eq: selectEq2 }))
  return {
    supabase: {
      from: vi.fn(() => ({
        update: (row: Record<string, unknown>) => { mocks.jobUpdate(row); return { eq: eq1 } },
        delete: () => { mocks.jobDelete(); return { eq: eq1 } },
        select: () => ({ eq: selectEq1 }),
      })),
    },
  }
})

import { llmStructuredJobsRoutes } from "../llm-structured-jobs.js"

const USER_ID = "00000000-0000-4000-8000-000000000001"
const SCHEMA = { type: "object", properties: { title: { type: "string" } }, required: ["title"], additionalProperties: false }
const VALID = { system: "You plan productions.", input: "A rainy chase through Rome.", jsonSchema: SCHEMA, origin: "studio", label: "Rome chase", userId: USER_ID }
const VIDEO = "https://r2.example/uploads/clip.mp4"

let app: FastifyInstance
/** What the stub analysis route answers; tests override per case. */
let analysisAnswer: { status: number; body: unknown }
let analysisSeen: { headers: Record<string, unknown>; body: unknown } | null

async function post(payload: Record<string, unknown>) {
  return app.inject({ method: "POST", url: "/v1/llm/structured/jobs", headers: { authorization: "Bearer caller-token", "x-nodaro-workspace": "ws-1" }, payload })
}

beforeEach(async () => {
  vi.clearAllMocks()
  mocks.shouldProxyLlmToCloud.mockResolvedValue(false)
  mocks.insertJob.mockResolvedValue({ data: { id: "parent-1" }, error: null })
  mocks.reserveCreditsForJob.mockResolvedValue({ usageLogId: "usage-1", creditsReserved: 10, watermark: false })
  mocks.refundReservedCreditsForJob.mockResolvedValue(1)
  mocks.queueAdd.mockResolvedValue({ id: "bull-1" })
  analysisAnswer = { status: 200, body: { jobId: "child-1" } }
  analysisSeen = null
  mocks.jobRead.mockReturnValue(null)

  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    const body = req.body as Record<string, unknown> | undefined
    if (typeof body?.userId === "string") req.userId = body.userId
  })
  // The analysis route as the plugin registers it, stubbed: records what it
  // was handed and answers what the test says.
  app.post("/v1/video-analysis", async (req, reply) => {
    analysisSeen = { headers: req.headers, body: req.body }
    return reply.status(analysisAnswer.status).send(analysisAnswer.body)
  })
  await app.register(async (instance) => { await llmStructuredJobsRoutes(instance) })
  await app.ready()
})
afterEach(async () => { await app.close() })

describe("refusals that cost nothing", () => {
  it("503 on an install that proxies its LLM calls (D17) — no row, no reservation", async () => {
    mocks.shouldProxyLlmToCloud.mockResolvedValue(true)
    const res = await post(VALID)
    expect(res.statusCode).toBe(503)
    expect(res.json().error.code).toBe("provider_unavailable")
    expect(mocks.insertJob).not.toHaveBeenCalled()
  })
  it("400 on videoAnalysis without videoUrl, on a 121-char label, on an unsafe videoUrl", async () => {
    expect((await post({ ...VALID, videoAnalysis: { llmModel: "mixed" } })).statusCode).toBe(400)
    expect((await post({ ...VALID, label: "x".repeat(121) })).statusCode).toBe(400)
    expect((await post({ ...VALID, videoUrl: "http://127.0.0.1/clip.mp4" })).statusCode).toBe(400)
    expect(mocks.insertJob).not.toHaveBeenCalled()
  })
  it("400 on an unconvertible schema before any row exists", async () => {
    const res = await post({ ...VALID, jsonSchema: { type: "object", properties: { a: { not: { type: "string" } } } } })
    expect(res.statusCode).toBe(400)
    expect(mocks.insertJob).not.toHaveBeenCalled()
  })

  it("400 on a root anyOf/oneOf/allOf before any row exists — the schema no provider lane can take", async () => {
    // This is the route the Studio Director uses (`llm.structuredJob`); the
    // 2026-09-10 outage was exactly this shape reaching a provider.
    const res = await post({ ...VALID, jsonSchema: { ...VALID.jsonSchema, anyOf: [{ required: ["title"] }] } })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
    expect(res.json().error.message).toContain("top level")
    expect(mocks.insertJob).not.toHaveBeenCalled()
  })
})

describe("a story run", () => {
  it("inserts the parent with the stored projection, reserves under llm-structured, enqueues attempts:1, answers { jobId }", async () => {
    const res = await post(VALID)
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ jobId: "parent-1" })

    const row = mocks.insertJob.mock.calls[0][1]
    expect(row.status).toBe("pending")
    expect(row.input_data.type).toBe("llm-structured")
    expect(row.input_data.origin).toBe("studio")
    expect(row.input_data.label).toBe("Rome chase")
    expect(row.input_data.system).toMatchObject({ chars: VALID.system.length })
    expect(row.input_data.jsonSchema).toEqual({ name: null, bytes: Buffer.byteLength(JSON.stringify(SCHEMA), "utf8") })
    expect(row.input_data).not.toHaveProperty("analysisJobId")

    expect(mocks.reserveCreditsForJob.mock.calls[0][2]).toBe("parent-1")
    expect(mocks.reserveCreditsForJob.mock.calls[0][3]).toMatch(/^llm-structured/)

    const [name, payload, opts] = mocks.queueAdd.mock.calls[0]
    expect(name).toBe("llm-structured")
    expect(opts).toEqual({ attempts: 1, removeOnFail: { count: 200 } })
    expect(payload).toMatchObject({ jobId: "parent-1", usageLogId: "usage-1", system: VALID.system, input: VALID.input, jsonSchema: SCHEMA, origin: "studio" })
    expect(payload).not.toHaveProperty("analysisJobId")
    expect(payload).not.toHaveProperty("userId")
    expect(analysisSeen).toBeNull()
  })
  it("stops at the reservation's own answer (402) — nothing enqueued", async () => {
    mocks.reserveCreditsForJob.mockImplementation(async (_req: unknown, reply: { status: (n: number) => { send: (b: unknown) => unknown } }) => {
      reply.status(402).send({ error: { code: "insufficient_credits", message: "Not enough credits" } })
      return undefined
    })
    const res = await post(VALID)
    expect(res.statusCode).toBe(402)
    expect(mocks.queueAdd).not.toHaveBeenCalled()
  })
})

describe("a movie run", () => {
  it("creates the child through the analysis route with the caller's auth + workspace forwarded, stamps it on the parent, enqueues it", async () => {
    mocks.jobRead.mockReturnValue({ id: "child-1", job_type: "video-analysis", status: "pending", output_data: null, credits: 60 })
    const res = await post({ ...VALID, videoUrl: VIDEO, videoAnalysis: { llmModel: "mixed", selectionMode: "combine" } })
    expect(res.statusCode).toBe(200)

    expect(analysisSeen).not.toBeNull()
    expect(analysisSeen!.headers.authorization).toBe("Bearer caller-token")
    expect(analysisSeen!.headers["x-nodaro-workspace"]).toBe("ws-1")
    expect(analysisSeen!.body).toEqual({ videoUrl: VIDEO, llmModel: "mixed", selectionMode: "combine" })

    // parent row created BEFORE the child (reserve first, so a refused child
    // has a single thing to undo) …
    expect(mocks.insertJob).toHaveBeenCalledTimes(1)
    expect(mocks.reserveCreditsForJob).toHaveBeenCalledTimes(1)
    // … then stamped with the child, in input_data AND output_data.stage,
    // WITH the child's own price (its reservation is on its row already) so
    // a run list shows the whole cost from the first read
    expect(mocks.jobUpdate).toHaveBeenCalledWith(expect.objectContaining({
      input_data: expect.objectContaining({ analysisJobId: "child-1", analysisCredits: 60, videoUrl: VIDEO, videoAnalysis: { llmModel: "mixed", selectionMode: "combine" } }),
      output_data: { stage: "analyzing", analysisJobId: "child-1", analysisCredits: 60 },
    }))
    const payload = mocks.queueAdd.mock.calls[0][1]
    expect(payload.analysisJobId).toBe("child-1")
    expect(payload).not.toHaveProperty("analysisReused")
    expect(payload).not.toHaveProperty("videoUrl")
    expect(payload).not.toHaveProperty("videoAnalysis")
  })
  it("a child whose price is not readable yet is stamped without one — never a guessed number", async () => {
    mocks.jobRead.mockReturnValue(null)
    const res = await post({ ...VALID, videoUrl: VIDEO })
    expect(res.statusCode).toBe(200)
    expect(mocks.jobUpdate).toHaveBeenCalledWith(expect.objectContaining({
      output_data: { stage: "analyzing", analysisJobId: "child-1" },
    }))
  })
  it("propagates the analysis route's refusal verbatim (422 too long) and undoes the parent: refund, delete, nothing enqueued", async () => {
    analysisAnswer = { status: 422, body: { error: { code: "video_too_long", message: "Video is 720 seconds. Maximum duration for analysis is 600 seconds (10 minutes)." } } }
    const res = await post({ ...VALID, videoUrl: VIDEO })
    expect(res.statusCode).toBe(422)
    expect(res.json()).toEqual(analysisAnswer.body)
    expect(mocks.refundReservedCreditsForJob).toHaveBeenCalledWith("parent-1")
    expect(mocks.jobDelete).toHaveBeenCalledTimes(1)
    expect(mocks.queueAdd).not.toHaveBeenCalled()
  })
  it("treats a 2xx without a jobId as 502 analysis_unavailable, undoing the parent the same way", async () => {
    analysisAnswer = { status: 200, body: {} }
    const res = await post({ ...VALID, videoUrl: VIDEO })
    expect(res.statusCode).toBe(502)
    expect(res.json().error.code).toBe("analysis_unavailable")
    expect(mocks.refundReservedCreditsForJob).toHaveBeenCalledWith("parent-1")
    expect(mocks.jobDelete).toHaveBeenCalledTimes(1)
  })
})

describe("a run drafted from a FINISHED analysis (analysisJobId — the Director spec's P3)", () => {
  const ANALYSIS_ID = "00000000-0000-4000-8000-00000000a001"
  const finished = (over: Record<string, unknown> = {}) => ({
    id: ANALYSIS_ID,
    job_type: "video-analysis",
    status: "completed",
    output_data: {
      json: {
        meta: { durationSec: 12, width: 1920, height: 1080, aspectRatio: "16:9", title: "Clip" },
        slots: [],
        scenes: [{ startSec: 0, endSec: 4, label: "Hook", shotType: "Medium Close-Up", camera: "push-in", visual: "waves", audio: [], sceneNumber: 1, visualResolved: "waves", slotRefs: [] }],
        warnings: [],
      },
    },
    credits: 60,
    ...over,
  })

  it("creates NO child, stamps the parent as reused at the drafting stage with no analysis price, and tells the worker", async () => {
    mocks.jobRead.mockReturnValue(finished())
    const res = await post({ ...VALID, videoUrl: VIDEO, analysisJobId: ANALYSIS_ID })
    expect(res.statusCode).toBe(200)
    expect(analysisSeen).toBeNull()
    expect(mocks.insertJob).toHaveBeenCalledTimes(1)
    expect(mocks.reserveCreditsForJob).toHaveBeenCalledTimes(1)
    expect(mocks.jobUpdate).toHaveBeenCalledWith(expect.objectContaining({
      input_data: expect.objectContaining({ analysisJobId: ANALYSIS_ID, analysisReused: true, videoUrl: VIDEO }),
      output_data: { stage: "drafting", analysisJobId: ANALYSIS_ID },
    }))
    expect(mocks.jobUpdate.mock.calls[0][0].input_data).not.toHaveProperty("analysisCredits")
    const payload = mocks.queueAdd.mock.calls[0][1]
    expect(payload).toMatchObject({ analysisJobId: ANALYSIS_ID, analysisReused: true })
    expect(payload).not.toHaveProperty("videoUrl")
  })
  it("needs no videoUrl at all — the analysis IS the source", async () => {
    mocks.jobRead.mockReturnValue(finished())
    expect((await post({ ...VALID, analysisJobId: ANALYSIS_ID })).statusCode).toBe(200)
    expect(analysisSeen).toBeNull()
  })
  it("refuses BEFORE any row exists: missing or foreign → 404, another job type / failed / running / unreadable → 422", async () => {
    const cases: Array<[unknown, number, string]> = [
      [null, 404, "not_found"],
      [finished({ job_type: "generate-image" }), 422, "not_analysis"],
      [finished({ status: "failed" }), 422, "analysis_failed"],
      [finished({ status: "cancelled" }), 422, "analysis_failed"],
      [finished({ status: "processing" }), 422, "analysis_not_ready"],
      [finished({ output_data: { json: { scenes: "nope" } } }), 422, "invalid_analysis"],
    ]
    for (const [row, status, code] of cases) {
      mocks.jobRead.mockReturnValue(row)
      const res = await post({ ...VALID, analysisJobId: ANALYSIS_ID })
      expect([res.statusCode, res.json().error.code]).toEqual([status, code])
    }
    expect(mocks.insertJob).not.toHaveBeenCalled()
    expect(mocks.reserveCreditsForJob).not.toHaveBeenCalled()
  })
  it("400 on videoAnalysis beside analysisJobId (nothing is analyzed), and on a non-uuid id", async () => {
    expect((await post({ ...VALID, videoUrl: VIDEO, analysisJobId: ANALYSIS_ID, videoAnalysis: { llmModel: "smart" } })).statusCode).toBe(400)
    expect((await post({ ...VALID, analysisJobId: "child-1" })).statusCode).toBe(400)
    expect(mocks.insertJob).not.toHaveBeenCalled()
  })
})
