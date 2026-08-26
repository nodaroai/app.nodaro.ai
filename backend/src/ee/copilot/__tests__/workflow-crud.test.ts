/**
 * `get_workflow_graph` and `create_workflow`.
 *
 * Both are thin on purpose — they re-point machinery that already exists — so
 * what is worth pinning is not their logic but the four properties that make
 * that thinness safe: the read is scoped to the caller AND the project, the
 * create takes no project/user/settings from the model, the build goes through
 * the ordinary writer, and neither can be talked into unbounded use.
 */
import { describe, expect, it, vi, beforeEach } from "vitest"

const state = vi.hoisted(() => ({
  /** Every filter applied to a `workflows` query, in order. */
  filters: [] as Array<[string, unknown]>,
  /** The row `insert()` was handed. */
  inserted: null as Record<string, unknown> | null,
  lookup: { data: null as unknown, error: null as unknown },
  getGraphCalls: [] as string[],
  editCalls: [] as Array<{ workflowId: string; args: Record<string, unknown> }>,
  /** Set when the row is rolled back. */
  deleted: false,
  /** When set, step 2 throws it. */
  editThrows: null as Error | null,
}))

function chain(table: string) {
  const c: Record<string, unknown> = {}
  for (const m of ["select", "order", "limit"]) c[m] = vi.fn(() => c)
  c.eq = vi.fn((col: string, value: unknown) => {
    if (table === "workflows") state.filters.push([col, value])
    return c
  })
  c.insert = vi.fn((row: Record<string, unknown>) => {
    state.inserted = row
    return c
  })
  c.delete = vi.fn(() => {
    state.deleted = true
    return c
  })
  c.maybeSingle = vi.fn(async () => state.lookup)
  c.single = vi.fn(async () => ({ data: { id: "wf-new", name: state.inserted?.name }, error: null }))
  return c
}

vi.mock("../../../lib/supabase.js", () => ({ supabase: { from: (t: string) => chain(t) } }))
vi.mock("../tools/get-graph.js", () => ({
  runGetGraph: async (ctx: { workflowId: string }) => {
    state.getGraphCalls.push(ctx.workflowId)
    return JSON.stringify({ name: "graph of " + ctx.workflowId })
  },
}))
vi.mock("../tools/edit-workflow.js", () => ({
  runEditWorkflow: async (ctx: { workflowId: string }, args: Record<string, unknown>) => {
    state.editCalls.push({ workflowId: ctx.workflowId, args })
    if (state.editThrows) throw state.editThrows
    return { addedNodeIds: ["n1"], updatedNodeIds: [], removedNodeIds: [], addedNodeTypes: ["generate-image"], wiredAssets: [], nodeCount: 1, edgeCount: 0, version: 2, updatedAt: "now", adjustments: [] }
  },
}))

const { runGetWorkflowGraph, runCreateWorkflow } = await import("../tools/workflow-crud.js")

const ctx = {
  userId: "u1",
  workflowId: "wf-open",
  projectId: "p1",
  threadId: "t1",
  turnId: "turn1",
  allowPublishing: false,
  userLinks: new Set<string>(),
  fastify: {} as never,
  emit: vi.fn(),
} as never as Parameters<typeof runGetWorkflowGraph>[0]

beforeEach(() => {
  state.filters = []
  state.inserted = null
  state.lookup = { data: null, error: null }
  state.getGraphCalls = []
  state.editCalls = []
  state.deleted = false
  state.editThrows = null
  ;(ctx as unknown as { emit: ReturnType<typeof vi.fn> }).emit = vi.fn()
})

