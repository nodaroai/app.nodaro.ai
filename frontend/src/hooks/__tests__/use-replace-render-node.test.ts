// The swap's canvas contract (SV16 b), against the REAL store and the REAL undo
// history: one click swaps, ONE Undo restores the old node with its run
// history, and a refused swap changes nothing.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, renderHook } from "@testing-library/react"

const toastMock = vi.hoisted(() => ({ success: vi.fn(), info: vi.fn(), error: vi.fn(), warning: vi.fn() }))
vi.mock("sonner", () => ({ toast: toastMock }))

import { RENDER_NODE_TYPE_IDS } from "@nodaro/shared"
import type { WorkflowEdge, WorkflowNode } from "@/types/nodes"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { useUndoRedoStore } from "@/hooks/use-undo-redo-store"
import { flushPendingUndoSnapshot, useUndoRedoActions, useUndoRedoSubscription } from "@/hooks/use-undo-redo"
import { SPEAKER_VIEW_TYPE } from "@/lib/replace-render-node"
import { replaceRenderNodeOnCanvas } from "../use-replace-render-node"

const SV = SPEAKER_VIEW_TYPE
const AE = RENDER_NODE_TYPE_IDS.find((t) => t !== SV)!

function node(id: string, type: string, data: Record<string, unknown>): WorkflowNode {
  return { id, type, position: { x: 5, y: 6 }, data: { label: id, ...data } } as unknown as WorkflowNode
}

const RESULT = { url: "https://cdn.test/out.mp4", jobId: "j1", timestamp: "2026-10-08T00:00:00Z" }
const EDL = {
  version: 1, clock: "master",
  sources: [{ id: "camA", url: "https://cdn.test/a.mp4", kind: "video" }],
  segments: [{ id: "s0", inMs: 0, outMs: 60_000, video: "camA" }],
}
const GRAPH: WorkflowNode[] = [
  node("node_1", "camera-switch", { generatedJson: { edl: EDL } }),
  node("node_2", AE, { label: "Render", quality: "proxy", generatedVideoUrl: RESULT.url, generatedResults: [RESULT], activeResultIndex: 0 }),
  node("node_3", "add-captions", {}),
  node("node_4", "upload-video", { url: "https://cdn.test/cam.mp4" }),
]
const EDGES = [
  { id: "e1", source: "node_1", sourceHandle: "edl", target: "node_2", targetHandle: "edl" },
  { id: "e2", source: "node_2", sourceHandle: "json", target: "node_3", targetHandle: "transcript" },
  { id: "e3", source: "node_4", target: "node_2", targetHandle: "sources" },
] as unknown as WorkflowEdge[]

const state = () => useWorkflowStore.getState()
const history = () => useUndoRedoStore.getState()

let undo: () => void
let redo: () => void
let unmount: () => void

