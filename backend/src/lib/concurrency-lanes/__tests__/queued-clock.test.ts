// @test-reads-none pure arithmetic; reads no repo file
// The shared arithmetic of the clocks that leave queued time out: a poll loop
// credits only time it saw the awaited job `queued`, never past the queue
// timeout's bound; overlapping waits count once.
import { describe, expect, it } from "vitest"
import { cappedQueuedMs, coveredMs, MAX_QUEUED_CREDIT_MS, mergeWaitInterval, QueuedPollClock } from "../queued-clock.js"

describe("QueuedPollClock", () => {
  it("credits the time before each read that found the job queued, and nothing else", () => {
    let now = 0
    const heard: Array<[number, number]> = []
    const clock = new QueuedPollClock((from, to) => heard.push([from, to]), () => now)
    now = 5_000; expect(clock.observe("pending")).toBe(false)
    now = 10_000; expect(clock.observe("queued")).toBe(true)
    now = 15_000; clock.observe("queued")
    now = 20_000; clock.observe("processing")
    expect(clock.queuedMs).toBe(10_000)
    expect(heard).toEqual([[5_000, 10_000], [10_000, 15_000]])
  })

  it("never credits past the queue timeout's bound", () => {
    let now = 0
    const clock = new QueuedPollClock(undefined, () => now)
    now = MAX_QUEUED_CREDIT_MS - 1_000; clock.observe("queued")
    now = MAX_QUEUED_CREDIT_MS + 60_000; clock.observe("queued")
    now = 3 * MAX_QUEUED_CREDIT_MS; clock.observe("queued")
    expect(clock.queuedMs).toBe(MAX_QUEUED_CREDIT_MS)
  })

  it("a caller's books that throw never fail the wait", () => {
    let now = 0
    const clock = new QueuedPollClock(() => { throw new Error("books") }, () => now)
    now = 1_000
    expect(() => clock.observe("queued")).not.toThrow()
    expect(clock.queuedMs).toBe(1_000)
  })
})

describe("wait intervals and the credit bound", () => {
  it("overlapping waits count once, separate ones in full", () => {
    const a = mergeWaitInterval([], 0, 10)!
    const b = mergeWaitInterval(a, 5, 15)!
    const c = mergeWaitInterval(b, 20, 30)!
    expect(c).toEqual([[0, 15], [20, 30]])
    expect(coveredMs(c)).toBe(25)
    expect(mergeWaitInterval(c, 5, 5)).toBeNull()
  })

  it("a figure read from a row is credited within the bound, and junk is 0", () => {
    expect(cappedQueuedMs(40 * 60_000)).toBe(40 * 60_000)
    expect(cappedQueuedMs("120000")).toBe(120_000)
    expect(cappedQueuedMs(10 * MAX_QUEUED_CREDIT_MS)).toBe(MAX_QUEUED_CREDIT_MS)
    for (const junk of [null, undefined, -5, Number.NaN, "x", {}]) expect(cappedQueuedMs(junk)).toBe(0)
  })
})
