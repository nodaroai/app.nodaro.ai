import { describe, it, expect } from "vitest"
import { stripTransientRuntimeData } from "@nodaro/shared"
import {
  collectRestorableSingleNodeJobs,
  applySingleNodeJobRestore,
  restoreMaxAgeMs,
  SINGLE_NODE_RESTORE_MAX_AGE_MS,
  LONG_RUNNING_RESTORE_MAX_AGE_MS,
  type ActiveExecItem,
} from "../single-node-restore"

// ---------------------------------------------------------------------------
// Helpers — build the merged executions-list items the backend returns.
// A single-node job summary carries exactly one nodeState, keyed by node_id
// (see jobToExecutionSummary, backend Gap 3 Phase 2).
// ---------------------------------------------------------------------------

const NOW = 1_000_000_000_000 // fixed clock for age math

function singleNodeJob(opts: {
  jobId: string
  nodeId: string | null
  status?: string
  progress?: number
  nodeType?: string
  ageMs?: number
}): ActiveExecItem {
  const { jobId, nodeId, status = "running", progress = 0, nodeType = "generate-image", ageMs = 0 } = opts
  return {
    id: jobId,
    triggerType: "single-node",
    status,
    createdAt: new Date(NOW - ageMs).toISOString(),
    nodeStates: {
      [nodeId ?? jobId]: { nodeId, jobId, status, progress, nodeType },
    },
  }
}

function canvas(...ids: Array<[string, string]>) {
  // [id, type] pairs
  return ids.map(([id, type]) => ({ id, type, data: {} }))
}

// ===========================================================================
// collectRestorableSingleNodeJobs
// ===========================================================================

describe("collectRestorableSingleNodeJobs", () => {
  it("restores a running single-node job whose node is on the canvas", () => {
    const items = [singleNodeJob({ jobId: "j1", nodeId: "n1", progress: 33 })]
    const out = collectRestorableSingleNodeJobs(items, canvas(["n1", "generate-image"]), NOW)
    expect(out).toEqual([
      { nodeId: "n1", jobId: "j1", nodeType: "generate-image", progress: 33, status: "running" },
    ])
  })

  it("prefers the CANVAS node type over the job's nodeType label", () => {
    const items = [singleNodeJob({ jobId: "j1", nodeId: "n1", nodeType: "image-to-video" })]
    const out = collectRestorableSingleNodeJobs(items, canvas(["n1", "generate-video"]), NOW)
    expect(out[0].nodeType).toBe("generate-video")
  })

  it("carries the pending status through (queued job)", () => {
    const items = [singleNodeJob({ jobId: "j1", nodeId: "n1", status: "pending" })]
    const out = collectRestorableSingleNodeJobs(items, canvas(["n1", "generate-image"]), NOW)
    expect(out[0].status).toBe("pending")
  })

  it("skips non single-node items (orchestrator 'manual', mcp)", () => {
    const items: ActiveExecItem[] = [
      { id: "e1", triggerType: "manual", status: "running", createdAt: new Date(NOW).toISOString(), nodeStates: { n1: { status: "running" } } },
      { id: "j2", triggerType: "mcp", status: "running", createdAt: new Date(NOW).toISOString(), nodeStates: { n1: { nodeId: "n1", jobId: "j2", status: "running", progress: 0 } } },
    ]
    expect(collectRestorableSingleNodeJobs(items, canvas(["n1", "generate-image"]), NOW)).toEqual([])
  })

  it("skips a job whose node is not on the canvas (deleted / sub-workflow)", () => {
    const items = [singleNodeJob({ jobId: "j1", nodeId: "ghost" })]
    expect(collectRestorableSingleNodeJobs(items, canvas(["n1", "generate-image"]), NOW)).toEqual([])
  })

  it("skips a job with no canvas node_id (SDK/legacy row keyed by job id)", () => {
    const items = [singleNodeJob({ jobId: "j1", nodeId: null })]
    expect(collectRestorableSingleNodeJobs(items, canvas(["j1", "generate-image"]), NOW)).toEqual([])
  })

  it("FAN-OUT: skips a list node (would collapse N results to 1)", () => {
    const items = [singleNodeJob({ jobId: "j1", nodeId: "n1" })]
    expect(collectRestorableSingleNodeJobs(items, canvas(["n1", "list"]), NOW)).toEqual([])
  })

  it("FAN-OUT: skips a loop node (deprecated list alias)", () => {
    const items = [singleNodeJob({ jobId: "j1", nodeId: "n1" })]
    expect(collectRestorableSingleNodeJobs(items, canvas(["n1", "loop"]), NOW)).toEqual([])
  })

  it("FAN-OUT: skips a node with >1 active job mapping to it (N→1 collapse guard)", () => {
    const items = [
      singleNodeJob({ jobId: "j1", nodeId: "n1" }),
      singleNodeJob({ jobId: "j2", nodeId: "n1" }),
    ]
    expect(collectRestorableSingleNodeJobs(items, canvas(["n1", "generate-image"]), NOW)).toEqual([])
  })

  it("skips a job older than the node-timeout horizon (stuck → backend reconcile)", () => {
    const items = [singleNodeJob({ jobId: "j1", nodeId: "n1", ageMs: SINGLE_NODE_RESTORE_MAX_AGE_MS + 1 })]
    expect(collectRestorableSingleNodeJobs(items, canvas(["n1", "generate-image"]), NOW)).toEqual([])
  })

  it("keeps a job exactly at the horizon boundary", () => {
    const items = [singleNodeJob({ jobId: "j1", nodeId: "n1", ageMs: SINGLE_NODE_RESTORE_MAX_AGE_MS - 1 })]
    expect(collectRestorableSingleNodeJobs(items, canvas(["n1", "generate-image"]), NOW)).toHaveLength(1)
  })

  it("restores a long-running gvp job PAST the 30-min horizon (long-job case)", () => {
    // A generate-video-pro job legitimately runs longer than a regular node —
    // the wider LONG_RUNNING horizon must not abandon it (the "long job never
    // reappears" report).
    const items = [singleNodeJob({ jobId: "j1", nodeId: "n1", nodeType: "generate-video-pro", ageMs: SINGLE_NODE_RESTORE_MAX_AGE_MS + 60_000 })]
    const out = collectRestorableSingleNodeJobs(items, canvas(["n1", "generate-video-pro"]), NOW)
    expect(out).toHaveLength(1)
  })

  it("still skips a gvp job past even the long-running horizon", () => {
    const items = [singleNodeJob({ jobId: "j1", nodeId: "n1", nodeType: "generate-video-pro", ageMs: LONG_RUNNING_RESTORE_MAX_AGE_MS + 1 })]
    expect(collectRestorableSingleNodeJobs(items, canvas(["n1", "generate-video-pro"]), NOW)).toEqual([])
  })

  it("restoreMaxAgeMs widens only for long-running plugin types", () => {
    expect(restoreMaxAgeMs("generate-video-pro")).toBe(LONG_RUNNING_RESTORE_MAX_AGE_MS)
    expect(restoreMaxAgeMs("edit-video-pro")).toBe(LONG_RUNNING_RESTORE_MAX_AGE_MS)
    expect(restoreMaxAgeMs("generate-image")).toBe(SINGLE_NODE_RESTORE_MAX_AGE_MS)
    expect(restoreMaxAgeMs(undefined)).toBe(SINGLE_NODE_RESTORE_MAX_AGE_MS)
  })

  it("restores multiple distinct running nodes at once", () => {
    const items = [
      singleNodeJob({ jobId: "j1", nodeId: "n1" }),
      singleNodeJob({ jobId: "j2", nodeId: "n2" }),
    ]
    const out = collectRestorableSingleNodeJobs(items, canvas(["n1", "generate-image"], ["n2", "generate-video"]), NOW)
    expect(out.map((j) => j.nodeId).sort()).toEqual(["n1", "n2"])
  })
})

