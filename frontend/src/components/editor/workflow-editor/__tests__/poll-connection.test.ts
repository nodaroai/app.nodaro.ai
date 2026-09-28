import { describe, it, expect, vi, beforeEach } from "vitest"

const mockNodes: Array<{ id: string; data: Record<string, unknown> }> = []
const mockUpdateNodeData = vi.fn((id: string, patch: Record<string, unknown>) => {
  const node = mockNodes.find((n) => n.id === id)
  if (node) node.data = { ...node.data, ...patch }
})

vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: {
    getState: () => ({ nodes: mockNodes, updateNodeData: mockUpdateNodeData }),
  },
}))

import { MAX_CONSECUTIVE_POLL_FAILURES } from "../types"
import {
  clearJobConnectionLost,
  connectionJustLost,
  isJobGoneError,
  jobGoneMessage,
  setJobConnectionLost,
  shouldStopPolling,
} from "../poll-connection"

const MAX = MAX_CONSECUTIVE_POLL_FAILURES
const offline = new TypeError("Failed to fetch")
const status = (code: number) => Object.assign(new Error(`HTTP ${code}`), { status: code })

beforeEach(() => {
  mockNodes.length = 0
  mockUpdateNodeData.mockClear()
})

describe("isJobGoneError", () => {
  it("is true only for the statuses that say the job itself cannot be read", () => {
    expect(isJobGoneError(status(404))).toBe(true)
    expect(isJobGoneError(status(403))).toBe(true)
    expect(isJobGoneError(status(410))).toBe(true)
  })

  it("is false for a lost connection, a timeout, a busy or broken server, and an expired session", () => {
    for (const err of [offline, new DOMException("t", "TimeoutError"), status(500), status(502), status(429), status(401), null, undefined]) {
      expect(isJobGoneError(err)).toBe(false)
    }
  })
})

describe("shouldStopPolling", () => {
  it("never stops before the threshold, and marks nothing", () => {
    mockNodes.push({ id: "n1", data: { currentJobId: "j1", executionStatus: "running" } })
    for (let failures = 1; failures < MAX; failures++) {
      expect(shouldStopPolling(status(404), failures, { nodeId: "n1", jobId: "j1" })).toBe(false)
      expect(shouldStopPolling(offline, failures, { nodeId: "n1", jobId: "j1" })).toBe(false)
    }
    expect(mockUpdateNodeData).not.toHaveBeenCalled()
  })

  it("stops at the threshold when the job is gone, without marking the node reconnecting", () => {
    mockNodes.push({ id: "n1", data: { currentJobId: "j1", executionStatus: "running" } })
    expect(shouldStopPolling(status(404), MAX, { nodeId: "n1", jobId: "j1" })).toBe(true)
    expect(mockNodes[0].data.jobConnectionLost).toBeUndefined()
  })

  it("keeps polling on a lost connection, however long, and marks the node reconnecting once", () => {
    mockNodes.push({ id: "n1", data: { currentJobId: "j1", executionStatus: "running" } })
    for (let failures = MAX; failures < MAX * 5; failures++) {
      expect(shouldStopPolling(offline, failures, { nodeId: "n1", jobId: "j1" })).toBe(false)
    }
    expect(mockNodes[0].data.jobConnectionLost).toBe(true)
    expect(mockUpdateNodeData).toHaveBeenCalledTimes(1)
  })

  it("does not mark a node that has moved on to another run", () => {
    mockNodes.push({ id: "n1", data: { currentJobId: "j2", executionStatus: "running" } })
    expect(shouldStopPolling(offline, MAX, { nodeId: "n1", jobId: "j1" })).toBe(false)
    expect(mockUpdateNodeData).not.toHaveBeenCalled()
  })

  it("with no owner node, only decides", () => {
    expect(shouldStopPolling(offline, MAX)).toBe(false)
    expect(shouldStopPolling(status(410), MAX)).toBe(true)
    expect(mockUpdateNodeData).not.toHaveBeenCalled()
  })
})

describe("connectionJustLost", () => {
  it("is true on the failure that crosses the threshold, and on no other", () => {
    expect(connectionJustLost(MAX - 1)).toBe(false)
    expect(connectionJustLost(MAX)).toBe(true)
    expect(connectionJustLost(MAX + 1)).toBe(false)
  })
})

describe("setJobConnectionLost", () => {
  it("writes only on a real transition", () => {
    mockNodes.push({ id: "n1", data: {} })
    setJobConnectionLost("n1", false)
    expect(mockUpdateNodeData).not.toHaveBeenCalled()
    setJobConnectionLost("n1", true)
    setJobConnectionLost("n1", true)
    expect(mockUpdateNodeData).toHaveBeenCalledTimes(1)
    setJobConnectionLost("n1", false)
    expect(mockUpdateNodeData).toHaveBeenLastCalledWith("n1", { jobConnectionLost: undefined })
    expect(mockUpdateNodeData).toHaveBeenCalledTimes(2)
  })

  it("does nothing for a node that is not on the canvas", () => {
    setJobConnectionLost("gone", true)
    expect(mockUpdateNodeData).not.toHaveBeenCalled()
  })
})

describe("clearJobConnectionLost", () => {
  it("clears the badge of the run the node is showing", () => {
    mockNodes.push({ id: "n1", data: { currentJobId: "j1", jobConnectionLost: true } })
    clearJobConnectionLost({ nodeId: "n1", jobId: "j1" })
    expect(mockNodes[0].data.jobConnectionLost).toBeUndefined()
  })

  it("leaves a newer run's badge alone when an older job's check gets through", () => {
    mockNodes.push({ id: "n1", data: { currentJobId: "j2", jobConnectionLost: true } })
    clearJobConnectionLost({ nodeId: "n1", jobId: "j1" })
    expect(mockNodes[0].data.jobConnectionLost).toBe(true)
    expect(mockUpdateNodeData).not.toHaveBeenCalled()
  })
})

describe("jobGoneMessage", () => {
  it("is a sentence the node can show", () => {
    expect(jobGoneMessage()).toMatch(/can't be found/)
  })
})
