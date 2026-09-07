import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

/**
 * The billing integration key's SOURCE RESTRICTION, and the throttle behind
 * `last_used_at`.
 *
 * Why this file exists. `normalizeCidr` and `ipInAnyCidr` are the whole of the
 * "this credential may only be used from these addresses" promise, and they are
 * bit arithmetic over two address families with no database behind them — so a
 * wrong shift, a wrong version comparison or a silently widened prefix is
 * invisible to every route test, which only ever sends one address. A table
 * test is the only thing that reaches the edges: `/0` and `/32`, the IPv4-mapped
 * form a proxy really does hand over, and the malformed strings a payer really
 * does paste out of a firewall console.
 *
 * The two rules the table encodes:
 *
 *   NO LIST IS "ANY SOURCE", and an unparsable address is NOT. `null` and `[]`
 *   both mean the payer set no restriction, so every request passes; but once a
 *   list exists, an address that cannot be parsed fails CLOSED rather than
 *   matching everything.
 *
 *   HOST BITS ARE A REFUSAL, not a silent mask. `10.0.0.1/24` is a typo, and
 *   both readings of it are wrong: Postgres's `cidr` type rejects it outright,
 *   and widening it to `10.0.0.0/24` would grant the key a range the payer did
 *   not ask for.
 */

const update = vi.fn()
const eq = vi.fn()

vi.mock("../supabase.js", () => ({
  supabase: {
    from: () => ({
      update: (payload: unknown) => {
        update(payload)
        return { eq: (col: string, val: unknown) => eq(col, val) }
      },
    }),
  },
}))

import {
  ipInAnyCidr,
  normalizeCidr,
  touchBillingKeyLastUsed,
  __resetBillingKeyCacheForTests,
} from "../billing-key-resolver.js"

beforeEach(() => {
  vi.clearAllMocks()
  eq.mockResolvedValue({ data: null, error: null })
  __resetBillingKeyCacheForTests()
})

afterEach(() => {
  vi.useRealTimers()
  __resetBillingKeyCacheForTests()
})

// ---------------------------------------------------------------------------
// normalizeCidr — what may be STORED
// ---------------------------------------------------------------------------

describe("normalizeCidr", () => {
  const accepted: Array<[unknown, string]> = [
    // A bare address is a single host, in both families.
    ["10.0.0.1", "10.0.0.1/32"],
    ["  203.0.113.7  ", "203.0.113.7/32"],
    ["::1", "::1/128"],
    ["::", "::/128"],
    ["2001:db8:0000:0000:0000:ff00:0042:8329", "2001:db8:0000:0000:0000:ff00:0042:8329/128"],
    // Networks whose host bits really are zero.
    ["10.0.0.0/8", "10.0.0.0/8"],
    ["203.0.113.0/24", "203.0.113.0/24"],
    ["198.51.100.9/32", "198.51.100.9/32"],
    ["0.0.0.0/0", "0.0.0.0/0"],
    ["2001:db8::/32", "2001:db8::/32"],
    ["::/0", "::/0"],
  ]

  for (const [input, expected] of accepted) {
    it(`accepts ${JSON.stringify(input)} as ${expected}`, () => {
      expect(normalizeCidr(input)).toBe(expected)
    })
  }

  const refused: unknown[] = [
    // HOST BITS SET. The typo class: refused rather than masked.
    "10.0.0.1/24",
    "2001:db8::1/32",
    // A port is not part of an address, and accepting one would store a
    // range that never matches the address the proxy forwards.
    "1.2.3.4:5678",
    // Plainly not addresses.
    "10.0.0.0/33",
    "::1/129",
    "10.0.0.0/-1",
    "10.0.0.0/8/8",
    "999.0.0.1",
    "not-an-address",
    "",
    "   ",
    // Not even a string.
    null,
    undefined,
    42,
    ["10.0.0.0/8"],
    // Longer than the column's own sanity bound.
    `${"1".repeat(65)}`,
  ]

  for (const input of refused) {
    it(`refuses ${JSON.stringify(input) ?? String(input)}`, () => {
      expect(normalizeCidr(input)).toBeNull()
    })
  }
})

// ---------------------------------------------------------------------------
// ipInAnyCidr — what may CONNECT
// ---------------------------------------------------------------------------

describe("ipInAnyCidr — no list means any source", () => {
  it("null and an empty list both pass every caller, and even a caller with no address at all", () => {
    expect(ipInAnyCidr("10.1.2.3", null)).toBe(true)
    expect(ipInAnyCidr("10.1.2.3", undefined)).toBe(true)
    expect(ipInAnyCidr("10.1.2.3", [])).toBe(true)
    expect(ipInAnyCidr(null, null)).toBe(true)
  })

  it("but once a list exists, an address we could not read fails CLOSED", () => {
    expect(ipInAnyCidr(null, ["10.0.0.0/8"])).toBe(false)
    expect(ipInAnyCidr("not-an-address", ["10.0.0.0/8"])).toBe(false)
    expect(ipInAnyCidr("1.2.3.4:5678", ["1.2.3.0/24"])).toBe(false)
  })
})

