import { describe, it, expect } from "vitest"
import { withSwitchXSlot } from "../switchx-concurrency.js"

// Beeble caps an account at 10 concurrent jobs GLOBALLY. The shared video worker
// has 50 slots, so without an in-process gate a burst of SwitchX runs would blow
// past 10 and trigger CONCURRENT_LIMIT_EXCEEDED retry storms. withSwitchXSlot caps
// concurrent fn() invocations at 8 (headroom below 10) and FIFO-queues the rest.
//
// These tests are deterministic: instead of timers, each task awaits a controllable
// "deferred" we resolve by hand, so we can freeze the system mid-flight and observe
// EXACTLY how many tasks are running. That is what proves the cap binds under real
// contention (peak === 8, not merely ≤ 8 by lucky interleaving) rather than passing
// trivially.

const MAX = 8

interface Deferred {
  promise: Promise<void>
  resolve: () => void
}

function deferred(): Deferred {
  let resolve!: () => void
  const promise = new Promise<void>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

// Yield to the microtask queue enough times for any chained .then() continuations
// inside withSwitchXSlot (slot release → next waiter admitted → its fn() body runs)
// to settle. A handful of awaits drains the whole cascade; the assertions don't
// depend on the exact count, only that it's "enough".
async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve()
}

describe("withSwitchXSlot", () => {
  it("caps concurrency at 8 under contention and resolves all 20 tasks (peak binds at 8)", async () => {
    const N = 20
    let live = 0
    let peak = 0
    // Per-task gate: a task that has been admitted (its fn body started) blocks on
    // its own deferred until we release it. This lets us hold all admitted tasks
    // simultaneously and read the true concurrency, instead of them racing through.
    const gates: Deferred[] = Array.from({ length: N }, () => deferred())
    const started: boolean[] = new Array(N).fill(false)
    const finished: boolean[] = new Array(N).fill(false)

    const results = Promise.all(
      gates.map((gate, i) =>
        withSwitchXSlot(async () => {
          started[i] = true
          live++
          if (live > peak) peak = live
          await gate.promise
          live--
          finished[i] = true
          return i
        }),
      ),
    )

    // Phase 1: nothing released yet. Exactly MAX tasks should be admitted and
    // sitting at their gate; the remaining N-MAX are queued (fn body never ran).
    await flushMicrotasks()
    expect(live).toBe(MAX)
    expect(peak).toBe(MAX)
    expect(started.filter(Boolean).length).toBe(MAX)
    // FIFO admission: the first MAX tasks (0..7) are the ones running.
    expect(started.slice(0, MAX).every(Boolean)).toBe(true)
    expect(started.slice(MAX).some(Boolean)).toBe(false)

    // Phase 2: release one admitted task. Its slot frees and the head of the FIFO
    // queue (task index 8) is admitted in its place — live returns to MAX, peak
    // never climbs above MAX.
    gates[0].resolve()
    await flushMicrotasks()
    expect(finished[0]).toBe(true)
    expect(live).toBe(MAX) // freed slot immediately reused by the next waiter
    expect(started[MAX]).toBe(true) // task 8 (FIFO head) was admitted next
    expect(peak).toBe(MAX) // the cap was never exceeded during hand-off

    // Phase 3: drain everything. Release all gates; every task must complete and
    // peak concurrency must have stayed pinned at exactly MAX the whole time.
    for (const g of gates) g.resolve()
    const out = await results
    expect(out).toEqual(Array.from({ length: N }, (_, i) => i))
    expect(finished.every(Boolean)).toBe(true)
    expect(peak).toBe(MAX)
    expect(live).toBe(0)
  })

  it("releases its slot even when fn throws (finally runs), so a queued waiter still gets admitted", async () => {
    // Saturate all MAX slots with tasks that throw once released, plus ONE extra
    // task queued behind them. If the throwing task failed to release its slot,
    // the queued task would hang forever and this test would time out.
    let waiterStarted = false
    const gates: Deferred[] = Array.from({ length: MAX }, () => deferred())

    const throwers = gates.map((gate, i) =>
      withSwitchXSlot(async () => {
        await gate.promise
        throw new Error(`boom-${i}`)
      }),
    )

    // The (MAX+1)-th task is queued behind the saturated slots.
    const waiter = withSwitchXSlot(async () => {
      waiterStarted = true
      return "admitted-after-throw"
    })

    // While the slots are full, the waiter must NOT have started yet.
    await flushMicrotasks()
    expect(waiterStarted).toBe(false)

    // Release one thrower. It rejects, but its finally{} must free the slot AND
    // wake the FIFO head (the waiter).
    gates[0].resolve()
    await flushMicrotasks()
    expect(waiterStarted).toBe(true)
    await expect(waiter).resolves.toBe("admitted-after-throw")

    // The rejection still propagates to the caller (slot release doesn't swallow it).
    await expect(throwers[0]).rejects.toThrow("boom-0")

    // Release the rest so no unhandled rejections leak between tests.
    for (let i = 1; i < gates.length; i++) gates[i].resolve()
    await Promise.allSettled(throwers)
  })

  it("runs to completion with no contention (single task passes straight through)", async () => {
    // Sanity floor: the gate must not get in the way when nothing is queued.
    const value = await withSwitchXSlot(async () => 42)
    expect(value).toBe(42)
  })
})
