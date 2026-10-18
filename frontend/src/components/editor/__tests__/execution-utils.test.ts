import { describe, expect, it, vi } from "vitest"

vi.mock("@/lib/i18n", () => ({
  tx: (key: string) => key,
}))

import { fanOutSubRows, isExecutedNodeEntry, skipReasonLabel } from "../execution-utils"

/**
 * The node rows a run's history shows: what actually ran, plus a node the RUN
 * skipped for a reason — "nothing new" is a verdict worth a row. Router-gated
 * skips and pre-completed source nodes stay out, as before.
 */
describe("isExecutedNodeEntry", () => {
  it("shows a node that ran, failed or is running", () => {
    expect(isExecutedNodeEntry({ status: "completed", startedAt: "2026-10-06T10:00:00Z" })).toBe(true)
    expect(isExecutedNodeEntry({ status: "failed" })).toBe(true)
    expect(isExecutedNodeEntry({ status: "running" })).toBe(true)
  })

  it("hides a pre-completed source node (completed, never started) and a router-gated skip", () => {
    expect(isExecutedNodeEntry({ status: "completed" })).toBe(false)
    expect(isExecutedNodeEntry({ status: "skipped" })).toBe(false)
  })

  it("shows a node the run skipped for want of input", () => {
    expect(isExecutedNodeEntry({ status: "skipped", skipReason: "empty_input" })).toBe(true)
  })
})

describe("skipReasonLabel", () => {
  it("names the known reason through the dictionary and passes an unknown one through", () => {
    expect(skipReasonLabel("empty_input")).toBe("exec.skipReasonEmptyInput")
    expect(skipReasonLabel("later_reason")).toBe("later_reason")
  })
})

describe("fanOutSubRows: a node's fan-out in a run's history", () => {
  it("a node that ran more than once: one sub-row per job, its own row only their total", () => {
    const r = fanOutSubRows("n1", { status: "completed", nodeType: "generate-image", jobIds: ["a", "b"] })
    expect(r.hasFanOut).toBe(true)
    expect(r.ownRowOpens).toBe(false)
    expect(r.rows.map((row) => [row.key, row.label, row.state.jobId, row.state.jobIds])).toEqual([
      ["n1-iter-0", { key: "exec.iteration", n: 1 }, "a", undefined],
      ["n1-iter-1", { key: "exec.iteration", n: 2 }, "b", undefined],
    ])
  })

  it("one job, no fan-out: the node's own row opens it", () => {
    expect(fanOutSubRows("n1", { status: "completed", jobIds: ["a"] })).toEqual({ hasFanOut: false, ownRowOpens: true, rows: [] })
    expect(fanOutSubRows("n1", { status: "completed" })).toEqual({ hasFanOut: false, ownRowOpens: true, rows: [] })
  })

  it("a failed UGC Clip keeps its own row, and lists each finished clip by its clip number, as completed", () => {
    // Clips 3 and 1 finished (in that order); clip 2 failed the node.
    const state = { status: "failed", nodeType: "ugc-clip", error: "clip 2 failed", jobId: "job-failed", jobIds: ["job-c3", "job-c1"], jobRows: [2, 0] }
    const r = fanOutSubRows("clip", state)
    expect(r.hasFanOut).toBe(true)
    expect(r.ownRowOpens).toBe(true)
    expect(r.rows.map((row) => [row.label, row.state.jobId, row.state.status, row.state.error])).toEqual([
      [{ key: "exec.clipRow", n: 1 }, "job-c1", "completed", undefined],
      [{ key: "exec.clipRow", n: 3 }, "job-c3", "completed", undefined],
    ])
  })

  it("a failed node with one finished clip still lists it; without its rows, sub-rows are numbered in order", () => {
    const one = fanOutSubRows("clip", { status: "failed", nodeType: "ugc-clip", jobIds: ["job-c2"], jobRows: [1] })
    expect(one.rows.map((row) => row.label)).toEqual([{ key: "exec.clipRow", n: 2 }])
    const noRows = fanOutSubRows("clip", { status: "failed", nodeType: "ugc-clip", jobIds: ["x", "y"] })
    expect(noRows.rows.map((row) => row.label)).toEqual([{ key: "exec.iteration", n: 1 }, { key: "exec.iteration", n: 2 }])
  })
})
