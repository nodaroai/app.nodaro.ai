import { getRouteReachableNodeIds } from "../route-filter.js"
import type { MinimalNode, MinimalEdge } from "../route-filter.js"
import {
  ITER_CLONE_PATTERN,
  isExpandedClone,
  filterCloneNodes,
} from "../clone-utils.js"
import {
  IMAGE_REF_TYPES,
  PASSTHROUGH_TYPES,
  collectAncestorRefs,
} from "../ancestor-refs.js"
import type { GenericNode, GenericEdge } from "../types.js"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mkNode(id: string, type: string, data: Record<string, unknown> = {}): MinimalNode {
  return { id, type, data }
}

function mkEdge(source: string, target: string): MinimalEdge {
  return { source, target }
}

function mkGenericNode(
  id: string,
  type: string,
  data: Record<string, unknown> = {},
  hidden?: boolean,
): GenericNode {
  return { id, type, data, ...(hidden !== undefined ? { hidden } : {}) }
}

function mkGenericEdge(source: string, target: string): GenericEdge {
  return { source, target }
}

// ---------------------------------------------------------------------------
// getRouteReachableNodeIds
// ---------------------------------------------------------------------------

describe("getRouteReachableNodeIds", () => {
  it("returns all nodes in a simple chain: input -> A -> B -> output", () => {
    const nodes = [
      mkNode("in", "sub-workflow-input", { routeId: "r1" }),
      mkNode("a", "generate-image", {}),
      mkNode("b", "ai-writer", {}),
      mkNode("out", "sub-workflow-output", { routeId: "r1" }),
    ]
    const edges = [
      mkEdge("in", "a"),
      mkEdge("a", "b"),
      mkEdge("b", "out"),
    ]

    const result = getRouteReachableNodeIds(nodes, edges, "r1")

    expect(result).toEqual(new Set(["in", "a", "b", "out"]))
  })

  it("includes all branches between input and output", () => {
    // input -> A -> B -> output
    // input -> C -------> output
    const nodes = [
      mkNode("in", "sub-workflow-input", { routeId: "r1" }),
      mkNode("a", "generate-image", {}),
      mkNode("b", "ai-writer", {}),
      mkNode("c", "text-prompt", {}),
      mkNode("out", "sub-workflow-output", { routeId: "r1" }),
    ]
    const edges = [
      mkEdge("in", "a"),
      mkEdge("a", "b"),
      mkEdge("b", "out"),
      mkEdge("in", "c"),
      mkEdge("c", "out"),
    ]

    const result = getRouteReachableNodeIds(nodes, edges, "r1")

    expect(result).toEqual(new Set(["in", "a", "b", "c", "out"]))
  })

  it("excludes disconnected nodes not on the route", () => {
    const nodes = [
      mkNode("in", "sub-workflow-input", { routeId: "r1" }),
      mkNode("a", "generate-image", {}),
      mkNode("out", "sub-workflow-output", { routeId: "r1" }),
      mkNode("d", "ai-writer", {}), // disconnected
    ]
    const edges = [
      mkEdge("in", "a"),
      mkEdge("a", "out"),
    ]

    const result = getRouteReachableNodeIds(nodes, edges, "r1")

    expect(result).toEqual(new Set(["in", "a", "out"]))
    expect(result.has("d")).toBe(false)
  })

  it("returns empty set when input node is missing", () => {
    const nodes = [
      mkNode("a", "generate-image", {}),
      mkNode("out", "sub-workflow-output", { routeId: "r1" }),
    ]
    const edges = [mkEdge("a", "out")]

    const result = getRouteReachableNodeIds(nodes, edges, "r1")

    expect(result.size).toBe(0)
  })

  it("returns empty set when output node is missing", () => {
    const nodes = [
      mkNode("in", "sub-workflow-input", { routeId: "r1" }),
      mkNode("a", "generate-image", {}),
    ]
    const edges = [mkEdge("in", "a")]

    const result = getRouteReachableNodeIds(nodes, edges, "r1")

    expect(result.size).toBe(0)
  })

  it("returns empty set for a stale routeId with no matching nodes", () => {
    const nodes = [
      mkNode("in", "sub-workflow-input", { routeId: "r1" }),
      mkNode("out", "sub-workflow-output", { routeId: "r1" }),
    ]
    const edges = [mkEdge("in", "out")]

    const result = getRouteReachableNodeIds(nodes, edges, "stale-id")

    expect(result.size).toBe(0)
  })

  it("always includes input and output even with no edges between them", () => {
    // Input and output exist but there is no path connecting them.
    // The intersection of forward-from-input and backward-from-output
    // would be empty, but the function explicitly adds both.
    const nodes = [
      mkNode("in", "sub-workflow-input", { routeId: "r1" }),
      mkNode("out", "sub-workflow-output", { routeId: "r1" }),
    ]
    const edges: MinimalEdge[] = [] // no edges at all

    const result = getRouteReachableNodeIds(nodes, edges, "r1")

    expect(result.has("in")).toBe(true)
    expect(result.has("out")).toBe(true)
  })

  it("excludes nodes only reachable forward but not backward to output", () => {
    // input -> A -> B (dead end, not connected to output)
    // input -> C -> output
    const nodes = [
      mkNode("in", "sub-workflow-input", { routeId: "r1" }),
      mkNode("a", "generate-image", {}),
      mkNode("b", "ai-writer", {}),
      mkNode("c", "text-prompt", {}),
      mkNode("out", "sub-workflow-output", { routeId: "r1" }),
    ]
    const edges = [
      mkEdge("in", "a"),
      mkEdge("a", "b"),
      mkEdge("in", "c"),
      mkEdge("c", "out"),
    ]

    const result = getRouteReachableNodeIds(nodes, edges, "r1")

    expect(result.has("in")).toBe(true)
    expect(result.has("c")).toBe(true)
    expect(result.has("out")).toBe(true)
    // a and b are forward-reachable from input but NOT backward-reachable from output
    expect(result.has("a")).toBe(false)
    expect(result.has("b")).toBe(false)
  })

  it("handles multiple routes independently", () => {
    const nodes = [
      mkNode("in1", "sub-workflow-input", { routeId: "r1" }),
      mkNode("a", "generate-image", {}),
      mkNode("out1", "sub-workflow-output", { routeId: "r1" }),
      mkNode("in2", "sub-workflow-input", { routeId: "r2" }),
      mkNode("b", "ai-writer", {}),
      mkNode("out2", "sub-workflow-output", { routeId: "r2" }),
    ]
    const edges = [
      mkEdge("in1", "a"),
      mkEdge("a", "out1"),
      mkEdge("in2", "b"),
      mkEdge("b", "out2"),
    ]

    const r1 = getRouteReachableNodeIds(nodes, edges, "r1")
    const r2 = getRouteReachableNodeIds(nodes, edges, "r2")

    expect(r1).toEqual(new Set(["in1", "a", "out1"]))
    expect(r2).toEqual(new Set(["in2", "b", "out2"]))
  })
})

