// @test-units-by-name prices only the node types its graphs name (add-captions, webhook-output, edit-plan, apply-edl), never every node
/**
 * POST /v1/workflows/:id/run: a run's node selection, and the node scope a
 * continue-from-failed defaults to (lib/continue-from-failed-lineage.ts).
 *
 * - A run started on named nodes (`nodeIds`) that is no generation of a lineage
 *   records them (`trigger_data.nodeSelection`); a run of every node records
 *   nothing.
 * - A continue-from-failed sent no `nodeIds` considers the lineage's scope —
 *   its root's selection, carried on every generation's stamp (`scope`) — plus
 *   every node the run it continues left failed or held back, and every node
 *   when none is recorded. Explicit `nodeIds` always win, a done chain included.
 * - `all` is judged against that default set, so the "done" refusal follows
 *   it, and the run in `next` (a Render final's set: the hold and every node
 *   after it) finishes the chain — or, failing outside the scope, is retried.
 *
 * The fixtures hold the states a subset run really writes: a node outside the
 * subset is seeded `completed` from its saved data. The node that tells the
 * rules apart is one with NO state — added to the workflow after the run.
 *
 * The harness is workflow-run-continuation.test.ts's.
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
  /** The real credit check, for the tests that price a run end to end (otherwise it is covered: null). */
  realCredits: null as unknown as typeof import("@/lib/render-final-run.js").renderFinalCredits,
  /** The payer's balance those tests check against. */
  balance: 0,
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
// The run-set estimate at the base prices (no price-table read) and a balance
// in memory: what the up-front credit check of a continuation asks.
vi.mock("@/ee/billing/credits.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/ee/billing/credits.js")>()
  return {
    // The run pre-check (R51): no metered model here is unpriced.
    unpricedMeteredLlmOfRun: () => null,
    runHoldsMeteredLlmEstimate: actual.runHoldsMeteredLlmEstimate,
    CreditsService: { refundCredits: vi.fn() },
    estimateRunSetCredits: async (
      nodes: Parameters<typeof actual.estimateRunSetCredits>[0],
      edges: Parameters<typeof actual.estimateRunSetCredits>[1],
      runNodeIds: ReadonlySet<string>,
    ) => actual.CreditsService.estimateWorkflowBaseCredits(nodes, edges, { runNodeIds }),
    // The same figure as the hold: no UGC part here.
    estimateRunSetFigures: async (
      nodes: Parameters<typeof actual.estimateRunSetFigures>[0],
      edges: Parameters<typeof actual.estimateRunSetFigures>[1],
      runNodeIds: ReadonlySet<string>,
    ) => {
      const credits = await actual.CreditsService.estimateWorkflowBaseCredits(nodes, edges, { runNodeIds })
      return { credits, hold: credits }
    },
    checkRunSetCredits: async (_user: string, required: number) => ({
      sufficient: mocks.balance >= required,
      required,
      available: mocks.balance,
      ...(mocks.balance >= required ? {} : { message: `Insufficient credits: ${required} needed, ${mocks.balance} available` }),
    }),
  }
})
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

// A Render final checks its payer's balance first (its own tests); here it is covered.
vi.mock("@/lib/render-final-run.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/render-final-run.js")>()
  mocks.realCredits = actual.renderFinalCredits
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
      // The detail read (GET /v1/workflow-executions/:id).
      q.single = async () => {
        const hit = mocks.executions.filter((r) => preds.every((p) => p(r)))[0]
        return hit ? { data: hit, error: null } : { data: null, error: { message: "not found" } }
      }
      const rows = () => {
        const out = mocks.executions.filter((r) => preds.every((p) => p(r)))
        return descending ? [...out].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))) : out
      }
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

const run = (payload: Record<string, unknown>) =>
  app.inject({ method: "POST", url: `/v1/workflows/${WORKFLOW}/run`, payload })

const HOP = "00000000-0000-4000-8000-000000000063"
const NEWER = "00000000-0000-4000-8000-000000000064"
const at = "2026-10-17T11:00:00.000Z"

/** a → b → c, the nodes a run was started on; d, a node outside it; n, a node added since. */
const scopeGraph = () => ({
  nodes: [
    { id: "a", type: "add-captions", data: {} },
    { id: "b", type: "add-captions", data: {} },
    { id: "c", type: "webhook-output", data: { url: "https://mine.example/hook" } },
    { id: "d", type: "add-captions", data: {} },
    { id: "n", type: "add-captions", data: {} },
  ],
  edges: [
    { id: "e1", source: "a", target: "b" },
    { id: "e2", source: "b", target: "c" },
  ],
})
const SELECTION = ["a", "b", "c"]

/** The states a run of a, b, c that failed at b writes: d outside it seeded from its saved data; n has none (added since). */
const failedSubsetStates = () => ({
  a: { status: "completed", startedAt: at, nodeType: "add-captions", output: { video: "https://r2.example/a.mp4" } },
  b: { status: "failed", nodeType: "add-captions", error: "boom" },
  c: { status: "skipped", nodeType: "webhook-output" },
  d: { status: "completed", nodeType: "add-captions", output: { video: "https://r2.example/d.mp4" }, fromSavedData: true },
})
/** The failed root: its selection as recorded (none for a run of every node, or one from before the record). */
const failedRoot = (selection: string[] | null, over: Record<string, unknown> = {}) =>
  source({
    status: "failed",
    startedAt: "2026-10-17T10:00:00.000Z",
    continueFromFailed: null,
    nodeSelection: selection,
    inputOverrides: null,
    nodeStates: failedSubsetStates(),
    ...over,
  })
/** A generation's row, as the lineage read sees it. */
const row = (id: string, stamp: Record<string, unknown>, over: Record<string, unknown> = {}) => ({
  id,
  user_id: USER,
  workflow_id: WORKFLOW,
  status: "completed",
  started_at: at,
  created_at: at,
  // The lineage read finds only runs a stamp-writing lane started.
  trigger_type: "manual",
  trigger_data: { continueFromFailed: stamp },
  ...over,
})
const byId = (rows: Record<string, unknown>) => mocks.loadSource.mockImplementation(async (id: string) => rows[id] ?? null)
const fromFailed = (over: Record<string, unknown> = {}, id = PRIOR) => run({ continueFromExecutionId: id, continueMode: "from-failed", ...over })
const job = () => mocks.queueAdd.mock.calls[0]![1] as Record<string, unknown>
const stampOf = () => (mocks.inserts[0]?.trigger_data as { continueFromFailed?: Record<string, unknown> } | undefined)?.continueFromFailed

beforeEach(() => {
  mocks.graphOverride = scopeGraph()
})

