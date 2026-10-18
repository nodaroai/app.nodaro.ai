import { describe, it, expect, vi, beforeEach } from "vitest"
import { TIGHTEN_EPISODE_DEFAULTS, buildTightenEpisodeGraph, toStoredInlineGraph } from "@nodaro/render-rules"
import {
  CONTINUATION_NOT_COMPLETED,
  CONTINUATION_NOT_FAILED,
  CONTINUATION_NOT_FOUND,
  CONTINUATION_SUBSET_REQUIRED,
  CONTINUATION_VERSION_MISMATCH,
  CONTINUATION_WORKFLOW_MISMATCH,
} from "@nodaro/shared/nodes"

const db = vi.hoisted(() => ({
  execution: null as Record<string, unknown> | null,
  /** Columns the database does not have yet (staging before promotion). */
  missing: new Set<string>(),
  executionSelects: [] as string[],
}))
vi.mock("@/lib/supabase.js", () => ({
  supabase: {
    from: (table: string) => ({
      select: (columns: string) => {
        if (table === "workflow_executions") db.executionSelects.push(columns)
        const self = {
          eq: () => self,
          maybeSingle: async () => {
            if (table !== "workflow_executions") return { data: null, error: null }
            const absent = [...db.missing].find((c) => columns.includes(c))
            if (absent) return { data: null, error: { code: "42703", message: `column workflow_executions.${absent} does not exist` } }
            if (!db.execution) return { data: null, error: null }
            // Only the columns selected, as PostgREST answers.
            const named = new Set(columns.split(",").map((c) => c.trim()))
            return { data: Object.fromEntries(Object.entries(db.execution).filter(([k]) => named.has(k))), error: null }
          },
        }
        return self
      },
    }),
  },
}))
vi.mock("@/lib/canvas-result-ids.js", () => ({
  resolveRunStateStamps: async (states: unknown) => states,
}))

import {
  continuationRefusal,
  fromFailedClosedRunSet,
  fromFailedRunSet,
  loadContinuationSource,
  type ContinuationSource,
} from "../run-continuation.js"
import { resetInputOverridesColumnForTests } from "../../../lib/execution-input-overrides.js"
import { inlineExecutionColumns, resetInlineGraphColumnForTests } from "../../../lib/execution-inline-graph.js"

const src = (over: Partial<ContinuationSource> = {}): ContinuationSource => ({
  id: "exec-0", userId: "u1", workflowId: null, status: "failed", appVersionId: null, inlineGraphHash: "aaaa0000bbbb1111", ...over,
})