// ---------------------------------------------------------------------------
// ITER_CLONE_PATTERN
// ---------------------------------------------------------------------------

describe("ITER_CLONE_PATTERN", () => {
  it("matches IDs ending with _iter_N", () => {
    expect(ITER_CLONE_PATTERN.test("node_7_iter_0")).toBe(true)
    expect(ITER_CLONE_PATTERN.test("node_7_iter_12")).toBe(true)
    expect(ITER_CLONE_PATTERN.test("abc_iter_999")).toBe(true)
  })

  it("does not match IDs without trailing _iter_N", () => {
    expect(ITER_CLONE_PATTERN.test("node_7")).toBe(false)
    expect(ITER_CLONE_PATTERN.test("node_iter_suffix_extra")).toBe(false)
    expect(ITER_CLONE_PATTERN.test("iter_0")).toBe(false)
    expect(ITER_CLONE_PATTERN.test("node_iter_")).toBe(false)
    expect(ITER_CLONE_PATTERN.test("")).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// isExpandedClone
// ---------------------------------------------------------------------------

describe("isExpandedClone", () => {
  it("returns true when __expandedClone flag is set", () => {
    const node = mkGenericNode("node_1", "generate-image", { __expandedClone: true })
    expect(isExpandedClone(node)).toBe(true)
  })

  it("returns true for node ID matching _iter_N pattern", () => {
    const node0 = mkGenericNode("node_7_iter_0", "generate-image")
    const node12 = mkGenericNode("node_7_iter_12", "generate-image")
    expect(isExpandedClone(node0)).toBe(true)
    expect(isExpandedClone(node12)).toBe(true)
  })

  it("returns false for a normal node", () => {
    const node = mkGenericNode("node_7", "generate-image")
    expect(isExpandedClone(node)).toBe(false)
  })

  it("returns false when ID has _iter_ but not at the end", () => {
    const node = mkGenericNode("node_iter_suffix_extra", "generate-image")
    expect(isExpandedClone(node)).toBe(false)
  })

  it("returns false when __expandedClone is falsy", () => {
    const node = mkGenericNode("node_1", "generate-image", { __expandedClone: false })
    expect(isExpandedClone(node)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// filterCloneNodes
// ---------------------------------------------------------------------------

describe("filterCloneNodes", () => {
  it("removes clone nodes and edges referencing them", () => {
    const nodes: GenericNode[] = [
      mkGenericNode("a", "generate-image"),
      mkGenericNode("a_iter_0", "generate-image", { __expandedClone: true }),
      mkGenericNode("a_iter_1", "generate-image", { __expandedClone: true }),
      mkGenericNode("b", "ai-writer"),
    ]
    const edges: GenericEdge[] = [
      mkGenericEdge("a", "b"),
      mkGenericEdge("a_iter_0", "b"),
      mkGenericEdge("a_iter_1", "b"),
    ]

    const result = filterCloneNodes(nodes, edges)

    expect(result.nodes.map((n) => n.id)).toEqual(["a", "b"])
    expect(result.edges).toEqual([mkGenericEdge("a", "b")])
  })

  it("unhides original hidden nodes", () => {
    const nodes: GenericNode[] = [
      mkGenericNode("a", "generate-image", {}, true), // hidden original
      mkGenericNode("a_iter_0", "generate-image", { __expandedClone: true }),
      mkGenericNode("b", "ai-writer"),
    ]
    const edges: GenericEdge[] = [
      mkGenericEdge("a", "b"),
      mkGenericEdge("a_iter_0", "b"),
    ]

    const result = filterCloneNodes(nodes, edges)

    const nodeA = result.nodes.find((n) => n.id === "a")!
    expect(nodeA.hidden).toBe(false)
  })

  it("does not modify non-hidden, non-clone nodes", () => {
    const original = mkGenericNode("a", "generate-image", { foo: "bar" })
    const nodes: GenericNode[] = [original]
    const edges: GenericEdge[] = []

    const result = filterCloneNodes(nodes, edges)

    // Should be the same reference (no spread), since hidden is undefined
    expect(result.nodes[0]).toBe(original)
    expect(result.nodes[0].data).toEqual({ foo: "bar" })
  })

  it("removes __sub_ prefixed nodes when filterSubWorkflow is true", () => {
    const nodes: GenericNode[] = [
      mkGenericNode("a", "generate-image"),
      mkGenericNode("__sub_inner_1", "ai-writer"),
      mkGenericNode("__sub_inner_2", "text-prompt"),
      mkGenericNode("b", "ai-writer"),
    ]
    // Edge filtering for sub-workflow checks the edge's own `id` property,
    // not source/target. Edges with __sub_ prefixed IDs are removed.
    const edges = [
      { source: "a", target: "b" },
      { source: "__sub_inner_1", target: "__sub_inner_2", id: "__sub_edge_1" },
    ] as (GenericEdge & { id?: string })[]

    const result = filterCloneNodes(nodes, edges, { filterSubWorkflow: true })

    expect(result.nodes.map((n) => n.id)).toEqual(["a", "b"])
    expect(result.edges).toHaveLength(1)
    expect(result.edges[0].source).toBe("a")
    expect(result.edges[0].target).toBe("b")
  })

  it("keeps __sub_ prefixed nodes when filterSubWorkflow is false/default", () => {
    const nodes: GenericNode[] = [
      mkGenericNode("a", "generate-image"),
      mkGenericNode("__sub_inner_1", "ai-writer"),
    ]
    const edges: GenericEdge[] = [mkGenericEdge("a", "__sub_inner_1")]

    const result = filterCloneNodes(nodes, edges)

    expect(result.nodes.map((n) => n.id)).toEqual(["a", "__sub_inner_1"])
    expect(result.edges).toHaveLength(1)
  })

  it("removes edges where source is a clone", () => {
    const nodes: GenericNode[] = [
      mkGenericNode("clone_iter_0", "generate-image"),
      mkGenericNode("b", "ai-writer"),
    ]
    const edges: GenericEdge[] = [mkGenericEdge("clone_iter_0", "b")]

    const result = filterCloneNodes(nodes, edges)

    expect(result.edges).toEqual([])
  })

  it("removes edges where target is a clone", () => {
    const nodes: GenericNode[] = [
      mkGenericNode("a", "generate-image"),
      mkGenericNode("target_iter_0", "ai-writer"),
    ]
    const edges: GenericEdge[] = [mkGenericEdge("a", "target_iter_0")]

    const result = filterCloneNodes(nodes, edges)

    expect(result.edges).toEqual([])
  })

  it("handles empty inputs", () => {
    const result = filterCloneNodes([], [])
    expect(result.nodes).toEqual([])
    expect(result.edges).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// IMAGE_REF_TYPES / PASSTHROUGH_TYPES constants
// ---------------------------------------------------------------------------

describe("IMAGE_REF_TYPES", () => {
  it("contains the expected image-producing node types", () => {
    const expected = [
      "upload-image", "face", "character", "object", "location",
      "generate-image", "edit-image", "image-to-image",
    ]
    for (const t of expected) {
      expect(IMAGE_REF_TYPES.has(t)).toBe(true)
    }
    expect(IMAGE_REF_TYPES.size).toBe(expected.length)
  })
})

describe("PASSTHROUGH_TYPES", () => {
  it("contains the expected passthrough node types", () => {
    const expected = ["ai-writer", "llm-chat", "split-text", "combine-text", "text-prompt", "loop", "list"]
    for (const t of expected) {
      expect(PASSTHROUGH_TYPES.has(t)).toBe(true)
    }
    expect(PASSTHROUGH_TYPES.size).toBe(expected.length)
  })
})

// ---------------------------------------------------------------------------
// collectAncestorRefs
// ---------------------------------------------------------------------------

describe("collectAncestorRefs", () => {
  const getImageUrl = (node: GenericNode): string | undefined =>
    node.data.imageUrl as string | undefined

  it("collects image URL from a direct image ancestor", () => {
    const nodes: GenericNode[] = [
      mkGenericNode("a", "upload-image", { imageUrl: "https://example.com/a.png" }),
      mkGenericNode("b", "generate-image"),
    ]
    const edges: GenericEdge[] = [mkGenericEdge("a", "b")]

    const refs = collectAncestorRefs("b", nodes, edges, getImageUrl)

    expect(refs).toEqual(["https://example.com/a.png"])
  })

  it("collects through passthrough nodes", () => {
    // A(upload-image) -> B(combine-text) -> C(generate-image)
    const nodes: GenericNode[] = [
      mkGenericNode("a", "upload-image", { imageUrl: "https://example.com/a.png" }),
      mkGenericNode("b", "combine-text"),
      mkGenericNode("c", "generate-image"),
    ]
    const edges: GenericEdge[] = [
      mkGenericEdge("a", "b"),
      mkGenericEdge("b", "c"),
    ]

    const refs = collectAncestorRefs("c", nodes, edges, getImageUrl)

    expect(refs).toEqual(["https://example.com/a.png"])
  })

  it("returns empty array when no image ancestors exist", () => {
    const nodes: GenericNode[] = [
      mkGenericNode("a", "ai-writer"),
      mkGenericNode("b", "text-prompt"),
      mkGenericNode("c", "generate-image"),
    ]
    const edges: GenericEdge[] = [
      mkGenericEdge("a", "b"),
      mkGenericEdge("b", "c"),
    ]

    const refs = collectAncestorRefs("c", nodes, edges, getImageUrl)

    expect(refs).toEqual([])
  })

  it("prevents infinite loops via visited set", () => {
    // Create a cycle: A -> B -> A
    const nodes: GenericNode[] = [
      mkGenericNode("a", "ai-writer"),
      mkGenericNode("b", "ai-writer"),
    ]
    const edges: GenericEdge[] = [
      mkGenericEdge("a", "b"),
      mkGenericEdge("b", "a"),
    ]

    // Should terminate without error
    const refs = collectAncestorRefs("b", nodes, edges, getImageUrl)
    expect(refs).toEqual([])
  })

  it("collects from multiple image ancestors", () => {
    // A(face) -> C
    // B(character) -> C
    const nodes: GenericNode[] = [
      mkGenericNode("a", "face", { imageUrl: "https://example.com/face.png" }),
      mkGenericNode("b", "character", { imageUrl: "https://example.com/char.png" }),
      mkGenericNode("c", "generate-image"),
    ]
    const edges: GenericEdge[] = [
      mkGenericEdge("a", "c"),
      mkGenericEdge("b", "c"),
    ]

    const refs = collectAncestorRefs("c", nodes, edges, getImageUrl)

    expect(refs).toHaveLength(2)
    expect(refs).toContain("https://example.com/face.png")
    expect(refs).toContain("https://example.com/char.png")
  })

  it("trims whitespace from URLs", () => {
    const nodes: GenericNode[] = [
      mkGenericNode("a", "upload-image", { imageUrl: "  https://example.com/a.png  " }),
      mkGenericNode("b", "generate-image"),
    ]
    const edges: GenericEdge[] = [mkGenericEdge("a", "b")]

    const refs = collectAncestorRefs("b", nodes, edges, getImageUrl)

    expect(refs).toEqual(["https://example.com/a.png"])
  })

  it("skips ancestors with empty or whitespace-only URLs", () => {
    const nodes: GenericNode[] = [
      mkGenericNode("a", "upload-image", { imageUrl: "" }),
      mkGenericNode("b", "upload-image", { imageUrl: "   " }),
      mkGenericNode("c", "upload-image", { imageUrl: undefined }),
      mkGenericNode("d", "generate-image"),
    ]
    const edges: GenericEdge[] = [
      mkGenericEdge("a", "d"),
      mkGenericEdge("b", "d"),
      mkGenericEdge("c", "d"),
    ]

    const refs = collectAncestorRefs("d", nodes, edges, getImageUrl)

    expect(refs).toEqual([])
  })

  it("does not traverse through non-passthrough, non-image nodes", () => {
    // A(upload-image) -> B(generate-video) -> C(generate-image)
    // generate-video is neither IMAGE_REF nor PASSTHROUGH, so traversal stops at B
    const nodes: GenericNode[] = [
      mkGenericNode("a", "upload-image", { imageUrl: "https://example.com/a.png" }),
      mkGenericNode("b", "generate-video"),
      mkGenericNode("c", "generate-image"),
    ]
    const edges: GenericEdge[] = [
      mkGenericEdge("a", "b"),
      mkGenericEdge("b", "c"),
    ]

    const refs = collectAncestorRefs("c", nodes, edges, getImageUrl)

    // B is generate-video: not an image type (no URL collected) and not a passthrough
    // (no further traversal), so A is never reached
    expect(refs).toEqual([])
  })

  it("traverses through multiple chained passthrough nodes", () => {
    // A(upload-image) -> B(ai-writer) -> C(split-text) -> D(loop) -> E(generate-image)
    const nodes: GenericNode[] = [
      mkGenericNode("a", "upload-image", { imageUrl: "https://example.com/deep.png" }),
      mkGenericNode("b", "ai-writer"),
      mkGenericNode("c", "split-text"),
      mkGenericNode("d", "loop"),
      mkGenericNode("e", "generate-image"),
    ]
    const edges: GenericEdge[] = [
      mkGenericEdge("a", "b"),
      mkGenericEdge("b", "c"),
      mkGenericEdge("c", "d"),
      mkGenericEdge("d", "e"),
    ]

    const refs = collectAncestorRefs("e", nodes, edges, getImageUrl)

    expect(refs).toEqual(["https://example.com/deep.png"])
  })

  it("accepts a pre-populated visited set to skip already-seen passthrough nodes", () => {
    // The visited set prevents re-entering collectAncestorRefs for a given node.
    // This matters for passthrough nodes which recurse. IMAGE_REF_TYPES are
    // collected inline without recursion, so visited only blocks passthrough traversal.
    // A(upload-image) -> B(ai-writer) -> C(generate-image)
    const nodes: GenericNode[] = [
      mkGenericNode("a", "upload-image", { imageUrl: "https://example.com/a.png" }),
      mkGenericNode("b", "ai-writer"),
      mkGenericNode("c", "generate-image"),
    ]
    const edges: GenericEdge[] = [
      mkGenericEdge("a", "b"),
      mkGenericEdge("b", "c"),
    ]

    // Pre-mark "b" as visited so recursion into it is skipped
    const visited = new Set(["b"])
    const refs = collectAncestorRefs("c", nodes, edges, getImageUrl, visited)

    // B is a passthrough but already visited, so collectAncestorRefs won't recurse into it,
    // and A (behind B) is never reached
    expect(refs).toEqual([])
  })

  it("handles all IMAGE_REF_TYPES correctly", () => {
    const imageTypes = [
      "upload-image", "face", "character", "object",
      "location", "generate-image", "edit-image", "image-to-image",
    ]

    for (const type of imageTypes) {
      const nodes: GenericNode[] = [
        mkGenericNode("src", type, { imageUrl: `https://example.com/${type}.png` }),
        mkGenericNode("target", "generate-video"),
      ]
      const edges: GenericEdge[] = [mkGenericEdge("src", "target")]

      const refs = collectAncestorRefs("target", nodes, edges, getImageUrl)
      expect(refs).toEqual([`https://example.com/${type}.png`])
    }
  })

  it("handles node with no incoming edges", () => {
    const nodes: GenericNode[] = [
      mkGenericNode("a", "generate-image"),
    ]
    const edges: GenericEdge[] = []

    const refs = collectAncestorRefs("a", nodes, edges, getImageUrl)

    expect(refs).toEqual([])
  })
})
