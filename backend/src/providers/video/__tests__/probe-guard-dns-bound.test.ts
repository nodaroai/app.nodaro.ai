// @test-reads-none a stubbed resolver; reads no file
/**
 * Every lookup the probe guard makes — the first hop and each hop its proxy
 * sees — goes through one scheduler, because `dns.lookup` runs in the
 * process's libuv threadpool and cannot be cancelled:
 *
 * - one host is resolved once at a time: concurrent lookups of it share one
 *   call, so a host whose resolver never answers holds at most one slot;
 * - at most `maxActiveLookups` calls run within their time, across all hosts;
 * - a call past `lookupTimeoutMs` stops counting against that bound (it is
 *   abandoned, and its callers are refused as `dns`, retryable), while at most
 *   `maxAbandonedLookups` abandoned calls may still hold a pool thread — past
 *   that cap an overdue call keeps its slot, so the pool stays safe;
 * - a later lookup of a host whose call is overdue fails fast as `dns`;
 * - an allowed answer is reused for `answerCacheMs`.
 *
 * So one account naming hosts that never answer cannot refuse everyone
 * else's probes: the test that matters is "two hosts hang, a third resolves at
 * once".
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { checkProbeHost, guardLookupCaps, libuvPoolSize, probeLookupLoad, probeNetwork, type ProbeAddress } from "../probe-guard.js"

const saved = {
  timeout: probeNetwork.lookupTimeoutMs,
  active: probeNetwork.maxActiveLookups,
  abandoned: probeNetwork.maxAbandonedLookups,
  cache: probeNetwork.answerCacheMs,
}
const PUBLIC = [{ address: "93.184.216.34", family: 4 }]
/** Lookups the stub was asked for; a host named `hang-…` never answers until the test lets it. */
let calls: Array<{ host: string; answer: () => void; fail: (code: string) => void }>

beforeEach(() => {
  calls = []
  probeNetwork.lookupTimeoutMs = 200
  // The image's pool (UV_THREADPOOL_SIZE=16): 3 active, 1 abandoned.
  Object.assign(probeNetwork, guardLookupCaps(16))
  probeNetwork.answerCacheMs = 0
  vi.spyOn(probeNetwork, "lookup").mockImplementation((host: string) => new Promise<ProbeAddress[]>((resolve, reject) => {
    const call = { host, answer: () => resolve(PUBLIC), fail: (code: string) => reject(Object.assign(new Error(code), { code })) }
    calls.push(call)
    // `slow…` answers after 100 ms (within its own time); anything else at once.
    if (!host.startsWith("hang-")) setTimeout(call.answer, host.startsWith("slow") ? 100 : 5)
  }))
})

afterEach(async () => {
  for (const c of calls) c.answer()
  await new Promise((resolve) => setTimeout(resolve, 10))
  Object.assign(probeNetwork, { lookupTimeoutMs: saved.timeout, maxActiveLookups: saved.active, maxAbandonedLookups: saved.abandoned, answerCacheMs: saved.cache })
  vi.restoreAllMocks()
})

const tick = (ms = 10) => new Promise((resolve) => setTimeout(resolve, ms))
const reasonOf = (p: Promise<unknown>) => p.then(() => "resolved", (e: unknown) => (e as { reason?: unknown }).reason)

