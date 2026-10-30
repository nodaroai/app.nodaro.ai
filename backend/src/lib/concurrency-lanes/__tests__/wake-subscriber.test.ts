// The wake subscriber: a wake target a gate script reserved, published on the
// channel, reaches `onWake` only in a process subscribed for that target's queue.
import { describe, expect, it, vi } from "vitest"

// lib/queue.ts opens a real connection; here `redis.duplicate()` is a client of
// an in-memory bus that the gate's publishes (through the twin) also reach.
const bus = vi.hoisted(() => {
  type Listener = (channel: string, message: string) => void
  const subscribers = new Set<{ channels: Set<string>; listeners: Listener[] }>()
  return {
    subscribers,
    onReady: [] as Array<() => void>,
    subscribeCalls: 0,
    publish(channel: string, message: string) {
      for (const s of subscribers) if (s.channels.has(channel)) for (const l of s.listeners) l(channel, message)
    },
  }
})
vi.mock("../../queue.js", () => ({
  redis: {
    duplicate() {
      const s = { channels: new Set<string>(), listeners: [] as Array<(c: string, m: string) => void> }
      bus.subscribers.add(s)
      return {
        on(event: string, fn: (c: string, m: string) => void) {
          if (event === "message") s.listeners.push(fn)
          if (event === "ready") bus.onReady.push(fn as unknown as () => void)
        },
        async subscribe(channel: string) { bus.subscribeCalls += 1; s.channels.add(channel) },
        async unsubscribe(channel: string) { s.channels.delete(channel) },
        async quit() { bus.subscribers.delete(s) },
        disconnect() { bus.subscribers.delete(s) },
      }
    },
  },
}))

const { startLaneWakeSubscriber } = await import("../wake-subscriber.js")
const { ConcurrencyGate } = await import("../gate.js")
const { makeFakeLaneClient, makeFakeLaneStore } = await import("./fake-lane-redis.js")

const flush = () => new Promise((r) => setTimeout(r, 0))

describe("startLaneWakeSubscriber", () => {
  it("a published wake target promotes the parked job in the subscribing process", async () => {
    const store = makeFakeLaneStore()
    const twin = makeFakeLaneClient(store)
    const client = { eval: twin.eval.bind(twin), publish: async (c: string, m: string) => { bus.publish(c, m); return 1 } }
    const gate = new ConcurrencyGate({ client: () => client as unknown as typeof twin, now: () => 1_000 })
    await gate.setEnforced(true)

    const orchestrator = vi.fn(async () => undefined)
    const video = vi.fn(async () => undefined)
    const stopOrchestrator = startLaneWakeSubscriber(["workflow-orchestration", "video-director"], orchestrator)
    const stopVideo = startLaneWakeSubscriber(["video-generation"], video)
    await flush()

    const meta = (jobId: string) => ({ jobId, userId: "U", payer: "user:U" as const, lane: "run" as const, provider: null, source: null, sourceDetail: null, jobType: "workflow", model: null, queue: "workflow-orchestration" as const, bullJobId: `bull-${jobId}` })
    const a = await gate.acquire({ meta: meta("run-a"), size: 1, mode: "fresh", leaseTtlMs: 60_000 })
    await gate.acquire({ meta: meta("run-b"), size: 1, mode: "fresh", leaseTtlMs: 60_000 })
    if (!a.granted) throw new Error("run-a should be granted")
    await gate.release(a.leaseId, "completed")
    await flush()

    expect(orchestrator).toHaveBeenCalledWith([{ jobId: "run-b", queue: "workflow-orchestration", bullJobId: "bull-run-b" }])
    expect(video).not.toHaveBeenCalled()

    stopOrchestrator()
    stopVideo()
    await flush()
    await flush()
    expect(bus.subscribers.size).toBe(0)
    bus.publish("cl:v1:wake", JSON.stringify({ jobId: "late", queue: "workflow-orchestration", bullJobId: null }))
    expect(orchestrator).toHaveBeenCalledTimes(1)
  })

  it("subscribes again whenever its connection is ready again", async () => {
    const onWake = vi.fn(async () => undefined)
    bus.onReady.length = 0
    const stop = startLaneWakeSubscriber(["video-generation"], onWake)
    await flush()
    const before = bus.subscribeCalls
    for (const ready of bus.onReady) ready() // a reconnect
    await flush()
    expect(bus.subscribeCalls).toBe(before + 1)
    stop()
    await flush()
    for (const ready of bus.onReady) ready() // a stopped subscriber stays stopped
    expect(bus.subscribeCalls).toBe(before + 1)
  })

  it("ignores messages that are not wake targets", async () => {
    const onWake = vi.fn(async () => undefined)
    const stop = startLaneWakeSubscriber(["video-generation"], onWake)
    await flush()
    bus.publish("cl:v1:wake", "not json")
    bus.publish("cl:v1:wake", JSON.stringify({ queue: "video-generation" }))
    bus.publish("cl:v1:other", JSON.stringify({ jobId: "x", queue: "video-generation", bullJobId: null }))
    expect(onWake).not.toHaveBeenCalled()
    stop()
  })
})
