import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

vi.mock("@/lib/api", () => ({ cancelJob: vi.fn().mockResolvedValue({}) }))

import { pollUseCaseTextJob } from "../use-case-text-poll"

// A use-case text run is "taking longer than usual" after `longRunMs`; the time
// it waits in line for a free slot does not count toward that.

const ctx = {
  isWorkflowStale: () => false,
  trackInterval: (i: ReturnType<typeof setInterval>) => i,
  untrackInterval: (i: ReturnType<typeof setInterval>) => clearInterval(i),
}

function deps(status: () => { status: string; output_data?: unknown }) {
  return { status: async () => status(), gaveUp: () => null, stale: () => new Error("stale"), onProgress: () => {} }
}

describe("pollUseCaseTextJob's long-run notice and waiting for a free slot", () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it("is not told while the run waits in line, and is once it has run past longRunMs", async () => {
    const start = Date.now()
    const runsAt = start + 10 * 60_000
    const onLongRun = vi.fn()
    const outcome = pollUseCaseTextJob("j1", "n1", ctx, deps(() => (Date.now() < runsAt ? { status: "queued" } : { status: "processing" })), { longRunMs: 5 * 60_000, onLongRun })
    outcome.catch(() => {})
    await vi.advanceTimersByTimeAsync(12 * 60_000)
    expect(onLongRun).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(4 * 60_000)
    expect(onLongRun).toHaveBeenCalledTimes(1)
  })

  it("is told after longRunMs, as before, for a run that never waits", async () => {
    const onLongRun = vi.fn()
    const outcome = pollUseCaseTextJob("j1", "n1", ctx, deps(() => ({ status: "pending" })), { longRunMs: 5 * 60_000, onLongRun })
    outcome.catch(() => {})
    await vi.advanceTimersByTimeAsync(5 * 60_000 - 4_000)
    expect(onLongRun).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(6_000)
    expect(onLongRun).toHaveBeenCalledTimes(1)
  })
})
