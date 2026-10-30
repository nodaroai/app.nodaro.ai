/**
 * The concurrency gate's contract — the semantics `ConcurrencyGate` promises
 * whatever stores it: run against the JS twin of the scripts
 * (`lane-gate.test.ts`) and against a real Redis with the real Lua
 * (`lane-gate.redis.test.ts`). Enforcement is on unless a case says otherwise.
 *
 * Every case gets its own key prefix, so cases never see each other's lines,
 * providers or the enforcement flag, and the fixture deletes the prefix after.
 * Wakes are observed by recording the client's `publish`; they go to
 * `<prefix>wake` (LANE_WAKE_CHANNEL under the production prefix).
 */
import { afterEach, beforeEach, expect, it } from "vitest"
import {
  ConcurrencyGate,
  LANE_LEASE_TTL_MS,
  LANE_RESERVATION_TTL_MS,
  LANE_WAITER_TTL_MS,
  type AcquireRequest,
  type AcquireResult,
  type LaneClient,
  type WakeTarget,
} from "../gate.js"
import type { LaneEntryMeta } from "../types.js"

export interface LaneGateFixture {
  /** The client the gate evaluates its scripts on. */
  client: () => LaneClient
  /** A key prefix no other case or process uses. */
  prefix: string
  /** Writes one wait-list member directly, to stand for state a lost key left behind. */
  zadd: (key: string, score: number, member: string) => Promise<void>
  cleanup: () => Promise<void>
}

const T0 = 1_700_000_000_000
const LONG = 3_600_000