describe("ipInAnyCidr — the arithmetic", () => {
  const cases: Array<[string, string[], boolean]> = [
    // /8, /24, /32 — the three prefixes a payer actually types.
    ["10.255.255.254", ["10.0.0.0/8"], true],
    ["11.0.0.1", ["10.0.0.0/8"], false],
    ["203.0.113.42", ["203.0.113.0/24"], true],
    ["203.0.114.42", ["203.0.113.0/24"], false],
    ["198.51.100.9", ["198.51.100.9/32"], true],
    ["198.51.100.10", ["198.51.100.9/32"], false],
    // /0 is every address of ITS OWN family, and of no other.
    ["8.8.8.8", ["0.0.0.0/0"], true],
    ["2001:db8::1", ["0.0.0.0/0"], false],
    ["2001:db8::1", ["::/0"], true],
    ["8.8.8.8", ["::/0"], false],
    // IPv6, including the two single-address forms.
    ["::1", ["::1/128"], true],
    ["::2", ["::1/128"], false],
    ["::", ["::/128"], true],
    ["2001:db8:0:0:0:ff00:42:8329", ["2001:db8::/32"], true],
    ["2001:0db8:0000:0000:0000:ff00:0042:8329", ["2001:db8::/32"], true],
    ["2001:db9::1", ["2001:db8::/32"], false],
    // AN IPv4-MAPPED ADDRESS *IS* THE v4 ADDRESS. A proxy that hands one over
    // must still match the v4 block the payer allowed — this is the case a
    // naive "compare the families first" implementation gets wrong, and the
    // failure is a working integration refused at 403.
    ["::ffff:203.0.113.7", ["203.0.113.0/24"], true],
    ["::ffff:203.0.114.7", ["203.0.113.0/24"], false],
    ["::ffff:203.0.113.7", ["::/0"], false],
    // A ZONE SUFFIX IS NOT PART OF THE ADDRESS. A link-local address arrives
    // with the interface appended; the match is on the address alone.
    ["fe80::1%eth0", ["fe80::1/128"], true],
    ["fe80::1%eth0", ["fe80::/10"], true],
    ["fe80::2%eth0", ["fe80::1/128"], false],
    // Several entries: any one of them is enough, and a malformed neighbour
    // must not take the whole list down with it.
    ["203.0.113.7", ["10.0.0.0/8", "203.0.113.0/24"], true],
    ["203.0.113.7", ["nonsense", "203.0.113.0/24"], true],
    ["203.0.113.7", ["10.0.0.0/8", "192.0.2.0/24"], false],
    // An entry with no prefix at all is skipped rather than read as a host.
    ["203.0.113.7", ["203.0.113.7"], false],
  ]

  for (const [ip, cidrs, expected] of cases) {
    it(`${ip} ${expected ? "is in" : "is NOT in"} ${cidrs.join(" ")}`, () => {
      expect(ipInAnyCidr(ip, cidrs)).toBe(expected)
    })
  }
})

// ---------------------------------------------------------------------------
// touchBillingKeyLastUsed — an activity signal, never a cost
// ---------------------------------------------------------------------------

describe("touchBillingKeyLastUsed", () => {
  it("writes once, then stays quiet for the throttle window", () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-09-07T00:00:00.000Z"))
    touchBillingKeyLastUsed("key-1")
    touchBillingKeyLastUsed("key-1")
    vi.advanceTimersByTime(59_000)
    touchBillingKeyLastUsed("key-1")
    expect(update).toHaveBeenCalledTimes(1)

    // Past the window it stamps again — the column is an activity signal, and
    // a key used all day must not look last-used at breakfast.
    vi.advanceTimersByTime(2_000)
    touchBillingKeyLastUsed("key-1")
    expect(update).toHaveBeenCalledTimes(2)
  })

  it("throttles PER KEY, so a busy key never silences a quiet one", () => {
    touchBillingKeyLastUsed("key-1")
    touchBillingKeyLastUsed("key-2")
    expect(update).toHaveBeenCalledTimes(2)
    expect(eq).toHaveBeenNthCalledWith(1, "id", "key-1")
    expect(eq).toHaveBeenNthCalledWith(2, "id", "key-2")
  })

  it("stamps last_used_at and nothing else", () => {
    touchBillingKeyLastUsed("key-1")
    const payload = update.mock.calls[0]?.[0] as Record<string, unknown>
    expect(Object.keys(payload)).toEqual(["last_used_at"])
    expect(typeof payload.last_used_at).toBe("string")
  })

  it("a REJECTED write never reaches the request that carried it", async () => {
    // Fire-and-forget by design: this runs beside a request that has already
    // been authorised, and a failed activity stamp must not fail it — nor
    // surface as an unhandled rejection.
    eq.mockRejectedValue(new Error("connection reset"))
    expect(() => touchBillingKeyLastUsed("key-1")).not.toThrow()
    await new Promise((r) => setImmediate(r))
    expect(update).toHaveBeenCalledTimes(1)
  })
})
