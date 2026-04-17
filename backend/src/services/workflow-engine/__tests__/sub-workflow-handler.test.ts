import { describe, it, expect, vi, beforeEach } from "vitest"
import type { SimpleNode, SimpleEdge, OrchestratorContext, ResolvedInputs } from "../types.js"
import { MAX_SUB_WORKFLOW_DEPTH } from "../types.js"

// ---------------------------------------------------------------------------
// Mocks — must be set up before importing the module under test
// ---------------------------------------------------------------------------

const mockSelect = vi.fn()
const mockEq = vi.fn()
const mockSingle = vi.fn()

vi.mock("../../../lib/supabase.js", () => ({
  supabase: {
    from: vi.fn().mockReturnValue({
      select: (...args: unknown[]) => {
        mockSelect(...args)
        return {
          eq: (...eqArgs: unknown[]) => {
            mockEq(...eqArgs)
            return {
              single: () => mockSingle(),
            }
          },
        }
      },
    }),
  },
}))

// Mock node-executor to avoid pulling in BullMQ, etc.
vi.mock("../node-executor.js", () => ({
  executeNode: vi.fn().mockResolvedValue({ output: { text: "mock output" } }),
}))

import { executeSubWorkflow } from "../sub-workflow-handler.js"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function node(id: string, type: string, data: Record<string, unknown> = {}): SimpleNode {
  return { id, type, data }
}

function edge(source: string, target: string): SimpleEdge {
  return { id: `${source}->${target}`, source, target, sourceHandle: null, targetHandle: null }
}

