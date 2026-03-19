import { describe, it, expect } from "vitest"
import {
  executeCombineText,
  executeSplitText,
  executeComposite,
  executePreview,
} from "../inline-executor.js"
import type { SimpleNode, SimpleEdge, NodeExecutionState } from "../types.js"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function node(id: string, type: string, data: Record<string, unknown> = {}): SimpleNode {
  return { id, type, data }
}

function edge(
  source: string,
  target: string,
  sourceHandle?: string,
  targetHandle?: string,
): SimpleEdge {
  return {
    id: `${source}->${target}`,
    source,
    target,
    sourceHandle: sourceHandle ?? null,
    targetHandle: targetHandle ?? null,
  }
}

// ---------------------------------------------------------------------------
// executeCombineText
// ---------------------------------------------------------------------------

describe("executeCombineText", () => {
  it("combines texts with default newline separator", () => {
    const target = node("combine", "combine-text", {})
    const allNodes = [
      node("a", "text-prompt", { text: "hello" }),
      node("b", "text-prompt", { text: "world" }),
      target,
    ]
    const edges = [edge("a", "combine"), edge("b", "combine")]
    const states: Record<string, NodeExecutionState> = {
      a: { status: "completed", output: { text: "hello" } },
      b: { status: "completed", output: { text: "world" } },
    }

    const result = executeCombineText(target, edges, allNodes, states)
    expect(result.text).toBe("hello\nworld")
    expect(result.combinedText).toBe("hello\nworld")
  })

  it("uses comma separator", () => {
    const target = node("combine", "combine-text", { separator: "comma" })
    const allNodes = [node("a", "text-prompt"), target]
    const edges = [edge("a", "combine")]
    const states: Record<string, NodeExecutionState> = {
      a: { status: "completed", output: { text: "one" } },
    }

    const result = executeCombineText(target, edges, allNodes, states)
    expect(result.text).toBe("one")
  })

  it("uses double-newline separator", () => {
    const target = node("combine", "combine-text", { separator: "double-newline" })
    const allNodes = [
      node("a", "text-prompt"),
      node("b", "text-prompt"),
      target,
    ]
    const edges = [edge("a", "combine"), edge("b", "combine")]
    const states: Record<string, NodeExecutionState> = {
      a: { status: "completed", output: { text: "para1" } },
      b: { status: "completed", output: { text: "para2" } },
    }

    const result = executeCombineText(target, edges, allNodes, states)
    expect(result.text).toBe("para1\n\npara2")
  })

  it("uses space separator", () => {
    const target = node("combine", "combine-text", { separator: "space" })
    const allNodes = [node("a", "text-prompt"), node("b", "text-prompt"), target]
    const edges = [edge("a", "combine"), edge("b", "combine")]
    const states: Record<string, NodeExecutionState> = {
      a: { status: "completed", output: { text: "hello" } },
      b: { status: "completed", output: { text: "world" } },
    }

    const result = executeCombineText(target, edges, allNodes, states)
    expect(result.text).toBe("hello world")
  })

  it("uses custom separator", () => {
    const target = node("combine", "combine-text", { separator: "custom", customSeparator: " | " })
    const allNodes = [node("a", "text-prompt"), node("b", "text-prompt"), target]
    const edges = [edge("a", "combine"), edge("b", "combine")]
    const states: Record<string, NodeExecutionState> = {
      a: { status: "completed", output: { text: "x" } },
      b: { status: "completed", output: { text: "y" } },
    }

    const result = executeCombineText(target, edges, allNodes, states)
    expect(result.text).toBe("x | y")
  })

  it("handles no upstream nodes", () => {
    const target = node("combine", "combine-text", {})
    const result = executeCombineText(target, [], [target], {})
    expect(result.text).toBe("")
    expect(result.combinedText).toBe("")
  })

  it("filters empty texts", () => {
    const target = node("combine", "combine-text", {})
    const allNodes = [node("a", "text-prompt"), node("b", "text-prompt"), target]
    const edges = [edge("a", "combine"), edge("b", "combine")]
    const states: Record<string, NodeExecutionState> = {
      a: { status: "completed", output: { text: "  " } },
      b: { status: "completed", output: { text: "valid" } },
    }

    const result = executeCombineText(target, edges, allNodes, states)
    expect(result.text).toBe("valid")
  })

  it("expands listResults from fan-out nodes", () => {
    const target = node("combine", "combine-text", { separator: "comma" })
    const allNodes = [node("fan", "generate-image"), target]
    const edges = [edge("fan", "combine")]
    const states: Record<string, NodeExecutionState> = {
      fan: { status: "completed", output: { listResults: ["img1.png", "img2.png", "img3.png"] } },
    }

    const result = executeCombineText(target, edges, allNodes, states)
    expect(result.text).toBe("img1.png, img2.png, img3.png")
  })

  it("reads source node data when no state exists", () => {
    const target = node("combine", "combine-text", {})
    const allNodes = [node("src", "text-prompt", { text: "from data" }), target]
    const edges = [edge("src", "combine")]
    const states: Record<string, NodeExecutionState> = {}

    const result = executeCombineText(target, edges, allNodes, states)
    expect(result.text).toBe("from data")
  })
})