describe("recording a run's node selection", () => {
  it("a run started on named nodes records them: each once, only nodes of the workflow, in the order sent", async () => {
    const res = await run({ nodeIds: ["b", "a", "b", "ghost"] })
    expect(res.statusCode).toBe(202)
    expect(mocks.inserts[0]!.trigger_data).toEqual({ nodeSelection: ["b", "a"] })
    // The job runs what it was sent, as before.
    expect(job().nodeIds).toEqual(["b", "a", "b", "ghost"])
  })

  it("a run of every node records nothing", async () => {
    expect((await run({})).statusCode).toBe(202)
    expect(mocks.inserts[0]!.trigger_data).toBeUndefined()
    mocks.inserts.length = 0
    expect((await run({ nodeIds: [] })).statusCode).toBe(202)
    expect(mocks.inserts[0]!.trigger_data).toBeUndefined()
  })

  it("a continue-from-failed records the lineage's scope on its stamp, never a selection of its own", async () => {
    mocks.loadSource.mockResolvedValue(failedRoot(SELECTION))
    const res = await fromFailed({ nodeIds: ["b"] })
    expect(res.statusCode).toBe(202)
    expect(mocks.inserts[0]!.trigger_data).toEqual({
      continueFromFailed: { from: PRIOR, root: PRIOR, seededFrom: PRIOR, all: false, scope: SELECTION },
    })
  })
})

describe("a continue-from-failed sent no nodeIds defaults to the lineage's node scope", () => {
  it("a subset run that failed: only the failed part of that subset runs — not a node added since", async () => {
    mocks.loadSource.mockResolvedValue(failedRoot(SELECTION))
    const res = await fromFailed()
    expect(res.statusCode).toBe(202)
    expect(job().nodeIds).toEqual(["b", "c"])
    // It ran all its source left of the scope: all, and the scope rides on.
    expect(stampOf()).toEqual({ from: PRIOR, root: PRIOR, seededFrom: PRIOR, all: true, scope: SELECTION })
  })

  it("a Render final that failed: only its own set — not a node it handed on as skipped from the run it continued", async () => {
    // The default graph: plan → cut → cap, and a hook the run before the final never completed.
    mocks.graphOverride = null
    mocks.loadSource.mockResolvedValue(
      failedRoot(["cut", "cap"], {
        nodeStates: {
          plan: { status: "completed", nodeType: "edit-plan", output: { json: {} }, seededFromExecution: NEWER },
          cut: { status: "completed", startedAt: at, nodeType: "apply-edl", output: { video: "https://r2.example/cut.mp4", quality: "final" } },
          cap: { status: "failed", nodeType: "add-captions", error: "boom" },
          hook: { status: "skipped", nodeType: "webhook-output", seededFromExecution: NEWER },
        },
      }),
    )
    const res = await fromFailed()
    expect(res.statusCode).toBe(202)
    expect(job().nodeIds).toEqual(["cap"])
    expect(stampOf()).toEqual({ from: PRIOR, root: PRIOR, seededFrom: PRIOR, all: true, scope: ["cut", "cap"] })
  })

  it("a run of every node that failed: every node it did not complete, as before (the node added since included)", async () => {
    mocks.loadSource.mockResolvedValue(failedRoot(null))
    const res = await fromFailed()
    expect(res.statusCode).toBe(202)
    expect(job().nodeIds).toEqual(["b", "c", "n"])
    expect(stampOf()).toEqual({ from: PRIOR, root: PRIOR, seededFrom: PRIOR, all: true })
  })

  it("a run from before the selection was recorded (no record, even of a subset): every node", async () => {
    // Its stored row: no `nodeSelection` in trigger_data, so the loader reads none.
    mocks.loadSource.mockResolvedValue(failedRoot(null, { nodeSelection: undefined }))
    const res = await fromFailed()
    expect(res.statusCode).toBe(202)
    expect(job().nodeIds).toEqual(["b", "c", "n"])
    expect(stampOf()!.scope).toBeUndefined()
  })

  it("explicit nodeIds win over the scope; all is judged against the default set, never against them", async () => {
    mocks.loadSource.mockResolvedValue(failedRoot(SELECTION))
    const narrow = await fromFailed({ nodeIds: ["n"] })
    expect(narrow.statusCode).toBe(202)
    expect(job().nodeIds).toEqual(["n"])
    // It leaves b and c, which the scope holds: not all.
    expect(stampOf()).toEqual({ from: PRIOR, root: PRIOR, seededFrom: PRIOR, all: false, scope: SELECTION })

    mocks.queueAdd.mockClear()
    mocks.inserts.length = 0
    const wide = await fromFailed({ nodeIds: ["b", "c", "n"] })
    expect(wide.statusCode).toBe(202)
    expect(job().nodeIds).toEqual(["b", "c", "n"])
    expect(stampOf()!.all).toBe(true)
  })

  it("a scope none of whose nodes is still on the workflow: 409, before any execution row exists", async () => {
    mocks.graphOverride = { nodes: scopeGraph().nodes.filter((n) => !SELECTION.includes(n.id)), edges: [] }
    mocks.loadSource.mockResolvedValue(failedRoot(SELECTION))
    const res = await fromFailed()
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe("continuation_subset_required")
    expect(res.json().error.message).toMatch(/first run of this chain was started on/)
    // Worded for every surface: an MCP run_workflow call has no node list to send.
    expect(res.json().error.message).not.toMatch(/nodeIds/)
    expect(mocks.inserts).toEqual([])
  })

  it("a failure inside the scope is unchanged: a node added since downstream of it still does not run", async () => {
    const graph = scopeGraph()
    mocks.graphOverride = { nodes: graph.nodes, edges: [...graph.edges, { id: "e3", source: "b", target: "n" }] }
    mocks.loadSource.mockResolvedValue(failedRoot(SELECTION))
    const res = await fromFailed()
    expect(res.statusCode).toBe(202)
    expect(job().nodeIds).toEqual(["b", "c"])
    expect(stampOf()).toEqual({ from: PRIOR, root: PRIOR, seededFrom: PRIOR, all: true, scope: SELECTION })
  })
})

