import { describe, it, expect, vi, beforeEach } from "vitest"
import { TIGHTEN_EPISODE_DEFAULTS, buildTightenEpisodeGraph, toStoredInlineGraph } from "@nodaro/render-rules"
import {
  CONTINUATION_NOT_COMPLETED,
  CONTINUATION_NOT_FAILED,
  CONTINUATION_NOT_FOUND,
  CONTINUATION_SUBSET_REQUIRED,
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
    expect(continuationRefusal(src({ inlineGraphHash: null, workflowId: "wf-1" }), { userId: "u1", workflowId: "wf-1", nodeIds: ["x"], mode: "from-failed" })).toBe(CONTINUATION_WORKFLOW_MISMATCH)
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
