/**
 * POST /v1/workflows/:id/run: the subset continuations of a continue-from-failed
 * lineage (a Render final, or a run of named nodes) and a lineage whose newest
 * generation stopped at a Preview review (review round 3: I1 is the
 * orchestrator's; M1 and M2 here).
 *
 * - A subset continuation of the lineage's NEWEST generation joins it: stamped
 *   `via: "subset"`, `from` = `seededFrom` = that generation, `all` when the
 *   generation ran all that was left or this run takes on everything it did
 *   not complete and stops at no Preview. One of an older generation, or of a
 *   run of no lineage, is not stamped.
 * - A generation that stops at a Preview review names its Apply EDL renders
 *   (`previewRenders`); a continue-from-failed whose newest generation is such
 *   a completed run is refused `409 continuation_preview_pending`, naming it
 *   and the render — its Render final is the next step.
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

// A Render final checks its payer's balance first (its own tests); here it is covered.
vi.mock("@/lib/render-final-run.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/render-final-run.js")>()
  return { ...actual, renderFinalCredits: vi.fn(async () => null) }
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

const LATER = "00000000-0000-4000-8000-000000000063"
const NEWER = "00000000-0000-4000-8000-000000000064"
const at = "2026-10-17T11:00:00.000Z"

/** A generation's row, as the lineage read sees it. */
const row = (id: string, stamp: Record<string, unknown>, over: Record<string, unknown> = {}) => ({
  id,
  user_id: USER,
  workflow_id: WORKFLOW,
  status: "completed",
  started_at: at,
  created_at: at,
  trigger_type: "manual",
  trigger_data: { continueFromFailed: stamp },
  ...over,
})
/** The failed root A: the plan done, the render never run. */
const rootA = () =>
  source({
    status: "failed",
    startedAt: "2026-10-17T10:00:00.000Z",
    continueFromFailed: null,
    inputOverrides: null,
    nodeStates: { plan: { status: "completed", nodeType: "edit-plan", output: { json: {} } } },
  })
/** X: a continue-from-failed of A (the editor's) that ran the rest and stopped at the render's Preview. */
const X_STAMP = { from: PRIOR, root: PRIOR, seededFrom: PRIOR, all: false, previewRenders: ["cut"] }
const stoppedX = (over: Record<string, unknown> = {}, states: Record<string, unknown> = {}) =>
  source({
    id: LATER,
    startedAt: at,
    continueFromFailed: X_STAMP,
    inputOverrides: null,
    nodeStates: {
      plan: { status: "completed", nodeType: "edit-plan", output: { json: {} }, seededFromExecution: PRIOR },
      cut: { status: "completed", nodeType: "apply-edl", output: { video: "https://r2.example/preview.mp4", quality: "proxy" } },
      cap: { status: "skipped", nodeType: "add-captions" },
      hook: { status: "completed", nodeType: "webhook-output", output: {} },
      ...states,
    },
    ...over,
  })
/** The loader by id; a read without the states returns none, as the real one does. */
const byId = (rows: Record<string, unknown>) =>
  mocks.loadSource.mockImplementation(async (id: string, opts?: { withStates?: boolean }) => {
    const found = rows[id] as Record<string, unknown> | undefined
    if (!found) return null
    if (opts?.withStates !== false) return found
    const { nodeStates: _states, ...rest } = found
    return rest
  })
const stampOf = () => (mocks.inserts[0]!.trigger_data as { continueFromFailed?: Record<string, unknown> } | undefined)?.continueFromFailed
const jobOf = () => mocks.queueAdd.mock.calls[0]![1] as Record<string, unknown>

