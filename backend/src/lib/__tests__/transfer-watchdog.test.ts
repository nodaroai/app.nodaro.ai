import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { downloadTimeoutError, readWithin, transferDeadline, watchTransferBody, type TransferRateLimits } from "../transfer-watchdog.js"

// The body rule shared by big-media downloads and the storage client's reads
// (Tracks 0.19 + 0.12): a size deadline at the floor rate, and a minimum rate
// per window that applies only after the grace since the transfer started.

const LIMITS: TransferRateLimits = {
  responseMs: 10_000,
  windowMs: 5_000,
  minBytesPerWindow: 1_000,
  floorBytesPerSec: 1_000,
  maxMs: 60_000,
}

describe("watchTransferBody", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(0) })
  afterEach(() => { vi.useRealTimers() })

  it("never applies the minimum rate within the grace, then stops a window that delivers too little", () => {
    const stop = vi.fn()
    watchTransferBody({ limits: LIMITS, startedAt: 0, stop })
    vi.advanceTimersByTime(9_999) // windows at 5 s: inside the 10 s grace
    expect(stop).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1) // the 10 s window: past the grace, 0 bytes
    expect(stop).toHaveBeenCalledWith("too slow — 0 bytes in the last 5 s, under the 1000 minimum")
  })

  it("a window that keeps the minimum rate runs on", () => {
    const stop = vi.fn()
    const watch = watchTransferBody({ limits: LIMITS, startedAt: 0, stop })
    for (let t = 0; t < 40_000; t += 5_000) {
      watch.count(1_000)
      vi.advanceTimersByTime(5_000)
    }
    expect(stop).not.toHaveBeenCalled()
    watch.stop()
  })

  it("a known size gets its size at the floor rate (never under the grace)", () => {
    const stop = vi.fn()
    const watch = watchTransferBody({ limits: { ...LIMITS, minBytesPerWindow: 0 }, sizeBytes: 30_000, startedAt: 0, stop })
    vi.advanceTimersByTime(29_999)
    expect(stop).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(stop).toHaveBeenCalledWith("longer than 30 s for its size (0 MB)")
    watch.stop()
  })

  it("an unknown size gets the overall ceiling", () => {
    const stop = vi.fn()
    watchTransferBody({ limits: { ...LIMITS, minBytesPerWindow: 0 }, startedAt: 0, stop })
    vi.advanceTimersByTime(59_999)
    expect(stop).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(stop).toHaveBeenCalledWith("longer than 60 s for its size (unknown)")
  })

  it("stops once at most, and stop() clears every timer", () => {
    const stop = vi.fn()
    const watch = watchTransferBody({ limits: LIMITS, startedAt: 0, stop })
    vi.advanceTimersByTime(100_000)
    expect(stop).toHaveBeenCalledTimes(1)
    const quiet = vi.fn()
    watchTransferBody({ limits: LIMITS, startedAt: 0, stop: quiet }).stop()
    vi.advanceTimersByTime(100_000)
    expect(quiet).not.toHaveBeenCalled()
    watch.stop()
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe("transferDeadline", () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] }) })
  afterEach(() => { vi.useRealTimers() })

  it("aborts with its own reason at the limit, and says it was the limit", () => {
    const d = transferDeadline({ ms: 1_000, reason: () => downloadTimeoutError(1_000, "https://x.test/a") })
    vi.advanceTimersByTime(999)
    expect(d.signal.aborted).toBe(false)
    vi.advanceTimersByTime(1)
    expect(d.signal.aborted).toBe(true)
    expect(d.timedOut()).toBe(true)
    expect(d.signal.reason).toMatchObject({ name: "TimeoutError", message: "Download timeout: over its 1 s limit: https://x.test/a" })
  })

  it("follows the caller's abort with the caller's reason, which is not a timeout", () => {
    const caller = new AbortController()
    const d = transferDeadline({ ms: 1_000, reason: () => new Error("limit"), signal: caller.signal })
    caller.abort(new Error("client gone"))
    expect(d.signal.reason).toMatchObject({ message: "client gone" })
    expect(d.timedOut()).toBe(false)
    vi.advanceTimersByTime(5_000)
    expect(d.timedOut()).toBe(false)
  })

  it("an already-aborted caller signal aborts at once", () => {
    const caller = new AbortController()
    caller.abort(new Error("gone already"))
    expect(transferDeadline({ ms: 1_000, reason: () => new Error("limit"), signal: caller.signal }).signal.aborted).toBe(true)
  })

  it("clear() stops the timer and the caller listener", () => {
    const caller = new AbortController()
    const d = transferDeadline({ ms: 1_000, reason: () => new Error("limit"), signal: caller.signal })
    d.clear()
    vi.advanceTimersByTime(5_000)
    caller.abort(new Error("late"))
    expect(d.signal.aborted).toBe(false)
  })

  it("names a long whole-minute limit in minutes, a shorter one in seconds", () => {
    expect(downloadTimeoutError(40 * 60_000, "u").message).toBe("Download timeout: over its 40 min limit: u")
    expect(downloadTimeoutError(120_000, "u").message).toBe("Download timeout: over its 120 s limit: u")
    expect(downloadTimeoutError(120_000).message).toBe("Download timeout: over its 120 s limit")
  })
})

describe("readWithin", () => {
  it("rejects with the signal's reason when a read that never settles is aborted", async () => {
    const ctrl = new AbortController()
    const pending = readWithin(ctrl.signal, new Promise<never>(() => undefined))
    ctrl.abort(new Error("over the limit"))
    await expect(pending).rejects.toThrow("over the limit")
  })

  it("passes a read through, and rejects at once on a signal already aborted", async () => {
    const ctrl = new AbortController()
    await expect(readWithin(ctrl.signal, Promise.resolve(7))).resolves.toBe(7)
    ctrl.abort(new Error("stopped"))
    await expect(readWithin(ctrl.signal, Promise.resolve(7))).rejects.toThrow("stopped")
  })
})
