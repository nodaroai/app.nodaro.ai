// withConcurrencySlot / ensureConcurrencySlot: a call made under a hold takes
// (or does not take) a slot of its lane, waits for one under the queue
// timeout, and never fails its job because the gate does not answer.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { isDeterministicJobError } from "../../deterministic-job-error.js"
import { ConcurrencyGate, type LaneClient, type WakeTarget } from "../gate.js"
import type { LaneSizes } from "../types.js"
import { makeFakeLaneClient, makeFakeLaneStore, type FakeLaneStore } from "./fake-lane-redis.js"

const refs = vi.hoisted(() => ({
  gate: null as unknown,
  sizes: { provider: 1, llm: 2, local: 2, run: 1 } as LaneSizes,
  settings: { queueTimeoutMs: 60_000, liveWaitLimitMs: 600_000 },
  onWake: null as null | ((targets: WakeTarget[]) => Promise<void>),
  subscribed: [] as string[][],
  stopped: 0,
}))
vi.mock("../instance.js", () => ({ concurrencyGate: () => refs.gate }))
vi.mock("../sizes.js", () => ({
  laneSizesFor: async () => refs.sizes,
  laneSettings: async () => refs.settings,
}))
vi.mock("../wake-subscriber.js", () => ({
  startLaneWakeSubscriber: (queues: string[], onWake: (targets: WakeTarget[]) => Promise<void>) => {
    refs.subscribed.push(queues)
    refs.onWake = onWake
    return () => { refs.stopped++ }
  },
}))

const { runHolding, runNotLimited, laneCounters, resetLaneCountersForTests, heldWaitMs, currentConcurrencyHold } = await import("../hold.js")
const { withConcurrencySlot, ensureConcurrencySlot, resetConcurrencySlotsForTests } = await import("../slot.js")
const { EnsureUnderCoordinatorError, LaneWaitAbortedError, LaneWaitTimeoutError } = await import("../errors.js")
type ConcurrencyHold = import("../hold.js").ConcurrencyHold
type SlotRequest = import("../slot.js").SlotRequest

const coordinator: ConcurrencyHold = { role: "coordinator", lane: null, userId: "U", payer: "user:U", tier: "pro", jobId: "job-1", leaseId: null }
const req: SlotRequest = { lane: "provider", provider: "kie", jobType: "image-to-video", model: "kling" }

let store: FakeLaneStore
let gate: ConcurrencyGate

const otherMeta = (jobId: string) => ({
  jobId, userId: "U", payer: "user:U" as const, lane: "provider" as const, provider: "kie", source: null, sourceDetail: null,
  jobType: "image-to-video", model: null, queue: "video-generation" as const, bullJobId: jobId,
})

/** Fills the user's provider lane (size 1) with another job; returns its lease. */
async function fillLane(): Promise<string> {
  const r = await gate.acquire({ meta: otherMeta("other"), size: 1, mode: "fresh", leaseTtlMs: 3_600_000 })
  if (!r.granted) throw new Error("expected a grant")
  return r.leaseId
}

const providerLane = async () => (await gate.snapshot()).lines[0]?.lanes.provider

