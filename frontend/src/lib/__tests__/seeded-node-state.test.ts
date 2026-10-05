import { describe, expect, it } from "vitest"
import { isSeededState } from "../seeded-node-state"

describe("isSeededState", () => {
  it("the orchestrator's stamp marks a seeded state", () => {
    expect(isSeededState({ status: "completed", fromSavedData: true })).toBe(true)
  })

  it("a completed state with no start time and no job is a run from before the stamp that passed saved data on", () => {
    expect(isSeededState({ status: "completed" })).toBe(true)
  })

  it("a state that started, or that names its job, ran in this run", () => {
    expect(isSeededState({ status: "completed", startedAt: "2026-10-04T10:00:00.000Z" })).toBe(false)
    expect(isSeededState({ status: "completed", jobId: "job-1" })).toBe(false)
  })
})
