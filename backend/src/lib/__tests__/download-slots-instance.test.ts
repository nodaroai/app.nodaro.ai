// The process's download slots follow DOWNLOAD_SLOT_LEDGER (decided 2026-10-08).
import { describe, it, expect, vi, beforeEach } from "vitest"

const fx = vi.hoisted(() => ({
  config: { DOWNLOAD_SLOT_LEDGER: "redis" as string | undefined },
  create: vi.fn(),
}))
vi.mock("../config.js", () => ({ config: fx.config }))
vi.mock("../download-slots-redis.js", () => ({ createDownloadLedger: fx.create }))

import { RedisDownloadLedger } from "../download-slot-ledger.js"
import { makeFakeDownloadClient, makeFakeDownloadStore } from "./fake-download-redis.js"

// The module keeps its ledger between calls (that is the point), so each test gets a fresh copy.
let downloadSlots: typeof import("../download-slots-instance.js").downloadSlots

beforeEach(async () => {
  vi.resetModules()
  ;({ downloadSlots } = await import("../download-slots-instance.js"))
  fx.config.DOWNLOAD_SLOT_LEDGER = "redis"
  fx.create.mockReset()
})

describe("downloadSlots()", () => {
  it("is one instance per process", () => {
    expect(downloadSlots()).toBe(downloadSlots())
  })

  it("redis (the default): the ledger is built on the first slot, not at import, and shared from then on", async () => {
    const client = makeFakeDownloadClient(makeFakeDownloadStore())
    fx.create.mockResolvedValue(new RedisDownloadLedger({ client: () => client }))
    const slots = downloadSlots()
    expect(fx.create).not.toHaveBeenCalled()
    await slots.tryAcquire("u1", 4)
    await slots.tryAcquire("u1", 4)
    expect(fx.create).toHaveBeenCalledTimes(1)
    expect(client.calls).toEqual(["acquire", "acquire"])
  })

  it("local: never builds a Redis client, and still counts", async () => {
    fx.config.DOWNLOAD_SLOT_LEDGER = "local"
    const slots = downloadSlots()
    for (let i = 0; i < 4; i++) expect(await slots.tryAcquire("u1", 4)).not.toBeNull()
    expect(await slots.tryAcquire("u1", 4)).toBeNull()
    expect(fx.create).not.toHaveBeenCalled()
  })

  it("a ledger that cannot be built is an outage (the local cap holds), and the build is not cached", async () => {
    fx.create.mockRejectedValue(new Error("no redis"))
    const slots = downloadSlots()
    for (let i = 0; i < 4; i++) expect(await slots.tryAcquire("u1", 4)).not.toBeNull()
    expect(await slots.tryAcquire("u1", 4)).toBeNull()
    expect(slots.ledgerDown).toBe(true)
    // …so once the breaker lets the next probe through, the build is tried again.
    fx.create.mockClear()
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(Date.now() + 5_001)
    await slots.tryAcquire("u2", 4)
    vi.useRealTimers()
    expect(fx.create).toHaveBeenCalledTimes(1)
  })
})
