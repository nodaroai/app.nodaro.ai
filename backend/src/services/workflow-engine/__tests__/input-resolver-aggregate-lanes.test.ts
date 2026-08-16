/**
 * Group / Collect lane routing in the backend input resolver.
 *
 * An aggregate's value flows out of a typed LANE (out-text / out-image /
 * out-video / out-audio). The resolver must route it into the consumer by that
 * lane's media type — the same slot the equivalent upload node would fill —
 * not by the source node type. Before this branch existed the aggregate
 * matched no source-type branch and landed in the "treat as prompt" fallback,
 * so a Collect image feeding Combine Videos / lip-sync arrived as
 * `inputs.prompt` on server-side (scheduled / MCP / published-app) runs.
 *
 * Mirrors frontend node-input-resolver.test — the two resolvers must agree.
 */

import { describe, it, expect } from "vitest"
import { resolveNodeInputs } from "../input-resolver.js"
import type { SimpleNode, SimpleEdge, NodeExecutionState } from "../types.js"

function node(id: string, type: string, data: Record<string, unknown> = {}, parentId?: string): SimpleNode {
  return { id, type, data: { label: id, ...data }, ...(parentId ? { parentId } : {}) }
}

function edge(source: string, target: string, sourceHandle?: string | null, targetHandle?: string | null): SimpleEdge {
  return { id: `${source}->${target}:${sourceHandle ?? ""}`, source, target, sourceHandle: sourceHandle ?? null, targetHandle: targetHandle ?? null }
}

const NO_STATES: Record<string, NodeExecutionState> = {}

/** A Collect wired from two upstream producers of the given type, each with a
 *  ready result on its data — the state a saved workflow carries. */
function collectOf(kind: "image" | "video" | "audio" | "text"): { nodes: SimpleNode[]; edges: SimpleEdge[] } {
  const producers: Record<typeof kind, [string, Record<string, unknown>]> = {
    image: ["generate-image", { generatedImageUrl: "https://cdn/a.png" }],
    video: ["upload-video", { url: "https://cdn/a.mp4" }],
    audio: ["upload-audio", { url: "https://cdn/a.mp3" }],
    text: ["text-prompt", { text: "alpha" }],
  }
  const [type, data] = producers[kind]
  const p1 = node("p1", type, data)
  const c = node("c", "collect", { order: ["p1"] })
  return { nodes: [p1, c], edges: [edge("p1", "c", undefined, "in")] }
}

describe("backend input-resolver — group/collect lane routing", () => {
  it("out-image → image-collage accumulates into imageUrls (choke point still wins)", () => {
    const { nodes, edges } = collectOf("image")
    const target = node("t", "image-collage")
    const all = [...nodes, target]
    const r = resolveNodeInputs(target, [...edges, edge("c", "t", "out-image", "in")], NO_STATES, all)
    expect(r.imageUrls).toEqual(["https://cdn/a.png"])
    expect(r.prompt).toBeUndefined()
  })

  it("out-image → lip-sync lands in imageUrl, NOT prompt", () => {
    const { nodes, edges } = collectOf("image")
    const target = node("t", "lip-sync")
    const all = [...nodes, target]
    const r = resolveNodeInputs(target, [...edges, edge("c", "t", "out-image", "image")], NO_STATES, all)
    expect(r.imageUrl).toBe("https://cdn/a.png")
    expect(r.prompt).toBeUndefined()
  })

  it("out-image → generate-image references lands in referenceImageUrls", () => {
    const { nodes, edges } = collectOf("image")
    const target = node("t", "generate-image")
    const all = [...nodes, target]
    const r = resolveNodeInputs(target, [...edges, edge("c", "t", "out-image", "references")], NO_STATES, all)
    expect(r.referenceImageUrls).toEqual(["https://cdn/a.png"])
    expect(r.imageUrl).toBeUndefined()
  })

  it("out-video → combine-videos accumulates into videoUrls with source ids", () => {
    const { nodes, edges } = collectOf("video")
    const target = node("t", "combine-videos")
    const all = [...nodes, target]
    const r = resolveNodeInputs(target, [...edges, edge("c", "t", "out-video", "in")], NO_STATES, all)
    expect(r.videoUrls).toEqual(["https://cdn/a.mp4"])
    expect(r.videoUrlsWithSourceIds?.[0]).toMatchObject({ nodeId: "c", url: "https://cdn/a.mp4" })
    expect(r.prompt).toBeUndefined()
  })

  it("out-video → trim-video lands in videoUrl", () => {
    const { nodes, edges } = collectOf("video")
    const target = node("t", "trim-video")
    const all = [...nodes, target]
    const r = resolveNodeInputs(target, [...edges, edge("c", "t", "out-video", "in")], NO_STATES, all)
    expect(r.videoUrl).toBe("https://cdn/a.mp4")
  })

  it("out-audio → mix-audio accumulates into audioUrls", () => {
    const { nodes, edges } = collectOf("audio")
    const target = node("t", "mix-audio")
    const all = [...nodes, target]
    const r = resolveNodeInputs(target, [...edges, edge("c", "t", "out-audio", "in")], NO_STATES, all)
    expect(r.audioUrls).toEqual(["https://cdn/a.mp3"])
  })

  it("out-audio → merge-video-audio lands in audioSources", () => {
    const { nodes, edges } = collectOf("audio")
    const target = node("t", "merge-video-audio")
    const all = [...nodes, target]
    const r = resolveNodeInputs(target, [...edges, edge("c", "t", "out-audio", "in")], NO_STATES, all)
    expect(r.audioSources?.[0]).toMatchObject({ url: "https://cdn/a.mp3", sourceNodeId: "c" })
  })

  it("out-text → generate-image lands in prompt", () => {
    const { nodes, edges } = collectOf("text")
    const target = node("t", "generate-image")
    const all = [...nodes, target]
    const r = resolveNodeInputs(target, [...edges, edge("c", "t", "out-text", "prompt")], NO_STATES, all)
    expect(r.prompt).toBe("alpha")
  })

  it("group out-image → lip-sync routes by lane exactly like collect", () => {
    const g = node("g", "group", {})
    const member = node("m", "generate-image", { generatedImageUrl: "https://cdn/g.png" }, "g")
    const target = node("t", "lip-sync")
    const all = [g, member, target]
    const r = resolveNodeInputs(target, [edge("g", "t", "out-image", "image")], NO_STATES, all)
    expect(r.imageUrl).toBe("https://cdn/g.png")
    expect(r.prompt).toBeUndefined()
  })
})