describe("get_workflow_graph — what it may read", () => {
  it("scopes the lookup to the caller AND the project, on one chain", async () => {
    state.lookup = { data: { id: "wf-other" }, error: null }
    await runGetWorkflowGraph(ctx, { workflow_id: "wf-other" })
    // `user_id` is the authorization; `project_id` narrows to what
    // list_workflows would have named. Losing either widens what one
    // conversation can read.
    expect(state.filters).toEqual(
      expect.arrayContaining([
        ["id", "wf-other"],
        ["user_id", "u1"],
        ["project_id", "p1"],
      ]),
    )
  })

  it("reads the target through get_graph, not a projection of its own", async () => {
    state.lookup = { data: { id: "wf-other" }, error: null }
    const out = await runGetWorkflowGraph(ctx, { workflow_id: "wf-other" })
    expect(state.getGraphCalls).toEqual(["wf-other"])
    expect(out).toContain("wf-other")
  })

  it("refuses a workflow that is not the caller's, in the same words as one that does not exist", async () => {
    state.lookup = { data: null, error: null }
    await expect(runGetWorkflowGraph(ctx, { workflow_id: "someone-elses" })).rejects.toThrow(
      /No workflow with that id in this project/,
    )
  })

  it("takes the open workflow with no lookup at all", async () => {
    await runGetWorkflowGraph(ctx, { workflow_id: "wf-open" })
    expect(state.filters).toEqual([])
    expect(state.getGraphCalls).toEqual(["wf-open"])
  })

  it("requires an id", async () => {
    await expect(runGetWorkflowGraph(ctx, {})).rejects.toThrow(/workflow_id is required/)
  })
})

describe("create_workflow — what the model cannot decide", () => {
  it("takes user and project from the context, never from arguments", async () => {
    await runCreateWorkflow(ctx, {
      name: "Ads",
      // A model that tries to place the row elsewhere: ignored by construction,
      // because the tool reads neither field.
      ...({ user_id: "someone-else", project_id: "another-project" } as Record<string, unknown>),
    })
    expect(state.inserted).toMatchObject({ user_id: "u1", project_id: "p1" })
  })

  it("writes settings as an empty object — the sharing flag is not the model's to set", async () => {
    // `settings.studio.shared` makes the whole graph readable with no auth.
    await runCreateWorkflow(ctx, { name: "Ads", ...({ settings: { studio: { shared: true } } } as Record<string, unknown>) })
    expect(state.inserted?.settings).toEqual({})
  })

  it("starts EMPTY and builds through edit_workflow — no writer of its own", async () => {
    await runCreateWorkflow(ctx, { name: "Ads", nodes: [{ id: "n1", type: "generate-image" }] as never })
    expect(state.inserted).toMatchObject({ nodes: [], edges: [] })
    expect(state.editCalls).toHaveLength(1)
    expect(state.editCalls[0].workflowId).toBe("wf-new")
    expect(state.editCalls[0].args.upsertNodes).toEqual([{ id: "n1", type: "generate-image" }])
  })

  it("passes edges as upsertEdges — the writer's own field name", async () => {
    // Spelled `edges`, it type-checks as an extra property and every edge is
    // silently dropped, leaving unconnected nodes.
    await runCreateWorkflow(ctx, { name: "Ads", edges: [{ id: "e1", source: "a", target: "b" }] as never })
    expect(state.editCalls[0].args.upsertEdges).toEqual([{ id: "e1", source: "a", target: "b" }])
  })

  it("announces the new workflow on its OWN event, carrying its own id", async () => {
    await runCreateWorkflow(ctx, { name: "Ads" })
    const emit = (ctx as unknown as { emit: ReturnType<typeof vi.fn> }).emit
    expect(emit).toHaveBeenCalledWith({
      type: "workflow_created",
      data: { workflowId: "wf-new", name: "Ads", projectId: "p1" },
    })
  })
})

describe("a build that fails takes its row with it", () => {
  // `edit_workflow` rejects for ordinary reasons — a denied node type, an
  // invented entity id, a raw URL. Without the rollback, every one of those
  // leaves an empty workflow behind: the abandoned-seed bug (#904) all over
  // again, and worse, because the user would be handed a link to it.
  it("deletes the row when the build is refused", async () => {
    state.editThrows = new Error("that node type is not available here")
    await expect(runCreateWorkflow(ctx, { name: "Ads" })).rejects.toThrow(/not available/)
    expect(state.deleted).toBe(true)
  })

  it("tells the user about the workflow only once it is worth opening", async () => {
    state.editThrows = new Error("nope")
    await expect(runCreateWorkflow(ctx, { name: "Ads" })).rejects.toThrow()
    const emit = (ctx as unknown as { emit: ReturnType<typeof vi.fn> }).emit
    // A pin pointing at a workflow that no longer exists is worse than none.
    expect(emit).not.toHaveBeenCalled()
  })

  it("keeps the row and announces it when the build succeeds", async () => {
    await runCreateWorkflow(ctx, { name: "Ads" })
    expect(state.deleted).toBe(false)
    expect((ctx as unknown as { emit: ReturnType<typeof vi.fn> }).emit).toHaveBeenCalledOnce()
  })
})
