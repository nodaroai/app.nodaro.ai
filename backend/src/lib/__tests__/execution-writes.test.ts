import { describe, it, expect, vi, beforeEach } from "vitest"

// ---------------------------------------------------------------------------
// Mocked Supabase
// ---------------------------------------------------------------------------
//
// The chain shape we exercise:
//   supabase.from(t).update(data).eq("id", x)        — non-terminal write
//   supabase.from(t).update(data).eq("id", x).neq("status", "cancelled")
//                                                     — terminal write
// Both end with an awaitable that resolves to `{ data, error, count }`.

const mocks = vi.hoisted(() => {
  // Per-call error/data sequence. Tests push outcomes onto these queues
  // BEFORE invoking the helper; the mock consumes one per attempt.
  const errorQueue: Array<{ message: string; code?: string } | null> = []
  const dataQueue: Array<unknown[] | null> = []

  function nextOutcome() {
    const error = errorQueue.shift() ?? null
    const data = dataQueue.shift() ?? null
    return { data, error }
  }

  function fromBuilder() {
    const builder: Record<string, unknown> = {}
    builder.update = () => builder
    builder.eq = () => builder
    builder.neq = () => builder
    // `.select("id")` is chained at the end of the builder so PostgREST
    // returns the matched rows. The mock just continues the chain — the
    // injected `dataQueue` value already represents the post-select payload.
    builder.select = () => builder
    builder.then = (
      onResolve: (v: { data: unknown[] | null; error: unknown }) => unknown,
    ) => Promise.resolve(nextOutcome()).then(onResolve)
    return builder
  }

  const fromMock = vi.fn(() => fromBuilder())

  return { fromMock, errorQueue, dataQueue }
})

vi.mock("../supabase.js", () => ({ supabase: { from: mocks.fromMock } }))

// Speed up the test by collapsing the backoff sleeps. Without this we'd
// wait 100ms+400ms+1.6s = 2.1s per failure-cascade test.
vi.mock("node:timers/promises", () => ({
  setTimeout: vi.fn().mockResolvedValue(undefined),
}))

import { updateExecutionWithRetry } from "../execution-writes.js"

beforeEach(() => {
  vi.clearAllMocks()
  mocks.errorQueue.length = 0
  mocks.dataQueue.length = 0
})

describe("updateExecutionWithRetry", () => {
  it("returns ok=true on first-try success", async () => {
    mocks.errorQueue.push(null)
    mocks.dataQueue.push([{ id: "exec-1" }])

    const result = await updateExecutionWithRetry("exec-1", { node_states: {} })

    expect(result.ok).toBe(true)
    expect(result.attempts).toBe(1)
    expect(mocks.fromMock).toHaveBeenCalledTimes(1)
  })

  it("terminal status=completed write retries on transient error and succeeds", async () => {
    // Fail twice, succeed third time. Verifies the retry loop runs.
    mocks.errorQueue.push({ message: "network timeout" })
    mocks.errorQueue.push({ message: "503 service unavailable" })
    mocks.errorQueue.push(null)
    mocks.dataQueue.push(null, null, [{ id: "exec-1" }])

    const result = await updateExecutionWithRetry("exec-1", {
      status: "completed",
      completed_at: "2026-05-28T00:00:00Z",
    })

    expect(result.ok).toBe(true)
    expect(result.attempts).toBe(3)
    expect(mocks.fromMock).toHaveBeenCalledTimes(3)
  })

  it("terminal status=failed write retries on transient error and succeeds", async () => {
    mocks.errorQueue.push({ message: "PGRST301 connection reset" })
    mocks.errorQueue.push(null)
    mocks.dataQueue.push(null, [{ id: "exec-1" }])

    const result = await updateExecutionWithRetry("exec-1", { status: "failed" })

    expect(result.ok).toBe(true)
    expect(result.attempts).toBe(2)
  })

  it("non-terminal write does NOT retry — silent failures are acceptable for level-end writes", async () => {
    // Per-level writes happen many times during execution; failing one is
    // harmless because the next level will write again. Retrying every
    // intermediate write would waste cycles. Only the FINAL terminal write
    // needs hard guarantees.
    mocks.errorQueue.push({ message: "transient" })
    mocks.dataQueue.push(null)

    const result = await updateExecutionWithRetry("exec-1", {
      node_states: { node1: { status: "completed" } },
    })

    expect(result.ok).toBe(false)
    expect(result.attempts).toBe(1)
  })

  it("terminal write throws after exhausting all retries", async () => {
    mocks.errorQueue.push({ message: "perm 1" })
    mocks.errorQueue.push({ message: "perm 2" })
    mocks.errorQueue.push({ message: "perm 3" })
    mocks.dataQueue.push(null, null, null)

    await expect(
      updateExecutionWithRetry("exec-1", {
        status: "completed",
      }),
    ).rejects.toThrow(/Failed to write terminal status/)
  })

  it("zero-row update on terminal write returns ok=false but does NOT throw (cancelled-by-user case)", async () => {
    // When the WHERE includes .neq("status","cancelled") and the row IS
    // already cancelled, the UPDATE matches zero rows. No error, but no
    // rows updated either. This is the documented "user cancelled mid-
    // flight" path — caller (orchestrator) treats it as "done, the
    // cancellation stands" and continues without throwing.
    mocks.errorQueue.push(null)
    mocks.dataQueue.push([])  // empty data array = 0 rows matched

    const result = await updateExecutionWithRetry("exec-1", { status: "completed" })

    expect(result.ok).toBe(false)
    expect(result.cancelledRace).toBe(true)
    expect(result.attempts).toBe(1)  // no retry — zero rows isn't a transient error
  })

  it("zero-row update on terminal status=FAILED write ALSO returns cancelledRace (symmetry with status=completed)", async () => {
    // The cancelled-race guard at execution-writes.ts:96 keys on
    // `isTerminal` (status in {completed, failed}) — NOT on status==='completed'.
    // A failExecution race against a user cancellation MUST take the
    // cancelledRace branch the same way a complete-write does. Without
    // this test a regression narrowing the predicate to a single status
    // value would silently break failExecution.
    mocks.errorQueue.push(null)
    mocks.dataQueue.push([])

    const result = await updateExecutionWithRetry("exec-1", { status: "failed" })

    expect(result.ok).toBe(false)
    expect(result.cancelledRace).toBe(true)
    expect(result.attempts).toBe(1)
  })
})
