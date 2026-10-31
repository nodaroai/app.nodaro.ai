// Every process publishes what it holds of its pools, for the Live usage page:
// one key per (environment, pool, process), refreshed every 5 s, gone 15 s
// after the process stops. Publishing never throws and never hangs.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { resetServerShareForTests, serverShare } from "../server-share.js"
import {
  type OccupancyClient, publishServerOccupancy, SERVER_OCCUPANCY_INTERVAL_MS, SERVER_OCCUPANCY_TTL_MS, serverProcessId, startServerOccupancyPublisher,
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

describe("startServerOccupancyPublisher", () => {
  it("publishes every 5 seconds until stopped, and skips a tick while the last one is in flight", async () => {
    vi.useFakeTimers()
    serverShare("render", 2)
    let answer: (() => void) | null = null
    let slow = false
    const { client, set } = fakeClient(() => (slow ? new Promise<void>((r) => { answer = r }) : Promise.resolve("OK")))
    const stop = startServerOccupancyPublisher({ client, timeoutMs: 60_000 })
    expect(SERVER_OCCUPANCY_INTERVAL_MS).toBe(5_000)
    await vi.advanceTimersByTimeAsync(0)
    expect(set).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(5_000)
    expect(set).toHaveBeenCalledTimes(2)
    slow = true
    await vi.advanceTimersByTimeAsync(5_000)
    expect(set).toHaveBeenCalledTimes(3)
    // Still in flight: the next tick does not pile up another write.
    await vi.advanceTimersByTimeAsync(2_000)
    await vi.advanceTimersByTimeAsync(3_000)
    expect(set).toHaveBeenCalledTimes(3)
    answer!()
    slow = false
    await vi.advanceTimersByTimeAsync(5_000)
    expect(set).toHaveBeenCalledTimes(4)
    stop()
    stop()
    await vi.advanceTimersByTimeAsync(20_000)
    expect(set).toHaveBeenCalledTimes(4)
  })
})
