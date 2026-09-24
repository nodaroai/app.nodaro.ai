/**
 * The editor's component executor "waits as long as the server allows"
 * (decision 2026-09-24, podcast Track 0.11 follow-up). It used to give up at a
 * flat 30 minutes and paint the node failed while a long render inside the
 * component kept running server-side for hours.
 *
 * Pins, through the REAL executor loop (only the API, the store and the abandon
 * guard are faked):
 *  - nothing budgeted inside → still times out at 30 minutes, after one lookup;
 *  - a budgeted render inside → the wait becomes the SERVER's limit (base +
 *    excess), re-read each time it is reached, and a run that completes inside
 *    it completes;
 *  - a budgeted render NOT DISPATCHED YET at minute 30 (`pendingBudgetedNodes`)
 *    → the wait becomes the server's base, and the excess is picked up when
 *    that is reached (the render that starts at minute 40 is not abandoned);
 *  - a failed lookup is retried on the next ticks, then the known limit stands.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

type WaitLimit = { budgetExcessMs: number; waitLimitMs: number; pendingBudgetedNodes?: boolean }

const h = vi.hoisted(() => ({
  jobStatus: "processing" as string,
  waitReads: 0,
  waitLimit: { budgetExcessMs: 0, waitLimitMs: 90 * 60_000 } as WaitLimit | Error,
  /** Answers served before `waitLimit`, one per lookup. */
  waitQueue: [] as Array<WaitLimit | Error>,
  nodeData: {} as Record<string, unknown>,
}))

vi.mock("@/lib/api", () => ({
  executeComponent: vi.fn(async () => ({ jobId: "wrap-1" })),
  getJobStatusLean: vi.fn(async () => ({
    status: h.jobStatus,
    output_data: h.jobStatus === "completed" ? { out: "https://out.test/cut.mp4" } : null,
    error_message: null,
    progress: 10,
  })),
  cancelJob: vi.fn(async () => undefined),
  getComponentWaitLimit: vi.fn(async () => {
    h.waitReads++
    const answer = h.waitQueue.length > 0 ? h.waitQueue.shift()! : h.waitLimit
    if (answer instanceof Error) throw answer
    return answer
  }),
}))
vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: {
    getState: () => ({
      workflowId: "wf-1",
      updateNodeData: (_id: string, patch: Record<string, unknown>) => Object.assign(h.nodeData, patch),
    }),
  },
}))
vi.mock("../abandon-guard", () => ({ shouldAbandonNode: () => false }))
vi.mock("../poll-job", () => ({ RUN_START_RESET: {} }))
vi.mock("@/lib/i18n", () => ({ tx: (k: string) => k }))

import { executeComponent } from "../component-executor"
import { ComponentWaitDeadline, COMPONENT_CLIENT_TIMEOUT_MS, COMPONENT_WAIT_LOOKUP_ATTEMPTS } from "../component-wait"
import type { WorkflowNode } from "@/types/nodes"
import type { ExecutionContext } from "../types"

const MIN = 60_000

const node = {
  id: "cmp",
  type: "component",
  data: { appSlug: "tighten", componentMetadata: { inputs: [], outputs: [{ id: "out" }], exposedSettings: [] } },
} as unknown as WorkflowNode
const ctx = { isWorkflowStale: () => false, signal: undefined } as unknown as ExecutionContext

function run() {
  const settled: Array<{ ok: boolean; value: unknown }> = []
  const done = executeComponent(node, {} as never, ctx).then(
    (v) => settled.push({ ok: true, value: v }),
    (e) => settled.push({ ok: false, value: e }),
  )
  return { settled, done }
}

async function advance(ms: number) {
  for (let left = ms; left > 0; left -= MIN) await vi.advanceTimersByTimeAsync(Math.min(MIN, left))
}

