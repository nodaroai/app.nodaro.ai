import { describe, it, expect } from "vitest"
import {
  buildExecutionLevels,
  getEffectivelySkippedIds,
  isSourceNode,
  isSkipNode,
  getUploadDescendantIds,
  IMAGE_SOURCE_TYPES,
  VIDEO_SOURCE_TYPES,
  AUDIO_SOURCE_TYPES,
  TEXT_SOURCE_TYPES,
} from "../execution-graph.js"
import type { SimpleNode, SimpleEdge } from "../types.js"

function node(id: string, type = "generate-image", data: Record<string, unknown> = {}): SimpleNode {
  return { id, type, data: { label: id, ...data } }
}

function edge(source: string, target: string): SimpleEdge {
  return { id: `${source}->${target}`, source, target, sourceHandle: null, targetHandle: null }
}

describe("buildExecutionLevels", () => {
  it("returns empty array for empty graph", () => {
    expect(buildExecutionLevels([], [])).toEqual([])
  })

  it("puts all independent nodes in one level", () => {
    const levels = buildExecutionLevels([node("a"), node("b"), node("c")], [])
    expect(levels).toHaveLength(1)
    expect(levels[0]).toHaveLength(3)
  })

  it("builds correct levels for linear chain A -> B -> C", () => {
    const nodes = [node("a"), node("b"), node("c")]
    const edges = [edge("a", "b"), edge("b", "c")]
    const levels = buildExecutionLevels(nodes, edges)
    expect(levels).toHaveLength(3)
    expect(levels[0].map((n) => n.id)).toEqual(["a"])
    expect(levels[1].map((n) => n.id)).toEqual(["b"])
    expect(levels[2].map((n) => n.id)).toEqual(["c"])
  })

  it("builds correct levels for diamond DAG", () => {
    const nodes = [node("a"), node("b"), node("c"), node("d")]
    const edges = [edge("a", "b"), edge("a", "c"), edge("b", "d"), edge("c", "d")]
    const levels = buildExecutionLevels(nodes, edges)
    expect(levels).toHaveLength(3)
    expect(levels[0].map((n) => n.id)).toEqual(["a"])
    expect(levels[1].map((n) => n.id).sort()).toEqual(["b", "c"])
    expect(levels[2].map((n) => n.id)).toEqual(["d"])
  })

  it("ignores edges with missing source or target nodes", () => {
    const nodes = [node("a"), node("b")]
    const edges = [edge("a", "b"), edge("a", "missing"), edge("missing", "b")]
    const levels = buildExecutionLevels(nodes, edges)
    expect(levels).toHaveLength(2)
  })

  it("handles disconnected subgraphs", () => {
    const nodes = [node("a"), node("b"), node("c"), node("d")]
    const edges = [edge("a", "b"), edge("c", "d")]
    const levels = buildExecutionLevels(nodes, edges)
    expect(levels).toHaveLength(2)
    expect(levels[0].map((n) => n.id).sort()).toEqual(["a", "c"])
    expect(levels[1].map((n) => n.id).sort()).toEqual(["b", "d"])
  })

  it("promotes nodes when preResolvedNodeIds skips their dependency edges", () => {
    const nodes = [node("source"), node("a"), node("b")]
    const edges = [edge("source", "a"), edge("source", "b")]
    const preResolved = new Set(["source"])
    const levels = buildExecutionLevels(nodes, edges, preResolved)
    expect(levels).toHaveLength(1)
    const ids = levels[0].map((n) => n.id).sort()
    expect(ids).toContain("a")
    expect(ids).toContain("b")
  })

  it("partially promotes when some deps are pre-resolved", () => {
    const nodes = [node("a"), node("b"), node("c")]
    const edges = [edge("a", "c"), edge("b", "c")]
    const preResolved = new Set(["a"])
    const levels = buildExecutionLevels(nodes, edges, preResolved)
    expect(levels).toHaveLength(2)
    expect(levels[0].map((n) => n.id).sort()).toEqual(["a", "b"])
    expect(levels[1].map((n) => n.id)).toEqual(["c"])
  })

  it("deduplicates children in same level", () => {
    const nodes = [node("a"), node("b"), node("c")]
    const edges = [edge("a", "c"), edge("b", "c")]
    const levels = buildExecutionLevels(nodes, edges)
    expect(levels[1].map((n) => n.id)).toEqual(["c"])
  })

  it("handles single node", () => {
    const levels = buildExecutionLevels([node("a")], [])
    expect(levels).toHaveLength(1)
    expect(levels[0]).toHaveLength(1)
  })
})

