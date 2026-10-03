import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

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
}))

// The deadline itself is covered by component-wait.test.ts; here it never ends.
vi.mock("../component-wait", () => ({
  ComponentWaitDeadline: class {
    async reached() { return false }
  },
}))

import { executeComponent } from "../component-executor"
import { MAX_CONSECUTIVE_POLL_FAILURES } from "../types"
import type { ExecutionContext } from "../types"
import type { WorkflowNode } from "@/types/nodes"

const ctx = { isWorkflowStale: () => false } as unknown as ExecutionContext

function componentNode(): WorkflowNode {
  const node = {
    id: "c1",
    type: "component",
    position: { x: 0, y: 0 },
    data: {
      appSlug: "my-app",
      componentMetadata: { inputs: [], outputs: [{ id: "out", type: "image" }], exposedSettings: [] },
    },
  }
  mockNodes.push(node as never)
  return node as unknown as WorkflowNode
}

describe("executeComponent — a lost connection is not a failed component", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mockNodes.length = 0
    mockUpdateNodeData.mockClear()
    mockGetJobStatusLean.mockReset()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it("keeps waiting through failed checks (past the threshold) and lands the result", async () => {
    const node = componentNode()
    let calls = 0
    mockGetJobStatusLean.mockImplementation(async () => {
      calls++
      if (calls <= MAX_CONSECUTIVE_POLL_FAILURES + 5) throw new TypeError("Failed to fetch")
      return { status: "completed", output_data: { out: "https://cdn.example.com/c.png" } }
    })

    const run = executeComponent(node, {} as never, ctx)
    await vi.advanceTimersByTimeAsync(2_500 * (MAX_CONSECUTIVE_POLL_FAILURES + 1))
    expect(mockNodes[0].data.executionStatus).toBe("running")
    expect(mockNodes[0].data.jobConnectionLost).toBe(true)

    await vi.advanceTimersByTimeAsync(2_500 * 10)
    await expect(run).resolves.toBe("https://cdn.example.com/c.png")
    expect(mockNodes[0].data.executionStatus).toBe("completed")
    expect(mockNodes[0].data.jobConnectionLost).toBeUndefined()
  })

  it("fails, with a message, only when the server says the job is gone", async () => {
    const node = componentNode()
    mockGetJobStatusLean.mockRejectedValue(Object.assign(new Error("Job not found"), { status: 404 }))

    const run = executeComponent(node, {} as never, ctx)
    run.catch(() => {})
    await vi.advanceTimersByTimeAsync(2_500 * (MAX_CONSECUTIVE_POLL_FAILURES + 1))

    await expect(run).rejects.toThrow(/can't be found/)
    expect(mockNodes[0].data.executionStatus).toBe("failed")
    expect(mockNodes[0].data.errorMessage).toMatch(/can't be found/)
  })
})