describe("a continue-from-failed whose newest generation stopped at a Preview review", () => {
  beforeEach(() => {
    byId({ [PRIOR]: rootA(), [LATER]: stoppedX() })
    mocks.executions.push(row(LATER, X_STAMP))
  })

  it("is refused 409 continuation_preview_pending, naming that run and its render, before any row exists", async () => {
    const res = await run({ continueFromExecutionId: PRIOR, continueMode: "from-failed" })
    expect(res.statusCode).toBe(409)
    const body = res.json()
    expect(body.error.code).toBe("continuation_preview_pending")
    expect(body.executionId).toBe(LATER)
    expect(body.renderNodeIds).toEqual(["cut"])
    // The message is the remedy: the Render final of that run.
    expect(body.error.message).toContain(LATER)
    expect(body.error.message).toContain('renderFinal: { renderNodeId: "cut" }')
    expect(mocks.inserts).toEqual([])
    expect(mocks.queueAdd).not.toHaveBeenCalled()
  })

  it("the editor's run too: it would only stop at the same Preview again", async () => {
    mocks.authKind = "jwt"
    const res = await run({ continueFromExecutionId: PRIOR, continueMode: "from-failed", reviewer: "editor" })
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe("continuation_preview_pending")
  })

  it("a stamp from before `previewRenders` existed keeps the earlier reading: built on", async () => {
    mocks.executions.length = 0
    mocks.executions.push(row(LATER, { from: PRIOR, root: PRIOR, seededFrom: PRIOR, all: false }))
    mocks.authKind = "jwt"
    const res = await run({ continueFromExecutionId: PRIOR, continueMode: "from-failed", reviewer: "editor" })
    expect(res.statusCode).toBe(202)
    expect(jobOf().seedFromExecutionId).toBe(LATER)
  })

  it("a continue-from-failed that stops at a Preview names the render on its own stamp", async () => {
    mocks.executions.length = 0
    mocks.authKind = "jwt"
    const res = await run({ continueFromExecutionId: PRIOR, continueMode: "from-failed", reviewer: "editor" })
    expect(res.statusCode).toBe(202)
    expect(stampOf()).toEqual({ from: PRIOR, root: PRIOR, seededFrom: PRIOR, all: false, previewRenders: ["cut"] })
  })

  it("one that renders the final stops at none: no `previewRenders`, all", async () => {
    mocks.executions.length = 0
    const res = await run({ continueFromExecutionId: PRIOR, continueMode: "from-failed", inputOverrides: { cut: { quality: "final" } } })
    expect(res.statusCode).toBe(202)
    expect(stampOf()).toEqual({ from: PRIOR, root: PRIOR, seededFrom: PRIOR, all: true })
  })
})

describe("a Render final of the lineage's newest generation joins the lineage (M1)", () => {
  beforeEach(() => {
    byId({ [PRIOR]: rootA(), [LATER]: stoppedX() })
    mocks.executions.push(row(LATER, X_STAMP))
  })

  it("stamped from that generation; all — its Preview was the only thing left", async () => {
    const res = await run({ renderFinal: { renderNodeId: "cut" }, continueFromExecutionId: LATER })
    expect(res.statusCode).toBe(202)
    expect(stampOf()).toEqual({ from: LATER, root: PRIOR, seededFrom: LATER, all: true, via: "subset" })
    // Still a subset continuation: no mode, no seed id, no `continuedFrom`.
    expect(jobOf().continueFromExecutionId).toBe(LATER)
    expect(jobOf().continueMode).toBeUndefined()
    expect(jobOf().seedFromExecutionId).toBeUndefined()
    expect(res.json().continuedFrom).toBeUndefined()
  })

  it("once it is the newest and completed, continuing A is refused as done (it is the run to read)", async () => {
    mocks.executions.push(row(NEWER, { from: LATER, root: PRIOR, seededFrom: LATER, all: true, via: "subset" }, { created_at: "2026-10-17T12:00:00.000Z" }))
    const res = await run({ continueFromExecutionId: PRIOR, continueMode: "from-failed" })
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe("continuation_superseded")
    expect(res.json().supersededBy).toEqual({ executionId: NEWER, status: "completed" })
  })

  it("a generation that was narrow too (it left the hook): the final is not all, and is built on later", async () => {
    byId({ [PRIOR]: rootA(), [LATER]: stoppedX({}, { hook: { status: "skipped", nodeType: "webhook-output", seededFromExecution: PRIOR } }) })
    const res = await run({ renderFinal: { renderNodeId: "cut" }, continueFromExecutionId: LATER })
    expect(res.statusCode).toBe(202)
    expect(stampOf()).toEqual({ from: LATER, root: PRIOR, seededFrom: LATER, all: false, via: "subset" })
  })

  it("an editor-marked continuation of it reads its states (they decide `all`)", async () => {
    mocks.authKind = "jwt"
    const res = await run({ nodeIds: ["cut", "cap"], inputOverrides: { cut: { quality: "final" } }, continueFromExecutionId: LATER, reviewer: "editor" })
    expect(res.statusCode).toBe(202)
    expect(mocks.loadSource).toHaveBeenCalledWith(LATER, expect.objectContaining({ withStates: false, withPin: true }))
    expect(mocks.loadSource).toHaveBeenCalledWith(LATER, expect.objectContaining({ withStates: true }))
    expect(stampOf()).toMatchObject({ from: LATER, via: "subset", all: true })
  })

  it("a final that stops at another Preview further on names it, and is not all", async () => {
    mocks.graphOverride = {
      nodes: [...(stoppedXGraph().nodes)],
      edges: stoppedXGraph().edges,
    }
    mocks.authKind = "jwt"
    const res = await run({ nodeIds: ["cut", "cap", "cut2"], inputOverrides: { cut: { quality: "final" } }, continueFromExecutionId: LATER, reviewer: "editor" })
    expect(res.statusCode).toBe(202)
    expect(stampOf()).toEqual({ from: LATER, root: PRIOR, seededFrom: LATER, all: false, via: "subset", previewRenders: ["cut2"] })
  })
})

