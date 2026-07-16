import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

vi.mock("@/lib/config.js", () => ({
  config: { KIE_API_KEY: "test-key", NODE_ENV: "test" },
}))

import { sleep, pollKieTask } from "../client.js"
import {
  beginWorkerDrain,
  DrainAbortError,
  _resetWorkerDrainForTests,
} from "../../../lib/worker-drain.js"

// Drain-abort contract (incident 2026-07-15): when the worker entrypoint
// begins draining on SIGTERM, every provider wait point must throw
// DrainAbortError promptly so the BullMQ job fails-and-requeues (lock
// released) BEFORE the process is killed — instead of dying lock-held and
// staying invisible to stall recovery for the full lockDuration.
describe("drain-abort of provider waits", () => {
  beforeEach(() => {
    _resetWorkerDrainForTests()
  })

  afterEach(() => {
    _resetWorkerDrainForTests()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it("sleep rejects with DrainAbortError when drain has begun", async () => {
    beginWorkerDrain()
    await expect(sleep(10)).rejects.toBeInstanceOf(DrainAbortError)
  })

  it("sleep resolves normally when not draining", async () => {
    await expect(sleep(5)).resolves.toBeUndefined()
  })

  it("pollKieTask aborts with DrainAbortError mid-polling instead of running out its attempt budget", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("/recordInfo")) {
        return new Response(
          JSON.stringify({ code: 0, data: { taskId: "t-drain", state: "generating", progress: 50 } }),
          { status: 200 },
        )
      }
      throw new Error(`unexpected url ${url}`)
    })
    vi.stubGlobal("fetch", fetchMock)
    vi.useFakeTimers()

    const promise = pollKieTask("t-drain", 3)
    promise.catch(() => undefined)

    // Let attempt 1 complete (2s backoff + fetch → "generating"), then drain.
    await vi.advanceTimersByTimeAsync(2100)
    beginWorkerDrain()
    await vi.advanceTimersByTimeAsync(10_000)

    await expect(promise).rejects.toBeInstanceOf(DrainAbortError)
    // The abort must fire at the next wait point — not after burning the
    // remaining attempt budget against a provider that can't answer fast.
    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(2)
  })
})
