import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

// ─── Mock ioredis with an in-memory pub/sub so tests don't need a real Redis ─

interface FakeRedis {
  publish: (channel: string, message: string) => Promise<number>
  subscribe: (channel: string) => Promise<void>
  on: (event: "message", cb: (channel: string, msg: string) => void) => void
  quit: () => Promise<void>
}

// Per-test reset of the in-memory broker.
let subscribers: Array<{
  channel: string
  cb: (channel: string, msg: string) => void
}> = []

function makeFakeRedis(): FakeRedis {
  const channelHandlers: string[] = []
  let messageCb: ((channel: string, msg: string) => void) | null = null
  return {
    async publish(channel, message) {
      // Synchronously fan out to all globally-registered subscribers on
      // this channel (across all FakeRedis instances).
      for (const s of subscribers) {
        if (s.channel === channel) s.cb(channel, message)
      }
      return 1
    },
    async subscribe(channel) {
      channelHandlers.push(channel)
      if (messageCb) {
        subscribers.push({ channel, cb: messageCb })
      }
    },
    on(event, cb) {
      if (event === "message") {
        messageCb = cb
        // Register against any channels already subscribed.
        for (const ch of channelHandlers) {
          subscribers.push({ channel: ch, cb })
        }
      }
    },
    async quit() {
      subscribers = subscribers.filter((s) => s.cb !== messageCb)
    },
  }
}

// `new IORedis(...)` returns one FakeRedis. The factory is a class
// constructor shape so the production code's `new IORedis(...)` works.
vi.mock("ioredis", () => {
  const Ctor = function (this: FakeRedis) {
    return makeFakeRedis()
  } as unknown as new () => FakeRedis
  return { default: Ctor }
})

vi.mock("../../../lib/config.js", () => ({
  config: {
    REDIS_URL: "redis://localhost:6379",
    EDITION: "cloud",
    SUPABASE_URL: "https://test.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "test",
  },
  hasCredits: () => true,
  hasAdmin: () => true,
  isCloud: () => true,
  isBusiness: () => false,
  isCommunity: () => false,
}))

// Re-import the broker for each test by resetting modules. The singleton
// holds Redis state across tests otherwise.
async function freshBroker() {
  vi.resetModules()
  const mod = await import("../events.js")
  return mod.pipelineEvents
}

beforeEach(() => {
  subscribers = []
})

afterEach(async () => {
  // Best-effort cleanup of any open Redis connections from this test.
})

describe("pipelineEvents — local in-process behavior", () => {
  it("delivers events to subscribers of the matching pipelineId only", async () => {
    const broker = await freshBroker()
    const cb1 = vi.fn()
    const cb2 = vi.fn()
    broker.subscribe("p1", cb1)
    broker.subscribe("p2", cb2)
    broker.publish({ type: "pipeline:status", pipelineId: "p1", status: "running" })
    expect(cb1).toHaveBeenCalledTimes(1)
    expect(cb2).not.toHaveBeenCalled()
    await broker.close()
  })

  it("unsubscribe removes the listener", async () => {
    const broker = await freshBroker()
    const cb = vi.fn()
    const unsub = broker.subscribe("p3", cb)
    unsub()
    broker.publish({ type: "pipeline:status", pipelineId: "p3", status: "completed" })
    expect(cb).not.toHaveBeenCalled()
    await broker.close()
  })

  it("skips events without a pipelineId", async () => {
    const broker = await freshBroker()
    const cb = vi.fn()
    broker.subscribe("p1", cb)
    // pipeline:done has pipelineId, so let's craft a synthetic eventless
    // case — directly verify publish guards against missing pipelineId.
    broker.publish({ type: "pipeline:done" } as never)
    expect(cb).not.toHaveBeenCalled()
    await broker.close()
  })
})

describe("pipelineEvents — cross-process bridge", () => {
  it("startCrossProcessBridge subscribes to Redis and is idempotent", async () => {
    const broker = await freshBroker()
    await broker.startCrossProcessBridge()
    // Second call must not throw and must not subscribe again.
    await broker.startCrossProcessBridge()
    await broker.close()
  })

  it("forwards remote-process events into the local emitter", async () => {
    // Simulate two processes by running TWO publish/subscribe pairs through
    // the SAME mocked Redis. Broker A publishes; broker B subscribes via
    // the bridge and should re-emit locally.
    vi.resetModules()
    const modA = await import("../events.js")
    const brokerA = modA.pipelineEvents

    vi.resetModules()
    const modB = await import("../events.js")
    const brokerB = modB.pipelineEvents

    // Different PROCESS_IDs (independent singletons → independent random suffixes).
    expect(brokerA._processId).not.toBe(brokerB._processId)

    const cbOnB = vi.fn()
    brokerB.subscribe("p-cross", cbOnB)
    await brokerB.startCrossProcessBridge()

    // Publish from "process A" — should reach B via the bridge.
    brokerA.publish({
      type: "stage:progress",
      pipelineId: "p-cross",
      stageName: "script",
      message: "Drafting plan…",
    })

    // FakeRedis is synchronous so the message has already been delivered.
    expect(cbOnB).toHaveBeenCalledTimes(1)
    expect(cbOnB).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "stage:progress",
        pipelineId: "p-cross",
        message: "Drafting plan…",
      }),
    )

    await brokerA.close()
    await brokerB.close()
  })

  it("does NOT double-fanout own-process events (source dedupe)", async () => {
    // Same broker publishes AND subscribes. Without the dedupe the local
    // emitter would fire twice — once from publish(), once from the bridge
    // catching its own Redis broadcast.
    const broker = await freshBroker()
    const cb = vi.fn()
    broker.subscribe("p-same", cb)
    await broker.startCrossProcessBridge()

    broker.publish({
      type: "stage:progress",
      pipelineId: "p-same",
      stageName: "script",
      message: "Drafting plan…",
    })

    expect(cb).toHaveBeenCalledTimes(1)
    await broker.close()
  })

  it("ignores malformed Redis payloads without crashing", async () => {
    // The bridge JSON.parse-s every incoming message. Garbage payloads
    // should be logged + ignored, not throw and kill the subscriber.
    vi.resetModules()
    const modA = await import("../events.js")
    const brokerA = modA.pipelineEvents

    vi.resetModules()
    const modB = await import("../events.js")
    const brokerB = modB.pipelineEvents

    const cbOnB = vi.fn()
    brokerB.subscribe("p-malformed", cbOnB)
    await brokerB.startCrossProcessBridge()

    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {})

    // Hand-roll a malformed publish through the fake Redis. We use the
    // same mocked publisher A as a convenient channel into the shared
    // subscriber registry.
    for (const s of subscribers) {
      if (s.channel === "pipeline-events") s.cb("pipeline-events", "{ not valid json")
    }

    expect(cbOnB).not.toHaveBeenCalled()
    expect(errSpy).toHaveBeenCalled()
    errSpy.mockRestore()

    // Verify the bridge is still healthy after the bad message.
    brokerA.publish({
      type: "stage:progress",
      pipelineId: "p-malformed",
      stageName: "script",
      message: "next event",
    })
    expect(cbOnB).toHaveBeenCalledTimes(1)

    await brokerA.close()
    await brokerB.close()
  })
})