describe("explicit nodeIds reopen a chain judged done against its default set", () => {
  const DONE_STAMP = { from: PRIOR, root: PRIOR, seededFrom: PRIOR, all: true, scope: SELECTION }
  /** NEWER: a continue-from-failed of the root that completed all of the scope; n was added to the workflow since the root. */
  const done = () =>
    source({
      id: NEWER,
      status: "completed",
      startedAt: at,
      continueFromFailed: DONE_STAMP,
      nodeSelection: null,
      inputOverrides: null,
      nodeStates: {
        ...failedSubsetStates(),
        a: { status: "completed", nodeType: "add-captions", output: { video: "https://r2.example/a.mp4" }, seededFromExecution: PRIOR },
        b: { status: "completed", startedAt: at, nodeType: "add-captions", output: { video: "https://r2.example/b.mp4" } },
        c: { status: "completed", startedAt: at, nodeType: "webhook-output", output: {} },
      },
    })

  beforeEach(() => {
    byId({ [PRIOR]: failedRoot(SELECTION), [NEWER]: done() })
    mocks.executions.push(row(NEWER, DONE_STAMP))
  })

  it("sent no nodeIds, the root is refused as done", async () => {
    const res = await fromFailed()
    expect(res.statusCode).toBe(409)
    expect(res.json().supersededBy).toEqual({ executionId: NEWER, status: "completed" })
    expect(mocks.inserts).toEqual([])
  })

  it("nodeIds naming a node the done generation left (n, added since) run it, built on that generation", async () => {
    const res = await fromFailed({ nodeIds: ["n"] })
    expect(res.statusCode).toBe(202)
    expect(job().seedFromExecutionId).toBe(NEWER)
    // The worker is told the head is done (it would refuse it otherwise).
    expect(job().reopenHead).toBe("done")
    expect(job().nodeIds).toEqual(["n"])
    expect(stampOf()).toEqual({ from: PRIOR, root: PRIOR, seededFrom: NEWER, all: true, scope: SELECTION })
  })

  it("a default run built on a partial newest carries no reopen flag", async () => {
    mocks.executions.length = 0
    const PARTIAL = { ...DONE_STAMP, all: false }
    byId({ [PRIOR]: failedRoot(SELECTION), [NEWER]: { ...done(), continueFromFailed: PARTIAL, nodeStates: { ...(done() as unknown as { nodeStates: Record<string, unknown> }).nodeStates, c: { status: "skipped", nodeType: "webhook-output" } } } })
    mocks.executions.push(row(NEWER, PARTIAL))
    const res = await fromFailed()
    expect(res.statusCode).toBe(202)
    expect(job().seedFromExecutionId).toBe(NEWER)
    expect(job().reopenHead).toBeUndefined()
  })

  it("nodeIds naming only nodes it completed are still refused as done: nothing runs or is charged again", async () => {
    const res = await fromFailed({ nodeIds: ["b", "c"] })
    expect(res.statusCode).toBe(409)
    expect(res.json()).toMatchObject({ error: { code: "continuation_superseded" }, supersededBy: { executionId: NEWER, status: "completed" } })
    expect(mocks.inserts).toEqual([])
    expect(mocks.queueAdd).not.toHaveBeenCalled()
  })

  describe("a newest generation that FAILED", () => {
    const FAILED_STAMP = { ...DONE_STAMP, all: false }
    /** HOP: a continuation of the root that completed b and failed at c. */
    const failedHop = () =>
      source({
        id: HOP,
        status: "failed",
        startedAt: at,
        continueFromFailed: FAILED_STAMP,
        nodeSelection: null,
        inputOverrides: null,
        nodeStates: {
          ...failedSubsetStates(),
          a: { status: "completed", nodeType: "add-captions", output: { video: "https://r2.example/a.mp4" }, seededFromExecution: PRIOR },
          b: { status: "completed", startedAt: at, nodeType: "add-captions", output: { video: "https://r2.example/b.mp4" } },
          c: { status: "failed", nodeType: "webhook-output", error: "boom" },
        },
      })
    beforeEach(() => {
      byId({ [PRIOR]: failedRoot(SELECTION), [NEWER]: done(), [HOP]: failedHop() })
      mocks.executions.push(row(HOP, FAILED_STAMP, { status: "failed", created_at: "2026-10-17T12:00:00.000Z" }))
    })

    it("sent no nodeIds, the run asked for is redirected to it", async () => {
      const res = await fromFailed()
      expect(res.statusCode).toBe(409)
      expect(res.json().supersededBy).toEqual({ executionId: HOP, status: "failed" })
      expect(mocks.inserts).toEqual([])
    })

    it("sent nodeIds, the run is built on it: what it completed is never run again, and the worker is told", async () => {
      const res = await fromFailed({ nodeIds: ["b", "c", "n"] })
      expect(res.statusCode).toBe(202)
      expect(job().seedFromExecutionId).toBe(HOP)
      expect(job().reopenHead).toBe("failed")
      // b: HOP completed it — dropped; c: HOP failed it; n: added since.
      expect(job().nodeIds).toEqual(["c", "n"])
      expect(stampOf()).toEqual({ from: PRIOR, root: PRIOR, seededFrom: HOP, all: true, scope: SELECTION })
      expect(res.json().continuedFrom).toBe(HOP)
    })

    it("sent nodeIds naming only nodes it completed: nothing is left (409 continuation_subset_required), never superseded", async () => {
      const res = await fromFailed({ nodeIds: ["a", "b"] })
      expect(res.statusCode).toBe(409)
      expect(res.json().error.code).toBe("continuation_subset_required")
      expect(mocks.inserts).toEqual([])
    })

    it("a run asked for that never started, sent nodeIds: built on that newest too", async () => {
      const NEVER = "00000000-0000-4000-8000-000000000065"
      byId({
        [PRIOR]: failedRoot(SELECTION),
        [HOP]: failedHop(),
        [NEVER]: source({ id: NEVER, status: "failed", startedAt: null, continueFromFailed: { from: PRIOR, root: PRIOR, all: false, scope: SELECTION }, nodeSelection: null, nodeStates: {} }),
      })
      const res = await fromFailed({ nodeIds: ["c"] }, NEVER)
      expect(res.statusCode).toBe(202)
      expect(job().seedFromExecutionId).toBe(HOP)
      expect(job().reopenHead).toBe("failed")
      expect(job().nodeIds).toEqual(["c"])
    })
  })

  it("a run asked for that never started, its newest a PARTIAL one: never seeded from the older failed run it names", async () => {
    // The newest completed part of what was left: the never-started run is
    // sent to the run it continued (PRIOR), which a continuation builds on the
    // newest from — seeding from PRIOR itself would run again what HOP did.
    mocks.executions.length = 0
    const PARTIAL = { ...DONE_STAMP, all: false }
    const NEVER = "00000000-0000-4000-8000-000000000065"
    byId({
      [PRIOR]: failedRoot(SELECTION),
      [HOP]: source({ ...done(), id: HOP, continueFromFailed: PARTIAL }),
      [NEVER]: source({ id: NEVER, status: "failed", startedAt: null, continueFromFailed: { from: PRIOR, root: PRIOR, all: false, scope: SELECTION }, nodeSelection: null, nodeStates: {} }),
    })
    mocks.executions.push(row(HOP, PARTIAL))
    const res = await fromFailed({ nodeIds: ["n"] }, NEVER)
    expect(res.statusCode).toBe(409)
    expect(res.json().supersededBy).toEqual({ executionId: PRIOR, status: "failed" })
    expect(mocks.inserts).toEqual([])
    expect(mocks.queueAdd).not.toHaveBeenCalled()
  })
})

