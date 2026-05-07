import { describe, it, expect } from "vitest"
import {
  getUpstreamDuration,
  getCombineUpstreamDurations,
} from "../upstream-duration"
import type { WorkflowNode, WorkflowEdge } from "@/types/nodes"

function makeNode(id: string, type: string, data: Record<string, unknown>): WorkflowNode {
  return { id, type, position: { x: 0, y: 0 }, data } as unknown as WorkflowNode
}

function makeEdge(source: string, target: string, targetHandle: string = "in"): WorkflowEdge {
  return { id: `${source}->${target}`, source, target, targetHandle } as unknown as WorkflowEdge
}

describe("getUpstreamDuration", () => {
  it("reads generatedResults[activeResultIndex].duration", () => {
    const upstream = makeNode("u1", "image-to-video", {
      generatedResults: [{ url: "x", timestamp: "", jobId: "j1", duration: 7 }],
      activeResultIndex: 0,
    })
    const target = makeNode("t1", "loop-video", {})
    const edges = [makeEdge("u1", "t1")]
    expect(getUpstreamDuration("t1", [upstream, target], edges)).toBe(7)
  })

  it("falls back to data.duration when no generated results", () => {
    const upstream = makeNode("u1", "image-to-video", { duration: 5 })
    const target = makeNode("t1", "loop-video", {})
    const edges = [makeEdge("u1", "t1")]
    expect(getUpstreamDuration("t1", [upstream, target], edges)).toBe(5)
  })

  it("returns undefined when upstream has neither", () => {
    const upstream = makeNode("u1", "upload-video", {})
    const target = makeNode("t1", "loop-video", {})
    const edges = [makeEdge("u1", "t1")]
    expect(getUpstreamDuration("t1", [upstream, target], edges)).toBeUndefined()
  })

  it("returns undefined when no incoming edge", () => {
    const target = makeNode("t1", "loop-video", {})
    expect(getUpstreamDuration("t1", [target], [])).toBeUndefined()
  })

  it("prefers generatedResults[activeIdx].duration over data.duration", () => {
    const upstream = makeNode("u1", "image-to-video", {
      duration: 99,
      generatedResults: [{ url: "x", timestamp: "", jobId: "j1", duration: 3 }],
      activeResultIndex: 0,
    })
    const target = makeNode("t1", "loop-video", {})
    const edges = [makeEdge("u1", "t1")]
    expect(getUpstreamDuration("t1", [upstream, target], edges)).toBe(3)
  })
})

describe("getCombineUpstreamDurations", () => {
  it("returns durations in clipOrder when present", () => {
    const u1 = makeNode("u1", "image-to-video", { duration: 5 })
    const u2 = makeNode("u2", "image-to-video", { duration: 10 })
    const target = makeNode("t1", "combine-videos", { clipOrder: ["u2", "u1"] })
    const edges = [makeEdge("u1", "t1"), makeEdge("u2", "t1")]
    expect(getCombineUpstreamDurations(target, [u1, u2, target], edges)).toEqual([10, 5])
  })

  it("returns durations by edge order when clipOrder is empty", () => {
    const u1 = makeNode("u1", "image-to-video", { duration: 5 })
    const u2 = makeNode("u2", "image-to-video", { duration: 10 })
    const target = makeNode("t1", "combine-videos", {})
    // edges declared with stable id ordering
    const edges = [makeEdge("u1", "t1"), makeEdge("u2", "t1")]
    expect(getCombineUpstreamDurations(target, [u1, u2, target], edges)).toEqual([5, 10])
  })

  it("includes undefined for upstreams missing duration", () => {
    const u1 = makeNode("u1", "upload-video", {})
    const u2 = makeNode("u2", "image-to-video", { duration: 10 })
    const target = makeNode("t1", "combine-videos", { clipOrder: ["u1", "u2"] })
    const edges = [makeEdge("u1", "t1"), makeEdge("u2", "t1")]
    expect(getCombineUpstreamDurations(target, [u1, u2, target], edges)).toEqual([undefined, 10])
  })
})
