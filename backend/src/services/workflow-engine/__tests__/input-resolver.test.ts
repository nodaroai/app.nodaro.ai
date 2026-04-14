import { describe, it, expect, vi } from "vitest"
import { resolveNodeInputs, getListInputForNode } from "../input-resolver.js"
import type { SimpleNode, SimpleEdge, NodeExecutionState } from "../types.js"
import { selectListItems } from "../../../../../packages/shared/src/edge-range.js"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function node(id: string, type: string, data: Record<string, unknown> = {}): SimpleNode {
  return { id, type, data: { label: id, ...data } }
}

function edge(
  source: string,
  target: string,
  sourceHandle?: string | null,
  targetHandle?: string | null,
  data?: Record<string, unknown>,
): SimpleEdge {
  return {
    id: `${source}->${target}`,
    source,
    target,
    sourceHandle: sourceHandle ?? null,
    targetHandle: targetHandle ?? null,
    data,
  }
}

// ---------------------------------------------------------------------------
// resolveNodeInputs
// ---------------------------------------------------------------------------

describe("resolveNodeInputs", () => {
  it("resolves text prompt from upstream text-prompt node", () => {
    const target = node("t", "generate-image")
    const src = node("s", "text-prompt", { text: "a cat" })
    const allNodes = [src, target]
    const edges = [edge("s", "t")]
    const states: Record<string, NodeExecutionState> = {}

    const result = resolveNodeInputs(target, edges, states, allNodes)
    expect(result.prompt).toBe("a cat")
  })

  it("resolves text from completed state over source data", () => {
    const target = node("t", "generate-image")
    const src = node("s", "text-prompt", { text: "old" })
    const allNodes = [src, target]
    const edges = [edge("s", "t")]
    const states: Record<string, NodeExecutionState> = {
      s: { status: "completed", output: { text: "new from state" } },
    }

    const result = resolveNodeInputs(target, edges, states, allNodes)
    expect(result.prompt).toBe("new from state")
  })

  it("resolves imageUrl from generate-image source", () => {
    const target = node("t", "image-to-video")
    const src = node("s", "generate-image")
    const allNodes = [src, target]
    const edges = [edge("s", "t")]
    const states: Record<string, NodeExecutionState> = {
      s: { status: "completed", output: { imageUrl: "https://img.png" } },
    }

    const result = resolveNodeInputs(target, edges, states, allNodes)
    expect(result.imageUrl).toBe("https://img.png")
  })

  it("resolves videoUrl from video source", () => {
    const target = node("t", "trim-video")
    const src = node("s", "image-to-video")
    const allNodes = [src, target]
    const edges = [edge("s", "t")]
    const states: Record<string, NodeExecutionState> = {
      s: { status: "completed", output: { videoUrl: "https://vid.mp4" } },
    }

    const result = resolveNodeInputs(target, edges, states, allNodes)
    expect(result.videoUrl).toBe("https://vid.mp4")
  })

  it("resolves audioUrl from audio source", () => {
    const target = node("t", "merge-video-audio")
    const src = node("s", "text-to-speech")
    const allNodes = [src, target]
    const edges = [edge("s", "t")]
    const states: Record<string, NodeExecutionState> = {
      s: { status: "completed", output: { audioUrl: "https://aud.mp3" } },
    }

    const result = resolveNodeInputs(target, edges, states, allNodes)
    expect(result.audioSources).toBeDefined()
    expect(result.audioSources![0].url).toBe("https://aud.mp3")
  })

  it("routes to startFrameUrl via targetHandle", () => {
    const target = node("t", "image-to-video")
    const src = node("s", "generate-image")
    const allNodes = [src, target]
    const edges = [edge("s", "t", null, "startFrame")]
    const states: Record<string, NodeExecutionState> = {
      s: { status: "completed", output: { imageUrl: "https://start.png" } },
    }

    const result = resolveNodeInputs(target, edges, states, allNodes)
    expect(result.startFrameUrl).toBe("https://start.png")
  })

  it("routes to endFrameUrl via targetHandle", () => {
    const target = node("t", "image-to-video")
    const src = node("s", "generate-image")
    const allNodes = [src, target]
    const edges = [edge("s", "t", null, "endFrame")]
    const states: Record<string, NodeExecutionState> = {
      s: { status: "completed", output: { imageUrl: "https://end.png" } },
    }

    const result = resolveNodeInputs(target, edges, states, allNodes)
    expect(result.endFrameUrl).toBe("https://end.png")
  })

  it("routes to audioUrl via audio targetHandle", () => {
    const target = node("t", "image-to-video")
    const src = node("s", "text-to-speech")
    const allNodes = [src, target]
    const edges = [edge("s", "t", null, "audio")]
    const states: Record<string, NodeExecutionState> = {
      s: { status: "completed", output: { audioUrl: "https://aud.mp3" } },
    }

    const result = resolveNodeInputs(target, edges, states, allNodes)
    expect(result.audioUrl).toBe("https://aud.mp3")
  })

  it("routes to maskUrl via mask targetHandle", () => {
    const target = node("t", "image-to-image")
    const src = node("s", "generate-image")
    const allNodes = [src, target]
    const edges = [edge("s", "t", null, "mask")]
    const states: Record<string, NodeExecutionState> = {
      s: { status: "completed", output: { imageUrl: "https://mask.png" } },
    }

    const result = resolveNodeInputs(target, edges, states, allNodes)
    expect(result.maskUrl).toBe("https://mask.png")
  })

  it("accumulates videoUrls for combine-videos target", () => {
    const target = node("t", "combine-videos")
    const v1 = node("v1", "image-to-video")
    const v2 = node("v2", "image-to-video")
    const allNodes = [v1, v2, target]
    const edges = [edge("v1", "t"), edge("v2", "t")]
    const states: Record<string, NodeExecutionState> = {
      v1: { status: "completed", output: { videoUrl: "https://v1.mp4" } },
      v2: { status: "completed", output: { videoUrl: "https://v2.mp4" } },
    }

    const result = resolveNodeInputs(target, edges, states, allNodes)
    expect(result.videoUrls).toEqual(["https://v1.mp4", "https://v2.mp4"])
  })

  it("accumulates audioUrls for mix-audio target", () => {
    const target = node("t", "mix-audio")
    const a1 = node("a1", "text-to-speech")
    const a2 = node("a2", "generate-music")
    const allNodes = [a1, a2, target]
    const edges = [edge("a1", "t"), edge("a2", "t")]
    const states: Record<string, NodeExecutionState> = {
      a1: { status: "completed", output: { audioUrl: "https://a1.mp3" } },
      a2: { status: "completed", output: { audioUrl: "https://a2.mp3" } },
    }

    const result = resolveNodeInputs(target, edges, states, allNodes)
    expect(result.audioUrls).toEqual(["https://a1.mp3", "https://a2.mp3"])
  })

  it("routes suno-mashup to audioUrl and audioUrl2", () => {
    const target = node("t", "suno-mashup")
    const a1 = node("a1", "text-to-speech")
    const a2 = node("a2", "text-to-speech")
    const allNodes = [a1, a2, target]
    const edges = [edge("a1", "t"), edge("a2", "t")]
    const states: Record<string, NodeExecutionState> = {
      a1: { status: "completed", output: { audioUrl: "https://a1.mp3" } },
      a2: { status: "completed", output: { audioUrl: "https://a2.mp3" } },
    }

    const result = resolveNodeInputs(target, edges, states, allNodes)
    expect(result.audioUrl).toBe("https://a1.mp3")
    expect(result.audioUrl2).toBe("https://a2.mp3")
  })

  it("routes upload-image to referenceImageUrls for generate-image target", () => {
    const target = node("t", "generate-image")
    const src = node("s", "upload-image", { url: "https://ref.png" })
    const allNodes = [src, target]
    const edges = [edge("s", "t")]
    const states: Record<string, NodeExecutionState> = {}

    const result = resolveNodeInputs(target, edges, states, allNodes)
    expect(result.referenceImageUrls).toContain("https://ref.png")
  })

  it("routes entity nodes to referenceImageUrls (not imageUrl)", () => {
    const target = node("t", "generate-image")
    const charNode = node("c", "character")
    const allNodes = [charNode, target]
    const edges = [edge("c", "t")]
    const states: Record<string, NodeExecutionState> = {
      c: { status: "completed", output: { imageUrl: "https://char.png" } },
    }

    const result = resolveNodeInputs(target, edges, states, allNodes)
    expect(result.referenceImageUrls).toContain("https://char.png")
  })

  it("routes entity to imageUrl for lip-sync target", () => {
    const target = node("t", "lip-sync")
    const charNode = node("c", "character")
    const allNodes = [charNode, target]
    const edges = [edge("c", "t")]
    const states: Record<string, NodeExecutionState> = {
      c: { status: "completed", output: { imageUrl: "https://char.png" } },
    }

    const result = resolveNodeInputs(target, edges, states, allNodes)
    expect(result.imageUrl).toBe("https://char.png")
  })

  it("skips upstream nodes with no output", () => {
    const target = node("t", "generate-image")
    const src = node("s", "generate-image") // not a source node, no state
    const allNodes = [src, target]
    const edges = [edge("s", "t")]
    const states: Record<string, NodeExecutionState> = {}

    const result = resolveNodeInputs(target, edges, states, allNodes)
    expect(result.prompt).toBeUndefined()
    expect(result.imageUrl).toBeUndefined()
  })

  it("passes kieTaskId for extend-video target", () => {
    const target = node("t", "extend-video")
    const src = node("s", "image-to-video")
    const allNodes = [src, target]
    const edges = [edge("s", "t")]
    const states: Record<string, NodeExecutionState> = {
      s: { status: "completed", output: { videoUrl: "https://v.mp4", kieTaskId: "task-123" } },
    }

    const result = resolveNodeInputs(target, edges, states, allNodes)
    expect(result.videoUrl).toBe("https://v.mp4")
    expect(result.kieTaskId).toBe("task-123")
  })

  it("passes sunoTrackId for suno nodes", () => {
    const target = node("t", "suno-extend")
    const src = node("s", "suno-generate")
    const allNodes = [src, target]
    const edges = [edge("s", "t")]
    const states: Record<string, NodeExecutionState> = {
      s: { status: "completed", output: { audioUrl: "https://suno.mp3", sunoTrackId: "track-1", sunoTaskId: "task-1" } },
    }

    const result = resolveNodeInputs(target, edges, states, allNodes)
    expect(result.audioUrl).toBe("https://suno.mp3")
    expect(result.sunoTrackId).toBe("track-1")
    expect(result.sunoTaskId).toBe("task-1")
  })

  it("handles list node with edge outputMode 'all'", () => {
    const target = node("t", "generate-image")
    const listNode = node("l", "list", { items: "cat\ndog\nbird" })
    const allNodes = [listNode, target]
    const edges = [edge("l", "t", null, null, { outputMode: "all" })]
    const states: Record<string, NodeExecutionState> = {}

    const result = resolveNodeInputs(target, edges, states, allNodes)
    expect(result.prompt).toBe("cat, dog, bird")
  })

  it("handles list node with edge outputMode 'last'", () => {
    const target = node("t", "generate-image")
    const listNode = node("l", "list", { items: "cat\ndog\nbird" })
    const allNodes = [listNode, target]
    const edges = [edge("l", "t", null, null, { outputMode: "last" })]
    const states: Record<string, NodeExecutionState> = {}

    const result = resolveNodeInputs(target, edges, states, allNodes)
    expect(result.prompt).toBe("bird")
  })

  it("handles list node with edge outputMode 'item:1'", () => {
    const target = node("t", "generate-image")
    const listNode = node("l", "list", { items: "cat\ndog\nbird" })
    const allNodes = [listNode, target]
    const edges = [edge("l", "t", null, null, { outputMode: "item:1" })]
    const states: Record<string, NodeExecutionState> = {}

    const result = resolveNodeInputs(target, edges, states, allNodes)
    expect(result.prompt).toBe("dog")
  })

  it("routes webhook-trigger params by handle type", () => {
    const target = node("t", "generate-image")
    const whNode = node("wh", "webhook-trigger", {
      params: [
        { id: "p1", name: "prompt", type: "text" },
        { id: "p2", name: "image", type: "imageUrl" },
      ],
    })
    const allNodes = [whNode, target]
    const edges = [
      edge("wh", "t", "p1", null),
      edge("wh", "t", "p2", null),
    ]
    const states: Record<string, NodeExecutionState> = {
      wh: {
        status: "completed",
        output: {
          text: "hello",
          imageUrl: "https://img.png",
          paramOutputs: { p1: "hello", p2: "https://img.png" },
        },
      },
    }

    const result = resolveNodeInputs(target, edges, states, allNodes)
    // First param (text) is routed; second param (imageUrl) should be imageUrl
    // Both go through webhook routing logic
    expect(result.prompt).toBe("hello")
    expect(result.imageUrl).toBe("https://img.png")
  })

  it("routes social post node video input", () => {
    const target = node("t", "instagram-post")
    const vid = node("v", "image-to-video")
    const allNodes = [vid, target]
    const edges = [edge("v", "t")]
    const states: Record<string, NodeExecutionState> = {
      v: { status: "completed", output: { videoUrl: "https://vid.mp4" } },
    }

    const result = resolveNodeInputs(target, edges, states, allNodes)
    expect(result.videoUrl).toBe("https://vid.mp4")
  })

  it("resolves fan-out listResults as prompt text", () => {
    const target = node("t", "generate-image")
    const src = node("s", "split-text")
    const allNodes = [src, target]
    const edges = [edge("s", "t")]
    const states: Record<string, NodeExecutionState> = {
      s: { status: "completed", output: { text: "first", splitResults: ["first", "second", "third"], listResults: ["first", "second", "third"] } },
    }

    const result = resolveNodeInputs(target, edges, states, allNodes)
    // split-text is a TEXT_SOURCE_TYPE, so output routes to prompt
    expect(result.prompt).toBe("first")
  })

  it("resolves per-iteration prompt from modern list (columns+rows) during fan-out", () => {
    // Regression: Run-from-here on list → generate-image chain used to fail
    // with "Generation failed" because resolveNodeInputs didn't honor list
    // sources during fan-out — only loop sources got column routing.
    const target = node("t", "generate-image")
    const listNode = node("l", "list", {
      columns: [{ id: "c1", handleId: "col_c1", type: "text" }],
      rows: [["prompt a"], ["prompt b"], ["prompt c"]],
    })
    const allNodes = [listNode, target]
    const edges = [edge("l", "t", "col_c1", null, { outputMode: "each" })]

    const iter0 = resolveNodeInputs(target, edges, {}, allNodes, undefined, 0)
    const iter1 = resolveNodeInputs(target, edges, {}, allNodes, undefined, 1)
    const iter2 = resolveNodeInputs(target, edges, {}, allNodes, undefined, 2)

    expect(iter0.prompt).toBe("prompt a")
    expect(iter1.prompt).toBe("prompt b")
    expect(iter2.prompt).toBe("prompt c")
  })

  it("resolves per-iteration prompt with range filter (each + rangeFrom/rangeTo)", () => {
    // User scenario: list (5 items) → generate-image with "each 1..4"
    // Each iteration should see the N-th filtered item, not the N-th raw row.
    // If the range filter isn't applied per-iteration, iter 3 would try to
    // read row[3] ("p4") which happens to be the 4th selected item anyway…
    // But let's test with a range that shifts: "2..5" → iter 0 should be p2.
    const target = node("t", "generate-image")
    const listNode = node("l", "list", {
      columns: [{ id: "c1", handleId: "col_c1", type: "text" }],
      rows: [["p1"], ["p2"], ["p3"], ["p4"], ["p5"]],
    })
    const allNodes = [listNode, target]
    const edges = [edge("l", "t", "col_c1", null, {
      outputMode: "each",
      rangeFrom: "2",
      rangeTo: "5",
    })]

    const iter0 = resolveNodeInputs(target, edges, {}, allNodes, undefined, 0)
    const iter1 = resolveNodeInputs(target, edges, {}, allNodes, undefined, 1)
    const iter2 = resolveNodeInputs(target, edges, {}, allNodes, undefined, 2)
    const iter3 = resolveNodeInputs(target, edges, {}, allNodes, undefined, 3)

    expect(iter0.prompt).toBe("p2")
    expect(iter1.prompt).toBe("p3")
    expect(iter2.prompt).toBe("p4")
    expect(iter3.prompt).toBe("p5")
  })
})

