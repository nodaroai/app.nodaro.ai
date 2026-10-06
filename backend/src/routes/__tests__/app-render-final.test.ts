/**
 * POST /v1/app/:slug/runs/:runId/render-final (Render final in the app runner,
 * decided 2026-10-04): the final of an app run that stopped at a Preview, as a
 * continuation OUTSIDE the run — no creator markup, the app allowance as the
 * pool, the server computing what runs. Every refusal comes before anything is
 * written or billed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

const mocks = vi.hoisted(() => ({
  flag: true,
  queueAdd: vi.fn().mockResolvedValue({}),
  loadSource: vi.fn(),
  eligibility: vi.fn(),
  inserts: [] as Array<Record<string, unknown>>,
  runUpdates: [] as Array<Record<string, unknown>>,
  activeFinal: [] as Array<{ id: string }>,
  /** The run's earlier finals, as `loadAppRunFinals` reads them. */
  priorFinals: [] as Array<Record<string, unknown>>,
  /** The finals read fails (a transient database error). */
  finalsError: null as { message: string } | null,
  /** The filters the finals loader read with. */
  finalsFilters: [] as Array<[string, unknown]>,
  authKind: "jwt" as string,
  run: null as Record<string, unknown> | null,
  version: null as Record<string, unknown> | null,
  slugWorkflow: "wf-1" as string | null,
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
vi.mock("@/lib/preview-stop-rule-flag.js", () => ({ previewStopRuleEnabled: () => mocks.flag }))
vi.mock("@/lib/orchestration-queue.js", () => ({ orchestrationQueue: { add: mocks.queueAdd } }))
vi.mock("@/lib/access-blocks.js", () => ({ isUserBlocked: vi.fn().mockResolvedValue(false) }))
vi.mock("@/middleware/credit-guard.js", () => ({ resolveWebSurfaceFlag: vi.fn().mockResolvedValue(false) }))
vi.mock("@/ee/billing/credits.js", () => ({ CreditsService: { checkAppRunEligibility: mocks.eligibility } }))
vi.mock("@/lib/idempotent-insert.js", () => ({
  insertWithIdempotencyKey: vi.fn(async (_table: string, row: Record<string, unknown>) => {
    mocks.inserts.push(row)
    return { row: { id: FINAL_EXEC }, created: true }
  }),
}))
vi.mock("@/services/workflow-engine/run-continuation.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/workflow-engine/run-continuation.js")>()
  return { ...actual, loadContinuationSource: mocks.loadSource }
})

import { appRenderFinalRoutes } from "../app-render-final.js"
import { supabase } from "../../lib/supabase.js"
import { resetFinalExecutionColumnForTests } from "../../lib/app-run-final-column.js"

const USER = "00000000-0000-4000-8000-000000000001"
const RUN = "00000000-0000-4000-8000-000000000040"
const RUN_EXEC = "00000000-0000-4000-8000-000000000030"
const FINAL_EXEC = "00000000-0000-4000-8000-000000000031"
const VERSION = "00000000-0000-4000-8000-000000000010"

const snapshot = {
  nodes: [
    { id: "rec", type: "upload-video", data: {} },
    { id: "plan", type: "edit-plan", data: { mode: "tighten" } },
    { id: "cut", type: "apply-edl", data: { quality: "proxy" } },
    { id: "cap", type: "add-captions", data: {} },
    { id: "hook", type: "webhook-output", data: { url: "https://creator.example/hook" } },
  ],
  edges: [
    { source: "rec", target: "plan", targetHandle: "video" },
    { source: "plan", target: "cut", targetHandle: "edl" },
    { source: "cut", target: "cap", targetHandle: "video" },
    { source: "cap", target: "hook", targetHandle: "input" },
  ],
}

const previewStates = {
  rec: { status: "completed", output: { videoUrl: "https://r2/rec.mp4" } },
  plan: { status: "completed", output: { json: { segments: [] } } },
  cut: { status: "completed", output: { videoUrl: "https://r2/preview.mp4", quality: "proxy" } },
  cap: { status: "skipped" },
  hook: { status: "skipped" },
}

const source = (over: Record<string, unknown> = {}) => ({
  id: RUN_EXEC,
  userId: USER,
  workflowId: "wf-1",
  status: "completed",
  appVersionId: VERSION,
  inputOverrides: null,
  nodeStates: previewStates,
  ...over,
})

