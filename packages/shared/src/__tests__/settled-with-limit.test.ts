import { settledWithLimit } from "../settled-with-limit.js"

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

describe("settledWithLimit", () => {
  // ── 1. Basic execution ──────────────────────────────────────────────
  it("resolves all tasks in order with concurrency limit respected", async () => {
    const tasks = [0, 1, 2, 3, 4].map(
      (i) => () => delay(10).then(() => `result-${i}`),
    )

    const results = await settledWithLimit(tasks, 2)

    expect(results).toHaveLength(5)
    for (let i = 0; i < 5; i++) {
      expect(results[i]).toEqual({ status: "fulfilled", value: `result-${i}` })
    }
  })

  // ── 2. Empty tasks ─────────────────────────────────────────────────
  it("returns an empty array when given no tasks", async () => {
    const results = await settledWithLimit([], 5)
    expect(results).toEqual([])
  })

  // ── 3. Single task ─────────────────────────────────────────────────
  it("works with a single task and limit 1", async () => {
    const results = await settledWithLimit(
      [() => Promise.resolve(42)],
      1,
    )

    expect(results).toHaveLength(1)
    expect(results[0]).toEqual({ status: "fulfilled", value: 42 })
  })

  // ── 4. Limit greater than task count ───────────────────────────────
  it("works when limit exceeds the number of tasks", async () => {
    const tasks = [
      () => Promise.resolve("a"),
      () => Promise.resolve("b"),
      () => Promise.resolve("c"),
    ]

    const results = await settledWithLimit(tasks, 10)

    expect(results).toHaveLength(3)
    expect(results[0]).toEqual({ status: "fulfilled", value: "a" })
    expect(results[1]).toEqual({ status: "fulfilled", value: "b" })
    expect(results[2]).toEqual({ status: "fulfilled", value: "c" })
  })

  // ── 5. Error handling ──────────────────────────────────────────────
  it("returns rejected entries for tasks that throw, without aborting others", async () => {
    const err = new Error("boom")
    const tasks = [
      () => Promise.resolve("ok"),
      () => Promise.reject(err),
      () => Promise.resolve("also ok"),
    ]

    const results = await settledWithLimit(tasks, 2)

    expect(results).toHaveLength(3)
    expect(results[0]).toEqual({ status: "fulfilled", value: "ok" })
    expect(results[1]).toEqual({ status: "rejected", reason: err })
    expect(results[2]).toEqual({ status: "fulfilled", value: "also ok" })
  })

  // ── 6. Concurrency enforcement ─────────────────────────────────────
  it("never exceeds the concurrency limit", async () => {
    const limit = 2
    let running = 0
    let maxRunning = 0

    const tasks = Array.from({ length: 8 }, (_, i) => async () => {
      running++
      maxRunning = Math.max(maxRunning, running)
      await delay(20)
      running--
      return i
    })

    const results = await settledWithLimit(tasks, limit)

    expect(maxRunning).toBeLessThanOrEqual(limit)
    expect(results).toHaveLength(8)
    results.forEach((r) => expect(r.status).toBe("fulfilled"))
  })

  // ── 7. Cancellation skips remaining tasks ──────────────────────────
  it("rejects un-started tasks with 'Execution cancelled' when cancelled mid-run", async () => {
    const cancelledRef = { cancelled: false }
    const started: number[] = []

    // 6 tasks with limit 2.  After the first two complete (~30ms),
    // we cancel so the remaining 4 should never start.
    const tasks = Array.from({ length: 6 }, (_, i) => async () => {
      started.push(i)
      await delay(30)
      return i
    })

    // Cancel after the first batch has started but before the rest begin
    setTimeout(() => {
      cancelledRef.cancelled = true
    }, 15)

    const results = await settledWithLimit(tasks, 2, cancelledRef)

    expect(results).toHaveLength(6)

    // First two tasks were already running and should complete
    expect(results[0]).toEqual({ status: "fulfilled", value: 0 })
    expect(results[1]).toEqual({ status: "fulfilled", value: 1 })

    // Remaining tasks that never started should be rejected
    const cancelledResults = results.filter(
      (r) => r.status === "rejected" && (r.reason as Error).message === "Execution cancelled",
    )
    expect(cancelledResults.length).toBeGreaterThan(0)

    // No more than limit tasks should have actually started
    // (the first 2 plus possibly 1-2 more depending on timing)
    expect(started.length).toBeLessThan(6)
  })

  // ── 8. Cancellation does not stop already-running tasks ────────────
  it("lets already-running tasks finish even after cancellation", async () => {
    const cancelledRef = { cancelled: false }
    const completed: number[] = []

    const tasks = [
      // Task 0: slow, already running before cancel
      async () => {
        await delay(50)
        completed.push(0)
        return "done-0"
      },
      // Task 1: slow, already running before cancel
      async () => {
        await delay(50)
        completed.push(1)
        return "done-1"
      },
      // Task 2: should never start
      async () => {
        completed.push(2)
        return "done-2"
      },
    ]

    // Cancel while the first two are still in-flight
    setTimeout(() => {
      cancelledRef.cancelled = true
    }, 10)

    const results = await settledWithLimit(tasks, 2, cancelledRef)

    // Both in-flight tasks should have completed
    expect(completed).toContain(0)
    expect(completed).toContain(1)
    expect(results[0]).toEqual({ status: "fulfilled", value: "done-0" })
    expect(results[1]).toEqual({ status: "fulfilled", value: "done-1" })

    // Third task should be cancelled, not started
    expect(completed).not.toContain(2)
    expect(results[2].status).toBe("rejected")
    expect((results[2] as PromiseRejectedResult).reason.message).toBe(
      "Execution cancelled",
    )
  })

  // ── 9. Results array indices match task indices ────────────────────
  it("preserves the index mapping between tasks and results", async () => {
    const tasks = [10, 20, 30, 40, 50].map(
      (v) => () => delay(Math.random() * 20).then(() => v),
    )

    const results = await settledWithLimit(tasks, 3)

    expect(results).toHaveLength(5)
    const values = results.map((r) => {
      expect(r.status).toBe("fulfilled")
      return (r as PromiseFulfilledResult<number>).value
    })
    expect(values).toEqual([10, 20, 30, 40, 50])
  })

  // ── 10. Mix of fulfilled and rejected ──────────────────────────────
  it("handles a mix of resolved and rejected tasks at specific indices", async () => {
    const err1 = new Error("fail-1")
    const err3 = new Error("fail-3")

    const tasks = [
      () => Promise.resolve("ok-0"),
      () => Promise.reject(err1),
      () => Promise.resolve("ok-2"),
      () => Promise.reject(err3),
      () => Promise.resolve("ok-4"),
    ]

    const results = await settledWithLimit(tasks, 2)

    expect(results).toHaveLength(5)
    expect(results[0]).toEqual({ status: "fulfilled", value: "ok-0" })
    expect(results[1]).toEqual({ status: "rejected", reason: err1 })
    expect(results[2]).toEqual({ status: "fulfilled", value: "ok-2" })
    expect(results[3]).toEqual({ status: "rejected", reason: err3 })
    expect(results[4]).toEqual({ status: "fulfilled", value: "ok-4" })
  })
})
