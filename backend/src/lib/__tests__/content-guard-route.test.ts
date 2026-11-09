/**
 * A prompt the content guard refuses, thrown from the prompt funnel in a route
 * handler, answers the platform's 422 `job_blocked` shape (root error handler,
 * lib/http-errors.ts), and the refusal is recorded against the signed-in user
 * through the request scope (lib/request-user-scope.ts), including on a POST
 * with a JSON body, the case the scope has to survive body parsing for.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

const audit = vi.hoisted(() => ({
  recordJobPolicyDecision: vi.fn(async (_input: Record<string, unknown>) => "decision-1"),
  hashGateSubject: vi.fn((_subject: unknown) => "hash-1"),
}))
vi.mock("../job-policy-audit.js", () => audit)

import { registerRefusalErrorHandler } from "../http-errors.js"
import { registerRequestUserScope, currentRequestUserId } from "../request-user-scope.js"
import { applyPromptPolicies } from "../prompt-policy.js"
import { __flushContentGuardAuditForTests, clearContentGuard, CONTENT_GUARD_MESSAGE, CONTENT_GUARD_POLICY_ID, registerContentGuard } from "../content-guard.js"

let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()
  registerContentGuard({
    proveReady: () => true,
    id: "placeholder-guard",
    check: (subject) => (subject.texts.join(" ").includes("ADULTTERM") && subject.texts.join(" ").includes("MINORTERM") ? { refused: true, reason: "placeholder-combination" } : { refused: false }),
  })
  app = Fastify()
  registerRefusalErrorHandler(app)
  registerRequestUserScope(app)
  app.addHook("onRequest", async (req) => {
    req.userId = "user-7"
  })
  app.post("/v1/gen", async (req) => {
    const out = applyPromptPolicies({ prompt: (req.body as { prompt: string }).prompt, negativePrompt: "", kind: "image" })
    return { prompt: out.prompt, seenUser: currentRequestUserId() }
  })
  await app.ready()
})

afterEach(async () => {
  await __flushContentGuardAuditForTests()
  clearContentGuard()
  await app.close()
})

describe("a refused prompt in a route", () => {
  it("answers 422 job_blocked with the platform's sentence", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/gen", payload: { prompt: "MINORTERM ADULTTERM" } })
    expect(res.statusCode).toBe(422)
    expect(res.json()).toEqual({ error: { code: "job_blocked", message: CONTENT_GUARD_MESSAGE } })
    expect(res.body).not.toMatch(/MINORTERM|ADULTTERM/)
    await __flushContentGuardAuditForTests()
    expect(audit.recordJobPolicyDecision.mock.calls[0]![0]).toMatchObject({ policyId: CONTENT_GUARD_POLICY_ID, verdict: "block", userId: "user-7" })
  })

  it("a prompt it clears goes through, and the handler can read the request's user", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/gen", payload: { prompt: "a cat" } })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ prompt: "a cat", seenUser: "user-7" })
  })

  it("no scope at all (a worker, a test) reads as no user", () => {
    expect(currentRequestUserId()).toBeNull()
  })
})
