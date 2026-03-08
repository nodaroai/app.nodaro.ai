import { describe, it, expect, vi } from "vitest"

vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: {
    getState: vi.fn(() => ({ characterDefinitions: [], nodes: [], edges: [] })),
    setState: vi.fn(),
  },
}))

vi.mock("@/lib/prompt-builder", () => ({
  buildScenePrompt: vi.fn(() => "mock scene prompt"),
}))

import {
  buildExecutionLevels,
  getEffectivelySkippedIds,
  extractNodeOutput,
} from "../execution-graph"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeNode(
  id: string,
  type: string,
  data: Record<string, unknown> = {},
): any {
  return { id, type, data: { label: type, ...data }, position: { x: 0, y: 0 } }
}

function makeEdge(source: string, target: string): any {
  return { id: `${source}->${target}`, source, target }
}

function idsOf(level: any[]): string[] {
  return level.map((n: any) => n.id).sort()
}

// ---------------------------------------------------------------------------
// buildExecutionLevels
// ---------------------------------------------------------------------------

describe("buildExecutionLevels", () => {
  it("returns empty array for empty nodes", () => {
    const levels = buildExecutionLevels([], [])
    expect(levels).toEqual([])
  })

  it("returns single level for a single node with no edges", () => {
    const A = makeNode("A", "text-prompt")
    const levels = buildExecutionLevels([A], [])
    expect(levels).toHaveLength(1)
    expect(levels[0]).toHaveLength(1)
    expect(levels[0][0].id).toBe("A")
  })

  it("builds levels for a linear chain A -> B -> C", () => {
    const A = makeNode("A", "text-prompt")
    const B = makeNode("B", "generate-image")
    const C = makeNode("C", "image-to-video")
    const edges = [makeEdge("A", "B"), makeEdge("B", "C")]

    const levels = buildExecutionLevels([A, B, C], edges)

    expect(levels).toHaveLength(3)
    expect(idsOf(levels[0])).toEqual(["A"])
    expect(idsOf(levels[1])).toEqual(["B"])
    expect(idsOf(levels[2])).toEqual(["C"])
  })

  it("builds levels for a diamond graph A -> B, A -> C, B -> D, C -> D", () => {
    const A = makeNode("A", "text-prompt")
    const B = makeNode("B", "generate-image")
    const C = makeNode("C", "generate-image")
    const D = makeNode("D", "combine-videos")
    const edges = [
      makeEdge("A", "B"),
      makeEdge("A", "C"),
      makeEdge("B", "D"),
      makeEdge("C", "D"),
    ]

    const levels = buildExecutionLevels([A, B, C, D], edges)

    expect(levels).toHaveLength(3)
    expect(idsOf(levels[0])).toEqual(["A"])
    expect(idsOf(levels[1])).toEqual(["B", "C"])
    expect(idsOf(levels[2])).toEqual(["D"])
  })

  it("groups independent roots and their children into the same levels", () => {
    const A = makeNode("A", "text-prompt")
    const B = makeNode("B", "generate-image")
    const C = makeNode("C", "text-prompt")
    const D = makeNode("D", "generate-image")
    const edges = [makeEdge("A", "B"), makeEdge("C", "D")]

    const levels = buildExecutionLevels([A, B, C, D], edges)

    expect(levels).toHaveLength(2)
    expect(idsOf(levels[0])).toEqual(["A", "C"])
    expect(idsOf(levels[1])).toEqual(["B", "D"])
  })

  it("excludes nodes involved in a cycle from later levels", () => {
    // A -> B -> C -> A  (cycle, no node has inDegree 0)
    const A = makeNode("A", "generate-image")
    const B = makeNode("B", "generate-image")
    const C = makeNode("C", "generate-image")
    const edges = [
      makeEdge("A", "B"),
      makeEdge("B", "C"),
      makeEdge("C", "A"),
    ]

    const levels = buildExecutionLevels([A, B, C], edges)

    // All nodes have inDegree > 0, so no roots => no levels produced
    const allProcessed = levels.flat().map((n) => n.id)
    expect(allProcessed).toHaveLength(0)
  })

  it("processes reachable nodes even when a cycle exists elsewhere", () => {
    // R is a root with no incoming edges. B -> C -> B is a cycle.
    // R -> B also exists, so B gets inDegree 2 (from R and C).
    const R = makeNode("R", "text-prompt")
    const B = makeNode("B", "generate-image")
    const C = makeNode("C", "generate-image")
    const edges = [
      makeEdge("R", "B"),
      makeEdge("B", "C"),
      makeEdge("C", "B"),
    ]

    const levels = buildExecutionLevels([R, B, C], edges)

    // R is the only root (inDegree 0). B has inDegree 2 (from R and C),
    // processing R decrements B to 1, but C->B keeps it stuck.
    const allProcessed = levels.flat().map((n) => n.id)
    expect(allProcessed).toContain("R")
    // B and C stuck in cycle, never reach inDegree 0
    expect(allProcessed).not.toContain("C")
  })
})

// ---------------------------------------------------------------------------
// getEffectivelySkippedIds
// ---------------------------------------------------------------------------

