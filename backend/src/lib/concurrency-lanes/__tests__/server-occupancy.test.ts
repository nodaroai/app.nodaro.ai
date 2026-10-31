// Every process publishes what it holds of its pools, for the Live usage page:
// one key per (environment, pool, process), refreshed every 5 s, gone 15 s
// after the process stops. Publishing never throws and never hangs.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { countFailOpen, countUngated, resetLaneCountersForTests, runNotLimited } from "../hold.js"
import { resetServerShareForTests, serverShare } from "../server-share.js"
import {
  type OccupancyClient, publishLaneCounters, publishServerOccupancy, SERVER_OCCUPANCY_INTERVAL_MS, SERVER_OCCUPANCY_TTL_MS, serverProcessId, startServerOccupancyPublisher,
} from "../server-occupancy.js"

type SetCall = [key: string, value: string, px: string, ttl: number]

function fakeClient(impl?: () => Promise<unknown>) {
  const calls: SetCall[] = []
  const set = vi.fn(async (...args: SetCall) => {
    calls.push(args)
    return impl ? impl() : "OK"
  })
  return { client: { set } as unknown as OccupancyClient, calls, set }
}

beforeEach(() => {
  resetServerShareForTests()
  resetLaneCountersForTests()
  vi.stubEnv("RUNTIME_ENV", "staging")
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe("publishServerOccupancy", () => {
  it("each process publishes its pools' occupancy with a 15-second TTL", async () => {
    const video = serverShare("video", 8)
    video.tryEnter({ userId: "U", jobId: "j1", coordinator: true, exempt: false })
    serverShare("render", 2)
    const { client, calls } = fakeClient()
    await publishServerOccupancy({ client, prefix: "test:cl:" })
    expect(SERVER_OCCUPANCY_TTL_MS).toBe(15_000)
    expect(calls.map((c) => [c[0], c[2], c[3]])).toEqual([
      [`test:cl:servers:staging:video:${serverProcessId()}`, "PX", 15_000],
      [`test:cl:servers:staging:render:${serverProcessId()}`, "PX", 15_000],
    ])
    expect(JSON.parse(calls[0]![1])).toMatchObject({
      pool: "video", processId: serverProcessId(), poolSize: 8, held: 1, byUser: { U: 1 }, coordinators: 1, userCap: 2, coordinatorCap: 4,
      at: expect.any(Number),
    })
  })

  it("defaults to the gate's key prefix", async () => {
    serverShare("render", 2)
    const { client, calls } = fakeClient()
    await publishServerOccupancy({ client })
    expect(calls[0]![0]).toBe(`cl:v1:servers:staging:render:${serverProcessId()}`)
  })

  it("skips a tick while the client is not ready, so nothing queues up during an outage", async () => {
    serverShare("render", 2)
    const { client, set } = fakeClient()
    const c = client as unknown as { status?: string }
    c.status = "reconnecting"
    await publishServerOccupancy({ client })
    expect(set).not.toHaveBeenCalled()
    c.status = "ready"
    await publishServerOccupancy({ client })
    expect(set).toHaveBeenCalledTimes(1)
  })

  it("publishes nothing when the process has no pool", async () => {
    const { client, set } = fakeClient()
    await publishServerOccupancy({ client })
    expect(set).not.toHaveBeenCalled()
  })

  it("a Redis error or a call that never answers is swallowed, bounded by the timeout", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined)
    serverShare("render", 2)
    await expect(publishServerOccupancy({ client: fakeClient(async () => { throw new Error("down") }).client })).resolves.toBeUndefined()
    vi.useFakeTimers()
    const hung = publishServerOccupancy({ client: fakeClient(() => new Promise(() => {})).client, timeoutMs: 1_000 })
    await vi.advanceTimersByTimeAsync(1_000)
    await expect(hung).resolves.toBeUndefined()
  })
})

describe("the environment's index of published keys", () => {
  it("lists every key written, scored by its expiry, drops expired members, and expires itself", async () => {
    serverShare("video", 8)
    const ops: unknown[][] = []
    const client = {
      set: async () => "OK",
      zadd: async (...a: unknown[]) => { ops.push(["zadd", ...a]); return 1 },
      zremrangebyscore: async (...a: unknown[]) => { ops.push(["zremrangebyscore", ...a]); return 0 },
      pexpire: async (...a: unknown[]) => { ops.push(["pexpire", ...a]); return 1 },
    } as unknown as OccupancyClient
    const before = Date.now()
    await publishServerOccupancy({ client, prefix: "test:cl:" })
    await publishLaneCounters({ client, prefix: "test:cl:" })
    const zadds = ops.filter((o) => o[0] === "zadd")
    expect(zadds.map((o) => [o[1], o[3]])).toEqual([
      ["test:cl:published:staging", `test:cl:servers:staging:video:${serverProcessId()}`],
      ["test:cl:published:staging", `test:cl:counters:staging:${serverProcessId()}`],
    ])
    expect(zadds[0]![2] as number).toBeGreaterThanOrEqual(before + SERVER_OCCUPANCY_TTL_MS)
    expect(ops.filter((o) => o[0] === "zremrangebyscore").every((o) => o[1] === "test:cl:published:staging" && o[2] === "-inf")).toBe(true)
    expect(ops.filter((o) => o[0] === "pexpire").every((o) => o[1] === "test:cl:published:staging" && o[2] === SERVER_OCCUPANCY_TTL_MS * 4)).toBe(true)
  })
})