function tick(): void {
  act(() => {
    vi.advanceTimersByTime(400)
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  const subscription = renderHook(() => useUndoRedoSubscription())
  const actions = renderHook(() => useUndoRedoActions())
  undo = () => act(() => actions.result.current.undo())
  redo = () => act(() => actions.result.current.redo())
  unmount = () => {
    subscription.unmount()
    actions.unmount()
  }
  act(() => {
    useWorkflowStore.setState({ nodes: GRAPH, edges: EDGES, isDirty: false, isReadOnly: false, selectedNodeId: "node_2", presentationSettings: { runTarget: "workflow" }, nodeIdMoves: [] })
  })
  act(() => {
    flushPendingUndoSnapshot()
    history().clear()
  })
})

afterEach(() => {
  unmount()
  vi.useRealTimers()
})

describe("replaceRenderNodeOnCanvas", () => {
  it("swaps the node, follows the selection, and lists the dropped wire", () => {
    let outcome = ""
    act(() => {
      outcome = replaceRenderNodeOnCanvas("node_2", SV, undo)
    })
    expect(outcome).toBe("replaced")
    const swapped = state().nodes.find((n) => n.type === SV)!
    expect(swapped.id).toBe("node_5")
    expect(swapped.data).toMatchObject({ label: "Render", quality: "proxy" })
    expect((swapped.data as Record<string, unknown>).generatedResults).toBeUndefined()
    expect(state().selectedNodeId).toBe("node_5")
    expect(state().edges.find((e) => e.id === "e2")).toMatchObject({ source: "node_5", sourceHandle: "transcript" })
    expect(state().edges.some((e) => e.id === "e3")).toBe(false)
    const [, options] = toastMock.success.mock.calls.at(-1)!
    expect(String((options as { description: string }).description)).toContain("node_4 → sources")
  })

  it("is ONE undo step: one Undo restores the old node with its run history", () => {
    act(() => {
      replaceRenderNodeOnCanvas("node_2", SV, undo)
    })
    tick()
    expect(history().past).toHaveLength(1)
    undo()
    expect(state().nodes.map((n) => n.id)).toEqual(["node_1", "node_2", "node_3", "node_4"])
    expect(state().nodes.find((n) => n.id === "node_2")!.data).toMatchObject({ generatedResults: [RESULT] })
    expect(state().edges.map((e) => e.id)).toEqual(["e1", "e2", "e3"])
  })

  it("the toast's Undo takes it back even after a later edit", () => {
    act(() => {
      replaceRenderNodeOnCanvas("node_2", SV, undo)
    })
    tick()
    act(() => {
      state().updateNodeData("node_3", { label: "Captions" })
    })
    tick()
    const options = toastMock.success.mock.calls.at(-1)![1] as { action: { onClick: () => void } }
    act(() => options.action.onClick())
    expect(state().nodes.some((n) => n.id === "node_2")).toBe(true)
  })

  it("refused up front, nothing changed: an audio-only render", () => {
    act(() => {
      useWorkflowStore.setState({ nodes: GRAPH.map((n) => (n.id === "node_2" ? { ...n, data: { ...n.data, output: "audio" } } : n)) })
    })
    const before = state().nodes
    let outcome = ""
    act(() => {
      outcome = replaceRenderNodeOnCanvas("node_2", SV, undo)
    })
    expect(outcome).toBe("refused")
    expect(state().nodes).toBe(before)
    expect(toastMock.error).toHaveBeenCalled()
  })

  it("refused while a run is in progress, and on a read-only canvas", () => {
    act(() => {
      useWorkflowStore.setState({ nodes: GRAPH.map((n) => (n.id === "node_3" ? { ...n, data: { ...n.data, executionStatus: "running" } } : n)) })
    })
    expect(replaceRenderNodeOnCanvas("node_2", SV, undo)).toBe("busy")
    act(() => {
      useWorkflowStore.setState({ nodes: GRAPH, isReadOnly: true })
    })
    expect(replaceRenderNodeOnCanvas("node_2", SV, undo)).toBe("read-only")
    expect(state().nodes).toBe(GRAPH)
  })

  it("moves the published app's items to the new node; Undo brings them back with the old node, Redo moves them again", () => {
    const ps = { runTarget: "workflow" as const, outputItems: [{ type: "node" as const, nodeId: "node_2" }], cardMeta: { node_2: { title: "The cut" } } }
    act(() => {
      useWorkflowStore.setState({ presentationSettings: ps })
    })
    act(() => {
      replaceRenderNodeOnCanvas("node_2", SV, undo)
    })
    tick()
    const newId = state().nodes.find((n) => n.type === SV)!.id
    expect(state().presentationSettings).toEqual({ ...ps, outputItems: [{ type: "node", nodeId: newId }], cardMeta: { [newId]: { title: "The cut" } } })
    undo()
    expect(state().nodes.some((n) => n.id === "node_2")).toBe(true)
    expect(state().presentationSettings).toEqual(ps)
    redo()
    expect(state().nodes.some((n) => n.id === newId)).toBe(true)
    expect(state().presentationSettings.outputItems).toEqual([{ type: "node", nodeId: newId }])
  })

  it("Back to Apply EDL: the same swap the other way, one undo step", () => {
    act(() => {
      replaceRenderNodeOnCanvas("node_2", SV, undo)
    })
    tick()
    const svId = state().nodes.find((n) => n.type === SV)!.id
    let outcome = ""
    act(() => {
      outcome = replaceRenderNodeOnCanvas(svId, AE, undo)
    })
    tick()
    expect(outcome).toBe("replaced")
    const back = state().nodes.find((n) => n.type === AE)!
    expect(back.data).toMatchObject({ label: "Render", quality: "proxy" })
    expect(state().edges.find((e) => e.id === "e2")).toMatchObject({ source: back.id, sourceHandle: "json" })
    expect(history().past).toHaveLength(2)
    undo()
    expect(state().nodes.some((n) => n.id === svId && n.type === SV)).toBe(true)
  })
})
