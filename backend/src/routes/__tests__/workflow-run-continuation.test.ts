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
  /** The real continuationSeeds, watched: the seeds the route judges a run by. */
  seeds: vi.fn(),
  inserts: [] as Array<Record<string, unknown>>,
  authKind: "api_token",
  // The caller's other executions of this workflow (the lineage's later
  // generations), filtered by the query the route builds, and every call it made.
  executions: [] as Array<Record<string, unknown>>,
  /** A graph in place of the default one, for one test. */
  graphOverride: null as { nodes: unknown[]; edges: unknown[] } | null,
  lineageCalls: [] as Array<[string, ...unknown[]]>,
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
// The leaf the consumers read from forwards to the mock above.
vi.mock("@/ee/billing/balance-cache.js", async () => ({ invalidateBalanceCache: (await import("@/ee/routes/credits.js")).invalidateBalanceCache }))
vi.mock("@/lib/cancel-job.js", () => ({ cancelOwnedJob: vi.fn() }))
// The loader reads the database; the checks themselves are the real ones. The
// merge is the real one too, watched: the route must judge the map the
// orchestrator applies, through the orchestrator's own function.
vi.mock("@/services/workflow-engine/run-continuation.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/workflow-engine/run-continuation.js")>()
  mocks.merge.mockImplementation(actual.continuationInputOverrides)
  mocks.seeds.mockImplementation(actual.continuationSeeds)
  return { ...actual, loadContinuationSource: mocks.loadSource, continuationInputOverrides: mocks.merge, continuationSeeds: mocks.seeds }
})

// A continuation of named nodes checks its payer's balance first (render-final-run-set-parity.test.ts); here it is covered.
vi.mock("@/lib/render-final-run.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/render-final-run.js")>()
  return { ...actual, renderFinalCredits: vi.fn(async () => null) }
})