describe("publishLaneCounters", () => {
  it("each process publishes its counters of work outside the gate under its own key, with a 15-second TTL", async () => {
    countUngated("generate-image")
    countUngated("generate-image")
    countFailOpen("gate-timeout")
    await runNotLimited("training", async () => undefined)
    const { client, calls } = fakeClient()
    await publishLaneCounters({ client, prefix: "test:cl:" })
    expect(calls.map((c) => [c[0], c[2], c[3]])).toEqual([[`test:cl:counters:staging:${serverProcessId()}`, "PX", 15_000]])
    expect(JSON.parse(calls[0]![1])).toEqual({
      processId: serverProcessId(), env: "staging", at: expect.any(Number), startedAt: expect.any(Number),
      ungated: { "generate-image": 2 }, notLimited: { training: 1 }, failOpen: { "gate-timeout": 1 },
    })
  })

  it("publishes even with nothing counted, so every live process is listed", async () => {
    const { client, calls } = fakeClient()
    await publishLaneCounters({ client })
    expect(calls[0]![0]).toBe(`cl:v1:counters:staging:${serverProcessId()}`)
    const value = JSON.parse(calls[0]![1]) as { startedAt: number; at: number }
    expect(value).toMatchObject({ ungated: {}, notLimited: {}, failOpen: {} })
    // Counted since the process started: a time before now, the same on every write.
    expect(value.startedAt).toBeLessThanOrEqual(value.at)
    await publishLaneCounters({ client })
    expect((JSON.parse(calls[1]![1]) as { startedAt: number }).startedAt).toBe(value.startedAt)
  })

  it("skips while the client is not ready; a Redis error or a hung call is swallowed", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined)
    const { client, set } = fakeClient()
    ;(client as unknown as { status?: string }).status = "connecting"
    await publishLaneCounters({ client })
    expect(set).not.toHaveBeenCalled()
    await expect(publishLaneCounters({ client: fakeClient(async () => { throw new Error("down") }).client })).resolves.toBeUndefined()
    vi.useFakeTimers()
    const hung = publishLaneCounters({ client: fakeClient(() => new Promise(() => {})).client, timeoutMs: 1_000 })
    await vi.advanceTimersByTimeAsync(1_000)
    await expect(hung).resolves.toBeUndefined()
  })
})

describe("startServerOccupancyPublisher", () => {
  it("publishes the counters on every tick too, even in a process with no pool", async () => {
    vi.useFakeTimers()
    const { client, calls } = fakeClient()
    const stop = startServerOccupancyPublisher({ client })
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(5_000)
    expect(calls.map((c) => c[0])).toEqual([`cl:v1:counters:staging:${serverProcessId()}`, `cl:v1:counters:staging:${serverProcessId()}`])
    stop()
  })

  it("publishes every 5 seconds until stopped, and skips a tick while the last one is in flight", async () => {
    vi.useFakeTimers()
    serverShare("render", 2)
    const pending: Array<() => void> = []
    const answer = () => { for (const r of pending.splice(0)) r() }
    let slow = false
    const { client, calls } = fakeClient(() => (slow ? new Promise<void>((r) => { pending.push(r) }) : Promise.resolve("OK")))
    // The pool writes (each tick also writes the counters).
    const poolWrites = () => calls.filter((c) => c[0].includes(":servers:")).length
    const stop = startServerOccupancyPublisher({ client, timeoutMs: 60_000 })
    expect(SERVER_OCCUPANCY_INTERVAL_MS).toBe(5_000)
    await vi.advanceTimersByTimeAsync(0)
    expect(poolWrites()).toBe(1)
    await vi.advanceTimersByTimeAsync(5_000)
    expect(poolWrites()).toBe(2)
    slow = true
    await vi.advanceTimersByTimeAsync(5_000)
    expect(poolWrites()).toBe(3)
    // Still in flight: the next tick does not pile up another write.
    await vi.advanceTimersByTimeAsync(2_000)
    await vi.advanceTimersByTimeAsync(3_000)
    expect(poolWrites()).toBe(3)
    answer()
    slow = false
    await vi.advanceTimersByTimeAsync(5_000)
    expect(poolWrites()).toBe(4)
    stop()
    stop()
    await vi.advanceTimersByTimeAsync(20_000)
    expect(poolWrites()).toBe(4)
  })
})
