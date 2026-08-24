/**
 * The gate that separates a clean auto-layout from the overlapping pile.
 *
 * ELK sizes an unmeasured node 200×120. Real nodes are media cards, 200–650px,
 * so laying out one frame too early packs 650px cards into 200px slots — which
 * is exactly the mess the Copilot's builds arrived in.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { whenNodesMeasured } from "../use-elk-layout"

type Node = { measured?: { width?: number } }

/** Drives the rAF queue the helper waits on. */
function flushFrames(n: number) {
  for (let i = 0; i < n; i++) vi.advanceTimersByTime(16)
}

beforeEach(() => {
  vi.useFakeTimers()
  // jsdom has no rAF under fake timers; the helper's setTimeout path is what
  // runs here, and it is the same wait either way.
  vi.stubGlobal("requestAnimationFrame", undefined)
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe("whenNodesMeasured", () => {
  it("returns immediately when everything is already measured", async () => {
    const nodes: Node[] = [{ measured: { width: 320 } }, { measured: { width: 210 } }]
    let done = false
    void whenNodesMeasured(() => nodes).then(() => {
      done = true
    })
    await vi.advanceTimersByTimeAsync(0)
    expect(done).toBe(true)
  })

  it("waits for the last unmeasured node, then proceeds", async () => {
    const nodes: Node[] = [{ measured: { width: 320 } }, {}]
    let done = false
    void whenNodesMeasured(() => nodes).then(() => {
      done = true
    })

    await vi.advanceTimersByTimeAsync(16)
    expect(done).toBe(false)

    // The node paints and React Flow measures it.
    nodes[1] = { measured: { width: 480 } }
    await vi.advanceTimersByTimeAsync(32)
    expect(done).toBe(true)
  })

  it("gives up rather than blocking the layout forever", async () => {
    // A node that never measures — rendered inside something collapsed, say.
    // An approximate layout beats no layout at all.
    const nodes: Node[] = [{}]
    let done = false
    void whenNodesMeasured(() => nodes, { maxFrames: 5 }).then(() => {
      done = true
    })
    await vi.advanceTimersByTimeAsync(16 * 6)
    expect(done).toBe(true)
  })

  it("does not wait on an empty canvas", async () => {
    let done = false
    void whenNodesMeasured(() => []).then(() => {
      done = true
    })
    await vi.advanceTimersByTimeAsync(0)
    expect(done).toBe(true)
  })

  it("stops when the caller has been cancelled", async () => {
    const nodes: Node[] = [{}]
    let cancelled = false
    let done = false
    void whenNodesMeasured(() => nodes, { cancelled: () => cancelled }).then(() => {
      done = true
    })
    await vi.advanceTimersByTimeAsync(16)
    cancelled = true
    await vi.advanceTimersByTimeAsync(16)
    expect(done).toBe(true)
  })
})