/** The default graph with a second render at Preview after the captions. */
function stoppedXGraph() {
  return {
    nodes: [
      { id: "plan", type: "edit-plan", data: {} },
      { id: "cut", type: "apply-edl", data: { quality: "proxy" } },
      { id: "cap", type: "add-captions", data: {} },
      { id: "cut2", type: "apply-edl", data: { quality: "proxy" } },
      { id: "out", type: "add-captions", data: {} },
      { id: "hook", type: "webhook-output", data: { url: "https://mine.example/hook" } },
    ],
    edges: [
      { id: "e1", source: "plan", target: "cut" },
      { id: "e2", source: "cut", target: "cap" },
      { id: "e3", source: "cap", target: "cut2" },
      { id: "e4", source: "cut2", target: "out" },
    ],
  }
}

describe("a plain subset continuation of the newest generation joins too (M2)", () => {
  /** B: a narrow continue-from-failed of A that completed the captions branch and left the hook. */
  const B_STAMP = { from: PRIOR, root: PRIOR, seededFrom: PRIOR, all: false }
  const narrowB = () =>
    source({
      id: LATER,
      startedAt: at,
      continueFromFailed: B_STAMP,
      inputOverrides: null,
      nodeStates: {
        plan: { status: "completed", nodeType: "edit-plan", output: { json: {} } },
        cut: { status: "completed", nodeType: "apply-edl", output: { video: "https://r2.example/cut.mp4", quality: "final" } },
        cap: { status: "completed", nodeType: "add-captions", output: { video: "https://r2.example/cap.mp4" } },
        hook: { status: "skipped", nodeType: "webhook-output", seededFromExecution: PRIOR },
      },
    })

  beforeEach(() => {
    byId({ [PRIOR]: rootA(), [LATER]: narrowB() })
    mocks.executions.push(row(LATER, B_STAMP))
  })

  it("a run of what B left is stamped, all: a later continue-from-failed of A sees it", async () => {
    const res = await run({ nodeIds: ["hook"], continueFromExecutionId: LATER })
    expect(res.statusCode).toBe(202)
    expect(stampOf()).toEqual({ from: LATER, root: PRIOR, seededFrom: LATER, all: true, via: "subset" })
  })

  it("a run of part of it: stamped, not all", async () => {
    const res = await run({ nodeIds: ["cap"], continueFromExecutionId: LATER })
    expect(res.statusCode).toBe(202)
    expect(stampOf()).toEqual({ from: LATER, root: PRIOR, seededFrom: LATER, all: false, via: "subset" })
  })

  it("a generation that ran all that was left keeps the lineage done, whatever this run takes on", async () => {
    const DONE = { from: PRIOR, root: PRIOR, seededFrom: PRIOR, all: true }
    byId({ [PRIOR]: rootA(), [LATER]: { ...narrowB(), continueFromFailed: DONE } })
    mocks.executions.length = 0
    mocks.executions.push(row(LATER, DONE))
    const res = await run({ nodeIds: ["cap"], continueFromExecutionId: LATER })
    expect(res.statusCode).toBe(202)
    expect(stampOf()).toMatchObject({ via: "subset", all: true })
  })

  it("of an OLDER generation (a newer one exists): not stamped — the newest keeps holding the lineage's progress", async () => {
    mocks.executions.push(row(NEWER, { from: PRIOR, root: PRIOR, seededFrom: LATER, all: false }, { created_at: "2026-10-17T12:00:00.000Z" }))
    const res = await run({ nodeIds: ["hook"], continueFromExecutionId: LATER })
    expect(res.statusCode).toBe(202)
    // Outside the lineage, it is a run of its own: it records only the nodes it was started on.
    expect(mocks.inserts[0]!.trigger_data).toEqual({ nodeSelection: ["hook"] })
  })

  it("of a run of no lineage: not stamped, and no lineage read", async () => {
    mocks.loadSource.mockResolvedValue(source({ nodeStates: {} }))
    const res = await run({ nodeIds: ["hook"], continueFromExecutionId: PRIOR })
    expect(res.statusCode).toBe(202)
    expect(mocks.inserts[0]!.trigger_data).toEqual({ nodeSelection: ["hook"] })
    expect(mocks.lineageCalls).toEqual([])
  })
})