describe("across hops the scope stays the root's", () => {
  const HOP_STAMP = { from: PRIOR, root: PRIOR, seededFrom: PRIOR, all: false, scope: SELECTION }
  /** HOP: a continue-from-failed of the root sent nodeIds ["b"]: b done, c left. */
  const hop = (over: Record<string, unknown> = {}) =>
    source({
      id: HOP,
      status: "completed",
      startedAt: at,
      continueFromFailed: HOP_STAMP,
      nodeSelection: null,
      inputOverrides: null,
      nodeStates: {
        ...failedSubsetStates(),
        a: { status: "completed", nodeType: "add-captions", output: { video: "https://r2.example/a.mp4" }, seededFromExecution: PRIOR },
        b: { status: "completed", startedAt: at, nodeType: "add-captions", output: { video: "https://r2.example/b.mp4" } },
        c: { status: "skipped", nodeType: "webhook-output", seededFromExecution: PRIOR },
      },
      ...over,
    })

  it("continuing the root after a narrow hop completed: built on it, running only what the scope still holds", async () => {
    byId({ [PRIOR]: failedRoot(SELECTION), [HOP]: hop() })
    mocks.executions.push(row(HOP, HOP_STAMP))
    const res = await fromFailed()
    expect(res.statusCode).toBe(202)
    expect(job().seedFromExecutionId).toBe(HOP)
    expect(job().nodeIds).toEqual(["c"])
    expect(stampOf()).toEqual({ from: PRIOR, root: PRIOR, seededFrom: HOP, all: true, scope: SELECTION })

    // That generation completed: the work of the scope is done — continuing the root again is refused so.
    mocks.executions.push(row(NEWER, stampOf()!, { created_at: "2026-10-17T12:00:00.000Z" }))
    mocks.queueAdd.mockClear()
    mocks.inserts.length = 0
    const after = await fromFailed()
    expect(after.statusCode).toBe(409)
    expect(after.json().supersededBy).toEqual({ executionId: NEWER, status: "completed" })
    expect(mocks.inserts).toEqual([])
  })

  it("continuing a continuation that failed: the root's scope, not the hop's own nodeIds, and not every node", async () => {
    byId({
      [HOP]: hop({
        status: "failed",
        nodeStates: { ...failedSubsetStates(), b: { status: "completed", startedAt: at, nodeType: "add-captions", output: {} }, c: { status: "failed", nodeType: "webhook-output", error: "boom" } },
      }),
    })
    mocks.executions.push(row(HOP, HOP_STAMP, { status: "failed" }))
    const res = await fromFailed({}, HOP)
    expect(res.statusCode).toBe(202)
    expect(job().nodeIds).toEqual(["c"])
    expect(stampOf()).toEqual({ from: HOP, root: PRIOR, seededFrom: HOP, all: true, scope: SELECTION })
  })

  it("a Render final or run of named nodes joining the chain carries the scope, and its all is judged against it", async () => {
    byId({ [HOP]: hop() })
    mocks.executions.push(row(HOP, HOP_STAMP))
    const res = await run({ nodeIds: ["c"], continueFromExecutionId: HOP })
    expect(res.statusCode).toBe(202)
    // c is all HOP left of the scope (n, added since, is outside it): all.
    expect(mocks.inserts[0]!.trigger_data).toEqual({
      continueFromFailed: { from: HOP, root: PRIOR, seededFrom: HOP, all: true, via: "subset", scope: SELECTION },
    })
  })
})

describe("the run in `next` finishes a scoped chain", () => {
  /** plan → cut (a Preview render) → cap; extra hangs off cut but the root was not started on it. */
  const heldGraph = () => ({
    nodes: [
      { id: "plan", type: "edit-plan", data: {} },
      { id: "cut", type: "apply-edl", data: { quality: "proxy" } },
      { id: "cap", type: "add-captions", data: {} },
      { id: "extra", type: "add-captions", data: {} },
    ],
    edges: [
      { id: "e1", source: "plan", target: "cut" },
      { id: "e2", source: "cut", target: "cap" },
      { id: "e3", source: "cut", target: "extra" },
    ],
  })
  const ROOT_SELECTION = ["plan", "cut", "cap"]
  const HELD = { from: PRIOR, root: PRIOR, seededFrom: PRIOR, all: false, previewRenders: ["cut"], scope: ROOT_SELECTION }
  const held = () =>
    source({
      id: HOP,
      startedAt: at,
      continueFromFailed: HELD,
      nodeSelection: null,
      inputOverrides: null,
      nodeStates: {
        plan: { status: "completed", startedAt: at, nodeType: "edit-plan", output: { json: {} } },
        cut: { status: "completed", startedAt: at, nodeType: "apply-edl", output: { video: "https://r2.example/p.mp4", quality: "proxy" } },
        cap: { status: "skipped", nodeType: "add-captions" },
        extra: { status: "completed", nodeType: "add-captions", output: {}, fromSavedData: true },
      },
    })

  beforeEach(() => {
    mocks.graphOverride = heldGraph()
    byId({
      [PRIOR]: failedRoot(ROOT_SELECTION, { nodeStates: { plan: { status: "completed", startedAt: at, nodeType: "edit-plan", output: { json: {} } } } }),
      [HOP]: held(),
    })
    mocks.executions.push(row(HOP, HELD))
  })

  it("names the hold's Render final set (every node after it, as a Render final runs); run, it finishes the chain", async () => {
    const res = await fromFailed()
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe("continuation_preview_pending")
    // The same run as the render's Render final, so the single-render advice and `next` agree.
    expect(res.json().next).toEqual({ continueFromExecutionId: HOP, nodeIds: ["cut", "cap", "extra"], inputOverrides: { cut: { quality: "final" } } })

    const finish = await run(res.json().next)
    expect(finish.statusCode).toBe(202)
    expect(stampOf()).toEqual({ from: HOP, root: PRIOR, seededFrom: HOP, all: true, via: "subset", scope: ROOT_SELECTION })
    mocks.executions.push(row(NEWER, stampOf()!, { created_at: "2026-10-17T12:00:00.000Z" }))
    const after = await fromFailed()
    expect(after.statusCode).toBe(409)
    expect(after.json()).toMatchObject({ error: { code: "continuation_superseded" }, supersededBy: { executionId: NEWER, status: "completed" } })
  })

  it("the run in `next` failing at extra, a node outside the scope: a plain continue-from-failed of it retries extra", async () => {
    const pending = await fromFailed()
    const finish = await run(pending.json().next)
    expect(finish.statusCode).toBe(202)
    const stamp = stampOf()!
    // That run completed cut and cap, and failed at extra.
    byId({
      [PRIOR]: failedRoot(ROOT_SELECTION, { nodeStates: { plan: { status: "completed", startedAt: at, nodeType: "edit-plan", output: { json: {} } } } }),
      [HOP]: held(),
      [NEWER]: source({
        id: NEWER,
        status: "failed",
        startedAt: at,
        continueFromFailed: stamp,
        nodeSelection: null,
        inputOverrides: null,
        nodeStates: {
          plan: { status: "completed", nodeType: "edit-plan", output: { json: {} }, seededFromExecution: HOP },
          cut: { status: "completed", startedAt: at, nodeType: "apply-edl", output: { video: "https://r2.example/f.mp4", quality: "final" } },
          cap: { status: "completed", startedAt: at, nodeType: "add-captions", output: {} },
          extra: { status: "failed", nodeType: "add-captions", error: "boom" },
        },
      }),
    })
    mocks.executions.push(row(NEWER, stamp, { status: "failed", created_at: "2026-10-17T12:00:00.000Z" }))

    // The root goes to it, as before.
    const viaRoot = await fromFailed()
    expect(viaRoot.statusCode).toBe(409)
    expect(viaRoot.json().supersededBy).toEqual({ executionId: NEWER, status: "failed" })

    mocks.queueAdd.mockClear()
    mocks.inserts.length = 0
    const res = await fromFailed({}, NEWER)
    expect(res.statusCode).toBe(202)
    expect(job().nodeIds).toEqual(["extra"])
    // All is judged against the same set: once extra completes, the chain is done.
    expect(stampOf()).toEqual({ from: NEWER, root: PRIOR, seededFrom: NEWER, all: true, scope: ROOT_SELECTION })
  })
})

