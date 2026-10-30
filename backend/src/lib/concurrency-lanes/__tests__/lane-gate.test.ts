// The concurrency gate's contract on the JS twin of its Lua scripts — no Redis
// needed. The twin is trusted only because lane-gate.redis.test.ts runs the
// SAME contract against a real Redis and the real Lua.
import { afterEach, describe, expect, it, vi } from "vitest"
import { ConcurrencyGate, LANE_GATE_CALL_TIMEOUT_MS, LANE_WAKE_CHANNEL, LaneGateTimeoutError, type LaneClient } from "../gate.js"
import { runLaneGateContract } from "./lane-gate-contract.js"
import { makeFakeLaneClient, makeFakeLaneStore } from "./fake-lane-redis.js"

describe("ConcurrencyGate — the contract on the JS twin", () => {
  runLaneGateContract(() => {
    const store = makeFakeLaneStore()
    return {
      client: () => makeFakeLaneClient(store),
      prefix: `cl:twin:`,
      zadd: async (key, score, member) => { (store.zsets.get(key) ?? store.zsets.set(key, new Map()).get(key)!).set(member, score) },
      cleanup: async () => undefined,
    }
  })
})

describe("ConcurrencyGate — production keys", () => {
  it("publishes wakes on LANE_WAKE_CHANNEL under the default prefix", async () => {
    const store = makeFakeLaneStore()
    const gate = new ConcurrencyGate({ client: () => makeFakeLaneClient(store), now: () => 1_000 })
    await gate.setEnforced(true)
    const meta = (jobId: string) => ({ jobId, userId: "U", payer: "user:U" as const, lane: "local" as const, provider: null, source: null, sourceDetail: null, jobType: "trim-video", model: null, queue: "video-generation" as const, bullJobId: jobId })
    const a = await gate.acquire({ meta: meta("a"), size: 1, mode: "fresh", leaseTtlMs: 60_000 })
    await gate.acquire({ meta: meta("b"), size: 1, mode: "fresh", leaseTtlMs: 60_000 })
    if (!a.granted) throw new Error("a should be granted")
    await gate.release(a.leaseId, "completed")
    expect(LANE_WAKE_CHANNEL).toBe("cl:v1:wake")
    expect(store.published).toEqual([{ channel: LANE_WAKE_CHANNEL, message: JSON.stringify({ jobId: "b", queue: "video-generation", bullJobId: "b" }) }])
    expect([...store.sets.get("cl:v1:lines") ?? []]).toEqual(["user:U:U:local"])
  })
})

describe("ConcurrencyGate — a Redis that never answers", () => {
  afterEach(() => { vi.useRealTimers() })

  const meta = (jobId: string) => ({ jobId, userId: "U", payer: "user:U" as const, lane: "local" as const, provider: null, source: null, sourceDetail: null, jobType: "trim-video", model: null, queue: "video-generation" as const, bullJobId: jobId })
  /** The BullMQ connection during an outage: every command sits in the offline queue, never settling. */
  const hangingClient = (): LaneClient => ({ eval: () => new Promise(() => undefined), publish: () => new Promise(() => undefined) }) as unknown as LaneClient

  it("rejects a call with LaneGateTimeoutError once the call timeout passes", async () => {
    vi.useFakeTimers()
    const gate = new ConcurrencyGate({ client: hangingClient, callTimeoutMs: 2_000 })
    const settled = vi.fn()
    const p = gate.acquire({ meta: meta("a"), size: 1, mode: "fresh", leaseTtlMs: 60_000 })
    p.then(settled, settled)
    const rejected = expect(p).rejects.toThrow(LaneGateTimeoutError)
    await vi.advanceTimersByTimeAsync(1_999)
    expect(settled).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    await rejected
    await expect(p).rejects.toMatchObject({ name: "LaneGateTimeoutError", call: "acquire", timeoutMs: 2_000 })
    expect(vi.getTimerCount()).toBe(0)
  })

  it("defaults the call timeout to LANE_GATE_CALL_TIMEOUT_MS", async () => {
    vi.useFakeTimers()
    const gate = new ConcurrencyGate({ client: hangingClient })
    const p = gate.isEnforced()
    const rejected = expect(p).rejects.toThrow(LaneGateTimeoutError)
    await vi.advanceTimersByTimeAsync(LANE_GATE_CALL_TIMEOUT_MS)
    await rejected
  })

  it("leaves no timer behind once a call answers", async () => {
    vi.useFakeTimers()
    const store = makeFakeLaneStore()
    const gate = new ConcurrencyGate({ client: () => makeFakeLaneClient(store), callTimeoutMs: 2_000 })
    expect(await gate.isEnforced()).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
  })

  it("a wake publish that never answers is logged, and the committed release still resolves", async () => {
    vi.useFakeTimers()
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)
    try {
      const store = makeFakeLaneStore()
      const twin = makeFakeLaneClient(store)
      const client = { eval: twin.eval.bind(twin), publish: () => new Promise(() => undefined) } as unknown as LaneClient
      const gate = new ConcurrencyGate({ client: () => client, now: () => 1_000, callTimeoutMs: 2_000 })
      await gate.setEnforced(true)
      const a = await gate.acquire({ meta: meta("a"), size: 1, mode: "fresh", leaseTtlMs: 60_000 })
      await gate.acquire({ meta: meta("b"), size: 1, mode: "fresh", leaseTtlMs: 60_000 })
      if (!a.granted) throw new Error("a should be granted")
      const p = gate.release(a.leaseId, "completed")
      await vi.advanceTimersByTimeAsync(2_000)
      expect(await p).toEqual([{ jobId: "b", queue: "video-generation", bullJobId: "b" }])
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("could not publish the wake of job b"))
    } finally {
      warn.mockRestore()
    }
  })

  it("refuses a call timeout that is not a positive number", () => {
    for (const callTimeoutMs of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => new ConcurrencyGate({ client: hangingClient, callTimeoutMs }), String(callTimeoutMs)).toThrow(RangeError)
    }
  })
})
