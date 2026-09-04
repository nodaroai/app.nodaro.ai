/**
 * The REQUEST gate, end to end at the helper level (spec §5.3, D4, D25).
 *
 * The gate lives inside `lib/insert-job.ts` because that funnel is already
 * total (`no-direct-job-insert.test.ts` fails the build on any other
 * `.from("jobs").insert(`), it runs AFTER provenance stamping so the policy
 * sees the values that will land on the row, and it runs BEFORE the insert —
 * so a block leaves no row, no reservation and nothing to clean up.
 *
 * The first case is the one that matters most: with no policy registered the
 * insert arguments must be byte-identical and NOTHING extra may be written.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import type { FastifyReply, FastifyRequest } from "fastify"

const { fromMock, insertMock, selectMock, singleMock, idempotentMock } = vi.hoisted(() => {
  const singleMock = vi.fn<(...a: unknown[]) => unknown>().mockResolvedValue({ data: { id: "job-1" }, error: null })
  const selectMock = vi.fn<(...a: unknown[]) => unknown>(() => ({ single: singleMock }))
  const insertMock = vi.fn<(...a: unknown[]) => unknown>(() => ({ select: selectMock }))
  const fromMock = vi.fn<(...a: unknown[]) => unknown>(() => ({ insert: insertMock }))
  const idempotentMock = vi.fn<(...a: unknown[]) => unknown>().mockResolvedValue({ data: { id: "job-1" }, created: true })
  return { fromMock, insertMock, selectMock, singleMock, idempotentMock }
})

vi.mock("../supabase.js", () => ({ supabase: { from: fromMock } }))
vi.mock("../idempotent-insert.js", () => ({ insertWithIdempotencyKey: idempotentMock }))

const audit = vi.hoisted(() => ({
  recordJobPolicyDecision: vi.fn(async (_input: Record<string, unknown>) => "decision-1"),
  hashGateSubject: vi.fn(() => "hash-1"),
}))
vi.mock("../job-policy-audit.js", () => audit)
vi.mock("../app-reports.js", () => ({ insertAppReport: vi.fn(async () => true) }))

import { insertJob, insertJobs, insertInternalJob, insertJobIdempotent } from "../insert-job.js"
import {
  registerJobPolicy,
  clearJobPolicies,
  JobBlockedError,
  DEFAULT_REQUEST_BLOCK_MESSAGE,
} from "../job-policy.js"
import { sendInternalError } from "../http-errors.js"

const req = {
  method: "POST",
  url: "/v1/generate-image",
  routeOptions: { url: "/v1/generate-image" },
  headers: {},
  body: {},
  log: { error: vi.fn(), info: vi.fn() },
} as unknown as FastifyRequest

function makeReply() {
  return {
    statusCode: 200 as number,
    body: undefined as unknown,
    status(code: number) { this.statusCode = code; return this },
    send(payload: unknown) { this.body = payload; return this },
  }
}

const row = { user_id: "u1", job_type: "generate-image", input_data: { prompt: "a cat", type: "generate-image" } }

beforeEach(() => {
  clearJobPolicies()
  vi.clearAllMocks()
  singleMock.mockResolvedValue({ data: { id: "job-1" }, error: null })
  idempotentMock.mockResolvedValue({ data: { id: "job-1" }, created: true })
})
afterEach(() => clearJobPolicies())

describe("insert helpers with NO policy registered", () => {
  it("insert arguments are byte-identical and no audit row is written", async () => {
    const res = await insertJob(req, row)
    expect(res).toEqual({ data: { id: "job-1" }, error: null })
    expect(insertMock).toHaveBeenCalledTimes(1)
    const arg = insertMock.mock.calls[0]![0] as Record<string, unknown>
    expect(arg).toMatchObject({ user_id: "u1", job_type: "generate-image" })
    expect(audit.recordJobPolicyDecision).not.toHaveBeenCalled()
  })

  it("insertJobIdempotent still delegates unchanged", async () => {
    await insertJobIdempotent(req, { ...row, user_id: "u1" }, "key-1")
    expect(idempotentMock).toHaveBeenCalledTimes(1)
    expect(audit.recordJobPolicyDecision).not.toHaveBeenCalled()
  })
})

describe("a BLOCKING policy", () => {
  beforeEach(() => {
    registerJobPolicy({
      id: "test-policy",
      checkRequest: () => ({ verdict: "block", reason: "nsfw_score=0.98", userMessage: "Not allowed here" }),
    })
  })

  it("insertJob returns the error arm carrying the block, and inserts NOTHING", async () => {
    const { data, error } = await insertJob(req, row)
    expect(data).toBeNull()
    expect(error).toMatchObject({ message: "Not allowed here" })
    expect((error as { blocked?: unknown }).blocked).toMatchObject({ code: "job_blocked", policyId: "test-policy" })
    expect(insertMock).not.toHaveBeenCalled()
  })

  it("insertJobs and insertInternalJob answer the same way (one union, one shape)", async () => {
    const many = await insertJobs(req, [row, row])
    expect(many.data).toBeNull()
    expect((many.error as { blocked?: unknown }).blocked).toBeTruthy()

    const internal = await insertInternalJob("orchestrator", row)
    expect(internal.data).toBeNull()
    expect((internal.error as { blocked?: unknown }).blocked).toBeTruthy()
    expect(insertMock).not.toHaveBeenCalled()
  })

  it("insertJobIdempotent THROWS JobBlockedError (it already throws on DB error)", async () => {
    await expect(insertJobIdempotent(req, { ...row, user_id: "u1" }, "key-1")).rejects.toBeInstanceOf(JobBlockedError)
    expect(idempotentMock).not.toHaveBeenCalled()
  })

  it("the audit row keeps job_id NULL — no row was ever created", async () => {
    await insertJob(req, row)
    expect(audit.recordJobPolicyDecision).toHaveBeenCalledTimes(1)
    expect(audit.recordJobPolicyDecision.mock.calls[0]![0]).toMatchObject({
      jobId: null,
      hookPoint: "request",
      verdict: "block",
      policyId: "test-policy",
      reason: "nsfw_score=0.98",
    })
  })

  it("sendInternalError turns that error into a 422 job_blocked, NOT a 500", async () => {
    const { error } = await insertJob(req, row)
    const reply = makeReply()
    sendInternalError(reply as unknown as FastifyReply, req, error, "Failed to create job")
    expect(reply.statusCode).toBe(422)
    expect(reply.body).toEqual({ error: { code: "job_blocked", message: "Not allowed here" } })
  })

  it("sendInternalError also maps a THROWN JobBlockedError (the idempotent lane)", async () => {
    const err = await insertJobIdempotent(req, { ...row, user_id: "u1" }, "k").catch((e) => e)
    const reply = makeReply()
    sendInternalError(reply as unknown as FastifyReply, req, err, "Failed to create job")
    expect(reply.statusCode).toBe(422)
    expect((reply.body as { error: { code: string } }).error.code).toBe("job_blocked")
  })

  it("an ordinary error is still a 500 (the branch is narrow)", () => {
    const reply = makeReply()
    sendInternalError(reply as unknown as FastifyReply, req, new Error("db down"), "Failed to create job")
    expect(reply.statusCode).toBe(500)
    expect((reply.body as { error: { code: string } }).error.code).toBe("internal_error")
  })
})

describe("an ALLOWING policy", () => {
  it("inserts the row and records one allow decision carrying the new job id", async () => {
    registerJobPolicy({ id: "test-policy", checkRequest: () => ({ verdict: "allow" }) })
    const { data } = await insertJob(req, row)
    expect(data).toEqual({ id: "job-1" })
    expect(audit.recordJobPolicyDecision).toHaveBeenCalledTimes(1)
    expect(audit.recordJobPolicyDecision.mock.calls[0]![0]).toMatchObject({
      jobId: "job-1",
      hookPoint: "request",
      verdict: "allow",
      policyId: "*",
    })
  })

  it("records nothing when the insert itself failed (an unjoinable row helps nobody)", async () => {
    registerJobPolicy({ id: "test-policy", checkRequest: () => ({ verdict: "allow" }) })
    singleMock.mockResolvedValueOnce({ data: null, error: { message: "db down" } })
    const { error } = await insertJob(req, row)
    expect(error).toBeTruthy()
    expect(audit.recordJobPolicyDecision).not.toHaveBeenCalled()
  })

  it("a RESULT-only policy does not gate the insert lane at all (D23)", async () => {
    registerJobPolicy({ id: "result-only", checkResult: () => ({ verdict: "allow" }) })
    await insertJob(req, row)
    expect(audit.recordJobPolicyDecision).not.toHaveBeenCalled()
  })
})

describe("a BLOCKING policy that supplies NO userMessage", () => {
  beforeEach(() => {
    registerJobPolicy({
      id: "test-policy",
      checkRequest: () => ({ verdict: "block", reason: "nsfw_score=0.98 label=explicit" }),
    })
  })

  it("the 422 body speaks the PLATFORM's sentence, never the machine reason (D13)", async () => {
    const { error } = await insertJob(req, row)
    const reply = makeReply()
    sendInternalError(reply as unknown as FastifyReply, req, error, "Failed to create job")
    expect(reply.statusCode).toBe(422)
    expect(reply.body).toEqual({
      error: { code: "job_blocked", message: DEFAULT_REQUEST_BLOCK_MESSAGE },
    })
    expect(JSON.stringify(reply.body)).not.toContain("nsfw_score")
  })

  it("the audit row still keeps the machine reason, alongside the sentence shown", async () => {
    await insertJob(req, row)
    expect(audit.recordJobPolicyDecision.mock.calls[0]![0]).toMatchObject({
      verdict: "block",
      reason: "nsfw_score=0.98 label=explicit",
      userMessage: DEFAULT_REQUEST_BLOCK_MESSAGE,
    })
  })
})

describe("a THROWING policy", () => {
  it("blocks with the platform's own words, never the policy's", async () => {
    registerJobPolicy({ id: "boom", checkRequest: () => { throw new Error("moderation down") } })
    const { data, error } = await insertJob(req, row)
    expect(data).toBeNull()
    expect((error as { blocked?: { policyId: string } }).blocked?.policyId).toBe("platform")
    expect(error!.message).toBe("Generation could not be verified")
    expect(insertMock).not.toHaveBeenCalled()
  })
})

describe("the batch rule", () => {
  it("judges insertJobs all-or-nothing on the first row (one user action)", async () => {
    const seen: unknown[] = []
    registerJobPolicy({
      id: "test-policy",
      checkRequest: (i) => { seen.push(i.rowCount); return { verdict: "allow" } },
    })
    selectMock.mockReturnValueOnce({ single: singleMock } as never)
    await insertJobs(req, [row, row, row])
    expect(seen).toEqual([3])
  })
})
