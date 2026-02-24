import { describe, it, expect, vi } from "vitest"
import {
  discoverRoutes,
  detectCyclicReference,
} from "../sub-workflow-utils"
import type { SubWorkflowInputData, SubWorkflowOutputData } from "@/types/nodes"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeNode(
  id: string,
  type: string,
  data: Record<string, unknown> = {},
): any {
  return { id, type, data: { label: type, ...data }, position: { x: 0, y: 0 } }
}

function makeEdge(source: string, target: string): any {
  return { id: `${source}->${target}`, source, target }
}

function makeInputNode(id: string, routeId: string, ports: any[] = []): any {
  return makeNode(id, "sub-workflow-input", { routeId, ports } as SubWorkflowInputData)
}

function makeOutputNode(id: string, routeId: string, ports: any[] = [], visibleOutputPortId = ""): any {
  return makeNode(id, "sub-workflow-output", { routeId, ports, visibleOutputPortId } as SubWorkflowOutputData)
}

// ---------------------------------------------------------------------------
// discoverRoutes
// ---------------------------------------------------------------------------

describe("discoverRoutes", () => {
  it("returns empty array for empty inputs", () => {
    expect(discoverRoutes([], [])).toEqual([])
  })

  it("returns empty when input node has no routeId", () => {
    const input = makeNode("in1", "sub-workflow-input", { routeId: "" })
    const output = makeOutputNode("out1", "route-1")
    const edges = [makeEdge("in1", "out1")]
    expect(discoverRoutes([input, output], edges)).toEqual([])
  })

  it("returns empty when no matching output node for routeId", () => {
    const input = makeInputNode("in1", "route-1")
    const output = makeOutputNode("out1", "route-2")
    const edges = [makeEdge("in1", "out1")]
    expect(discoverRoutes([input, output], edges)).toEqual([])
  })

  it("returns empty when no directed path exists between matching pair", () => {
    const input = makeInputNode("in1", "route-1")
    const output = makeOutputNode("out1", "route-1")
    // No edges connecting them
    expect(discoverRoutes([input, output], [])).toEqual([])
  })

  it("returns a single valid route for a direct edge", () => {
    const input = makeInputNode("in1", "route-1", [{ id: "p1", name: "Image", mediaType: "image" }])
    const output = makeOutputNode("out1", "route-1", [{ id: "p2", name: "Video", mediaType: "video" }], "p2")
    const edges = [makeEdge("in1", "out1")]
    const routes = discoverRoutes([input, output], edges)

    expect(routes).toHaveLength(1)
    expect(routes[0].routeId).toBe("route-1")
    expect(routes[0].inputNode.id).toBe("in1")
    expect(routes[0].outputNode.id).toBe("out1")
  })

  it("discovers route through an intermediate node", () => {
    const input = makeInputNode("in1", "route-1")
    const middle = makeNode("mid", "generate-image")
    const output = makeOutputNode("out1", "route-1")
    const edges = [makeEdge("in1", "mid"), makeEdge("mid", "out1")]

    const routes = discoverRoutes([input, middle, output], edges)
    expect(routes).toHaveLength(1)
    expect(routes[0].routeId).toBe("route-1")
  })

  it("discovers multiple routes with different routeIds", () => {
    const in1 = makeInputNode("in1", "route-a")
    const out1 = makeOutputNode("out1", "route-a")
    const in2 = makeInputNode("in2", "route-b")
    const out2 = makeOutputNode("out2", "route-b")
    const edges = [makeEdge("in1", "out1"), makeEdge("in2", "out2")]

    const routes = discoverRoutes([in1, out1, in2, out2], edges)
    expect(routes).toHaveLength(2)
    const routeIds = routes.map((r) => r.routeId).sort()
    expect(routeIds).toEqual(["route-a", "route-b"])
  })

  it("populates correct inputData and outputData", () => {
    const inputPorts = [{ id: "p1", name: "Prompt", mediaType: "text" as const }]
    const outputPorts = [{ id: "p2", name: "Result", mediaType: "image" as const }]
    const input = makeInputNode("in1", "route-1", inputPorts)
    const output = makeOutputNode("out1", "route-1", outputPorts, "p2")
    const edges = [makeEdge("in1", "out1")]

    const routes = discoverRoutes([input, output], edges)
    expect(routes[0].inputData.ports).toEqual(inputPorts)
    expect(routes[0].outputData.ports).toEqual(outputPorts)
    expect(routes[0].outputData.visibleOutputPortId).toBe("p2")
  })

  it("ignores non-sub-workflow nodes when counting routes", () => {
    const regular = makeNode("reg1", "generate-image")
    const input = makeInputNode("in1", "route-1")
    const output = makeOutputNode("out1", "route-1")
    const edges = [makeEdge("in1", "output"), makeEdge("in1", "out1")]

    const routes = discoverRoutes([regular, input, output], edges)
    expect(routes).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// detectCyclicReference
// ---------------------------------------------------------------------------

describe("detectCyclicReference", () => {
  it("returns true for self-reference", async () => {
    const loader = vi.fn()
    const result = await detectCyclicReference("wf-1", "wf-1", loader)
    expect(result).toBe(true)
    expect(loader).not.toHaveBeenCalled()
  })

  it("returns false when loader returns null", async () => {
    const loader = vi.fn().mockResolvedValue(null)
    const result = await detectCyclicReference("wf-1", "wf-2", loader)
    expect(result).toBe(false)
  })

  it("returns false when target has no sub-workflow nodes", async () => {
    const loader = vi.fn().mockResolvedValue({
      nodes: [makeNode("n1", "generate-image")],
      edges: [],
    })
    const result = await detectCyclicReference("wf-1", "wf-2", loader)
    expect(result).toBe(false)
  })

  it("returns false for non-cyclic chain", async () => {
    // wf-1 calls wf-2, wf-2 calls wf-3 (no cycle back to wf-1)
    const loader = vi.fn().mockImplementation(async (id: string) => {
      if (id === "wf-2") {
        return {
          nodes: [makeNode("n1", "sub-workflow", { referencedWorkflowId: "wf-3" })],
          edges: [],
        }
      }
      if (id === "wf-3") {
        return { nodes: [makeNode("n1", "generate-image")], edges: [] }
      }
      return null
    })

    const result = await detectCyclicReference("wf-1", "wf-2", loader)
    expect(result).toBe(false)
  })

  it("returns true for direct cycle (target references current)", async () => {
    // wf-2 has a sub-workflow node pointing back to wf-1
    const loader = vi.fn().mockResolvedValue({
      nodes: [makeNode("n1", "sub-workflow", { referencedWorkflowId: "wf-1" })],
      edges: [],
    })
    const result = await detectCyclicReference("wf-1", "wf-2", loader)
    expect(result).toBe(true)
  })

  it("returns true for transitive cycle (3 levels)", async () => {
    // wf-1 → wf-2 → wf-3 → wf-1
    const loader = vi.fn().mockImplementation(async (id: string) => {
      if (id === "wf-2") {
        return {
          nodes: [makeNode("n1", "sub-workflow", { referencedWorkflowId: "wf-3" })],
          edges: [],
        }
      }
      if (id === "wf-3") {
        return {
          nodes: [makeNode("n1", "sub-workflow", { referencedWorkflowId: "wf-1" })],
          edges: [],
        }
      }
      return null
    })

    const result = await detectCyclicReference("wf-1", "wf-2", loader)
    expect(result).toBe(true)
  })

  it("skips sub-workflow nodes with no referencedWorkflowId", async () => {
    const loader = vi.fn().mockResolvedValue({
      nodes: [
        makeNode("n1", "sub-workflow", {}), // no referencedWorkflowId
        makeNode("n2", "generate-image"),
      ],
      edges: [],
    })
    const result = await detectCyclicReference("wf-1", "wf-2", loader)
    expect(result).toBe(false)
  })
})
