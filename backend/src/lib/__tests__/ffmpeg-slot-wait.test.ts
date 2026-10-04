import { describe, it, expect } from "vitest"
import { SlotWaitLedger, currentSlotWaitLedger, runWithSlotWaitLedger } from "../ffmpeg-slot-wait.js"

// Track 0.13 (decided 2026-10-04): a job is STALLED on the ffmpeg slot queue
// only while it waits for a slot and holds none.

function clock() {
  let t = 0
  return { now: () => t, advance: (ms: number) => { t += ms } }
}

describe("SlotWaitLedger", () => {
  it("counts the time a queued call waits until it is granted", () => {
    const c = clock(); const l = new SlotWaitLedger(c.now)
    l.queued(); c.advance(5_000)
    expect(l.waitedMs()).toBe(5_000) // a stall in progress counts
    l.granted(true); c.advance(60_000)
    expect(l.waitedMs()).toBe(5_000) // running is not waiting
    l.released()
  })

  it("an immediate grant never counts", () => {
    const c = clock(); const l = new SlotWaitLedger(c.now)
    l.granted(false); c.advance(10_000); l.released()
    expect(l.waitedMs()).toBe(0)
  })

  it("a job that holds a slot while a second call queues is making progress, not stalled", () => {
    const c = clock(); const l = new SlotWaitLedger(c.now)
    l.granted(false)          // running one ffmpeg
    l.queued(); c.advance(30_000) // a second call waits — but the job is running
    expect(l.waitedMs()).toBe(0)
    l.released(); c.advance(10_000) // now it holds nothing and still waits: stalled
    expect(l.waitedMs()).toBe(10_000)
    l.granted(true); l.released()
    expect(l.waitedMs()).toBe(10_000)
  })

  it("a queued call that gives up stops the stall", () => {
    const c = clock(); const l = new SlotWaitLedger(c.now)
    l.queued(); c.advance(7_000); l.abandoned(); c.advance(50_000)
    expect(l.waitedMs()).toBe(7_000)
  })

  it("the ledger is the async context's: runWithSlotWaitLedger scopes it", async () => {
    const l = new SlotWaitLedger()
    expect(currentSlotWaitLedger()).toBeUndefined()
    await runWithSlotWaitLedger(l, async () => {
      await Promise.resolve()
      expect(currentSlotWaitLedger()).toBe(l)
    })
    expect(currentSlotWaitLedger()).toBeUndefined()
  })
})
