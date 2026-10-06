/**
 * POST /v1/workflows/:id/run with `continueFromExecutionId` (A6.2): the
 * synchronous half of the continuation's checks. The route refuses, before any
 * execution row exists, a continuation of an execution that is not the
 * caller's own completed run of this live workflow, or one that names no
 * nodes; otherwise the job carries the id and the orchestrator seeds from that
 * execution (its own tests).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

const mocks = vi.hoisted(() => ({
  queueAdd: vi.fn().mockResolvedValue({ id: "orch-job-1" }),
  loadSource: vi.fn(),
  merge: vi.fn(),
  inserts: [] as Array<Record<string, unknown>>,
  authKind: "api_token",
}))

vi.mock("@/lib/supabase.js", () => ({ supabase: { from: vi.fn() } }))
vi.mock("@/lib/config.js", () => ({
  config: { EDITION: "cloud", SUPABASE_URL: "https://test.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "test" },
  isCloud: () => true,
  hasCredits: () => true,
  isCommunity: () => false,
  isBusiness: () => false,
  hasAdmin: () => true,
  hasOrganizations: () => false,
}))
vi.mock("@/lib/preview-stop-rule-flag.js", () => ({ previewStopRuleEnabled: () => true }))
vi.mock("@/lib/admin-check.js", () => ({ warmAdminCache: vi.fn(), checkIsAdmin: vi.fn().mockResolvedValue(false) }))
vi.mock("@/lib/orchestration-queue.js", () => ({ orchestrationQueue: { add: mocks.queueAdd } }))
vi.mock("@/lib/billing-context.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/billing-context.js")>()
  return { ...actual, resolveBillingContext: vi.fn(async (input: { userId: string }) => ({ payer: "user" as const, userId: input.userId })) }
})
vi.mock("@/lib/queue.js", () => ({
  videoQueue: { add: vi.fn(), getJob: vi.fn(), remove: vi.fn() },
  renderQueue: { add: vi.fn() },
  redis: {},
  tryRemoveFromQueue: vi.fn(),
}))
vi.mock("@/lib/sse.js", () => ({ createSSEStream: vi.fn() }))
vi.mock("@/lib/execution-events.js", () => ({ executionEvents: { on: vi.fn(), off: vi.fn(), emit: vi.fn() } }))
vi.mock("@/ee/billing/credits.js", () => ({ CreditsService: { refundCredits: vi.fn() } }))
vi.mock("@/ee/routes/credits.js", () => ({ invalidateBalanceCache: vi.fn() }))
vi.mock("@/lib/cancel-job.js", () => ({ cancelOwnedJob: vi.fn() }))
// The loader reads the database; the checks themselves are the real ones. The
// merge is the real one too, watched: the route must judge the map the
// orchestrator applies, through the orchestrator's own function.
vi.mock("@/services/workflow-engine/run-continuation.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/workflow-engine/run-continuation.js")>()
  mocks.merge.mockImplementation(actual.continuationInputOverrides)
  return { ...actual, loadContinuationSource: mocks.loadSource, continuationInputOverrides: mocks.merge }
})

import { workflowExecutionRoutes } from "../workflow-execution.js"
import { supabase } from "../../lib/supabase.js"

const USER = "00000000-0000-4000-8000-000000000001"
const WORKFLOW = "00000000-0000-4000-8000-000000000020"
const PRIOR = "00000000-0000-4000-8000-000000000061"
const NEW_EXEC = "00000000-0000-4000-8000-000000000062"

const graph = {
  nodes: [
    { id: "plan", type: "edit-plan", data: {} },
    { id: "cut", type: "apply-edl", data: { quality: "proxy" } },
    { id: "cap", type: "add-captions", data: {} },
    { id: "hook", type: "webhook-output", data: { url: "https://mine.example/hook" } },
  ],
  edges: [
    { id: "e1", source: "plan", target: "cut" },
    { id: "e2", source: "cut", target: "cap" },
  ],
}

function mockTables() {
  vi.mocked(supabase.from).mockImplementation((table: string) => {
    if (table === "workflows") {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: { id: WORKFLOW, user_id: USER, workspace_id: null, visibility: "private", ...graph },
              error: null,
            }),
          }),
        }),
      } as never
    }
    if (table === "workflow_executions") {
      return {
        select: () => ({ eq: () => ({ eq: () => ({ in: () => ({ limit: async () => ({ data: [], error: null }) }) }) }) }),
        insert: (row: Record<string, unknown>) => {
          mocks.inserts.push(row)
          return { select: () => ({ single: async () => ({ data: { id: NEW_EXEC }, error: null }) }) }
        },
      } as never
    }
    throw new Error(`unexpected table ${table}`)
  })
}

const source = (over: Record<string, unknown> = {}) => ({
  id: PRIOR,
  userId: USER,
  workflowId: WORKFLOW,
  status: "completed",
  appVersionId: null,
  ...over,
})

let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()
  mocks.inserts.length = 0
  mocks.authKind = "api_token"
  mockTables()
  mocks.loadSource.mockResolvedValue(source())
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    req.userId = USER
    ;(req as { authKind?: string }).authKind = mocks.authKind
  })
  await app.register(async (instance) => {
    await workflowExecutionRoutes(instance)
  })
  await app.ready()
})

afterEach(async () => {
  await app.close()
})

const run = (payload: Record<string, unknown>) =>
  app.inject({ method: "POST", url: `/v1/workflows/${WORKFLOW}/run`, payload })

const renderFinal = { nodeIds: ["cut", "cap"], inputOverrides: { cut: { quality: "final" } } }

describe("POST /v1/workflows/:id/run — continueFromExecutionId", () => {
  it("enqueues the continuation: the job carries the execution it continues", async () => {
    const res = await run({ ...renderFinal, continueFromExecutionId: PRIOR })
    expect(res.statusCode).toBe(202)
    expect(mocks.loadSource).toHaveBeenCalledWith(PRIOR, expect.objectContaining({ withStates: true, isRenderNode: expect.any(Function) }))
    const job = mocks.queueAdd.mock.calls[0]![1] as Record<string, unknown>
    expect(job.continueFromExecutionId).toBe(PRIOR)
    expect(job.nodeIds).toEqual(["cut", "cap"])
  })

  it("a run without the field is not a continuation", async () => {
    const res = await run(renderFinal)
    expect(res.statusCode).toBe(202)
    expect(mocks.loadSource).not.toHaveBeenCalled()
    expect((mocks.queueAdd.mock.calls[0]![1] as Record<string, unknown>).continueFromExecutionId).toBeUndefined()
  })

  it("refuses an id that is not an execution id", async () => {
    const res = await run({ ...renderFinal, continueFromExecutionId: "nope" })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
    expect(mocks.queueAdd).not.toHaveBeenCalled()
  })

  const cases: Array<[string, () => void, Record<string, unknown>, number, string]> = [
    ["no nodes named", () => {}, { nodeIds: undefined }, 400, "continuation_subset_required"],
    ["no such execution", () => mocks.loadSource.mockResolvedValue(null), {}, 404, "continuation_not_found"],
    ["someone else's execution", () => mocks.loadSource.mockResolvedValue(source({ userId: "other" })), {}, 404, "continuation_not_found"],
    ["another workflow's execution", () => mocks.loadSource.mockResolvedValue(source({ workflowId: "wf-other" })), {}, 400, "continuation_workflow_mismatch"],
    ["an app run's execution", () => mocks.loadSource.mockResolvedValue(source({ appVersionId: "app-1" })), {}, 400, "continuation_version_mismatch"],
    ["a run still going", () => mocks.loadSource.mockResolvedValue(source({ status: "running" })), {}, 409, "continuation_not_completed"],
  ]
  it.each(cases)("refuses %s, before any execution row exists", async (_name, setup, payload, status, code) => {
    setup()
    const res = await run({ ...renderFinal, continueFromExecutionId: PRIOR, ...payload })
    expect(res.statusCode).toBe(status)
    expect(res.json().error.code).toBe(code)
    expect(typeof res.json().error.message).toBe("string")
    expect(mocks.inserts).toEqual([])
    expect(mocks.queueAdd).not.toHaveBeenCalled()
  })

  // R3-1: the orchestrator applies the earlier execution's PINNED overrides
  // under the sent ones; the route's pre-checks must judge that same map, or
  // they refuse a continuation the orchestrator and the docs allow.
  describe("the route's pre-checks see the earlier run's pin under the sent overrides", () => {
    it("R3-1: a pinned Final quality lets an API continuation through without resending it", async () => {
      mocks.loadSource.mockResolvedValue(source({ inputOverrides: { cut: { quality: "final" } } }))
      const res = await run({ continueFromExecutionId: PRIOR, nodeIds: ["cut", "cap"], inputOverrides: { cap: { fontSize: 48 } } })
      expect(res.statusCode).toBe(202)
      // Through the orchestrator's merge, with the same source and the sent map.
      expect(mocks.merge).toHaveBeenCalledWith(
        expect.objectContaining({ inputOverrides: { cut: { quality: "final" } } }),
        { cap: { fontSize: 48 } },
      )
      // The job still carries only the sent overrides: the orchestrator does the merge.
      const job = mocks.queueAdd.mock.calls[0]![1] as Record<string, unknown>
      expect(job.inputOverrides).toEqual({ cap: { fontSize: 48 } })
    })

    it("a sent override wins over the pin: sending Preview for the render is still refused", async () => {
      mocks.loadSource.mockResolvedValue(source({ inputOverrides: { cut: { quality: "final" } } }))
      const res = await run({ continueFromExecutionId: PRIOR, nodeIds: ["cut", "cap"], inputOverrides: { cut: { quality: "proxy" } } })
      expect(res.statusCode).toBe(400)
      expect(res.json().error.code).toBe("preview_review_required")
      expect(mocks.inserts).toEqual([])
    })

    it("a pinned override that re-points an outbound node is refused here, before any row exists", async () => {
      mocks.loadSource.mockResolvedValue(source({ inputOverrides: { hook: { url: "https://elsewhere.example/collect" } } }))
      const res = await run({ ...renderFinal, continueFromExecutionId: PRIOR })
      expect(res.statusCode).toBe(400)
      expect(res.json().error.code).toBe("locked_field")
      expect(mocks.inserts).toEqual([])
      expect(mocks.queueAdd).not.toHaveBeenCalled()
    })

    // Round 4: the pin alone, and the field-by-field merge, exactly as the
    // orchestrator applies them (`continuationInputOverrides`).
    it("the pin alone lifts the render: a continuation that sends no overrides at all is let through", async () => {
      mocks.loadSource.mockResolvedValue(source({ inputOverrides: { cut: { quality: "final" } } }))
      const res = await run({ continueFromExecutionId: PRIOR, nodeIds: ["cut", "cap"] })
      expect(res.statusCode).toBe(202)
      const job = mocks.queueAdd.mock.calls[0]![1] as Record<string, unknown>
      expect(job.continueFromExecutionId).toBe(PRIOR)
      expect(job.inputOverrides ?? {}).toEqual({})
    })

    it("field by field: a sent override of another field of the render keeps the pinned Final", async () => {
      mocks.loadSource.mockResolvedValue(source({ inputOverrides: { cut: { quality: "final" } } }))
      const res = await run({ continueFromExecutionId: PRIOR, nodeIds: ["cut", "cap"], inputOverrides: { cut: { label: "Cut" } } })
      expect(res.statusCode).toBe(202)
      const job = mocks.queueAdd.mock.calls[0]![1] as Record<string, unknown>
      expect(job.inputOverrides).toEqual({ cut: { label: "Cut" } })
    })

    // R4-1: a render the continuation does NOT run is read by its seed — what
    // the earlier execution rendered — exactly as the orchestrator reads it
    // (`continuationRenderStamps` over `continuationSeeds`), never as unstamped.
    it("R4-1: a seeded Preview render the run does not execute is refused here, before any row exists", async () => {
      mocks.loadSource.mockResolvedValue(source({
        inputOverrides: null,
        nodeStates: { cut: { status: "completed", nodeType: "apply-edl", output: { video: "https://r2.example/cut.mp4", quality: "proxy" } } },
      }))
      const res = await run({ continueFromExecutionId: PRIOR, nodeIds: ["cap"] })
      expect(res.statusCode).toBe(400)
      expect(res.json().error.code).toBe("preview_review_required")
      expect(mocks.inserts).toEqual([])
      expect(mocks.queueAdd).not.toHaveBeenCalled()
      // The states are read through the render registry, as the orchestrator reads them.
      const opts = mocks.loadSource.mock.calls[0]![1] as { withStates: boolean; isRenderNode: (id: string) => boolean }
      expect(opts.withStates).toBe(true)
      expect(opts.isRenderNode("cut")).toBe(true)
      expect(opts.isRenderNode("cap")).toBe(false)
    })

    it("R4-1: a seeded Final render the run does not execute is let through", async () => {
      mocks.loadSource.mockResolvedValue(source({
        inputOverrides: null,
        nodeStates: { cut: { status: "completed", nodeType: "apply-edl", output: { video: "https://r2.example/cut.mp4", quality: "final" } } },
      }))
      const res = await run({ continueFromExecutionId: PRIOR, nodeIds: ["cap"] })
      expect(res.statusCode).toBe(202)
      expect((mocks.queueAdd.mock.calls[0]![1] as Record<string, unknown>).continueFromExecutionId).toBe(PRIOR)
    })

    it("R4-1: an editor run (a reviewer present) asks no Preview review, so it reads no states", async () => {
      mocks.authKind = "jwt"
      mocks.loadSource.mockResolvedValue(source({ inputOverrides: null }))
      const res = await run({ continueFromExecutionId: PRIOR, nodeIds: ["cap"], reviewer: "editor" })
      expect(res.statusCode).toBe(202)
      expect(mocks.loadSource).toHaveBeenCalledWith(PRIOR, { withStates: false, withPin: true })
    })

    it("an execution with no pin: only the sent overrides are judged, so its Preview render is refused", async () => {
      mocks.loadSource.mockResolvedValue(source({ inputOverrides: null }))
      const res = await run({ continueFromExecutionId: PRIOR, nodeIds: ["cut", "cap"] })
      expect(res.statusCode).toBe(400)
      expect(res.json().error.code).toBe("preview_review_required")
      expect(mocks.inserts).toEqual([])
    })
  })
})
