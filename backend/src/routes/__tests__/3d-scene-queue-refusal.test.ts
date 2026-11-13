/**
 * POST /v1/3d-scene/generate and /edit when the QUEUE refuses the job.
 *
 * The parent row and its reservation exist, and for a video reference so does
 * the `video-analysis` child started for it. The queue then refuses the
 * parent, so nothing will ever run it. It is failed from `pending` and
 * refunded, and the request is answered `500 internal_error`, through the
 * shared rule (lib/enqueue-route-job.ts): the person sees a failed run with
 * its refund, never a vanished one (the row is never deleted). The analysis
 * child has nobody left to wait for it, so it is cancelled through the
 * single-job cancel. A parent that moved on (a worker claimed it before the
 * queue's answer was lost) is answered as started, its child left to run.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

const m = vi.hoisted(() => ({
  insertJob: vi.fn(),
  reserveCreditsForJob: vi.fn(),
  queueAdd: vi.fn(),
  jobDelete: vi.fn(),
  refundReservedCreditsForJob: vi.fn(),
  refundJobHoldsConfirmed: vi.fn(),
  markJobFailedDetailed: vi.fn(),
  insertAppReport: vi.fn(),
  cancelOwnedJob: vi.fn(),
  /** The analysis child's stamp on the parent (stampAnalysisChild's update) throws. */
  stampThrows: false,
}))

vi.mock("@/lib/config.js", () => ({
  config: { EDITION: "cloud", ANTHROPIC_API_KEY: "test-key", KIE_API_KEY: "", GEMINI_API_KEY: "", SUPABASE_URL: "https://test.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "test" },
  isCloud: () => true, hasCredits: () => true, isCommunity: () => false, isBusiness: () => false, hasAdmin: () => true,
  // The tier id, reserved through reserveCreditsForJob: what is reserved does not matter here.
  llmMeteredPricing: () => false,
}))
vi.mock("@/lib/app-settings.js", () => ({ getAppSettings: vi.fn(async () => ({ cost_markup_percent: 10 })) }))
vi.mock("@/lib/cloud-llm-proxy.js", () => ({ shouldProxyLlmToCloud: vi.fn(async () => false) }))
vi.mock("@/lib/insert-job.js", () => ({ insertJob: m.insertJob }))
vi.mock("@/middleware/credit-guard.js", () => ({
  creditGuard: () => async () => {},
  reserveCreditsForJob: m.reserveCreditsForJob,
}))
vi.mock("@/lib/credits-job-lifecycle.js", () => ({
  refundReservedCreditsForJob: m.refundReservedCreditsForJob,
  refundJobHoldsConfirmed: m.refundJobHoldsConfirmed,
}))
vi.mock("@/lib/job-failure.js", () => ({ markJobFailedDetailed: m.markJobFailedDetailed }))
vi.mock("@/lib/app-reports.js", () => ({ insertAppReport: m.insertAppReport }))
vi.mock("@/lib/cancel-job.js", () => ({ cancelOwnedJob: m.cancelOwnedJob }))
vi.mock("@/lib/queue.js", () => ({ videoQueue: { add: m.queueAdd }, tryRemoveFromQueue: vi.fn(), redis: {} }))
vi.mock("@/lib/supabase.js", () => {
  const eqUser = vi.fn().mockResolvedValue({ data: null, error: null })
  const eqId = vi.fn(() => ({ eq: eqUser }))
  // The helper's read-back of a failure write whose answer was lost: the read fails too.
  const readBack = { eq: () => ({ maybeSingle: async () => ({ data: null, error: { message: "unreachable" } }) }) }
  return {
    supabase: {
      from: vi.fn(() => ({
        update: () => {
          if (m.stampThrows) throw new Error("statement timeout")
          return { eq: eqId }
        },
        delete: () => { m.jobDelete(); return { eq: eqId } },
        select: () => readBack,
      })),
    },
  }
})

import { scene3DRoutes } from "../3d-scene.js"
import { SCENE3D_PLAN_TYPE, SCENE3D_SCHEMA_VERSION, type Scene3DPlan } from "@nodaro/shared/scene3d"
import { UNQUEUED_FAILURE_UNCONFIRMED_KIND } from "../../lib/enqueue-route-job.js"

const USER_ID = "00000000-0000-4000-8000-000000000001"
const REV = "11111111-2222-4333-8444-555555555555"
const VIDEO = "https://r2.example/uploads/clip.mp4"
const VIDEO_REF = { id: "r1", url: VIDEO, kind: "video", role: "motion" }
const REFUSED = () => new Error("OOM command not allowed when used memory > 'maxmemory'.")
const QUEUE_OPTIONS = { attempts: 1, removeOnFail: { count: 200 } }

const PLAN: Scene3DPlan = {
  planType: SCENE3D_PLAN_TYPE,
  schemaVersion: SCENE3D_SCHEMA_VERSION,
  revisionId: REV,
  width: 1920,
  height: 1080,
  fps: 24,
  durationInFrames: 96,
  backgroundColor: "#101014",
  camera: { position: [0, 2, 6], target: [0, 0, 0], focalLengthMm: 35, sensorWidthMm: 36 },
  objects: [
    { id: "ground", name: "Ground", primitive: "plane", dimensions: [10, 0.01, 10], position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], color: "#333333" },
  ],
  lighting: { ambientIntensity: 0.4, keyIntensity: 1.2, keyPosition: [4, 6, 4] },
}