function chain(result: unknown, onUpdate?: (row: Record<string, unknown>) => void) {
  const self: Record<string, unknown> = {}
  const ret = () => self
  for (const m of ["select", "eq", "is", "in", "limit", "order"]) self[m] = ret
  self.maybeSingle = async () => result
  self.single = async () => result
  self.then = (resolve: (v: unknown) => void) => resolve(result)
  self.update = (row: Record<string, unknown>) => {
    onUpdate?.(row)
    return self
  }
  return self
}

function mockTables() {
  vi.mocked(supabase.from).mockImplementation((table: string) => {
    if (table === "app_runs") return chain({ data: mocks.run, error: null }, (row) => mocks.runUpdates.push(row)) as never
    if (table === "published_apps") {
      // The version lookup (by id), or the slug lookup (by slug).
      let bySlug = false
      const self = chain(null)
      self.eq = (column: string) => {
        if (column === "slug") bySlug = true
        return self
      }
      self.maybeSingle = async () =>
        bySlug
          ? { data: mocks.slugWorkflow ? { workflow_id: mocks.slugWorkflow } : null, error: null }
          : { data: mocks.version, error: null }
      return self as never
    }
    if (table === "workflow_executions") {
      // The one-at-a-time check selects the id alone; the finals loader, their states.
      const self = chain({ data: mocks.activeFinal, error: null })
      self.select = (columns: string) => {
        if (columns === "id") return self
        const finals = chain(mocks.finalsError ? { data: null, error: mocks.finalsError } : { data: mocks.priorFinals, error: null })
        finals.eq = (column: string, value: unknown) => {
          mocks.finalsFilters.push([column, value])
          return finals
        }
        return finals
      }
      return self as never
    }
    throw new Error(`unexpected table ${table}`)
  })
}

let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()
  resetFinalExecutionColumnForTests()
  mocks.flag = true
  mocks.inserts.length = 0
  mocks.runUpdates.length = 0
  mocks.activeFinal = []
  mocks.priorFinals = []
  mocks.finalsError = null
  mocks.finalsFilters.length = 0
  mocks.authKind = "jwt"
  mocks.slugWorkflow = "wf-1"
  mocks.run = { id: RUN, app_id: VERSION, execution_id: RUN_EXEC, node_states: null, final_execution_id: null }
  mocks.version = {
    id: VERSION,
    workflow_id: "wf-1",
    creator_id: "creator-1",
    publish_type: "app",
    snapshot_nodes: snapshot.nodes,
    snapshot_edges: snapshot.edges,
  }
  mocks.loadSource.mockResolvedValue(source())
  mocks.eligibility.mockResolvedValue({ allowed: true })
  mockTables()
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    req.userId = USER
    ;(req as { authKind?: string }).authKind = mocks.authKind
  })
  await app.register(appRenderFinalRoutes)
  await app.ready()
})

afterEach(async () => {
  await app.close()
})

const post = (body: Record<string, unknown> = { renderNodeId: "cut", reviewer: "app" }) =>
  app.inject({ method: "POST", url: `/v1/app/my-app/runs/${RUN}/render-final`, payload: body })