beforeEach(() => {
  vi.useFakeTimers()
  h.jobStatus = "processing"
  h.waitReads = 0
  h.waitLimit = { budgetExcessMs: 0, waitLimitMs: 90 * MIN }
  h.waitQueue = []
  h.nodeData = {}
})
afterEach(() => vi.useRealTimers())

describe("ComponentWaitDeadline", () => {
  it("keeps 30 minutes as its base and never asks before it is spent", async () => {
    const read = vi.fn(async () => ({ budgetExcessMs: 60 * MIN, waitLimitMs: 150 * MIN }))
    const d = new ComponentWaitDeadline("j", read)
    expect(COMPONENT_CLIENT_TIMEOUT_MS).toBe(30 * MIN)
    expect(await d.reached(29 * MIN)).toBe(false)
    expect(read).not.toHaveBeenCalled()
    expect(await d.reached(30 * MIN)).toBe(false)
    expect(d.limitMs).toBe(150 * MIN)
  })

  it("an excess of 0 leaves the 30 minutes alone even though the server's own base is longer", async () => {
    const d = new ComponentWaitDeadline("j", async () => ({ budgetExcessMs: 0, waitLimitMs: 90 * MIN }))
    expect(await d.reached(30 * MIN)).toBe(true)
    expect(d.limitMs).toBe(30 * MIN)
  })

  it("a long render not dispatched yet: waits the server's base, then picks up the excess there", async () => {
    const limits = [
      { budgetExcessMs: 0, waitLimitMs: 90 * MIN, pendingBudgetedNodes: true },
      { budgetExcessMs: 150 * MIN, waitLimitMs: 240 * MIN, pendingBudgetedNodes: false },
    ]
    const d = new ComponentWaitDeadline("j", async () => limits.shift()!)
    expect(await d.reached(30 * MIN)).toBe(false)
    expect(d.limitMs).toBe(90 * MIN)
    expect(await d.reached(89 * MIN)).toBe(false)
    expect(await d.reached(90 * MIN)).toBe(false)
    expect(d.limitMs).toBe(240 * MIN)
  })

  it("…and still undispatched at the server's base, it times out there — with the server", async () => {
    const pending = { budgetExcessMs: 0, waitLimitMs: 90 * MIN, pendingBudgetedNodes: true }
    const read = vi.fn(async () => pending)
    const d = new ComponentWaitDeadline("j", read)
    expect(await d.reached(30 * MIN)).toBe(false)
    expect(await d.reached(90 * MIN)).toBe(true)
    expect(d.limitMs).toBe(90 * MIN)
    expect(read).toHaveBeenCalledTimes(2)
  })

  it("retries a failed lookup on the next ticks before the known limit stands", async () => {
    const read = vi.fn(async (): Promise<WaitLimit> => { throw new Error("network") })
    const d = new ComponentWaitDeadline("j", read)
    expect(COMPONENT_WAIT_LOOKUP_ATTEMPTS).toBe(3)
    expect(await d.reached(30 * MIN)).toBe(false)
    expect(await d.reached(30 * MIN + 2_500)).toBe(false)
    expect(await d.reached(30 * MIN + 5_000)).toBe(true)
    expect(read).toHaveBeenCalledTimes(3)
    expect(d.limitMs).toBe(30 * MIN)
  })

  it("a failed lookup followed by an answer extends as if nothing failed", async () => {
    const answers: Array<WaitLimit | Error> = [new Error("blip"), { budgetExcessMs: 60 * MIN, waitLimitMs: 150 * MIN }]
    const d = new ComponentWaitDeadline("j", async () => {
      const a = answers.shift()!
      if (a instanceof Error) throw a
      return a
    })
    expect(await d.reached(30 * MIN)).toBe(false)
    expect(await d.reached(30 * MIN + 2_500)).toBe(false)
    expect(d.limitMs).toBe(150 * MIN)
  })

  it("never shrinks, and re-reads when the grown limit is reached (the excess only grows)", async () => {
    const limits = [
      { budgetExcessMs: 60 * MIN, waitLimitMs: 150 * MIN },
      { budgetExcessMs: 120 * MIN, waitLimitMs: 210 * MIN },
      { budgetExcessMs: 10 * MIN, waitLimitMs: 100 * MIN },
    ]
    const d = new ComponentWaitDeadline("j", async () => limits.shift()!)
    expect(await d.reached(30 * MIN)).toBe(false)
    expect(await d.reached(150 * MIN)).toBe(false)
    expect(d.limitMs).toBe(210 * MIN)
    expect(await d.reached(210 * MIN)).toBe(true)
    expect(d.limitMs).toBe(210 * MIN)
  })
})

