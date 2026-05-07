import { describe, it, expect, vi } from "vitest"

// Mock @xyflow/react before importing the store (matches sibling tests)
vi.mock("@xyflow/react", () => ({
  applyNodeChanges: vi.fn((changes, nodes) => {
    const removeIds = changes
      .filter((c: { type: string }) => c.type === "remove")
      .map((c: { id: string }) => c.id)
    if (removeIds.length > 0) {
      return nodes.filter((n: { id: string }) => !removeIds.includes(n.id))
    }
    return nodes
  }),
  applyEdgeChanges: vi.fn((changes, edges) => {
    const removeIds = changes
      .filter((c: { type: string }) => c.type === "remove")
      .map((c: { id: string }) => c.id)
    if (removeIds.length > 0) {
      return edges.filter((e: { id: string }) => !removeIds.includes(e.id))
    }
    return edges
  }),
  addEdge: vi.fn((connection, edges) => [
    ...edges,
    { ...connection, id: connection.id ?? `edge_mock` },
  ]),
}))

import { useWorkflowStore } from "../use-workflow-store"

describe("loadWorkflow — autoLoopTrim → loopTrim migration", () => {
  it("migrates autoLoopTrim=true to loopTrim={enabled:true,framesToTest:8,quality:'precise'}", () => {
    const nodes = [{
      id: "n1", type: "image-to-video", position: { x: 0, y: 0 },
      data: { label: "i2v", provider: "veo3.1", autoLoopTrim: true, fieldMappings: {} },
    }] as any
    useWorkflowStore.getState().loadWorkflow("w1", "test", nodes, [])
    const loaded = useWorkflowStore.getState().nodes.find((n) => n.id === "n1")
    const data = loaded?.data as Record<string, unknown>
    expect(data.loopTrim).toEqual({ enabled: true, framesToTest: 8, quality: "precise" })
    expect(data.autoLoopTrim).toBeUndefined()
  })

  it("migrates autoLoopTrim=false to loopTrim={enabled:false}", () => {
    const nodes = [{
      id: "n1", type: "image-to-video", position: { x: 0, y: 0 },
      data: { label: "i2v", provider: "veo3.1", autoLoopTrim: false, fieldMappings: {} },
    }] as any
    useWorkflowStore.getState().loadWorkflow("w1", "test", nodes, [])
    const loaded = useWorkflowStore.getState().nodes.find((n) => n.id === "n1")
    const data = loaded?.data as Record<string, unknown>
    expect(data.loopTrim).toEqual({ enabled: false })
    expect(data.autoLoopTrim).toBeUndefined()
  })

  it("leaves loopTrim untouched when autoLoopTrim is not present", () => {
    const nodes = [{
      id: "n1", type: "image-to-video", position: { x: 0, y: 0 },
      data: { label: "i2v", provider: "veo3.1", fieldMappings: {} },
    }] as any
    useWorkflowStore.getState().loadWorkflow("w1", "test", nodes, [])
    const loaded = useWorkflowStore.getState().nodes.find((n) => n.id === "n1")
    const data = loaded?.data as Record<string, unknown>
    expect(data.loopTrim).toBeUndefined()
  })

  it("prefers existing loopTrim and drops orphan autoLoopTrim", () => {
    const nodes = [{
      id: "n1", type: "image-to-video", position: { x: 0, y: 0 },
      data: {
        label: "i2v", provider: "veo3.1", fieldMappings: {},
        autoLoopTrim: true,
        loopTrim: { enabled: true, framesToTest: 32, quality: "lossless" },
      },
    }] as any
    useWorkflowStore.getState().loadWorkflow("w1", "test", nodes, [])
    const loaded = useWorkflowStore.getState().nodes.find((n) => n.id === "n1")
    const data = loaded?.data as Record<string, unknown>
    expect(data.loopTrim).toEqual({ enabled: true, framesToTest: 32, quality: "lossless" })
    expect(data.autoLoopTrim).toBeUndefined()
  })

  it("leaves non-i2v nodes untouched", () => {
    const nodes = [{
      id: "n1", type: "loop-video", position: { x: 0, y: 0 },
      data: { label: "loop", autoLoopTrim: true, fieldMappings: {} } as any,
    }] as any
    useWorkflowStore.getState().loadWorkflow("w1", "test", nodes, [])
    const loaded = useWorkflowStore.getState().nodes.find((n) => n.id === "n1")
    const data = loaded?.data as Record<string, unknown>
    expect(data.autoLoopTrim).toBe(true)  // not migrated — wrong node type
    expect(data.loopTrim).toBeUndefined()
  })
})
