import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import type { JobQueueInfo } from "@/lib/api"

// The node-owning poll funnel and waiting for a free slot: the queue badge's
// `queueInfo` is kept on the node, and a poll budget is not used up by the time
// the job waits in line.

const mockGetJobStatusLean = vi.fn()
const mockNodes: Array<{ id: string; data: Record<string, unknown> }> = []
const mockUpdateNodeData = vi.fn((id: string, patch: Record<string, unknown>) => {
  const node = mockNodes.find((n) => n.id === id)
  if (node) node.data = { ...node.data, ...patch }
})

vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: { getState: () => ({ updateNodeData: mockUpdateNodeData, nodes: mockNodes, edges: [] }) },
}))

vi.mock("@/lib/api", () => ({
  getJobStatusLean: (...args: unknown[]) => mockGetJobStatusLean(...args),
  getExecutionEstimate: vi.fn().mockResolvedValue(null),
  cancelJob: vi.fn().mockResolvedValue({ success: true, cancelled: 1 }),
}))

import { getJobStatusLeanForNode, pollJobOutputWithEnd } from "../poll-job"

const QUEUE: JobQueueInfo = { lane: "provider", position: 3, limit: 4, running: 4, reason: "user_lane", waitedSeconds: 12, upgradeHint: "plan" }

function queueWrites(): unknown[] {
  return mockUpdateNodeData.mock.calls.filter(([, patch]) => "queueInfo" in patch).map(([, patch]) => patch.queueInfo)
}

describe("the poll funnel and the queue badge", () => {
  beforeEach(() => {
    mockGetJobStatusLean.mockReset()
    mockUpdateNodeData.mockClear()
    mockNodes.length = 0
    mockNodes.push({ id: "n1", data: { executionStatus: "running", currentJobId: "j1" } })
  })

  it("poll funnel stores queueInfo and clears it when running", async () => {
    mockGetJobStatusLean
      .mockResolvedValueOnce({ id: "j1", status: "queued", queue: QUEUE })
      .mockResolvedValueOnce({ id: "j1", status: "queued", queue: { ...QUEUE, waitedSeconds: 14 } })
      .mockResolvedValueOnce({ id: "j1", status: "queued", queue: { ...QUEUE, position: 1, waitedSeconds: 30 } })
      .mockResolvedValueOnce({ id: "j1", status: "processing" })
      .mockResolvedValueOnce({ id: "j1", status: "processing" })

    await getJobStatusLeanForNode("j1", "n1")
    // Stamped with the job it is about, so the badge can tell it is this run's.
    expect(mockNodes[0].data.queueInfo).toEqual({ ...QUEUE, jobId: "j1" })
    // The same place in line, only later: no write, so no re-render each tick.
    await getJobStatusLeanForNode("j1", "n1")
    expect(queueWrites()).toHaveLength(1)
    // A new place in line is written.
    await getJobStatusLeanForNode("j1", "n1")
    expect(mockNodes[0].data.queueInfo).toEqual({ ...QUEUE, position: 1, waitedSeconds: 30, jobId: "j1" })
    // Running: the badge goes, once.
    await getJobStatusLeanForNode("j1", "n1")
    await getJobStatusLeanForNode("j1", "n1")
    expect(mockNodes[0].data.queueInfo).toBeUndefined()
    expect(queueWrites()).toEqual([{ ...QUEUE, jobId: "j1" }, { ...QUEUE, position: 1, waitedSeconds: 30, jobId: "j1" }, undefined])
  })

  it("never writes queueInfo for a job that never waits (nothing changes with lanes off)", async () => {
    for (const status of ["pending", "processing", "pending_review", "completed"]) {
      mockGetJobStatusLean.mockResolvedValueOnce({ id: "j1", status })
      await getJobStatusLeanForNode("j1", "n1")
    }
    expect(queueWrites()).toEqual([])
    expect("queueInfo" in mockNodes[0].data).toBe(false)
  })

  it("writes nothing for a job the node has moved on from (a re-run, a discard)", async () => {
    mockGetJobStatusLean.mockResolvedValue({ id: "j1", status: "queued", queue: QUEUE })
    mockNodes[0].data.currentJobId = "j2"
    await getJobStatusLeanForNode("j1", "n1")
    mockNodes[0].data.currentJobId = undefined
    await getJobStatusLeanForNode("j1", "n1")
    expect(queueWrites()).toEqual([])
  })

  it("writes for any job of a running List fan-out (they share the one slot)", async () => {
    mockGetJobStatusLean.mockResolvedValue({ id: "j7", status: "queued", queue: QUEUE })
    mockNodes[0].data = { executionStatus: "running", currentJobId: "j1", __listRunning: true }
    await getJobStatusLeanForNode("j7", "n1")
    expect(mockNodes[0].data.queueInfo).toEqual({ ...QUEUE, jobId: "j7" })
  })

  it("ignores a queue on a job that is no longer queued", async () => {
    mockGetJobStatusLean.mockResolvedValueOnce({ id: "j1", status: "processing", queue: QUEUE })
    await getJobStatusLeanForNode("j1", "n1")
    expect(queueWrites()).toEqual([])
  })
})

describe("a poll budget and waiting for a free slot", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mockGetJobStatusLean.mockReset()
    mockUpdateNodeData.mockClear()
    mockNodes.length = 0
    mockNodes.push({ id: "n1", data: { executionStatus: "running", currentJobId: "j1" } })
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it("does not give up while the job waits in line", async () => {
    // Queued for 30 s against a 10 s budget, then done.
    const doneAt = Date.now() + 30_000
    mockGetJobStatusLean.mockImplementation(async () =>
      Date.now() < doneAt ? { id: "j1", status: "queued", queue: QUEUE } : { id: "j1", status: "completed", output_data: { text: "ok" } },
    )
    const result = pollJobOutputWithEnd("j1", "n1", { budgetMs: 10_000 })
    await vi.advanceTimersByTimeAsync(40_000)
    await expect(result).resolves.toEqual({ output: { text: "ok" } })
  })

  it("still gives up on a job that is not queued, on the same budget as before", async () => {
    mockGetJobStatusLean.mockResolvedValue({ id: "j1", status: "pending" })
    const result = pollJobOutputWithEnd("j1", "n1", { budgetMs: 10_000 })
    const settled = expect(result).rejects.toThrow("The scrape did not finish in time")
    await vi.advanceTimersByTimeAsync(12_000)
    await settled
  })
})