beforeEach(async () => {
  store = makeFakeLaneStore()
  gate = new ConcurrencyGate({ client: () => makeFakeLaneClient(store) })
  refs.gate = gate
  refs.sizes = { provider: 1, llm: 2, local: 2, run: 1 }
  refs.settings = { queueTimeoutMs: 60_000, liveWaitLimitMs: 600_000 }
  refs.onWake = null
  refs.subscribed = []
  refs.stopped = 0
  resetLaneCountersForTests()
  resetConcurrencySlotsForTests()
  await gate.setEnforced(true)
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe("withConcurrencySlot", () => {
  it("inside a leaf hold no acquire happens", async () => {
    const acquire = vi.spyOn(gate, "acquire")
    const leaf: ConcurrencyHold = { ...coordinator, role: "leaf", lane: "provider", leaseId: "parent-lease" }
    expect(await runHolding(leaf, () => withConcurrencySlot(req, async () => "done"))).toBe("done")
    expect(await runHolding(leaf, async () => { await ensureConcurrencySlot({ ...req, lane: "llm" }); return 1 })).toBe(1)
    expect(acquire).not.toHaveBeenCalled()
    expect(laneCounters().ungated).toEqual({})
  })

  it("inside a coordinator hold it acquires front and releases on throw", async () => {
    const acquire = vi.spyOn(gate, "acquire")
    const release = vi.spyOn(gate, "release")
    const boom = new Error("provider failed")
    let inner: ConcurrencyHold | undefined
    let running: number | undefined
    await expect(runHolding(coordinator, () => withConcurrencySlot(req, async () => {
      inner = currentConcurrencyHold()
      running = (await providerLane())?.running
      throw boom
    }))).rejects.toBe(boom)
    expect(acquire).toHaveBeenCalledTimes(1)
    const call = acquire.mock.calls[0]![0]
    expect(call.mode).toBe("front")
    expect(call.size).toBe(1)
    expect(call.meta).toMatchObject({ userId: "U", payer: "user:U", lane: "provider", provider: "kie", jobType: "image-to-video", model: "kling", queue: "inline", bullJobId: null })
    // Its own entry, never the hold's job id: the gate keeps one lease per job id.
    expect(call.meta.jobId).not.toBe("job-1")
    expect(call.meta.jobId.startsWith("job-1:call:")).toBe(true)
    expect(running).toBe(1)
    expect(inner).toMatchObject({ role: "leaf", lane: "provider", jobId: "job-1", userId: "U" })
    expect(inner?.leaseId).toEqual(expect.any(String))
    expect(release).toHaveBeenCalledWith(inner!.leaseId, "failed")
    expect((await providerLane())?.running ?? 0).toBe(0)
  })

  it("two calls of one job take two entries", async () => {
    refs.sizes = { ...refs.sizes, provider: 4 }
    const acquire = vi.spyOn(gate, "acquire")
    await runHolding(coordinator, () => Promise.all([
      withConcurrencySlot(req, async () => undefined),
      withConcurrencySlot(req, async () => undefined),
    ]))
    const ids = acquire.mock.calls.map((c) => c[0].meta.jobId)
    expect(new Set(ids).size).toBe(2)
  })

  it("a coordinator wait past the queue timeout raises a final LaneWaitTimeoutError", async () => {
    vi.useFakeTimers()
    await fillLane()
    const withdraw = vi.spyOn(gate, "withdraw")
    const fn = vi.fn(async () => "never")
    let err: unknown
    await runHolding(coordinator, async () => {
      const p = withConcurrencySlot(req, fn).catch((e: unknown) => { err = e })
      await vi.advanceTimersByTimeAsync(60_000)
      await p
      expect(heldWaitMs()).toBe(60_000)
    })
    expect(fn).not.toHaveBeenCalled()
    expect(err).toBeInstanceOf(LaneWaitTimeoutError)
    expect(err).toBeInstanceOf(Error)
    expect(isDeterministicJobError(err)).toBe(true)
    expect((err as InstanceType<typeof LaneWaitTimeoutError>).failureHint).toEqual({ kind: "queue-timeout", reason: "timeout", waitedMinutes: 1 })
    expect((err as Error).message).toBe("Waited longer than 1 min for a free slot.")
    expect(withdraw).toHaveBeenCalledTimes(1)
    expect((await providerLane())?.queued).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })

  it("a waiting call starts when a wake message names its entry", async () => {
    vi.useFakeTimers()
    const other = await fillLane()
    const acquire = vi.spyOn(gate, "acquire")
    const waits: number[] = []
    const fn = vi.fn(async () => "ran")
    let result: unknown
    await runHolding(coordinator, async () => {
      const p = withConcurrencySlot({ ...req, onWaiting: (w) => waits.push(w.position) }, fn).then((r) => { result = r })
      await vi.advanceTimersByTimeAsync(1_000)
      expect(fn).not.toHaveBeenCalled()
      expect(refs.subscribed).toEqual([["inline"]])
      const wakes = await gate.release(other, "completed")
      expect(wakes.map((w) => w.queue)).toEqual(["inline"])
      await refs.onWake!(wakes)
      await vi.advanceTimersByTimeAsync(0)
      await p
      expect(heldWaitMs()).toBe(1_000)
    })
    expect(result).toBe("ran")
    expect(waits).toEqual([1])
    expect(acquire).toHaveBeenCalledTimes(2)
    expect(vi.getTimerCount()).toBe(0)
  })

  it("a waiting call re-checks every 5 s without a wake", async () => {
    vi.useFakeTimers()
    const other = await fillLane()
    const acquire = vi.spyOn(gate, "acquire")
    let done = false
    await runHolding(coordinator, async () => {
      const p = withConcurrencySlot(req, async () => { done = true })
      await vi.advanceTimersByTimeAsync(4_999)
      expect(acquire).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(1)
      expect(acquire).toHaveBeenCalledTimes(2)
      await gate.release(other, "completed") // its wake is never delivered
      await vi.advanceTimersByTimeAsync(5_000)
      await p
    })
    expect(done).toBe(true)
    expect(acquire).toHaveBeenCalledTimes(3)
  })

  it("an aborted wait withdraws its entry and raises LaneWaitAbortedError", async () => {
    vi.useFakeTimers()
    await fillLane()
    const ac = new AbortController()
    let err: unknown
    await runHolding(coordinator, async () => {
      const p = withConcurrencySlot({ ...req, signal: ac.signal }, async () => "never").catch((e: unknown) => { err = e })
      await vi.advanceTimersByTimeAsync(2_000)
      ac.abort()
      await vi.advanceTimersByTimeAsync(0)
      await p
    })
    expect(err).toBeInstanceOf(LaneWaitAbortedError)
    expect((await providerLane())?.queued).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })

  it("the not-limited scope never acquires and is counted", async () => {
    const acquire = vi.spyOn(gate, "acquire")
    const r = await runHolding(coordinator, () => runNotLimited("training", () => withConcurrencySlot(req, async () => "trained")))
    expect(r).toBe("trained")
    await runNotLimited("copilot", async () => { await ensureConcurrencySlot({ ...req, lane: "llm" }) })
    expect(acquire).not.toHaveBeenCalled()
    expect(laneCounters()).toEqual({ ungated: {}, notLimited: { training: 1, copilot: 1 }, failOpen: {} })
  })

  it("the ungated path increments the counter", async () => {
    const acquire = vi.spyOn(gate, "acquire")
    expect(await withConcurrencySlot(req, async () => "cron work")).toBe("cron work")
    await withConcurrencySlot(req, async () => undefined)
    await ensureConcurrencySlot({ ...req, lane: "llm", jobType: "llm-chat" })
    expect(acquire).not.toHaveBeenCalled()
    expect(laneCounters().ungated).toEqual({ "image-to-video": 2, "llm-chat": 1 })
  })

  it("with enforcement off changes nothing", async () => {
    vi.useFakeTimers()
    await gate.setEnforced(false)
    await fillLane()
    const fn = vi.fn(async () => "at once")
    const r = await runHolding(coordinator, async () => {
      const out = await withConcurrencySlot(req, fn)
      expect(heldWaitMs()).toBe(0)
      return out
    })
    expect(r).toBe("at once")
    expect(fn).toHaveBeenCalledTimes(1)
    expect(refs.subscribed).toEqual([])
    expect(vi.getTimerCount()).toBe(0)
    // Measured: the call was an over-limit lease while it ran, and is released.
    expect(await providerLane()).toMatchObject({ running: 1, overLimit: 0, queued: 0 })
  })

  it("a gate that does not answer runs the call ungated and withdraws its entry", async () => {
    vi.useFakeTimers()
    vi.spyOn(console, "warn").mockImplementation(() => undefined)
    const hanging = { eval: () => new Promise(() => undefined), publish: () => new Promise(() => undefined) } as unknown as LaneClient
    const stuck = new ConcurrencyGate({ client: () => hanging, callTimeoutMs: 5_000 })
    refs.gate = stuck
    const withdraw = vi.spyOn(stuck, "withdraw")
    let inner: ConcurrencyHold | undefined
    let result: unknown
    await runHolding(coordinator, async () => {
      const p = withConcurrencySlot(req, async () => { inner = currentConcurrencyHold(); return "ran anyway" }).then((r) => { result = r })
      await vi.advanceTimersByTimeAsync(5_000)
      await p
    })
    expect(result).toBe("ran anyway")
    expect(inner).toMatchObject({ role: "leaf", lane: "provider", leaseId: null })
    expect(withdraw).toHaveBeenCalledTimes(1)
    expect(withdraw.mock.calls[0]![0].startsWith("job-1:call:")).toBe(true)
    expect(laneCounters().ungated).toEqual({ "image-to-video": 1 })
    expect(laneCounters().failOpen).toEqual({ "gate-timeout": 1 })
    await vi.advanceTimersByTimeAsync(5_000) // the best-effort withdraw times out quietly
  })

  it("a gate that fails runs the call ungated, counted apart and logged as an error", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined)
    vi.spyOn(gate, "acquire").mockRejectedValue(new Error("NOSCRIPT"))
    expect(await runHolding(coordinator, () => withConcurrencySlot(req, async () => "ran anyway"))).toBe("ran anyway")
    expect(laneCounters().failOpen).toEqual({ "gate-error": 1 })
    expect(laneCounters().ungated).toEqual({ "image-to-video": 1 })
    expect(logged).toHaveBeenCalledWith(expect.stringContaining("NOSCRIPT"))
  })

  it("under a coordinator hold every parallel call takes its own slot", async () => {
    vi.useFakeTimers()
    refs.sizes = { ...refs.sizes, provider: 2 }
    const acquire = vi.spyOn(gate, "acquire")
    const finish: Array<() => void> = []
    const started: number[] = []
    await runHolding(coordinator, async () => {
      const all = Promise.all([0, 1, 2, 3, 4].map((i) => withConcurrencySlot(req, () => new Promise<void>((resolve) => {
        started.push(i)
        finish.push(resolve)
      }))))
      await vi.advanceTimersByTimeAsync(0)
      expect(started).toHaveLength(2)
      expect(await providerLane()).toMatchObject({ running: 2, queued: 3 })
      expect(new Set(acquire.mock.calls.map((c) => c[0].meta.jobId)).size).toBe(5)
      // Finishing calls frees their slots; the waiters take them on their re-checks.
      while (started.length < 5) {
        finish.splice(0).forEach((f) => f())
        await vi.advanceTimersByTimeAsync(5_000)
      }
      finish.splice(0).forEach((f) => f())
      await all
    })
    expect(started).toHaveLength(5)
    expect((await providerLane())?.running ?? 0).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })

  it("a call nested in a granted call runs under its slot and never acquires", async () => {
    const acquire = vi.spyOn(gate, "acquire")
    await runHolding(coordinator, () => withConcurrencySlot(req, () => withConcurrencySlot({ ...req, lane: "llm" }, async () => undefined)))
    expect(acquire).toHaveBeenCalledTimes(1)
  })

  it("a signal aborted while the call checks its place ends the wait at once", async () => {
    vi.useFakeTimers()
    await fillLane()
    const ac = new AbortController()
    let err: unknown
    await runHolding(coordinator, async () => {
      const p = withConcurrencySlot({ ...req, signal: ac.signal, onWaiting: () => ac.abort() }, async () => "never").catch((e: unknown) => { err = e })
      await vi.advanceTimersByTimeAsync(0)
      expect(err).toBeInstanceOf(LaneWaitAbortedError)
      await p
    })
    expect((await providerLane())?.queued).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })

  it("a detached call waiting at scope end still runs", async () => {
    vi.useFakeTimers()
    const other = await fillLane()
    const release = vi.spyOn(gate, "release")
    let result: unknown
    let ended = false
    const scope = runHolding(coordinator, async () => {
      // Detached: the scope's work does not wait for it.
      void withConcurrencySlot(req, async () => "ran").then((r) => { result = r })
      await vi.advanceTimersByTimeAsync(1_000)
      expect((await providerLane())?.queued).toBe(1)
    }).then(() => { ended = true })
    await vi.advanceTimersByTimeAsync(0)
    expect(ended).toBe(true) // the scope's end did not wait for it
    await scope
    expect((await providerLane())?.queued).toBe(1) // still in line, not withdrawn
    await gate.release(other, "completed")
    await vi.advanceTimersByTimeAsync(5_000) // its re-check takes the freed slot
    expect(result).toBe("ran")
    expect(release).toHaveBeenLastCalledWith(expect.any(String), "completed")
    expect((await providerLane())?.running ?? 0).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe("ensureConcurrencySlot", () => {
  it("ensure under a coordinator hold is refused", async () => {
    const acquire = vi.spyOn(gate, "acquire")
    await expect(runHolding(coordinator, () => ensureConcurrencySlot(req))).rejects.toBeInstanceOf(EnsureUnderCoordinatorError)
    await expect(runHolding({ ...coordinator, role: "run", lane: "run" }, () => ensureConcurrencySlot(req)))
      .rejects.toMatchObject({ name: "EnsureUnderCoordinatorError", role: "run" })
    expect(acquire).not.toHaveBeenCalled()
  })

  it("an ensure after the scope ended leaves no lease and no timer", async () => {
    vi.useFakeTimers()
    const acquire = vi.spyOn(gate, "acquire")
    let open!: () => void
    const opened = new Promise<void>((resolve) => { open = resolve })
    let detached!: Promise<string>
    await runHolding(coordinator, async () => {
      // Detached work keeps the scope's context after the scope ends.
      detached = (async () => {
        await opened
        await ensureConcurrencySlot(req)
        return withConcurrencySlot(req, async () => "ran")
      })()
    })
    open()
    expect(await detached).toBe("ran")
    expect(acquire).not.toHaveBeenCalled()
    expect(laneCounters().ungated).toEqual({ "image-to-video": 2 })
    expect((await gate.snapshot()).lines).toEqual([])
    expect(vi.getTimerCount()).toBe(0)
  })
})
