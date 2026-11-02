// withdrawFromLane — the one withdraw every cancel and failure path reaches:
// on the gate's JS twin, it takes a waiting job out of its line (and out of a
// server share wait), hands the slot it held reserved to the next waiter, and
// never throws or waits on Redis for long. A writer that skips it is caught by
// the waiter TTL: a ghost stops blocking its line within 25 minutes.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ConcurrencyGate, LANE_LEASE_TTL_MS, LANE_WAITER_TTL_MS, LaneGateTimeoutError, type WakeTarget } from "../gate.js"
import type { LaneEntryMeta } from "../types.js"
import { makeFakeLaneClient, makeFakeLaneStore } from "./fake-lane-redis.js"

const refs = vi.hoisted(() => ({
  gate: null as unknown,
  woken: [] as WakeTarget[][],
}))
// Waiting is tested here, so turning limits on is made available; a case sets
// `lanesAvailable.on = false` for the shipped, locked path.
const lanesAvailable = vi.hoisted(() => ({ on: true }))
vi.mock("../enforcement-available.js", () => ({ get LANES_ENFORCEMENT_AVAILABLE() { return lanesAvailable.on } }))

vi.mock("../instance.js", () => ({ concurrencyGate: () => refs.gate }))

const { withdrawFromLane, registerWithdrawWaker, resetWithdrawWakerForTests, LANE_WITHDRAW_DEADLINE_MS } = await import("../withdraw.js")

const T0 = 1_700_000_000_000
const LONG = 3_600_000
let clock = T0
let gate: ConcurrencyGate

const meta = (jobId: string, over: Partial<LaneEntryMeta> = {}): LaneEntryMeta => ({
  jobId,
  userId: "U",
  payer: "user:U",
  lane: "provider",
  provider: null,
  source: null,
  sourceDetail: null,
  jobType: "generate-image",
  model: null,
  queue: "video-generation",
  bullJobId: `bull-${jobId}`,
  ...over,
})
const acquire = (jobId: string, ttl = LANE_LEASE_TTL_MS, over: Partial<LaneEntryMeta> = {}) =>
  gate.acquire({ meta: meta(jobId, over), size: 1, mode: "fresh", leaseTtlMs: ttl })
const leaseOf = async (jobId: string, ttl = LONG, over: Partial<LaneEntryMeta> = {}): Promise<string> => {
  const r = await acquire(jobId, ttl, over)
  if (!r.granted) throw new Error(`expected a grant for ${jobId}`)
  return r.leaseId
}

beforeEach(async () => {
  clock = T0
  lanesAvailable.on = true
  refs.woken = []
  const store = makeFakeLaneStore()
  gate = new ConcurrencyGate({ client: () => makeFakeLaneClient(store), now: () => clock })
  refs.gate = gate
  await gate.setEnforced(true)
  // The park module registers this in every process that parks (registerLaneParking).
  registerWithdrawWaker(async (targets) => {
    refs.woken.push(targets)
  })
})
afterEach(() => {
  resetWithdrawWakerForTests()
  vi.restoreAllMocks()
})

