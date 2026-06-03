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
        const chain = {
          eq: (...eqArgs: unknown[]) => {
            mockEq(...eqArgs)
            return chain
          },
          single: () => mockSingle(),
        }
        return chain
      },
    }),
  },
}))

// Mock node-executor to avoid pulling in BullMQ, etc.
vi.mock("../node-executor.js", () => ({
  executeNode: vi.fn().mockResolvedValue({ output: { text: "mock output" } }),
}))

import { executeSubWorkflow } from "../sub-workflow-handler.js"
import { executeNode } from "../node-executor.js"

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

  it("scopes the workflow fetch to ctx.userId when no workflowOwnerId (IDOR regression)", async () => {
    // Regression: previously the sub-workflow load was .eq("id", X).single()
    // with the service-role client, letting any user execute any workflow
    // by UUID. Without a workflowOwnerId (legacy callers), the scope falls
    // back to ctx.userId — so an attacker's own runs can't reference anyone
    // else's workflows.
    const n = node("sw", "sub-workflow", { workflowId: "victim-wf" })
    mockSingle.mockResolvedValue({
      data: { nodes: [node("p", "text-prompt", { text: "ok" })], edges: [] },
      error: null,
    })

    await executeSubWorkflow(n, {}, ctx({ userId: "attacker-1" }))

    const eqCalls = mockEq.mock.calls
    expect(eqCalls).toContainEqual(["id", "victim-wf"])
    expect(eqCalls).toContainEqual(["user_id", "attacker-1"])
  })

  it("scopes to workflowOwnerId when set (shared/app run with runner ≠ owner)", async () => {
    // Shared-workflow presentation runs execute under the viewer's identity
    // (ctx.userId = viewer) while the sub-workflow reference belongs to the
    // owner. Same shape for app runs (ctx.userId = runner, workflowOwnerId =
    // creator). The fetch must scope to the owner so those flows still work.
    const n = node("sw", "sub-workflow", { workflowId: "owner-sub-wf" })
    mockSingle.mockResolvedValue({
      data: { nodes: [node("p", "text-prompt", { text: "ok" })], edges: [] },
      error: null,
    })

    await executeSubWorkflow(
      n,
      {},
      ctx({ userId: "viewer-1", workflowOwnerId: "owner-1" }),
    )

    const eqCalls = mockEq.mock.calls
    expect(eqCalls).toContainEqual(["id", "owner-sub-wf"])
    expect(eqCalls).toContainEqual(["user_id", "owner-1"])
    // Must NOT scope to the viewer — that would break shared/app runs.
    expect(eqCalls).not.toContainEqual(["user_id", "viewer-1"])
  })

  it("throws when sub-workflow fetch returns null (not found / not owned)", async () => {
    // When the owner-scoped query returns no row — either because the
    // workflow doesn't exist or because it belongs to a different user —
    // the handler throws the same "not found" error. Caller can't
    // distinguish the two cases, which is the desired security property.
    const n = node("sw", "sub-workflow", { workflowId: "foreign-wf" })
    mockSingle.mockResolvedValue({ data: null, error: null })

    await expect(
      executeSubWorkflow(
        n,
        {},
        ctx({ userId: "viewer-1", workflowOwnerId: "owner-1" }),
      ),
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

  it("pre-completes parameter-picker nodes instead of executing them (Unknown-node-type regression)", async () => {
    // A parameter picker (mood/lens/framing/…) inside a sub-workflow has no job
    // handler. Before the fix it reached executeNode → buildPayload threw
    // "Unknown node type" and failed the whole sub-workflow. It must be
    // pre-completed (mirroring the main orchestrator) and never executed.
    const n = node("sw", "sub-workflow", { workflowId: "ref-wf" })
    const subNodes: SimpleNode[] = [
      node("mood", "mood", { mood: "tense" }),
      node("out", "sub-workflow-output"),
    ]
    const subEdges: SimpleEdge[] = [edge("mood", "out")]
    mockSingle.mockResolvedValue({ data: { nodes: subNodes, edges: subEdges }, error: null })

    await expect(executeSubWorkflow(n, {}, ctx())).resolves.toBeDefined()

    // executeNode must NOT be invoked for the parameter node.
    const executedMood = vi
      .mocked(executeNode)
      .mock.calls.some((c) => (c[0] as SimpleNode)?.type === "mood")
    expect(executedMood).toBe(false)
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
