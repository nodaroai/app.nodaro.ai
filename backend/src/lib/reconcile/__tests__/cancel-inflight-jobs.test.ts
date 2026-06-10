import { describe, it, expect, vi, beforeEach } from "vitest"

const mocks = vi.hoisted(() => {
  const refundMock = vi.fn().mockResolvedValue(1)
  // select chain: from("jobs").select(...).eq(...).in(...) → rows
  const rows: unknown[] = []
  const selectInMock = vi.fn(() => Promise.resolve({ data: rows, error: null as { message: string } | null }))
  const selectEqMock = vi.fn(() => ({ in: selectInMock }))
  const selectMock = vi.fn(() => ({ eq: selectEqMock }))
  // update chain: from("jobs").update(...).eq(...).in(...).select("id") → flipped
  const updateCalls: Array<Record<string, unknown>> = []
  const updSelectMock = vi.fn(() => Promise.resolve({ data: [{ id: "flipped" }], error: null }))
  const updInMock = vi.fn(() => ({ select: updSelectMock }))
  const updEqMock = vi.fn(() => ({ in: updInMock }))
  const updateMock = vi.fn((arg: Record<string, unknown>) => {
    updateCalls.push(arg)
    return { eq: updEqMock }
  })
  const fromMock = vi.fn(() => ({ select: selectMock, update: updateMock }))
  return { refundMock, rows, selectInMock, updateMock, updateCalls, fromMock }
})

vi.mock("../../supabase.js", () => ({ supabase: { from: mocks.fromMock } }))
vi.mock("../../credits-job-lifecycle.js", () => ({ refundReservedCreditsForJob: mocks.refundMock }))

import { cancelInFlightChildJobs } from "../cancel-inflight-jobs.js"

describe("cancelInFlightChildJobs — adoption split (audit A2)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.rows.length = 0
    mocks.updateCalls.length = 0
    mocks.refundMock.mockResolvedValue(1)
  })

  it("PRE-provider row (no provider_task_id) → cancelled + refunded, node_id stripped", async () => {
    mocks.rows.push({
      id: "j-pre",
      input_data: { node_id: "node-1", type: "generate-image" },
      provider_task_id: null,
      usage_log_id: "ul-1",
      credits: 4,
    })

    const { cancelled, adoptable } = await cancelInFlightChildJobs("exec-1")

    expect(cancelled).toBe(1)
    expect(adoptable.size).toBe(0)
    expect(mocks.refundMock).toHaveBeenCalledWith("j-pre")
    const upd = mocks.updateCalls[0]!
    expect(upd.status).toBe("cancelled")
    const inputData = upd.input_data as Record<string, unknown>
    expect(inputData.node_id).toBeUndefined()
    expect(inputData.superseded_node_id).toBe("node-1")
  })

  it("POST-provider single-shot row → ADOPTED (no cancel, no refund — provider already paid)", async () => {
    mocks.rows.push({
      id: "j-post",
      input_data: { node_id: "node-2", type: "image-to-video" },
      provider_task_id: "kie-task-1",
      usage_log_id: "ul-2",
      credits: 15,
    })

    const { cancelled, adoptable } = await cancelInFlightChildJobs("exec-1")

    expect(cancelled).toBe(0)
    expect(mocks.updateMock).not.toHaveBeenCalled()
    expect(mocks.refundMock).not.toHaveBeenCalled()
    expect(adoptable.get("node-2")).toEqual({
      jobId: "j-post",
      usageLogId: "ul-2",
      creditsReserved: 15,
    })
  })

  it("POST-provider FAN-OUT iteration (iterationIndex set) → cancelled, not adopted", async () => {
    mocks.rows.push({
      id: "j-fan",
      input_data: { node_id: "node-3", iterationIndex: 2 },
      provider_task_id: "kie-task-2",
      usage_log_id: "ul-3",
      credits: 5,
    })

    const { cancelled, adoptable } = await cancelInFlightChildJobs("exec-1")

    expect(cancelled).toBe(1)
    expect(adoptable.size).toBe(0)
    expect(mocks.refundMock).toHaveBeenCalledWith("j-fan")
  })

  it("POST-provider row WITHOUT node_id (legacy/orphan) → cancelled, not adopted", async () => {
    mocks.rows.push({
      id: "j-orphan",
      input_data: {},
      provider_task_id: "kie-task-3",
      usage_log_id: null,
      credits: null,
    })

    const { cancelled, adoptable } = await cancelInFlightChildJobs("exec-1")

    expect(cancelled).toBe(1)
    expect(adoptable.size).toBe(0)
  })

  it("mixed batch: splits correctly and first adoptable per node wins", async () => {
    mocks.rows.push(
      { id: "j-a", input_data: { node_id: "n1" }, provider_task_id: "t-a", usage_log_id: "ul-a", credits: 3 },
      { id: "j-b", input_data: { node_id: "n1" }, provider_task_id: "t-b", usage_log_id: "ul-b", credits: 3 },
      { id: "j-c", input_data: { node_id: "n2" }, provider_task_id: null, usage_log_id: "ul-c", credits: 2 },
    )

    const { cancelled, adoptable } = await cancelInFlightChildJobs("exec-1")

    // j-a adopted for n1; j-b (duplicate for n1) cancelled; j-c (pre-provider) cancelled.
    expect(adoptable.get("n1")?.jobId).toBe("j-a")
    expect(cancelled).toBe(2)
    expect(mocks.refundMock).toHaveBeenCalledWith("j-b")
    expect(mocks.refundMock).toHaveBeenCalledWith("j-c")
  })
})
