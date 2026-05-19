import { describe, it, expect } from "vitest"
import { settledOrThrow } from "../settled-or-throw.js"

describe("settledOrThrow", () => {
  it("returns the array of fulfilled values in order when every task resolves", async () => {
    const tasks = [
      () => Promise.resolve("a"),
      () => Promise.resolve("b"),
      () => Promise.resolve("c"),
    ]
    const result = await settledOrThrow(tasks, 2)
    expect(result).toEqual(["a", "b", "c"])
  })

  it("rethrows the first rejection wrapped in an Error when reason isn't one", async () => {
    const tasks = [
      () => Promise.resolve("a"),
      () => Promise.reject("plain string failure"),
    ]
    await expect(settledOrThrow(tasks, 2)).rejects.toThrow("plain string failure")
  })

  it("rethrows the original Error reference when reason is already an Error", async () => {
    const boom = new Error("the real reason")
    const tasks = [() => Promise.reject(boom), () => Promise.resolve("a")]
    await expect(settledOrThrow(tasks, 2)).rejects.toBe(boom)
  })

  it("prefers a real rejection over the synthetic 'Execution cancelled' marker", async () => {
    // Reproduces the failFast cancellation race: task 0 starts immediately,
    // task 1 also starts (concurrency=2), task 2 is queued. Task 0 takes
    // longer; task 1 rejects synchronously with the real reason. failFast
    // flips the cancel flag → task 2 is skipped with the synthetic
    // "Execution cancelled" marker. settledOrThrow must surface the REAL
    // rejection from task 1, not the synthetic one from task 2.
    const realFailure = new Error("ffprobe: invalid moov atom")
    const tasks: Array<() => Promise<string>> = [
      // Task 0 — slow success (still running when cancel fires).
      () => new Promise((resolve) => setTimeout(() => resolve("late"), 50)),
      // Task 1 — fast real failure.
      () => Promise.reject(realFailure),
      // Task 2 — never starts; gets the synthetic marker.
      () => Promise.resolve("never"),
    ]
    await expect(settledOrThrow(tasks, 2)).rejects.toBe(realFailure)
  })

  it("falls back to the cancellation marker only when every rejection IS a cancellation", async () => {
    // Defensive net for the impossible case where settledWithLimit hands us
    // only synthetic cancellation rejections (no real failures). Still
    // surface something so the caller doesn't silently get empty results.
    // This is unreachable with failFast=true, but the function is defensive.
    const tasks: Array<() => Promise<string>> = [
      // Both tasks reject with the cancellation marker — simulating the
      // unreachable "all cancellations" case.
      () => Promise.reject(new Error("Execution cancelled")),
      () => Promise.reject(new Error("Execution cancelled")),
    ]
    await expect(settledOrThrow(tasks, 1)).rejects.toThrow("Execution cancelled")
  })

  it("honors the concurrency limit (no more than `limit` tasks in flight at once)", async () => {
    let inFlight = 0
    let maxInFlight = 0
    const tasks: Array<() => Promise<number>> = Array.from(
      { length: 10 },
      (_, i) => () =>
        new Promise((resolve) => {
          inFlight++
          if (inFlight > maxInFlight) maxInFlight = inFlight
          setTimeout(() => {
            inFlight--
            resolve(i)
          }, 5)
        }),
    )
    const result = await settledOrThrow(tasks, 3)
    expect(result.length).toBe(10)
    expect(maxInFlight).toBeLessThanOrEqual(3)
  })

  it("handles an empty task list cleanly", async () => {
    const result = await settledOrThrow([], 5)
    expect(result).toEqual([])
  })
})
