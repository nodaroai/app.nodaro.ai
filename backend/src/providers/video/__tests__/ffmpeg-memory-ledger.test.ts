// The container's shared ffmpeg memory budget (decided 2026-10-05): one Railway
// container runs four processes under one memory limit, so every launch
// reserves from a Redis ledger they all share — leases with a TTL renewed by a
// heartbeat, an atomic reserve, and a local fallback when Redis is down.
//
// These cases run on a JS twin of the Lua scripts (`fake-ledger-redis.ts`); the
// same ledger contract runs against a real Redis in
// `ffmpeg-memory-ledger.redis.test.ts` whenever one is reachable.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { RedisMemoryLedger, FFMPEG_LEASE_TTL_MS } from "../ffmpeg-memory-ledger.js"
import { ContainerMemoryGate, LocalMemoryGate, type ReserveOutcome } from "../ffmpeg-memory-gate.js"
import { FfmpegAdmission } from "../ffmpeg-admission.js"
import { makeFakeClient, makeFakeStore, leasesOf, type FakeLedgerClient, type FakeLedgerStore } from "./fake-ledger-redis.js"
import { runLedgerContract } from "./ledger-contract.js"

const BUDGET = 5000
const POLL = 100
const HEARTBEAT = 10_000

describe("RedisMemoryLedger — the contract (on the JS twin of the scripts)", () => {
  runLedgerContract(() => {
    const store = makeFakeStore()
    return { client: () => makeFakeClient(store), cleanup: async () => undefined }
  })
})

/** One process of a container: its own client (own connection) over the shared store. */
function processOf(store: FakeLedgerStore, containerId: string, opts: { heartbeatMs?: number; localShare?: number } = {}) {
  const client = makeFakeClient(store)
  const ledger = new RedisMemoryLedger({ client: () => client, containerId })
  const logs: string[] = []
  const gate = new ContainerMemoryGate({
    ledger,
    localShare: () => opts.localShare ?? 0.5,
    log: (m) => logs.push(m),
    heartbeatMs: opts.heartbeatMs ?? HEARTBEAT,
  })
  const admission = new FfmpegAdmission(() => ({ slots: 4, budgetMiB: BUDGET, defaultPeakMiB: 500 }), { gate, pollMs: POLL })
  return { client, ledger, gate, admission, logs }
}

const reserved = (o: ReserveOutcome): boolean => o.reservation !== undefined

