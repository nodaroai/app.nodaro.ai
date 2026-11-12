/**
 * The stop signal of a workflow step that fetches before its job is reserved
 * (run-stop-signal.ts): aborted by the worker's drain, by a run already marked
 * cancelled, and by the engine's throttled cancel read; disposed, it reads no
 * more.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

const exec = vi.hoisted(() => ({ status: "running" as string, reads: 0 }))
vi.mock("@/lib/supabase.js", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => {
            exec.reads += 1
            return { data: { status: exec.status }, error: null }
          },
        }),
      }),
    }),
  },
}))

import { runStopSignal } from "../run-stop-signal.js"
import type { OrchestratorContext } from "../types.js"

const ctxOf = (over: Partial<OrchestratorContext> = {}) => ({ executionId: "exec-1", cancelled: false, ...over }) as OrchestratorContext

const until = async (pred: () => boolean, tries = 500) => {
  for (let i = 0; i < tries && !pred(); i++) await new Promise((r) => setTimeout(r, 2))
}

beforeEach(() => {
  exec.status = "running"
  exec.reads = 0
})
afterEach(() => {
  vi.restoreAllMocks()
})

describe("runStopSignal", () => {
  it("aborts with the drain's reason when the worker drains", () => {
    const drain = new AbortController()
    const stop = runStopSignal(ctxOf(), { drain: drain.signal, pollMs: 60_000 })
    expect(stop.signal.aborted).toBe(false)
    const reason = new Error("draining")
    drain.abort(reason)
    expect(stop.signal.aborted).toBe(true)
    expect(stop.signal.reason).toBe(reason)
    stop.dispose()
  })

  it("is aborted at once for a run already marked cancelled", () => {
    const stop = runStopSignal(ctxOf({ cancelled: true }), { drain: new AbortController().signal, pollMs: 60_000 })
    expect(stop.signal.aborted).toBe(true)
    expect((stop.signal.reason as Error).message).toBe("Execution cancelled")
    stop.dispose()
  })

  it("aborts once the engine's cancel read finds the run cancelled, and marks the context", async () => {
    const ctx = ctxOf({ lastCancelCheckMs: 0 })
    exec.status = "cancelled"
    const stop = runStopSignal(ctx, { drain: new AbortController().signal, pollMs: 1 })
    // The read is throttled (every few cycles, and by time): let time run fast.
    let now = 0
    vi.spyOn(Date, "now").mockImplementation(() => (now += 20_000))
    await until(() => stop.signal.aborted)
    expect(stop.signal.aborted).toBe(true)
    expect(ctx.cancelled).toBe(true)
    stop.dispose()
  })

  it("reads nothing more once disposed", async () => {
    const stop = runStopSignal(ctxOf({ lastCancelCheckMs: 0 }), { drain: new AbortController().signal, pollMs: 1 })
    stop.dispose()
    const before = exec.reads
    await new Promise((r) => setTimeout(r, 30))
    expect(exec.reads).toBe(before)
    expect(stop.signal.aborted).toBe(false)
  })
})
