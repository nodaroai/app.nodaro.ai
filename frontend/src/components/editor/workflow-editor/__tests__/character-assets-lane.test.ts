/**
 * The owner's "bad example" (2026-08-25), replicated VERBATIM: two Character
 * nodes wired `characterRef → assets` into one generate-image — the lane
 * `classifyUpstreamForGenerateImage` itself routes characters to — and only
 * ONE reached the model. The structural asymmetry in the export: one edge
 * carries list-edge data (`outputMode: "item"`, `itemIndex: "1"`) stamped on
 * a non-list source.
 */
import { describe, expect, it } from "vitest"
import { resolveNodeInputs } from "../node-input-resolver"
import type { WorkflowEdge, WorkflowNode } from "@/types/nodes"

const AVIRAM_URL = "https://cdn.test/aviram.png"
const JESSICA_URL = "https://cdn.test/jessica.png"

function characterNode(id: string, name: string, url: string): WorkflowNode {
  return {
    id,
    type: "character",
    position: { x: 0, y: 0 },
    data: {
      label: name,
      characterName: name,
      sourceImageUrl: url,
      characterDbId: "",
      identityLock: "strict",
    },
  } as WorkflowNode
}

const generateImage = {
  id: "node_3",
  type: "generate-image",
  position: { x: 0, y: 0 },
  data: {
    label: "Lagoon Walk",
    prompt: "{image:2} and {image:1} walking hand in hand along the shore.",
    provider: "nano-banana-pro",
    fieldMappings: {},
  },
} as WorkflowNode

const nodes = [
  characterNode("node_4", "Aviram 1", AVIRAM_URL),
  characterNode("node_5", "Jessica Kaplan", JESSICA_URL),
  generateImage,
]

describe("two characters on the assets lane (the owner's bad example)", () => {
  it("BOTH portraits reach referenceImageUrls despite stray list-edge data on one edge", () => {
    // Edges verbatim from the export: Jessica's edge carries item-mode data.
    const edges: WorkflowEdge[] = [
      {
        id: "edge_1787680539356",
        source: "node_5",
        target: "node_3",
        sourceHandle: "characterRef",
        targetHandle: "assets",
        data: { itemIndex: "1", outputMode: "item" },
      } as WorkflowEdge,
      {
        id: "edge_1787680645395",
        source: "node_4",
        target: "node_3",
        sourceHandle: "characterRef",
        targetHandle: "assets",
      } as WorkflowEdge,
    ]

    const inputs = resolveNodeInputs(generateImage, nodes, edges)
    expect(inputs.referenceImageUrls ?? []).toContain(JESSICA_URL)
    expect(inputs.referenceImageUrls ?? []).toContain(AVIRAM_URL)
  })

  it("ablation: the same graph without the stray edge data delivers both", () => {
    const edges: WorkflowEdge[] = [
      { id: "e1", source: "node_5", target: "node_3", sourceHandle: "characterRef", targetHandle: "assets" } as WorkflowEdge,
      { id: "e2", source: "node_4", target: "node_3", sourceHandle: "characterRef", targetHandle: "assets" } as WorkflowEdge,
    ]
    const inputs = resolveNodeInputs(generateImage, nodes, edges)
    expect(inputs.referenceImageUrls ?? []).toEqual(expect.arrayContaining([JESSICA_URL, AVIRAM_URL]))
  })
})