describe("ContainerMemoryGate — one budget across a container's processes", () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it("two processes sharing one container key cannot exceed the budget", async () => {
    const store = makeFakeStore()
    const a = processOf(store, "c1")
    const b = processOf(store, "c1")
    const first = await a.gate.tryReserve(3000, BUDGET)
    expect(reserved(first)).toBe(true)
    // B sees A's lease: 3000 + 3000 > 5000.
    const second = await b.gate.tryReserve(3000, BUDGET)
    expect(reserved(second)).toBe(false)
    expect(second.containerTotalMiB).toBe(3000)
    // …but 2000 fits (3000 + 2000 = 5000), and then nothing more does.
    expect(reserved(await b.gate.tryReserve(2000, BUDGET))).toBe(true)
    expect(reserved(await a.gate.tryReserve(1, BUDGET))).toBe(false)
  })

  it("a release in one process lets a waiter in another start (it polls the ledger)", async () => {
    const store = makeFakeStore()
    const a = processOf(store, "c1")
    const b = processOf(store, "c1")
    const releaseA = await a.admission.acquire({ peakMemoryMiB: 4000 })
    let bStarted = false
    const waiting = b.admission.acquire({ peakMemoryMiB: 4000 }).then((release) => {
      bStarted = true
      return release
    })
    await vi.advanceTimersByTimeAsync(POLL * 3)
    expect(bStarted).toBe(false)
    expect(b.admission.state.waiting).toBe(1)
    releaseA()
    await vi.advanceTimersByTimeAsync(POLL * 2)
    expect(bStarted).toBe(true)
    ;(await waiting)()
  })

  it("different container keys are independent budgets", async () => {
    const store = makeFakeStore()
    const a = processOf(store, "container-a")
    const b = processOf(store, "container-b")
    expect(reserved(await a.gate.tryReserve(BUDGET, BUDGET))).toBe(true)
    expect(reserved(await b.gate.tryReserve(BUDGET, BUDGET))).toBe(true)
    expect(reserved(await a.gate.tryReserve(1, BUDGET))).toBe(false)
  })

  it("a launch bigger than the whole budget holds the container alone across processes", async () => {
    const store = makeFakeStore()
    const a = processOf(store, "c1")
    const b = processOf(store, "c1")
    // Something small holds memory: the oversized launch must wait for ZERO.
    const small = await b.gate.tryReserve(500, BUDGET)
    expect(reserved(await a.gate.tryReserve(BUDGET + 1000, BUDGET))).toBe(false)
    small.reservation!.release()
    await vi.advanceTimersByTimeAsync(0)
    const huge = await a.gate.tryReserve(BUDGET + 1000, BUDGET)
    expect(reserved(huge)).toBe(true)
    // While it holds, nothing — in either process — reserves, not even 1 MiB.
    expect(reserved(await b.gate.tryReserve(1, BUDGET))).toBe(false)
    expect(reserved(await a.gate.tryReserve(1, BUDGET))).toBe(false)
    expect(reserved(await b.gate.tryReserve(BUDGET + 1000, BUDGET))).toBe(false)
    huge.reservation!.release()
    await vi.advanceTimersByTimeAsync(0)
    expect(reserved(await b.gate.tryReserve(1, BUDGET))).toBe(true)
  })

  it("a crashed holder's lease expires on its own and wakes the waiters", async () => {
    const store = makeFakeStore()
    // A reserves and then dies: its heartbeat never fires (a huge interval stands in for the kill).
    const a = processOf(store, "c1", { heartbeatMs: 10 * 24 * 3600 * 1000 })
    const b = processOf(store, "c1")
    await a.gate.tryReserve(4500, BUDGET)
    let started = false
    const waiting = b.admission.acquire({ peakMemoryMiB: 4000 }).then((release) => {
      started = true
      return release
    })
    await vi.advanceTimersByTimeAsync(FFMPEG_LEASE_TTL_MS - 1000)
    expect(started).toBe(false)
    await vi.advanceTimersByTimeAsync(2000 + POLL)
    expect(started).toBe(true)
    ;(await waiting)()
    // Its lease was purged by the reserve that took the memory.
    expect(leasesOf(store, "c1").size).toBe(0)
  })

  it("a live holder's heartbeat keeps its lease past the TTL, and stops with the release", async () => {
    const store = makeFakeStore()
    const a = processOf(store, "c1")
    const b = processOf(store, "c1")
    const held = await a.gate.tryReserve(4500, BUDGET)
    // Three TTLs pass with the heartbeat running: the lease is still counted.
    await vi.advanceTimersByTimeAsync(FFMPEG_LEASE_TTL_MS * 3)
    expect(reserved(await b.gate.tryReserve(1000, BUDGET))).toBe(false)
    const beats = a.client.calls.filter((c) => c === "renew").length
    expect(beats).toBeGreaterThanOrEqual(8)
    held.reservation!.release()
    await vi.advanceTimersByTimeAsync(HEARTBEAT * 3)
    expect(a.client.calls.filter((c) => c === "renew").length).toBe(beats) // no beat after the release
    expect(leasesOf(store, "c1").size).toBe(0)
  })

  it("a lease that expired under a stall is put back by the next heartbeat (the memory is in use either way)", async () => {
    const store = makeFakeStore()
    const a = processOf(store, "c1")
    const b = processOf(store, "c1")
    await a.gate.tryReserve(4500, BUDGET)
    store.zsets.clear() // the lease vanished (a long stall, a flushed Redis)
    store.hashes.clear()
    expect(reserved(await b.gate.tryReserve(4500, BUDGET))).toBe(true) // B took it…
    await vi.advanceTimersByTimeAsync(HEARTBEAT + 1)
    // …and A's heartbeat re-registered its lease: the container total is honest again.
    expect(leasesOf(store, "c1").size).toBe(2)
  })
})

