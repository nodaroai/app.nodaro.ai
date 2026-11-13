/**
 * createScheduleExecution (lib/schedule-fire.ts) when the queue refuses the
 * run it wrote: the row is failed from `pending` through the run's own failure
 * path with this lane's message, its key KEPT (the row holds the fire's claim).
 * A false answer is read back only after a retried write (lib/enqueue-execution.ts
 * `failUnqueuedRun`): a write of this call's that landed with its answer lost
 * reads failed with this lane's message, so the fire is not counted as a run;
 * after the first write a false is believed — the run moved on and is counted.
 * The outcomes keep the fire's rules: "moved-on" is a run (`ok: true`); "failed"
 * and "unsettled" keep the claim (`ok: false, keepClaim: true`).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

const m = vi.hoisted(() => ({
  queueAdd: vi.fn(),
  failWaiting: vi.fn(),
  emit: vi.fn(),
  finalizeWrapper: vi.fn(),
  insertAppReport: vi.fn(),
  /** What the read-back of the run answers (`workflow_executions` by id). */
  readBack: vi.fn(),
}))

vi.mock("@/lib/orchestration-queue.js", () => ({ orchestrationQueue: { add: m.queueAdd } }))
vi.mock("@/lib/concurrency-lanes/run-failure.js", () => ({ failWaitingExecutionDetailed: m.failWaiting }))
vi.mock("@/lib/execution-events.js", () => ({ executionEvents: { emit: m.emit } }))
vi.mock("@/lib/use-case/finalize-wrapper.js", () => ({ finalizeUseCaseWrapper: m.finalizeWrapper }))
vi.mock("@/lib/app-reports.js", () => ({ insertAppReport: m.insertAppReport }))
vi.mock("@/lib/insert-job.js", () => ({ billingPairColumns: () => ({}) }))
vi.mock("@/lib/workflow-access.js", () => ({ canRunWorkflow: vi.fn(async () => true) }))
vi.mock("@/lib/trigger-fire-refusal.js", () => ({ recordTriggerFireRefusal: vi.fn(async () => undefined) }))
vi.mock("@/lib/preview-fire-refusal.js", () => ({ refusePreviewFire: vi.fn(async () => false) }))
vi.mock("@/lib/llm-unpriced-fire-refusal.js", () => ({ refuseUnpricedFire: vi.fn(async () => false) }))
vi.mock("@/lib/billing-context.js", () => ({
  resolveBillingContext: vi.fn(),
  shouldRefuseDegradedRunFor: vi.fn(async () => false),
}))

vi.mock("@/lib/supabase.js", () => {
  function chain(single: unknown, maybeSingle: () => unknown) {
    const c: Record<string, unknown> = {}
    for (const k of ["insert", "select", "eq"]) c[k] = vi.fn().mockReturnValue(c)
    c.single = vi.fn().mockResolvedValue(single)
    c.maybeSingle = vi.fn().mockImplementation(maybeSingle)
    return c
  }
  return {
    supabase: {
      from: vi.fn().mockImplementation((table: string) => {
        // The insert answers the new row; a by-id read is the settle's read-back.
        if (table === "workflow_executions") return chain({ data: { id: "exec-1" }, error: null }, () => m.readBack())
        // The trigger's provenance flag, read before the hand-off.
        return chain({ data: null, error: null }, () => Promise.resolve({ data: { owner_initiated: false }, error: null }))
      }),
    },
  }
})

import { createScheduleExecution, UNQUEUED_RUN_MESSAGE, type ScheduleExecutionArgs } from "../schedule-fire.js"
import { UNQUEUED_EXECUTION_MESSAGE } from "../enqueue-execution.js"
import type { BillingContext } from "../billing-context.js"

const ARGS: ScheduleExecutionArgs = {
  trigger: { id: "trigger-1", workflow_id: "wf-1", user_id: "owner-1", config: {}, last_triggered_at: null },
  nodeId: "sched-node",
  now: new Date("2026-11-13T12:00:00Z"),
  previousLastTriggeredAt: null,
  billingContext: { payer: "user", userId: "owner-1" } as unknown as BillingContext,
  idempotencyKey: "owner-1|schedule:trigger-1:2026-11-13T12:00",
}

const row = (status: string, error_message: string | null = null) => ({ data: { status, error_message }, error: null })
const firstWrite = (failed: boolean) => ({ failed, attempts: 1 })
const retriedWrite = (failed: boolean) => ({ failed, attempts: 2 })