describe("continuation of an inline (use-case) run", () => {
  it("from-failed: same user, same snapshot, a failed source → allowed", () => {
    expect(continuationRefusal(src(), { userId: "u1", workflowId: null, inlineGraphHash: "aaaa0000bbbb1111", nodeIds: ["uc-render"], mode: "from-failed" })).toBeNull()
  })
  it("from-failed refuses a source that did not fail", () => {
    expect(continuationRefusal(src({ status: "completed" }), { userId: "u1", workflowId: null, inlineGraphHash: "aaaa0000bbbb1111", nodeIds: ["uc-render"], mode: "from-failed" })).toBe(CONTINUATION_NOT_FAILED)
    expect(continuationRefusal(src({ status: "running" }), { userId: "u1", workflowId: null, inlineGraphHash: "aaaa0000bbbb1111", nodeIds: ["uc-render"], mode: "from-failed" })).toBe(CONTINUATION_NOT_FAILED)
  })
  it("refuses another user's run as if it did not exist", () => {
    expect(continuationRefusal(src(), { userId: "u2", workflowId: null, inlineGraphHash: "aaaa0000bbbb1111", nodeIds: ["uc-render"], mode: "from-failed" })).toBe(CONTINUATION_NOT_FOUND)
  })
  it("refuses a different snapshot, and a saved workflow posing as a snapshot", () => {
    expect(continuationRefusal(src(), { userId: "u1", workflowId: null, inlineGraphHash: "ffff", nodeIds: ["uc-render"], mode: "from-failed" })).toBe(CONTINUATION_WORKFLOW_MISMATCH)
    // A saved workflow's run claiming the inline run's snapshot.
    expect(continuationRefusal(src(), { userId: "u1", workflowId: "wf-1", inlineGraphHash: "aaaa0000bbbb1111", nodeIds: ["x"], mode: "from-failed" })).toBe(CONTINUATION_WORKFLOW_MISMATCH)
  })
  it("two runs with no workflow match only on a stored snapshot hash: none on either side is a mismatch", () => {
    // An expunged snapshot (or the column not yet there) reads as no hash.
    const noHash = src({ inlineGraphHash: null, status: "completed" })
    expect(continuationRefusal(noHash, { userId: "u1", workflowId: null, inlineGraphHash: null, nodeIds: ["uc-render"] })).toBe(CONTINUATION_WORKFLOW_MISMATCH)
    expect(continuationRefusal(noHash, { userId: "u1", workflowId: null, nodeIds: ["uc-render"] })).toBe(CONTINUATION_WORKFLOW_MISMATCH)
    expect(continuationRefusal(noHash, { userId: "u1", workflowId: null, inlineGraphHash: "aaaa0000bbbb1111", nodeIds: ["uc-render"] })).toBe(CONTINUATION_WORKFLOW_MISMATCH)
    expect(continuationRefusal(src({ status: "completed" }), { userId: "u1", workflowId: null, inlineGraphHash: null, nodeIds: ["uc-render"] })).toBe(CONTINUATION_WORKFLOW_MISMATCH)
  })
  it("a source with no hash field at all (saved-workflow literal) reads as none", () => {
    const legacy: ContinuationSource = { id: "exec-0", userId: "u1", workflowId: null, status: "completed", appVersionId: null }
    expect(continuationRefusal(legacy, { userId: "u1", workflowId: null, nodeIds: ["uc-render"] })).toBe(CONTINUATION_WORKFLOW_MISMATCH)
  })
  it("a saved-workflow run and an inline run never continue each other", () => {
    // Inline source, saved run.
    expect(continuationRefusal(src({ status: "completed" }), { userId: "u1", workflowId: "wf-1", nodeIds: ["cut"] })).toBe(CONTINUATION_WORKFLOW_MISMATCH)
    expect(continuationRefusal(src({ status: "completed" }), { userId: "u1", workflowId: "wf-1", inlineGraphHash: "aaaa0000bbbb1111", nodeIds: ["cut"] })).toBe(CONTINUATION_WORKFLOW_MISMATCH)
    // Saved source, inline run.
    const saved = src({ inlineGraphHash: null, workflowId: "wf-1", status: "completed" })
    expect(continuationRefusal(saved, { userId: "u1", workflowId: null, inlineGraphHash: "aaaa0000bbbb1111", nodeIds: ["cut"] })).toBe(CONTINUATION_WORKFLOW_MISMATCH)
  })
  it("subset mode (Render final) on an inline run still needs a completed source", () => {
    expect(continuationRefusal(src({ status: "failed" }), { userId: "u1", workflowId: null, inlineGraphHash: "aaaa0000bbbb1111", nodeIds: ["uc-render"] })).toBe(CONTINUATION_NOT_COMPLETED)
    expect(continuationRefusal(src({ status: "completed" }), { userId: "u1", workflowId: null, inlineGraphHash: "aaaa0000bbbb1111", nodeIds: ["uc-render"] })).toBeNull()
    expect(continuationRefusal(src({ status: "completed" }), { userId: "u1", workflowId: null, inlineGraphHash: "aaaa0000bbbb1111", nodeIds: ["uc-render"], mode: "subset" })).toBeNull()
  })
  it("still requires a subset", () => {
    expect(continuationRefusal(src(), { userId: "u1", workflowId: null, inlineGraphHash: "aaaa0000bbbb1111", nodeIds: [], mode: "from-failed" })).toBe(CONTINUATION_SUBSET_REQUIRED)
  })
  it("a saved-workflow continuation is unchanged", () => {
    const saved = src({ inlineGraphHash: null, workflowId: "wf-1", status: "completed" })
    expect(continuationRefusal(saved, { userId: "u1", workflowId: "wf-1", nodeIds: ["cut"] })).toBeNull()
    expect(continuationRefusal(saved, { userId: "u1", workflowId: "wf-2", nodeIds: ["cut"] })).toBe(CONTINUATION_WORKFLOW_MISMATCH)
  })
  it("from-failed of a saved workflow's run (decided 2026-10-17): its own failed run of the same live workflow → allowed", () => {
    const saved = src({ inlineGraphHash: null, workflowId: "wf-1" })
    expect(continuationRefusal(saved, { userId: "u1", workflowId: "wf-1", nodeIds: ["x"], mode: "from-failed" })).toBeNull()
  })
  it("from-failed of a saved workflow's run keeps every other check", () => {
    const saved = src({ inlineGraphHash: null, workflowId: "wf-1" })
    const run = { userId: "u1", workflowId: "wf-1", nodeIds: ["x"], mode: "from-failed" as const }
    expect(continuationRefusal(saved, { ...run, userId: "u2" })).toBe(CONTINUATION_NOT_FOUND)
    expect(continuationRefusal(saved, { ...run, workflowId: "wf-2" })).toBe(CONTINUATION_WORKFLOW_MISMATCH)
    // An app run's execution is another version of the graph than the live workflow.
    expect(continuationRefusal(src({ inlineGraphHash: null, workflowId: "wf-1", appVersionId: "app-1" }), run)).toBe(CONTINUATION_VERSION_MISMATCH)
    expect(continuationRefusal(src({ inlineGraphHash: null, workflowId: "wf-1", status: "completed" }), run)).toBe(CONTINUATION_NOT_FAILED)
    expect(continuationRefusal(src({ inlineGraphHash: null, workflowId: "wf-1", status: "cancelled" }), run)).toBe(CONTINUATION_NOT_FAILED)
    expect(continuationRefusal(saved, { ...run, nodeIds: [] })).toBe(CONTINUATION_SUBSET_REQUIRED)
    expect(continuationRefusal(null, run)).toBe(CONTINUATION_NOT_FOUND)
  })
  it("fromFailedRunSet: every node the failed run did not complete, in graph order", () => {
    const states = { a: { status: "completed" }, b: { status: "completed" }, c: { status: "failed" }, d: { status: "skipped" } }
    expect(fromFailedRunSet(["a", "b", "c", "d", "e"], { nodeStates: states as never })).toEqual(["c", "d", "e"])
  })
  it("fromFailedRunSet with no states runs every node", () => {
    expect(fromFailedRunSet(["a", "b"], {})).toEqual(["a", "b"])
  })
})

