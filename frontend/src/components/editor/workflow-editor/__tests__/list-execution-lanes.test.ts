import { describe, it, expect, vi } from "vitest"

// A List fan-out never waits for the server's concurrency line sizes: with the
// read still out, its items start at once, at today's width.

const mockGetMyLanes = vi.fn(() => new Promise(() => {})) // never answers
const mockExecuteNode = vi.fn(() => new Promise(() => {})) // items stay running
const nodes = [{ id: "n1", type: "generate-image", position: { x: 0, y: 0 }, data: { label: "Gen Image" } as Record<string, unknown> }]

vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: {
    getState: () => ({ updateNodeData: vi.fn(), nodes, edges: [], workflowId: "wf-1" }),
    setState: vi.fn(),
  },
}))
vi.mock("@/lib/api", () => ({ getMyLanes: () => mockGetMyLanes() }))
vi.mock("@/lib/edition", () => ({ hasCredits: () => false }))
vi.mock("../execute-node", () => ({ executeNode: () => mockExecuteNode() }))
vi.mock("../execution-graph", () => ({ extractNodeOutput: vi.fn() }))

import { executeNodeForList } from "../list-execution"
import type { ExecutionContext } from "../types"
import type { WorkflowNode } from "@/types/nodes"

const ctx = { isWorkflowStale: () => false } as unknown as ExecutionContext

describe("a List fan-out and the server's line sizes", () => {
  it("a fan-out with a slow/hanging lanes fetch starts its items immediately at today's width", async () => {
    void executeNodeForList(nodes[0] as unknown as WorkflowNode, Array.from({ length: 15 }, (_, i) => `item ${i}`), ctx)
    // Today's off-Cloud width (12) starts, though the sizes read never answers.
    await vi.waitFor(() => expect(mockExecuteNode).toHaveBeenCalledTimes(12))
    expect(mockGetMyLanes).toHaveBeenCalled()
  })
})