// Fix round 2, I-B: a failure outside the scope, handed on by a narrower hop,
// is still retried — whichever failed run of the chain is named. The narrower
// hop's states are made by the real `continuationSeeds` (the producer), so the
// mark the rule reads is the one a run persists.
describe("a failure outside the scope survives a narrower hop (seed provenance)", () => {
  const G1 = "00000000-0000-4000-8000-000000000071"
  const G2 = "00000000-0000-4000-8000-000000000072"
  const ROOT_SCOPE = ["a", "b"]
  /** a → b, the root's scope; x → z, added since. */
  const provenanceGraph = () => ({
    nodes: ["a", "b", "x", "z"].map((id) => ({ id, type: "add-captions", data: {} })),
    edges: [
      { id: "e1", source: "a", target: "b" },
      { id: "e2", source: "x", target: "z" },
    ],
  })
  const G1_STAMP = { from: PRIOR, root: PRIOR, seededFrom: PRIOR, all: false, scope: ROOT_SCOPE }
  const G2_STAMP = { from: G1, root: PRIOR, seededFrom: G1, all: false, scope: ROOT_SCOPE }

  async function lineage() {
    const { continuationSeeds } = await import("../../services/workflow-engine/run-continuation.js")
    const root = failedRoot(ROOT_SCOPE, {
      nodeStates: {
        a: { status: "completed", startedAt: at, nodeType: "add-captions", output: { video: "https://r2.example/a.mp4" } },
        b: { status: "failed", nodeType: "add-captions", error: "boom" },
      },
    })
    // G1: a continue-from-failed of the root sent ["b", "x", "z"] — b done, x failed, z held back.
    const g1 = source({
      id: G1,
      status: "failed",
      startedAt: at,
      continueFromFailed: G1_STAMP,
      nodeSelection: null,
      inputOverrides: null,
      nodeStates: {
        a: { status: "completed", nodeType: "add-captions", output: { video: "https://r2.example/a.mp4" }, seededFromExecution: PRIOR },
        b: { status: "completed", startedAt: at, nodeType: "add-captions", output: { video: "https://r2.example/b.mp4" } },
        x: { status: "failed", nodeType: "add-captions", error: "boom" },
        z: { status: "pending", nodeType: "add-captions" },
      },
    })
    // G2: a continue-from-failed of G1 sent ["x"] — it completes x and hands z on as the producer does.
    const seeds = continuationSeeds(provenanceGraph().nodes, g1 as never, new Set(["x"]))
    const g2 = source({
      id: G2,
      status: "completed",
      startedAt: at,
      continueFromFailed: G2_STAMP,
      nodeSelection: null,
      inputOverrides: null,
      nodeStates: {
        ...Object.fromEntries(seeds),
        x: { status: "completed", startedAt: at, nodeType: "add-captions", output: { video: "https://r2.example/x.mp4" } },
      },
    })
    return { root, g1, g2 }
  }

  beforeEach(async () => {
    mocks.graphOverride = provenanceGraph()
    const { root, g1, g2 } = await lineage()
    byId({ [PRIOR]: root, [G1]: g1, [G2]: g2 })
    mocks.executions.push(row(G1, G1_STAMP, { status: "failed", created_at: "2026-10-17T11:00:00.000Z" }))
    mocks.executions.push(row(G2, G2_STAMP, { created_at: "2026-10-17T12:00:00.000Z" }))
  })

  it("the narrower hop hands z on marked as unfinished", async () => {
    const { g2 } = await lineage()
    expect((g2 as unknown as { nodeStates: Record<string, unknown> }).nodeStates.z).toMatchObject({ status: "skipped", carriedUnfinished: true })
  })

  it("a default continue-from-failed of the ROOT is built on G2 and runs z — not 'nothing left'", async () => {
    const res = await fromFailed()
    expect(res.statusCode).toBe(202)
    expect(job().seedFromExecutionId).toBe(G2)
    expect(job().nodeIds).toEqual(["z"])
    expect(stampOf()).toEqual({ from: PRIOR, root: PRIOR, seededFrom: G2, all: true, scope: ROOT_SCOPE })
  })

  it("a default continue-from-failed of G1 gives the same answer", async () => {
    const res = await fromFailed({}, G1)
    expect(res.statusCode).toBe(202)
    expect(job().seedFromExecutionId).toBe(G2)
    expect(job().nodeIds).toEqual(["z"])
  })

  it("a node a router skipped outside the scope is not a failure: not retried", async () => {
    const { root, g1, g2 } = await lineage()
    const g2States = { ...(g2 as unknown as { nodeStates: Record<string, unknown> }).nodeStates, z: { status: "skipped", nodeType: "add-captions", seededFromExecution: G1 } }
    byId({ [PRIOR]: root, [G1]: g1, [G2]: { ...g2, nodeStates: g2States } })
    const res = await fromFailed()
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe("continuation_subset_required")
  })
})

