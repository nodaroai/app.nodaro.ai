/**
 * "Add face tracking" on Speaker View (P3-17 (c)): Speaker Frames inserted and
 * wired to the same edit and transcript Speaker View reads, its Face tracks
 * into Speaker View's `tracks` — pure, so the canvas applies it as one step.
 */
import { describe, expect, it } from "vitest"
import { planAddFaceTracking, FACE_TRACKING_OFFSET } from "../add-face-tracking"
import type { WorkflowEdge, WorkflowNode } from "@/types/nodes"

const node = (id: string, type: string, data: Record<string, unknown> = {}) => ({ id, type, position: { x: 1000, y: 200 }, data: { label: id, ...data } }) as unknown as WorkflowNode
const edge = (id: string, source: string, sourceHandle: string, target: string, targetHandle: string, data?: Record<string, unknown>) =>
  ({ id, source, sourceHandle, target, targetHandle, ...(data ? { data } : {}) }) as unknown as WorkflowEdge

const GRAPH = {
  nodes: [node("cs", "camera-switch"), node("sv", "speaker-view")],
  edges: [edge("e1", "cs", "edl", "sv", "edl", { outputMode: "each" }), edge("e2", "cs", "transcript", "sv", "transcript")],
}
const FRAMES = { id: "node_9", data: { label: "Speaker Frames", fieldMappings: {} } }

describe("planAddFaceTracking", () => {
  it("adds Speaker Frames on the same edit and transcript, and wires its tracks into Speaker View", () => {
    const out = planAddFaceTracking(GRAPH, "sv", FRAMES)
    if (!out.ok) throw new Error(out.reason)
    const added = out.nodes.find((n) => n.id === "node_9")!
    expect(added.type).toBe("speaker-frames")
    expect(added.position).toEqual({ x: 1000 + FACE_TRACKING_OFFSET.x, y: 200 + FACE_TRACKING_OFFSET.y })
    const fresh = out.edges.slice(GRAPH.edges.length).map(({ source, sourceHandle, target, targetHandle }) => ({ source, sourceHandle, target, targetHandle }))
    expect(fresh).toEqual([
      { source: "cs", sourceHandle: "edl", target: "node_9", targetHandle: "edl" },
      { source: "cs", sourceHandle: "transcript", target: "node_9", targetHandle: "transcript" },
      { source: "node_9", sourceHandle: "tracks", target: "sv", targetHandle: "tracks" },
    ])
  })

  it("copies the edit wire without its fan-out setting: a clip pack folds into one Speaker Frames run (P3-24 (a))", () => {
    const out = planAddFaceTracking(GRAPH, "sv", FRAMES)
    if (!out.ok) throw new Error(out.reason)
    expect(out.edges.find((e) => e.target === "node_9" && e.targetHandle === "edl")!.data).toBeUndefined()
  })

  it("carries an edit and transcript typed into Speaker View", () => {
    const out = planAddFaceTracking({ nodes: [node("sv", "speaker-view", { edl: "{\"x\":1}", transcript: "{}" })], edges: [] }, "sv", FRAMES)
    if (!out.ok) throw new Error(out.reason)
    expect(out.nodes.find((n) => n.id === "node_9")!.data).toMatchObject({ edl: "{\"x\":1}", transcript: "{}" })
  })

  it("refuses when tracks are already wired, when no edit is read, and on any other node", () => {
    const wired = { ...GRAPH, edges: [...GRAPH.edges, edge("e3", "x", "tracks", "sv", "tracks")] }
    expect(planAddFaceTracking(wired, "sv", FRAMES)).toEqual({ ok: false, reason: "already-wired" })
    expect(planAddFaceTracking({ nodes: [node("sv", "speaker-view")], edges: [] }, "sv", FRAMES)).toEqual({ ok: false, reason: "no-edit" })
    expect(planAddFaceTracking(GRAPH, "cs", FRAMES)).toEqual({ ok: false, reason: "not-speaker-view" })
  })

  it("never changes the graph it is given", () => {
    const before = JSON.stringify(GRAPH)
    planAddFaceTracking(GRAPH, "sv", FRAMES)
    expect(JSON.stringify(GRAPH)).toBe(before)
  })
})