// ===========================================================================
// applySingleNodeJobRestore
// ===========================================================================

describe("applySingleNodeJobRestore", () => {
  const job = { nodeId: "n1", jobId: "j1", nodeType: "generate-image", progress: 40, status: "running" as const }

  it("sets executionStatus + currentJobId + currentJobProgress on the matched node", () => {
    const nodes = [{ id: "n1", data: { prompt: "hi" } }]
    const [n1] = applySingleNodeJobRestore(nodes, [job])
    expect(n1.data).toEqual({
      prompt: "hi",
      executionStatus: "running",
      currentJobId: "j1",
      currentJobProgress: 40,
    })
  })

  it("sets currentJobId === jobId (the shouldAbandonNode invariant)", () => {
    const nodes = [{ id: "n1", data: {} }]
    const [n1] = applySingleNodeJobRestore(nodes, [job])
    // The restored poll's abandon guard bails unless data.currentJobId === jobId.
    expect((n1.data as Record<string, unknown>).currentJobId).toBe(job.jobId)
  })

  it("leaves unmatched nodes untouched (by reference)", () => {
    const other = { id: "n2", data: { prompt: "x" } }
    const out = applySingleNodeJobRestore([other], [job])
    expect(out[0]).toBe(other)
  })

  it("MULTI-TAB: writes ONLY transient keys — stripTransientRuntimeData fully reverts it", () => {
    const original = { id: "n1", data: { prompt: "hi", provider: "kie" } }
    const restored = applySingleNodeJobRestore([original], [job])
    // Everything applySingleNodeJobRestore added must be a transient key, so the
    // save-payload sanitizer leaves NO residue → the persisted graph is byte-for-
    // byte what it was before restore (no autosave-freeze, no cross-tab dirty).
    const [stripped] = stripTransientRuntimeData(restored)
    expect(stripped.data).toEqual(original.data)
  })
})
