import { describe, expect, it } from "vitest"
import { isTurnOver, reduceTurn, startTurn } from "../turn-reducer"
import type { CopilotStreamEvent, CopilotTurnState } from "../types"

/** Fixed, so a replayed turn is byte-identical run to run. */
const T0 = 1_700_000_000_000

function drive(events: CopilotStreamEvent[], initial = startTurn("build me a product shot", T0)): CopilotTurnState {
  return events.reduce(reduceTurn, initial)
}

const metadata: CopilotStreamEvent = {
  type: "metadata",
  data: {
    threadId: "t1",
    turnId: "turn-1",
    jobId: "job-1",
    model: "claude-sonnet-5",
    baseVersion: 6,
    runMode: "ask",
    autoRunLimitCredits: 100,
  },
}

describe("reduceTurn", () => {
  it("accumulates streamed text in order", () => {
    const state = drive([
      metadata,
      { type: "token", data: { text: "Added " } },
      { type: "token", data: { text: "3 nodes." } },
    ])
    expect(state.turnId).toBe("turn-1")
    expect(state.text).toBe("Added 3 nodes.")
    expect(state.status).toBe("streaming")
  })

  it("upserts an activity by tool-use id rather than appending a second row", () => {
    const state = drive([
      { type: "tool_call", data: { id: "tu_1", name: "get_graph", label: "Reading the workflow", status: "started" } },
      {
        type: "tool_call",
        data: { id: "tu_1", name: "get_graph", label: "Reading the workflow", status: "finished", summary: "12 nodes" },
      },
    ])
    expect(state.activities).toHaveLength(1)
    expect(state.activities[0]).toMatchObject({ status: "finished", note: "12 nodes" })
  })

  it("keeps an earlier note when a later event carries none", () => {
    const state = drive([
      { type: "tool_call", data: { id: "tu_1", name: "edit_workflow", label: "Editing", status: "started", summary: "3 nodes" } },
      { type: "tool_call", data: { id: "tu_1", name: "edit_workflow", label: "Editing", status: "finished" } },
    ])
    expect(state.activities[0]?.note).toBe("3 nodes")
  })

  it("keeps only the latest workflow update — a later one supersedes the earlier", () => {
    const first = update(7, ["a"])
    const second = update(8, ["a", "b"])
    const state = drive([first, second])
    expect(state.update?.version).toBe(8)
    expect(state.update?.addedNodeIds).toEqual(["a", "b"])
  })

  it("records a run proposal and the credits charged", () => {
    const state = drive([
      { type: "run_proposed", data: { workflowId: "w1", addedNodeTypes: ["generate-image"], note: null } },
      { type: "usage", data: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 2, creditsCharged: 4 } },
    ])
    expect(state.proposal?.addedNodeTypes).toEqual(["generate-image"])
    expect(state.creditsCharged).toBe(4)
  })

  it.each(["completed", "capped", "cancelled"] as const)("settles on done:%s", (status) => {
    const state = drive([metadata, { type: "done", data: { turnId: "turn-1", messageId: "m1", status, finalVersion: 8 } }])
    expect(state.status).toBe(status)
    expect(isTurnOver(state)).toBe(true)
  })

  it("surfaces the mapped error text and stops the turn", () => {
    const state = drive([metadata, { type: "error", data: { code: "turn_timeout", message: "This turn took too long and was stopped." } }])
    expect(state.status).toBe("failed")
    expect(state.error).toEqual({ code: "turn_timeout", message: "This turn took too long and was stopped." })
    expect(isTurnOver(state)).toBe(true)
  })

  it("is a pure function — the input state is never mutated", () => {
    const before = startTurn("hello", T0)
    const snapshot = JSON.stringify(before)
    reduceTurn(before, { type: "token", data: { text: "hi" } })
    expect(JSON.stringify(before)).toBe(snapshot)
  })

  it("ignores an event shape it does not know", () => {
    const before = startTurn("hello", T0)
    const after = reduceTurn(before, { type: "future_event" } as unknown as CopilotStreamEvent)
    expect(after).toBe(before)
  })
})

function update(version: number, addedNodeIds: string[]): CopilotStreamEvent {
  return {
    type: "workflow_updated",
    data: {
      workflowId: "w1",
      version,
      addedNodeIds,
      updatedNodeIds: [],
      removedNodeIds: [],
      addedNodeTypes: ["generate-image"],
      nodeCount: addedNodeIds.length,
      edgeCount: 0,
      adjustments: [],
    },
  }
}