// The up-front credit check of a continuation (renderFinalCredits, the
// quote's funnel) prices the set this PR's default makes the run execute —
// never every node, never the scope without the failures added to it — and
// prices it on the states the run is seeded from, a reopened head included.
// The real check runs here, on the base prices and an in-memory balance.
describe("the credit check prices exactly what the run executes", () => {
  /** scopeGraph plus m, a priced node added to the workflow after every run below. */
  const pricedGraph = () => {
    const g = scopeGraph()
    return { nodes: [...g.nodes, { id: "m", type: "add-captions", data: {} }], edges: g.edges }
  }
  const HOP_STAMP = { from: PRIOR, root: PRIOR, seededFrom: PRIOR, all: false, scope: SELECTION }
  /** HOP: a continue-from-failed of the root sent ["b", "n"] — a wider hop: b completed, n (outside the scope) failed. */
  const wideHop = () =>
    source({
      id: HOP,
      status: "failed",
      startedAt: at,
      continueFromFailed: HOP_STAMP,
      nodeSelection: null,
      inputOverrides: null,
      nodeStates: {
        ...failedSubsetStates(),
        a: { status: "completed", nodeType: "add-captions", output: { video: "https://r2.example/a.mp4" }, seededFromExecution: PRIOR },
        b: { status: "completed", startedAt: at, nodeType: "add-captions", output: { video: "https://r2.example/b.mp4" } },
        n: { status: "failed", nodeType: "add-captions", error: "boom" },
      },
    })
  /** What the base prices charge for a run of exactly these nodes of the graph. */
  const priceOf = async (ids: readonly string[]) => {
    const { CreditsService } = await vi.importActual<typeof import("@/ee/billing/credits.js")>("@/ee/billing/credits.js")
    const g = pricedGraph()
    return CreditsService.estimateWorkflowBaseCredits(g.nodes as never, g.edges as never, { runNodeIds: new Set(ids) })
  }
  const asked = () => vi.mocked(renderFinalCredits).mock.calls[0]![0]

  beforeEach(() => {
    mocks.graphOverride = pricedGraph()
    vi.mocked(renderFinalCredits).mockImplementation(mocks.realCredits)
    byId({ [PRIOR]: failedRoot(SELECTION), [HOP]: wideHop() })
    mocks.executions.push(row(HOP, HOP_STAMP, { status: "failed", created_at: "2026-10-17T12:00:00.000Z" }))
  })
  afterEach(() => {
    vi.mocked(renderFinalCredits).mockImplementation(async () => null)
  })

  it("a default resume with a recorded scope and a failure outside it: priced on the scope's leftovers plus that failure, nothing else", async () => {
    const exact = await priceOf(["c", "n"])
    // The figure discriminates: n (the out-of-scope failure) is priced, m (added since) is not.
    expect(exact).toBeGreaterThan(0)
    expect(await priceOf(["c", "n", "m"])).toBeGreaterThan(exact)

    mocks.balance = exact - 1
    const short = await fromFailed({}, HOP)
    expect(short.statusCode).toBe(402)
    expect(short.json().error).toMatchObject({ code: "insufficient_credits", required: exact, available: exact - 1 })
    expect(mocks.inserts).toEqual([])
    expect(mocks.queueAdd).not.toHaveBeenCalled()

    vi.mocked(renderFinalCredits).mockClear()
    mocks.balance = exact
    const res = await fromFailed({}, HOP)
    expect(res.statusCode).toBe(202)
    // The set priced is the set the orchestrator runs: c (left in the scope) and n (failed outside it).
    expect(job().nodeIds).toEqual(["c", "n"])
    expect(asked().runNodeIds).toEqual(job().nodeIds)
    // Priced on the states the run is seeded from.
    expect((await asked().continuation!.source())?.id).toBe(HOP)
    expect(stampOf()).toEqual({ from: HOP, root: PRIOR, seededFrom: HOP, all: true, scope: SELECTION })
  })

  it("explicit nodeIds on the root, its newest generation FAILED: priced on the reopened head's leftovers, from its states", async () => {
    // b: HOP completed it (seeded, not priced); n: HOP failed it; m: added since.
    const exact = await priceOf(["n", "m"])
    mocks.balance = exact - 1
    const short = await fromFailed({ nodeIds: ["b", "n", "m"] })
    expect(short.statusCode).toBe(402)
    expect(short.json().error.required).toBe(exact)

    vi.mocked(renderFinalCredits).mockClear()
    mocks.balance = exact
    const res = await fromFailed({ nodeIds: ["b", "n", "m"] })
    expect(res.statusCode).toBe(202)
    expect(job().reopenHead).toBe("failed")
    expect(job().seedFromExecutionId).toBe(HOP)
    expect(job().nodeIds).toEqual(["n", "m"])
    expect(asked().runNodeIds).toEqual(job().nodeIds)
    expect((await asked().continuation!.source())?.id).toBe(HOP)
  })

  it("explicit nodeIds on the root, its newest generation DONE: priced on the reopened head's leftovers, from its states", async () => {
    mocks.executions.length = 0
    const DONE_STAMP = { ...HOP_STAMP, all: true }
    const done = source({
      ...wideHop(),
      status: "completed",
      continueFromFailed: DONE_STAMP,
      nodeStates: {
        ...(wideHop() as unknown as { nodeStates: Record<string, unknown> }).nodeStates,
        c: { status: "completed", startedAt: at, nodeType: "webhook-output", output: {} },
        n: { status: "completed", startedAt: at, nodeType: "add-captions", output: { video: "https://r2.example/n.mp4" } },
      },
    })
    byId({ [PRIOR]: failedRoot(SELECTION), [HOP]: done })
    mocks.executions.push(row(HOP, DONE_STAMP))
    // Everything the head completed is seeded: only m, added since, runs and is priced.
    const exact = await priceOf(["m"])
    expect(exact).toBeGreaterThan(0)
    mocks.balance = exact
    const res = await fromFailed({ nodeIds: ["n", "m"] })
    expect(res.statusCode).toBe(202)
    expect(job().reopenHead).toBe("done")
    expect(job().nodeIds).toEqual(["m"])
    expect(asked().runNodeIds).toEqual(["m"])
    expect((await asked().continuation!.source())?.id).toBe(HOP)
  })
})

