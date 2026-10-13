/**
 * The Suno voice flow against a `jobs` table shaped like the real one.
 *
 * The route used to tag its rows with `model_identifier` / `metadata` and fail
 * a generation with an `error` key — none of them columns of `jobs`. PostgREST
 * rejects a request naming an unknown column outright, so the ownership rows
 * were never written, every ownership check answered "not yours", and a
 * generation KIE reported failed was never marked failed. The ordinary route
 * mocks accept any key, so nothing noticed. Here the table is schema-strict
 * (lib/__tests__/jobs-schema.ts): the flow runs end to end only on real columns.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

const { db, mockReserve, mockCommit, mockRefund, kie } = vi.hoisted(() => ({
  db: { current: undefined as unknown as ReturnType<typeof import("../../lib/__tests__/jobs-schema.js").strictJobsSupabase> },
  mockReserve: vi.fn(),
  mockCommit: vi.fn(),
  mockRefund: vi.fn(),
  kie: {
    validate: vi.fn(),
    validateInfo: vi.fn(),
    generate: vi.fn(),
    recordInfo: vi.fn(),
  },
}))

vi.mock("@/lib/supabase.js", () => ({
  supabase: { from: (table: string) => db.current.client.from(table), rpc: () => db.current.client.rpc() },
}))
vi.mock("@/lib/config.js", () => ({
  config: { EDITION: "cloud", SUPABASE_URL: "https://test.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "test" },
  isCloud: () => true,
  hasCredits: () => true,
  isCommunity: () => false,
  isBusiness: () => false,
  hasAdmin: () => true,
}))
vi.mock("@/lib/admin-check.js", () => ({ warmAdminCache: vi.fn(), checkIsAdmin: vi.fn().mockResolvedValue(false) }))
vi.mock("@/middleware/credit-guard.js", () => ({ creditGuard: () => async () => {}, reserveCreditsForJob: mockReserve }))
vi.mock("@/lib/credits-job-lifecycle.js", () => ({
  commitReservedCreditsForJob: mockCommit,
  refundReservedCreditsForJob: mockRefund,
}))
vi.mock("@/lib/queue.js", () => ({ videoQueue: { add: vi.fn() }, renderQueue: { add: vi.fn() }, redis: {}, tryRemoveFromQueue: vi.fn() }))
vi.mock("@/lib/url-validator.js", async () => {
  const { z } = await import("zod")
  return { safeUrlSchema: z.string().url() }
})
vi.mock("@/ee/billing/credits.js", () => ({
  CreditsService: { commitCredits: vi.fn(), refundCredits: vi.fn(), getModelCreditCost: vi.fn().mockResolvedValue(20) },
  estimateWorkflowCredits: vi.fn().mockReturnValue(20),
}))
vi.mock("@/providers/kie/suno-client.js", async (importActual) => ({
  ...(await importActual<typeof import("@/providers/kie/suno-client.js")>()),
  sunoVoiceValidate: kie.validate,
  sunoVoiceValidateInfo: kie.validateInfo,
  sunoVoiceGenerate: kie.generate,
  sunoVoiceRecordInfo: kie.recordInfo,
}))

import { sunoRoutes } from "../suno.js"
import { strictJobsSupabase } from "../../lib/__tests__/jobs-schema.js"

const ME = "00000000-0000-4000-8000-000000000001"
const SOMEONE_ELSE = "00000000-0000-4000-8000-000000000002"

let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()
  db.current = strictJobsSupabase()
  mockReserve.mockResolvedValue({ usageLogId: "usage-1", creditsReserved: 20, watermark: false })
  kie.validate.mockResolvedValue({ taskId: "kie-validate-1" })
  kie.validateInfo.mockResolvedValue({ status: "success", phrase: "say this" })
  kie.generate.mockResolvedValue({ taskId: "kie-generate-1" })
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    const header = req.headers["x-user-id"]
    if (typeof header === "string") req.userId = header
  })
  await app.register(async (instance) => sunoRoutes(instance))
  await app.ready()
})

afterEach(async () => {
  await app.close()
})

const as = (userId: string) => ({
  post: (url: string, payload: Record<string, unknown>) => app.inject({ method: "POST", url, headers: { "x-user-id": userId }, payload }),
  get: (url: string) => app.inject({ method: "GET", url, headers: { "x-user-id": userId } }),
})

/** Validate, then start a generation from it: the row a record-info poll settles. */
async function startGeneration(): Promise<string> {
  const validate = await as(ME).post("/v1/suno/voice/validate", { voiceUrl: "https://cdn.test/v.mp3", vocalStartS: 0, vocalEndS: 20 })
  expect(validate.statusCode).toBe(200)
  const generate = await as(ME).post("/v1/suno/voice/generate", { taskId: "kie-validate-1", verifyUrl: "https://cdn.test/verify.mp3" })
  expect(generate.statusCode).toBe(200)
  const { jobId } = generate.json() as { jobId: string }
  return jobId
}