describe("backend input-resolver — group/collect → Choose Best (fan-in) fold", () => {
  it("collect out-image → reduce receives EVERY bucket item as inputs.inputs", () => {
    const p1 = node("p1", "generate-image", { generatedImageUrl: "https://cdn/a.png" })
    const p2 = node("p2", "generate-image", { generatedImageUrl: "https://cdn/b.png" })
    const p3 = node("p3", "generate-image", { generatedImageUrl: "https://cdn/c.png" })
    const c = node("c", "collect", { order: ["p1", "p2", "p3"] })
    const t = node("t", "reduce", { strategyId: "pick-best-llm", strategyConfig: {} })
    const all = [p1, p2, p3, c, t]
    const edges = [
      edge("p1", "c", undefined, "in"),
      edge("p2", "c", undefined, "in"),
      edge("p3", "c", undefined, "in"),
      edge("c", "t", "out-image", "in"),
    ]
    const r = resolveNodeInputs(t, edges, NO_STATES, all)
    expect(r.inputs).toEqual(["https://cdn/a.png", "https://cdn/b.png", "https://cdn/c.png"])
  })

  it("collect with ONE image → reduce still receives that single item (scalar bucket)", () => {
    const { nodes, edges } = collectOf("image")
    const t = node("t", "reduce", { strategyId: "concat", strategyConfig: {} })
    const r = resolveNodeInputs(t, [...edges, edge("c", "t", "out-image", "in")], NO_STATES, [...nodes, t])
    expect(r.inputs).toEqual(["https://cdn/a.png"])
  })

  it("collect out-text → reduce receives the text bucket, honouring data.order", () => {
    const p1 = node("p1", "text-prompt", { text: "first" })
    const p2 = node("p2", "text-prompt", { text: "second" })
    const c = node("c", "collect", { order: ["p2", "p1"] })
    const t = node("t", "reduce", { strategyId: "concat", strategyConfig: {} })
    const edges = [edge("p1", "c", undefined, "in"), edge("p2", "c", undefined, "in"), edge("c", "t", "out-text", "in")]
    const r = resolveNodeInputs(t, edges, NO_STATES, [p1, p2, c, t])
    expect(r.inputs).toEqual(["second", "first"])
  })

  it("group out-image → reduce receives every member's image", () => {
    const g = node("g", "group", {})
    const m1 = node("m1", "generate-image", { generatedImageUrl: "https://cdn/g1.png" }, "g")
    const m2 = node("m2", "generate-image", { generatedImageUrl: "https://cdn/g2.png" }, "g")
    const t = node("t", "reduce", { strategyId: "pick-best-llm", strategyConfig: {} })
    const r = resolveNodeInputs(t, [edge("g", "t", "out-image", "in")], NO_STATES, [g, m1, m2, t])
    expect(r.inputs).toEqual(["https://cdn/g1.png", "https://cdn/g2.png"])
  })
})
