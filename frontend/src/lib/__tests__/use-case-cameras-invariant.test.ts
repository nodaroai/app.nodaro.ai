/**
 * The Cameras settings of a use-case node follow its wires (decided
 * 2026-10-17): an invariant of the graph the workflow store keeps in the
 * same write as the change, panel open or not — a wide camera or an
 * override naming a camera no longer wired is dropped, and the recordings
 * order forgets a node no longer wired. A graph adopted as stored is taken as
 * it is; nothing to fix writes nothing.
 */
import { afterEach, describe, expect, it, vi } from "vitest"
import { act } from "@testing-library/react"

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }) }))

import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { adoptedAsStored } from "@/hooks/workflow-store-adopted"
import { usecaseCamerasGraph } from "@/lib/use-case-cameras-invariant"
import type { WorkflowEdge, WorkflowNode } from "@/types/nodes"

const up = (id: string, type = "upload-video") => ({ id, type, position: { x: 0, y: 0 }, data: { label: id } }) as unknown as WorkflowNode
const tighten = (data: Record<string, unknown>) => ({ id: "t", type: "tighten-episode", position: { x: 0, y: 0 }, data: { label: "T", ...data } }) as unknown as WorkflowNode
const wire = (source: string, sourceHandle = "video", targetHandle = "media") => ({ id: `${source}-${targetHandle}`, source, sourceHandle, target: "t", targetHandle }) as unknown as WorkflowEdge
const dataOf = (nodes: readonly WorkflowNode[]) => nodes.find((n) => n.id === "t")!.data as Record<string, unknown>

afterEach(() => {
  act(() => useWorkflowStore.setState({ nodes: [], edges: [], isDirty: false, isReadOnly: false }))
})

describe("usecaseCamerasGraph", () => {
  it("a wide camera past the recordings wired is cleared", () => {
    const r = usecaseCamerasGraph([up("a"), up("b"), tighten({ cameras: { wide: 3, synced: true } })], [wire("a"), wire("b")])
    expect(r.changed).toBe(true)
    expect(dataOf(r.nodes).cameras).toEqual({ wide: null, synced: true })
  })
  it("a wide camera on a sound-only recording is cleared", () => {
    const r = usecaseCamerasGraph([up("a"), up("m", "upload-audio"), tighten({ cameras: { wide: 2 } })], [wire("a"), wire("m", "audio")])
    expect(dataOf(r.nodes).cameras).toEqual({ wide: null })
  })
  it("an override naming camera 3 of two is removed; the wide shot (0) and a camera wired stay", () => {
    const r = usecaseCamerasGraph([up("a"), up("b"), tighten({ cameras: { speakerCameras: { "1": 3, "2": 0, "3": 2 } } })], [wire("a"), wire("b")])
    expect(dataOf(r.nodes).cameras).toEqual({ speakerCameras: { "2": 0, "3": 2 } })
  })
  it("the recordings order forgets a node no longer wired", () => {
    const r = usecaseCamerasGraph([up("a"), up("b"), tighten({ mediaOrder: ["gone", "b", "a"] })], [wire("a"), wire("b")])
    expect(dataOf(r.nodes).mediaOrder).toEqual(["b", "a"])
  })
  it("counted by the type's own limit, whoever the viewer: camera 2 of two stays (an admin's choice survives availability loading)", () => {
    const nodes = [up("a"), up("b"), tighten({ cameras: { wide: 2, speakerCameras: { "1": 2 } }, mediaOrder: ["b", "a"] })]
    const r = usecaseCamerasGraph(nodes, [wire("a"), wire("b")])
    expect(r.changed).toBe(false)
    expect(r.nodes).toBe(nodes)
  })
  it("a Master audio is not a camera: wide 2 with one camera and a master is cleared", () => {
    const r = usecaseCamerasGraph([up("a"), up("m", "upload-audio"), tighten({ cameras: { wide: 2 } })], [wire("a"), wire("m", "audio", "masterAudio")])
    expect(dataOf(r.nodes).cameras).toEqual({ wide: null })
  })
  it("nothing wired: nothing is judged (a paste or a rewire in two steps keeps the settings)", () => {
    const nodes = [tighten({ cameras: { wide: 3 }, mediaOrder: ["a", "b"] })]
    expect(usecaseCamerasGraph(nodes, []).nodes).toBe(nodes)
  })
  it("a value it cannot read is left as it is (the run ignores it)", () => {
    const nodes = [up("a"), tighten({ cameras: "not cameras", mediaOrder: "a" })]
    expect(usecaseCamerasGraph(nodes, [wire("a")]).nodes).toBe(nodes)
  })
  it("nothing to fix: changed false and the very same objects", () => {
    const nodes = [up("a"), up("b"), tighten({ cameras: { wide: 1 }, mediaOrder: ["a", "b"] }), up("other", "text-prompt")]
    const r = usecaseCamerasGraph(nodes, [wire("a"), wire("b")])
    expect(r).toEqual({ nodes, changed: false })
    expect(r.nodes).toBe(nodes)
  })
})

describe("the store keeps it on every write", () => {
  it("removing a camera's wire drops the wide shot it was and forgets it in the order, in that same write", () => {
    act(() => useWorkflowStore.setState({ nodes: [up("a"), up("b"), tighten({ cameras: { wide: 2 }, mediaOrder: ["b", "a"] })], edges: [wire("a"), wire("b")] }))
    act(() => useWorkflowStore.setState({ edges: useWorkflowStore.getState().edges.filter((e) => e.source !== "b") }))
    expect(dataOf(useWorkflowStore.getState().nodes)).toMatchObject({ cameras: { wide: null }, mediaOrder: ["a"] })
  })
  it("a graph adopted as stored is taken as it is; the next local write fixes it", () => {
    act(() => useWorkflowStore.setState(adoptedAsStored({ nodes: [up("a"), tighten({ cameras: { wide: 3 } })], edges: [wire("a")] })))
    expect(dataOf(useWorkflowStore.getState().nodes).cameras).toEqual({ wide: 3 })
    act(() => useWorkflowStore.getState().updateNodeData("t", { label: "T2" }))
    expect(dataOf(useWorkflowStore.getState().nodes).cameras).toEqual({ wide: null })
  })
})