describe("ContainerMemoryGate — Redis unavailable", () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it("falls back to the local share of the budget, and logs once per outage", async () => {
    const store = makeFakeStore()
    const a = processOf(store, "c1", { localShare: 0.5 })
    a.client.down = true
    // The local budget is 2500: 1500 fits, another 1500 does not (3000 > 2500).
    const first = await a.gate.tryReserve(1500, BUDGET)
    expect(reserved(first)).toBe(true)
    expect(reserved(await a.gate.tryReserve(1500, BUDGET))).toBe(false)
    // Within the breaker window Redis is not asked again.
    const calls = a.client.calls.length
    expect(reserved(await a.gate.tryReserve(500, BUDGET))).toBe(true)
    expect(a.client.calls.length).toBe(calls)
    expect(a.logs.filter((l) => l.includes("unavailable"))).toHaveLength(1)
    expect(a.gate.ledgerDown).toBe(true)
    expect(a.gate.heldMiB).toBe(2000)
  })

  it("a launch bigger than the local budget runs alone locally, never refused", async () => {
    const store = makeFakeStore()
    const a = processOf(store, "c1", { localShare: 0.5 })
    a.client.down = true
    const huge = await a.gate.tryReserve(4000, BUDGET) // > 2500
    expect(reserved(huge)).toBe(true)
    expect(reserved(await a.gate.tryReserve(1, BUDGET))).toBe(false)
    huge.reservation!.release()
    expect(reserved(await a.gate.tryReserve(1, BUDGET))).toBe(true)
  })

  it("a HANGING Redis is bounded by the command timeout — the launch is never blocked on it", async () => {
    const store = makeFakeStore()
    const a = processOf(store, "c1")
    a.client.hang = true
    let outcome: ReserveOutcome | undefined
    void a.gate.tryReserve(1000, BUDGET).then((o) => { outcome = o })
    await vi.advanceTimersByTimeAsync(1999)
    expect(outcome).toBeUndefined()
    await vi.advanceTimersByTimeAsync(2)
    expect(reserved(outcome!)).toBe(true) // local share
    expect(a.gate.ledgerDown).toBe(true)
  })

  it("probes Redis again after the breaker window, and shares again once it answers", async () => {
    const store = makeFakeStore()
    const a = processOf(store, "c1")
    a.client.down = true
    await a.gate.tryReserve(100, BUDGET)
    a.client.down = false
    await vi.advanceTimersByTimeAsync(5000)
    expect(reserved(await a.gate.tryReserve(100, BUDGET))).toBe(true)
    expect(a.gate.ledgerDown).toBe(false)
    expect(a.logs.some((l) => l.includes("is back"))).toBe(true)
    expect(leasesOf(store, "c1").size).toBeGreaterThanOrEqual(1)
  })

  it("leases taken during the outage are registered in the ledger by the heartbeat once it is back", async () => {
    const store = makeFakeStore()
    const a = processOf(store, "c1")
    a.client.down = true
    await a.gate.tryReserve(2000, BUDGET)
    expect(leasesOf(store, "c1").size).toBe(0)
    a.client.down = false
    await vi.advanceTimersByTimeAsync(HEARTBEAT + 5000)
    expect(leasesOf(store, "c1").size).toBe(1)
    const b = processOf(store, "c1")
    expect(reserved(await b.gate.tryReserve(4000, BUDGET))).toBe(false) // B now sees A's 2000
  })

  it("after an outage this process's own local leases count against its next ledger reserve", async () => {
    const store = makeFakeStore()
    const a = processOf(store, "c1") // local budget 2500
    a.client.down = true
    expect(reserved(await a.gate.tryReserve(2000, BUDGET))).toBe(true) // local-only: Redis does not know it
    a.client.down = false
    await vi.advanceTimersByTimeAsync(5000) // the breaker is over; the heartbeat (10 s) has not run
    // 2000 held + 3001 > 5000: refused — the ledger must have been told about the 2000 first.
    const refused = await a.gate.tryReserve(BUDGET - 2000 + 1, BUDGET)
    expect(reserved(refused)).toBe(false)
    expect(refused.containerTotalMiB).toBe(2000)
    expect(reserved(await a.gate.tryReserve(BUDGET - 2000, BUDGET))).toBe(true)
    // The ledger never exceeded the budget.
    let total = 0
    for (const v of store.hashes.values()) for (const n of v.values()) total += Number(n)
    expect(total).toBe(BUDGET)
  })

  it("a reserve that timed out but lands late is taken back — no lease left to expire on its own", async () => {
    const store = makeFakeStore()
    const a = processOf(store, "c1")
    a.client.delayMs = 3000 // slower than the 2 s command timeout, but it DOES execute
    const pending = a.gate.tryReserve(1000, BUDGET)
    await vi.advanceTimersByTimeAsync(2500)
    expect(reserved(await pending)).toBe(true) // local fallback
    a.client.delayMs = 0
    await vi.advanceTimersByTimeAsync(3000) // the late reserve and the release behind it have both landed
    expect(leasesOf(store, "c1").size).toBe(0)
  })
})

