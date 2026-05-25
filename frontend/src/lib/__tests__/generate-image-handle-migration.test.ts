import { describe, it, expect } from "vitest"
import { migrateGenerateImageHandles } from "../generate-image-handle-migration"
import type { WorkflowNode, WorkflowEdge } from "@/types/nodes"

function genImg(id: string): WorkflowNode {
  return { id, type: "generate-image", position: { x: 0, y: 0 }, data: { label: "Gen" } } as unknown as WorkflowNode
}
function srcNode(id: string, type: string): WorkflowNode {
  return { id, type, position: { x: 0, y: 0 }, data: { label: type } } as unknown as WorkflowNode
}
function edge(id: string, source: string, target: string, targetHandle: string | null): WorkflowEdge {
  return { id, source, target, sourceHandle: "out", targetHandle } as unknown as WorkflowEdge
}

describe("migrateGenerateImageHandles", () => {
  it("re-routes text-producer edges from 'in' to 'prompt'", () => {
    const nodes = [srcNode("tp", "text-prompt"), genImg("g")]
    const edges = [edge("e1", "tp", "g", "in")]
    const { edges: out } = migrateGenerateImageHandles(nodes, edges)
    expect(out[0].targetHandle).toBe("prompt")
  })

  it("re-routes image-producer edges from 'in' to 'references'", () => {
    const nodes = [srcNode("up", "upload-image"), genImg("g")]
    const edges = [edge("e1", "up", "g", "in")]
    const { edges: out } = migrateGenerateImageHandles(nodes, edges)
    expect(out[0].targetHandle).toBe("references")
  })

  it("re-routes identity edges from 'in' to 'assets'", () => {
    const nodes = [srcNode("ch", "character"), genImg("g")]
    const edges = [edge("e1", "ch", "g", "in")]
    const { edges: out } = migrateGenerateImageHandles(nodes, edges)
    expect(out[0].targetHandle).toBe("assets")
  })

  it("re-routes 'in'-handle picker edges to their classified Look/Elements handle", () => {
    const nodes = [srcNode("m", "mood"), genImg("g")]
    const edges = [edge("e1", "m", "g", "in")]
    const { edges: out, pickerEdgesMigrated } = migrateGenerateImageHandles(nodes, edges)
    // mood is in the Look family
    expect(out[0].targetHandle).toBe("look")
    expect(pickerEdgesMigrated).toBe(1)
  })

  it("re-routes 'cinematography' to 'look' for Look-family pickers", () => {
    const nodes = [srcNode("ln", "lens"), genImg("g")]
    const edges = [edge("e1", "ln", "g", "cinematography")]
    const { edges: out } = migrateGenerateImageHandles(nodes, edges)
    expect(out[0].targetHandle).toBe("look")
  })

  it("re-routes 'cinematography' to 'elements' for Subject/Object pickers", () => {
    const nodes = [srcNode("p", "person"), genImg("g")]
    const edges = [edge("e1", "p", "g", "cinematography")]
    const { edges: out } = migrateGenerateImageHandles(nodes, edges)
    expect(out[0].targetHandle).toBe("elements")
  })

  it("re-routes legacy 'subjects' handle to 'assets'", () => {
    const nodes = [srcNode("ch", "character"), genImg("g")]
    const edges = [edge("e1", "ch", "g", "subjects")]
    const { edges: out } = migrateGenerateImageHandles(nodes, edges)
    expect(out[0].targetHandle).toBe("assets")
  })

  it("re-routes null targetHandle by source type", () => {
    const nodes = [srcNode("tp", "text-prompt"), genImg("g")]
    const edges = [edge("e1", "tp", "g", null)]
    const { edges: out } = migrateGenerateImageHandles(nodes, edges)
    expect(out[0].targetHandle).toBe("prompt")
  })

  it("is idempotent — re-running yields the same edges", () => {
    const nodes = [srcNode("tp", "text-prompt"), srcNode("up", "upload-image"), genImg("g")]
    const edges = [edge("e1", "tp", "g", "in"), edge("e2", "up", "g", "cinematography")]
    const first = migrateGenerateImageHandles(nodes, edges)
    const second = migrateGenerateImageHandles(nodes, first.edges)
    expect(second.edges).toEqual(first.edges)
  })

  it("leaves non-generate-image targets untouched", () => {
    const nodes = [srcNode("tp", "text-prompt"), srcNode("li", "loop")]
    const edges = [edge("e1", "tp", "li", "in")]
    const { edges: out } = migrateGenerateImageHandles(nodes, edges)
    expect(out[0].targetHandle).toBe("in")
  })

  it("leaves edges with already-new handles untouched", () => {
    const nodes = [srcNode("tp", "text-prompt"), genImg("g")]
    const edges = [edge("e1", "tp", "g", "prompt")]
    const { edges: out } = migrateGenerateImageHandles(nodes, edges)
    expect(out[0].targetHandle).toBe("prompt")
  })

  it("handles workflows with no generate-image nodes (no-op)", () => {
    const nodes = [srcNode("tp", "text-prompt"), srcNode("li", "loop")]
    const edges = [edge("e1", "tp", "li", "in")]
    const { edges: out, pickerEdgesMigrated } = migrateGenerateImageHandles(nodes, edges)
    expect(out).toEqual(edges)
    expect(pickerEdgesMigrated).toBe(0)
  })
})