describe("executeComponent — the editor waits as long as the server allows", () => {
  it("nothing budgeted inside: times out at 30 minutes, exactly as before (one lookup)", async () => {
    const { settled, done } = run()
    await advance(29 * MIN)
    expect(settled).toHaveLength(0)
    await advance(2 * MIN)
    await done
    expect(settled[0].ok).toBe(false)
    expect((settled[0].value as Error).message).toBe("Component execution timed out")
    expect(h.waitReads).toBe(1)
  })

  it("a long render inside: still waiting at 2 hours, and its completion lands on the node", async () => {
    h.waitLimit = { budgetExcessMs: 150 * MIN, waitLimitMs: 240 * MIN }
    const { settled, done } = run()
    await advance(120 * MIN)
    expect(settled).toHaveLength(0)
    h.jobStatus = "completed"
    await advance(1 * MIN)
    await done
    expect(settled[0]).toEqual({ ok: true, value: "https://out.test/cut.mp4" })
    expect(h.nodeData.executionStatus).toBe("completed")
  })

  it("…but not past the server's own limit", async () => {
    h.waitLimit = { budgetExcessMs: 150 * MIN, waitLimitMs: 240 * MIN }
    const { settled, done } = run()
    await advance(239 * MIN)
    expect(settled).toHaveLength(0)
    await advance(2 * MIN)
    await done
    expect((settled[0].value as Error).message).toBe("Component execution timed out")
  })

  it("a render dispatched AFTER minute 30 (excess 0 at 30, non-zero from 40): still waiting at 2 hours, and it lands", async () => {
    h.waitLimit = { budgetExcessMs: 0, waitLimitMs: 90 * MIN, pendingBudgetedNodes: true }
    const { settled, done } = run()
    await advance(40 * MIN)
    expect(settled).toHaveLength(0)
    expect(h.waitReads).toBe(1)
    h.waitLimit = { budgetExcessMs: 150 * MIN, waitLimitMs: 240 * MIN, pendingBudgetedNodes: false }
    await advance(80 * MIN)
    expect(settled).toHaveLength(0)
    expect(h.waitReads).toBe(2)
    h.jobStatus = "completed"
    await advance(1 * MIN)
    await done
    expect(settled[0]).toEqual({ ok: true, value: "https://out.test/cut.mp4" })
    expect(h.nodeData.executionStatus).toBe("completed")
  })

  it("a transient lookup failure at minute 30 does not abandon a budgeted run", async () => {
    h.waitQueue = [new Error("blip")]
    h.waitLimit = { budgetExcessMs: 150 * MIN, waitLimitMs: 240 * MIN }
    const { settled, done } = run()
    await advance(120 * MIN)
    expect(settled).toHaveLength(0)
    expect(h.waitReads).toBe(2)
    h.jobStatus = "completed"
    await advance(1 * MIN)
    await done
    expect(settled[0].ok).toBe(true)
  })

  it("a lookup that keeps failing keeps the 30 minutes (after the retries)", async () => {
    h.waitLimit = new Error("network")
    const { settled, done } = run()
    await advance(31 * MIN)
    await done
    expect((settled[0].value as Error).message).toBe("Component execution timed out")
    expect(h.waitReads).toBe(COMPONENT_WAIT_LOOKUP_ATTEMPTS)
  })
})
