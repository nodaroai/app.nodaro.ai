/**
 * F10 — POST /v1/social/publish answered 500 `internal_error` on a request-gate
 * block. `docs/api-integration.md` promises 422 `job_blocked` with the policy's
 * message and tells clients a 500 means "server bug — retry with backoff", so a
 * permanent block was retried in a loop, each retry writing another
 * `job_policy_decisions` row, and the SDK's `JobBlockedError` never fired.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

vi.mock("../../lib/supabase.js", () => ({
  supabase: {
    from: () => ({
      insert: () => ({ select: () => ({ single: async () => ({ data: { id: "job-1" }, error: null }) }) }),
      update: () => ({ eq: async () => ({ data: null, error: null }) }),
    }),
  },
}))

vi.mock("../../middleware/credit-guard.js", () => ({
  creditGuard: () => async () => {},
  reserveCreditsForJob: vi.fn(async () => ({ usageLogId: "usage-1" })),
}))

const { executePublish } = vi.hoisted(() => ({ executePublish: vi.fn() }))
vi.mock("../../services/social/execute-publish.js", () => ({
  executePublish,
  NotConnectedError: class NotConnectedError extends Error {},
  UnknownOutcomeError: class UnknownOutcomeError extends Error {},
}))

vi.mock("../../ee/billing/credits.js", () => ({
  CreditsService: { commitCredits: vi.fn(), refundCredits: vi.fn() },
}))

import { socialPublishRoutes } from "../social-publish.js"
import { clearJobPolicies, registerJobPolicy } from "../../lib/job-policy.js"

let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    req.userId = "00000000-0000-4000-8000-000000000001"
  })
  await app.register(socialPublishRoutes)
  await app.ready()
})

afterEach(async () => {
  clearJobPolicies()
  await app.close()
})

describe("POST /v1/social/publish — request-gate block (F10)", () => {
  it("answers 422 job_blocked with the policy's user message, not 500", async () => {
    registerJobPolicy({
      id: "test-deny-all",
      checkRequest: () => ({ verdict: "block", reason: "test:denied", userMessage: "Not allowed here" }),
    })

    const res = await app.inject({
      method: "POST",
      url: "/v1/social/publish",
      payload: { platform: "telegram", action: "post-text", caption: "hi", chatId: "123" },
    })

    expect(res.statusCode).toBe(422)
    expect(res.json()).toEqual({ error: { code: "job_blocked", message: "Not allowed here" } })
    // Nothing was published — the gate refused before the row existed.
    expect(executePublish).not.toHaveBeenCalled()
  })
})
