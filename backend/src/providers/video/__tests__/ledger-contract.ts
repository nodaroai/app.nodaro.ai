/**
 * The ledger's contract — the semantics `RedisMemoryLedger` promises whatever
 * stores it: run against the JS twin of the scripts (`ffmpeg-memory-ledger.test.ts`)
 * and against a real Redis with the real Lua (`ffmpeg-memory-ledger.redis.test.ts`).
 */
import { describe, it, expect, afterEach } from "vitest"
import { randomUUID } from "node:crypto"
import { RedisMemoryLedger, type LedgerClient } from "../ffmpeg-memory-ledger.js"

export interface LedgerFixture {
  client: () => LedgerClient
  cleanup: (containerIds: string[]) => Promise<void>
}

export function runLedgerContract(makeFixture: () => LedgerFixture): void {
  const BUDGET = 1000
  let clock = 1_000_000
  const used: string[] = []
  let fixture: LedgerFixture

  const ledgerFor = (containerId: string, ttlMs = 30_000): RedisMemoryLedger => {
    used.push(containerId)
    return new RedisMemoryLedger({ client: fixture.client, containerId, now: () => clock, ttlMs })
  }
  const fresh = () => `contract-${randomUUID()}`

  const setup = () => {
    fixture = makeFixture()
    clock = 1_000_000
  }
  afterEach(async () => {
    await fixture?.cleanup(used.splice(0))
  })

  it("reserves what fits and reports the container's total", async () => {
    setup()
    const l = ledgerFor(fresh())
    expect(await l.reserve("a", 400, BUDGET)).toEqual({ reserved: true, totalMiB: 400 })
    expect(await l.reserve("b", 600, BUDGET)).toEqual({ reserved: true, totalMiB: 1000 })
  })

  it("refuses what does not fit, writes nothing, and says what is held", async () => {
    setup()
    const l = ledgerFor(fresh())
    await l.reserve("a", 700, BUDGET)
    expect(await l.reserve("b", 301, BUDGET)).toEqual({ reserved: false, totalMiB: 700 })
    expect(await l.reserve("b", 300, BUDGET)).toEqual({ reserved: true, totalMiB: 1000 }) // b left no trace
  })

  it("a launch bigger than the budget reserves only into an empty container, and then holds it alone", async () => {
    setup()
    const l = ledgerFor(fresh())
    await l.reserve("small", 10, BUDGET)
    expect(await l.reserve("huge", 1500, BUDGET)).toEqual({ reserved: false, totalMiB: 10 })
    await l.release("small")
    expect(await l.reserve("huge", 1500, BUDGET)).toEqual({ reserved: true, totalMiB: 1500 })
    expect(await l.reserve("tiny", 1, BUDGET)).toEqual({ reserved: false, totalMiB: 1500 })
    expect(await l.reserve("huge2", 1500, BUDGET)).toEqual({ reserved: false, totalMiB: 1500 })
    await l.release("huge")
    expect(await l.reserve("tiny", 1, BUDGET)).toEqual({ reserved: true, totalMiB: 1 })
  })

  it("release gives the memory back", async () => {
    setup()
    const l = ledgerFor(fresh())
    await l.reserve("a", 1000, BUDGET)
    expect((await l.reserve("b", 1, BUDGET)).reserved).toBe(false)
    await l.release("a")
    expect((await l.reserve("b", 1000, BUDGET)).reserved).toBe(true)
    await l.release("never-existed") // releasing nothing is fine
  })

  it("a lease expires after its TTL without a heartbeat — the total is summed from LIVE leases", async () => {
    setup()
    const l = ledgerFor(fresh(), 30_000)
    await l.reserve("dead", 900, BUDGET)
    clock += 29_999
    expect((await l.reserve("b", 200, BUDGET)).reserved).toBe(false) // still alive
    clock += 2
    expect(await l.reserve("b", 200, BUDGET)).toEqual({ reserved: true, totalMiB: 200 }) // expired and purged
  })

  it("renew extends a lease, and puts back one that expired", async () => {
    setup()
    const l = ledgerFor(fresh(), 30_000)
    await l.reserve("a", 900, BUDGET)
    clock += 20_000
    await l.renew("a", 900)
    clock += 20_000 // 40 s after the reserve, 20 s after the renew
    expect((await l.reserve("b", 200, BUDGET)).reserved).toBe(false)
    clock += 20_000 // the renewed lease has now expired too
    expect((await l.reserve("b", 200, BUDGET)).reserved).toBe(true)
    await l.renew("a", 900) // upsert: A is counted again although it expired
    expect((await l.reserve("c", 200, BUDGET)).reserved).toBe(false)
  })

  it("different containers have independent budgets", async () => {
    setup()
    const a = ledgerFor(fresh())
    const b = ledgerFor(fresh())
    expect((await a.reserve("x", 1000, BUDGET)).reserved).toBe(true)
    expect((await b.reserve("x", 1000, BUDGET)).reserved).toBe(true)
    expect((await a.reserve("y", 1, BUDGET)).reserved).toBe(false)
  })

  it("two clients of one container see one total", async () => {
    setup()
    const id = fresh()
    const p1 = ledgerFor(id)
    const p2 = ledgerFor(id)
    await p1.reserve("a", 600, BUDGET)
    expect(await p2.reserve("b", 500, BUDGET)).toEqual({ reserved: false, totalMiB: 600 })
    expect((await p2.reserve("b", 400, BUDGET)).reserved).toBe(true)
  })

  it("concurrent reserves never exceed the budget", async () => {
    setup()
    const id = fresh()
    const results = await Promise.all(Array.from({ length: 12 }, (_, k) => ledgerFor(id).reserve(`l${k}`, 300, BUDGET)))
    expect(results.filter((r) => r.reserved)).toHaveLength(3) // 3 × 300 ≤ 1000 < 4 × 300
  })
}

/** `describe` wrapper kept here so both runners name the suite the same way. */
export const ledgerContractSuite = (name: string, makeFixture: () => LedgerFixture): void => {
  describe(name, () => runLedgerContract(makeFixture))
}
