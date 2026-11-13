/**
 * failWaitingExecutionDetailed / failWaitingExecution (lib/concurrency-lanes/run-failure.ts):
 * the detailed form answers whether this call failed the waiting run AND how
 * many times its write was sent — a miss after more than one write may hide a
 * write of this call's that landed with its answer lost
 * (lib/enqueue-execution.ts reads only those back). The boolean form keeps its
 * contract for the sweeps that call it.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const m = vi.hoisted(() => ({
  update: vi.fn(),
  emit: vi.fn(),
  finalizeWrapper: vi.fn(),
}))

vi.mock("@/lib/execution-writes.js", () => ({ updateExecutionWithRetry: m.update }))
vi.mock("@/lib/execution-events.js", () => ({ executionEvents: { emit: m.emit } }))
vi.mock("@/lib/use-case/finalize-wrapper.js", () => ({ finalizeUseCaseWrapper: m.finalizeWrapper }))
vi.mock("@/lib/supabase.js", () => ({ supabase: { from: vi.fn() } }))

import { failWaitingExecution, failWaitingExecutionDetailed } from "../run-failure.js"

const EXEC = "00000000-0000-4000-8000-000000000070"
const MESSAGE = "The run could not be queued to start. Run it again."

beforeEach(() => {
  m.update.mockReset()
  m.emit.mockReset()
  m.finalizeWrapper.mockReset().mockResolvedValue("not_use_case")
})

describe("failWaitingExecutionDetailed", () => {
  it("a write that landed: failed, with the attempts it took, and the run's event and wrapper done", async () => {
    m.update.mockResolvedValue({ ok: true, attempts: 2 })
    await expect(failWaitingExecutionDetailed(EXEC, MESSAGE, { idempotency_key: null })).resolves.toEqual({ failed: true, attempts: 2 })
    // A compare-and-set from `pending`, the extra columns in the same write.
    expect(m.update).toHaveBeenCalledWith(
      EXEC,
      expect.objectContaining({ idempotency_key: null, status: "failed", error_message: MESSAGE }),
      { fromStatuses: ["pending"] },
    )
    expect(m.emit).toHaveBeenCalledWith(EXEC, { type: "execution:failed", executionId: EXEC, nodeStates: {}, errorMessage: MESSAGE })
    expect(m.finalizeWrapper).toHaveBeenCalledWith(EXEC)
  })

  it("a miss on the first write: not failed, attempts 1 — nothing of this call's landed", async () => {
    m.update.mockResolvedValue({ ok: false, cancelledRace: true, attempts: 1 })
    await expect(failWaitingExecutionDetailed(EXEC, MESSAGE)).resolves.toEqual({ failed: false, attempts: 1 })
    expect(m.emit).not.toHaveBeenCalled()
    expect(m.finalizeWrapper).not.toHaveBeenCalled()
  })

  it("a miss after a retried write: not failed, with the attempts, so the caller knows to read the row back", async () => {
    m.update.mockResolvedValue({ ok: false, cancelledRace: true, attempts: 3 })
    await expect(failWaitingExecutionDetailed(EXEC, MESSAGE)).resolves.toEqual({ failed: false, attempts: 3 })
    expect(m.emit).not.toHaveBeenCalled()
  })

  it("a write that fails after its retries throws", async () => {
    m.update.mockRejectedValue(new Error("Failed to write terminal status"))
    await expect(failWaitingExecutionDetailed(EXEC, MESSAGE)).rejects.toThrow("Failed to write terminal status")
  })
})

describe("failWaitingExecution (the boolean contract)", () => {
  it("answers whether this call failed the run, however many writes it took", async () => {
    m.update.mockResolvedValueOnce({ ok: true, attempts: 1 })
    await expect(failWaitingExecution(EXEC, MESSAGE)).resolves.toBe(true)
    m.update.mockResolvedValueOnce({ ok: false, cancelledRace: true, attempts: 1 })
    await expect(failWaitingExecution(EXEC, MESSAGE)).resolves.toBe(false)
    m.update.mockResolvedValueOnce({ ok: false, cancelledRace: true, attempts: 2 })
    await expect(failWaitingExecution(EXEC, MESSAGE)).resolves.toBe(false)
    m.update.mockRejectedValueOnce(new Error("Failed to write terminal status"))
    await expect(failWaitingExecution(EXEC, MESSAGE)).rejects.toThrow()
  })
})
