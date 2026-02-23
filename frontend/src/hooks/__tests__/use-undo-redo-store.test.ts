import { describe, it, expect, beforeEach } from "vitest"
import { useUndoRedoStore } from "../use-undo-redo-store"
import type { WorkflowSnapshot } from "../use-undo-redo-store"

function makeSnapshot(name: string): WorkflowSnapshot {
  return {
    nodes: [],
    edges: [],
    characterDefinitions: [],
    flowPromptTemplates: {},
    workflowName: name,
  }
}

describe("useUndoRedoStore", () => {
  beforeEach(() => {
    useUndoRedoStore.setState({ past: [], future: [] })
  })

  it("starts with empty past and future", () => {
    const { past, future } = useUndoRedoStore.getState()
    expect(past).toEqual([])
    expect(future).toEqual([])
  })

  it("pushSnapshot adds snapshot to past", () => {
    const snap = makeSnapshot("A")
    useUndoRedoStore.getState().pushSnapshot(snap)

    const { past } = useUndoRedoStore.getState()
    expect(past).toHaveLength(1)
    expect(past[0].workflowName).toBe("A")
  })

  it("pushSnapshot clears future", () => {
    useUndoRedoStore.setState({
      past: [makeSnapshot("A")],
      future: [makeSnapshot("B"), makeSnapshot("C")],
    })

    useUndoRedoStore.getState().pushSnapshot(makeSnapshot("D"))

    const { future } = useUndoRedoStore.getState()
    expect(future).toEqual([])
  })

  it("pushSnapshot truncates past at MAX_HISTORY (50)", () => {
    const snapshots = Array.from({ length: 55 }, (_, i) =>
      makeSnapshot(`snap-${i}`)
    )
    for (const snap of snapshots) {
      useUndoRedoStore.getState().pushSnapshot(snap)
    }

    const { past } = useUndoRedoStore.getState()
    expect(past).toHaveLength(50)
    expect(past[0].workflowName).toBe("snap-5")
    expect(past[49].workflowName).toBe("snap-54")
  })

  it("undo returns null when past is empty", () => {
    const current = makeSnapshot("current")
    const result = useUndoRedoStore.getState().undo(current)
    expect(result).toBeNull()
  })

  it("undo returns the last snapshot from past", () => {
    useUndoRedoStore.setState({
      past: [makeSnapshot("A"), makeSnapshot("B")],
    })

    const current = makeSnapshot("current")
    const result = useUndoRedoStore.getState().undo(current)

    expect(result).not.toBeNull()
    expect(result!.workflowName).toBe("B")
  })

  it("undo moves current snapshot to the front of future", () => {
    useUndoRedoStore.setState({
      past: [makeSnapshot("A")],
      future: [makeSnapshot("F1")],
    })

    const current = makeSnapshot("current")
    useUndoRedoStore.getState().undo(current)

    const { future } = useUndoRedoStore.getState()
    expect(future).toHaveLength(2)
    expect(future[0].workflowName).toBe("current")
    expect(future[1].workflowName).toBe("F1")
  })

  it("undo removes the last entry from past", () => {
    useUndoRedoStore.setState({
      past: [makeSnapshot("A"), makeSnapshot("B")],
    })

    const current = makeSnapshot("current")
    useUndoRedoStore.getState().undo(current)

    const { past } = useUndoRedoStore.getState()
    expect(past).toHaveLength(1)
    expect(past[0].workflowName).toBe("A")
  })

  it("redo returns null when future is empty", () => {
    const current = makeSnapshot("current")
    const result = useUndoRedoStore.getState().redo(current)
    expect(result).toBeNull()
  })

  it("redo returns the first snapshot from future", () => {
    useUndoRedoStore.setState({
      future: [makeSnapshot("F1"), makeSnapshot("F2")],
    })

    const current = makeSnapshot("current")
    const result = useUndoRedoStore.getState().redo(current)

    expect(result).not.toBeNull()
    expect(result!.workflowName).toBe("F1")
  })

  it("redo moves current snapshot to the end of past", () => {
    useUndoRedoStore.setState({
      past: [makeSnapshot("A")],
      future: [makeSnapshot("F1")],
    })

    const current = makeSnapshot("current")
    useUndoRedoStore.getState().redo(current)

    const { past } = useUndoRedoStore.getState()
    expect(past).toHaveLength(2)
    expect(past[0].workflowName).toBe("A")
    expect(past[1].workflowName).toBe("current")
  })

  it("clear empties both past and future", () => {
    useUndoRedoStore.setState({
      past: [makeSnapshot("A"), makeSnapshot("B")],
      future: [makeSnapshot("C")],
    })

    useUndoRedoStore.getState().clear()

    const { past, future } = useUndoRedoStore.getState()
    expect(past).toEqual([])
    expect(future).toEqual([])
  })
})
