import { describe, it, expect } from "vitest"
import { continuableFailedRun } from "../continuable-failed-run"

/** The run the "Continue from failed" button continues: the workflow's newest run, when it failed. */
describe("continuableFailedRun", () => {
  it("the newest run failed: that run", () => {
    expect(continuableFailedRun([
      { id: "e2", status: "failed", triggerType: "manual" },
      { id: "e1", status: "completed", triggerType: "manual" },
    ])).toBe("e2")
  })

  it("a newer run ended otherwise: nothing to continue, even with an older failure", () => {
    expect(continuableFailedRun([
      { id: "e3", status: "completed", triggerType: "manual" },
      { id: "e2", status: "failed", triggerType: "manual" },
    ])).toBeNull()
    expect(continuableFailedRun([{ id: "e3", status: "running" }, { id: "e2", status: "failed" }])).toBeNull()
    expect(continuableFailedRun([{ id: "e3", status: "cancelled" }, { id: "e2", status: "failed" }])).toBeNull()
  })

  it("a single-node job listed beside the runs is passed over", () => {
    expect(continuableFailedRun([
      { id: "j1", kind: "job", status: "completed", triggerType: "single-node" },
      { id: "e2", kind: "execution", status: "failed", triggerType: "mcp" },
    ])).toBe("e2")
  })

  it("an app's run ran a published version: not continued from the canvas", () => {
    expect(continuableFailedRun([{ id: "e2", status: "failed", triggerType: "app_run" }])).toBeNull()
  })

  it("no runs (or no answer yet): nothing", () => {
    expect(continuableFailedRun(undefined)).toBeNull()
    expect(continuableFailedRun([])).toBeNull()
  })
})
