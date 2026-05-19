import { describe, it, expect, vi, beforeEach } from "vitest"

// Mock supabase chain
const { selectMock, neqMock, eqMock, updateMock, fromMock } = vi.hoisted(() => {
  const selectMock = vi.fn<(...args: unknown[]) => unknown>().mockResolvedValue({ data: [{ id: "j1" }], error: null })
  const neqMock = vi.fn<(...args: unknown[]) => unknown>(() => ({ select: selectMock }))
  const eqMock = vi.fn<(...args: unknown[]) => unknown>(() => ({ neq: neqMock }))
  const updateMock = vi.fn<(arg: Record<string, unknown>) => unknown>(() => ({ eq: eqMock }))
  const fromMock = vi.fn<(...args: unknown[]) => unknown>(() => ({ update: updateMock }))
  return { selectMock, neqMock, eqMock, updateMock, fromMock }
})

vi.mock("../../supabase.js", () => ({
  supabase: { from: fromMock },
}))

vi.mock("../../credits-job-lifecycle.js", () => ({
  refundReservedCreditsForJob: vi.fn().mockResolvedValue(undefined),
}))

import { sweepStaleSyncJob } from "../sync-sweep.js"
import { refundReservedCreditsForJob } from "../../credits-job-lifecycle.js"

describe("sweepStaleSyncJob", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    selectMock.mockResolvedValue({ data: [{ id: "j1" }], error: null })
    ;(refundReservedCreditsForJob as ReturnType<typeof vi.fn>).mockResolvedValue(undefined)
  })

  it("marks the job failed with human-readable error_message + machine reconcile_last_error tag", async () => {
    await sweepStaleSyncJob({ id: "j1", provider_kind: "anthropic-sync", reconcile_attempts: 0 })
    expect(updateMock).toHaveBeenCalledTimes(1)
    const updateArg = updateMock.mock.calls[0]![0]
    expect(updateArg.status).toBe("failed")
    expect(updateArg.error_message).toBe("Reconciliation could not recover this job. Please re-run.")
    expect(typeof updateArg.completed_at).toBe("string")
    expect(updateArg.reconcile_attempts).toBe(1)
    expect(updateArg.reconcile_last_error).toBe("reconcile_no_recovery")
  })

  it("uses CAS guard: .eq(\"id\", jobId).neq(\"status\", \"cancelled\")", async () => {
    await sweepStaleSyncJob({ id: "j-cas", provider_kind: "kie-llm", reconcile_attempts: 2 })
    expect(eqMock).toHaveBeenCalledWith("id", "j-cas")
    expect(neqMock).toHaveBeenCalledWith("status", "cancelled")
  })

  it("calls refundReservedCreditsForJob with the job id when CAS UPDATE found the row", async () => {
    await sweepStaleSyncJob({ id: "j-refund", provider_kind: "kie-llm", reconcile_attempts: 0 })
    expect(refundReservedCreditsForJob).toHaveBeenCalledWith("j-refund")
  })

  it("skips refund when CAS UPDATE returns 0 rows (another writer won)", async () => {
    selectMock.mockResolvedValueOnce({ data: [], error: null })
    await sweepStaleSyncJob({ id: "j-skip", provider_kind: "anthropic-sync", reconcile_attempts: 0 })
    expect(refundReservedCreditsForJob).not.toHaveBeenCalled()
  })

  it("handles null provider_kind (legacy rows) without throwing", async () => {
    await sweepStaleSyncJob({ id: "j-legacy", provider_kind: null, reconcile_attempts: 0 })
    const updateArg = updateMock.mock.calls[0]![0]
    expect(updateArg.status).toBe("failed")
    expect(updateArg.reconcile_last_error).toBe("reconcile_no_recovery")
  })

  it("does not throw or refund on a Supabase error during UPDATE", async () => {
    selectMock.mockResolvedValueOnce({ data: null, error: { message: "transient" } })
    await sweepStaleSyncJob({ id: "j-error", provider_kind: "anthropic-sync", reconcile_attempts: 0 })
    expect(refundReservedCreditsForJob).not.toHaveBeenCalled()
  })
})
