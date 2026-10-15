/**
 * `claimBatch` — one request at a time per keyed batch: a Redis lease, waited
 * for while another request holds it, null once the wait is over; renewed
 * before every step, and LOST for good once a renewal fails.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const h = vi.hoisted(() => ({
  /** What each acquire answers, in order (a token, or null while held). */
  acquires: [] as Array<string | null>,
  acquireCalls: [] as Array<[string, number, unknown]>,
  /** What each renew answers, in order (then true); an Error is thrown. */
  renews: [] as Array<boolean | Error>,
  renewCalls: 0,
  released: [] as Array<[string, string]>,
  duplicateOpts: [] as unknown[],
}))

vi.mock("../queue.js", () => ({
  redis: {
    duplicate: (opts: unknown) => {
      h.duplicateOpts.push(opts)
      return { status: "ready", on: () => undefined, off: () => undefined, once: () => undefined }
    },
  },
}))
vi.mock("../redis-lease.js", () => ({
  acquireLease: vi.fn(async (key: string, ttl: number, client: unknown) => {
    h.acquireCalls.push([key, ttl, client])
    return h.acquires.shift() ?? null
  }),
  renewLease: vi.fn(async () => {
    h.renewCalls++
    const next = h.renews.shift() ?? true
    if (next instanceof Error) throw next
    return next
  }),
  releaseLease: vi.fn(async (key: string, token: string) => {
    h.released.push([key, token])
    return true
  }),
}))

import { BATCH_CLAIM_TTL_MS, batchClaimKey, claimBatch } from "../job-batch-claim.js"

const noSleep = async () => {}
const client = { set: vi.fn(), eval: vi.fn() } as never

beforeEach(() => {
  h.acquires = []
  h.acquireCalls.length = 0
  h.renews = []
  h.renewCalls = 0
  h.released.length = 0
})

describe("batchClaimKey", () => {
  it("is per caller and per key, and never carries the key's own text", () => {
    const a = batchClaimKey("user-1", "client-key-1")
    expect(a).toMatch(/^job-batch:[0-9a-f]{64}$/)
    expect(batchClaimKey("user-1", "client-key-1")).toBe(a)
    expect(batchClaimKey("user-2", "client-key-1")).not.toBe(a)
    expect(batchClaimKey("user-1", "client-key-2")).not.toBe(a)
  })
})

describe("claimBatch", () => {
  it("takes the lease at once and gives it back with its token", async () => {
    h.acquires = ["tok-1"]
    const claim = await claimBatch("job-batch:k", { client })
    expect(h.acquireCalls).toEqual([["job-batch:k", BATCH_CLAIM_TTL_MS, client]])
    await claim!.release()
    expect(h.released).toEqual([["job-batch:k", "tok-1"]])
  })

  it("waits while another request holds it", async () => {
    h.acquires = [null, null, "tok-2"]
    const claim = await claimBatch("job-batch:k", { waitMs: 1_000, pollMs: 250, sleep: noSleep, client })
    expect(claim).not.toBeNull()
    expect(h.acquireCalls).toHaveLength(3)
    await claim!.release()
  })

  it("null once the wait is over", async () => {
    const claim = await claimBatch("job-batch:k", { waitMs: 500, pollMs: 250, sleep: noSleep, client })
    expect(claim).toBeNull()
    expect(h.acquireCalls).toHaveLength(3)
  })

  it("throws when Redis cannot answer", async () => {
    const { acquireLease } = await import("../redis-lease.js")
    vi.mocked(acquireLease).mockRejectedValueOnce(new Error("redis down"))
    await expect(claimBatch("job-batch:k", { client })).rejects.toThrow("redis down")
  })
})

describe("renewal", () => {
  it("true while the lease is still this request's", async () => {
    h.acquires = ["tok-1"]
    const claim = (await claimBatch("job-batch:k", { client }))!
    expect(await claim.renew()).toBe(true)
    expect(await claim.renew()).toBe(true)
    await claim.release()
  })

  it("a lapsed lease is lost for good: every later renewal is false, and it is not released", async () => {
    h.acquires = ["tok-1"]
    h.renews = [false]
    const claim = (await claimBatch("job-batch:k", { client }))!
    expect(await claim.renew()).toBe(false)
    expect(await claim.renew()).toBe(false)
    expect(h.renewCalls).toBe(1)
    await claim.release()
    // Another request may hold it now: a lost claim is never deleted.
    expect(h.released).toEqual([])
  })

  it("a renewal Redis cannot answer counts as lost (unconfirmed is not held)", async () => {
    h.acquires = ["tok-1"]
    h.renews = [new Error("timeout")]
    const claim = (await claimBatch("job-batch:k", { client }))!
    expect(await claim.renew()).toBe(false)
    await claim.release()
  })

  it("the heartbeat renews between steps, and stops once released", async () => {
    vi.useFakeTimers()
    try {
      h.acquires = ["tok-1"]
      const claim = (await claimBatch("job-batch:k", { client, heartbeatMs: 1_000 }))!
      await vi.advanceTimersByTimeAsync(3_000)
      expect(h.renewCalls).toBe(3)
      await claim.release()
      await vi.advanceTimersByTimeAsync(3_000)
      expect(h.renewCalls).toBe(3)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe("its own connection", () => {
  it("fails fast while Redis is down instead of queueing commands like the BullMQ connection", async () => {
    h.acquires = ["tok-1"]
    const claim = await claimBatch("job-batch:k")
    await claim!.release()
    expect(h.duplicateOpts).toEqual([{ maxRetriesPerRequest: 1, enableOfflineQueue: false, commandTimeout: 2_000 }])
  })
})
