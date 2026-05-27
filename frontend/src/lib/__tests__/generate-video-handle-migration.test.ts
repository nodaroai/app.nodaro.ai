import { describe, expect, it } from "vitest"
import { migrateGenerateVideoNodes } from "../generate-video-handle-migration"
import type { WorkflowNode, WorkflowEdge } from "@/types/nodes"

function mkNode(id: string, type: string, data: Record<string, unknown> = {}): WorkflowNode {
  return { id, type, data, position: { x: 0, y: 0 } } as WorkflowNode
}
function mkEdge(id: string, source: string, target: string, sourceHandle: string, targetHandle: string): WorkflowEdge {
  return { id, source, target, sourceHandle, targetHandle } as WorkflowEdge
}

describe("migrateGenerateVideoNodes", () => {
  it("renames image-to-video node type to generate-video", () => {
    const result = migrateGenerateVideoNodes([mkNode("n1", "image-to-video", { provider: "kling" })], [])
    expect(result.nodes[0].type).toBe("generate-video")
  })

  it("renames text-to-video node type to generate-video", () => {
    const result = migrateGenerateVideoNodes([mkNode("n1", "text-to-video", { provider: "veo3" })], [])
    expect(result.nodes[0].type).toBe("generate-video")
  })

  it("renames i2v handles: references → imageReferences", () => {
    const result = migrateGenerateVideoNodes(
      [mkNode("i2v", "image-to-video")],
      [mkEdge("e1", "src", "i2v", "image", "references")],
    )
    expect(result.edges[0].targetHandle).toBe("imageReferences")
  })

  it("renames reference-videos → videoReferences", () => {
    const result = migrateGenerateVideoNodes(
      [mkNode("i2v", "image-to-video")],
      [mkEdge("e1", "src", "i2v", "video", "reference-videos")],
    )
    expect(result.edges[0].targetHandle).toBe("videoReferences")
  })

  it("renames reference-audio → audioReferences", () => {
    const result = migrateGenerateVideoNodes(
      [mkNode("i2v", "image-to-video")],
      [mkEdge("e1", "src", "i2v", "audio", "reference-audio")],
    )
    expect(result.edges[0].targetHandle).toBe("audioReferences")
  })

  it("renames t2v 'in' handle → 'prompt'", () => {
    const result = migrateGenerateVideoNodes(
      [mkNode("t2v", "text-to-video")],
      [mkEdge("e1", "txt", "t2v", "text", "in")],
    )
    expect(result.edges[0].targetHandle).toBe("prompt")
  })

  it("routes cinematography → look for Look-family pickers", () => {
    const result = migrateGenerateVideoNodes(
      [mkNode("lens", "lens"), mkNode("i2v", "image-to-video")],
      [mkEdge("e1", "lens", "i2v", "out", "cinematography")],
    )
    expect(result.edges[0].targetHandle).toBe("look")
  })

  it("routes cinematography → elements for Elements-family pickers", () => {
    const result = migrateGenerateVideoNodes(
      [mkNode("person", "person"), mkNode("i2v", "image-to-video")],
      [mkEdge("e1", "person", "i2v", "out", "cinematography")],
    )
    expect(result.edges[0].targetHandle).toBe("elements")
  })

  it("renames connectedRefImageOrder → referenceImageOrder", () => {
    const result = migrateGenerateVideoNodes(
      [mkNode("i2v", "image-to-video", { connectedRefImageOrder: ["a", "b"] })],
      [],
    )
    const data = result.nodes[0].data as Record<string, unknown>
    expect(data.referenceImageOrder).toEqual(["a", "b"])
    expect(data.connectedRefImageOrder).toBeUndefined()
  })

  it("strips seedance2InputMode", () => {
    const result = migrateGenerateVideoNodes(
      [mkNode("i2v", "image-to-video", { seedance2InputMode: "references" })],
      [],
    )
    expect((result.nodes[0].data as Record<string, unknown>).seedance2InputMode).toBeUndefined()
  })

  it("normalizes kling3Mode → mode and kling3Sound → sound", () => {
    const result = migrateGenerateVideoNodes(
      [mkNode("i2v", "image-to-video", { kling3Mode: "pro", kling3Sound: true })],
      [],
    )
    const data = result.nodes[0].data as Record<string, unknown>
    expect(data.mode).toBe("pro")
    expect(data.sound).toBe(true)
    expect(data.kling3Mode).toBeUndefined()
    expect(data.kling3Sound).toBeUndefined()
  })

  it("is idempotent — running twice yields the same result", () => {
    const nodes = [mkNode("i2v", "image-to-video", { kling3Mode: "pro", connectedRefImageOrder: ["a"] })]
    const edges = [mkEdge("e1", "s", "i2v", "image", "references")]
    const first = migrateGenerateVideoNodes(nodes, edges)
    const second = migrateGenerateVideoNodes(first.nodes, first.edges)
    expect(second.nodes).toEqual(first.nodes)
    expect(second.edges).toEqual(first.edges)
  })

  it("does not touch unrelated nodes", () => {
    const nodes = [
      mkNode("n1", "generate-image", { prompt: "x" }),
      mkNode("n2", "loop"),
    ]
    const result = migrateGenerateVideoNodes(nodes, [])
    expect(result.nodes).toEqual(nodes)
  })

  it("does not modify input arrays in-place (returns new arrays)", () => {
    const nodes = [mkNode("i2v", "image-to-video")]
    const edges = [mkEdge("e1", "s", "i2v", "image", "references")]
    const result = migrateGenerateVideoNodes(nodes, edges)
    // Original arrays should still see old type / handle
    expect(nodes[0].type).toBe("image-to-video")
    expect(edges[0].targetHandle).toBe("references")
    // Result should have migrated versions
    expect(result.nodes[0].type).toBe("generate-video")
    expect(result.edges[0].targetHandle).toBe("imageReferences")
  })
})