// ---------------------------------------------------------------------------
// executeSplitText
// ---------------------------------------------------------------------------

describe("executeSplitText", () => {
  it("splits by default delimiter (===NEXT===)", () => {
    const target = node("split", "split-text", {})
    const allNodes = [node("a", "text-prompt"), target]
    const edges = [edge("a", "split")]
    const states: Record<string, NodeExecutionState> = {
      a: { status: "completed", output: { text: "part1===NEXT===part2===NEXT===part3" } },
    }

    const result = executeSplitText(target, {}, edges, allNodes, states)
    expect(result.splitResults).toEqual(["part1", "part2", "part3"])
    expect(result.text).toBe("part1")
    expect(result.listResults).toEqual(["part1", "part2", "part3"])
  })

  it("splits by custom delimiter", () => {
    const target = node("split", "split-text", { separator: "---" })
    const allNodes = [node("a", "text-prompt"), target]
    const edges = [edge("a", "split")]
    const states: Record<string, NodeExecutionState> = {
      a: { status: "completed", output: { text: "alpha---beta---gamma" } },
    }

    const result = executeSplitText(target, {}, edges, allNodes, states)
    expect(result.splitResults).toEqual(["alpha", "beta", "gamma"])
  })

  it("trims whitespace by default", () => {
    const target = node("split", "split-text", { separator: "|" })
    const allNodes = [node("a", "text-prompt"), target]
    const edges = [edge("a", "split")]
    const states: Record<string, NodeExecutionState> = {
      a: { status: "completed", output: { text: "  x  |  y  |  z  " } },
    }

    const result = executeSplitText(target, {}, edges, allNodes, states)
    expect(result.splitResults).toEqual(["x", "y", "z"])
  })

  it("removes empty parts by default", () => {
    const target = node("split", "split-text", { separator: "|" })
    const allNodes = [node("a", "text-prompt"), target]
    const edges = [edge("a", "split")]
    const states: Record<string, NodeExecutionState> = {
      a: { status: "completed", output: { text: "a||b||c" } },
    }

    const result = executeSplitText(target, {}, edges, allNodes, states)
    expect(result.splitResults).toEqual(["a", "b", "c"])
  })

  it("keeps empty parts when removeEmpty is false", () => {
    const target = node("split", "split-text", { separator: "|", removeEmpty: false, trimWhitespace: false })
    const allNodes = [node("a", "text-prompt"), target]
    const edges = [edge("a", "split")]
    const states: Record<string, NodeExecutionState> = {
      a: { status: "completed", output: { text: "a||b" } },
    }

    const result = executeSplitText(target, {}, edges, allNodes, states)
    expect(result.splitResults).toEqual(["a", "", "b"])
  })

  it("falls back to resolvedInputs.prompt", () => {
    const target = node("split", "split-text", { separator: "," })
    const result = executeSplitText(target, { prompt: "x,y,z" }, [], [target], {})
    expect(result.splitResults).toEqual(["x", "y", "z"])
  })

  it("falls back to node data text", () => {
    const target = node("split", "split-text", { separator: ",", text: "a,b" })
    const result = executeSplitText(target, {}, [], [target], {})
    expect(result.splitResults).toEqual(["a", "b"])
  })

  it("returns empty array for empty input", () => {
    const target = node("split", "split-text", {})
    const result = executeSplitText(target, {}, [], [target], {})
    expect(result.splitResults).toEqual([])
    expect(result.text).toBe("")
  })
})

