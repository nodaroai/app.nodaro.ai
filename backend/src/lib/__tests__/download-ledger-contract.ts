/**
 * The download-slot ledger's contract — the semantics `RedisDownloadLedger`
 * promises whatever stores it: run against the JS twin of the scripts
 * (`download-slot-ledger.test.ts`) and against a real Redis with the real Lua
 * (`download-slot-ledger.redis.test.ts`).
 */
import { describe, it, expect, afterEach } from "vitest"
import { randomUUID } from "node:crypto"
import { RedisDownloadLedger, type DownloadLedgerClient } from "../download-slot-ledger.js"

export interface DownloadLedgerFixture {
  client: () => DownloadLedgerClient
  cleanup: (userIds: string[]) => Promise<void>
}

export function runDownloadLedgerContract(makeFixture: () => DownloadLedgerFixture): void {
  const CAP = 4
  let clock = 1_000_000
  const used: string[] = []
  let fixture: DownloadLedgerFixture

  const ledger = (ttlMs = 30_000): RedisDownloadLedger =>
    new RedisDownloadLedger({ client: fixture.client, now: () => clock, ttlMs })
  const fresh = () => {
    const id = `contract-${randomUUID()}`
    used.push(id)
    return id
  }
  const setup = () => {
    fixture = makeFixture()
    clock = 1_000_000
  }
  afterEach(async () => {
    await fixture?.cleanup(used.splice(0))
  })

  it("admits up to the cap and reports how many the account holds", async () => {
    setup()
    const l = ledger()
    const u = fresh()
    for (let i = 1; i <= CAP; i++) expect(await l.acquire(u, `lease-${i}`, CAP)).toEqual({ acquired: true, held: i })
  })

  it("refuses one past the cap, writes nothing, and says how many are held", async () => {
    setup()
    const l = ledger()
    const u = fresh()
    for (let i = 1; i <= CAP; i++) await l.acquire(u, `lease-${i}`, CAP)
    expect(await l.acquire(u, "extra", CAP)).toEqual({ acquired: false, held: CAP })
    await l.release(u, "lease-1")
    expect(await l.acquire(u, "extra", CAP)).toEqual({ acquired: true, held: CAP }) // the refused one left no trace
  })

  it("counts per account: one account's downloads never take another's", async () => {
    setup()
    const l = ledger()
    const a = fresh()
    const b = fresh()
    for (let i = 1; i <= CAP; i++) await l.acquire(a, `a-${i}`, CAP)
    expect(await l.acquire(b, "b-1", CAP)).toEqual({ acquired: true, held: 1 })
  })

  it("release gives the slot back; releasing nothing is fine", async () => {
    setup()
    const l = ledger()
    const u = fresh()
    await l.acquire(u, "a", 1)
    expect((await l.acquire(u, "b", 1)).acquired).toBe(false)
    await l.release(u, "a")
    expect((await l.acquire(u, "b", 1)).acquired).toBe(true)
    await l.release(u, "never-existed")
  })

  it("a lease expires after its TTL without a heartbeat — the count is of LIVE leases", async () => {
    setup()
    const l = ledger(30_000)
    const u = fresh()
    await l.acquire(u, "dead", 1)
    clock += 29_999
    expect((await l.acquire(u, "b", 1)).acquired).toBe(false) // still alive
    clock += 2
    expect(await l.acquire(u, "b", 1)).toEqual({ acquired: true, held: 1 }) // expired and purged
  })

  it("renew extends a lease", async () => {
    setup()
    const l = ledger(30_000)
    const u = fresh()
    await l.acquire(u, "a", 1)
    clock += 20_000
    await l.renew(u, "a")
    clock += 20_000 // 40 s after acquire: dead without the renew
    expect((await l.acquire(u, "b", 1)).acquired).toBe(false)
  })

  it("renew puts back a lease that expired while its download kept running", async () => {
    setup()
    const l = ledger(30_000)
    const u = fresh()
    await l.acquire(u, "a", 1)
    clock += 40_000 // expired — but nobody has purged it yet
    await l.renew(u, "a")
    expect((await l.acquire(u, "b", 1)).acquired).toBe(false)
    await l.release(u, "a")
    expect((await l.acquire(u, "b", 1)).acquired).toBe(true)
  })
}