let app: FastifyInstance

const post = (url: string, payload: Record<string, unknown>) =>
  app.inject({ method: "POST", url, headers: { authorization: "Bearer caller-token" }, payload: { userId: USER_ID, ...payload } })
const generate = (over: Record<string, unknown> = {}) => post("/v1/3d-scene/generate", { prompt: "A lone figure in an empty warehouse", ...over })
const edit = (over: Record<string, unknown>) => post("/v1/3d-scene/edit", { scenePlan: PLAN, expectedRevisionId: REV, ...over })

/** Let the handler finish what it does after the 500 went out, before asserting it did NOT do something. */
const settle = () => new Promise((resolve) => setImmediate(resolve))

/** The parent was failed through the shared rule: from `pending` only, its key released, refunded confirmed, never deleted. */
function expectFailedNotDeleted(): void {
  expect(m.markJobFailedDetailed).toHaveBeenCalledWith("job-1", expect.objectContaining({ from: ["pending"], extra: { idempotency_key: null } }))
  expect(m.refundJobHoldsConfirmed).toHaveBeenCalledWith("job-1")
  expect(m.jobDelete).not.toHaveBeenCalled()
  expect(m.refundReservedCreditsForJob).not.toHaveBeenCalled()
}

beforeEach(async () => {
  vi.clearAllMocks()
  m.insertJob.mockResolvedValue({ data: { id: "job-1" }, error: null })
  m.reserveCreditsForJob.mockResolvedValue({ usageLogId: "usage-1", creditsReserved: 30, watermark: false })
  m.queueAdd.mockResolvedValue({ id: "bull-1" })
  m.markJobFailedDetailed.mockResolvedValue("flipped")
  m.refundJobHoldsConfirmed.mockResolvedValue(true)
  m.stampThrows = false
  m.insertAppReport.mockResolvedValue(true)
  m.cancelOwnedJob.mockResolvedValue({ kind: "cancelled", analysisJobId: null })

  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    const body = req.body as Record<string, unknown> | undefined
    if (typeof body?.userId === "string") req.userId = body.userId
  })
  app.post("/v1/video-analysis", async () => ({ jobId: "analysis-1" }))
  await app.register(async (instance) => { await scene3DRoutes(instance) })
  await app.ready()
})
afterEach(async () => { await app.close() })

describe("POST /v1/3d-scene/generate: the queue refuses the job", () => {
  it("fails and refunds the parent, answers 500 internal_error, then cancels the analysis child started for it", async () => {
    m.queueAdd.mockRejectedValueOnce(REFUSED())
    const res = await generate({ references: [VIDEO_REF] })
    expect(res.statusCode).toBe(500)
    expect(res.json().error.code).toBe("internal_error")
    expectFailedNotDeleted()
    await vi.waitFor(() => expect(m.cancelOwnedJob).toHaveBeenCalledWith("analysis-1", USER_ID))
    expect(m.cancelOwnedJob).toHaveBeenCalledTimes(1)
    // After the parent is failed: never a child cancelled for a parent that may still run.
    expect(m.markJobFailedDetailed.mock.invocationCallOrder[0]!).toBeLessThan(m.cancelOwnedJob.mock.invocationCallOrder[0]!)
    // The queue options the job always had ride the refused add too.
    expect(m.queueAdd).toHaveBeenCalledWith("generate-3d-scene", expect.objectContaining({ jobId: "job-1", analysisJobId: "analysis-1" }), QUEUE_OPTIONS)
  })

  it("with no video reference: failed and refunded, no child to cancel", async () => {
    m.queueAdd.mockRejectedValueOnce(REFUSED())
    const res = await generate()
    expect(res.statusCode).toBe(500)
    expectFailedNotDeleted()
    await settle()
    expect(m.cancelOwnedJob).not.toHaveBeenCalled()
  })

  it("a parent that moved on (a worker claimed it) is answered as started: not refunded, not deleted, its child left to run", async () => {
    m.queueAdd.mockRejectedValueOnce(new Error("Connection is closed."))
    m.markJobFailedDetailed.mockResolvedValue("missed")
    const res = await generate({ references: [VIDEO_REF] })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ jobId: "job-1" })
    expect(m.refundJobHoldsConfirmed).not.toHaveBeenCalled()
    expect(m.jobDelete).not.toHaveBeenCalled()
    expect(m.cancelOwnedJob).not.toHaveBeenCalled()
  })

  it("a failure that cannot be confirmed is still answered 500 and reported; the child is cancelled, as the request was answered with the failure", async () => {
    m.queueAdd.mockRejectedValueOnce(REFUSED())
    m.markJobFailedDetailed.mockResolvedValue("error")
    const res = await generate({ references: [VIDEO_REF] })
    expect(res.statusCode).toBe(500)
    expect(res.json().error.code).toBe("internal_error")
    expect(m.insertAppReport).toHaveBeenCalledWith(expect.objectContaining({ kind: UNQUEUED_FAILURE_UNCONFIRMED_KIND, jobId: "job-1" }))
    expect(m.refundJobHoldsConfirmed).not.toHaveBeenCalled()
    expect(m.jobDelete).not.toHaveBeenCalled()
    await vi.waitFor(() => expect(m.cancelOwnedJob).toHaveBeenCalledWith("analysis-1", USER_ID))
  })

  it("a child cancel that throws changes nothing about the answer", async () => {
    m.queueAdd.mockRejectedValueOnce(REFUSED())
    m.cancelOwnedJob.mockRejectedValueOnce(new Error("supabase unreachable"))
    const res = await generate({ references: [VIDEO_REF] })
    expect(res.statusCode).toBe(500)
    expect(res.json().error.code).toBe("internal_error")
    await vi.waitFor(() => expect(m.cancelOwnedJob).toHaveBeenCalledTimes(1))
    expectFailedNotDeleted()
  })

  it("a queued job is unchanged: answered { jobId }, its options kept, nothing failed, refunded or cancelled", async () => {
    const res = await generate({ references: [VIDEO_REF] })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ jobId: "job-1" })
    expect(m.queueAdd).toHaveBeenCalledWith("generate-3d-scene", expect.objectContaining({ jobId: "job-1" }), QUEUE_OPTIONS)
    expect(m.markJobFailedDetailed).not.toHaveBeenCalled()
    expect(m.refundJobHoldsConfirmed).not.toHaveBeenCalled()
    expect(m.cancelOwnedJob).not.toHaveBeenCalled()
  })
})