describe("no leaked lease — error, abort, kill", () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it("a launch that errors still releases (the launcher's finally)", async () => {
    const store = makeFakeStore()
    const a = processOf(store, "c1")
    const release = await a.admission.acquire({ peakMemoryMiB: 3000 })
    expect(leasesOf(store, "c1").size).toBe(1)
    try { throw new Error("ffmpeg exited 1") } catch { /* the work failed */ } finally { release() }
    await vi.advanceTimersByTimeAsync(0)
    expect(leasesOf(store, "c1").size).toBe(0)
    release() // idempotent
    expect(leasesOf(store, "c1").size).toBe(0)
  })

  it("a waiter aborted while the ledger is answering gives back the lease it was granted", async () => {
    const store = makeFakeStore()
    const a = processOf(store, "c1")
    a.client.delayMs = 500
    const controller = new AbortController()
    const waiting = a.admission.acquire({ peakMemoryMiB: 3000, signal: controller.signal })
    waiting.catch(() => undefined)
    await vi.advanceTimersByTimeAsync(100) // the reserve is in flight
    controller.abort(new Error("cancelled"))
    await expect(waiting).rejects.toThrow("cancelled")
    a.client.delayMs = 0
    await vi.advanceTimersByTimeAsync(1000)
    expect(leasesOf(store, "c1").size).toBe(0)
    expect(a.admission.state).toMatchObject({ running: 0, reservedMiB: 0, waiting: 0 })
    expect(a.gate.heldMiB).toBe(0)
  })

  it("a waiter aborted while queued behind memory leaves nothing in the ledger", async () => {
    const store = makeFakeStore()
    const a = processOf(store, "c1")
    const hold = await a.admission.acquire({ peakMemoryMiB: 4800 })
    const controller = new AbortController()
    const waiting = a.admission.acquire({ peakMemoryMiB: 2000, signal: controller.signal })
    waiting.catch(() => undefined)
    await vi.advanceTimersByTimeAsync(POLL * 2)
    controller.abort(new Error("cancelled"))
    await expect(waiting).rejects.toThrow("cancelled")
    hold()
    await vi.advanceTimersByTimeAsync(POLL * 2)
    expect(leasesOf(store, "c1").size).toBe(0)
  })

  it("a killed process leaves a lease that expires — the budget is whole again within one TTL", async () => {
    const store = makeFakeStore()
    const dying = processOf(store, "c1", { heartbeatMs: 10 * 24 * 3600 * 1000 })
    await dying.gate.tryReserve(5000, BUDGET)
    const survivor = processOf(store, "c1")
    expect(reserved(await survivor.gate.tryReserve(1000, BUDGET))).toBe(false)
    await vi.advanceTimersByTimeAsync(FFMPEG_LEASE_TTL_MS + 1)
    expect(reserved(await survivor.gate.tryReserve(5000, BUDGET))).toBe(true)
  })
})

describe("FfmpegAdmission over a gate — the local order", () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it("an oversized waiter is passed at most the overtake bound by this process's own launches", async () => {
    const store = makeFakeStore()
    const a = processOf(store, "c1")
    const hold = await a.admission.acquire({ peakMemoryMiB: 2000 })
    const order: string[] = []
    void a.admission.acquire({ peakMemoryMiB: BUDGET + 500 }).then((r) => { order.push("big"); setTimeout(r, 0) })
    for (let k = 0; k < 12; k++) {
      void a.admission.acquire({ peakMemoryMiB: 100 }).then((r) => { order.push(`s${k}`); r() })
    }
    await vi.advanceTimersByTimeAsync(POLL * 3)
    // Eight small launches overtook it; then strict FIFO held behind it.
    expect(order.filter((o) => o.startsWith("s"))).toHaveLength(8)
    expect(order).not.toContain("big")
    hold()
    await vi.advanceTimersByTimeAsync(POLL * 6)
    expect(order.indexOf("big")).toBe(8)
  })

  it("with the local gate it behaves as before (one process, one budget)", async () => {
    const admission = new FfmpegAdmission(() => ({ slots: 4, budgetMiB: 1000, defaultPeakMiB: 100 }), { gate: new LocalMemoryGate() })
    const r1 = await admission.acquire({ peakMemoryMiB: 700 })
    let second = false
    void admission.acquire({ peakMemoryMiB: 700 }).then(() => { second = true })
    await vi.advanceTimersByTimeAsync(2000)
    expect(second).toBe(false)
    r1()
    await vi.advanceTimersByTimeAsync(10)
    expect(second).toBe(true)
  })
})

// The unit under test above is exercised through the real wiring in one more
// place: the production composition reads the container's identity.
describe("ledger keys", () => {
  it("a hash tag keeps one container's two keys in one cluster slot", () => {
    const store = makeFakeStore()
    const client = makeFakeClient(store)
    const ledger = new RedisMemoryLedger({ client: () => client, containerId: "rep-9" })
    return ledger.reserve("l1", 10, 100).then(() => {
      expect([...store.zsets.keys()]).toEqual(["ffmpeg:mem:{rep-9}:exp"])
      expect([...store.hashes.keys()]).toEqual(["ffmpeg:mem:{rep-9}:mib"])
    })
  })
})
