import { describe, it, expect } from "vitest"
import { expandWiredCharacterRefsForVideo } from "../video-prompt-assembly"
import type { WorkflowNode, WorkflowEdge } from "@/types/nodes"

function charNode(id: string): WorkflowNode {
  return {
    id,
    type: "character",
    position: { x: 0, y: 0 },
    data: {
      characterName: "Kira",
      sourceImageUrl: "https://r2/kira.png",
      canonicalDescription: "a tall woman",
    },
  } as unknown as WorkflowNode
}

const consumer: WorkflowNode = {
  id: "i2v1", type: "image-to-video", position: { x: 1, y: 0 }, data: {},
} as unknown as WorkflowNode

function edge(sourceHandle: string): WorkflowEdge {
  return { id: "e1", source: "char1", target: "i2v1", sourceHandle, targetHandle: "image" } as unknown as WorkflowEdge
}

describe("expandWiredCharacterRefsForVideo — entity image handle (Gap B)", () => {
  const nodes = [charNode("char1"), consumer]

  it("injects identity when wired from the characterRef handle", () => {
    const refs = expandWiredCharacterRefsForVideo("i2v1", nodes, [edge("characterRef")])
    expect(refs.some((r) => r.source === "wired-character")).toBe(true)
  })

  it("injects NO identity when wired from the image handle", () => {
    const refs = expandWiredCharacterRefsForVideo("i2v1", nodes, [edge("image")])
    expect(refs).toHaveLength(0)
  })
})
