import { afterEach, describe, expect, it, vi } from "vitest"
import { createInflightSlots } from "../inflight-slots.js"

/** A lane's download slots: a per-user and a global limit, a short wait for a free slot, every slot given back. */
describe("createInflightSlots", () => {
  afterEach(() => { vi.useRealTimers() })

  it("holds the per-user and the global limit", () => {
    const s = createInflightSlots({ perUser: 2, global: 3 })
    expect(s.tryAcquire("a")).toBe(true)
    expect(s.tryAcquire("a")).toBe(true)
    expect(s.tryAcquire("a")).toBe(false)
    expect(s.tryAcquire("b")).toBe(true)
    expect(s.tryAcquire("c")).toBe(false)
    // No user: only the global limit.
    expect(s.tryAcquire(undefined)).toBe(false)
    s.release("a")
    expect(s.tryAcquire(undefined)).toBe(true)
    expect(s.held()).toBe(3)
    expect(s.held("a")).toBe(1)
  })

  it("a waiting call takes the slot a release frees, oldest first", async () => {
    const s = createInflightSlots({ perUser: 1, global: 1 })
    expect(s.tryAcquire("a")).toBe(true)
    const first = s.acquire("b", { waitMs: 10_000 })
    const second = s.acquire("c", { waitMs: 10_000 })
    s.release("a")
    expect(await first).toBe(true)
    expect(s.held("b")).toBe(1)
    s.release("b")
    expect(await second).toBe(true)
    s.release("c")
    expect(s.held()).toBe(0)
  })

  it("gives up after the wait, and takes no slot", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
    const s = createInflightSlots({ perUser: 1, global: 5 })
    s.tryAcquire("a")
    const waiting = s.acquire("a", { waitMs: 1_000 })
    await vi.advanceTimersByTimeAsync(1_000)
    expect(await waiting).toBe(false)
    expect(s.held()).toBe(1)
    // A release after the wait ended wakes nobody.
    s.release("a")
    expect(s.held()).toBe(0)
  })

  it("rejects with the signal's reason when it aborts while waiting, and takes no slot", async () => {
    const s = createInflightSlots({ perUser: 1, global: 5 })
    s.tryAcquire("a")
    const ctrl = new AbortController()
    const waiting = s.acquire("a", { waitMs: 10_000, signal: ctrl.signal })
    const why = new Error("closed")
    ctrl.abort(why)
    await expect(waiting).rejects.toBe(why)
    s.release("a")
    expect(s.held()).toBe(0)
    await expect(s.acquire("a", { waitMs: 10, signal: ctrl.signal })).rejects.toBe(why)
  })
})
