import { describe, it, expect } from "vitest"
import { computeHandleConnections } from "../use-handle-connections"
import type { WorkflowEdge, WorkflowNode } from "@/types/nodes"

const node = (id: string, type: string, label: string): WorkflowNode =>
  ({ id, type, position: { x: 0, y: 0 }, data: { label } } as unknown as WorkflowNode)
const edge = (
  id: string,
  source: string,
  target: string,
  targetHandle: string,
): WorkflowEdge =>
  ({ id, source, target, sourceHandle: "out", targetHandle } as unknown as WorkflowEdge)

describe("computeHandleConnections", () => {
  it("returns target-side connections for a target handle", () => {
    const nodes = [node("a", "text-prompt", "Idea"), node("b", "generate-image", "Gen")]
    const edges = [edge("e1", "a", "b", "prompt")]
    const out = computeHandleConnections(nodes, edges, "b", "prompt", "target")
    expect(out).toHaveLength(1)
    expect(out[0].edgeId).toBe("e1")
    expect(out[0].otherNodeId).toBe("a")
    expect(out[0].otherNodeLabel).toBe("Idea")
    expect(out[0].otherNodeType).toBe("text-prompt")
  })

  it("returns source-side connections for a source handle", () => {
    const nodes = [node("a", "generate-image", "Gen"), node("b", "image-to-video", "I2V")]
    const edges = [
      { id: "e1", source: "a", target: "b", sourceHandle: "image", targetHandle: "image" } as unknown as WorkflowEdge,
    ]
    const out = computeHandleConnections(nodes, edges, "a", "image", "source")
    expect(out).toHaveLength(1)
    expect(out[0].otherNodeId).toBe("b")
  })

  it("returns empty when nothing is connected", () => {
    const nodes = [node("a", "generate-image", "Gen")]
    const out = computeHandleConnections(nodes, [], "a", "prompt", "target")
    expect(out).toEqual([])
  })

  it("returns multiple connections preserving edge order", () => {
    const nodes = [
      node("a", "upload-image", "Ref1"),
      node("b", "upload-image", "Ref2"),
      node("g", "generate-image", "Gen"),
    ]
    const edges = [edge("e1", "a", "g", "references"), edge("e2", "b", "g", "references")]
    const out = computeHandleConnections(nodes, edges, "g", "references", "target")
    expect(out.map((c) => c.edgeId)).toEqual(["e1", "e2"])
  })

  it("filters by handle id (does not return other handles' connections)", () => {
    const nodes = [
      node("a", "text-prompt", "Idea"),
      node("b", "upload-image", "Ref"),
      node("g", "generate-image", "Gen"),
    ]
    const edges = [edge("e1", "a", "g", "prompt"), edge("e2", "b", "g", "references")]
    const prompt = computeHandleConnections(nodes, edges, "g", "prompt", "target")
    expect(prompt.map((c) => c.edgeId)).toEqual(["e1"])
    const references = computeHandleConnections(nodes, edges, "g", "references", "target")
    expect(references.map((c) => c.edgeId)).toEqual(["e2"])
  })
})
