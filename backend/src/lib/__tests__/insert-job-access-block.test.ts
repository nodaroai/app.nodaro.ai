/**
 * A blocked account starts no new job (`lib/insert-job.ts :: gateJobInsert`).
 *
 * The insert funnel is the one place every job passes on every edition and in
 * every process — a request, a trigger, a worker, a scheduled post — not only
 * requests behind the auth hook. So the platform asks there, FIRST:
 *  - before the job-policy registry (a registered request policy is never even
 *    consulted for a blocked owner),
 *  - without writing a `job_policy_decisions` row (it is the platform's rule,
 *    not a policy's decision),
 *  - and before the insert: no row, no reservation, nothing to clean up.
 * The refusal reuses the registry's shape (`job_blocked`, policyId
 * `platform:access-block`), so every creator lane already handles it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import type { FastifyReply, FastifyRequest } from "fastify"

const BLOCKED = "00000000-0000-4000-8000-0000000000b1"
const OWNER = "00000000-0000-4000-8000-0000000000a1"

const { fromMock, insertMock, singleMock, idempotentMock } = vi.hoisted(() => {
  const singleMock = vi.fn<(...a: unknown[]) => unknown>().mockResolvedValue({ data: { id: "job-1" }, error: null })
  const selectMock = vi.fn<(...a: unknown[]) => unknown>(() => ({ single: singleMock }))
  const insertMock = vi.fn<(...a: unknown[]) => unknown>(() => ({ select: selectMock }))
  const fromMock = vi.fn<(...a: unknown[]) => unknown>(() => ({ insert: insertMock }))
  const idempotentMock = vi.fn<(...a: unknown[]) => unknown>().mockResolvedValue({ row: { id: "job-1" }, created: true })
  return { fromMock, insertMock, singleMock, idempotentMock }
})

vi.mock("../supabase.js", () => ({ supabase: { from: fromMock } }))
vi.mock("../idempotent-insert.js", () => ({ insertWithIdempotencyKey: idempotentMock }))

const audit = vi.hoisted(() => ({
  recordJobPolicyDecision: vi.fn(async (_input: Record<string, unknown>) => "decision-1"),
  hashGateSubject: vi.fn(() => "hash-1"),
}))
vi.mock("../job-policy-audit.js", () => audit)
vi.mock("../app-reports.js", () => ({ insertAppReport: vi.fn(async () => true) }))

const access = vi.hoisted(() => {
  const blocked = new Set<string>()
  return {
    blocked,
    isUserBlocked: vi.fn(async (id: string | null | undefined) => (id ? blocked.has(id) : false)),
  }
})
vi.mock("../access-blocks.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../access-blocks.js")>()),
  isUserBlocked: (id: string | null | undefined) => access.isUserBlocked(id),
}))

import {
  ACCOUNT_BLOCK_POLICY_ID,
  insertInternalJob,
  insertJob,
  insertJobIdempotent,
  insertJobs,
  JobBlockedError,
} from "../insert-job.js"
import { clearJobPolicies, registerJobPolicy } from "../job-policy.js"
import { ACCESS_BLOCKED_BODY } from "../access-blocks.js"
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
    status(code: number) {
      this.statusCode = code
      return this
    },
    send(payload: unknown) {
      this.body = payload
      return this
    },
  }
}

const rowOf = (user_id: string) => ({
  user_id,
  job_type: "generate-image",
  input_data: { prompt: "a cat", type: "generate-image" },
})

const BLOCK = {
  code: "job_blocked",
  policyId: "platform:access-block",
  message: ACCESS_BLOCKED_BODY.error.message,
}

beforeEach(() => {
  clearJobPolicies()
  vi.clearAllMocks()
  access.blocked.clear()
  access.blocked.add(BLOCKED)
  singleMock.mockResolvedValue({ data: { id: "job-1" }, error: null })
  idempotentMock.mockResolvedValue({ row: { id: "job-1" }, created: true })
})
afterEach(() => clearJobPolicies())

describe("a blocked owner", () => {
  it("is refused with job_blocked / platform:access-block — nothing inserted, nothing recorded", async () => {
    expect(ACCOUNT_BLOCK_POLICY_ID).toBe("platform:access-block")
    const res = await insertJob(req, rowOf(BLOCKED))
    expect(res).toEqual({ data: null, error: { message: BLOCK.message, blocked: BLOCK } })
    expect(access.isUserBlocked).toHaveBeenCalledWith(BLOCKED)
    expect(insertMock).not.toHaveBeenCalled()
    expect(fromMock).not.toHaveBeenCalled()
    expect(audit.recordJobPolicyDecision).not.toHaveBeenCalled()
  })

  it("is refused the same way on every helper (one union, one shape)", async () => {
    const many = await insertJobs(req, [rowOf(BLOCKED), rowOf(BLOCKED)])
    expect(many).toEqual({ data: null, error: { message: BLOCK.message, blocked: BLOCK } })

    const internal = await insertInternalJob("orchestrator", rowOf(BLOCKED))
    expect(internal).toEqual({ data: null, error: { message: BLOCK.message, blocked: BLOCK } })

    const thrown = await insertJobIdempotent(req, rowOf(BLOCKED), "key-1").catch((e: unknown) => e)
    expect(thrown).toBeInstanceOf(JobBlockedError)
    expect((thrown as JobBlockedError).block).toEqual(BLOCK)

    expect(insertMock).not.toHaveBeenCalled()
    expect(idempotentMock).not.toHaveBeenCalled()
    expect(audit.recordJobPolicyDecision).not.toHaveBeenCalled()
  })

  it("is refused BEFORE the policy registry — a registered request policy is never asked", async () => {
    const checkRequest = vi.fn(() => ({ verdict: "allow" as const }))
    registerJobPolicy({ id: "test-policy", checkRequest })

    const blocked = await insertJob(req, rowOf(BLOCKED))
    expect(blocked.error).toMatchObject({ blocked: { policyId: "platform:access-block" } })
    expect(checkRequest).not.toHaveBeenCalled()
    expect(audit.recordJobPolicyDecision).not.toHaveBeenCalled()

    // The same policy IS asked for anyone else — the negative above is not vacuous.
    const allowed = await insertJob(req, rowOf(OWNER))
    expect(allowed).toEqual({ data: { id: "job-1" }, error: null })
    expect(checkRequest).toHaveBeenCalledTimes(1)
  })

  it("wins over a policy that would block it too — the refusal is the platform's, not the policy's", async () => {
    registerJobPolicy({ id: "nsfw", checkRequest: () => ({ verdict: "block", reason: "x", userMessage: "Not here" }) })
    const res = await insertJob(req, rowOf(BLOCKED))
    expect(res.error).toEqual({ message: BLOCK.message, blocked: BLOCK })
    expect(audit.recordJobPolicyDecision).not.toHaveBeenCalled()
  })

  it("a batch is judged on its first row's owner (one user action)", async () => {
    const res = await insertJobs(req, [rowOf(BLOCKED), rowOf(OWNER)])
    expect(res.error).toEqual({ message: BLOCK.message, blocked: BLOCK })
    expect(access.isUserBlocked).toHaveBeenCalledWith(BLOCKED)
    expect(insertMock).not.toHaveBeenCalled()
  })

  it("reaches the caller as 422 job_blocked with the block's sentence — not a 500", async () => {
    const { error } = await insertJob(req, rowOf(BLOCKED))
    const reply = makeReply()
    sendInternalError(reply as unknown as FastifyReply, req, error, "Failed to create job")
    expect(reply.statusCode).toBe(422)
    expect(reply.body).toEqual({ error: { code: "job_blocked", message: ACCESS_BLOCKED_BODY.error.message } })
  })
})

describe("an owner who is not blocked", () => {
  it("proceeds exactly as before: one insert, no decision row", async () => {
    const res = await insertJob(req, rowOf(OWNER))
    expect(res).toEqual({ data: { id: "job-1" }, error: null })
    expect(access.isUserBlocked).toHaveBeenCalledWith(OWNER)
    expect(fromMock).toHaveBeenCalledWith("jobs")
    expect(insertMock).toHaveBeenCalledTimes(1)
    expect(insertMock.mock.calls[0]![0]).toMatchObject({ user_id: OWNER, job_type: "generate-image" })
    expect(audit.recordJobPolicyDecision).not.toHaveBeenCalled()
  })

  it("on every helper", async () => {
    await insertJobs(req, [rowOf(OWNER)])
    await insertInternalJob("orchestrator", rowOf(OWNER))
    await insertJobIdempotent(req, rowOf(OWNER), "key-1")
    expect(insertMock).toHaveBeenCalledTimes(2)
    expect(idempotentMock).toHaveBeenCalledTimes(1)
  })

  it("a row with no owner is never refused for a block", async () => {
    const res = await insertInternalJob("cron", { job_type: "cleanup", input_data: { type: "cleanup" } })
    expect(res).toEqual({ data: { id: "job-1" }, error: null })
    expect(insertMock).toHaveBeenCalledTimes(1)
  })
})
