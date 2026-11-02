import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

// The component executor's 30-minute wait (COMPONENT_CLIENT_TIMEOUT_MS) and
// waiting for a free slot: the time its job is seen `queued` does not count,
// and the node shows where the job stands in line.

const mockNodes: Array<{ id: string; type?: string; data: Record<string, unknown> }> = []
const mockUpdateNodeData = vi.fn((id: string, patch: Record<string, unknown>) => {
  const node = mockNodes.find((n) => n.id === id)
  if (node) node.data = { ...node.data, ...patch }
})
const mockGetJobStatusLean = vi.fn()

vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: {
    getState: () => ({ nodes: mockNodes, updateNodeData: mockUpdateNodeData, workflowId: "w1" }),
  },
}))

vi.mock("@/lib/api", () => ({
  executeComponent: vi.fn().mockResolvedValue({ jobId: "j1" }),
  getJobStatusLean: (...args: unknown[]) => mockGetJobStatusLean(...args),
  cancelJob: vi.fn().mockResolvedValue({}),
  getExecutionEstimate: vi.fn(),
  // Nothing budgeted inside: the wait stays at its 30 minutes.
  getComponentWaitLimit: vi.fn().mockResolvedValue({ budgetExcessMs: 0, waitLimitMs: 30 * 60_000, pendingBudgetedNodes: false }),
}))

import { executeComponent } from "../component-executor"
import { COMPONENT_CLIENT_TIMEOUT_MS } from "../component-wait"
import type { ExecutionContext } from "../types"
import type { WorkflowNode } from "@/types/nodes"

const ctx = { isWorkflowStale: () => false } as unknown as ExecutionContext
const QUEUE = { lane: "run", position: 2, limit: 1, running: 1, reason: "user_lane", waitedSeconds: 5, upgradeHint: null }

function componentNode(): WorkflowNode {
  const node = {
    id: "c1",
    type: "component",
    position: { x: 0, y: 0 },
    data: { appSlug: "my-app", componentMetadata: { inputs: [], outputs: [{ id: "out", type: "image" }], exposedSettings: [] } },
  }
  mockNodes.push(node as never)
  return node as unknown as WorkflowNode
}

describe("executeComponent — waiting for a free slot", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mockNodes.length = 0
    mockUpdateNodeData.mockClear()
    mockGetJobStatusLean.mockReset()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it("does not give up while queued, and shows the place in line until the job runs", async () => {
    const node = componentNode()
    const runsAt = Date.now() + 40 * 60_000
    const doneAt = runsAt + 20 * 60_000
    mockGetJobStatusLean.mockImplementation(async () => {
      const now = Date.now()
      if (now < runsAt) return { status: "queued", queue: QUEUE }
      if (now < doneAt) return { status: "processing", progress: 50 }
      return { status: "completed", output_data: { out: "https://cdn.example.com/c.png" } }
    })

    const run = executeComponent(node, {} as never, ctx)
    await vi.advanceTimersByTimeAsync(5 * 60_000)
    expect(mockNodes[0].data.queueInfo).toEqual({ ...QUEUE, jobId: "j1" })
    await vi.advanceTimersByTimeAsync(36 * 60_000)
    expect(mockNodes[0].data.queueInfo).toBeUndefined()
    await vi.advanceTimersByTimeAsync(20 * 60_000)
    await expect(run).resolves.toBe("https://cdn.example.com/c.png")
  })

  it("gives up after the same 30 minutes as before on a job that never waits in line", async () => {
    const node = componentNode()
    mockGetJobStatusLean.mockResolvedValue({ status: "pending" })
    const run = executeComponent(node, {} as never, ctx)
    run.catch(() => {})
    await vi.advanceTimersByTimeAsync(COMPONENT_CLIENT_TIMEOUT_MS + 10_000)
    await expect(run).rejects.toThrow("Component execution timed out")
    expect(mockNodes[0].data.queueInfo).toBeUndefined()
  })
})
