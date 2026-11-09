/**
 * The content guard at the insert funnel (`gateJobInsert`, lib/insert-job.ts):
 * the third platform rule, after a blocked account and a restricted input.
 *
 * A refused row is never inserted, so no reservation can follow it. The words
 * are placeholders (`MINORTERM` / `ADULTTERM`), and no guard registered must
 * leave the funnel exactly as it was.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import type { FastifyRequest } from "fastify"

const { fromMock, insertMock, selectMock, singleMock, audit } = vi.hoisted(() => {
  const singleMock = vi.fn<(...a: unknown[]) => unknown>().mockResolvedValue({ data: { id: "job-1" }, error: null })
  const selectMock = vi.fn<(...a: unknown[]) => unknown>(() => ({ single: singleMock }))
  const insertMock = vi.fn<(...a: unknown[]) => unknown>(() => ({ select: selectMock }))
  const fromMock = vi.fn<(...a: unknown[]) => unknown>(() => ({ insert: insertMock }))
  return {
    fromMock,
    insertMock,
    selectMock,
    singleMock,
    audit: {
      recordJobPolicyDecision: vi.fn(async (_input: Record<string, unknown>) => "decision-1"),
      hashGateSubject: vi.fn(() => "hash-1"),
    },
  }
})

vi.mock("../supabase.js", () => ({ supabase: { from: fromMock } }))
vi.mock("../job-policy-audit.js", () => audit)
vi.mock("../access-blocks.js", () => ({ isUserBlocked: vi.fn(async () => false), ACCESS_BLOCKED_BODY: { error: { message: "blocked" } } }))
vi.mock("../content-restriction-gate.js", () => ({
  CONTENT_RESTRICTED_MESSAGE: "restricted",
  CONTENT_RESTRICTION_POLICY_ID: "platform:content-restriction",
  restrictedInputKey: vi.fn(async () => null),
}))
vi.mock("../content-restriction-address.js", () => ({}))
vi.mock("../content-restriction-set.js", () => ({}))

import { insertInternalJob, insertJob } from "../insert-job.js"
import { __flushContentGuardAuditForTests, clearContentGuard, CONTENT_GUARD_MESSAGE, CONTENT_GUARD_POLICY_ID, registerContentGuard } from "../content-guard.js"

const req = {
  method: "POST",
  url: "/v1/generate-image",
  routeOptions: { url: "/v1/generate-image" },
  headers: {},
  body: {},
  log: { error: vi.fn(), info: vi.fn() },
} as unknown as FastifyRequest

function register(): void {
  registerContentGuard({
    proveReady: () => true,
    id: "placeholder-guard",
    check(subject) {
      const text = subject.texts.join(" ")
      const minor = subject.minorSignal || text.includes("MINORTERM")
      return minor && text.includes("ADULTTERM") ? { refused: true, reason: "placeholder-combination" } : { refused: false }
    },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  singleMock.mockResolvedValue({ data: { id: "job-1" }, error: null })
  clearContentGuard()
})

afterEach(async () => {
  await __flushContentGuardAuditForTests()
  clearContentGuard()
})

describe("the insert funnel with no guard", () => {
  it("inserts the row as given and writes no decision", async () => {
    const { data, error } = await insertJob(req, { user_id: "u1", job_type: "generate-image", input_data: { prompt: "MINORTERM ADULTTERM" } })
    expect(error).toBeNull()
    expect(data).toEqual({ id: "job-1" })
    expect(insertMock).toHaveBeenCalledTimes(1)
    expect(audit.recordJobPolicyDecision).not.toHaveBeenCalled()
  })
})

describe("the insert funnel with a guard", () => {
  beforeEach(register)

  it("refuses a row whose content the guard refuses: no insert, a coded error, one decision", async () => {
    const { data, error } = await insertJob(req, {
      user_id: "u1",
      job_type: "generate-image",
      input_data: { prompt: "MINORTERM and ADULTTERM", imageUrl: "https://cdn.example.test/ok.png" },
    })
    expect(data).toBeNull()
    expect(error?.blocked).toEqual({ code: "job_blocked", policyId: CONTENT_GUARD_POLICY_ID, message: CONTENT_GUARD_MESSAGE })
    expect(insertMock).not.toHaveBeenCalled()
    await __flushContentGuardAuditForTests()
    expect(audit.recordJobPolicyDecision).toHaveBeenCalledTimes(1)
    const row = audit.recordJobPolicyDecision.mock.calls[0]![0]
    expect(row).toMatchObject({ jobId: null, policyId: CONTENT_GUARD_POLICY_ID, verdict: "block", userId: "u1", jobType: "generate-image" })
    expect(JSON.stringify(row)).not.toMatch(/MINORTERM|ADULTTERM/)
  })

  it("reads a Person value on the row (the catalog's minor ages)", async () => {
    const { error } = await insertJob(req, { user_id: "u1", job_type: "generate-image", input_data: { prompt: "ADULTTERM", person: { age: "age-child" } } })
    expect(error?.blocked?.policyId).toBe(CONTENT_GUARD_POLICY_ID)
    expect(insertMock).not.toHaveBeenCalled()
  })

  it("reads the row's subjectMinor flag", async () => {
    const { error } = await insertJob(req, { user_id: "u1", input_data: { prompt: "ADULTTERM", subjectMinor: true } })
    expect(error?.blocked?.policyId).toBe(CONTENT_GUARD_POLICY_ID)
  })

  it("a negative prompt on the row never trips it", async () => {
    const { error } = await insertJob(req, { user_id: "u1", input_data: { prompt: "MINORTERM at the park", negativePrompt: "ADULTTERM" } })
    expect(error).toBeNull()
    expect(insertMock).toHaveBeenCalledTimes(1)
  })

  it("covers internal creators too", async () => {
    const { error } = await insertInternalJob("orchestrator", { user_id: "u1", input_data: { prompt: "MINORTERM ADULTTERM" } })
    expect(error?.blocked?.policyId).toBe(CONTENT_GUARD_POLICY_ID)
  })

  it("a placeholder row with no content passes, as a workflow step's does", async () => {
    const { error } = await insertInternalJob("orchestrator", { user_id: "u1", input_data: { type: "generate-video", node_id: "n1" } })
    expect(error).toBeNull()
    expect(audit.recordJobPolicyDecision).not.toHaveBeenCalled()
  })
})