const row = (id: string) => db.current.jobs.find((j) => j.id === id)!

describe("the voice flow on real jobs columns", () => {
  it("the stand-in table refuses a column jobs does not have, as PostgREST does — the old failure write", async () => {
    db.current = strictJobsSupabase([{ id: "j", user_id: ME, status: "processing" }])
    const res = await db.current.client.from("jobs").update({ status: "failed", error: "voice generation failed" }).eq("id", "j")
    expect(res.error?.message).toMatch(/'error' column/)
    expect(row("j").status).toBe("processing")
  })

  it("validate records ownership the validate-info poll then finds", async () => {
    await as(ME).post("/v1/suno/voice/validate", { voiceUrl: "https://cdn.test/v.mp3", vocalStartS: 0, vocalEndS: 20 })
    const owned = db.current.jobs.find((j) => j.provider_task_id === "kie-validate-1")
    expect(owned).toMatchObject({ user_id: ME, job_type: "suno-voice-validate", provider_kind: "kie-suno-voice-validate" })
    expect((await as(ME).get("/v1/suno/voice/validate-info?taskId=kie-validate-1")).statusCode).toBe(200)
    // Not the caller's task: not found, never polled upstream.
    expect((await as(SOMEONE_ELSE).get("/v1/suno/voice/validate-info?taskId=kie-validate-1")).statusCode).toBe(404)
    expect(kie.validateInfo).toHaveBeenCalledTimes(1)
  })

  it("a generation KIE reports failed is marked failed with its message, and refunded once", async () => {
    const jobId = await startGeneration()
    expect(row(jobId)).toMatchObject({ status: "processing", job_type: "suno-voice-create", provider_task_id: "kie-generate-1" })

    kie.recordInfo.mockResolvedValue({ status: "fail", errorMessage: "The recording did not match the phrase" })
    const res = await as(ME).get("/v1/suno/voice/record-info?taskId=kie-generate-1")
    expect(res.statusCode).toBe(200)
    expect(row(jobId)).toMatchObject({ status: "failed", error_message: "The recording did not match the phrase" })
    expect(row(jobId).completed_at).toEqual(expect.any(String))
    expect(mockRefund).toHaveBeenCalledTimes(1)
    expect(mockRefund).toHaveBeenCalledWith(jobId)

    // A re-poll of a settled row changes nothing and refunds nothing more.
    await as(ME).get("/v1/suno/voice/record-info?taskId=kie-generate-1")
    expect(mockRefund).toHaveBeenCalledTimes(1)
    expect(mockCommit).not.toHaveBeenCalled()
  })

  it("a generation that fails without a message is marked failed with the default one", async () => {
    const jobId = await startGeneration()
    kie.recordInfo.mockResolvedValue({ status: "fail" })
    await as(ME).get("/v1/suno/voice/record-info?taskId=kie-generate-1")
    expect(row(jobId)).toMatchObject({ status: "failed", error_message: "voice generation failed" })
  })

  it("a generation KIE reports done completes with its voice and commits", async () => {
    const jobId = await startGeneration()
    kie.recordInfo.mockResolvedValue({ status: "success", voiceId: "voice-9" })
    await as(ME).get("/v1/suno/voice/record-info?taskId=kie-generate-1")
    expect(row(jobId)).toMatchObject({ status: "completed", output_data: { voiceId: "voice-9" } })
    expect(mockCommit).toHaveBeenCalledWith(jobId)
    expect(mockRefund).not.toHaveBeenCalled()
  })

  it("someone else's generation is not found and settles nothing", async () => {
    const jobId = await startGeneration()
    kie.recordInfo.mockResolvedValue({ status: "fail", errorMessage: "x" })
    expect((await as(SOMEONE_ELSE).get("/v1/suno/voice/record-info?taskId=kie-generate-1")).statusCode).toBe(404)
    expect(row(jobId).status).toBe("processing")
    expect(mockRefund).not.toHaveBeenCalled()
  })

  it("a generation KIE refuses to start is marked failed and refunded", async () => {
    await as(ME).post("/v1/suno/voice/validate", { voiceUrl: "https://cdn.test/v.mp3", vocalStartS: 0, vocalEndS: 20 })
    kie.generate.mockRejectedValue(new Error("upstream said no"))
    const res = await as(ME).post("/v1/suno/voice/generate", { taskId: "kie-validate-1", verifyUrl: "https://cdn.test/verify.mp3" })
    expect(res.statusCode).toBe(502)
    const failed = db.current.jobs.find((j) => j.job_type === "suno-voice-create")!
    expect(failed).toMatchObject({ status: "failed", error_message: "upstream said no" })
    expect(mockRefund).toHaveBeenCalledWith(failed.id)
  })
})