// A node named in nodeIds that never ran anywhere in the chain: each run only
// handed it on from its saved data (a placeholder). It runs, and is priced —
// explicit nodeIds always win. One that really ran is still refused as done.
describe("a named node no run of the chain ever ran (the staging case: llm → jp → ct, run on [llm, jp])", () => {
  const LINE = ["llm", "jp"]
  const lineGraph = () => ({
    nodes: [
      { id: "llm", type: "add-captions", data: {} },
      { id: "jp", type: "add-captions", data: {} },
      { id: "ct", type: "add-captions", data: {} },
    ],
    edges: [
      { id: "e1", source: "llm", target: "jp" },
      { id: "e2", source: "jp", target: "ct" },
    ],
  })
  /** Run 1, on [llm, jp], failed at jp: ct, outside it, handed on from its saved data (no start, no job, not seeded). */
  const run1 = () =>
    failedRoot(LINE, {
      nodeStates: {
        llm: { status: "completed", nodeType: "add-captions", jobId: "job-llm", startedAt: at, output: { video: "https://r2.example/llm.mp4" } },
        jp: { status: "failed", nodeType: "add-captions", jobId: "job-jp", startedAt: at, error: "boom" },
        ct: { status: "completed", nodeType: "add-captions", output: { video: "https://r2.example/ct-saved.mp4" }, fromSavedData: true },
      },
    })
  const DONE_STAMP = { from: PRIOR, root: PRIOR, seededFrom: PRIOR, all: true, scope: LINE }
  /** Run 2, the plain resume of run 1: ran jp only, every other node seeded from run 1 by the real seeds. */
  const run2 = async (strip?: (states: Record<string, Record<string, unknown>>) => void) => {
    const { continuationSeeds } = await vi.importActual<typeof import("@/services/workflow-engine/run-continuation.js")>(
      "@/services/workflow-engine/run-continuation.js",
    )
    const seeds = continuationSeeds(lineGraph().nodes as never, run1() as never, new Set(["jp"]))
    const states = Object.fromEntries(seeds) as unknown as Record<string, Record<string, unknown>>
    states.jp = { status: "completed", nodeType: "add-captions", jobId: "job-jp-2", startedAt: at, output: { video: "https://r2.example/jp.mp4" } }
    strip?.(states)
    return source({ id: NEWER, status: "completed", startedAt: at, continueFromFailed: DONE_STAMP, nodeSelection: null, inputOverrides: null, nodeStates: states })
  }
  const withRun2 = async (strip?: Parameters<typeof run2>[0]) => {
    byId({ [PRIOR]: run1(), [NEWER]: await run2(strip) })
    mocks.executions.push(row(NEWER, DONE_STAMP))
  }

  beforeEach(() => {
    mocks.graphOverride = lineGraph()
  })

  it("the seeds the fixture builds on are the real ones: run 2 hands ct on completed, marked as never run, and llm unmarked", async () => {
    const states = ((await run2()) as unknown as { nodeStates: Record<string, Record<string, unknown>> }).nodeStates
    expect(states.ct).toMatchObject({ status: "completed", seededFromExecution: PRIOR, carriedPlaceholder: true })
    expect(states.ct!.startedAt).toBeUndefined()
    expect(states.ct!.jobId).toBeUndefined()
    expect(states.llm).toMatchObject({ status: "completed", seededFromExecution: PRIOR })
    expect(states.llm!.carriedPlaceholder).toBeUndefined()
  })

  it("run 3 names ct: it runs, built on run 2 (llm and jp seeded from it), and the chain stays done", async () => {
    await withRun2()
    const res = await fromFailed({ nodeIds: ["ct"] })
    expect(res.statusCode).toBe(202)
    expect(job().nodeIds).toEqual(["ct"])
    expect(job().namedNodeIds).toEqual(["ct"])
    expect(job().seedFromExecutionId).toBe(NEWER)
    expect(job().reopenHead).toBe("done")
    expect(res.json().continuedFrom).toBe(NEWER)
    expect(stampOf()).toEqual({ from: PRIOR, root: PRIOR, seededFrom: NEWER, all: true, scope: LINE })
  })

  it("without the carried mark (a seed written before it existed) ct reads as completed: refused as done, as before", async () => {
    await withRun2((states) => {
      delete states.ct!.carriedPlaceholder
    })
    const res = await fromFailed({ nodeIds: ["ct"] })
    expect(res.statusCode).toBe(409)
    expect(res.json()).toMatchObject({ error: { code: "continuation_superseded" }, supersededBy: { executionId: NEWER, status: "completed" } })
    expect(mocks.queueAdd).not.toHaveBeenCalled()
  })

  it("the documented way round a seed without the mark: continue the newest completed run with nodeIds alone, and ct runs", async () => {
    await withRun2((states) => {
      delete states.ct!.carriedPlaceholder
    })
    const res = await run({ continueFromExecutionId: NEWER, nodeIds: ["ct"] })
    expect(res.statusCode).toBe(202)
    expect(job().nodeIds).toEqual(["ct"])
    expect(job().continueMode).toBeUndefined()
    expect(stampOf()).toMatchObject({ from: NEWER, root: PRIOR, seededFrom: NEWER, via: "subset" })
  })

  it("a named node that really completed is still refused as done: jp (run 2 ran it), llm (seeded from run 1, which ran it)", async () => {
    await withRun2()
    for (const named of [["jp"], ["llm"], ["llm", "jp"]]) {
      const res = await fromFailed({ nodeIds: named })
      expect(res.statusCode).toBe(409)
      expect(res.json()).toMatchObject({ error: { code: "continuation_superseded" }, supersededBy: { executionId: NEWER, status: "completed" } })
    }
    expect(mocks.inserts).toEqual([])
  })

  it("a plain resume is unchanged: refused as done, ct never run", async () => {
    await withRun2()
    const res = await fromFailed()
    expect(res.statusCode).toBe(409)
    expect(res.json().supersededBy).toEqual({ executionId: NEWER, status: "completed" })
    expect(mocks.inserts).toEqual([])
  })

  it("on run 1 itself (no later run): a plain resume runs only jp; naming ct runs jp (it needs it) and ct", async () => {
    byId({ [PRIOR]: run1() })
    const plain = await fromFailed()
    expect(plain.statusCode).toBe(202)
    expect(job().nodeIds).toEqual(["jp"])
    expect(job().namedNodeIds).toBeUndefined()
    expect(stampOf()!.all).toBe(true)

    mocks.queueAdd.mockClear()
    mocks.inserts.length = 0
    const named = await fromFailed({ nodeIds: ["ct"] })
    expect(named.statusCode).toBe(202)
    expect(job().nodeIds).toEqual(["jp", "ct"])
    expect(job().namedNodeIds).toEqual(["ct"])
    expect(job().seedFromExecutionId).toBeUndefined()
  })

  it("a frozen node is never run by being named: it stays handed on, and nothing is left", async () => {
    const g = lineGraph()
    mocks.graphOverride = { nodes: g.nodes.map((n) => (n.id === "ct" ? { ...n, data: { skipped: true } } : n)), edges: g.edges }
    await withRun2()
    const res = await fromFailed({ nodeIds: ["ct"] })
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe("continuation_superseded")
    expect(mocks.queueAdd).not.toHaveBeenCalled()
  })

  it("a node the run's own overrides freeze is judged as the orchestrator judges it: no work, never priced", async () => {
    await withRun2()
    const res = await fromFailed({ nodeIds: ["ct"], inputOverrides: { ct: { skipped: true } } })
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe("continuation_superseded")
    expect(renderFinalCredits).not.toHaveBeenCalled()
    expect(mocks.queueAdd).not.toHaveBeenCalled()
  })

  describe("the credit check prices the node that now runs", () => {
    const asked = () => vi.mocked(renderFinalCredits).mock.calls[0]![0]
    const priceOf = async (ids: readonly string[]) => {
      const { CreditsService } = await vi.importActual<typeof import("@/ee/billing/credits.js")>("@/ee/billing/credits.js")
      const g = lineGraph()
      return CreditsService.estimateWorkflowBaseCredits(g.nodes as never, g.edges as never, { runNodeIds: new Set(ids) })
    }
    beforeEach(() => {
      vi.mocked(renderFinalCredits).mockImplementation(mocks.realCredits)
    })
    afterEach(() => {
      vi.mocked(renderFinalCredits).mockImplementation(async () => null)
    })

    it("ct is priced: a payer one credit short is refused with 402 before any row exists; with enough, it runs", async () => {
      await withRun2()
      const exact = await priceOf(["ct"])
      expect(exact).toBeGreaterThan(0)
      mocks.balance = exact - 1
      const short = await fromFailed({ nodeIds: ["ct"] })
      expect(short.statusCode).toBe(402)
      expect(short.json().error).toMatchObject({ code: "insufficient_credits", required: exact })
      expect(asked().runNodeIds).toEqual(["ct"])
      expect(mocks.inserts).toEqual([])

      vi.mocked(renderFinalCredits).mockClear()
      mocks.balance = exact
      const res = await fromFailed({ nodeIds: ["ct"] })
      expect(res.statusCode).toBe(202)
      expect(asked().runNodeIds).toEqual(job().nodeIds)
      // Priced on the states the run is seeded from.
      expect((await asked().continuation!.source())?.id).toBe(NEWER)
    })
  })
})