// ---------------------------------------------------------------------------
// executeComposite
// ---------------------------------------------------------------------------

describe("executeComposite", () => {
  it("builds composite plan from upstream video nodes", () => {
    const target = node("comp", "composite", { fps: 30, aspectRatio: "16:9" })
    const srcNode = node("vid", "image-to-video")
    const allNodes = [srcNode, target]
    const edges = [edge("vid", "comp", undefined, "video1")]
    const states: Record<string, NodeExecutionState> = {
      vid: { status: "completed", output: { videoUrl: "https://vid.mp4" } },
    }

    const result = executeComposite(target, edges, allNodes, states)
    expect(result.plan).toBeDefined()
    const plan = result.plan as Record<string, unknown>
    expect(plan.planType).toBe("composite")
    expect(plan.fps).toBe(30)
    const layers = plan.layers as Array<Record<string, unknown>>
    expect(layers).toHaveLength(1)
    expect(layers[0].sourceVideo).toBe("https://vid.mp4")
  })

  it("uses default dimensions when no aspect ratio", () => {
    const target = node("comp", "composite", {})
    const result = executeComposite(target, [], [target], {})
    const plan = result.plan as Record<string, unknown>
    expect(plan.width).toBe(1920)
    expect(plan.height).toBe(1080)
  })

  it("uses existing layer config when available", () => {
    const target = node("comp", "composite", {
      layers: [{ inputHandle: "video1", opacity: 0.5, zIndex: 0 }],
    })
    const srcNode = node("vid", "image-to-video")
    const allNodes = [srcNode, target]
    const edges = [edge("vid", "comp", undefined, "video1")]
    const states: Record<string, NodeExecutionState> = {
      vid: { status: "completed", output: { videoUrl: "https://v.mp4" } },
    }

    const result = executeComposite(target, edges, allNodes, states)
    const layers = (result.plan as Record<string, unknown>).layers as Array<Record<string, unknown>>
    expect(layers[0].opacity).toBe(0.5)
    expect(layers[0].sourceVideo).toBe("https://v.mp4")
  })

  it("creates default layer for unmatched handles", () => {
    const target = node("comp", "composite", { layers: [] })
    const srcNode = node("vid", "image-to-video")
    const allNodes = [srcNode, target]
    const edges = [edge("vid", "comp", undefined, "newHandle")]
    const states: Record<string, NodeExecutionState> = {
      vid: { status: "completed", output: { videoUrl: "https://v.mp4" } },
    }

    const result = executeComposite(target, edges, allNodes, states)
    const layers = (result.plan as Record<string, unknown>).layers as Array<Record<string, unknown>>
    expect(layers).toHaveLength(1)
    expect(layers[0].position).toBe("fullscreen")
    expect(layers[0].opacity).toBe(1)
  })

  it("uses explicit durationSeconds when set", () => {
    const target = node("comp", "composite", { fps: 30, durationSeconds: 5 })
    const result = executeComposite(target, [], [target], {})
    const plan = result.plan as Record<string, unknown>
    expect(plan.durationInFrames).toBe(150) // 5 * 30
  })

  it("falls back to 10 seconds when no duration info", () => {
    const target = node("comp", "composite", { fps: 24 })
    const result = executeComposite(target, [], [target], {})
    const plan = result.plan as Record<string, unknown>
    expect(plan.durationInFrames).toBe(240) // 10 * 24
  })

  it("skips plan-ready sentinel values", () => {
    const target = node("comp", "composite", {})
    const srcNode = node("vc", "video-composer")
    const allNodes = [srcNode, target]
    const edges = [edge("vc", "comp")]
    const states: Record<string, NodeExecutionState> = {
      vc: { status: "completed", output: { plan: { type: "scene-graph" } } },
    }

    const result = executeComposite(target, edges, allNodes, states)
    // plan-ready is skipped, so no layers
    const layers = (result.plan as Record<string, unknown>).layers as Array<Record<string, unknown>>
    expect(layers).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// executePreview
// ---------------------------------------------------------------------------

describe("executePreview", () => {
  it("collects upstream outputs as preview items", () => {
    const target = node("preview", "preview")
    const imgNode = node("img", "generate-image", { label: "My Image" })
    const allNodes = [imgNode, target]
    const edges = [edge("img", "preview")]
    const states: Record<string, NodeExecutionState> = {
      img: { status: "completed", output: { imageUrl: "https://img.png" } },
    }

    const result = executePreview(target, edges, allNodes, states)
    expect(result.previewItems).toHaveLength(1)
    expect(result.previewItems![0].type).toBe("image")
    expect(result.previewItems![0].value).toBe("https://img.png")
    expect(result.previewItems![0].sourceNodeId).toBe("img")
    expect(result.text).toBe("https://img.png")
  })

  it("detects video type from source node", () => {
    const target = node("preview", "preview")
    const vidNode = node("vid", "image-to-video")
    const allNodes = [vidNode, target]
    const edges = [edge("vid", "preview")]
    const states: Record<string, NodeExecutionState> = {
      vid: { status: "completed", output: { videoUrl: "https://vid.mp4" } },
    }

    const result = executePreview(target, edges, allNodes, states)
    expect(result.previewItems![0].type).toBe("video")
  })

  it("detects audio type from source node", () => {
    const target = node("preview", "preview")
    const audNode = node("aud", "text-to-speech")
    const allNodes = [audNode, target]
    const edges = [edge("aud", "preview")]
    const states: Record<string, NodeExecutionState> = {
      aud: { status: "completed", output: { audioUrl: "https://aud.mp3" } },
    }

    const result = executePreview(target, edges, allNodes, states)
    expect(result.previewItems![0].type).toBe("audio")
  })

  it("detects text type for text sources", () => {
    const target = node("preview", "preview")
    const txtNode = node("txt", "text-prompt", { label: "Prompt" })
    const allNodes = [txtNode, target]
    const edges = [edge("txt", "preview")]
    const states: Record<string, NodeExecutionState> = {
      txt: { status: "completed", output: { text: "hello world" } },
    }

    const result = executePreview(target, edges, allNodes, states)
    expect(result.previewItems![0].type).toBe("text")
    expect(result.previewItems![0].value).toBe("hello world")
  })

  it("handles no upstream nodes", () => {
    const target = node("preview", "preview")
    const result = executePreview(target, [], [target], {})
    expect(result.previewItems).toEqual([])
    expect(result.text).toBeUndefined()
  })

  it("skips nodes with no output", () => {
    const target = node("preview", "preview")
    const pendingNode = node("p", "generate-image")
    const allNodes = [pendingNode, target]
    const edges = [edge("p", "preview")]
    const states: Record<string, NodeExecutionState> = {
      p: { status: "pending" },
    }

    const result = executePreview(target, edges, allNodes, states)
    expect(result.previewItems).toEqual([])
  })

  it("detects data type for forced-alignment", () => {
    const target = node("preview", "preview")
    const faNode = node("fa", "forced-alignment")
    const allNodes = [faNode, target]
    const edges = [edge("fa", "preview")]
    const states: Record<string, NodeExecutionState> = {
      fa: { status: "completed", output: { alignment: { words: [] }, text: "{}" } },
    }

    const result = executePreview(target, edges, allNodes, states)
    // forced-alignment getPrimaryOutput serializes alignment to JSON
    expect(result.previewItems![0].type).toBe("data")
  })

  it("detects type from URL extension for unknown source types", () => {
    const target = node("preview", "preview")
    const unknownNode = node("u", "some-custom-node", { label: "Custom" })
    const allNodes = [unknownNode, target]
    const edges = [edge("u", "preview")]
    const states: Record<string, NodeExecutionState> = {
      u: { status: "completed", output: { imageUrl: "https://example.com/photo.jpg" } },
    }

    const result = executePreview(target, edges, allNodes, states)
    // Unknown node type but getPrimaryOutput returns imageUrl, which detectPreviewItemType
    // then matches via IMAGE_URL_RE regex on the value
    expect(result.previewItems![0].type).toBe("image")
  })
})
