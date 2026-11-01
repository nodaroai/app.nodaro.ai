/**
 * The orchestrator's `ctx.onNodeQueued`: a sync-HTTP node waiting for its
 * route's slot shows `queueInfo`; the node states are written when a wait
 * starts and ends; the run's queued time is persisted then and at most once
 * every 30 s in between (a wait with no `queued` jobs row is otherwise
 * invisible to the sweeps that read a run's queued time); nothing it does can
 * throw into the run.
 */
import { describe, expect, it, vi } from "vitest"
import { nodeQueueReporter } from "../node-queue-reporter.js"
import { LANE_WAIT_PERSIST_MS } from "../../lib/concurrency-lanes/coordinator-wait.js"
import type { NodeExecutionState, NodeQueueInfo } from "../../services/workflow-engine/types.js"

const place = (position: number, waitedSeconds = 0): NodeQueueInfo =>
  ({ lane: "llm", position, limit: 1, running: 1, reason: "user_lane", waitedSeconds })

function harness(over: { persist?: () => Promise<unknown>; note?: () => void; emit?: (id: string) => void } = {}) {
  let clock = 1_000_000
  const nodeStates: Record<string, NodeExecutionState> = { n: { status: "running" } }
  const persistNodeStates = vi.fn(over.persist ?? (async () => undefined))
  const noteLaneWait = vi.fn(over.note ?? (() => undefined))
  const emit = vi.fn(over.emit ?? (() => undefined))
  const report = nodeQueueReporter({ nodeStates, persistNodeStates, noteLaneWait, emit, now: () => clock })
  return { report, nodeStates, persistNodeStates, noteLaneWait, emit, tick: (ms: number) => { clock += ms } }
}

describe("nodeQueueReporter", () => {
  it("shows queueInfo while the node waits and removes it once the wait is over", () => {
    const h = harness()
    h.report("n", place(2))
    expect(h.nodeStates.n!.queueInfo).toEqual(place(2))
    h.report("n", null)
    expect("queueInfo" in h.nodeStates.n!).toBe(false)
    // A node with no state, or a clear with nothing shown, does nothing.
    h.report("ghost", place(1))
    h.report("n", null)
    expect(h.persistNodeStates).toHaveBeenCalledTimes(2)
  })

  it("persists the run's queued time at most once per 30 s while a wait lasts, and at its start and end", () => {
    const h = harness()
    h.report("n", place(1))
    expect(h.noteLaneWait).toHaveBeenCalledTimes(1)
    // A check every 5 s for 2 minutes: a write at 30, 60, 90 and 120 s, never more often.
    for (let s = 5; s <= 120; s += 5) {
      h.tick(5_000)
      h.report("n", place(1, s))
    }
    expect(LANE_WAIT_PERSIST_MS).toBe(30_000)
    expect(h.noteLaneWait).toHaveBeenCalledTimes(1 + 4)
    h.tick(1_000)
    h.report("n", null)
    expect(h.noteLaneWait).toHaveBeenCalledTimes(1 + 4 + 1)
    // The node states are written only when the wait starts and ends.
    expect(h.persistNodeStates).toHaveBeenCalledTimes(2)
  })

  it("emits on a change of place, at the start and at the end — not on every check", () => {
    const h = harness()
    h.report("n", place(3))
    h.report("n", place(3, 5))
    h.report("n", place(3, 10))
    h.report("n", place(2, 15))
    h.report("n", null)
    expect(h.emit).toHaveBeenCalledTimes(3)
  })

  it("a write, a persist or an emit that fails never throws into the run", async () => {
    const unhandled = vi.fn()
    process.on("unhandledRejection", unhandled)
    try {
      const h = harness({
        persist: async () => { throw new Error("row write failed") },
        note: () => { throw new Error("persist failed") },
        emit: () => { throw new Error("emit failed") },
      })
      expect(() => h.report("n", place(1))).not.toThrow()
      h.tick(LANE_WAIT_PERSIST_MS)
      expect(() => h.report("n", place(2))).not.toThrow()
      expect(() => h.report("n", null)).not.toThrow()
      // The state still follows the wait, and every side effect was attempted.
      expect("queueInfo" in h.nodeStates.n!).toBe(false)
      expect(h.persistNodeStates).toHaveBeenCalledTimes(2)
      expect(h.noteLaneWait).toHaveBeenCalledTimes(3)
      await new Promise((r) => setTimeout(r, 10))
      expect(unhandled).not.toHaveBeenCalled()
      // A persist that throws synchronously (building its call) is caught too.
      const sync = harness({ persist: () => { throw new Error("could not build the write") } })
      expect(() => sync.report("n", place(1))).not.toThrow()
    } finally {
      process.off("unhandledRejection", unhandled)
    }
  })
})
