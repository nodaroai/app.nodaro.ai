/**
 * F10 — `meterSyncLlm` is the shared meter behind every synchronous LLM helper
 * route, so ONE wrong status code here mis-answers a whole family of lanes.
 *
 * On a request-gate block it sent `500 internal_error` (with the policy's own
 * text in `message`, which the sanitizer net then genericized anyway). The
 * documented answer is `422 job_blocked` carrying the policy's user message —
 * a 500 tells every SDK/CLI consumer "server bug, retry with backoff", so a
 * PERMANENT block became a retry loop that re-gated and re-audited each time.
 *
 * The `return null` is load-bearing: every caller bails on null (`if (!meter)
 * return`), which is what keeps the reply the meter just sent.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import type { FastifyReply, FastifyRequest } from "fastify"

const { fromMock, reserveCreditsForJobMock } = vi.hoisted(() => ({
  fromMock: vi.fn(),
  reserveCreditsForJobMock: vi.fn(),
}))

vi.mock("../supabase.js", () => ({ supabase: { from: fromMock } }))
vi.mock("../job-failure.js", () => ({ markJobFailed: vi.fn(async () => true) }))
vi.mock("../../middleware/credit-guard.js", () => ({ reserveCreditsForJob: reserveCreditsForJobMock }))

import { meterSyncLlm } from "../meter-sync-llm.js"
import { clearJobPolicies, registerJobPolicy } from "../job-policy.js"
import { __flushHttpErrorTelemetry } from "../http-errors.js"

function makeReply() {
  return {
    statusCode: 200 as number,
    body: undefined as unknown,
    sent: false,
    status(code: number) { this.statusCode = code; return this },
    send(payload: unknown) { this.body = payload; this.sent = true; return this },
  }
}

const req = {
  method: "POST",
  url: "/v1/prompt-helper",
  routeOptions: { url: "/v1/prompt-helper" },
  headers: {},
  body: {},
  userId: "u1",
  log: { error: vi.fn(), info: vi.fn() },
} as unknown as FastifyRequest

beforeEach(() => {
  vi.clearAllMocks()
  clearJobPolicies()
  // The gate refuses before the insert, so `jobs` is never reached; the audit
  // insert goes to job_policy_decisions.
  fromMock.mockReturnValue({
    insert: () => ({ select: () => ({ single: async () => ({ data: { id: "decision-1" }, error: null }) }) }),
  })
  reserveCreditsForJobMock.mockResolvedValue({ usageLogId: "u-log-1" })
})
afterEach(async () => {
  clearJobPolicies()
  // sendInternalError's app_reports write is deliberately un-awaited; settle it
  // here so it cannot land while a LATER test owns the supabase mock.
  await __flushHttpErrorTelemetry()
})

describe("meterSyncLlm — request-gate block (F10)", () => {
  it("answers 422 job_blocked with the policy's user message and returns null", async () => {
    registerJobPolicy({
      id: "test-deny-all",
      checkRequest: () => ({ verdict: "block", reason: "test:denied", userMessage: "Not allowed here" }),
    })
    const reply = makeReply()

    const meter = await meterSyncLlm(req, reply as unknown as FastifyReply, "prompt-helper", "prompt-helper")

    expect(meter).toBeNull()
    expect(reply.statusCode).toBe(422)
    expect(reply.body).toEqual({ error: { code: "job_blocked", message: "Not allowed here" } })
    // No reservation may be taken for a request that was refused.
    expect(reserveCreditsForJobMock).not.toHaveBeenCalled()
  })

  it("a genuine insert failure still answers 500 internal_error", async () => {
    fromMock.mockReturnValue({
      insert: () => ({ select: () => ({ single: async () => ({ data: null, error: { message: "connection reset" } }) }) }),
    })
    const reply = makeReply()

    const meter = await meterSyncLlm(req, reply as unknown as FastifyReply, "prompt-helper", "prompt-helper")

    expect(meter).toBeNull()
    expect(reply.statusCode).toBe(500)
    expect((reply.body as { error: { code: string } }).error.code).toBe("internal_error")
    // The raw DB message never reaches the client.
    expect(JSON.stringify(reply.body)).not.toContain("connection reset")
  })
})
