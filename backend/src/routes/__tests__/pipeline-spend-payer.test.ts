// P14 — a spend ATTRIBUTED TO A PIPELINE bills the pipeline's durable payer
// stamp, never the request's independently-decided context (the UI's
// active-workspace header is a global selection, not the pipeline's home; an
// SDK caller sends no header at all). Pins the two in-request pipeline spend
// routes the sub-stage-7 review caught billing the wrong payer:
//   - POST /v1/pipelines/:id/entities/:sceneId/helpers/<name>
//   - POST /v1/pipelines/:id/stages/script/regenerate-scene
import { describe, it, expect, vi, beforeEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

const {
  mockGetPipelinePayer,
  mockReserveHelperCredits,
  mockReserveCreditsForJob,
  guardSawContext,
  reserveSawContext,
} = vi.hoisted(() => ({
  mockGetPipelinePayer: vi.fn(),
  mockReserveHelperCredits: vi.fn(),
  mockReserveCreditsForJob: vi.fn(),
  guardSawContext: { value: undefined as unknown },
  reserveSawContext: { value: undefined as unknown },
}))

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
  getPipelineBillingContext: mockGetPipelinePayer,
}))

vi.mock("../../ee/pipelines/scene-helper-credits.js", () => ({
  reserveHelperCredits: mockReserveHelperCredits,
  refundHelperCredits: vi.fn(),
}))

vi.mock("../../middleware/credit-guard.js", () => ({
  paygSurfaceSpendHook: () => async () => undefined,
  // The guard preflight runs AFTER the route's payer override — capture what
  // it sees so the ordering itself is pinned.
  creditGuard: () => async (req: { billingContext?: unknown }) => {
    guardSawContext.value = req.billingContext
  },
  reserveCreditsForJob: mockReserveCreditsForJob,
  resolveWebSurfaceFlag: async () => false,
}))

vi.mock("../../lib/insert-job.js", () => ({
  insertJob: vi.fn(async () => ({ data: { id: "job-1" }, error: null })),
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

// Supabase world: one owned pipeline, a script stage awaiting approval with a
// one-scene plan, and one scene entity carrying scene_node_data.
const PLAN = { scenes: [{ scene_index: 0, summary: "s" }] }
vi.mock("../../lib/supabase.js", () => {
  function chainFor(table: string) {
    const rows: Record<string, unknown> = {
      pipelines: { id: "pipe-1", user_id: "user-1" },
      pipeline_stages: {
        id: "stage-1",
        status: "awaiting_approval",
        output: { plan: PLAN },
        user_edits: null,
      },
      pipeline_entities: {
        id: "scene-ent-1",
        stage_id: "stage-1",
        entity_type: "scene",
        metadata: { scene_node_data: { sceneIndex: 0, prompt: "p", shots: [{ id: "shot-1", prompt: "sp" }] } },
      },
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
import { sceneHelpersRoutes } from "../scene-helpers.js"
import type { BillingContext } from "../../lib/billing-context.js"

/** The pipeline's durable stamp — what every pipeline spend must bill. */
const STAMP: BillingContext = {
  payer: "workspace",
  userId: "user-1",
  workspaceId: "ws-home",
  orgId: "org-home",
  memberCap: null,
  entitlements: {
    watermark: false,
    dailyCapCredits: null,
    parallelism: 12,
    tierForGates: "business",
    freeTierBlocklist: false,
    webFreeMode: false,
    appCreditsAllowance: false,
  },
}

/** What the REQUEST resolved to (a different, globally-selected workspace). */
const REQUEST_CTX: BillingContext = { ...STAMP, workspaceId: "ws-other", orgId: "org-other" }

let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()
  guardSawContext.value = undefined
  mockGetPipelinePayer.mockResolvedValue(STAMP)
  // Short-circuit right after the assertion point — the refusal path ends the
  // handler before the heavy LLM/regeneration world is reached.
  mockReserveHelperCredits.mockResolvedValue({ ok: false, reason: "insufficient_credits" })
  mockReserveCreditsForJob.mockImplementation(
    async (req: { billingContext?: unknown }, reply: { status: (c: number) => { send: (b: unknown) => void } }) => {
      reserveSawContext.value = req.billingContext
      reply.status(402).send({ error: { code: "insufficient_credits" } })
      return undefined
    },
  )

  app = Fastify()
  app.addHook("preHandler", async (req) => {
    req.userId = "user-1"
    // The app-level billing hook's answer — deliberately NOT the stamp.
    req.billingContext = REQUEST_CTX
  })
  await app.register(pipelinesRoutes)
  await app.register(sceneHelpersRoutes)
  await app.ready()
})

describe("pipeline-attributed spends bill the pipeline's stamp (P14)", () => {
  it("scene helper: reserveHelperCredits gets the STAMP, not the request's context", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/pipelines/pipe-1/entities/scene-ent-1/helpers/audit_prompt",
      payload: {},
    })
    expect(res.statusCode).toBe(402)
    expect(mockGetPipelinePayer).toHaveBeenCalledWith(expect.anything(), "pipe-1", "user-1")
    const args = mockReserveHelperCredits.mock.calls[0]?.[0] as { billingContext?: BillingContext }
    expect(args.billingContext).toBe(STAMP)
    expect(args.billingContext).not.toEqual(REQUEST_CTX)
  })

  it("regenerate-scene: the override runs BEFORE the guard — preflight AND reserve see the STAMP", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/pipelines/pipe-1/stages/script/regenerate-scene",
      payload: { sceneIndex: 0, feedback: "tighter pacing" },
    })
    expect(res.statusCode).toBe(402)
    expect(mockGetPipelinePayer).toHaveBeenCalledWith(expect.anything(), "pipe-1", "user-1")
    expect(guardSawContext.value).toBe(STAMP)
    expect(reserveSawContext.value).toBe(STAMP)
  })
})
