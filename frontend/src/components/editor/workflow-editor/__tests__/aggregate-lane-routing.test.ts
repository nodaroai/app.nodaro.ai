/**
 * Group / Collect lane routing in the frontend input resolver.
 *
 * An aggregate's value flows out of a typed LANE (out-text / out-image /
 * out-video / out-audio). resolveNodeInputs must route it into the consumer by
 * that lane's media type — the same slot the equivalent upload node fills —
 * not by the source node type. Before this branch existed the aggregate
 * matched no source-type branch and its value was silently dropped for every
 * consumer except the image-collage choke point.
 *
 * Mirrors backend input-resolver-aggregate-lanes.test — the two resolvers must
 * agree. Goes through the real store (loadWorkflow) because the aggregate
 * extractors read live nodes/edges from useWorkflowStore.getState().
 */

import { describe, expect, it, beforeEach } from "vitest"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { resolveNodeInputs } from "../node-input-resolver"
import type { WorkflowNode, WorkflowEdge } from "@/types/nodes"

beforeEach(() => {
  useWorkflowStore.getState().loadWorkflow("t", "Test", [], [])
})

type Kind = "image" | "video" | "audio" | "text"

/** Collect fed by one producer of `kind` (with a ready result) → consumer of `targetType`. */
function load(kind: Kind, targetType: string, targetHandle: string): { target: WorkflowNode; nodes: WorkflowNode[]; edges: WorkflowEdge[] } {
  const producers: Record<Kind, [string, Record<string, unknown>]> = {
    image: ["generate-image", { generatedResults: [{ url: "https://cdn/a.png" }], activeResultIndex: 0 }],
    video: ["upload-video", { url: "https://cdn/a.mp4" }],
    audio: ["upload-audio", { url: "https://cdn/a.mp3" }],
    text: ["text-prompt", { text: "alpha" }],
  }
  const [type, data] = producers[kind]
  const nodes = [
    { id: "p1", type, position: { x: 0, y: 0 }, data: { label: "P", ...data } },
    { id: "c", type: "collect", position: { x: 0, y: 0 }, data: { label: "Collect", order: ["p1"] } },
    { id: "t", type: targetType, position: { x: 0, y: 0 }, data: { label: "T" } },
  ] as never[]
  const edges = [
    { id: "e1", source: "p1", target: "c", targetHandle: "in" },
    { id: "e2", source: "c", sourceHandle: `out-${kind}`, target: "t", targetHandle },
  ] as never[]
  useWorkflowStore.getState().loadWorkflow("wf", "Test", nodes, edges)
  const s = useWorkflowStore.getState()
  const target = s.nodes.find((n) => n.id === "t") as WorkflowNode
  return { target, nodes: s.nodes as WorkflowNode[], edges: s.edges as WorkflowEdge[] }
}

