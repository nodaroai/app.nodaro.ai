// The account's download slots across processes (decided 2026-10-08): two
// `DownloadSlots` over one store stand for the API process and the orchestrator
// process. Lease expiry is driven by an injected clock, heartbeats by fake timers.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { DownloadSlots } from "../download-slots.js"
import { RedisDownloadLedger } from "../download-slot-ledger.js"
import { downloadLeasesOf, makeFakeDownloadClient, makeFakeDownloadStore, type FakeDownloadClient } from "./fake-download-redis.js"

const CAP = 4
let clock = 5_000_000

function setup(opts: { commandTimeoutMs?: number } = {}) {
  const store = makeFakeDownloadStore()
  const client: FakeDownloadClient = makeFakeDownloadClient(store)
  const ledger = new RedisDownloadLedger({ client: () => client, now: () => clock, commandTimeoutMs: opts.commandTimeoutMs ?? 50 })
  const logs: string[] = []
  /** One "process": its own held leases and breaker, the same ledger as every other. */
  const process_ = (over: Partial<ConstructorParameters<typeof DownloadSlots>[0]> = {}) =>
    new DownloadSlots({ ledger: async () => ledger, now: () => clock, log: (m) => logs.push(m), ...over })
  return { store, client, ledger, logs, process_ }
}

beforeEach(() => {
  clock = 5_000_000
})
afterEach(() => {
  vi.useRealTimers()
})

describe("one counter across processes", () => {
  it("admits up to the cap and refuses the next; a release frees a slot", async () => {
    const { process_ } = setup()
    const p = process_()
    const slots = []
    for (let i = 0; i < CAP; i++) slots.push(await p.tryAcquire("u1", CAP))
    expect(slots.every((s) => s !== null)).toBe(true)
    expect(await p.tryAcquire("u1", CAP)).toBeNull()
    slots[0]!.release()
    expect(await p.tryAcquire("u1", CAP)).not.toBeNull()
  })

  it("the API process and the orchestrator process share the cap: 3 here + 1 there is the whole of it", async () => {
    const { process_ } = setup()
    const api = process_()
    const orchestrator = process_()
    for (let i = 0; i < 3; i++) expect(await api.tryAcquire("u1", CAP)).not.toBeNull()
    expect(await orchestrator.tryAcquire("u1", CAP)).not.toBeNull()
    expect(await orchestrator.tryAcquire("u1", CAP)).toBeNull()
    expect(await api.tryAcquire("u1", CAP)).toBeNull()
  })

  it("a slot another process frees is usable at once", async () => {
    const { process_ } = setup()
    const api = process_()
    const orchestrator = process_()
    const held = []
    for (let i = 0; i < CAP; i++) held.push(await api.tryAcquire("u1", CAP))
    expect(await orchestrator.tryAcquire("u1", CAP)).toBeNull()
    held[0]!.release()
    await vi.waitFor(async () => expect(await orchestrator.tryAcquire("u1", CAP)).not.toBeNull())
  })

  it("counts per account", async () => {
    const { process_ } = setup()
    const p = process_()
    for (let i = 0; i < CAP; i++) await p.tryAcquire("u1", CAP)
    expect(await p.tryAcquire("u2", CAP)).not.toBeNull()
  })

  it("release is idempotent and leaves the ledger empty", async () => {
    const { process_, store } = setup()
    const p = process_()
    const slot = (await p.tryAcquire("u1", CAP))!
    expect(downloadLeasesOf(store, "u1")).toHaveLength(1)
    slot.release()
    slot.release()
    await vi.waitFor(() => expect(downloadLeasesOf(store, "u1")).toHaveLength(0))
    expect(p.heldBy("u1")).toBe(0)
  })
})

describe("a lease is a heartbeat, not a counter", () => {
  it("a slot held for longer than the TTL stays held: the holder renews it", async () => {
    vi.useFakeTimers()
    const { process_ } = setup()
    const a = process_({ heartbeatMs: 10_000 })
    const b = process_()
    for (let i = 0; i < CAP; i++) await a.tryAcquire("u1", CAP)
    for (let t = 0; t < 6; t++) {
      clock += 10_000
      await vi.advanceTimersByTimeAsync(10_000)
    }
    expect(await b.tryAcquire("u1", CAP)).toBeNull() // 60 s later, twice the TTL
  })

  it("a process that dies stops renewing, and its slots free themselves within a TTL", async () => {
    const { process_, store } = setup()
    const dying = process_({ heartbeatMs: 1_000_000 }) // never beats in the test: a dead process
    const other = process_()
    for (let i = 0; i < CAP; i++) await dying.tryAcquire("u1", CAP)
    expect(await other.tryAcquire("u1", CAP)).toBeNull()
    clock += 30_001
    expect(await other.tryAcquire("u1", CAP)).not.toBeNull()
    expect(downloadLeasesOf(store, "u1")).toHaveLength(1)
  })

  it("a slot held longer than the hold ceiling is dropped, so a stuck download cannot keep an account's slot alive for ever", async () => {
    vi.useFakeTimers()
    const { process_ } = setup()
    const a = process_({ heartbeatMs: 10_000, maxHoldMs: 60_000 })
    const b = process_()
    for (let i = 0; i < CAP; i++) await a.tryAcquire("u1", CAP)
    for (let t = 0; t < 8; t++) {
      clock += 10_000
      await vi.advanceTimersByTimeAsync(10_000)
    }
    expect(a.heldBy("u1")).toBe(0)
    clock += 30_001
    expect(await b.tryAcquire("u1", CAP)).not.toBeNull()
  })
})