describe("Render final of an app run", () => {
  it("continues the run's execution, outside the run: the render at Final, then the nodes after it", async () => {
    const res = await post()
    expect(res.statusCode).toBe(202)
    expect(res.json()).toMatchObject({ executionId: FINAL_EXEC, runId: RUN })
    const job = mocks.queueAdd.mock.calls[0]![1]
    expect(job).toMatchObject({
      executionId: FINAL_EXEC,
      userId: USER,
      triggerType: "app_run",
      // The version the run ran: the continuation's version check, and the app allowance.
      appVersionId: VERSION,
      continueFromExecutionId: RUN_EXEC,
      inputOverrides: { cut: { quality: "final" } },
      reviewerPresent: true,
    })
    // The server computes what runs: the render onward, never the plan before it.
    expect([...job.nodeIds].sort()).toEqual(["cap", "cut", "hook"])
    // A new execution — not a new app run row.
    expect(mocks.inserts[0]).toMatchObject({ user_id: USER, trigger_type: "app_run", status: "pending" })
    // Stamped: the run it finishes, the version, and the execution it continues —
    // what a later final continues from, and how a run finds its chain.
    expect(mocks.inserts[0]).toMatchObject({
      trigger_data: { appRenderFinal: { appRunId: RUN, appVersionId: VERSION, continuedFrom: RUN_EXEC } },
    })
    expect(mocks.runUpdates[0]).toMatchObject({ final_execution_id: FINAL_EXEC })
  })

  it("asks the app allowance first, as an app run does", async () => {
    mocks.eligibility.mockResolvedValue({ allowed: false, error: "no app credits", appCreditsAllowance: 0 })
    const res = await post()
    expect(res.statusCode).toBe(402)
    expect(res.json().error.code).toBe("insufficient_app_credits")
    expect(mocks.queueAdd).not.toHaveBeenCalled()
    expect(mocks.inserts).toHaveLength(0)
  })

  it("carries the run's review of its plan (run-result data); the run's edits stay until the final ends", async () => {
    const review = { v: 1, kind: "edl", basis: "abc", edl: { segments: [], dropped: [] } }
    mocks.run = { ...mocks.run!, node_states: { plan: { editedEdl: review }, cut: { output: { videoUrl: "https://r2/edited-preview.mp4" } } } }
    const res = await post()
    expect(res.statusCode).toBe(202)
    expect(mocks.queueAdd.mock.calls[0]![1].inputOverrides).toEqual({ plan: { editedEdl: review }, cut: { quality: "final" } })
    // Linking writes the final's id alone: a final that fails keeps the
    // preview on show, and the runner's edit of it (decided 2026-10-06).
    expect(mocks.runUpdates[0]).toEqual({ final_execution_id: expect.any(String) })
  })

  it("is refused for a run whose render made a Final: that tail is the creator's, with markup", async () => {
    mocks.loadSource.mockResolvedValue(
      source({ nodeStates: { ...previewStates, cut: { status: "completed", output: { videoUrl: "https://r2/final.mp4", quality: "final" } } } }),
    )
    const res = await post()
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe("render_final_not_preview")
    expect(mocks.queueAdd).not.toHaveBeenCalled()
  })

  describe("a chain continues from the newest final (decided 2026-10-06)", () => {
    // render1 (cut) → captions → render2 (cut2), both at Preview. The run
    // stopped at cut; its final rendered cut, then stopped at cut2's Preview.
    const FIRST = "00000000-0000-4000-8000-000000000032"
    const chainSnapshot = () => ({
      ...mocks.version!,
      snapshot_nodes: [
        ...snapshot.nodes.filter((n) => n.id !== "hook"),
        { id: "cut2", type: "apply-edl", data: { quality: "proxy" } },
        snapshot.nodes.find((n) => n.id === "hook")!,
      ],
      snapshot_edges: [
        ...snapshot.edges.filter((e) => e.target !== "hook"),
        { source: "cap", target: "cut2", targetHandle: "sources" },
        { source: "cut2", target: "hook", targetHandle: "input" },
      ],
    })
    const firstFinalStates = {
      ...previewStates,
      rec: { ...previewStates.rec, seededFromExecution: RUN_EXEC },
      plan: { ...previewStates.plan, seededFromExecution: RUN_EXEC },
      cut: { status: "completed", output: { videoUrl: "https://r2/final.mp4", quality: "final" } },
      cap: { status: "completed", output: { videoUrl: "https://r2/cap.mp4" } },
      cut2: { status: "completed", output: { videoUrl: "https://r2/preview2.mp4", quality: "proxy" } },
      hook: { status: "skipped" },
    }
    const stamp = (continuedFrom: string) => ({ appRenderFinal: { appRunId: RUN, appVersionId: VERSION, continuedFrom } })

    beforeEach(() => {
      mocks.version = chainSnapshot()
      mocks.run = { ...mocks.run!, final_execution_id: FIRST }
      mocks.loadSource.mockImplementation(async (id: string) =>
        id === FIRST
          ? source({ id: FIRST, nodeStates: firstFinalStates })
          : source({ nodeStates: { ...previewStates, cut2: { status: "skipped" } } }),
      )
    })

    it("the second Render final continues from the first final, and runs only the second render onward", async () => {
      mocks.priorFinals = [{ id: FIRST, status: "completed", node_states: firstFinalStates, trigger_data: stamp(RUN_EXEC) }]
      const res = await post({ renderNodeId: "cut2", reviewer: "app" })
      expect(res.statusCode).toBe(202)
      const job = mocks.queueAdd.mock.calls[0]![1]
      expect(job.continueFromExecutionId).toBe(FIRST)
      expect([...job.nodeIds].sort()).toEqual(["cut2", "hook"])
      expect(job.inputOverrides).toEqual({ cut2: { quality: "final" } })
      // The new final names the run, the version and what it continued.
      expect(mocks.inserts[0]).toMatchObject({ trigger_data: stamp(FIRST) })
      expect(mocks.runUpdates[0]).toMatchObject({ final_execution_id: FINAL_EXEC })
      // The chain is read as the run's own execution is (#1930): the runner's, of this app's workflow.
      expect(mocks.finalsFilters).toEqual(expect.arrayContaining([["user_id", USER], ["workflow_id", "wf-1"]]))
    })

    it("the render the first final finished made a Final there: it offers no second final", async () => {
      mocks.priorFinals = [{ id: FIRST, status: "completed", node_states: firstFinalStates, trigger_data: stamp(RUN_EXEC) }]
      const res = await post({ renderNodeId: "cut", reviewer: "app" })
      expect(res.statusCode).toBe(409)
      expect(res.json().error.code).toBe("render_final_not_preview")
      expect(mocks.queueAdd).not.toHaveBeenCalled()
    })

    it("a newest final that failed is not continued: the retry continues from what it continued from", async () => {
      const FAILED = "00000000-0000-4000-8000-000000000033"
      mocks.run = { ...mocks.run!, final_execution_id: FAILED }
      mocks.priorFinals = [
        { id: FAILED, status: "failed", node_states: {}, trigger_data: stamp(FIRST) },
        { id: FIRST, status: "completed", node_states: firstFinalStates, trigger_data: stamp(RUN_EXEC) },
      ]
      const res = await post({ renderNodeId: "cut2", reviewer: "app" })
      expect(res.statusCode).toBe(202)
      expect(mocks.queueAdd.mock.calls[0]![1].continueFromExecutionId).toBe(FIRST)
      expect(mocks.inserts[0]).toMatchObject({ trigger_data: stamp(FIRST) })
    })

    // The case review round 2 named: the newest final rendered cut2 at Final
    // (and made hook's input) before something failed. It is not laid, so the
    // run view shows cut2's Preview from the first final, with Render final on
    // it; this route continues from that same final and accepts it.
    it("a failed newest final that completed its render: the retry continues from the final the view shows", async () => {
      const FAILED = "00000000-0000-4000-8000-000000000033"
      mocks.run = { ...mocks.run!, final_execution_id: FAILED }
      mocks.priorFinals = [
        {
          id: FAILED,
          status: "failed",
          node_states: {
            ...firstFinalStates,
            cut2: { status: "completed", output: { videoUrl: "https://r2/final2.mp4", quality: "final" } },
            hook: { status: "failed", error: "boom" },
          },
          trigger_data: stamp(FIRST),
        },
        { id: FIRST, status: "completed", node_states: firstFinalStates, trigger_data: stamp(RUN_EXEC) },
      ]
      const res = await post({ renderNodeId: "cut2", reviewer: "app" })
      expect(res.statusCode).toBe(202)
      expect(mocks.queueAdd.mock.calls[0]![1].continueFromExecutionId).toBe(FIRST)
    })

    it("a failed read of the run's finals refuses (try again): never a silent restart from the run's own execution", async () => {
      mocks.finalsError = { message: "connection reset" }
      const res = await post({ renderNodeId: "cut2", reviewer: "app" })
      expect(res.statusCode).toBe(503)
      expect(res.json().error.code).toBe("run_finals_unavailable")
      expect(mocks.loadSource).not.toHaveBeenCalled()
      expect(mocks.inserts).toHaveLength(0)
      expect(mocks.runUpdates).toHaveLength(0)
    })

    it("a linked final that is not there (read fine) leaves the run's own execution to continue", async () => {
      mocks.priorFinals = []
      const res = await post({ renderNodeId: "cut", reviewer: "app" })
      expect(res.statusCode).toBe(202)
      expect(mocks.queueAdd.mock.calls[0]![1].continueFromExecutionId).toBe(RUN_EXEC)
    })

    it("one render at a time: the chain's newest final still rendering refuses the next", async () => {
      mocks.priorFinals = [{ id: FIRST, status: "running", node_states: {}, trigger_data: stamp(RUN_EXEC) }]
      const res = await post({ renderNodeId: "cut2", reviewer: "app" })
      expect(res.statusCode).toBe(409)
      expect(res.json()).toMatchObject({ error: { code: "already_running" }, executionId: FIRST })
      expect(mocks.inserts).toHaveLength(0)
    })
  })

  it("never for a component: a nested graph has no Render final (permanent)", async () => {
    mocks.version = { ...mocks.version!, publish_type: "component" }
    const res = await post()
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("preview_render_nested")
  })

  it("only for a render node", async () => {
    const res = await post({ renderNodeId: "cap", reviewer: "app" })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("not_a_render")
  })

  it("one final at a time", async () => {
    mocks.run = { ...mocks.run!, final_execution_id: FINAL_EXEC }
    mocks.priorFinals = [{ id: FINAL_EXEC, status: "running", node_states: {} }]
    const res = await post()
    expect(res.statusCode).toBe(409)
    expect(res.json()).toMatchObject({ error: { code: "already_running" }, executionId: FINAL_EXEC })
  })

  it("a run with no execution yet (a draft) cannot be finished", async () => {
    mocks.run = { ...mocks.run!, execution_id: null }
    const res = await post()
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe("continuation_not_completed")
  })

  it("someone else's run, or a run under another app's slug, is not found", async () => {
    mocks.run = null
    expect((await post()).statusCode).toBe(404)
    mocks.run = { id: RUN, app_id: VERSION, execution_id: RUN_EXEC, node_states: null }
    mocks.slugWorkflow = "wf-other"
    expect((await post()).statusCode).toBe(404)
  })

  it("the continuation's own checks still hold (a run that has not completed)", async () => {
    mocks.loadSource.mockResolvedValue(source({ status: "running" }))
    const res = await post()
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe("continuation_not_completed")
  })

  describe("with the preview stop rule off it re-renders at Final, like the editor's (decided 2026-10-06)", () => {
    beforeEach(() => {
      mocks.flag = false
    })

    it("a run whose render made a Preview: the render at Final, then the nodes after it", async () => {
      const res = await post()
      expect(res.statusCode).toBe(202)
      const job = mocks.queueAdd.mock.calls[0]![1]
      expect(job).toMatchObject({ continueFromExecutionId: RUN_EXEC, inputOverrides: { cut: { quality: "final" } } })
      expect([...job.nodeIds].sort()).toEqual(["cap", "cut", "hook"])
    })

    it("a run whose render already made a Final is re-rendered too: nothing waited for it", async () => {
      mocks.loadSource.mockResolvedValue(
        source({ nodeStates: { ...previewStates, cut: { status: "completed", output: { videoUrl: "https://r2/final.mp4", quality: "final" } } } }),
      )
      const res = await post()
      expect(res.statusCode).toBe(202)
      expect(mocks.queueAdd.mock.calls[0]![1].continueFromExecutionId).toBe(RUN_EXEC)
    })

    it("no stop rule, so nothing asks who is there to review a Preview further on", async () => {
      mocks.version = {
        ...mocks.version!,
        snapshot_nodes: [...snapshot.nodes.slice(0, 3), { id: "cut2", type: "apply-edl", data: { quality: "proxy" } }],
        snapshot_edges: [...snapshot.edges.slice(0, 2), { source: "cut", target: "cut2", targetHandle: "video" }],
      }
      const res = await post({ renderNodeId: "cut" })
      expect(res.statusCode).toBe(202)
    })

    it("the refusals that are not the stop rule's still hold", async () => {
      expect((await post({ renderNodeId: "cap" })).json().error.code).toBe("not_a_render")
      mocks.loadSource.mockResolvedValue(source({ status: "running" }))
      expect((await post()).json().error.code).toBe("continuation_not_completed")
    })
  })

  describe("who is there to review a Preview further on", () => {
    const twoRenders = {
      nodes: [...snapshot.nodes.slice(0, 3), { id: "cut2", type: "apply-edl", data: { quality: "proxy" } }],
      edges: [...snapshot.edges.slice(0, 2), { source: "cut", target: "cut2", targetHandle: "video" }],
    }

    it("without the app runner's mark, a final that would stop at another Preview is refused", async () => {
      mocks.version = { ...mocks.version!, snapshot_nodes: twoRenders.nodes, snapshot_edges: twoRenders.edges }
      const res = await post({ renderNodeId: "cut" })
      expect(res.statusCode).toBe(400)
      expect(res.json().error.code).toBe("preview_review_required")
    })

    it("from the app runner it stops there, with that render's own Render final", async () => {
      mocks.version = { ...mocks.version!, snapshot_nodes: twoRenders.nodes, snapshot_edges: twoRenders.edges }
      const res = await post({ renderNodeId: "cut", reviewer: "app" })
      expect(res.statusCode).toBe(202)
      expect(mocks.queueAdd.mock.calls[0]![1].reviewerPresent).toBe(true)
    })

    it("an API token is never a reviewer, mark or not", async () => {
      mocks.authKind = "api_token"
      mocks.version = { ...mocks.version!, snapshot_nodes: twoRenders.nodes, snapshot_edges: twoRenders.edges }
      expect((await post({ renderNodeId: "cut", reviewer: "app" })).statusCode).toBe(400)
    })
  })
})