// Fix round 5 (decided 2026-10-18).
describe("a newest generation held by a Tighten Episode review: refused, naming the run that finishes it", () => {
  const OLDER = "00000000-0000-4000-8000-000000000065"
  const WRAP_H = "00000000-0000-4000-8000-0000000000a1"
  /** rec → T (review on) → cap; the hook on its own. */
  const reviewGraph = () => ({
    nodes: [
      { id: "rec", type: "upload-video", data: { url: "https://r2.example/ep.mp4" } },
      { id: "t", type: "tighten-episode", data: { reviewBeforeRender: true } },
      { id: "cap", type: "add-captions", data: {} },
      { id: "hook", type: "webhook-output", data: { url: "https://mine.example/hook" } },
    ],
    edges: [
      { id: "e1", source: "rec", target: "t", targetHandle: "media" },
      { id: "e2", source: "t", target: "cap" },
    ],
  })
  const rootWithT = () =>
    source({
      status: "failed",
      startedAt: "2026-10-17T10:00:00.000Z",
      continueFromFailed: null,
      inputOverrides: null,
      nodeStates: {
        rec: { status: "completed", output: { videoUrl: "https://r2.example/ep.mp4" }, fromSavedData: true },
        t: { status: "failed", nodeType: "tighten-episode", jobId: "00000000-0000-4000-8000-0000000000a0", error: "Apply Cut failed" },
        hook: { status: "completed", nodeType: "webhook-output", output: {} },
      },
    })
  const H_STAMP = { from: PRIOR, root: PRIOR, seededFrom: PRIOR, all: false, reviewHolds: ["t"] }
  /** H: the editor's continue-from-failed of A, stopped at T's Preview. */
  const heldH = (t: Record<string, unknown> = {}) =>
    source({
      id: LATER,
      startedAt: at,
      continueFromFailed: H_STAMP,
      inputOverrides: null,
      nodeStates: {
        rec: { status: "completed", output: { videoUrl: "https://r2.example/ep.mp4" }, seededFromExecution: PRIOR },
        t: { status: "completed", nodeType: "tighten-episode", jobId: WRAP_H, output: { videoUrl: "https://r2.example/ep-preview.mp4", quality: "proxy" }, ...t },
        cap: { status: "skipped", nodeType: "add-captions" },
        hook: { status: "completed", nodeType: "webhook-output", output: {}, seededFromExecution: PRIOR },
      },
    })
  const NEXT = {
    continueFromExecutionId: LATER,
    nodeIds: ["t", "cap"],
    inputOverrides: { t: { useCaseContinue: { mode: "render-final", jobId: WRAP_H } } },
  }

  beforeEach(() => {
    mocks.graphOverride = reviewGraph()
    byId({ [PRIOR]: rootWithT(), [LATER]: heldH() })
  })

  it("a continue-from-failed that stops at the review records it on its stamp (reviewHolds), never all", async () => {
    mocks.authKind = "jwt"
    const res = await run({ continueFromExecutionId: PRIOR, continueMode: "from-failed", reviewer: "editor" })
    expect(res.statusCode).toBe(202)
    expect(stampOf()).toEqual({ from: PRIOR, root: PRIOR, seededFrom: PRIOR, all: false, reviewHolds: ["t"] })
  })

  it("continuing A once it is the newest: 409 continuation_preview_pending naming H, the node, and the run that finishes it", async () => {
    mocks.executions.push(row(LATER, H_STAMP))
    const res = await run({ continueFromExecutionId: PRIOR, continueMode: "from-failed" })
    expect(res.statusCode).toBe(409)
    const body = res.json()
    expect(body.error.code).toBe("continuation_preview_pending")
    expect(body.executionId).toBe(LATER)
    expect(body.renderNodeIds).toEqual([])
    expect(body.reviewNodeIds).toEqual(["t"])
    // T continuing the run that made its Preview, at Final, and every node after it.
    expect(body.next).toEqual(NEXT)
    expect(body.error.message).toContain(LATER)
    expect(body.error.message).toContain('the review of "t"')
    // What that run calls for T is T's own continue route, at Final; calling it alone first is warned against.
    expect(body.error.message).toContain('POST /v1/tighten-episode/continue, "mode": "render-final"')
    expect(body.error.message).toContain("render_final_already_rendered")
    expect(body.error.message).not.toContain("renderFinal: {")
    expect(mocks.inserts).toEqual([])
  })

  it("a T seeded into H from an earlier generation: the run is named from the generation that made the Preview", async () => {
    byId({
      [PRIOR]: rootWithT(),
      [LATER]: heldH({ jobId: undefined, seededFromExecution: OLDER }),
      [OLDER]: source({ id: OLDER, nodeStates: { t: { status: "completed", nodeType: "tighten-episode", jobId: WRAP_H, output: { quality: "proxy" } } } }),
    })
    mocks.executions.push(row(LATER, H_STAMP))
    const res = await run({ continueFromExecutionId: PRIOR, continueMode: "from-failed" })
    expect(res.json().next.inputOverrides).toEqual(NEXT.inputOverrides)
  })

  it("the run named in `next` is accepted for an API caller and finishes the lineage; continuing A after it is refused as done, not held again", async () => {
    mocks.executions.push(row(LATER, H_STAMP))
    const res = await run(NEXT)
    expect(res.statusCode).toBe(202)
    expect(stampOf()).toEqual({ from: LATER, root: PRIOR, seededFrom: LATER, all: true, via: "subset" })
    mocks.executions.push(row(NEWER, stampOf()!, { created_at: "2026-10-17T12:00:00.000Z" }))
    const after = await run({ continueFromExecutionId: PRIOR, continueMode: "from-failed" })
    expect(after.statusCode).toBe(409)
    expect(after.json().error.code).toBe("continuation_superseded")
    expect(after.json().supersededBy).toEqual({ executionId: NEWER, status: "completed" })
  })
})