describe("POST /v1/3d-scene/edit: the queue refuses the job", () => {
  it("the instruction lane with a video: failed, refunded, 500, its analysis child cancelled", async () => {
    m.queueAdd.mockRejectedValueOnce(REFUSED())
    const res = await edit({ prompt: "match this camera move", references: [VIDEO_REF] })
    expect(res.statusCode).toBe(500)
    expect(res.json().error.code).toBe("internal_error")
    expectFailedNotDeleted()
    expect(m.queueAdd).toHaveBeenCalledWith("edit-3d-scene", expect.objectContaining({ jobId: "job-1", analysisJobId: "analysis-1" }), QUEUE_OPTIONS)
    await vi.waitFor(() => expect(m.cancelOwnedJob).toHaveBeenCalledWith("analysis-1", USER_ID))
  })

  it("the deterministic lane: failed, refunded, 500, no child to cancel", async () => {
    m.queueAdd.mockRejectedValueOnce(REFUSED())
    const res = await edit({ operations: [{ op: "set-background", color: "#000000" }] })
    expect(res.statusCode).toBe(500)
    expectFailedNotDeleted()
    await settle()
    expect(m.cancelOwnedJob).not.toHaveBeenCalled()
  })

  it("an edit that moved on is answered as started, its child left to run", async () => {
    m.queueAdd.mockRejectedValueOnce(new Error("Connection is closed."))
    m.markJobFailedDetailed.mockResolvedValue("missed")
    const res = await edit({ prompt: "match this camera move", references: [VIDEO_REF] })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ jobId: "job-1" })
    expect(m.refundJobHoldsConfirmed).not.toHaveBeenCalled()
    expect(m.cancelOwnedJob).not.toHaveBeenCalled()
  })
})

describe("POST /v1/3d-scene: the analysis child's stamp throws (after the child exists)", () => {
  it("generate: the parent takes the fail rule — failed, refunded, 500, its child cancelled, never deleted, nothing queued", async () => {
    m.stampThrows = true
    const res = await generate({ references: [VIDEO_REF] })
    expect(res.statusCode).toBe(500)
    expect(res.json().error.code).toBe("internal_error")
    expectFailedNotDeleted()
    expect(m.queueAdd).not.toHaveBeenCalled()
    await vi.waitFor(() => expect(m.cancelOwnedJob).toHaveBeenCalledWith("analysis-1", USER_ID))
  })

  it("edit: the same", async () => {
    m.stampThrows = true
    const res = await edit({ prompt: "match this camera move", references: [VIDEO_REF] })
    expect(res.statusCode).toBe(500)
    expectFailedNotDeleted()
    expect(m.queueAdd).not.toHaveBeenCalled()
    await vi.waitFor(() => expect(m.cancelOwnedJob).toHaveBeenCalledWith("analysis-1", USER_ID))
  })
})