// ---------------------------------------------------------------------------
// getListInputForNode
// ---------------------------------------------------------------------------

describe("getListInputForNode", () => {
  it("returns list items for upstream list node (legacy items string)", () => {
    const target = node("t", "generate-image")
    const listNode = node("l", "list", { items: "a\nb\nc" })
    const allNodes = [listNode, target]
    const edges = [edge("l", "t")]
    const states: Record<string, NodeExecutionState> = {}

    const result = getListInputForNode(target, edges, states, allNodes)
    expect(result).toEqual(["a", "b", "c"])
  })

  it("returns list items for upstream list node (modern columns + rows format)", () => {
    // Regression: the orchestrator used to only handle the legacy `items`
    // string format, so Run-from-here couldn't fan out over list nodes
    // built in the modern UI (which store data as columns + rows).
    const target = node("t", "generate-image")
    const listNode = node("l", "list", {
      columns: [{ id: "c1", handleId: "col_c1", type: "text" }],
      rows: [["prompt a"], ["prompt b"], ["prompt c"]],
    })
    const allNodes = [listNode, target]
    const edges = [edge("l", "t")]
    const states: Record<string, NodeExecutionState> = {}

    const result = getListInputForNode(target, edges, states, allNodes)
    expect(result).toEqual(["prompt a", "prompt b", "prompt c"])
  })

  it("applies range filter on modern list with each + rangeFrom/rangeTo", () => {
    // User scenario: list (5 items) → generate-image with "each 1..4"
    // Run from here returned only 1 result instead of 4.
    const target = node("t", "generate-image")
    const listNode = node("l", "list", {
      columns: [{ id: "c1", handleId: "col_c1", type: "text" }],
      rows: [["p1"], ["p2"], ["p3"], ["p4"], ["p5"]],
    })
    const allNodes = [listNode, target]
    const edges = [edge("l", "t", "col_c1", null, {
      outputMode: "each",
      rangeFrom: "1",
      rangeTo: "4",
    })]
    const states: Record<string, NodeExecutionState> = {}

    const result = getListInputForNode(target, edges, states, allNodes)
    expect(result).toEqual(["p1", "p2", "p3", "p4"])
  })

  it("returns undefined for single-item list", () => {
    const target = node("t", "generate-image")
    const listNode = node("l", "list", { items: "only one" })
    const allNodes = [listNode, target]
    const edges = [edge("l", "t")]

    const result = getListInputForNode(target, edges, {}, allNodes)
    expect(result).toBeUndefined()
  })

  it("returns split-text results from completed state", () => {
    const target = node("t", "generate-image")
    const splitNode = node("sp", "split-text")
    const allNodes = [splitNode, target]
    const edges = [edge("sp", "t")]
    const states: Record<string, NodeExecutionState> = {
      sp: { status: "completed", output: { splitResults: ["x", "y", "z"] } },
    }

    const result = getListInputForNode(target, edges, states, allNodes)
    expect(result).toEqual(["x", "y", "z"])
  })

  it("returns listResults from any upstream node with fan-out", () => {
    const target = node("t", "generate-image")
    const upstream = node("u", "generate-image")
    const allNodes = [upstream, target]
    const edges = [edge("u", "t", null, null, { outputMode: "each" })]
    const states: Record<string, NodeExecutionState> = {
      u: { status: "completed", output: { listResults: ["r1", "r2", "r3"] } },
    }

    const result = getListInputForNode(target, edges, states, allNodes)
    expect(result).toEqual(["r1", "r2", "r3"])
  })

  it("returns undefined when upstream has no list data", () => {
    const target = node("t", "generate-image")
    const src = node("s", "text-prompt", { text: "hello" })
    const allNodes = [src, target]
    const edges = [edge("s", "t")]

    const result = getListInputForNode(target, edges, {}, allNodes)
    expect(result).toBeUndefined()
  })

  it("respects outputMode != each — does not fan out", () => {
    const target = node("t", "generate-image")
    const src = node("s", "generate-image")
    const allNodes = [src, target]
    const edges = [edge("s", "t", null, null, { outputMode: "last" })]
    const states: Record<string, NodeExecutionState> = {
      s: { status: "completed", output: { listResults: ["r1", "r2", "r3"] } },
    }

    // outputMode is "last", not "each", so no fan-out
    const result = getListInputForNode(target, edges, states, allNodes)
    expect(result).toBeUndefined()
  })

  it("resolves loop node manual rows as list", () => {
    const target = node("t", "generate-image")
    const loopNode = node("l", "loop", {
      rows: [["alpha"], ["beta"], ["gamma"]],
      columns: [{ id: "c1", handleId: "col_0" }],
    })
    const allNodes = [loopNode, target]
    const edges = [edge("l", "t", "col_0")]

    const result = getListInputForNode(target, edges, {}, allNodes)
    expect(result).toEqual(["alpha", "beta", "gamma"])
  })

  it("returns undefined for no incoming edges", () => {
    const target = node("t", "generate-image")
    const result = getListInputForNode(target, [], {}, [target])
    expect(result).toBeUndefined()
  })
})

describe("selectListItems integration — List tab", () => {
  it("malformed list expression falls back to all items", () => {
    const items = ["a", "b", "c"]
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    expect(
      selectListItems(items, {
        selectorMode: "list",
        listExpression: "1..garbage",
      }),
    ).toEqual(items)
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it("honors rangeStep", () => {
    const items = ["a", "b", "c", "d", "e"]
    expect(
      selectListItems(items, { rangeStep: 2 }),
    ).toEqual(["a", "c", "e"])
    expect(
      selectListItems(items, { rangeFrom: "last", rangeTo: "1", rangeStep: -1 }),
    ).toEqual(["e", "d", "c", "b", "a"])
  })
})