describe("the probe guard's lookup scheduler", () => {
  it("two hosts that never answer do not hold up a third: it resolves at once", async () => {
    const hung = [reasonOf(checkProbeHost("hang-a.evil.test")), reasonOf(checkProbeHost("hang-b.evil.test"))]
    await tick()
    const started = Date.now()
    await expect(checkProbeHost("cdn.example")).resolves.toEqual(PUBLIC)
    expect(Date.now() - started).toBeLessThan(100)
    expect(await Promise.all(hung)).toEqual(["dns", "dns"])
  })

  it("one host is looked up once at a time: concurrent lookups share one call, so it holds one slot", async () => {
    const same = Array.from({ length: 5 }, () => reasonOf(checkProbeHost("hang-x.evil.test")))
    await tick()
    expect(calls.filter((c) => c.host === "hang-x.evil.test")).toHaveLength(1)
    expect(probeLookupLoad()).toEqual({ active: 1, abandoned: 0, waiting: 0 })
    // Others still get the remaining slots.
    await expect(checkProbeHost("cdn.example")).resolves.toEqual(PUBLIC)
    expect(await Promise.all(same)).toEqual(Array(5).fill("dns"))
  })

  it("past its time a call stops counting against the shared bound (abandoned), and a new lookup of that host fails fast", async () => {
    const first = reasonOf(checkProbeHost("hang-a.evil.test"))
    expect(await first).toBe("dns")
    await tick() // the lookup's own timer, which started a moment after its caller's
    expect(probeLookupLoad()).toEqual({ active: 0, abandoned: 1, waiting: 0 })
    const started = Date.now()
    expect(await reasonOf(checkProbeHost("hang-a.evil.test"))).toBe("dns")
    expect(Date.now() - started).toBeLessThan(50)
    expect(calls.filter((c) => c.host === "hang-a.evil.test")).toHaveLength(1)
  })

  it("abandoned calls are capped: past the cap an overdue call keeps its slot, so the guard never holds more than active + abandoned pool threads", async () => {
    // Three hosts that never answer fill the slots; past their time one is abandoned (the cap), two keep their slots.
    expect(await Promise.all(["hang-1.test", "hang-2.test", "hang-3.test"].map((h) => reasonOf(checkProbeHost(h))))).toEqual(["dns", "dns", "dns"])
    await tick()
    expect(probeLookupLoad()).toEqual({ active: 2, abandoned: 1, waiting: 0 })
    // A fourth takes the free slot, and keeps it past its time too: the abandoned cap is full.
    expect(await reasonOf(checkProbeHost("hang-4.test"))).toBe("dns")
    await tick()
    expect(probeLookupLoad()).toEqual({ active: 3, abandoned: 1, waiting: 0 })
    // Now a good host waits and is refused (retryable) rather than start a fifth pool thread.
    expect(await reasonOf(checkProbeHost("cdn.example"))).toBe("dns")
    expect(calls).toHaveLength(probeNetwork.maxActiveLookups + probeNetwork.maxAbandonedLookups)
    // When the abandoned call finally answers, an overdue one takes its place, and a slot frees.
    calls[0]!.answer()
    await tick()
    expect(probeLookupLoad()).toEqual({ active: 2, abandoned: 1, waiting: 0 })
    await expect(checkProbeHost("cdn.example")).resolves.toEqual(PUBLIC)
  })

  it("the resolver's own answer still decides between a host that does not exist (for good) and one that failed (retryable)", async () => {
    const missing = reasonOf(checkProbeHost("hang-missing.test"))
    const flaky = reasonOf(checkProbeHost("hang-flaky.test"))
    await tick()
    calls[0]!.fail("ENOTFOUND")
    calls[1]!.fail("EAI_AGAIN")
    expect([await missing, await flaky]).toEqual(["host", "dns"])
  })

  it("an allowed answer is reused for a while; a refused one never is", async () => {
    probeNetwork.answerCacheMs = 60_000
    await checkProbeHost("cdn.example")
    await checkProbeHost("cdn.example")
    expect(calls.filter((c) => c.host === "cdn.example")).toHaveLength(1)
    vi.mocked(probeNetwork.lookup).mockResolvedValue([{ address: "10.0.0.7", family: 4 }])
    expect(await reasonOf(checkProbeHost("intranet.example"))).toBe("address")
    expect(await reasonOf(checkProbeHost("intranet.example"))).toBe("address")
    expect(vi.mocked(probeNetwork.lookup).mock.calls.filter(([h]) => h === "intranet.example")).toHaveLength(2)
  })

  it("the caps follow the threadpool: never more than a quarter of it, active and abandoned together", () => {
    expect(guardLookupCaps(16)).toEqual({ maxActiveLookups: 3, maxAbandonedLookups: 1 })
    expect(guardLookupCaps(4)).toEqual({ maxActiveLookups: 1, maxAbandonedLookups: 0 })
    for (const pool of [1, 2, 4, 8, 16, 32, 64, 128]) {
      const caps = guardLookupCaps(pool)
      expect(caps.maxActiveLookups).toBeGreaterThanOrEqual(1)
      expect(caps.maxActiveLookups + caps.maxAbandonedLookups).toBeLessThanOrEqual(Math.max(1, Math.floor(pool / 4)))
    }
    // The pool's size as libuv reads it at start.
    expect(libuvPoolSize({})).toBe(4)
    expect(libuvPoolSize({ UV_THREADPOOL_SIZE: "16" })).toBe(16)
    expect(libuvPoolSize({ UV_THREADPOOL_SIZE: "0" })).toBe(1)
    expect(libuvPoolSize({ UV_THREADPOOL_SIZE: "4096" })).toBe(1024)
  })

  it("with Node's default pool (4 threads) the guard holds one thread at most, however many hosts hang", async () => {
    Object.assign(probeNetwork, guardLookupCaps(4))
    const hung = ["hang-1.test", "hang-2.test", "hang-3.test"].map((h) => reasonOf(checkProbeHost(h)))
    await tick()
    expect(calls).toHaveLength(1)
    expect(await Promise.all(hung)).toEqual(["dns", "dns", "dns"])
    // Nothing can be abandoned: the overdue lookup keeps the slot, so a good host waits and is refused (retryable) too.
    expect(probeLookupLoad()).toEqual({ active: 1, abandoned: 0, waiting: 0 })
    expect(await reasonOf(checkProbeHost("cdn.example"))).toBe("dns")
    expect(calls).toHaveLength(1)
    // Once that resolver answers, the slot is free again.
    calls[0]!.answer()
    await tick()
    await expect(checkProbeHost("cdn.example")).resolves.toEqual(PUBLIC)
  })

  it("a reused answer is checked again: once the address rule refuses it, or reuse is off, it is looked up afresh", async () => {
    probeNetwork.answerCacheMs = 60_000
    await expect(checkProbeHost("rule.example")).resolves.toEqual(PUBLIC)
    // A rule that now refuses the cached address (a future allow-list, a test's swapped rule): not reused.
    vi.spyOn(probeNetwork, "isRefusedAddress").mockImplementation((ip) => ip === PUBLIC[0]!.address)
    expect(await reasonOf(checkProbeHost("rule.example"))).toBe("address")
    expect(calls.filter((c) => c.host === "rule.example")).toHaveLength(2)
    // With reuse off, a fresh answer is asked for every time.
    vi.mocked(probeNetwork.isRefusedAddress).mockReturnValue(false)
    await checkProbeHost("rule.example")
    probeNetwork.answerCacheMs = 0
    await checkProbeHost("rule.example")
    expect(calls.filter((c) => c.host === "rule.example")).toHaveLength(4)
  })

  it("a caller that ran out of time waiting for a slot does not cut short the lookup it then started", async () => {
    Object.assign(probeNetwork, guardLookupCaps(4)) // one slot
    const holder = reasonOf(checkProbeHost("hang-holder.test"))
    await tick()
    // A second host waits for the slot; the holder answers at 150 ms, so the waiter's lookup starts with 50 ms of its caller's 200 left.
    const waiter = reasonOf(checkProbeHost("slow.example"))
    await tick(150)
    calls[0]!.answer()
    // The waiter's caller runs out of time (at 200 ms) while its lookup, 100 ms long, is still well within its own time.
    expect(await waiter).toBe("dns")
    expect(probeLookupLoad()).toEqual({ active: 1, abandoned: 0, waiting: 0 })
    // A new caller of that host joins the running lookup rather than failing fast, and gets its answer.
    await expect(checkProbeHost("slow.example")).resolves.toEqual(PUBLIC)
    expect(calls.filter((c) => c.host === "slow.example")).toHaveLength(1)
    expect(await holder).toBe("resolved")
  })
})
