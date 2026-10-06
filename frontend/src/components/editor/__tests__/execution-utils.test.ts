import { describe, expect, it, vi } from "vitest"

vi.mock("@/lib/i18n", () => ({
  tx: (key: string) => key,
}))

import { isExecutedNodeEntry, skipReasonLabel } from "../execution-utils"

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