let consoleError: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  m.queueAdd.mockReset().mockRejectedValue(new Error("Connection is closed."))
  m.failWaiting.mockReset().mockResolvedValue(firstWrite(true))
  m.emit.mockReset()
  m.finalizeWrapper.mockReset().mockResolvedValue("not_use_case")
  m.insertAppReport.mockReset().mockResolvedValue(true)
  m.readBack.mockReset().mockResolvedValue(row("running"))
  consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined)
})

afterEach(() => {
  consoleError.mockRestore()
})

describe("createScheduleExecution — a run the queue refuses", () => {
  it("a run this call failed: the claim kept, written with this lane's message and the key kept, nothing read back", async () => {
    await expect(createScheduleExecution(ARGS)).resolves.toEqual({ ok: false, keepClaim: true })
    expect(m.failWaiting).toHaveBeenCalledTimes(1)
    expect(m.failWaiting).toHaveBeenCalledWith("exec-1", UNQUEUED_RUN_MESSAGE, {})
    expect(m.readBack).not.toHaveBeenCalled()
  })

  it("a miss on the first write moved on: counted as a run, with no read", async () => {
    m.failWaiting.mockResolvedValue(firstWrite(false))
    // A read here could only fail or agree; it is never made.
    m.readBack.mockResolvedValue({ data: null, error: { message: "could not read" } })
    await expect(createScheduleExecution(ARGS)).resolves.toEqual({ ok: true, executionId: "exec-1" })
    expect(m.readBack).not.toHaveBeenCalled()
    expect(consoleError).toHaveBeenCalledTimes(1) // the refusal itself, never an unsettled run
  })

  it("a retried write that landed with its answer lost reads failed with this lane's message: failed, not counted, its event sent", async () => {
    m.failWaiting.mockResolvedValue(retriedWrite(false))
    m.readBack.mockResolvedValue(row("failed", UNQUEUED_RUN_MESSAGE))
    await expect(createScheduleExecution(ARGS)).resolves.toEqual({ ok: false, keepClaim: true })
    expect(m.readBack).toHaveBeenCalledTimes(1)
    expect(m.emit).toHaveBeenCalledWith("exec-1", { type: "execution:failed", executionId: "exec-1", nodeStates: {}, errorMessage: UNQUEUED_RUN_MESSAGE })
    expect(m.insertAppReport).not.toHaveBeenCalled()
  })

  it.each([
    ["running", row("running")],
    ["failed by another path", row("failed", "The run waited too long for a free slot.")],
    ["failed with a route's message, not this lane's", row("failed", UNQUEUED_EXECUTION_MESSAGE)],
  ])("a retried miss whose row reads %s moved on: counted as a run", async (_label, answer) => {
    m.failWaiting.mockResolvedValue(retriedWrite(false))
    m.readBack.mockResolvedValue(answer)
    await expect(createScheduleExecution(ARGS)).resolves.toEqual({ ok: true, executionId: "exec-1" })
    expect(m.emit).not.toHaveBeenCalled()
  })

  it("a retried miss whose read-back fails is unsettled: the claim kept, logged, no app report (as before)", async () => {
    m.failWaiting.mockResolvedValue(retriedWrite(false))
    m.readBack.mockResolvedValue({ data: null, error: { message: "could not read" } })
    await expect(createScheduleExecution(ARGS)).resolves.toEqual({ ok: false, keepClaim: true })
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining("could not confirm unqueued execution exec-1 failed"))
    expect(m.insertAppReport).not.toHaveBeenCalled()
  })

  it("a failure write that throws is unsettled: the claim kept, logged with its error", async () => {
    m.failWaiting.mockRejectedValue(new Error("updateExecutionWithRetry exhausted"))
    await expect(createScheduleExecution(ARGS)).resolves.toEqual({ ok: false, keepClaim: true })
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining("updateExecutionWithRetry exhausted"))
    expect(m.readBack).not.toHaveBeenCalled()
    expect(m.insertAppReport).not.toHaveBeenCalled()
  })

  it("a run the queue takes is not settled at all", async () => {
    m.queueAdd.mockReset().mockResolvedValue({})
    await expect(createScheduleExecution(ARGS)).resolves.toEqual({ ok: true, executionId: "exec-1" })
    expect(m.failWaiting).not.toHaveBeenCalled()
  })
})
