import { describe, it, expect, vi } from "vitest"

// getUpstreamNodes (imported transitively) lives in a module that also imports
// heavy editor utils only used by buildNodeRefMap, not getUpstreamNodes.
// Neutralize them so the import graph stays light; getUpstreamNodes itself runs.
vi.mock("@/components/editor/workflow-editor/execution-graph", () => ({
  extractNodeOutput: () => "",
}))
vi.mock("@/components/editor/workflow-editor/node-input-resolver", () => ({
  extractNodeOutputAsList: () => [],
}))

import { computeMissingPromptRefs } from "../missing-prompt-refs"
import type { WorkflowNode, WorkflowEdge } from "@/types/nodes"

function node(id: string, type: string, data: Record<string, unknown>): WorkflowNode {
  return { id, type, position: { x: 0, y: 0 }, data } as WorkflowNode
}
function edge(source: string, target: string): WorkflowEdge {
  return { id: `${source}->${target}`, source, target } as WorkflowEdge
}

describe("computeMissingPromptRefs", () => {
  it("flags a {Label} with no upstream provider", () => {
    const nodes = [node("img", "generate-image", { prompt: "a {Hero} b" })]
    expect(computeMissingPromptRefs(nodes, [], "img")).toEqual([
      { kind: "text", name: "Hero" },
    ])
  })

  it("does not flag a {Label} satisfied by an upstream node", () => {
    const nodes = [
      node("img", "generate-image", { prompt: "a {Hero} b" }),
      node("hero", "text-prompt", { label: "Hero", text: "a knight" }),
    ]
    expect(computeMissingPromptRefs(nodes, [edge("hero", "img")], "img")).toEqual([])
  })

  it("excludes reserved template vars", () => {
    const nodes = [
      node("img", "generate-image", { prompt: "{name} {description} {userPrompt}" }),
    ]
    expect(computeMissingPromptRefs(nodes, [], "img")).toEqual([])
  })

  it("excludes image-ref tokens", () => {
    const nodes = [node("img", "generate-image", { prompt: "see {image:0:ref}" })]
    expect(computeMissingPromptRefs(nodes, [], "img")).toEqual([])
  })

  it("does not flag empty braces", () => {
    const nodes = [node("img", "generate-image", { prompt: "x {} y" })]
    expect(computeMissingPromptRefs(nodes, [], "img")).toEqual([])
  })

  it("scans all mappable fields and dedupes by name", () => {
    const nodes = [
      node("img", "generate-image", {
        prompt: "{Hero} and {Hero}",
        negativePrompt: "no {Blur}",
      }),
    ]
    expect(computeMissingPromptRefs(nodes, [], "img")).toEqual([
      { kind: "text", name: "Hero" },
      { kind: "text", name: "Blur" },
    ])
  })

  it("returns [] for node types with no mappable fields", () => {
    const nodes = [node("u", "upload-image", { prompt: "{Hero}" })]
    expect(computeMissingPromptRefs(nodes, [], "u")).toEqual([])
  })

  it("returns [] when the node is not found", () => {
    expect(computeMissingPromptRefs([], [], "nope")).toEqual([])
  })

  // Guard: generate-video is the LIVE unified video node (text-to-video /
  // image-to-video are deprecated aliases). It must be in NODE_MAPPABLE_FIELDS
  // or the chip silently never appears on the most-used video node.
  it("flags missing refs on generate-video (the unified video node)", () => {
    const nodes = [
      node("vid", "generate-video", { prompt: "a {Hero} clip", negativePrompt: "no {Blur}" }),
    ]
    expect(computeMissingPromptRefs(nodes, [], "vid")).toEqual([
      { kind: "text", name: "Hero" },
      { kind: "text", name: "Blur" },
    ])
  })
})