describe("two held renders feeding one node (M3-r4)", () => {
  const twoRenders = () => ({
    nodes: [
      { id: "plan", type: "edit-plan", data: {} },
      { id: "cut1", type: "apply-edl", data: { quality: "proxy" } },
      { id: "cut2", type: "apply-edl", data: { quality: "proxy" } },
      { id: "cap", type: "combine-videos", data: {} },
    ],
    edges: [
      { id: "e1", source: "plan", target: "cut1" },
      { id: "e2", source: "plan", target: "cut2" },
      { id: "e3", source: "cut1", target: "cap" },
      { id: "e4", source: "cut2", target: "cap" },
    ],
  })
  const STAMP = { from: PRIOR, root: PRIOR, seededFrom: PRIOR, all: false, previewRenders: ["cut1", "cut2"] }
  const held = () =>
    source({
      id: LATER,
      startedAt: at,
      continueFromFailed: STAMP,
      inputOverrides: null,
      nodeStates: {
        plan: { status: "completed", nodeType: "edit-plan", output: { json: {} } },
        cut1: { status: "completed", nodeType: "apply-edl", output: { video: "https://r2.example/p1.mp4", quality: "proxy" } },
        cut2: { status: "completed", nodeType: "apply-edl", output: { video: "https://r2.example/p2.mp4", quality: "proxy" } },
        cap: { status: "skipped", nodeType: "combine-videos" },
      },
    })

  beforeEach(() => {
    mocks.graphOverride = twoRenders()
    byId({ [PRIOR]: rootA(), [LATER]: held() })
    mocks.executions.push(row(LATER, STAMP))
  })

  it("the 409 names every render, and one run finishing both together (not renderFinal)", async () => {
    const res = await run({ continueFromExecutionId: PRIOR, continueMode: "from-failed" })
    expect(res.statusCode).toBe(409)
    const body = res.json()
    expect(body.renderNodeIds).toEqual(["cut1", "cut2"])
    expect(body.next).toEqual({
      continueFromExecutionId: LATER,
      nodeIds: ["cut1", "cut2", "cap"],
      inputOverrides: { cut1: { quality: "final" }, cut2: { quality: "final" } },
    })
    expect(body.error.message).toContain('renders "cut1", "cut2"')
    expect(body.error.message).not.toContain("renderFinal: {")
  })

  it("why: a Render final of one alone runs the shared node on the other's Preview — refused for an API caller", async () => {
    const res = await run({ renderFinal: { renderNodeId: "cut1" }, continueFromExecutionId: LATER })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("preview_review_required")
  })

  it("the run in `next` is accepted and finishes the lineage", async () => {
    const res = await run((await run({ continueFromExecutionId: PRIOR, continueMode: "from-failed" })).json().next)
    expect(res.statusCode).toBe(202)
    expect(stampOf()).toEqual({ from: LATER, root: PRIOR, seededFrom: LATER, all: true, via: "subset" })
  })
})

