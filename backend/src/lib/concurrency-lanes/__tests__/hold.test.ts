// The hold context: which slot the current code runs under, the job's
// in-handler wait, the not-limited scope and the lease keep-alive.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ConcurrencyGate, LANE_LEASE_RENEW_MS } from "../gate.js"
import type { LaneEntryMeta } from "../types.js"
import { makeFakeLaneClient, makeFakeLaneStore, type FakeLaneStore } from "./fake-lane-redis.js"

const refs = vi.hoisted(() => ({ gate: null as unknown }))
vi.mock("../instance.js", () => ({ concurrencyGate: () => refs.gate }))

const {
  addHeldWaitMs, currentConcurrencyHold, heldWaitMs, keepLeaseAlive, laneCounters, resetLaneCountersForTests, runHolding, runNotLimited,
} = await import("../hold.js")
type ConcurrencyHold = import("../hold.js").ConcurrencyHold

const coordinator: ConcurrencyHold = { role: "coordinator", lane: null, userId: "U", payer: "user:U", tier: "pro", jobId: "job-1", leaseId: null }

let store: FakeLaneStore
let gate: ConcurrencyGate

beforeEach(() => {
  store = makeFakeLaneStore()
  gate = new ConcurrencyGate({ client: () => makeFakeLaneClient(store) })
  refs.gate = gate
  resetLaneCountersForTests()
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe("runHolding", () => {
  it("makes the hold current for the whole call and only there", async () => {
    expect(currentConcurrencyHold()).toBeUndefined()
    const seen = await runHolding(coordinator, async () => {
      await new Promise((r) => setTimeout(r, 1))
      return currentConcurrencyHold()
    })
    expect(seen).toEqual(coordinator)
    expect(currentConcurrencyHold()).toBeUndefined()
  })

  it("a nested hold is current inside it and the outer one after it", async () => {
    await runHolding(coordinator, async () => {
      const leaf: ConcurrencyHold = { ...coordinator, role: "leaf", lane: "provider", leaseId: "L" }
      expect(await runHolding(leaf, async () => currentConcurrencyHold()?.role)).toBe("leaf")
      expect(currentConcurrencyHold()?.role).toBe("coordinator")
    })
  })
})

describe("the job's in-handler wait", () => {
  it("adds up across nested holds of the same job", async () => {
    const total = await runHolding(coordinator, async () => {
      addHeldWaitMs(1_000)
      await runHolding({ ...coordinator, role: "leaf", lane: "llm", leaseId: "L" }, async () => {
        addHeldWaitMs(2_500)
        expect(heldWaitMs()).toBe(3_500)
      })
      return heldWaitMs()
    })
    expect(total).toBe(3_500)
  })

  it("is separate for a hold of another job, and zero outside any hold", async () => {
    await runHolding(coordinator, async () => {
      addHeldWaitMs(1_000)
      await runHolding({ ...coordinator, jobId: "job-2" }, async () => {
        addHeldWaitMs(10)
        expect(heldWaitMs()).toBe(10)
      })
      expect(heldWaitMs()).toBe(1_000)
    })
    addHeldWaitMs(5_000)
    expect(heldWaitMs()).toBe(0)
  })

  it("ignores a negative or non-finite amount", async () => {
    await runHolding(coordinator, async () => {
      addHeldWaitMs(-5)
      addHeldWaitMs(Number.NaN)
      expect(heldWaitMs()).toBe(0)
    })
  })
})

describe("runNotLimited", () => {
  it("runs under a not-limited hold that keeps the caller's line, and counts the scope", async () => {
    const seen = await runHolding(coordinator, () => runNotLimited("training", async () => currentConcurrencyHold()))
    expect(seen).toMatchObject({ role: "not-limited", reason: "training", lane: null, leaseId: null, userId: "U", payer: "user:U", jobId: "job-1" })
    await runNotLimited("copilot", async () => undefined)
    expect(laneCounters().notLimited).toEqual({ training: 1, copilot: 1 })
  })
})

describe("keepLeaseAlive", () => {
  const meta: LaneEntryMeta = {
    jobId: "job-1:call:x", userId: "U", payer: "user:U", lane: "provider", provider: "kie", source: null, sourceDetail: null,
    jobType: "image-to-video", model: null, queue: "inline", bullJobId: null,
  }

  it("a lease Redis lost is re-adopted by keepLeaseAlive", async () => {
    vi.useFakeTimers()
    const r = await gate.acquire({ meta, size: 4, mode: "front", leaseTtlMs: 120_000 })
    if (!r.granted) throw new Error("expected a grant")
    const renew = vi.spyOn(gate, "renew")
    // Redis lost its state (a restart): every key of the gate is gone.
    store.zsets.clear()
    store.hashes.clear()
    store.sets.clear()
    store.strings.clear()
    expect((await gate.snapshot()).lines).toEqual([])
    const keep = keepLeaseAlive(r.leaseId, meta)
    await vi.advanceTimersByTimeAsync(LANE_LEASE_RENEW_MS)
    expect(renew).toHaveBeenCalledTimes(1)
    await expect(renew.mock.results[0]!.value).resolves.toBe("readopted")
    expect((await gate.snapshot()).lines[0]!.lanes.provider.running).toBe(1)
    keep.stop()
    expect(vi.getTimerCount()).toBe(0)
  })

  it("stops renewing a lease that was released", async () => {
    vi.useFakeTimers()
    const r = await gate.acquire({ meta, size: 4, mode: "front", leaseTtlMs: 120_000 })
    if (!r.granted) throw new Error("expected a grant")
    await gate.release(r.leaseId, "completed")
    const renew = vi.spyOn(gate, "renew")
    keepLeaseAlive(r.leaseId, meta)
    await vi.advanceTimersByTimeAsync(LANE_LEASE_RENEW_MS)
    await expect(renew.mock.results[0]!.value).resolves.toBe("released")
    expect(vi.getTimerCount()).toBe(0)
    await vi.advanceTimersByTimeAsync(LANE_LEASE_RENEW_MS * 3)
    expect(renew).toHaveBeenCalledTimes(1)
  })

  it("keeps renewing through a renew that fails", async () => {
    vi.useFakeTimers()
    vi.spyOn(console, "warn").mockImplementation(() => undefined)
    const renew = vi.spyOn(gate, "renew").mockRejectedValueOnce(new Error("redis down")).mockResolvedValue("renewed")
    const keep = keepLeaseAlive("lease-x", meta)
    await vi.advanceTimersByTimeAsync(LANE_LEASE_RENEW_MS * 2)
    expect(renew).toHaveBeenCalledTimes(2)
    keep.stop()
    expect(vi.getTimerCount()).toBe(0)
  })
})