// Every id sent counts as named, but only a node the engine executes can be
// run by being named. A source, a trigger or a parameter node is handed on in
// every run (a placeholder by construction): named, it keeps its seed from
// the earlier execution. A lottie node frozen by its `motionPlan` override is
// seeded from that plan whatever the run set: named alone, nothing is left.
describe("a named node the engine never executes is not taken for work", () => {
  it("from_failed naming every node of a webhook run: only jp runs; the webhook and the picker stay seeded", async () => {
    mocks.graphOverride = {
      nodes: [
        { id: "wh", type: "webhook-trigger", data: { params: [{ id: "p1", name: "clip", type: "videoUrl" }] } },
        { id: "md", type: "mood", data: { mood: "calm" } },
        { id: "jp", type: "add-captions", data: {} },
      ],
      edges: [
        { id: "e1", source: "wh", target: "jp" },
        { id: "e2", source: "md", target: "jp" },
      ],
    }
    byId({
      [PRIOR]: failedRoot(null, {
        nodeStates: {
          wh: { status: "completed", output: { videoUrl: "https://r2.example/hook.mp4" }, fromSavedData: true },
          md: { status: "completed", output: { text: "calm" }, fromSavedData: true },
          jp: { status: "failed", nodeType: "add-captions", jobId: "job-jp", startedAt: at, error: "boom" },
        },
      }),
    })
    const res = await fromFailed({ nodeIds: ["wh", "md", "jp"] })
    expect(res.statusCode).toBe(202)
    expect(job().nodeIds).toEqual(["jp"])
    expect(job().namedNodeIds).toEqual(["jp"])
  })

  describe("a lottie node frozen by the earlier run's pinned motionPlan override", () => {
    const lottieGraph = () => ({
      nodes: [
        { id: "mg", type: "motion-graphics", data: { motionPlan: { planType: "lottie-graphic" } } },
        { id: "jp", type: "add-captions", data: {} },
      ],
      edges: [],
    })
    const root = (pin: Record<string, unknown> | null) =>
      failedRoot(null, {
        inputOverrides: pin,
        nodeStates: {
          // Seeded from its overridden plan, never generated: a placeholder.
          mg: { status: "completed", output: { plan: { planType: "lottie-graphic" } }, fromSavedData: true },
          jp: { status: "failed", nodeType: "add-captions", jobId: "job-jp", startedAt: at, error: "boom" },
        },
      })
    beforeEach(() => {
      mocks.graphOverride = lottieGraph()
    })

    it("naming only it leaves nothing to run: 409, never priced, no row", async () => {
      byId({ [PRIOR]: root({ mg: { motionPlan: { planType: "lottie-graphic", slotValues: { title: "Hi" } } } }) })
      const res = await fromFailed({ nodeIds: ["mg"] })
      expect(res.statusCode).toBe(409)
      expect(res.json().error.code).toBe("continuation_subset_required")
      expect(renderFinalCredits).not.toHaveBeenCalled()
      expect(mocks.inserts).toEqual([])
    })

    it("without the override it is a node of work no run ever ran: named, it runs", async () => {
      byId({ [PRIOR]: root(null) })
      const res = await fromFailed({ nodeIds: ["mg"] })
      expect(res.statusCode).toBe(202)
      expect(job().nodeIds).toEqual(["mg"])
      expect(job().namedNodeIds).toEqual(["mg"])
    })
  })
})

describe("GET /v1/workflow-executions/:id names the run's node scope", () => {
  const get = (id: string) => app.inject({ method: "GET", url: `/v1/workflow-executions/${id}` })
  const stored = (over: Record<string, unknown>) => ({ id: PRIOR, user_id: USER, workflow_id: WORKFLOW, status: "failed", node_states: {}, ...over })

  it("a run started on named nodes: those nodes", async () => {
    mocks.executions.push(stored({ trigger_type: "manual", trigger_data: { nodeSelection: ["a", "b"] } }))
    expect((await get(PRIOR)).json().data.nodeScope).toEqual(["a", "b"])
  })

  it("a generation: its root's scope, carried on its stamp", async () => {
    mocks.executions.push(stored({ trigger_type: "mcp", trigger_data: { continueFromFailed: { from: HOP, root: HOP, all: false, scope: ["c"] } } }))
    expect((await get(PRIOR)).json().data.nodeScope).toEqual(["c"])
  })

  it("a seed's carriedUnfinished mark reaches the editor (the editor predicts the server's set by it)", async () => {
    mocks.executions.push(
      stored({ trigger_type: "manual", trigger_data: null, node_states: { z: { status: "skipped", carriedUnfinished: true, inputs: { big: 1 } } } }),
    )
    expect((await get(PRIOR)).json().data.nodeStates.z).toEqual({ status: "skipped", carriedUnfinished: true })
  })

  it("a run of every node, or a trigger lane's row (its payload is its caller's): null", async () => {
    mocks.executions.push(stored({ trigger_type: "manual", trigger_data: null }))
    expect((await get(PRIOR)).json().data.nodeScope).toBeNull()
    mocks.executions.length = 0
    mocks.executions.push(stored({ trigger_type: "webhook", trigger_data: { nodeSelection: ["a"] } }))
    expect((await get(PRIOR)).json().data.nodeScope).toBeNull()
  })
})