describe("a subset continuation keeps the holds it leaves standing (M2-r4), and is never all while held (M4-r4)", () => {
  beforeEach(() => {
    byId({ [PRIOR]: rootA(), [LATER]: stoppedX({}, { hook: { status: "skipped", nodeType: "webhook-output", seededFromExecution: PRIOR } }) })
    mocks.executions.push(row(LATER, X_STAMP))
  })

  it("a run of another branch of a Preview-held generation carries its renders; continuing A then names the new newest", async () => {
    // The held render ends its branch: nothing this run executes reads it, so
    // the run's own stop rule does not name it — only the carry keeps it held.
    mocks.graphOverride = { nodes: graph.nodes, edges: [graph.edges[0]!] }
    const res = await run({ nodeIds: ["hook"], continueFromExecutionId: LATER })
    expect(res.statusCode).toBe(202)
    expect(stampOf()).toEqual({ from: LATER, root: PRIOR, seededFrom: LATER, all: false, via: "subset", previewRenders: ["cut"] })
    mocks.executions.push(row(NEWER, stampOf()!, { created_at: "2026-10-17T12:00:00.000Z" }))
    const after = await run({ continueFromExecutionId: PRIOR, continueMode: "from-failed" })
    expect(after.statusCode).toBe(409)
    expect(after.json()).toMatchObject({ error: { code: "continuation_preview_pending" }, executionId: NEWER, renderNodeIds: ["cut"] })
  })

  it("the Render final of the carried render, continuing the new newest, finishes it", async () => {
    const CARRIED = { from: LATER, root: PRIOR, seededFrom: LATER, all: false, via: "subset", previewRenders: ["cut"] }
    byId({
      [PRIOR]: rootA(),
      [NEWER]: stoppedX({ id: NEWER, continueFromFailed: CARRIED }, { hook: { status: "completed", nodeType: "webhook-output", output: {} } }),
    })
    mocks.executions.push(row(NEWER, CARRIED, { created_at: "2026-10-17T12:00:00.000Z" }))
    const res = await run({ renderFinal: { renderNodeId: "cut" }, continueFromExecutionId: NEWER })
    expect(res.statusCode).toBe(202)
    expect(stampOf()).toEqual({ from: NEWER, root: PRIOR, seededFrom: NEWER, all: true, via: "subset" })
  })

  it("a subset run of a generation that ran all that was left, which itself stops at a Preview: not all", async () => {
    const DONE = { from: PRIOR, root: PRIOR, seededFrom: PRIOR, all: true }
    byId({ [PRIOR]: rootA(), [LATER]: stoppedX({ continueFromFailed: DONE }, { cut: { status: "completed", nodeType: "apply-edl", output: { quality: "final" } } }) })
    mocks.executions.length = 0
    mocks.executions.push(row(LATER, DONE))
    mocks.authKind = "jwt"
    const res = await run({ nodeIds: ["cut", "cap"], inputOverrides: { cut: { quality: "proxy" } }, continueFromExecutionId: LATER, reviewer: "editor" })
    expect(res.statusCode).toBe(202)
    expect(stampOf()).toEqual({ from: LATER, root: PRIOR, seededFrom: LATER, all: false, via: "subset", previewRenders: ["cut"] })
  })
})
