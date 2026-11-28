import { describe, expect, it } from "vitest"
import { createShortageObserver, SHORTAGE_LOG_EVERY_MS } from "../process-shortage.js"

/** An observer over a counter and a clock the test moves. */
function harness(start: number | undefined) {
  const state = { refusals: start, now: 1_000_000, described: 0 }
  const lines: string[] = []
  const observer = createShortageObserver("render-worker", {
    now: () => state.now,
    refusals: () => state.refusals,
    describe: () => {
      state.described += 1
      return "LIMITS. Threads by program: CENSUS"
    },
    log: (line) => lines.push(line),
  })
  return { state, lines, observer }
}

describe("the shortage observer", () => {
  it("is silent while the kernel refuses nothing", () => {
    const { observer, lines, state } = harness(40)
    expect(observer.look()).toBe(0)
    state.now += 60_000
    expect(observer.look()).toBe(0)
    expect(lines).toEqual([])
    expect(observer.lastRefusalAt()).toBeUndefined()
    // The limits and the thread count are read only when a line is written.
    expect(state.described).toBe(0)
  })

  it("does not count the refusals from before this process looked", () => {
    const { observer, lines } = harness(196_973)
    expect(observer.look()).toBe(0)
    expect(lines).toEqual([])
  })

  it("says the first refusal at once, with the limits and who holds the threads", () => {
    const { observer, lines, state } = harness(0)
    state.refusals = 1
    expect(observer.look()).toBe(1)
    expect(lines).toEqual([
      "[render-worker] the container is at its process limit: 1 new process or thread refused. LIMITS. Threads by program: CENSUS",
    ])
    expect(observer.lastRefusalAt()).toBe(state.now)
  })

  it("writes at most one line per interval and carries the refusals in between into the next", () => {
    const { observer, lines, state } = harness(0)
    state.refusals = 3
    expect(observer.look()).toBe(3)
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain("3 new processes or threads refused")

    state.now += 5_000
    state.refusals = 10
    expect(observer.look()).toBe(7)
    state.now += 5_000
    state.refusals = 12
    expect(observer.look()).toBe(2)
    // Counted, not logged: a shortage refuses hundreds of times a second.
    expect(lines).toHaveLength(1)
    expect(observer.lastRefusalAt()).toBe(state.now)

    state.now += SHORTAGE_LOG_EVERY_MS
    state.refusals = 13
    expect(observer.look()).toBe(1)
    expect(lines).toHaveLength(2)
    expect(lines[1]).toContain("10 new processes or threads refused")
  })

  it("a look with nothing new writes nothing, however long ago the last line was", () => {
    const { observer, lines, state } = harness(0)
    state.refusals = 2
    observer.look()
    state.now += 10 * SHORTAGE_LOG_EVERY_MS
    expect(observer.look()).toBe(0)
    expect(lines).toHaveLength(1)
  })

  it("is inert where the count cannot be read, and starts from the first count it can read", () => {
    const { observer, lines, state } = harness(undefined)
    expect(observer.look()).toBe(0)
    // The first readable count is where it starts, not a burst of refusals.
    state.refusals = 500
    expect(observer.look()).toBe(0)
    state.refusals = 501
    expect(observer.look()).toBe(1)
    expect(lines).toHaveLength(1)
    // Unreadable again: no refusal, and the last count is kept.
    state.refusals = undefined
    expect(observer.look()).toBe(0)
    state.refusals = 501
    expect(observer.look()).toBe(0)
  })
})

describe("how recent a refusal is known to be", () => {
  it("a refusal is dated by the two looks it fell between", () => {
    const { observer, state } = harness(0)
    // The watch: a look every 5 s. Nothing refused yet.
    state.now += 5_000
    observer.look()
    expect(observer.refusedWithin(30_000)).toBe(false)
    // Refused some time in the next 5 s.
    state.now += 5_000
    state.refusals = 4
    expect(observer.refusedWithin(30_000)).toBe(true)
    // Still known to be that recent 20 s later, and no longer after 30.
    state.now += 20_000
    expect(observer.refusedWithin(30_000)).toBe(true)
    state.now += 6_000
    expect(observer.refusedWithin(30_000)).toBe(false)
  })

  it("without a look in between, a refusal is only as recent as the last look before it", () => {
    const { observer, state } = harness(0)
    // A launch looked when it began, ran for ten minutes, and then failed: the
    // refusal counted now may be ten minutes old.
    observer.look()
    state.now += 600_000
    state.refusals = 1
    expect(observer.refusedWithin(30_000)).toBe(false)
    // The same refusal is not made recent by asking again.
    expect(observer.refusedWithin(30_000)).toBe(false)
    // A launch that failed 3 s after it began knows the refusal came since.
    observer.look()
    state.now += 3_000
    state.refusals = 2
    expect(observer.refusedWithin(30_000)).toBe(true)
  })

  it("a look that could not read the count does not date anything", () => {
    const { observer, state } = harness(0)
    state.now += 600_000
    state.refusals = undefined
    observer.look()
    state.now += 1_000
    state.refusals = 3
    // The count was last read ten minutes ago: that is how old the refusal may be.
    expect(observer.refusedWithin(30_000)).toBe(false)
  })

  it("is false where the count cannot be read at all", () => {
    const { observer, state } = harness(undefined)
    state.now += 1_000
    expect(observer.refusedWithin(30_000)).toBe(false)
  })
})
