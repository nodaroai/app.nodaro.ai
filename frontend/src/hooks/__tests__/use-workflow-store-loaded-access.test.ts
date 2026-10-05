import { describe, it, expect, beforeEach } from "vitest"
import { useWorkflowStore } from "@/hooks/use-workflow-store"

/**
 * `loadedAccess` (T86) is the access a canvas's load answered, keyed by the
 * workflow it answered for. Putting a workflow into the store — the first step
 * of every load, a reload of the same workflow included — and clearing it both
 * forget the answer, so the canvas is unknown, and fails closed, until the new
 * load answers (use-workflow-realtime-sync.ts).
 */
describe("workflow store — loadedAccess", () => {
  beforeEach(() => {
    useWorkflowStore.setState({ loadedAccess: { workflowId: "w1", access: "own" } })
  })

  it("loading the same workflow again forgets it", () => {
    useWorkflowStore.getState().loadWorkflow("w1", "", [], [], [])
    expect(useWorkflowStore.getState().loadedAccess).toBeNull()
  })

  it("loading another workflow forgets it", () => {
    useWorkflowStore.getState().loadWorkflow("w2", "", [], [], [])
    expect(useWorkflowStore.getState().loadedAccess).toBeNull()
  })

  it("clearing the workflow forgets it", () => {
    useWorkflowStore.getState().clearWorkflow()
    expect(useWorkflowStore.getState().loadedAccess).toBeNull()
  })
})
