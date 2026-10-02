/**
 * Content Recipe + Content Ideas through the editor's resolver — the twin of
 * backend/src/services/workflow-engine/__tests__/content-recipe-ideas.test.ts,
 * so a single-node Run and a server run read the same inputs:
 *
 *   - Content Ideas folds every recipe wired into `recipes`; its `field-brand`
 *     wire is a field, not a recipe; it is never fanned out itself;
 *   - Choose Best still folds every wire, whatever its handle;
 *   - Content Recipe's `link` wire carries a Video URL node's PAGE link, never
 *     the downloaded file;
 *   - Video Analysis's `video` wire from a text output carries a post's link
 *     to fetch, while a Video URL node there is still the downloaded file;
 *   - a finished Content Ideas node hands the next node one brief per idea.
 */
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

import { resolveNodeInputs, extractNodeOutputAsList, getListFanOutForNode } from "../node-input-resolver"
import type { WorkflowEdge, WorkflowNode } from "@/types/nodes"

function node(id: string, type: string, data: Record<string, unknown> = {}): WorkflowNode {
  return { id, type, data: { label: id, ...data }, position: { x: 0, y: 0 } } as unknown as WorkflowNode
}

function edge(source: string, target: string, sourceHandle: string | null, targetHandle: string | null): WorkflowEdge {
  return { id: `${source}->${target}:${targetHandle ?? "x"}`, source, target, sourceHandle, targetHandle } as unknown as WorkflowEdge
}

const RECIPE_A = "CONTENT RECIPE: A\nFormat: pov"
const RECIPE_B = "CONTENT RECIPE: B\nFormat: listicle"

describe("Content Ideas — folds its recipes, reads its brand as a field", () => {
  it("folds the recipes of several Content Recipe nodes into one run", () => {
    const ideas = node("I", "content-ideas")
    const nodes = [
      node("R1", "content-recipe", { executionStatus: "completed", generatedText: RECIPE_A }),
      node("R2", "content-recipe", { executionStatus: "completed", generatedText: RECIPE_B }),
      ideas,
    ]
    const inputs = resolveNodeInputs(ideas, nodes, [edge("R1", "I", "text", "recipes"), edge("R2", "I", "text", "recipes")])
    expect(inputs.inputs).toEqual([RECIPE_A, RECIPE_B])
  })

  it("the field-brand wire is NOT a recipe", () => {
    const ideas = node("I", "content-ideas")
    const nodes = [
      node("R", "content-recipe", { executionStatus: "completed", generatedText: RECIPE_A }),
      node("B", "text-prompt", { text: "We sell matcha." }),
      ideas,
    ]
    const inputs = resolveNodeInputs(ideas, nodes, [edge("R", "I", "text", "recipes"), edge("B", "I", "prompt", "field-brand")])
    expect(inputs.inputs).toEqual([RECIPE_A])
  })

  it("is never fanned out itself, even by a multi-item upstream", () => {
    const ideas = node("I", "content-ideas")
    const nodes = [node("L", "list", { items: [RECIPE_A, RECIPE_B] }), ideas]
    expect(getListFanOutForNode(ideas, nodes, [edge("L", "I", null, "recipes")])).toBeUndefined()
  })

  it("Choose Best still folds every wire, whatever its handle", () => {
    const reduce = node("C", "reduce", { strategyId: "concat" })
    const nodes = [node("A", "text-prompt", { text: "a" }), node("B", "text-prompt", { text: "b" }), reduce]
    const inputs = resolveNodeInputs(reduce, nodes, [edge("A", "C", "prompt", "in"), edge("B", "C", "prompt", "field-anything")])
    expect(inputs.inputs).toEqual(["a", "b"])
  })
})

describe("Content Recipe — the link wire carries the post's page link", () => {
  it("reads a Video URL node's page link, never its downloaded file", () => {
    const recipe = node("R", "content-recipe")
    const link = node("V", "youtube-video", {
      youtubeUrl: "https://www.tiktok.com/@a/video/1",
      downloadedVideoUrl: "https://r2.example/videos/v.mp4",
      downloadedFromUrl: "https://www.tiktok.com/@a/video/1",
    })
    const inputs = resolveNodeInputs(recipe, [link, recipe], [edge("V", "R", "video", "link")])
    expect(inputs.sourceLink).toBe("https://www.tiktok.com/@a/video/1")
    expect(inputs.videoUrl).toBeUndefined()
    expect(inputs.prompt).toBeUndefined()
  })

  it("takes a text node's text as the link", () => {
    const recipe = node("R", "content-recipe")
    const text = node("T", "text-prompt", { text: "https://x.com/a/status/1" })
    const inputs = resolveNodeInputs(recipe, [text, recipe], [edge("T", "R", "prompt", "link")])
    expect(inputs.sourceLink).toBe("https://x.com/a/status/1")
  })
})

describe("Video Analysis — a text output on the video input is the post to fetch", () => {
  it("takes a text node's link as the post's link — not a file, not a prompt", () => {
    const va = node("A", "video-analysis")
    const text = node("T", "text-prompt", { text: " https://www.tiktok.com/@a/video/1 " })
    const inputs = resolveNodeInputs(va, [text, va], [edge("T", "A", "prompt", "video")])
    expect(inputs.videoPageUrl).toBe("https://www.tiktok.com/@a/video/1")
    expect(inputs.videoUrl).toBeUndefined()
    expect(inputs.prompt).toBeUndefined()
  })

  it("words that are not a link bring nothing", () => {
    const va = node("A", "video-analysis")
    const text = node("T", "text-prompt", { text: "Five things nobody tells you" })
    const inputs = resolveNodeInputs(va, [text, va], [edge("T", "A", "prompt", "video")])
    expect(inputs.videoPageUrl).toBeUndefined()
    expect(inputs.prompt).toBeUndefined()
  })

  it("a link with words around it is not a link", () => {
    const va = node("A", "video-analysis")
    const text = node("T", "text-prompt", { text: "https://youtu.be/dQw4w9WgXcQ what a clip" })
    const inputs = resolveNodeInputs(va, [text, va], [edge("T", "A", "prompt", "video")])
    expect(inputs.videoPageUrl).toBeUndefined()
  })

  it("a Video URL node is still the downloaded file", () => {
    const va = node("A", "video-analysis")
    const clip = node("V", "youtube-video", {
      youtubeUrl: "https://www.tiktok.com/@a/video/1",
      downloadedVideoUrl: "https://r2.example/videos/v.mp4",
      downloadedFromUrl: "https://www.tiktok.com/@a/video/1",
    })
    const inputs = resolveNodeInputs(va, [clip, va], [edge("V", "A", "video", "video")])
    expect(inputs.videoUrl).toBe("https://r2.example/videos/v.mp4")
    expect(inputs.videoPageUrl).toBeUndefined()
  })
})

describe("a finished Content Ideas node hands the next node one brief per idea", () => {
  it("reads ideaBriefs — not the ideas' raw JSON", () => {
    const ideas = node("I", "content-ideas", {
      executionStatus: "completed",
      generatedJson: [{ title: "one" }, { title: "two" }],
      ideaBriefs: ["IDEA 1 of 2: one", " ", "IDEA 2 of 2: two"],
      generatedText: "CONTENT IDEAS (2)",
    })
    expect(extractNodeOutputAsList(ideas, "ideas")).toEqual(["IDEA 1 of 2: one", "IDEA 2 of 2: two"])
  })

  it("an unrun node offers no list", () => {
    expect(extractNodeOutputAsList(node("I", "content-ideas"), "ideas")).toBeUndefined()
  })
})