describe("loading an inline run to continue from: its STORED snapshot hash", () => {
  const snapshot = toStoredInlineGraph(
    buildTightenEpisodeGraph(TIGHTEN_EPISODE_DEFAULTS, { media: { url: "https://r2/ep.mp4", kind: "video", durationSec: 60 } }),
    TIGHTEN_EPISODE_DEFAULTS,
  )
  const load = () => loadContinuationSource("exec-0", { withStates: true, isRenderNode: () => false })

  beforeEach(() => {
    resetInputOverridesColumnForTests()
    resetInlineGraphColumnForTests()
    db.missing.clear()
    db.executionSelects.length = 0
    db.execution = {
      id: "exec-0", user_id: "u1", workflow_id: null, status: "failed", node_states: {}, input_overrides: null,
      ...inlineExecutionColumns(snapshot, "job-w"),
    }
  })

  it("is the hash stored with the snapshot, not one recomputed from a rebuilt graph", async () => {
    db.execution = { ...db.execution!, ...inlineExecutionColumns({ ...snapshot, hash: "stored-hash-0001" }, "job-w") }
    expect((await load())!.inlineGraphHash).toBe("stored-hash-0001")
  })

  it("an expunged snapshot ({}) has none", async () => {
    db.execution = { ...db.execution!, ...inlineExecutionColumns({} as never, "job-w") }
    expect((await load())!.inlineGraphHash).toBeNull()
  })

  it("a saved workflow's run has none", async () => {
    db.execution = { id: "exec-0", user_id: "u1", workflow_id: "wf-1", status: "completed", node_states: {}, input_overrides: null }
    const source = await load()
    expect(source!.workflowId).toBe("wf-1")
    expect(source!.inlineGraphHash).toBeNull()
  })

  it("before either column reaches the database: the read retries without each, and still loads", async () => {
    db.missing = new Set(["input_overrides", "inline_graph"])
    const source = await load()
    expect(source!.status).toBe("failed")
    expect(source!.inlineGraphHash).toBeNull()
    expect(db.executionSelects).toHaveLength(3)
    expect(db.executionSelects[2]).not.toMatch(/input_overrides|inline_graph/)
  })
})

// A saved workflow's continue-from-failed run set is closed over the incomplete
// nodes it needs upstream (decided 2026-10-17): a narrow nodeIds never runs a
// node on an upstream that produced nothing.
describe("fromFailedClosedRunSet", () => {
  const nodes = [
    { id: "a", type: "generate-image" },
    { id: "b", type: "image-to-video" },
    { id: "c", type: "add-captions" },
    { id: "d", type: "generate-image" },
  ]
  const order = nodes.map((n) => n.id)
  const chain = { nodes, edges: [{ source: "a", target: "b" }, { source: "b", target: "c" }, { source: "d", target: "c" }] }
  const states = (s: Record<string, string>) => ({ nodeStates: Object.fromEntries(Object.entries(s).map(([id, status]) => [id, { status }])) as never })

  it("adds every incomplete node upstream of one it runs, in graph order", () => {
    // a failed; b, c never ran; d completed.
    expect(fromFailedClosedRunSet(order, ["c"], chain, states({ a: "failed", d: "completed" }))).toEqual(["a", "b", "c"])
  })

  it("stops at a completed node: it hands on its seed, so nothing above it runs", () => {
    expect(fromFailedClosedRunSet(order, ["c"], chain, states({ a: "failed", b: "completed", d: "completed" }))).toEqual(["c"])
  })

  it("is the plain remainder when nothing upstream is missing", () => {
    expect(fromFailedClosedRunSet(order, order, chain, states({ a: "completed", b: "failed", d: "completed" }))).toEqual(["b", "c"])
  })

  it("reads a teleport pair as the orchestrator does: the wire runs from the node behind the Send", () => {
    const teleported = {
      nodes: [
        { id: "a", type: "generate-image" },
        { id: "send", type: "teleport-send", data: {} },
        { id: "recv", type: "teleport-receive", data: { teleportFrom: "send" } },
        { id: "c", type: "add-captions" },
      ],
      edges: [
        { source: "a", target: "send" },
        { source: "send", target: "recv", data: { teleporter: true } },
        { source: "recv", target: "c" },
      ],
    }
    const run = fromFailedClosedRunSet(["a", "send", "recv", "c"], ["c"], teleported, states({ a: "failed" }))
    expect(run).toContain("a")
    expect(run).toContain("c")
  })
})