describe("Redis unavailable: the local cap holds, and it fails safe", () => {
  it("an erroring Redis falls back to the process's own count — still refusing the fifth", async () => {
    const { process_, client, logs } = setup()
    client.down = true
    const p = process_()
    for (let i = 0; i < CAP; i++) expect(await p.tryAcquire("u1", CAP)).not.toBeNull()
    expect(await p.tryAcquire("u1", CAP)).toBeNull()
    expect(logs.length).toBe(1) // logged once per outage
    expect(logs[0]).toMatch(/download/i)
  })

  it("an unanswered Redis (no reply in time) falls back too, and does not hang the download", async () => {
    const { process_, client } = setup({ commandTimeoutMs: 20 })
    client.hang = true
    const p = process_()
    expect(await p.tryAcquire("u1", CAP)).not.toBeNull()
  })

  it("a ledger that cannot be built at all is the same outage", async () => {
    const { process_ } = setup()
    const p = process_({
      ledger: async () => {
        throw new Error("no redis client")
      },
    })
    for (let i = 0; i < CAP; i++) expect(await p.tryAcquire("u1", CAP)).not.toBeNull()
    expect(await p.tryAcquire("u1", CAP)).toBeNull()
  })

  it("concurrent callers during an outage cannot jointly exceed the local cap", async () => {
    const { process_, client } = setup()
    client.down = true
    const p = process_()
    const results = await Promise.all(Array.from({ length: 10 }, () => p.tryAcquire("u1", CAP)))
    expect(results.filter((r) => r !== null)).toHaveLength(CAP)
  })

  it("while Redis is down it is not asked again for a few seconds (the breaker), then it is", async () => {
    const { process_, client } = setup()
    client.down = true
    const p = process_({ outageProbeMs: 5_000 })
    await p.tryAcquire("u1", CAP)
    const calls = client.calls.length
    await p.tryAcquire("u1", CAP)
    expect(client.calls.length).toBe(calls)
    clock += 5_001
    await p.tryAcquire("u1", CAP)
    expect(client.calls.length).toBeGreaterThan(calls)
  })

  it("slots taken during the outage are put into the ledger once Redis answers, so the other process sees them", async () => {
    const { process_, client, store } = setup()
    const api = process_({ outageProbeMs: 1_000 })
    const orchestrator = process_()
    client.down = true
    await api.tryAcquire("u1", CAP)
    await api.tryAcquire("u1", CAP)
    client.down = false
    clock += 1_001
    expect(await api.tryAcquire("u1", CAP)).not.toBeNull() // registers the two, then takes a third
    expect(downloadLeasesOf(store, "u1")).toHaveLength(3)
    expect(await orchestrator.tryAcquire("u1", CAP)).not.toBeNull() // the fourth
    expect(await orchestrator.tryAcquire("u1", CAP)).toBeNull()
  })

  it("a slot held locally never double counts: the process's own count is a floor on the cap in either mode", async () => {
    const { process_, client } = setup()
    const p = process_({ outageProbeMs: 1_000 })
    client.down = true
    for (let i = 0; i < CAP; i++) await p.tryAcquire("u1", CAP)
    client.down = false
    clock += 1_001
    expect(await p.tryAcquire("u1", CAP)).toBeNull()
  })

  it("no lease leaks when an acquire times out and lands late: it is given back", async () => {
    const { process_, client, store } = setup({ commandTimeoutMs: 10 })
    client.delayMs = 40 // answers after the command timeout, but takes effect
    const p = process_()
    await p.tryAcquire("u1", 1) // falls back locally, and takes the late lease back
    await new Promise((r) => setTimeout(r, 120))
    client.delayMs = 0
    expect(downloadLeasesOf(store, "u1")).toHaveLength(0) // no orphan from the late acquire
  })
})
