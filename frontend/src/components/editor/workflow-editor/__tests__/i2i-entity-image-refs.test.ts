import { describe, it, expect } from "vitest"
import { buildConnectedRefsForI2I } from "../execute-node"
import type { WorkflowNode, WorkflowEdge } from "@/types/nodes"

function charNode(id: string): WorkflowNode {
  return {
    id, type: "character", position: { x: 0, y: 0 },
    data: { characterName: "Kira", sourceImageUrl: "https://r2/kira.png", canonicalDescription: "tall" },
  } as unknown as WorkflowNode
}
function edge(sourceHandle: string): WorkflowEdge {
  return { id: "e1", source: "char1", target: "i2i1", sourceHandle, targetHandle: "image" } as unknown as WorkflowEdge
}
const PORTRAIT = "https://r2/kira.png"

describe("buildConnectedRefsForI2I — entity image handle (Gap B)", () => {
  const nodes = [charNode("char1")]

  it("characterRef wire → a wired-character identity ref", () => {
    const refs = buildConnectedRefsForI2I("i2i1", [PORTRAIT], undefined, undefined, nodes, [edge("characterRef")], [])
    expect(refs.some((r) => r.source === "wired-character")).toBe(true)
  })

  it("image wire → a plain wired-image (no identity), portrait preserved", () => {
    const refs = buildConnectedRefsForI2I("i2i1", [PORTRAIT], undefined, undefined, nodes, [edge("image")], [])
    expect(refs.some((r) => r.source === "wired-character")).toBe(false)
    expect(refs.some((r) => r.source === "wired-image" && r.url === PORTRAIT)).toBe(true)
  })
})