describe("frontend node-input-resolver — group/collect lane routing", () => {
  it("out-image → image-collage accumulates into imageUrls (choke point still wins)", () => {
    const { target, nodes, edges } = load("image", "image-collage", "in")
    const r = resolveNodeInputs(target, nodes, edges)
    expect(r.imageUrls).toEqual(["https://cdn/a.png"])
    expect(r.prompt).toBeUndefined()
  })

  it("out-image → lip-sync lands in imageUrl, NOT prompt", () => {
    const { target, nodes, edges } = load("image", "lip-sync", "image")
    const r = resolveNodeInputs(target, nodes, edges)
    expect(r.imageUrl).toBe("https://cdn/a.png")
    expect(r.prompt).toBeUndefined()
  })

  it("out-image → generate-image references lands in referenceImageUrls", () => {
    const { target, nodes, edges } = load("image", "generate-image", "references")
    const r = resolveNodeInputs(target, nodes, edges)
    expect(r.referenceImageUrls).toEqual(["https://cdn/a.png"])
    expect(r.imageUrl).toBeUndefined()
  })

  it("out-video → combine-videos accumulates into videoUrls with source ids", () => {
    const { target, nodes, edges } = load("video", "combine-videos", "in")
    const r = resolveNodeInputs(target, nodes, edges)
    expect(r.videoUrls).toEqual(["https://cdn/a.mp4"])
    expect(r.videoUrlsWithSourceIds?.[0]).toMatchObject({ nodeId: "c", url: "https://cdn/a.mp4" })
    expect(r.prompt).toBeUndefined()
  })

  it("out-video → trim-video lands in videoUrl", () => {
    const { target, nodes, edges } = load("video", "trim-video", "in")
    const r = resolveNodeInputs(target, nodes, edges)
    expect(r.videoUrl).toBe("https://cdn/a.mp4")
  })

  it("out-audio → mix-audio accumulates into audioUrls", () => {
    const { target, nodes, edges } = load("audio", "mix-audio", "in")
    const r = resolveNodeInputs(target, nodes, edges)
    expect(r.audioUrls).toEqual(["https://cdn/a.mp3"])
  })

  it("out-audio → merge-video-audio lands in audioSources", () => {
    const { target, nodes, edges } = load("audio", "merge-video-audio", "in")
    const r = resolveNodeInputs(target, nodes, edges)
    expect(r.audioSources?.[0]).toMatchObject({ url: "https://cdn/a.mp3", sourceNodeId: "c" })
  })

  it("out-text → generate-image lands in prompt", () => {
    const { target, nodes, edges } = load("text", "generate-image", "prompt")
    const r = resolveNodeInputs(target, nodes, edges)
    expect(r.prompt).toBe("alpha")
  })

  it("group out-image → lip-sync routes by lane exactly like collect", () => {
    useWorkflowStore.getState().loadWorkflow("wf", "Test",
      [
        { id: "g", type: "group", position: { x: 0, y: 0 }, data: { label: "G" } },
        { id: "m", type: "generate-image", position: { x: 0, y: 10 }, data: { generatedResults: [{ url: "https://cdn/g.png" }], activeResultIndex: 0 }, parentId: "g" },
        { id: "t", type: "lip-sync", position: { x: 0, y: 0 }, data: { label: "T" } },
      ] as never[],
      [{ id: "e", source: "g", sourceHandle: "out-image", target: "t", targetHandle: "image" }] as never[],
    )
    const s = useWorkflowStore.getState()
    const target = s.nodes.find((n) => n.id === "t") as WorkflowNode
    const r = resolveNodeInputs(target, s.nodes as WorkflowNode[], s.edges as WorkflowEdge[])
    expect(r.imageUrl).toBe("https://cdn/g.png")
    expect(r.prompt).toBeUndefined()
  })
})

describe("frontend node-input-resolver — group/collect → Choose Best (fan-in) fold", () => {
  it("collect out-image → reduce receives EVERY bucket item as inputs.inputs", () => {
    useWorkflowStore.getState().loadWorkflow("wf", "Test",
      [
        { id: "p1", type: "generate-image", position: { x: 0, y: 0 }, data: { generatedResults: [{ url: "https://cdn/a.png" }], activeResultIndex: 0 } },
        { id: "p2", type: "generate-image", position: { x: 0, y: 0 }, data: { generatedResults: [{ url: "https://cdn/b.png" }], activeResultIndex: 0 } },
        { id: "p3", type: "generate-image", position: { x: 0, y: 0 }, data: { generatedResults: [{ url: "https://cdn/c.png" }], activeResultIndex: 0 } },
        { id: "c", type: "collect", position: { x: 0, y: 0 }, data: { label: "Collect", order: ["p1", "p2", "p3"] } },
        { id: "t", type: "reduce", position: { x: 0, y: 0 }, data: { label: "Choose Best", strategyId: "pick-best-llm", strategyConfig: {} } },
      ] as never[],
      [
        { id: "e1", source: "p1", target: "c", targetHandle: "in" },
        { id: "e2", source: "p2", target: "c", targetHandle: "in" },
        { id: "e3", source: "p3", target: "c", targetHandle: "in" },
        { id: "e4", source: "c", sourceHandle: "out-image", target: "t", targetHandle: "in" },
      ] as never[],
    )
    const s = useWorkflowStore.getState()
    const target = s.nodes.find((n) => n.id === "t") as WorkflowNode
    const r = resolveNodeInputs(target, s.nodes as WorkflowNode[], s.edges as WorkflowEdge[])
    expect(r.inputs).toEqual(["https://cdn/a.png", "https://cdn/b.png", "https://cdn/c.png"])
  })

  it("collect with ONE image → reduce still receives that single item", () => {
    const { target, nodes, edges } = load("image", "reduce", "in")
    const r = resolveNodeInputs(target, nodes, edges)
    expect(r.inputs).toEqual(["https://cdn/a.png"])
  })
})
