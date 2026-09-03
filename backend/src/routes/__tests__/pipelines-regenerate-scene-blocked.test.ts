/**
 * F10 — POST /v1/pipelines/:id/stages/script/regenerate-scene answered
 * `500 db_error` on a request-gate block, AND leaked the policy's user message
 * into `detail` under a code that says "our database failed".
 *
 * This lane keeps its explicit branch rather than routing through
 * `sendInternalError`: a genuine insert failure must stay `db_error`, not flip
 * to `internal_error` for existing clients. Only the block is re-coded.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

const { mockReserveCreditsForJob } = vi.hoisted(() => ({ mockReserveCreditsForJob: vi.fn() }))

vi.mock("../../lib/config.js", () => ({
  config: { EDITION: "cloud" },
  hasCredits: () => true,
  hasAdmin: () => true,
  isCloud: () => true,
  isCommunity: () => false,
  isBusiness: () => false,
  hasOrganizations: () => true,
}))

vi.mock("../../ee/pipelines/pipeline-payer.js", () => ({
  getPipelineBillingContext: vi.fn(async () => ({ payer: "user", userId: "user-1" })),
}))

vi.mock("../../middleware/credit-guard.js", () => ({
  paygSurfaceSpendHook: () => async () => undefined,
  creditGuard: () => async () => undefined,
  reserveCreditsForJob: mockReserveCreditsForJob,
  resolveWebSurfaceFlag: async () => false,
}))

// Heavy pipeline deps pulled in by routes/pipelines.ts registration.
vi.mock("../../ee/pipelines/queue.js", () => ({
  enqueuePipelineRun: vi.fn(async () => undefined),
  pipelineOrchestrationQueue: { getJobs: vi.fn(async () => []) },
}))
vi.mock("../../ee/pipelines/credits.js", () => ({
  estimateUpfrontCredits: vi.fn(() => 30),
  resolveMaxCostCredits: vi.fn(() => 2000),
  reservePipelineCredits: vi.fn(async () => ({ ok: true, usageLogId: "ul-1" })),
  refundPipelineCredits: vi.fn(async () => undefined),
}))
vi.mock("../../ee/pipelines/engine.js", () => ({
  approveScriptStage: vi.fn(async () => ({ ok: true })),
  rejectScriptStage: vi.fn(async () => ({ ok: true })),
}))
vi.mock("../../ee/pipelines/entity-approval.js", () => ({
  approveEntity: vi.fn(async () => ({ ok: true })),
  rejectEntity: vi.fn(async () => ({ ok: true })),
}))
vi.mock("../../ee/pipelines/events.js", () => ({
  pipelineEvents: { publish: vi.fn(), subscribe: vi.fn(() => () => undefined) },
}))

const PLAN = { scenes: [{ scene_index: 0, summary: "s" }] }
vi.mock("../../lib/supabase.js", () => {
  function chainFor(table: string) {
    const rows: Record<string, unknown> = {
      pipelines: { id: "pipe-1", user_id: "user-1" },
      pipeline_stages: { id: "stage-1", status: "awaiting_approval", output: { plan: PLAN }, user_edits: null },
    }
    const c: Record<string, unknown> = {}
    for (const m of ["select", "eq", "is", "order", "limit", "update", "insert", "delete"]) {
      c[m] = vi.fn().mockReturnValue(c)
    }
    c.maybeSingle = vi.fn().mockResolvedValue({ data: rows[table] ?? null, error: null })
    c.single = vi.fn().mockResolvedValue({ data: rows[table] ?? null, error: null })
    return c
  }
  return { supabase: { from: vi.fn().mockImplementation(chainFor) } }
})

import { pipelinesRoutes } from "../pipelines.js"
import { clearJobPolicies, registerJobPolicy } from "../../lib/job-policy.js"

let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()
  mockReserveCreditsForJob.mockResolvedValue({ usageLogId: "ul-1" })
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    req.userId = "user-1"
  })
  await app.register(pipelinesRoutes)
  await app.ready()
})

afterEach(async () => {
  clearJobPolicies()
  await app.close()
})

describe("POST /v1/pipelines/:id/stages/script/regenerate-scene — request-gate block (F10)", () => {
  it("answers 422 job_blocked, never reserves credits, and does not leak the message under db_error", async () => {
    registerJobPolicy({
      id: "test-deny-all",
      checkRequest: () => ({ verdict: "block", reason: "test:denied", userMessage: "Not allowed here" }),
    })

    const res = await app.inject({
      method: "POST",
      url: "/v1/pipelines/pipe-1/stages/script/regenerate-scene",
      payload: { sceneIndex: 0, feedback: "tighter pacing" },
    })

    expect(res.statusCode).toBe(422)
    expect(res.json()).toEqual({ error: { code: "job_blocked", message: "Not allowed here" } })
    expect(mockReserveCreditsForJob).not.toHaveBeenCalled()
  })
})