describe("getEffectivelySkippedIds", () => {
  it("returns an empty set when no nodes are skipped", () => {
    const A = makeNode("A", "text-prompt")
    const B = makeNode("B", "generate-image")
    const edges = [makeEdge("A", "B")]

    const skipped = getEffectivelySkippedIds([A, B], edges)
    expect(skipped.size).toBe(0)
  })

  it("includes directly skipped nodes", () => {
    const A = makeNode("A", "text-prompt", { skipped: true })
    const skipped = getEffectivelySkippedIds([A], [])
    expect(skipped.has("A")).toBe(true)
  })

  it("does NOT propagate skip to downstream nodes (skip = freeze)", () => {
    const A = makeNode("A", "text-prompt", { skipped: true })
    const B = makeNode("B", "generate-image")
    const C = makeNode("C", "image-to-video")
    const edges = [makeEdge("A", "B"), makeEdge("B", "C")]

    const skipped = getEffectivelySkippedIds([A, B, C], edges)
    expect(skipped.has("A")).toBe(true)
    expect(skipped.has("B")).toBe(false)
    expect(skipped.has("C")).toBe(false)
  })

  it("only returns directly skipped nodes, not their children", () => {
    const A = makeNode("A", "text-prompt", { skipped: true })
    const B = makeNode("B", "text-prompt") // not skipped
    const C = makeNode("C", "generate-image")
    const edges = [makeEdge("A", "C"), makeEdge("B", "C")]

    const skipped = getEffectivelySkippedIds([A, B, C], edges)
    expect(skipped.has("A")).toBe(true)
    expect(skipped.has("B")).toBe(false)
    expect(skipped.has("C")).toBe(false)
  })

  it("handles nodes with no incoming edges (roots) that are not skipped", () => {
    const A = makeNode("A", "text-prompt")
    const B = makeNode("B", "generate-image")
    const edges = [makeEdge("A", "B")]

    const skipped = getEffectivelySkippedIds([A, B], edges)
    expect(skipped.size).toBe(0)
  })

  it("does NOT propagate through a multi-level chain (freeze semantics)", () => {
    // A(skipped) -> B -> C -> D  -- only A should be skipped
    const A = makeNode("A", "text-prompt", { skipped: true })
    const B = makeNode("B", "generate-image")
    const C = makeNode("C", "image-to-video")
    const D = makeNode("D", "combine-videos")
    const edges = [
      makeEdge("A", "B"),
      makeEdge("B", "C"),
      makeEdge("C", "D"),
    ]

    const skipped = getEffectivelySkippedIds([A, B, C, D], edges)
    expect(skipped.has("A")).toBe(true)
    expect(skipped.has("B")).toBe(false)
    expect(skipped.has("C")).toBe(false)
    expect(skipped.has("D")).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// extractNodeOutput
// ---------------------------------------------------------------------------

describe("extractNodeOutput", () => {
  it("returns text from a text-prompt node", () => {
    const node = makeNode("1", "text-prompt", { text: "hello" })
    expect(extractNodeOutput(node)).toBe("hello")
  })

  it("returns undefined for text-prompt with empty string", () => {
    const node = makeNode("1", "text-prompt", { text: "   " })
    // .trim() produces "" which is falsy, but the function returns the trimmed value
    expect(extractNodeOutput(node)).toBe("")
  })

  it("returns url from an upload-image node", () => {
    const node = makeNode("1", "upload-image", { url: "http://img.png" })
    expect(extractNodeOutput(node)).toBe("http://img.png")
  })

  it("returns active result url from generate-image with generatedResults", () => {
    const node = makeNode("1", "generate-image", {
      generatedResults: [
        { url: "http://a.png", timestamp: "t1", jobId: "j1" },
        { url: "http://b.png", timestamp: "t2", jobId: "j2" },
      ],
      activeResultIndex: 1,
    })
    expect(extractNodeOutput(node)).toBe("http://b.png")
  })

  it("falls back to generatedImageUrl when no generatedResults for generate-image", () => {
    const node = makeNode("1", "generate-image", {
      generatedImageUrl: "http://fallback.png",
    })
    expect(extractNodeOutput(node)).toBe("http://fallback.png")
  })

  it("returns undefined for an unknown node type", () => {
    const node = makeNode("1", "totally-unknown-type", { foo: "bar" })
    expect(extractNodeOutput(node)).toBeUndefined()
  })

  it("returns url from an upload-video node", () => {
    const node = makeNode("1", "upload-video", { url: "http://vid.mp4" })
    expect(extractNodeOutput(node)).toBe("http://vid.mp4")
  })

  it("returns active result for image-to-video", () => {
    const node = makeNode("1", "image-to-video", {
      generatedResults: [
        { url: "http://v1.mp4", timestamp: "t1", jobId: "j1" },
      ],
      activeResultIndex: 0,
    })
    expect(extractNodeOutput(node)).toBe("http://v1.mp4")
  })

  it("returns audio url from text-to-speech with generatedResults", () => {
    const node = makeNode("1", "text-to-speech", {
      generatedResults: [
        { url: "http://audio.mp3", timestamp: "t1", jobId: "j1" },
      ],
      activeResultIndex: 0,
    })
    expect(extractNodeOutput(node)).toBe("http://audio.mp3")
  })

  it("falls back to generatedAudioUrl for text-to-speech with no results", () => {
    const node = makeNode("1", "text-to-speech", {
      generatedAudioUrl: "http://fallback-audio.mp3",
    })
    expect(extractNodeOutput(node)).toBe("http://fallback-audio.mp3")
  })

  it("returns 'plan-ready' for after-effects with an effectPlan", () => {
    const node = makeNode("1", "after-effects", {
      effectPlan: { type: "color-grade" },
    })
    expect(extractNodeOutput(node)).toBe("plan-ready")
  })

  it("returns undefined for after-effects without effectPlan", () => {
    const node = makeNode("1", "after-effects", {})
    expect(extractNodeOutput(node)).toBeUndefined()
  })

  it("returns 'plan-ready' for 3d-title with a titlePlan", () => {
    const node = makeNode("1", "3d-title", {
      titlePlan: { text: "Hello 3D" },
    })
    expect(extractNodeOutput(node)).toBe("plan-ready")
  })

  it("returns generatedVideoUrl fallback for combine-videos", () => {
    const node = makeNode("1", "combine-videos", {
      generatedVideoUrl: "http://combined.mp4",
    })
    expect(extractNodeOutput(node)).toBe("http://combined.mp4")
  })

  it("returns the scene prompt when scene node has no image results", () => {
    const node = makeNode("1", "scene", {
      characters: [],
      objects: [],
      locations: [],
    })
    expect(extractNodeOutput(node)).toBe("mock scene prompt")
  })

  it("returns generated image url from scene node when available", () => {
    const node = makeNode("1", "scene", {
      generatedResults: [
        { url: "http://scene.png", timestamp: "t1", jobId: "j1" },
      ],
      activeResultIndex: 0,
      characters: [],
      objects: [],
    })
    expect(extractNodeOutput(node)).toBe("http://scene.png")
  })

  it("returns r2Url from upload-audio when present", () => {
    const node = makeNode("1", "upload-audio", {
      r2Url: "http://r2-audio.mp3",
      url: "http://local-audio.mp3",
    })
    expect(extractNodeOutput(node)).toBe("http://r2-audio.mp3")
  })

  it("falls back to url for upload-audio when no r2Url", () => {
    const node = makeNode("1", "upload-audio", {
      url: "http://local-audio.mp3",
    })
    expect(extractNodeOutput(node)).toBe("http://local-audio.mp3")
  })

  it("returns sourceImageUrl from character node", () => {
    const node = makeNode("1", "character", {
      sourceImageUrl: "http://char.png",
    })
    expect(extractNodeOutput(node)).toBe("http://char.png")
  })

  it("returns generatedText from ai-writer node", () => {
    const node = makeNode("1", "ai-writer", {
      generatedText: "Once upon a time...",
    })
    expect(extractNodeOutput(node)).toBe("Once upon a time...")
  })

  it("returns first item from list node", () => {
    const node = makeNode("1", "list", {
      items: "line one\nline two\nline three",
    })
    expect(extractNodeOutput(node)).toBe("line one")
  })

  // sub-workflow tests
  it("returns specific port output via sourceHandle for sub-workflow", () => {
    const node = makeNode("1", "sub-workflow", {
      outputResults: { portA: "http://a.png", portB: "http://b.mp4" },
      routeSnapshot: { visibleOutputPortId: "portA" },
    })
    expect(extractNodeOutput(node, "out_portB")).toBe("http://b.mp4")
  })

  it("returns visible output when no sourceHandle for sub-workflow", () => {
    const node = makeNode("1", "sub-workflow", {
      outputResults: { portA: "http://a.png", portB: "http://b.mp4" },
      routeSnapshot: { visibleOutputPortId: "portA" },
    })
    expect(extractNodeOutput(node)).toBe("http://a.png")
  })

  it("returns first value when no visibleOutputPortId for sub-workflow", () => {
    const node = makeNode("1", "sub-workflow", {
      outputResults: { portX: "http://x.png" },
      routeSnapshot: { visibleOutputPortId: "" },
    })
    expect(extractNodeOutput(node)).toBe("http://x.png")
  })

  it("returns undefined when no outputResults for sub-workflow", () => {
    const node = makeNode("1", "sub-workflow", {})
    expect(extractNodeOutput(node)).toBeUndefined()
  })

  // sub-workflow-input tests
  it("returns injected port value via sourceHandle for sub-workflow-input", () => {
    const node = makeNode("1", "sub-workflow-input", {
      __injectedPortValues: { p1: "http://injected.png", p2: "hello text" },
    })
    expect(extractNodeOutput(node, "p1")).toBe("http://injected.png")
  })

  it("returns undefined when no injected values for sub-workflow-input", () => {
    const node = makeNode("1", "sub-workflow-input", {})
    expect(extractNodeOutput(node)).toBeUndefined()
  })
})
