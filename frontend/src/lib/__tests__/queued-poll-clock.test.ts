// @vitest-environment node
import { describe, it, expect } from "vitest"
import { MAX_QUEUED_CREDIT_MS, QueuedPollClock } from "../queued-poll-clock"

describe("QueuedPollClock", () => {
  it("credits the stretch since the previous read to each read that finds the job queued", () => {
    const clock = new QueuedPollClock(1_000)
    expect(clock.observe("pending", 3_000)).toBe(false)
    expect(clock.observe("queued", 5_000)).toBe(true)
    expect(clock.observe("queued", 7_000)).toBe(true)
    expect(clock.observe("processing", 9_000)).toBe(false)
    expect(clock.creditMs).toBe(4_000)
    expect(clock.countedMs(1_000, 9_000)).toBe(4_000)
  })

  it("credits nothing to a job never seen queued, so every clock is what it was", () => {
    const clock = new QueuedPollClock(0)
    for (const [status, at] of [["pending", 2_000], [undefined, 4_000], ["processing", 6_000], ["pending_review", 8_000]] as const) {
      expect(clock.observe(status, at)).toBe(false)
    }
    expect(clock.countedMs(0, 8_000)).toBe(8_000)
  })

  it("a failed read moves the mark without a credit", () => {
    const clock = new QueuedPollClock(0)
    clock.observe(undefined, 60_000)
    clock.observe("queued", 62_000)
    expect(clock.creditMs).toBe(2_000)
  })

  it("never credits more than MAX_QUEUED_CREDIT_MS (24 h 30 min, the server's and the SDK's figure)", () => {
    expect(MAX_QUEUED_CREDIT_MS).toBe((24 * 60 + 30) * 60_000)
    const clock = new QueuedPollClock(0)
    expect(clock.observe("queued", MAX_QUEUED_CREDIT_MS + 5_000)).toBe(true)
    expect(clock.creditMs).toBe(MAX_QUEUED_CREDIT_MS)
    // Past the cap a queued read counts again.
    expect(clock.observe("queued", MAX_QUEUED_CREDIT_MS + 7_000)).toBe(false)
    expect(clock.creditMs).toBe(MAX_QUEUED_CREDIT_MS)
  })
})
