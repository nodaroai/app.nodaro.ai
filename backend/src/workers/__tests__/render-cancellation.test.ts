import { afterEach, describe, expect, it, vi } from "vitest"
import { withRenderCancellation } from "../render-cancellation.js"
import { DrainAbortError } from "../../lib/worker-drain.js"
import { JobCancelledError } from "../../lib/job-cancellation.js"

afterEach(() => { vi.useRealTimers() })

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

describe("render cancellation owns underlying work", () => {
  it("does not start a render that is already cancelled", async () => {
    const work = vi.fn()
    await expect(withRenderCancellation({ jobId: "job", timeoutMs: 100,
      isCancelled: async () => true, isDraining: () => false, cancel: vi.fn() }, work))
      .rejects.toBeInstanceOf(JobCancelledError)
    expect(work).not.toHaveBeenCalled()
  })

  it("cancels on timeout and waits for the actual renderer to exit", async () => {
    vi.useFakeTimers()
    const render = deferred<string>()
    const cancel = vi.fn()
    let settled = false
    const result = withRenderCancellation({ jobId: "job", timeoutMs: 100, pollMs: 10,
      isCancelled: async () => false, isDraining: () => false, cancel }, () => render.promise)
    const observed = result.catch((error) => { settled = true; return error })
    await vi.advanceTimersByTimeAsync(101)
    expect(cancel).toHaveBeenCalledOnce()
    expect(settled).toBe(false)
    render.reject(new Error("Remotion stopped"))
    expect((await observed).message).toBe("Render timed out")
    expect(vi.getTimerCount()).toBe(0)
  })

  it("stops on a mid-render user cancellation without treating it as a render failure", async () => {
    vi.useFakeTimers()
    let cancelled = false
    const render = deferred<string>()
    const result = withRenderCancellation({ jobId: "job", timeoutMs: 100, pollMs: 10,
      isCancelled: async () => cancelled, isDraining: () => false,
      cancel: () => render.reject(new Error("renderer cancelled")) }, () => render.promise)
    const observed = result.catch((error) => error)
    await vi.advanceTimersByTimeAsync(1)
    cancelled = true
    await vi.advanceTimersByTimeAsync(10)
    expect(await observed).toBeInstanceOf(JobCancelledError)
    expect(vi.getTimerCount()).toBe(0)
  })

  it("preserves deployment drain identity so the worker can retry without a refund", async () => {
    vi.useFakeTimers()
    let draining = false
    const render = deferred<string>()
    const result = withRenderCancellation({ jobId: "job", timeoutMs: 100, pollMs: 10,
      isCancelled: async () => false, isDraining: () => draining,
      cancel: () => render.reject(new Error("browser closed")) }, () => render.promise)
    const observed = result.catch((error) => error)
    await vi.advanceTimersByTimeAsync(1)
    draining = true
    await vi.advanceTimersByTimeAsync(10)
    expect(await observed).toBeInstanceOf(DrainAbortError)
  })

  it("cleans up cancellation timers after a successful render", async () => {
    vi.useFakeTimers()
    const cancel = vi.fn()
    expect(await withRenderCancellation({ jobId: "job", timeoutMs: 100,
      isCancelled: async () => false, isDraining: () => false, cancel }, async () => "rendered"))
      .toBe("rendered")
    await vi.advanceTimersByTimeAsync(200)
    expect(cancel).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })
})