describe("withdrawFromLane", () => {
  it("takes a waiting job out of its line; the one behind it moves up", async () => {
    await leaseOf("a")
    await acquire("b")
    await acquire("c")
    expect(await gate.describeWait("c")).toMatchObject({ position: 2 })

    await withdrawFromLane("b")

    expect(await gate.describeWait("b")).toBeNull()
    expect(await gate.describeWait("c")).toMatchObject({ position: 1 })
    expect(refs.woken).toEqual([])
  })

  it("a withdrawn waiter that held a reserved slot hands it on, and the next waiter is woken", async () => {
    const a = await leaseOf("a")
    await acquire("b")
    await acquire("c")
    await gate.release(a, "completed") // reserved for b

    await withdrawFromLane("b")

    expect(refs.woken).toEqual([[{ jobId: "c", queue: "video-generation", bullJobId: "bull-c" }]])
    expect(await gate.hasReservation("c")).toBe(true)
  })

  it("in a process that does not park, the slot is still handed on (the gate publishes the wake)", async () => {
    resetWithdrawWakerForTests()
    const a = await leaseOf("a")
    await acquire("b")
    await acquire("c")
    await gate.release(a, "completed")
    await withdrawFromLane("b")
    expect(await gate.hasReservation("c")).toBe(true)
    expect(refs.woken).toEqual([])
  })

  it("a waker that never settles cannot hang the withdraw past its bound", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
    try {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
      registerWithdrawWaker(() => new Promise<void>(() => {}))
      const a = await leaseOf("a")
      await acquire("b")
      await acquire("c")
      await gate.release(a, "completed")
      const done = withdrawFromLane("b")
      await vi.advanceTimersByTimeAsync(5_001)
      await expect(done).resolves.toBeUndefined()
      expect(warn).toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it("one deadline bounds the whole withdraw: a slow gate answer and a hung wake together never take longer", async () => {
    expect(LANE_WITHDRAW_DEADLINE_MS).toBe(5_000)
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
    try {
      vi.spyOn(console, "warn").mockImplementation(() => {})
      // The gate answers after 4 s (inside its own 5 s call bound) with a slot to hand on; the wake then hangs.
      refs.gate = {
        withdraw: () => new Promise<WakeTarget[]>((r) => setTimeout(() => r([{ jobId: "c", queue: "video-generation", bullJobId: "bull-c" }]), 4_000)),
      }
      registerWithdrawWaker(() => new Promise<void>(() => {}))
      let settled = false
      const done = withdrawFromLane("b").then(() => { settled = true })
      await vi.advanceTimersByTimeAsync(4_999)
      expect(settled).toBe(false)
      await vi.advanceTimersByTimeAsync(2)
      await done
      expect(settled).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it("a gate that never answers cannot hang the withdraw past the deadline", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
    try {
      vi.spyOn(console, "warn").mockImplementation(() => {})
      refs.gate = { withdraw: () => new Promise<WakeTarget[]>(() => {}) }
      const done = withdrawFromLane("b")
      await vi.advanceTimersByTimeAsync(LANE_WITHDRAW_DEADLINE_MS + 1)
      await expect(done).resolves.toBeUndefined()
    } finally {
      vi.useRealTimers()
    }
  })

  it("is idempotent and a no-op for a job that never waited", async () => {
    await leaseOf("a")
    await acquire("b")
    await withdrawFromLane("b")
    await withdrawFromLane("b")
    await withdrawFromLane("never-waited")
    expect(await gate.describeWait("b")).toBeNull()
    expect(refs.woken).toEqual([])
  })

  it("never touches a running job's lease", async () => {
    await leaseOf("a")
    await acquire("b")
    await withdrawFromLane("a")
    // a still holds the only slot: b still waits behind it.
    expect(await gate.describeWait("b")).toMatchObject({ position: 1, running: 1 })
  })

  it("never throws when the gate fails or does not answer in time, and logs", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    refs.gate = { withdraw: vi.fn(async () => { throw new LaneGateTimeoutError("withdraw", 5_000) }) }
    await expect(withdrawFromLane("job-timeout")).resolves.toBeUndefined()
    refs.gate = { withdraw: vi.fn(async () => { throw new Error("redis down") }) }
    await expect(withdrawFromLane("job-error")).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalled()
  })

  it("does nothing for an empty id", async () => {
    const withdraw = vi.fn(async () => [] as WakeTarget[])
    refs.gate = { withdraw }
    await withdrawFromLane("")
    expect(withdraw).not.toHaveBeenCalled()
  })
})

describe("a ghost — a waiter whose row ended through a path that skipped the withdraw", () => {
  it("a waiter ended by a path that skips the withdraw stops blocking within the waiter TTL", async () => {
    // Another user's long lease keeps the scripts running (each one purges).
    const a = await leaseOf("a", 2 * LANE_WAITER_TTL_MS)
    await acquire("ghost") // its row is cancelled by a writer that never withdraws: it never re-checks again
    clock += 5 * 60_000
    await acquire("c")
    expect(await gate.describeWait("c")).toMatchObject({ position: 2 })

    // Within the TTL the ghost still stands at the head.
    clock = T0 + LANE_WAITER_TTL_MS - 60_000
    await acquire("c") // c re-checks (as a parked job does on its backstop)
    expect(await gate.describeWait("ghost")).toMatchObject({ position: 1 })

    // Past it, the ghost is dropped by the next script that sees it: c is the head,
    // and the slot a release frees goes to c, never to the ghost.
    clock = T0 + LANE_WAITER_TTL_MS + 1_000
    expect(await gate.describeWait("ghost")).toBeNull()
    expect(await gate.describeWait("c")).toMatchObject({ position: 1 })
    expect((await gate.release(a, "completed")).map((t) => t.jobId)).toEqual(["c"])
    expect((await acquire("c")).granted).toBe(true)
  })
})

describe("limits locked (this release): a cancel never waits for the gate", () => {
  it("returns at once while the gate hangs, and the withdraw still lands when it answers", async () => {
    // A ghost entry an earlier, enforced spell left behind: the withdraw still clears it.
    await leaseOf("a")
    await acquire("b")
    lanesAvailable.on = false
    let answer!: () => void
    const answered = new Promise<void>((r) => { answer = r })
    const real = gate.withdraw.bind(gate)
    const withdraw = vi.spyOn(gate, "withdraw").mockImplementation(async (id) => {
      await answered
      return real(id)
    })
    // Resolves before the gate answers: nothing here waits for it.
    await withdrawFromLane("b")
    await vi.waitFor(() => expect(withdraw).toHaveBeenCalledWith("b"))
    expect(await gate.describeWait("b")).not.toBeNull()
    answer()
    await vi.waitFor(async () => expect(await gate.describeWait("b")).toBeNull())
  })

  it("never rejects when the fired withdraw fails", async () => {
    lanesAvailable.on = false
    vi.spyOn(console, "warn").mockImplementation(() => {})
    vi.spyOn(gate, "withdraw").mockRejectedValue(new Error("redis down"))
    await expect(withdrawFromLane("b")).resolves.toBeUndefined()
  })
})