describe("getEffectivelySkippedIds", () => {
  it("returns empty set for no skipped nodes", () => {
    expect(getEffectivelySkippedIds([node("a"), node("b")], []).size).toBe(0)
  })

  it("returns only directly-skipped node IDs", () => {
    const nodes = [
      node("a", "generate-image", { skipped: true }),
      node("b"),
      node("c", "generate-image", { skipped: true }),
    ]
    const result = getEffectivelySkippedIds(nodes, [])
    expect(result.size).toBe(2)
    expect(result.has("a")).toBe(true)
    expect(result.has("c")).toBe(true)
    expect(result.has("b")).toBe(false)
  })

  it("treats falsy skipped value as not skipped", () => {
    const nodes = [
      node("a", "generate-image", { skipped: false }),
      node("b", "generate-image", { skipped: undefined }),
    ]
    expect(getEffectivelySkippedIds(nodes, []).size).toBe(0)
  })
})

describe("isSourceNode", () => {
  it("returns true for all source node types", () => {
    for (const t of ["text-prompt", "upload-image", "upload-video", "upload-audio", "youtube-video", "reference-audio", "list", "loop", "webhook-trigger", "schedule-trigger", "sub-workflow-input"]) {
      expect(isSourceNode(t)).toBe(true)
    }
  })

  it("returns false for non-source types", () => {
    expect(isSourceNode("generate-image")).toBe(false)
    expect(isSourceNode("combine-text")).toBe(false)
  })
})

describe("isSkipNode", () => {
  it("returns true for skip types", () => {
    expect(isSkipNode("manual-edit")).toBe(true)
    expect(isSkipNode("sub-workflow-output")).toBe(true)
  })

  it("returns false for non-skip types", () => {
    expect(isSkipNode("generate-image")).toBe(false)
  })
})

describe("getUploadDescendantIds", () => {
  it("returns empty set when no upload nodes", () => {
    const result = getUploadDescendantIds([node("a"), node("b")], [edge("a", "b")])
    expect(result.size).toBe(0)
  })

  it("finds direct descendants", () => {
    const nodes = [node("u1", "upload-image"), node("gen1")]
    const result = getUploadDescendantIds(nodes, [edge("u1", "gen1")])
    expect(result.has("gen1")).toBe(true)
    expect(result.has("u1")).toBe(false)
  })

  it("finds transitive descendants", () => {
    const nodes = [node("u1", "upload-video"), node("a"), node("b"), node("c")]
    const edges = [edge("u1", "a"), edge("a", "b"), edge("b", "c")]
    const result = getUploadDescendantIds(nodes, edges)
    expect(result.has("a")).toBe(true)
    expect(result.has("b")).toBe(true)
    expect(result.has("c")).toBe(true)
  })

  it("handles cycles without infinite loop", () => {
    const nodes = [node("u1", "upload-image"), node("a"), node("b")]
    const edges = [edge("u1", "a"), edge("a", "b"), edge("b", "a")]
    const result = getUploadDescendantIds(nodes, edges)
    expect(result.has("a")).toBe(true)
    expect(result.has("b")).toBe(true)
  })

  it("handles all upload types", () => {
    for (const t of ["upload-image", "upload-video", "upload-audio"]) {
      const result = getUploadDescendantIds([node("u", t), node("c")], [edge("u", "c")])
      expect(result.has("c")).toBe(true)
    }
  })
})

describe("media type sets", () => {
  it("IMAGE_SOURCE_TYPES includes key types", () => {
    expect(IMAGE_SOURCE_TYPES.has("generate-image")).toBe(true)
    expect(IMAGE_SOURCE_TYPES.has("upload-image")).toBe(true)
    expect(IMAGE_SOURCE_TYPES.has("scene")).toBe(true)
  })

  it("VIDEO_SOURCE_TYPES includes key types", () => {
    expect(VIDEO_SOURCE_TYPES.has("image-to-video")).toBe(true)
    expect(VIDEO_SOURCE_TYPES.has("render-video")).toBe(true)
    expect(VIDEO_SOURCE_TYPES.has("combine-videos")).toBe(true)
  })

  it("AUDIO_SOURCE_TYPES includes key types", () => {
    expect(AUDIO_SOURCE_TYPES.has("text-to-speech")).toBe(true)
    expect(AUDIO_SOURCE_TYPES.has("generate-music")).toBe(true)
  })

  it("TEXT_SOURCE_TYPES includes key types", () => {
    expect(TEXT_SOURCE_TYPES.has("text-prompt")).toBe(true)
    expect(TEXT_SOURCE_TYPES.has("ai-writer")).toBe(true)
    expect(TEXT_SOURCE_TYPES.has("list")).toBe(true)
  })
})
