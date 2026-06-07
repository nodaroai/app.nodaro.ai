import { describe, it, expect, vi } from "vitest"

// getUpstreamNodes (imported transitively via @/lib/node-refs) lives in a module
// that statically imports heavy editor utils only used by buildNodeRefMap, not by
// getUpstreamNodes. Neutralize them so the import graph stays light; the label
// derivation in getUpstreamNodes itself still runs against the real fixtures.
vi.mock("@/components/editor/workflow-editor/execution-graph", () => ({
  extractNodeOutput: () => "",
}))
vi.mock("@/components/editor/workflow-editor/node-input-resolver", () => ({
  extractNodeOutputAsList: () => [],
}))

import { computeUnusedPromptEdges } from "../unused-prompt-edges"
import { getUpstreamNodes } from "@/lib/node-refs"
import type { WorkflowNode, WorkflowEdge } from "@/types/nodes"

function node(id: string, type: string, data: Record<string, unknown>): WorkflowNode {
  return { id, type, position: { x: 0, y: 0 }, data } as WorkflowNode
}
function edge(
  id: string,
  source: string,
  target: string,
  targetHandle: string,
  sourceHandle?: string,
): WorkflowEdge {
  return { id, source, target, targetHandle, sourceHandle } as WorkflowEdge
}

// Consumer c1 is generate-image (typed-primary; in NODE_PROMPT_CANDIDATE_FIELDS).
// Source n1 has data.label = "Src" — getUpstreamNodes derives a node's label from
// data.label (node-refs.ts: `(data.label as string) || node.type || currentId`).
function buildSource(): WorkflowNode {
  return node("n1", "generate-image", { label: "Src", prompt: "" })
}

describe("computeUnusedPromptEdges", () => {
  it("1. non-empty typed prompt with no ref → flags the dead wire", () => {
    const nodes = [
      buildSource(),
      node("c1", "generate-image", { prompt: "a portrait" }),
    ]
    const edges = [edge("e1", "n1", "c1", "prompt")]
    expect(computeUnusedPromptEdges(nodes, edges).has("e1")).toBe(true)
  })

  it("2. prompt references {Src} → not flagged", () => {
    const nodes = [
      buildSource(),
      node("c1", "generate-image", { prompt: "a {Src} portrait" }),
    ]
    const edges = [edge("e1", "n1", "c1", "prompt")]
    expect(computeUnusedPromptEdges(nodes, edges).has("e1")).toBe(false)
  })

  it("3. empty prompt → not flagged (wire becomes the source)", () => {
    const nodes = [
      buildSource(),
      node("c1", "generate-image", { prompt: "" }),
    ]
    const edges = [edge("e1", "n1", "c1", "prompt")]
    expect(computeUnusedPromptEdges(nodes, edges).has("e1")).toBe(false)
  })

  it("4. empty-injection {} marker → not flagged", () => {
    const nodes = [
      buildSource(),
      node("c1", "generate-image", { prompt: "a {} portrait" }),
    ]
    const edges = [edge("e1", "n1", "c1", "prompt")]
    expect(computeUnusedPromptEdges(nodes, edges).has("e1")).toBe(false)
  })

  it("5. identity source (character) → never flagged", () => {
    const nodes = [
      node("n1", "character", { label: "Src" }),
      node("c1", "generate-image", { prompt: "a portrait" }),
    ]
    const edges = [edge("e1", "n1", "c1", "prompt")]
    expect(computeUnusedPromptEdges(nodes, edges).has("e1")).toBe(false)
  })

  it("6. fieldMapping to the source → not flagged", () => {
    const nodes = [
      buildSource(),
      node("c1", "generate-image", {
        prompt: "a portrait",
        fieldMappings: { prompt: { sourceNodeId: "n1" } },
      }),
    ]
    const edges = [edge("e1", "n1", "c1", "prompt")]
    expect(computeUnusedPromptEdges(nodes, edges).has("e1")).toBe(false)
  })

  it("7. wire-primary consumer (suno-generate, not in candidate fields) → not flagged", () => {
    const nodes = [
      buildSource(),
      node("c1", "suno-generate", { prompt: "a portrait" }),
    ]
    const edges = [edge("e1", "n1", "c1", "prompt")]
    expect(computeUnusedPromptEdges(nodes, edges).has("e1")).toBe(false)
  })

  it("8. edge into a non-prompt handle (image) → not flagged", () => {
    const nodes = [
      buildSource(),
      node("c1", "generate-image", { prompt: "a portrait" }),
    ]
    const edges = [edge("e1", "n1", "c1", "image")]
    expect(computeUnusedPromptEdges(nodes, edges).has("e1")).toBe(false)
  })

  it("9. duplicate label: prompt references the source's real suffixed label → not flagged", () => {
    // Two upstream nodes both labeled "Src" → getUpstreamNodes disambiguates one
    // of them to "Src (2)". Compute the real label n1 resolves to (do not guess
    // the suffix), then reference exactly that label in the prompt.
    const nodes = [
      buildSource(),
      node("n2", "generate-image", { label: "Src", prompt: "" }),
      node("c1", "generate-image", { prompt: "placeholder" }),
    ]
    // Both feed c1 (n2 also wired so it shows up as upstream for label counting).
    const baseEdges = [
      edge("e1", "n1", "c1", "prompt"),
      edge("e2", "n2", "c1", "image"),
    ]
    const n1Label = getUpstreamNodes("c1", nodes, baseEdges).find((u) => u.id === "n1")!.label
    // Sanity: with a duplicate "Src", n1 must resolve to a non-bare label.
    expect(n1Label.startsWith("Src")).toBe(true)

    const usingNodes = [
      buildSource(),
      node("n2", "generate-image", { label: "Src", prompt: "" }),
      node("c1", "generate-image", { prompt: `a {${n1Label}} portrait` }),
    ]
    expect(computeUnusedPromptEdges(usingNodes, baseEdges).has("e1")).toBe(false)
  })

  it("10. ref in a candidate field outside NODE_MAPPABLE_FIELDS (motionPrompt) → not flagged", () => {
    // Kling 3 Studio binds the scene prompt to data.motionPrompt (a candidate
    // field for image-to-video) while data.prompt stays empty. A {ref} there is
    // live (computeNodePrompt picks motionPrompt), so the wire must NOT be flagged
    // even though motionPrompt is absent from NODE_MAPPABLE_FIELDS["image-to-video"].
    const nodes = [
      buildSource(),
      node("c1", "image-to-video", { prompt: "", motionPrompt: "a {Src} dancing" }),
    ]
    const edges = [edge("e1", "n1", "c1", "prompt")]
    expect(computeUnusedPromptEdges(nodes, edges).has("e1")).toBe(false)
  })

  it("10b. dead wire when motionPrompt has no ref → still flagged", () => {
    const nodes = [
      buildSource(),
      node("c1", "image-to-video", { prompt: "", motionPrompt: "a dancing scene" }),
    ]
    const edges = [edge("e1", "n1", "c1", "prompt")]
    expect(computeUnusedPromptEdges(nodes, edges).has("e1")).toBe(true)
  })
})