import { workflowExecutionRoutes } from "../workflow-execution.js"
import { supabase } from "../../lib/supabase.js"
import { renderFinalCredits } from "../../lib/render-final-run.js"

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
              data: { id: WORKFLOW, user_id: USER, workspace_id: null, visibility: "private", ...(mocks.graphOverride ?? graph) },
              error: null,
            }),
          }),
        }),
      } as never
    }
    if (table === "workflow_executions") {
      // Two reads over `mocks.executions`, each filtered as PostgREST would:
      // the active-run check (awaited at `limit`) and the continue-from-failed
      // lineage (`limit(1).maybeSingle()`, whose calls are recorded).
      const calls: Array<[string, ...unknown[]]> = []
      const preds: Array<(row: Record<string, unknown>) => boolean> = []
      let descending = false
      const field = (row: Record<string, unknown>, column: string): unknown => {
        const path = column.match(/^trigger_data->(\w+)->>(\w+)$/)
        if (!path) return row[column]
        const stamp = (row.trigger_data as Record<string, Record<string, unknown>> | undefined)?.[path[1]!]
        const value = stamp?.[path[2]!]
        // `->>` reads the JSON value as text.
        return value === undefined || value === null ? value : String(value)
      }
      const q: Record<string, unknown> = {}
      q.select = (...a: unknown[]) => (calls.push(["select", ...a]), q)
      q.eq = (column: string, value: unknown) => (calls.push(["eq", column, value]), preds.push((r) => field(r, column) === value), q)
      q.in = (column: string, values: unknown[]) => (calls.push(["in", column, values]), preds.push((r) => values.includes(field(r, column))), q)
      q.not = (column: string, op: string, value: unknown) => {
        calls.push(["not", column, op, value])
        if (op === "is" && value === null) preds.push((r) => field(r, column) !== null && field(r, column) !== undefined)
        return q
      }
      q.order = (column: string, opts: { ascending: boolean }) => (calls.push(["order", column, opts]), (descending = !opts.ascending), q)
      const rows = () => {
        const out = mocks.executions.filter((r) => preds.every((p) => p(r)))
        return descending ? [...out].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))) : out
      }
      // The idempotency lookup before the credit check: `(user_id, idempotency_key)`, one row.
      q.maybeSingle = async () => ({ data: rows()[0] ?? null, error: null })
      q.limit = (n: number) => ({
        then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: rows().slice(0, n), error: null }).then(resolve),
        maybeSingle: async () => {
          mocks.lineageCalls.push(...calls)
          return { data: rows()[0] ?? null, error: null }
        },
      })
      return {
        select: () => q,
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
  mocks.executions.length = 0
  mocks.lineageCalls.length = 0
  mocks.graphOverride = null
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

const run = (payload: Record<string, unknown>, headers: Record<string, string> = {}) =>
  app.inject({ method: "POST", url: `/v1/workflows/${WORKFLOW}/run`, payload, headers })

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

describe("POST /v1/workflows/:id/run — continueMode \"from-failed\" (a saved workflow's failed run)", () => {
  // The failed run: the plan and the render (at Final) completed, the captions failed, the hook never ran.
  const failed = (over: Record<string, unknown> = {}) =>
    source({
      status: "failed",
      startedAt: "2026-10-17T10:00:00.000Z",
      continueFromFailed: null,
      inputOverrides: null,
      nodeStates: {
        plan: { status: "completed", nodeType: "edit-plan", output: { json: { clips: [] } } },
        cut: { status: "completed", nodeType: "apply-edl", output: { video: "https://r2.example/cut.mp4", quality: "final" } },
        cap: { status: "failed", nodeType: "add-captions", error: "boom" },
      },
      ...over,
    })
  const fromFailed = (payload: Record<string, unknown> = {}, headers: Record<string, string> = {}) =>
    run({ continueFromExecutionId: PRIOR, continueMode: "from-failed", ...payload }, headers)

  beforeEach(() => {
    mocks.loadSource.mockResolvedValue(failed())
  })

  it("names no nodes: considers every node and runs only what the failed run did not complete", async () => {
    const res = await fromFailed()
    expect(res.statusCode).toBe(202)
    const job = mocks.queueAdd.mock.calls[0]![1] as Record<string, unknown>
    expect(job.continueFromExecutionId).toBe(PRIOR)
    expect(job.continueMode).toBe("from-failed")
    expect(job.nodeIds).toEqual(["cap", "hook"])
    // Seeded from the run asked for: no other execution named.
    expect(job.seedFromExecutionId).toBeUndefined()
    expect(res.json().continuedFrom).toBe(PRIOR)
    // The new row names the run it continues, its lineage (the source is the
    // first run), the run it was seeded from, and that it runs all that one left.
    expect(mocks.inserts[0]!.trigger_data).toEqual({ continueFromFailed: { from: PRIOR, root: PRIOR, seededFrom: PRIOR, all: true } })
    // The lineage is asked once, by the source's root, of the caller's own
    // runs of this workflow: the newest one that started and ended failed or completed.
    expect(mocks.lineageCalls).toEqual([
      ["eq", "user_id", USER],
      ["eq", "workflow_id", WORKFLOW],
      ["eq", "trigger_data->continueFromFailed->>root", PRIOR],
      // Only among the runs a stamp-writing lane started (lib/server-started-runs.ts).
      ["in", "trigger_type", ["manual", "mcp", "app_run"]],
      ["in", "status", ["failed", "completed"]],
      ["not", "started_at", "is", null],
      ["order", "created_at", { ascending: false }],
    ])
  })

  it("names nodes: narrows them to what the failed run did not complete", async () => {
    const res = await fromFailed({ nodeIds: ["cut", "cap"] })
    expect(res.statusCode).toBe(202)
    expect((mocks.queueAdd.mock.calls[0]![1] as Record<string, unknown>).nodeIds).toEqual(["cap"])
    // The hook is left: this run does not take on all the source left.
    expect(mocks.inserts[0]!.trigger_data).toEqual({ continueFromFailed: { from: PRIOR, root: PRIOR, seededFrom: PRIOR, all: false } })
  })

  it("names every node: the run takes on all the source left", async () => {
    const res = await fromFailed({ nodeIds: ["plan", "cut", "cap", "hook"] })
    expect(res.statusCode).toBe(202)
    expect(mocks.inserts[0]!.trigger_data).toEqual({ continueFromFailed: { from: PRIOR, root: PRIOR, seededFrom: PRIOR, all: true } })
  })

  it("names a narrow list whose closure is all the source left: that is all too", async () => {
    // Only the captions are left of the work, the hook having completed.
    mocks.loadSource.mockResolvedValue(
      failed({
        nodeStates: {
          plan: { status: "completed", nodeType: "edit-plan", output: { json: {} } },
          cut: { status: "failed", error: "boom" },
          hook: { status: "completed", output: {} },
        },
      }),
    )
    const res = await fromFailed({ nodeIds: ["cap"], inputOverrides: { cut: { quality: "final" } } })
    expect(res.statusCode).toBe(202)
    expect((mocks.queueAdd.mock.calls[0]![1] as Record<string, unknown>).nodeIds).toEqual(["cut", "cap"])
    expect(mocks.inserts[0]!.trigger_data).toEqual({ continueFromFailed: { from: PRIOR, root: PRIOR, seededFrom: PRIOR, all: true } })
  })

  it("an empty nodeIds reads as none: every node is considered", async () => {
    const res = await fromFailed({ nodeIds: [] })
    expect(res.statusCode).toBe(202)
    expect((mocks.queueAdd.mock.calls[0]![1] as Record<string, unknown>).nodeIds).toEqual(["cap", "hook"])
  })

  it("drops a named id that is no node of the workflow", async () => {
    const res = await fromFailed({ nodeIds: ["cap", "typo"] })
    expect(res.statusCode).toBe(202)
    expect((mocks.queueAdd.mock.calls[0]![1] as Record<string, unknown>).nodeIds).toEqual(["cap"])
  })

  it("refuses nodeIds none of which is a node of the workflow, before any row exists", async () => {
    const res = await fromFailed({ nodeIds: ["typo"] })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
    expect(mocks.inserts).toEqual([])
  })

  it("closes a narrow nodeIds over the incomplete nodes it needs upstream", async () => {
    // The render never completed: captions alone would run on nothing.
    mocks.loadSource.mockResolvedValue(
      failed({ nodeStates: { plan: { status: "completed", nodeType: "edit-plan", output: { json: {} } }, cut: { status: "failed", error: "boom" } } }),
    )
    const res = await fromFailed({ nodeIds: ["cap"], inputOverrides: { cut: { quality: "final" } } })
    expect(res.statusCode).toBe(202)
    expect((mocks.queueAdd.mock.calls[0]![1] as Record<string, unknown>).nodeIds).toEqual(["cut", "cap"])
  })

  it("counts only work the engine dispatches: a remainder of sources, pickers and containers is nothing left", async () => {
    mocks.graphOverride = {
      nodes: [
        { id: "rec", type: "upload-video", data: {} },
        { id: "mood", type: "mood", data: {} },
        { id: "grp", type: "group", data: {} },
        { id: "gen", type: "generate-image", data: {} },
      ],
      edges: [],
    }
    mocks.loadSource.mockResolvedValue(failed({ nodeStates: { gen: { status: "completed", output: { imageUrl: "https://r2.example/a.png" } } } }))
    const res = await fromFailed()
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe("continuation_subset_required")
    expect(mocks.inserts).toEqual([])
  })

  it("reads the states even when a reviewer is present (they decide what runs)", async () => {
    mocks.authKind = "jwt"
    const res = await fromFailed({ reviewer: "editor" })
    expect(res.statusCode).toBe(202)
    expect(mocks.loadSource).toHaveBeenCalledWith(PRIOR, expect.objectContaining({ withStates: true }))
    expect((mocks.queueAdd.mock.calls[0]![1] as Record<string, unknown>).nodeIds).toEqual(["cap", "hook"])
  })

  // A run that stops at a Preview review completes with its Final render (and
  // all after it) not run: it is never stamped `all`, so it never supersedes
  // its source as "done" (decided 2026-10-18).
  describe("is checked against its payer before it starts, priced on what is left", () => {
    const short = { estimatedCredits: 90, sufficient: false, available: 40, message: "Insufficient credits: 90 needed, 40 available" }

    it("a resume whose remaining steps the payer cannot cover: 402, and no execution is created", async () => {
      vi.mocked(renderFinalCredits).mockResolvedValueOnce(short)
      const res = await fromFailed()
      expect(res.statusCode).toBe(402)
      expect(res.json().error).toEqual({ code: "insufficient_credits", message: short.message, required: 90, available: 40 })
      expect(mocks.inserts).toHaveLength(0)
      expect(mocks.queueAdd).not.toHaveBeenCalled()
    })

    it("priced on the nodes it runs — what the failed run did not complete — with the states it is seeded from", async () => {
      vi.mocked(renderFinalCredits).mockResolvedValueOnce({ estimatedCredits: 30, sufficient: true, available: 40 })
      const res = await fromFailed()
      expect(res.statusCode).toBe(202)
      const asked = vi.mocked(renderFinalCredits).mock.calls[0]![0]
      // The plan and the render completed: seeded, never priced.
      expect(asked.runNodeIds).toEqual(["cap", "hook"])
      // A use-case node is priced by the resume the run will make, on these states.
      expect(asked.continuation).toBeDefined()
      expect((await asked.continuation!.source())?.nodeStates).toEqual((failed() as { nodeStates?: unknown }).nodeStates)
      expect(mocks.inserts).toHaveLength(1)
    })

    it("a resume of nothing but nodes that cost nothing is never refused for credits", async () => {
      // The captions completed too: only the hook is left, priced at 0, which any balance covers.
      mocks.loadSource.mockResolvedValue(
        failed({
          nodeStates: {
            plan: { status: "completed", output: { json: {} } },
            cut: { status: "completed", output: { video: "https://r2.example/cut.mp4", quality: "final" } },
            cap: { status: "completed", output: { video: "https://r2.example/cap.mp4" } },
            hook: { status: "failed", error: "timeout" },
          },
        }),
      )
      vi.mocked(renderFinalCredits).mockResolvedValueOnce({ estimatedCredits: 0, sufficient: true, available: 0 })
      const res = await fromFailed()
      expect(res.statusCode).toBe(202)
      expect(vi.mocked(renderFinalCredits).mock.calls[0]![0].runNodeIds).toEqual(["hook"])
    })

    it("a retry of a request that already started its run answers that run (200 deduped), never the 402", async () => {
      mocks.executions.push({ id: "00000000-0000-4000-8000-000000000077", user_id: USER, idempotency_key: "retry-key-0000001" })
      const res = await fromFailed({}, { "idempotency-key": "retry-key-0000001" })
      expect(res.statusCode).toBe(200)
      expect(res.json()).toEqual({ executionId: "00000000-0000-4000-8000-000000000077", status: "pending", deduped: true })
      expect(res.headers["x-dedup-hit"]).toBe("1")
      expect(renderFinalCredits).not.toHaveBeenCalled()
      expect(mocks.inserts).toHaveLength(0)
      // A key no earlier request used is checked as any request is.
      vi.mocked(renderFinalCredits).mockResolvedValueOnce(short)
      const fresh = await fromFailed({}, { "idempotency-key": "another-key-000001" })
      expect(fresh.statusCode).toBe(402)
    })
  })

  describe("a run that will stop at a Preview review is not all", () => {
    const editor = (payload: Record<string, unknown> = {}) => {
      mocks.authKind = "jwt"
      return fromFailed({ reviewer: "editor", ...payload })
    }
    const stampOf = () => (mocks.inserts[0]!.trigger_data as { continueFromFailed: { all: boolean } }).continueFromFailed

    it("the remainder runs a render at Preview: the editor's run is let through, stamped not all", async () => {
      mocks.loadSource.mockResolvedValue(failed({ nodeStates: { plan: { status: "completed", nodeType: "edit-plan", output: { json: {} } } } }))
      const res = await editor()
      expect(res.statusCode).toBe(202)
      expect((mocks.queueAdd.mock.calls[0]![1] as Record<string, unknown>).nodeIds).toEqual(["cut", "cap", "hook"])
      expect(stampOf().all).toBe(false)
    })

    it("the same remainder with the render overridden to Final runs to the end: all", async () => {
      mocks.loadSource.mockResolvedValue(failed({ nodeStates: { plan: { status: "completed", nodeType: "edit-plan", output: { json: {} } } } }))
      const res = await editor({ inputOverrides: { cut: { quality: "final" } } })
      expect(res.statusCode).toBe(202)
      expect(stampOf().all).toBe(true)
    })

    it("the render's Final pinned on the failed run counts too (the merged overrides are judged)", async () => {
      mocks.loadSource.mockResolvedValue(
        failed({ inputOverrides: { cut: { quality: "final" } }, nodeStates: { plan: { status: "completed", nodeType: "edit-plan", output: { json: {} } } } }),
      )
      expect((await editor()).statusCode).toBe(202)
      expect(stampOf().all).toBe(true)
    })

    it("a seeded Preview the run hands on stops it too: not all", async () => {
      mocks.loadSource.mockResolvedValue(
        failed({
          nodeStates: {
            plan: { status: "completed", nodeType: "edit-plan", output: { json: {} } },
            cut: { status: "completed", nodeType: "apply-edl", output: { video: "https://r2.example/cut.mp4", quality: "proxy" } },
            cap: { status: "failed", nodeType: "add-captions", error: "boom" },
          },
        }),
      )
      const res = await editor()
      expect(res.statusCode).toBe(202)
      expect((mocks.queueAdd.mock.calls[0]![1] as Record<string, unknown>).nodeIds).toEqual(["cap", "hook"])
      expect(stampOf().all).toBe(false)
    })

    it("such a run that completed does not supersede its source: the source is built on it", async () => {
      const LATER = "00000000-0000-4000-8000-000000000063"
      mocks.executions.push({
        id: LATER,
        user_id: USER,
        workflow_id: WORKFLOW,
        status: "completed",
        started_at: "2026-10-17T11:00:00.000Z",
        created_at: "2026-10-17T11:00:00.000Z",
        trigger_type: "manual",
        trigger_data: { continueFromFailed: { from: PRIOR, root: PRIOR, seededFrom: PRIOR, all: false } },
      })
      mocks.loadSource.mockImplementation(async (id: string) =>
        id === LATER
          ? failed({
              id: LATER,
              status: "completed",
              continueFromFailed: { from: PRIOR, root: PRIOR, seededFrom: PRIOR, all: false },
              nodeStates: {
                plan: { status: "completed", nodeType: "edit-plan", output: { json: {} } },
                cut: { status: "completed", nodeType: "apply-edl", output: { video: "https://r2.example/cut.mp4", quality: "proxy" } },
                cap: { status: "skipped", nodeType: "add-captions" },
                hook: { status: "skipped", nodeType: "webhook-output" },
              },
            })
          : failed(),
      )
      const res = await editor()
      expect(res.statusCode).toBe(202)
      expect(res.json().continuedFrom).toBe(LATER)
      expect(stampOf().all).toBe(false)
    })
  })

  it("judges the reduced set: a Preview render the failed run never completed is refused for an API caller", async () => {
    mocks.loadSource.mockResolvedValue(failed({ nodeStates: { plan: { status: "completed", nodeType: "edit-plan", output: { json: {} } } } }))
    const res = await fromFailed()
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("preview_review_required")
    expect(mocks.inserts).toEqual([])
  })

  it("a run with nothing left answers 409, before any execution row exists", async () => {
    mocks.loadSource.mockResolvedValue(
      failed({
        nodeStates: Object.fromEntries(["plan", "cut", "cap", "hook"].map((id) => [id, { status: "completed", output: { quality: "final" } }])),
      }),
    )
    const res = await fromFailed()
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe("continuation_subset_required")
    expect(res.json().error.message).toMatch(/nothing left/)
    expect(mocks.inserts).toEqual([])
    expect(mocks.queueAdd).not.toHaveBeenCalled()
  })

  const refusals: Array<[string, Record<string, unknown>, () => void, number, string]> = [
    ["without continueFromExecutionId", { continueFromExecutionId: undefined }, () => {}, 400, "validation_error"],
    ["with renderFinal", { renderFinal: { renderNodeId: "cut" } }, () => {}, 400, "validation_error"],
    ["with an unknown mode", { continueMode: "from-start" }, () => {}, 400, "validation_error"],
    ["of an app run's execution", {}, () => mocks.loadSource.mockResolvedValue(failed({ appVersionId: "app-1" })), 400, "continuation_version_mismatch"],
    ["of another workflow's run", {}, () => mocks.loadSource.mockResolvedValue(failed({ workflowId: "wf-other" })), 400, "continuation_workflow_mismatch"],
    ["of a run that completed", {}, () => mocks.loadSource.mockResolvedValue(failed({ status: "completed" })), 409, "continuation_not_failed"],
    ["of no such execution", {}, () => mocks.loadSource.mockResolvedValue(null), 404, "continuation_not_found"],
    // Someone else's run reads as missing — even one whose states hold nothing left to run.
    [
      "of someone else's execution",
      {},
      () => mocks.loadSource.mockResolvedValue(failed({ userId: "other", nodeStates: Object.fromEntries(["plan", "cut", "cap", "hook"].map((id) => [id, { status: "completed" }])) })),
      404,
      "continuation_not_found",
    ],
  ]
  it.each(refusals)("refuses a continue-from-failed %s, before any execution row exists", async (_name, payload, setup, status, code) => {
    setup()
    const res = await fromFailed(payload)
    expect(res.statusCode).toBe(status)
    expect(res.json().error.code).toBe(code)
    expect(mocks.inserts).toEqual([])
    expect(mocks.queueAdd).not.toHaveBeenCalled()
  })

  it("the shape checks come before any read", async () => {
    await fromFailed({ renderFinal: { renderNodeId: "cut" } })
    await fromFailed({ continueFromExecutionId: undefined })
    expect(mocks.loadSource).not.toHaveBeenCalled()
  })

  describe("a later continuation that failed, or completed all the run left, supersedes it; one that completed part does not", () => {
    const LATER = "00000000-0000-4000-8000-000000000063"
    const NEWER = "00000000-0000-4000-8000-000000000064"
    const ROOT = "00000000-0000-4000-8000-000000000060"
    /** A later generation of the lineage rooted at `root`, as the executions table holds it. */
    const generation = (id: string, over: Record<string, unknown> = {}, root = PRIOR) => ({
      id,
      user_id: USER,
      workflow_id: WORKFLOW,
      status: "failed",
      started_at: "2026-10-17T11:00:00.000Z",
      created_at: "2026-10-17T11:00:00.000Z",
      trigger_type: "manual",
      trigger_data: { continueFromFailed: { from: root, root, all: true } },
      ...over,
    })

    it("a webhook run whose posted body forged a later generation is no generation: no false done, no narrowing", async () => {
      // "Completed all": would answer the owner's resume continuation_superseded (done).
      mocks.executions.push(generation(LATER, { status: "completed", trigger_type: "webhook" }))
      // "Completed part": would build the resume on the forged run instead.
      mocks.executions.push(
        generation(NEWER, {
          status: "completed",
          created_at: "2026-10-17T12:00:00.000Z",
          trigger_type: "webhook",
          trigger_data: { message: "hi", continueFromFailed: { from: PRIOR, root: PRIOR, seededFrom: PRIOR, all: false } },
        }),
      )
      const res = await fromFailed()
      expect(res.statusCode).toBe(202)
      expect(res.json().supersededBy).toBeUndefined()
      expect((mocks.queueAdd.mock.calls[0]![1] as Record<string, unknown>).seedFromExecutionId).toBeUndefined()
      expect(mocks.inserts[0]!.trigger_data).toEqual({ continueFromFailed: { from: PRIOR, root: PRIOR, seededFrom: PRIOR, all: true } })
    })

    it("a later continuation that failed: 409 naming it, its id and status in the body and the message", async () => {
      mocks.executions.push(generation(LATER))
      const res = await fromFailed()
      expect(res.statusCode).toBe(409)
      expect(res.json().error.code).toBe("continuation_superseded")
      expect(res.json().executionId).toBe(LATER)
      expect(res.json().supersededBy).toEqual({ executionId: LATER, status: "failed" })
      // The message names it too (an SDK error carries the message, not the body).
      expect(res.json().error.message).toContain(LATER)
      expect(mocks.inserts).toEqual([])
    })

    it("of several later failures, the newest is named", async () => {
      mocks.executions.push(generation(LATER), generation(NEWER, { created_at: "2026-10-17T12:00:00.000Z" }))
      const res = await fromFailed()
      expect(res.statusCode).toBe(409)
      expect(res.json().supersededBy.executionId).toBe(NEWER)
    })

    it("a later continuation that COMPLETED all the run left supersedes it: 409 saying the work is done, never to continue it", async () => {
      mocks.executions.push(generation(LATER, { status: "completed" }))
      const res = await fromFailed()
      expect(res.statusCode).toBe(409)
      expect(res.json().error.code).toBe("continuation_superseded")
      expect(res.json().supersededBy).toEqual({ executionId: LATER, status: "completed" })
      expect(res.json().error.message).toContain(LATER)
      expect(res.json().error.message).toMatch(/already done/)
      expect(res.json().error.message).toMatch(/results are on that execution/)
      expect(res.json().error.message).not.toMatch(/continue/i)
      expect(mocks.inserts).toEqual([])
      expect(mocks.queueAdd).not.toHaveBeenCalled()
    })

    // Built on the newest (decided 2026-10-18): a later continuation that
    // completed only PART of what the run left holds the run's completed work
    // AND its own, so the run is continued FROM it — never re-running, or
    // re-billing, what it did.
    describe("one that completed only PART of what the run left: the run is built on it", () => {
      /** B, a narrow continuation of A that completed: A's plan and render seeded, B's own captions, the hook left. */
      const narrowB = (over: Record<string, unknown> = {}) =>
        failed({
          id: LATER,
          status: "completed",
          continueFromFailed: { from: PRIOR, root: PRIOR, seededFrom: PRIOR, all: false },
          nodeStates: {
            plan: { status: "completed", nodeType: "edit-plan", output: { json: { clips: [] } }, seededFromExecution: PRIOR },
            cut: { status: "completed", nodeType: "apply-edl", output: { video: "https://r2.example/cut.mp4", quality: "final" }, seededFromExecution: PRIOR },
            cap: { status: "completed", nodeType: "add-captions", output: { video: "https://r2.example/cap.mp4" } },
            hook: { status: "skipped", nodeType: "webhook-output", seededFromExecution: PRIOR },
          },
          ...over,
        })
      const byId = (rows: Record<string, unknown>) => mocks.loadSource.mockImplementation(async (id: string) => rows[id] ?? null)

      beforeEach(() => {
        byId({ [PRIOR]: failed(), [LATER]: narrowB() })
        mocks.executions.push(generation(LATER, { status: "completed", trigger_data: { continueFromFailed: { from: PRIOR, root: PRIOR, all: false } } }))
      })

      it("seeds from it: its completed nodes are handed on, not run; only what it left runs", async () => {
        const res = await fromFailed()
        expect(res.statusCode).toBe(202)
        expect(mocks.loadSource).toHaveBeenCalledWith(LATER, expect.objectContaining({ withStates: true }))
        const job = mocks.queueAdd.mock.calls[0]![1] as Record<string, unknown>
        // The run asked for is still the one continued (and checked); the states come from B.
        expect(job.continueFromExecutionId).toBe(PRIOR)
        expect(job.seedFromExecutionId).toBe(LATER)
        // B's captions are not in the run set: only the hook B left runs.
        expect(job.nodeIds).toEqual(["hook"])
        // The seeds the route judged the run by are B's: its captions handed on, from B.
        const seeds = mocks.seeds.mock.results.at(-1)!.value as Map<string, Record<string, unknown>>
        expect(mocks.seeds.mock.calls.at(-1)![1]).toMatchObject({ id: LATER })
        expect(seeds.get("cap")).toMatchObject({ status: "completed", output: { video: "https://r2.example/cap.mp4" }, seededFromExecution: LATER })
        expect(seeds.get("cut")).toMatchObject({ status: "completed", seededFromExecution: LATER })
        expect(seeds.has("hook")).toBe(false)
        // The row keeps the lineage walkable from A, and names B; it runs all B left.
        expect(mocks.inserts[0]!.trigger_data).toEqual({ continueFromFailed: { from: PRIOR, root: PRIOR, seededFrom: LATER, all: true } })
        // The answer says where it continued from.
        expect(res.json().continuedFrom).toBe(LATER)
      })

      it("a named node B completed is not run again either", async () => {
        const res = await fromFailed({ nodeIds: ["cap", "hook"] })
        expect(res.statusCode).toBe(202)
        expect((mocks.queueAdd.mock.calls[0]![1] as Record<string, unknown>).nodeIds).toEqual(["hook"])
      })

      it("B's pinned overrides are the ones the checks judge (it pinned what it applied)", async () => {
        byId({ [PRIOR]: failed(), [LATER]: narrowB({ inputOverrides: { hook: { url: "https://elsewhere.example/collect" } } }) })
        const res = await fromFailed()
        expect(res.statusCode).toBe(400)
        expect(res.json().error.code).toBe("locked_field")
        expect(mocks.merge).toHaveBeenCalledWith(expect.objectContaining({ id: LATER }), undefined)
        expect(mocks.inserts).toEqual([])
      })

      it("B left nothing of the work: 409 nothing left, judged on B's states", async () => {
        byId({
          [PRIOR]: failed(),
          [LATER]: narrowB({
            nodeStates: Object.fromEntries(["plan", "cut", "cap", "hook"].map((id) => [id, { status: "completed", output: { quality: "final" } }])),
          }),
        })
        const res = await fromFailed()
        expect(res.statusCode).toBe(409)
        expect(res.json().error.code).toBe("continuation_subset_required")
        expect(mocks.inserts).toEqual([])
      })

      it("a stamp from before `all` existed reads as part: built on too", async () => {
        mocks.executions.length = 0
        mocks.executions.push(generation(LATER, { status: "completed", trigger_data: { continueFromFailed: { from: PRIOR, root: PRIOR } } }))
        const res = await fromFailed()
        expect(res.statusCode).toBe(202)
        expect((mocks.queueAdd.mock.calls[0]![1] as Record<string, unknown>).seedFromExecutionId).toBe(LATER)
      })

      it("a newest generation that cannot be read back is an error, never a run seeded from the wrong states", async () => {
        byId({ [PRIOR]: failed() })
        const res = await fromFailed()
        expect(res.statusCode).toBe(500)
        expect(mocks.inserts).toEqual([])
        expect(mocks.queueAdd).not.toHaveBeenCalled()
      })

      it("a chain: B, then C built on B, both narrow — continuing A builds on C, the newest", async () => {
        const C = "00000000-0000-4000-8000-000000000065"
        const narrowC = narrowB({
          id: C,
          continueFromFailed: { from: PRIOR, root: PRIOR, seededFrom: LATER, all: false },
          nodeStates: {
            ...((narrowB() as { nodeStates?: Record<string, unknown> }).nodeStates ?? {}),
            cap: { status: "completed", nodeType: "add-captions", output: { video: "https://r2.example/cap.mp4" }, seededFromExecution: LATER },
            hook: { status: "completed", nodeType: "webhook-output", output: {} },
          },
        })
        // A graph with one more node, which neither B nor C ran.
        mocks.graphOverride = { nodes: [...graph.nodes, { id: "tail", type: "add-captions", data: {} }], edges: graph.edges }
        byId({ [PRIOR]: failed(), [LATER]: narrowB(), [C]: narrowC })
        mocks.executions.push(
          generation(C, { status: "completed", created_at: "2026-10-17T12:00:00.000Z", trigger_data: { continueFromFailed: { from: PRIOR, root: PRIOR, all: false } } }),
        )
        const res = await fromFailed()
        expect(res.statusCode).toBe(202)
        const job = mocks.queueAdd.mock.calls[0]![1] as Record<string, unknown>
        expect(job.seedFromExecutionId).toBe(C)
        // Neither B's captions nor C's hook run again: only what C left.
        expect(job.nodeIds).toEqual(["tail"])
        expect(mocks.inserts[0]!.trigger_data).toEqual({ continueFromFailed: { from: PRIOR, root: PRIOR, seededFrom: C, all: true } })
        expect(res.json().continuedFrom).toBe(C)

        // A newer failure D of the chain supersedes A: 409 naming D.
        const D = "00000000-0000-4000-8000-000000000066"
        mocks.executions.push(generation(D, { created_at: "2026-10-17T13:00:00.000Z" }))
        mocks.queueAdd.mockClear()
        mocks.inserts.length = 0
        const refused = await fromFailed()
        expect(refused.statusCode).toBe(409)
        expect(refused.json().supersededBy).toEqual({ executionId: D, status: "failed" })
        expect(mocks.inserts).toEqual([])
      })

      it("a later failure older than the newest partial one does not block: the newest wins", async () => {
        mocks.executions.push(generation("00000000-0000-4000-8000-000000000067", { created_at: "2026-10-17T10:30:00.000Z" }))
        const res = await fromFailed()
        expect(res.statusCode).toBe(202)
        expect((mocks.queueAdd.mock.calls[0]![1] as Record<string, unknown>).seedFromExecutionId).toBe(LATER)
      })
    })

    it("the newer of a later failure and a later completion of all wins", async () => {
      mocks.executions.push(
        generation(LATER, { status: "completed", created_at: "2026-10-17T12:00:00.000Z" }),
        generation(NEWER, { status: "failed", created_at: "2026-10-17T11:00:00.000Z" }),
      )
      expect((await fromFailed()).json().supersededBy).toEqual({ executionId: LATER, status: "completed" })
      mocks.executions.length = 0
      mocks.executions.push(
        generation(LATER, { status: "completed", created_at: "2026-10-17T11:00:00.000Z" }),
        generation(NEWER, { status: "failed", created_at: "2026-10-17T12:00:00.000Z" }),
      )
      expect((await fromFailed()).json().supersededBy).toEqual({ executionId: NEWER, status: "failed" })
    })

    it("a later continuation still under way is the active run: 409 already_running naming it", async () => {
      mocks.executions.push(generation(LATER, { status: "running" }))
      const res = await fromFailed()
      expect(res.statusCode).toBe(409)
      expect(res.json().error.code).toBe("already_running")
      expect(res.json().executionId).toBe(LATER)
      expect(mocks.inserts).toEqual([])
    })

    it("a later continuation that was cancelled does not count", async () => {
      mocks.executions.push(generation(LATER, { status: "cancelled" }))
      expect((await fromFailed()).statusCode).toBe(202)
    })

    it("a later continuation that failed before it started does not count (it holds nothing)", async () => {
      mocks.executions.push(generation(LATER, { started_at: null }))
      expect((await fromFailed()).statusCode).toBe(202)
    })

    it("someone else's run, or another workflow's, is no generation of this run", async () => {
      mocks.executions.push(generation(LATER, { user_id: "someone-else" }), generation(NEWER, { workflow_id: "wf-other" }))
      expect((await fromFailed()).statusCode).toBe(202)
    })

    it("the newest generation itself continues, and the new row joins its lineage's root", async () => {
      mocks.loadSource.mockResolvedValue(failed({ continueFromFailed: { from: ROOT, root: ROOT } }))
      mocks.executions.push(generation(PRIOR, {}, ROOT))
      const res = await fromFailed()
      expect(res.statusCode).toBe(202)
      expect(mocks.inserts[0]!.trigger_data).toEqual({ continueFromFailed: { from: PRIOR, root: ROOT, seededFrom: PRIOR, all: true } })
      expect(mocks.lineageCalls).toContainEqual(["eq", "trigger_data->continueFromFailed->>root", ROOT])
    })

    it("a continuation that never started holds nothing: 409 naming the (failed) run it continued", async () => {
      mocks.loadSource.mockResolvedValue(failed({ startedAt: null, nodeStates: {}, continueFromFailed: { from: ROOT, root: ROOT, all: true } }))
      const res = await fromFailed()
      expect(res.statusCode).toBe(409)
      expect(res.json().error.code).toBe("continuation_superseded")
      expect(res.json().supersededBy).toEqual({ executionId: ROOT, status: "failed" })
    })

    it("a continuation that never started goes to its lineage's newest failure, not a parent that one superseded", async () => {
      mocks.loadSource.mockResolvedValue(failed({ startedAt: null, nodeStates: {}, continueFromFailed: { from: ROOT, root: ROOT, all: true } }))
      mocks.executions.push(generation(NEWER, {}, ROOT))
      const res = await fromFailed()
      expect(res.statusCode).toBe(409)
      expect(res.json().supersededBy).toEqual({ executionId: NEWER, status: "failed" })
      expect(res.json().error.message).toContain(NEWER)
    })

    it("a continuation that never started, after a later one completed all: the work is done", async () => {
      mocks.loadSource.mockResolvedValue(failed({ startedAt: null, nodeStates: {}, continueFromFailed: { from: ROOT, root: ROOT, all: true } }))
      mocks.executions.push(generation(NEWER, { status: "completed" }, ROOT))
      const res = await fromFailed()
      expect(res.statusCode).toBe(409)
      expect(res.json().supersededBy).toEqual({ executionId: NEWER, status: "completed" })
      expect(res.json().error.message).toMatch(/already done/)
    })
  })

  it("a plain continuation (no mode) is unchanged: no stamp, no mode on the job", async () => {
    mocks.loadSource.mockResolvedValue(source({ nodeStates: {} }))
    const res = await run({ ...renderFinal, continueFromExecutionId: PRIOR })
    expect(res.statusCode).toBe(202)
    // No lineage stamp: only the nodes it was started on.
    expect(mocks.inserts[0]!.trigger_data).toEqual({ nodeSelection: ["cut", "cap"] })
    expect((mocks.queueAdd.mock.calls[0]![1] as Record<string, unknown>).continueMode).toBeUndefined()
  })
})
