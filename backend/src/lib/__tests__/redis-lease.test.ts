/**
 * Redis leases — single-holder ownership across processes and replicas.
 *
 * An in-memory stand-in for the two ioredis calls the module makes: `SET … PX
 * … NX` and `EVAL` of the compare-and-extend / compare-and-delete scripts. The
 * fake interprets each script by what it does (pexpire vs del), so these cases
 * pin OUR semantics — owner-only renew and release — while Redis itself owns
 * the atomicity.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const { store } = vi.hoisted(() => ({
  store: new Map<string, { value: string; ttlMs: number }>(),
}))

vi.mock("../queue.js", () => ({
  redis: {
    set: vi.fn(async (key: string, value: string, px: string, ttlMs: number, nx: string) => {
      if (px !== "PX" || nx !== "NX") throw new Error(`unexpected SET flags ${px} ${nx}`)
      if (store.has(key)) return null
      store.set(key, { value, ttlMs })
      return "OK"
    }),
    eval: vi.fn(async (script: string, numKeys: number, key: string, token: string, ttlMs?: string) => {
      if (numKeys !== 1) throw new Error("one key per script")
      const held = store.get(key)
      if (!held || held.value !== token) return 0
      if (script.includes("pexpire")) {
        store.set(key, { value: token, ttlMs: Number(ttlMs) })
        return 1
      }
      if (script.includes("del")) {
        store.delete(key)
        return 1
      }
      throw new Error("unknown script")
    }),
  },
}))

import { acquireLease, renewLease, releaseLease, LEASE_KEY_PREFIX } from "../redis-lease.js"

beforeEach(() => {
  store.clear()
})

describe("acquireLease", () => {
  it("hands out an owner token when the lease is free", async () => {
    const token = await acquireLease("acct:1", 90_000)
    expect(token).toMatch(/^[0-9a-f]{32}$/)
    expect(store.get(`${LEASE_KEY_PREFIX}acct:1`)).toEqual({ value: token, ttlMs: 90_000 })
  })

  it("answers null while someone else holds it", async () => {
    await acquireLease("acct:1", 90_000)
    expect(await acquireLease("acct:1", 90_000)).toBeNull()
  })

  it("namespaces the key, so a plugin key can never land on an app key", async () => {
    await acquireLease("social:lock:conn:x", 90_000)
    expect(store.has("social:lock:conn:x")).toBe(false)
    expect(store.has(`${LEASE_KEY_PREFIX}social:lock:conn:x`)).toBe(true)
  })

  it("refuses a malformed key or ttl instead of writing it", async () => {
    await expect(acquireLease("", 90_000)).rejects.toThrow(/key/)
    await expect(acquireLease("x".repeat(201), 90_000)).rejects.toThrow(/key/)
    await expect(acquireLease("acct:1", 999)).rejects.toThrow(/ttl/i)
    await expect(acquireLease("acct:1", 1500.5)).rejects.toThrow(/ttl/i)
    await expect(acquireLease("acct:1", 24 * 60 * 60 * 1000 + 1)).rejects.toThrow(/ttl/i)
    expect(store.size).toBe(0)
  })
})

describe("renewLease", () => {
  it("extends the lease for its owner", async () => {
    const token = (await acquireLease("acct:1", 90_000))!
    expect(await renewLease("acct:1", token, 120_000)).toBe(true)
    expect(store.get(`${LEASE_KEY_PREFIX}acct:1`)?.ttlMs).toBe(120_000)
  })

  it("refuses a token that does not own the lease", async () => {
    await acquireLease("acct:1", 90_000)
    expect(await renewLease("acct:1", "not-the-owner", 90_000)).toBe(false)
  })

  it("refuses once the lease expired, even for the old owner", async () => {
    const token = (await acquireLease("acct:1", 90_000))!
    store.delete(`${LEASE_KEY_PREFIX}acct:1`) // expired
    expect(await renewLease("acct:1", token, 90_000)).toBe(false)
  })
})

describe("releaseLease", () => {
  it("deletes the lease for its owner", async () => {
    const token = (await acquireLease("acct:1", 90_000))!
    expect(await releaseLease("acct:1", token)).toBe(true)
    expect(store.size).toBe(0)
  })

  it("leaves someone else's lease alone", async () => {
    await acquireLease("acct:1", 90_000)
    expect(await releaseLease("acct:1", "not-the-owner")).toBe(false)
    expect(store.size).toBe(1)
  })

  it("a holder whose lease expired and was taken over can neither extend nor release the new one", async () => {
    const stale = (await acquireLease("acct:1", 90_000))!
    store.delete(`${LEASE_KEY_PREFIX}acct:1`) // expired
    const fresh = (await acquireLease("acct:1", 90_000))!

    expect(await renewLease("acct:1", stale, 90_000)).toBe(false)
    expect(await releaseLease("acct:1", stale)).toBe(false)
    expect(store.get(`${LEASE_KEY_PREFIX}acct:1`)?.value).toBe(fresh)
  })
})
