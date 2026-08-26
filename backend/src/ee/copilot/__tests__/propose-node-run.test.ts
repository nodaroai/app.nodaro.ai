/**
 * `run_workflow` with a `node_id` — what the proposal must prove about the
 * node before a card offers to spend credits on it.
 */
import { describe, expect, it, vi, beforeEach } from "vitest"

const state = vi.hoisted(() => ({
  row: null as unknown,
  filters: [] as Array<[string, unknown]>,
  emitted: [] as Array<{ type: string; data: Record<string, unknown> }>,
}))

function chain() {
  const c: Record<string, unknown> = {}
  c.select = vi.fn(() => c)
  c.eq = vi.fn((col: string, value: unknown) => {
    state.filters.push([col, value])
    return c
  })
  c.order = vi.fn(() => c)
  c.limit = vi.fn(() => c)
  c.maybeSingle = vi.fn(async () => ({ data: state.row, error: null }))
  return c
}
vi.mock("../../../lib/supabase.js", () => ({ supabase: { from: () => chain() } }))

const { proposeRun } = await import("../tools/run-and-execution.js")

const ctx = {
  userId: "u1",
  workflowId: "wf1",
  projectId: "p1",
  threadId: "t1",
  turnId: "turn1",
  allowPublishing: false,
  userLinks: new Set<string>(),
  fastify: {} as never,
  emit: (e: { type: string; data: Record<string, unknown> }) => state.emitted.push(e),
} as never as Parameters<typeof proposeRun>[0]

beforeEach(() => {
  state.filters = []
  state.emitted = []
  state.row = {
    version: 12,
    nodes: [
      { id: "n1", type: "generate-image", data: { label: "Hero shot" } },
      { id: "n2", type: "generate-video", data: {} },
      { id: "p1", type: "setting", data: {} },
    ],
  }
})

describe("proposing ONE node", () => {
  it("stamps the node with the LIVE version, not the turn's base version", async () => {
    // `base_version` is the version at turn START and is stale the moment the
    // copilot's own first edit lands — which is exactly when runs get
    // proposed. Stamping it would refuse every proposal that followed an edit.
    const { proposal } = await proposeRun(ctx, { node_id: "n1" }, [])
    expect(proposal.node).toEqual({ id: "n1", type: "generate-image", graphVersion: 12, label: "Hero shot" })
  })

  it("reads the graph owner-scoped", async () => {
    await proposeRun(ctx, { node_id: "n1" }, [])
    expect(state.filters).toEqual(expect.arrayContaining([["id", "wf1"], ["user_id", "u1"]]))
  })

  it("falls back to the node TYPE when it has no label", async () => {
    const { proposal } = await proposeRun(ctx, { node_id: "n2" }, [])
    expect(proposal.node?.label).toBe("generate-video")
  })

  it("refuses a node that is not on the canvas", async () => {
    await expect(proposeRun(ctx, { node_id: "ghost" }, [])).rejects.toThrow(/No node "ghost"/)
  })

  it("refuses a PARAMETER node — a setting is read, not run", async () => {
    // Offering one would be a card whose button cannot work, and refusing at
    // the click teaches the model nothing: its tool call already succeeded.
    await expect(proposeRun(ctx, { node_id: "p1" }, [])).rejects.toThrow(/cannot be run on its own/)
  })

  it("emits the node on the run_proposed event so the card can name it", async () => {
    await proposeRun(ctx, { node_id: "n1" }, [])
    expect(state.emitted[0]?.data.node).toMatchObject({ id: "n1", label: "Hero shot" })
  })

  it("a whole-graph proposal reads NOTHING and carries no node", async () => {
    // The extra query must not run for the common case.
    const { proposal } = await proposeRun(ctx, {}, [])
    expect(state.filters).toEqual([])
    expect(proposal.node).toBeUndefined()
    expect(state.emitted[0]?.data.node).toBeNull()
  })
})