export function runLaneGateContract(makeFixture: () => LaneGateFixture): void {
  let clock = T0
  let fixture: LaneGateFixture
  let gate: ConcurrencyGate
  let published: Array<{ channel: string; target: WakeTarget }>

  beforeEach(async () => {
    clock = T0
    fixture = makeFixture()
    published = []
    // Scripts run on the fixture's client; publishes are recorded, not sent.
    type Evaluator = { eval(script: string, numKeys: number, ...args: Array<string | number>): Promise<unknown> }
    const recorder = {
      eval: (script: string, numKeys: number, ...args: Array<string | number>) =>
        (fixture.client() as unknown as Evaluator).eval(script, numKeys, ...args),
      publish: async (channel: string, message: string) => {
        published.push({ channel, target: JSON.parse(message) as WakeTarget })
        return 0
      },
    } as unknown as LaneClient
    gate = new ConcurrencyGate({ client: () => recorder, now: () => clock, prefix: fixture.prefix })
    await gate.setEnforced(true)
  })
  afterEach(async () => {
    await fixture?.cleanup()
  })

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
  interface Opts { size?: number; mode?: AcquireRequest["mode"]; ttl?: number; meta?: Partial<LaneEntryMeta> }
  const acquire = (jobId: string, o: Opts = {}): Promise<AcquireResult> =>
    gate.acquire({ meta: meta(jobId, o.meta), size: o.size ?? 2, mode: o.mode ?? "fresh", leaseTtlMs: o.ttl ?? LANE_LEASE_TTL_MS })
  const leaseOf = (r: AcquireResult): string => {
    if (!r.granted) throw new Error(`expected a grant, got ${JSON.stringify(r)}`)
    return r.leaseId
  }
  const waitOf = (r: AcquireResult) => {
    if (r.granted) throw new Error(`expected a wait, got ${JSON.stringify(r)}`)
    return r.wait
  }
  const target = (jobId: string, queue: WakeTarget["queue"] = "video-generation"): WakeTarget => ({ jobId, queue, bullJobId: `bull-${jobId}` })
  const ids = (ts: WakeTarget[]) => ts.map((t) => t.jobId)

  it("grants up to size and queues the rest with exact positions", async () => {
    expect((await acquire("a")).granted).toBe(true)
    expect((await acquire("b")).granted).toBe(true)
    expect(waitOf(await acquire("c"))).toEqual({ lane: "provider", position: 1, running: 2, limit: 2, reason: "user_lane", waitedMs: 0, enqueuedAtMs: T0 })
    expect(waitOf(await acquire("d"))).toMatchObject({ position: 2, running: 2, limit: 2, reason: "user_lane" })
  })

  it("a release reserves the slot for the head waiter and returns it to wake", async () => {
    const a = leaseOf(await acquire("a"))
    await acquire("b")
    await acquire("c")
    await acquire("d")
    expect(await gate.release(a, "completed")).toEqual([target("c")])
    expect(published).toEqual([{ channel: `${fixture.prefix}wake`, target: target("c") }])
    expect(await gate.hasReservation("c")).toBe(true)
    expect(waitOf(await acquire("d"))).toMatchObject({ position: 2, running: 1 })
    expect((await acquire("c")).granted).toBe(true)
    expect(await gate.hasReservation("c")).toBe(false)
    expect(waitOf(await acquire("d"))).toMatchObject({ position: 1, running: 2 })
  })

  it("an unclaimed reservation passes to the next waiter and the first keeps its place", async () => {
    const a = leaseOf(await acquire("a", { size: 1, ttl: LONG }))
    await acquire("c", { size: 1 })
    await acquire("d", { size: 1 })
    expect(ids(await gate.release(a, "completed"))).toEqual(["c"])
    clock += LANE_RESERVATION_TTL_MS + 1_000
    expect(await gate.hasReservation("c")).toBe(false)
    expect(await gate.hasReservation("d")).toBe(true)
    expect(await gate.describeWait("c")).toMatchObject({ position: 1 })
    expect((await acquire("d", { size: 1 })).granted).toBe(true)
    expect(waitOf(await acquire("c", { size: 1 }))).toMatchObject({ position: 1, running: 1 })
  })

  it("a reservation passed on after expiry wakes the next waiter", async () => {
    const a = leaseOf(await acquire("a", { size: 1, ttl: LONG }))
    await acquire("c", { size: 1 })
    await acquire("d", { size: 1 })
    const other = leaseOf(await acquire("x", { size: 1, ttl: LONG, meta: { userId: "V", payer: "user:V" } }))
    await gate.release(a, "completed")
    published = []
    clock += LANE_RESERVATION_TTL_MS + 1_000
    // A renew on another line is the first script to run after the expiry.
    expect(await gate.renew(other, LONG, meta("x", { userId: "V", payer: "user:V" }))).toBe("renewed")
    expect(published).toEqual([{ channel: `${fixture.prefix}wake`, target: target("d") }])
  })

  it("a lease that lapses passes its slot on and wakes the next waiter", async () => {
    await acquire("a", { size: 1 })
    await acquire("b", { size: 1 })
    const other = leaseOf(await acquire("x", { size: 1, ttl: LONG, meta: { userId: "V", payer: "user:V" } }))
    published = []
    clock += LANE_LEASE_TTL_MS + 1
    expect(await gate.renew(other, LONG, meta("x", { userId: "V", payer: "user:V" }))).toBe("renewed")
    expect(published.map((p) => p.target)).toEqual([target("b")])
    expect(await gate.hasReservation("b")).toBe(true)
  })

  it("a reserved waiter dropped for the waiter TTL passes its slot on and wakes the next", async () => {
    const a = leaseOf(await acquire("a", { size: 1, ttl: 2 * LANE_WAITER_TTL_MS }))
    await acquire("b", { size: 1 })
    const other = leaseOf(await acquire("x", { size: 1, ttl: 2 * LANE_WAITER_TTL_MS, meta: { userId: "V", payer: "user:V" } }))
    clock += LANE_WAITER_TTL_MS - LANE_RESERVATION_TTL_MS + 1_000
    await acquire("c", { size: 1 }) // c is seen late, so it outlives b's waiter TTL
    expect(ids(await gate.release(a, "completed"))).toEqual(["b"])
    published = []
    clock += LANE_RESERVATION_TTL_MS - 1_000 // b's reservation is still held; b itself is not seen for the waiter TTL
    expect(await gate.renew(other, LONG, meta("x", { userId: "V", payer: "user:V" }))).toBe("renewed")
    expect(await gate.describeWait("b")).toBeNull()
    expect(published.map((p) => p.target)).toEqual([target("c")])
  })

  it("a head takes over a reservation held by a waiter behind it", async () => {
    const a = leaseOf(await acquire("a", { size: 1, ttl: LONG }))
    await acquire("c", { size: 1 })
    await acquire("d", { size: 1 })
    await gate.release(a, "completed")
    clock += LANE_RESERVATION_TTL_MS + 1_000
    expect(await gate.hasReservation("d")).toBe(true)
    expect((await acquire("c", { size: 1 })).granted).toBe(true)
    expect(await gate.hasReservation("d")).toBe(false)
    expect(await gate.describeWait("d")).toMatchObject({ position: 1, running: 1 })
  })

  it("acquire is idempotent per job id", async () => {
    const a1 = leaseOf(await acquire("a"))
    await acquire("b")
    await acquire("c")
    await acquire("c")
    expect(leaseOf(await acquire("a"))).toBe(a1)
    expect(waitOf(await acquire("d"))).toMatchObject({ position: 2 })
    const snap = await gate.snapshot()
    expect(snap.lines[0]!.lanes.provider).toEqual({ running: 2, overLimit: 0, queued: 2 })
  })

  it("a lease on another lane is not reused", async () => {
    const provider = leaseOf(await acquire("j", { size: 1 }))
    const llm = leaseOf(await acquire("j", { size: 1, meta: { lane: "llm" } }))
    expect(llm).not.toBe(provider)
    await acquire("o", { size: 1, meta: { lane: "local" } })
    await acquire("k", { size: 1, meta: { lane: "run" } })
    expect(waitOf(await acquire("k", { size: 1, meta: { lane: "local" } }))).toMatchObject({ lane: "local", position: 1 })
    expect((await gate.snapshot()).lines[0]!.lanes).toMatchObject({ provider: { running: 1 }, llm: { running: 1 }, local: { running: 1, queued: 1 }, run: { running: 1 } })
  })

  it("a job that re-enters on another line leaves no trace in the first", async () => {
    const a = leaseOf(await acquire("a", { size: 1 }))
    await acquire("o", { size: 1, meta: { lane: "llm" } })
    await acquire("j", { size: 1 })
    expect(ids(await gate.release(a, "completed"))).toEqual(["j"]) // j holds a reservation on the provider line
    clock += 1_000
    expect(waitOf(await acquire("j", { size: 1, meta: { lane: "llm" } }))).toMatchObject({ lane: "llm", position: 1, enqueuedAtMs: T0 + 1_000 })
    expect(await gate.hasReservation("j")).toBe(false)
    expect((await acquire("k", { size: 1 })).granted).toBe(true) // the provider slot was not kept for j
    expect((await gate.snapshot()).lines[0]!.lanes).toMatchObject({ provider: { running: 1, queued: 0 }, llm: { running: 1, queued: 1 } })
    await gate.setEnforced(false)
    expect(await acquire("j", { size: 1 })).toMatchObject({ granted: true, overLimit: true, wouldWait: { lane: "provider", enqueuedAtMs: T0 + 1_000 } })
    expect((await gate.snapshot()).lines[0]!.lanes).toMatchObject({ provider: { running: 2, queued: 0 }, llm: { running: 1, queued: 0 } })
  })

  it("snapshot survives a waiter with no hash", async () => {
    const a = leaseOf(await acquire("a", { size: 1 }))
    await acquire("b", { size: 1 })
    await fixture.zadd(`${fixture.prefix}l:user:U:U:provider:wait`, -1e13, "ghost")
    clock += 3_000
    expect((await gate.snapshot()).lines[0]).toMatchObject({ oldestWaitMs: 3_000, lanes: { provider: { running: 1, queued: 2 } } })
    expect((await gate.heads())[0]).toEqual({ jobId: "ghost", queue: null, lastSeenMs: 0 })
    expect(ids(await gate.release(a, "completed"))).toEqual(["b"]) // the ghost is dropped, never reserved
    expect((await gate.snapshot()).lines[0]!.lanes.provider).toEqual({ running: 0, overLimit: 0, queued: 1 })
    expect((await acquire("b", { size: 1 })).granted).toBe(true)
  })

  it("lines are keyed by payer", async () => {
    await acquire("a", { size: 1 })
    expect((await acquire("b", { size: 1 })).granted).toBe(false)
    expect((await acquire("c", { size: 1, meta: { payer: "workspace:W" } })).granted).toBe(true)
  })

  it("users do not share lines", async () => {
    await acquire("a", { size: 1 })
    expect((await acquire("b", { size: 1, meta: { userId: "V", payer: "user:V" } })).granted).toBe(true)
  })

  it("lanes are independent", async () => {
    await acquire("a", { size: 1 })
    expect((await acquire("b", { size: 1, meta: { lane: "llm" } })).granted).toBe(true)
    expect((await acquire("c", { size: 1, meta: { lane: "local" } })).granted).toBe(true)
    expect((await acquire("d", { size: 1, meta: { lane: "run" } })).granted).toBe(true)
  })

  it("a lowered size admits nothing until running drops below it", async () => {
    const leases = [leaseOf(await acquire("a", { size: 3 })), leaseOf(await acquire("b", { size: 3 })), leaseOf(await acquire("c", { size: 3 }))]
    expect((await acquire("d", { size: 1 })).granted).toBe(false)
    expect(await gate.release(leases[0]!, "completed")).toEqual([])
    expect((await acquire("d", { size: 1 })).granted).toBe(false)
    expect(await gate.release(leases[1]!, "completed")).toEqual([])
    expect((await acquire("d", { size: 1 })).granted).toBe(false)
    expect(ids(await gate.release(leases[2]!, "completed"))).toEqual(["d"])
    expect((await acquire("d", { size: 1 })).granted).toBe(true)
  })

  it("an expired lease frees its slot", async () => {
    await acquire("a", { size: 1 })
    expect((await acquire("b", { size: 1 })).granted).toBe(false)
    clock += LANE_LEASE_TTL_MS + 1
    expect((await acquire("b", { size: 1 })).granted).toBe(true)
    expect((await gate.snapshot()).lines[0]!.lanes.provider).toEqual({ running: 1, overLimit: 0, queued: 0 })
  })

  it("readmit is granted at once even when the line is full", async () => {
    await acquire("a", { size: 1 })
    await acquire("b", { size: 1 })
    expect(await acquire("c", { size: 1, mode: "readmit" })).toMatchObject({ granted: true, overLimit: false, wouldWait: null })
    // A readmit of a job with a live lease reclaims it.
    const a = leaseOf(await acquire("a", { size: 1 }))
    expect(leaseOf(await acquire("a", { size: 1, mode: "readmit" }))).toBe(a)
    expect((await gate.snapshot()).lines[0]!.lanes.provider).toEqual({ running: 2, overLimit: 0, queued: 1 })
  })

  it("front entries go ahead of fresh entries", async () => {
    const a = leaseOf(await acquire("a", { size: 1 }))
    await acquire("b", { size: 1 })
    await acquire("c", { size: 1 })
    expect(waitOf(await acquire("f1", { size: 1, mode: "front" }))).toMatchObject({ position: 1 })
    expect(waitOf(await acquire("f2", { size: 1, mode: "front" }))).toMatchObject({ position: 2 })
    expect(await gate.describeWait("b")).toMatchObject({ position: 3 })
    expect(ids(await gate.release(a, "completed"))).toEqual(["f1"])
  })

  it("a parent that spawns a same-lane child on a size-1 lane completes", async () => {
    const parent = leaseOf(await acquire("parent", { size: 1 }))
    expect(await gate.borrow("parent")).toBe(parent)
    // The child runs under the parent's lease: it never acquires, so the line stays at one.
    expect((await gate.snapshot()).lines[0]!.lanes.provider.running).toBe(1)
    await gate.release(parent, "completed")
    expect(await gate.borrow("parent")).toBeNull()
    expect((await gate.snapshot()).lines).toEqual([])
    // A run lease is never lent.
    await acquire("run-1", { size: 1, meta: { lane: "run" } })
    expect(await gate.borrow("run-1")).toBeNull()
  })

  it("withdraw removes a waiter and shifts positions", async () => {
    await acquire("a", { size: 1 })
    await acquire("b", { size: 1 })
    await acquire("c", { size: 1 })
    await acquire("d", { size: 1 })
    expect(await gate.withdraw("c")).toEqual([])
    expect(await gate.describeWait("c")).toBeNull()
    expect(await gate.describeWait("d")).toMatchObject({ position: 2 })
  })

  it("a withdrawn reserved waiter passes its slot to the next", async () => {
    const a = leaseOf(await acquire("a", { size: 1 }))
    await acquire("b", { size: 1 })
    await acquire("c", { size: 1 })
    await gate.release(a, "cancelled")
    expect(ids(await gate.withdraw("b"))).toEqual(["c"])
  })

  it("a waiter not seen for the waiter TTL is dropped", async () => {
    await acquire("a", { size: 1, ttl: 2 * LANE_WAITER_TTL_MS })
    await acquire("b", { size: 1 })
    clock += 60_000
    await acquire("c", { size: 1 })
    clock += LANE_WAITER_TTL_MS - 60_000
    expect(await gate.describeWait("b")).toBeNull()
    expect(await gate.describeWait("c")).toMatchObject({ position: 1 })
    expect(await gate.heads()).toEqual([{ jobId: "c", queue: "video-generation", lastSeenMs: T0 + 60_000 }])
  })

  it("provider ceiling: the eligible head with fewest running goes first", async () => {
    await gate.setProviderCeilings({ kie: 3 })
    const v = { userId: "V", payer: "user:V" } as const
    const w = { userId: "W", payer: "user:W" } as const
    const u1 = leaseOf(await acquire("u1", { size: 5, meta: { provider: "kie" } }))
    await acquire("u2", { size: 5, meta: { provider: "kie" } })
    await acquire("w1", { size: 5, meta: { provider: "kie", ...w } })
    expect(waitOf(await acquire("u3", { size: 5, meta: { provider: "kie" } }))).toMatchObject({ reason: "provider_ceiling", position: 1 })
    expect(waitOf(await acquire("w2", { size: 5, meta: { provider: "kie", ...w } }))).toMatchObject({ reason: "provider_ceiling" })
    clock += 1_000
    await acquire("v1", { size: 5, meta: { provider: "kie", ...v } })
    // U holds 1 after the release, W holds 1, V holds 0: V goes first although it waited least.
    expect(ids(await gate.release(u1, "completed"))).toEqual(["v1"])
    expect((await acquire("u3", { size: 5, meta: { provider: "kie" } })).granted).toBe(false)
    expect((await acquire("v1", { size: 5, meta: { provider: "kie", ...v } })).granted).toBe(true)
  })

  it("provider ceiling: equal running goes to the older waiter", async () => {
    await gate.setProviderCeilings({ kie: 1 })
    const v = { userId: "V", payer: "user:V" } as const
    const x = leaseOf(await acquire("x1", { size: 5, meta: { provider: "kie", userId: "X", payer: "user:X" } }))
    clock += 1_000
    await acquire("v1", { size: 5, meta: { provider: "kie", ...v } })
    clock += 1_000
    await acquire("u1", { size: 5, meta: { provider: "kie" } })
    expect(ids(await gate.release(x, "completed"))).toEqual(["v1"])
  })

  it("an ineligible low-runner does not block an eligible head", async () => {
    await gate.setProviderCeilings({ kie: 1 })
    const v = { userId: "V", payer: "user:V" } as const
    // V has nothing on kie, but its line is full (one google job), so its kie waiter is not eligible.
    await acquire("v0", { size: 1, meta: { provider: "google", ...v } })
    const u1 = leaseOf(await acquire("u1", { size: 5, meta: { provider: "kie" } }))
    expect(waitOf(await acquire("v1", { size: 1, meta: { provider: "kie", ...v } }))).toMatchObject({ reason: "user_lane" })
    await acquire("u2", { size: 5, meta: { provider: "kie" } })
    expect(ids(await gate.release(u1, "completed"))).toEqual(["u2"])
    expect((await acquire("u2", { size: 5, meta: { provider: "kie" } })).granted).toBe(true)
  })

  it("a free provider slot is never left idle while an eligible head exists", async () => {
    const v = { userId: "V", payer: "user:V" } as const
    await gate.setProviderCeilings({ kie: 1 })
    const u0 = leaseOf(await acquire("u0", { size: 5, meta: { provider: "kie" } }))
    await acquire("v1", { size: 5, meta: { provider: "kie", ...v } })
    // U's kie slot frees: V's waiting head gets it at once, and U's next job cannot take it.
    expect(ids(await gate.release(u0, "completed"))).toEqual(["v1"])
    expect(waitOf(await acquire("u1", { size: 5, meta: { provider: "kie" } }))).toMatchObject({ reason: "provider_ceiling" })
    expect(await gate.hasReservation("v1")).toBe(true)
  })

  it("raising a ceiling wakes waiting heads", async () => {
    const kie = (userId: string) => ({ provider: "kie", userId, payer: `user:${userId}` as const })
    await gate.setProviderCeilings({ kie: 1 })
    await acquire("x1", { size: 5, meta: kie("X") })
    await acquire("u1", { size: 5, meta: kie("U") })
    clock += 1_000
    await acquire("v1", { size: 5, meta: kie("V") })
    clock += 1_000
    await acquire("w1", { size: 5, meta: kie("W") })
    published = []
    await gate.setProviderCeilings({ kie: 3 })
    expect(published.map((p) => p.target.jobId)).toEqual(["u1", "v1"])
    await gate.setProviderCeilings({}) // no ceiling at all
    expect(published.map((p) => p.target.jobId)).toEqual(["u1", "v1", "w1"])
    expect((await acquire("z1", { size: 5, meta: kie("Z") })).granted).toBe(true)
  })

  it("an acquire can never change a provider ceiling", async () => {
    await gate.setProviderCeilings({ kie: 1 })
    const x1 = leaseOf(await acquire("x1", { size: 5, meta: { provider: "kie" } }))
    expect(waitOf(await acquire("x2", { size: 5, meta: { provider: "kie" } }))).toMatchObject({ reason: "provider_ceiling" })
    expect(ids(await gate.release(x1, "completed"))).toEqual(["x2"])
    await gate.release(leaseOf(await acquire("x2", { size: 5, meta: { provider: "kie" } })), "completed")
    clock += 20 * 60_000 // the provider goes idle and leaves the snapshot; its ceiling stays
    expect((await gate.snapshot()).providers).toEqual([])
    expect((await acquire("y1", { size: 5, meta: { provider: "kie" } })).granted).toBe(true)
    expect(waitOf(await acquire("y2", { size: 5, meta: { provider: "kie" } }))).toMatchObject({ reason: "provider_ceiling" })
  })

  it("a head blocked only by a ceiling lets a later job on another provider start", async () => {
    await gate.setProviderCeilings({ kie: 1 })
    await acquire("x", { size: 5, meta: { provider: "kie", userId: "X", payer: "user:X" } })
    expect(waitOf(await acquire("u1", { size: 3, meta: { provider: "kie" } }))).toMatchObject({ reason: "provider_ceiling", position: 1 })
    expect((await acquire("u2", { size: 3, meta: { provider: "google" } })).granted).toBe(true)
  })

  it("a later job on the same provider stays behind it", async () => {
    await gate.setProviderCeilings({ kie: 1 })
    await acquire("x", { size: 5, meta: { provider: "kie", userId: "X", payer: "user:X" } })
    await acquire("u1", { size: 3, meta: { provider: "kie" } })
    expect(waitOf(await acquire("u2", { size: 3, meta: { provider: "kie" } }))).toMatchObject({ reason: "provider_ceiling", position: 2 })
  })

  it("a release passes a slot past a ceiling-blocked head to a waiter on another provider", async () => {
    await gate.setProviderCeilings({ kie: 1 })
    await acquire("x", { size: 5, meta: { provider: "kie", userId: "X", payer: "user:X" } })
    const a = leaseOf(await acquire("a", { size: 1, meta: { provider: "google" } }))
    await acquire("u1", { size: 1, meta: { provider: "kie" } })
    await acquire("u2", { size: 1, meta: { provider: "google" } })
    expect(ids(await gate.release(a, "completed"))).toEqual(["u2"])
  })

  it("with enforcement off every acquire is granted and over-limit leases are counted", async () => {
    await gate.setEnforced(false)
    expect(await gate.isEnforced()).toBe(false)
    expect(await acquire("a")).toMatchObject({ granted: true, overLimit: false, wouldWait: null })
    await acquire("b")
    expect(await acquire("c")).toMatchObject({ granted: true, overLimit: true, wouldWait: { position: 1, running: 2, limit: 2, reason: "user_lane" } })
    expect(await acquire("d")).toMatchObject({ granted: true, overLimit: true, wouldWait: { position: 2, running: 3, limit: 2 } })
    const snap = await gate.snapshot()
    expect(snap.enforced).toBe(false)
    expect(snap.lines[0]!.lanes.provider).toEqual({ running: 4, overLimit: 2, queued: 0 })
    expect(await gate.allWaiters()).toEqual([])
  })

  it("with enforcement off a waiter left from enforcement is granted on its re-check", async () => {
    await acquire("a", { size: 1 })
    await acquire("b", { size: 1 })
    await gate.setEnforced(false)
    expect(await gate.allWaiters()).toEqual([target("b")])
    expect(await acquire("b", { size: 1 })).toMatchObject({ granted: true, overLimit: true })
    expect(await gate.allWaiters()).toEqual([])
  })

  it("allWaiters lists every waiter, server-busy ones included, for the off-transition", async () => {
    await acquire("a", { size: 1 })
    await acquire("b", { size: 1 })
    await gate.markServerWait({ ...meta("s", { queue: "workflow-orchestration", lane: "run" }), pool: "orchestrator" })
    const all = await gate.allWaiters()
    expect([...all].sort((x, y) => x.jobId.localeCompare(y.jobId))).toEqual([target("b"), target("s", "workflow-orchestration")])
  })

  it("renew of a lease Redis lost re-adopts it", async () => {
    const a = leaseOf(await acquire("a", { size: 1 }))
    clock += LANE_LEASE_TTL_MS + 1 // the lease lapsed (a stall, or the keys were lost)
    expect(await gate.renew(a, LANE_LEASE_TTL_MS, meta("a"))).toBe("readopted")
    expect(await gate.renew(a, LANE_LEASE_TTL_MS, meta("a"))).toBe("renewed")
    expect((await acquire("b", { size: 1 })).granted).toBe(false)
    expect(leaseOf(await acquire("a", { size: 1 }))).toBe(a)
  })

  it("renew of a lease superseded by a newer lease of the same job is released", async () => {
    const first = leaseOf(await acquire("a", { size: 1 }))
    clock += LANE_LEASE_TTL_MS + 1
    const second = leaseOf(await acquire("a", { size: 1 }))
    expect(second).not.toBe(first)
    expect(await gate.renew(first, LANE_LEASE_TTL_MS, meta("a"))).toBe("released")
    expect(await gate.renew(second, LANE_LEASE_TTL_MS, meta("a"))).toBe("renewed")
    expect((await gate.snapshot()).lines[0]!.lanes.provider.running).toBe(1)
  })

  it("renew after release never re-adopts the lease", async () => {
    const a = leaseOf(await acquire("a", { size: 1 }))
    await gate.release(a, "completed")
    expect(await gate.renew(a, LANE_LEASE_TTL_MS, meta("a"))).toBe("released")
    expect((await acquire("b", { size: 1 })).granted).toBe(true)
  })

  it("a server-busy waiter is visible to describeWait", async () => {
    const s = (id: string) => ({ ...meta(id, { lane: "run" as const, queue: "workflow-orchestration" as const }), pool: "orchestrator" })
    expect(await gate.markServerWait(s("s1"))).toEqual({ lane: "run", position: 1, limit: 0, running: 0, reason: "server_busy", waitedMs: 0, enqueuedAtMs: T0 })
    clock += 2_000
    expect(await gate.markServerWait(s("s2"))).toMatchObject({ position: 2, reason: "server_busy" })
    expect(await gate.markServerWait(s("s1"))).toMatchObject({ position: 1, waitedMs: 2_000, enqueuedAtMs: T0 })
    expect(await gate.describeWait("s1")).toMatchObject({ reason: "server_busy", position: 1 })
    expect((await acquire("s1", { size: 1, meta: { lane: "run", queue: "workflow-orchestration" } })).granted).toBe(true)
    expect(await gate.describeWait("s1")).toBeNull()
    await gate.withdraw("s2")
    expect(await gate.describeWait("s2")).toBeNull()
  })

  it("waitedMs grows and enqueuedAtMs is kept across re-checks", async () => {
    await acquire("a", { size: 1 })
    expect(waitOf(await acquire("b", { size: 1 }))).toMatchObject({ waitedMs: 0, enqueuedAtMs: T0 })
    clock += 5_000
    expect(waitOf(await acquire("b", { size: 1 }))).toMatchObject({ waitedMs: 5_000, enqueuedAtMs: T0 })
    clock += 5_000
    expect(await gate.describeWait("b")).toMatchObject({ waitedMs: 10_000, enqueuedAtMs: T0 })
  })

  it("snapshot reports lines, over-limit leases, oldest wait and per-provider counts", async () => {
    await acquire("a", { size: 1, meta: { provider: "kie", source: "editor" } })
    await acquire("b", { size: 1, meta: { provider: "kie", source: "mcp" } })
    await gate.setEnforced(false)
    await acquire("v1", { size: 1, meta: { userId: "V", payer: "user:V", provider: "kie" } })
    await acquire("v2", { size: 1, meta: { userId: "V", payer: "user:V", lane: "llm", provider: "anthropic" } })
    await acquire("v3", { size: 1, meta: { userId: "V", payer: "user:V", provider: "kie" } })
    clock += 7_000
    const snap = await gate.snapshot()
    expect(snap.enforced).toBe(false)
    const byUser = Object.fromEntries(snap.lines.map((l) => [l.userId, l]))
    expect(byUser.U).toMatchObject({ payer: "user:U", oldestWaitMs: 7_000, sources: { editor: 1, mcp: 1 } })
    expect(byUser.U!.lanes).toEqual({
      provider: { running: 1, overLimit: 0, queued: 1 },
      llm: { running: 0, overLimit: 0, queued: 0 },
      local: { running: 0, overLimit: 0, queued: 0 },
      run: { running: 0, overLimit: 0, queued: 0 },
    })
    expect(byUser.V).toMatchObject({ oldestWaitMs: 0, lanes: { provider: { running: 2, overLimit: 1, queued: 0 }, llm: { running: 1, overLimit: 0, queued: 0 } } })
    const kie = snap.providers.find((p) => p.provider === "kie")
    expect(kie).toEqual({ provider: "kie", running: 3, byUser: { U: 1, V: 2 }, completed15m: 0, failed15m: 0 })
    expect(snap.providers.find((p) => p.provider === "anthropic")).toMatchObject({ running: 1, byUser: { V: 1 } })
  })

  it("release counts outcomes into the 15-minute window", async () => {
    const leases: string[] = []
    for (const id of ["a", "b", "c", "d"]) leases.push(leaseOf(await acquire(id, { size: 5, meta: { provider: "kie" } })))
    await gate.release(leases[0]!, "completed")
    await gate.release(leases[1]!, "completed")
    clock += 60_000
    await gate.release(leases[2]!, "completed")
    await gate.release(leases[3]!, "failed")
    expect((await gate.snapshot()).providers.find((p) => p.provider === "kie")).toMatchObject({ running: 0, completed15m: 3, failed15m: 1 })
    clock += 16 * 60_000
    const later = (await gate.snapshot()).providers.find((p) => p.provider === "kie")
    expect(later ?? { completed15m: 0, failed15m: 0 }).toMatchObject({ completed15m: 0, failed15m: 0 })
  })
}