function ctx(overrides: Partial<OrchestratorContext> = {}): OrchestratorContext {
  return {
    executionId: "exec-1",
    workflowId: "wf-1",
    userId: "user-1",
    triggerType: "manual",
    cancelled: false,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("executeSubWorkflow", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("throws when depth limit is exceeded", async () => {
    const n = node("sw", "sub-workflow", { workflowId: "ref-wf" })
    const inputs: ResolvedInputs = {}

    await expect(
      executeSubWorkflow(n, inputs, ctx(), MAX_SUB_WORKFLOW_DEPTH),
    ).rejects.toThrow("depth limit exceeded")
  })

  it("throws when no workflowId is set", async () => {
    const n = node("sw", "sub-workflow", {})
    await expect(
      executeSubWorkflow(n, {}, ctx()),
    ).rejects.toThrow("no referenced workflow")
  })

  it("throws when cycle is detected", async () => {
    const n = node("sw", "sub-workflow", {
      workflowId: "ref-wf",
      selectedRouteId: "route-1",
    })
    const existingKeys = new Set(["ref-wf:route-1"])

    await expect(
      executeSubWorkflow(n, {}, ctx(), 0, existingKeys),
    ).rejects.toThrow("Cycle detected")
  })

  it("throws when referenced workflow is not found", async () => {
    const n = node("sw", "sub-workflow", { workflowId: "missing-wf" })
    mockSingle.mockResolvedValue({ data: null, error: { message: "not found" } })

    await expect(
      executeSubWorkflow(n, {}, ctx()),
    ).rejects.toThrow("not found")
  })

  it("executes a simple sub-workflow with source + inline nodes", async () => {
    const n = node("sw", "sub-workflow", { workflowId: "ref-wf" })

    // Mock the referenced workflow data
    const subNodes: SimpleNode[] = [
      node("prompt", "text-prompt", { text: "hello from sub" }),
      node("out", "sub-workflow-output"),
    ]
    const subEdges: SimpleEdge[] = [edge("prompt", "out")]

    mockSingle.mockResolvedValue({
      data: { nodes: subNodes, edges: subEdges },
      error: null,
    })

    const result = await executeSubWorkflow(n, {}, ctx())

    // The sub-workflow output should collect from the output node's upstream
    // text-prompt -> sub-workflow-output
    expect(result).toBeDefined()
    // text-prompt is a source node so its output comes from extractSourceNodeOutput
    expect(result.text).toBe("hello from sub")
  })

  it("passes resolved inputs to sub-workflow-input node", async () => {
    const n = node("sw", "sub-workflow", { workflowId: "ref-wf" })

    const subNodes: SimpleNode[] = [
      node("swi", "sub-workflow-input"),
      node("swo", "sub-workflow-output"),
    ]
    const subEdges: SimpleEdge[] = [edge("swi", "swo")]

    mockSingle.mockResolvedValue({
      data: { nodes: subNodes, edges: subEdges },
      error: null,
    })

    const inputs: ResolvedInputs = {
      prompt: "upstream text",
      imageUrl: "https://upstream.png",
    }

    const result = await executeSubWorkflow(n, inputs, ctx())
    expect(result).toBeDefined()
    // The sub-workflow-input output is injected with both text and imageUrl,
    // but the output node collects via resolveNodeInputs which routes
    // sub-workflow-input through getPrimaryOutput -> text fallback.
    // The imageUrl is stored on the nodeState output but not surfaced
    // through the output collection (which only uses resolveNodeInputs).
    expect(result.text).toBe("upstream text")
  })

  it("emits _outputResults keyed by portId for per-port downstream routing", async () => {
    // Regression: backend runs used to return flat {text,imageUrl,...} with no
    // _outputResults map, so when downstream consumed the sub-workflow via a
    // specific `out_{portId}` handle, per-port routing silently fell back to
    // media-type matching. Output-extractor requires _outputResults for
    // handle-based routing.
    const n = node("sw", "sub-workflow", { workflowId: "ref-wf" })

    const subNodes: SimpleNode[] = [
      node("promptA", "text-prompt", { text: "value-A" }),
      node("promptB", "text-prompt", { text: "value-B" }),
      node("out", "sub-workflow-output", {
        ports: [
          { id: "portA", mediaType: "text" },
          { id: "portB", mediaType: "text" },
        ],
        visibleOutputPortId: "portA",
      }),
    ]
    const subEdges: SimpleEdge[] = [
      { id: "eA", source: "promptA", target: "out", sourceHandle: null, targetHandle: "portA" },
      { id: "eB", source: "promptB", target: "out", sourceHandle: null, targetHandle: "portB" },
    ]

    mockSingle.mockResolvedValue({
      data: { nodes: subNodes, edges: subEdges },
      error: null,
    })

    const result = await executeSubWorkflow(n, {}, ctx())
    expect(result._outputResults).toBeDefined()
    expect(result._outputResults?.portA).toBe("value-A")
    expect(result._outputResults?.portB).toBe("value-B")
    expect(result._visibleOutputPortId).toBe("portA")
  })

  it("throws when execution is cancelled", async () => {
    const n = node("sw", "sub-workflow", { workflowId: "ref-wf" })

    const subNodes: SimpleNode[] = [
      node("prompt", "text-prompt", { text: "hello" }),
      node("gen", "generate-image", { prompt: "test" }),
    ]
    const subEdges: SimpleEdge[] = [edge("prompt", "gen")]

    mockSingle.mockResolvedValue({
      data: { nodes: subNodes, edges: subEdges },
      error: null,
    })

    const cancelledCtx = ctx({ cancelled: true })
    await expect(
      executeSubWorkflow(n, {}, cancelledCtx),
    ).rejects.toThrow("cancelled")
  })

  it("filters nodes by route when routeSnapshot is present", async () => {
    const n = node("sw", "sub-workflow", {
      workflowId: "ref-wf",
      routeSnapshot: {
        inputNodeId: "swi",
        outputNodeId: "swo",
        inputPorts: [],
        outputPorts: [],
      },
    })

    // The full workflow has 4 nodes, but the route only spans swi -> mid -> swo
    const subNodes: SimpleNode[] = [
      node("swi", "sub-workflow-input"),
      node("mid", "text-prompt", { text: "routed" }),
      node("swo", "sub-workflow-output"),
      node("other", "generate-image", { prompt: "not reachable" }),
    ]
    const subEdges: SimpleEdge[] = [
      edge("swi", "mid"),
      edge("mid", "swo"),
      // 'other' is not connected to the route
    ]

    mockSingle.mockResolvedValue({
      data: { nodes: subNodes, edges: subEdges },
      error: null,
    })

    const result = await executeSubWorkflow(n, {}, ctx())
    expect(result).toBeDefined()
    // 'other' should not have been executed — only the routed path
    expect(result.text).toBe("routed")
  })

  it("collects output from terminal nodes as fallback", async () => {
    const n = node("sw", "sub-workflow", { workflowId: "ref-wf" })

    // No sub-workflow-output node — should fall back to terminal nodes
    const subNodes: SimpleNode[] = [
      node("prompt", "text-prompt", { text: "terminal text" }),
    ]
    const subEdges: SimpleEdge[] = []

    mockSingle.mockResolvedValue({
      data: { nodes: subNodes, edges: subEdges },
      error: null,
    })

    const result = await executeSubWorkflow(n, {}, ctx())
    expect(result).toBeDefined()
    // Terminal fallback should pick up text from text-prompt source output
    expect(result.text).toBe("terminal text")
  })

  it("uses default routeId when none specified", async () => {
    const n = node("sw", "sub-workflow", { workflowId: "ref-wf" })
    const subNodes: SimpleNode[] = [node("p", "text-prompt", { text: "ok" })]
    mockSingle.mockResolvedValue({ data: { nodes: subNodes, edges: [] }, error: null })

    // Should not throw — "default" route key should not conflict
    const existingKeys = new Set(["ref-wf:other-route"])
    const result = await executeSubWorkflow(n, {}, ctx(), 0, existingKeys)
    expect(result).toBeDefined()
  })
})

// ---------------------------------------------------------------------------
// MAX_SUB_WORKFLOW_DEPTH constant
// ---------------------------------------------------------------------------

describe("MAX_SUB_WORKFLOW_DEPTH", () => {
  it("is set to 5", () => {
    expect(MAX_SUB_WORKFLOW_DEPTH).toBe(5)
  })
})
