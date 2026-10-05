import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

/**
 * The rules for choosing a network to block (admin → Blocks):
 *
 * - `rangeToBlock`: what a typed address or range becomes — or why it is
 *   refused. A single IPv4 address blocks itself (/32); a single public IPv6
 *   address blocks its /64 (the unit one subscriber line rotates inside).
 *   Refusals, in the order the function checks them: invalid → not public →
 *   Cloudflare → too wide for anyone → too wide for a plain admin → the
 *   admin's own network.
 * - `needsSuperAdmin`: a signup network shared by ≥ 20 other accounts, or by
 *   any paying one, is a super_admin decision.
 * - `expiryFromDays`: every block expires.
 * - `signupNetworkOf` / `collateralOf`: the two reads behind the account path.
 *   Only a row marked `ip_scheme = 'client'` is blockable, and before
 *   migration 458 adds the marker column nothing is.
 */

const fake = vi.hoisted(() => {
  type Filter = [op: "eq" | "neq" | "in", column: string, value: unknown]
  interface Call {
    table: string
    columns: string | null
    options: Record<string, unknown> | null
    filters: Filter[]
    limit: number | null
    terminal: "await" | "maybeSingle"
  }
  type Result = { data: unknown; error: unknown; count?: number | null }

  const state = {
    calls: [] as Call[],
    respond: (_call: Call): Result => ({ data: null, error: null }),
  }

  function from(table: string) {
    const call: Call = { table, columns: null, options: null, filters: [], limit: null, terminal: "await" }
    const resolve = (): Result => {
      state.calls.push(call)
      return state.respond(call)
    }
    const builder: Record<string, unknown> = {
      select: (columns: string, options?: Record<string, unknown>) => {
        call.columns = columns
        call.options = options ?? null
        return builder
      },
      eq: (column: string, value: unknown) => {
        call.filters.push(["eq", column, value])
        return builder
      },
      neq: (column: string, value: unknown) => {
        call.filters.push(["neq", column, value])
        return builder
      },
      in: (column: string, value: unknown) => {
        call.filters.push(["in", column, value])
        return builder
      },
      limit: (n: number) => {
        call.limit = n
        return builder
      },
      maybeSingle: async () => {
        call.terminal = "maybeSingle"
        return resolve()
      },
      then: (onFulfilled: (v: Result) => unknown, onRejected?: (e: unknown) => unknown) =>
        Promise.resolve().then(resolve).then(onFulfilled, onRejected),
    }
    return builder
  }

  return { state, from }
})

vi.mock("@/lib/supabase.js", () => ({ supabase: { from: (table: string) => fake.from(table) } }))

import {
  ADMIN_MIN_PREFIX,
  BLOCK_DURATION_DAYS,
  COLLATERAL_ACCOUNTS_THRESHOLD,
  DEFAULT_BLOCK_DAYS,
  SUPER_ADMIN_MIN_PREFIX,
  collateralOf,
  expiryFromDays,
  needsSuperAdmin,
  rangeToBlock,
  signupNetworkOf,
} from "../network-blocking.js"

const ADMIN = { superAdmin: false, adminAddress: null }
const SUPER = { superAdmin: true, adminAddress: null }

beforeEach(() => {
  fake.state.calls.length = 0
  fake.state.respond = () => ({ data: null, error: null })
})

afterEach(() => {
  vi.useRealTimers()
})

// ---------------------------------------------------------------------------
// rangeToBlock
// ---------------------------------------------------------------------------

describe("rangeToBlock — what a typed address becomes", () => {
  it.each([
    ["a single IPv4 address blocks exactly itself (/32)", "85.65.91.64", "85.65.91.64/32"],
    ["surrounding whitespace is not part of the address", "  85.65.91.64 \t", "85.65.91.64/32"],
    ["an IPv4-mapped IPv6 address IS the IPv4 address", "::ffff:85.65.91.64", "85.65.91.64/32"],
    ["a single public IPv6 address blocks its /64", "2a01:4f8:1:2:aaaa:bbbb:cccc:dddd", "2a01:4f8:1:2::/64"],
    ["the /64 is the same for every address inside it", "2a01:4f8:1:2::1", "2a01:4f8:1:2::/64"],
    ["a typed /32 is one address", "85.65.91.64/32", "85.65.91.64/32"],
    ["a typed IPv6 /64 is stored in its canonical spelling", "2A01:04F8:0001:0002::/64", "2a01:4f8:1:2::/64"],
  ])("one network — any admin, liftable by any admin: %s", (_label, input, cidr) => {
    expect(rangeToBlock(input, ADMIN)).toEqual({ cidr, superAdminOnly: false })
    expect(rangeToBlock(input, SUPER)).toEqual({ cidr, superAdminOnly: false })
  })

  it("a typed range is stored as typed — and only a super admin may lift it", () => {
    expect(rangeToBlock("85.65.91.0/24", SUPER)).toEqual({ cidr: "85.65.91.0/24", superAdminOnly: true })
    expect(rangeToBlock("2a01:4f8:1::/48", SUPER)).toEqual({ cidr: "2a01:4f8:1::/48", superAdminOnly: true })
  })
})

describe("rangeToBlock — refusals", () => {
  it.each([
    ["empty", ""],
    ["whitespace only", "   "],
    ["a word", "not-an-ip"],
    ["three octets", "85.65.91"],
    ["an octet over 255", "256.1.1.1"],
    ["an IPv4 prefix over 32", "85.65.91.64/33"],
    ["an IPv6 prefix over 128", "2a01:4f8::/129"],
    ["host bits set (Postgres cidr rejects it; widening it would block more than was typed)", "85.65.91.1/24"],
    ["a non-numeric prefix", "85.65.91.0/abc"],
    ["a negative prefix", "85.65.91.0/-1"],
    ["a zone id", "fe80::1%eth0"],
  ])("invalid_address: %s", (_label, input) => {
    expect(rangeToBlock(input, SUPER)).toEqual({ refusal: "invalid_address" })
  })

  it.each([
    ["RFC 1918 (10/8)", "10.1.2.3"],
    ["RFC 1918 (172.16/12) range", "172.16.5.0/24"],
    ["RFC 1918 (192.168/16) range", "192.168.0.0/16"],
    ["loopback", "127.0.0.1"],
    ["link-local / cloud metadata", "169.254.169.254"],
    ["carrier-grade NAT (100.64/10)", "100.64.1.2"],
    ["benchmarking (198.18/15)", "198.18.0.1"],
    ["multicast", "224.0.0.1"],
    ["'this network' — refused as not public before its width is judged", "0.0.0.0/8"],
    ["IPv6 loopback", "::1"],
    ["IPv6 link-local", "fe80::1"],
    ["IPv6 unique-local range", "fd12:3456:789a::/48"],
    ["IPv6 multicast", "ff02::1"],
    ["a mapped private IPv4", "::ffff:10.0.0.1"],
  ])("not_public: %s", (_label, input) => {
    expect(rangeToBlock(input, SUPER)).toEqual({ refusal: "not_public" })
  })

  it.each([
    ["a Cloudflare edge address", "104.16.0.1"],
    ["a range inside a Cloudflare edge range", "104.16.5.0/24"],
    ["a whole Cloudflare edge range — refused as Cloudflare before its width is judged", "173.245.48.0/20"],
    ["a Cloudflare IPv6 address (its /64 is Cloudflare's)", "2606:4700::1"],
    ["inside Cloudflare's /29", "2a06:98c7::/48"],
  ])("cloudflare: %s", (_label, input) => {
    expect(rangeToBlock(input, SUPER)).toEqual({ refusal: "cloudflare" })
    expect(rangeToBlock(input, ADMIN)).toEqual({ refusal: "cloudflare" })
  })

  it.each([
    ["IPv4 wider than /16", "85.64.0.0/15"],
    ["IPv4 /8", "85.0.0.0/8"],
    ["IPv6 wider than /32", "2a01::/31"],
    ["IPv6 /16", "2a00::/16"],
  ])("too_wide even for a super admin: %s", (_label, input) => {
    expect(rangeToBlock(input, SUPER)).toEqual({ refusal: "too_wide" })
    expect(rangeToBlock(input, ADMIN)).toEqual({ refusal: "too_wide" })
  })

  // Nobody can count who is behind a range — a carrier, a campus — so any
  // range wider than one network is a super admin's call.
  it.each([
    ["IPv4 /31 (two addresses)", "85.65.91.64/31"],
    ["IPv4 /24", "85.65.91.0/24"],
    ["IPv4 /16 (the super-admin floor)", "85.65.0.0/16"],
    ["IPv6 /63", "2a01:4f8:1:2::/63"],
    ["IPv6 /48", "2a01:4f8:1::/48"],
    ["IPv6 /32 (the super-admin floor)", "2a01:4f8::/32"],
  ])("too_wide_for_admin — a plain admin is refused, a super admin is not: %s", (_label, input) => {
    expect(rangeToBlock(input, ADMIN)).toEqual({ refusal: "too_wide_for_admin" })
    expect(rangeToBlock(input, SUPER)).toEqual({ cidr: input, superAdminOnly: true })
  })

  it("a plain admin blocks exactly one network: /32 (IPv4) and /64 (IPv6)", () => {
    expect(ADMIN_MIN_PREFIX).toEqual({ 4: 32, 6: 64 })
    expect(SUPER_ADMIN_MIN_PREFIX).toEqual({ 4: 16, 6: 32 })
    expect(rangeToBlock("85.65.91.64/32", ADMIN)).toEqual({ cidr: "85.65.91.64/32", superAdminOnly: false })
    expect(rangeToBlock("2a01:4f8:1:2::/64", ADMIN)).toEqual({ cidr: "2a01:4f8:1:2::/64", superAdminOnly: false })
  })

  describe("own_network — the range holds the address the admin is on right now", () => {
    const v4Admin = { superAdmin: false, adminAddress: "85.65.91.64" }
    const v6Admin = { superAdmin: false, adminAddress: "2a01:4f8:1:2::5" }

    it("refuses the admin's own IPv4 address and a range around it", () => {
      expect(rangeToBlock("85.65.91.64", v4Admin)).toEqual({ refusal: "own_network" })
      expect(rangeToBlock("85.65.91.0/24", { ...v4Admin, superAdmin: true })).toEqual({ refusal: "own_network" })
    })

    it("refuses another address in the admin's own IPv6 /64 (the /64 holds the admin)", () => {
      expect(rangeToBlock("2a01:4f8:1:2:ffff::1", v6Admin)).toEqual({ refusal: "own_network" })
    })

    it("a super admin is refused their own network too", () => {
      expect(rangeToBlock("85.65.0.0/16", { superAdmin: true, adminAddress: "85.65.91.64" })).toEqual({
        refusal: "own_network",
      })
    })

    it("a neighbouring network is not the admin's", () => {
      expect(rangeToBlock("85.65.91.65", v4Admin)).toEqual({ cidr: "85.65.91.65/32", superAdminOnly: false })
      expect(rangeToBlock("85.65.92.0/24", { ...v4Admin, superAdmin: true })).toEqual({
        cidr: "85.65.92.0/24",
        superAdminOnly: true,
      })
      expect(rangeToBlock("2a01:4f8:1:3::1", v6Admin)).toEqual({ cidr: "2a01:4f8:1:3::/64", superAdminOnly: false })
      // Another family never contains the admin.
      expect(rangeToBlock("2a01:4f8:1:2::1", v4Admin)).toEqual({ cidr: "2a01:4f8:1:2::/64", superAdminOnly: false })
    })

    it("an admin whose address is unknown is not checked (nothing to compare)", () => {
      expect(rangeToBlock("85.65.91.64", ADMIN)).toEqual({ cidr: "85.65.91.64/32", superAdminOnly: false })
    })
  })
})

// ---------------------------------------------------------------------------
// needsSuperAdmin
// ---------------------------------------------------------------------------

describe("needsSuperAdmin", () => {
  it("the threshold is 20 other accounts", () => {
    expect(COLLATERAL_ACCOUNTS_THRESHOLD).toBe(20)
  })

  it.each([
    [{ otherAccounts: 0, payingAccounts: 0, targetPaying: false }, false],
    [{ otherAccounts: 19, payingAccounts: 0, targetPaying: false }, false],
    [{ otherAccounts: 20, payingAccounts: 0, targetPaying: false }, true],
    [{ otherAccounts: 21, payingAccounts: 0, targetPaying: false }, true],
    [{ otherAccounts: 1, payingAccounts: 1, targetPaying: false }, true],
    [{ otherAccounts: 19, payingAccounts: 1, targetPaying: false }, true],
    // The account the block is taken from counts too: shutting out a customer
    // is a super admin's call even when nobody else signed up there.
    [{ otherAccounts: 0, payingAccounts: 0, targetPaying: true }, true],
  ])("%o → %s", (collateral, expected) => {
    expect(needsSuperAdmin(collateral)).toBe(expected)
  })
})

// ---------------------------------------------------------------------------
// expiryFromDays
// ---------------------------------------------------------------------------

describe("expiryFromDays", () => {
  const NOW = Date.parse("2026-10-05T12:00:00.000Z")

  it("offers 1 / 7 / 30 / 90 days, 30 by default", () => {
    expect([...BLOCK_DURATION_DAYS]).toEqual([1, 7, 30, 90])
    expect(DEFAULT_BLOCK_DAYS).toBe(30)
  })

  it.each([
    [1, "2026-10-06T12:00:00.000Z"],
    [7, "2026-10-12T12:00:00.000Z"],
    [30, "2026-11-04T12:00:00.000Z"],
    [90, "2027-01-03T12:00:00.000Z"],
  ] as const)("%i days from a fixed instant", (days, expected) => {
    expect(expiryFromDays(days, NOW)).toBe(expected)
  })

  it("counts from now when no instant is given", () => {
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(NOW)
    expect(expiryFromDays(30)).toBe("2026-11-04T12:00:00.000Z")
  })
})

// ---------------------------------------------------------------------------
// signupNetworkOf
// ---------------------------------------------------------------------------

describe("signupNetworkOf", () => {
  const USER = "00000000-0000-4000-8000-000000000001"
  const HASH = "a".repeat(64)
  const AT = "2026-09-01T10:00:00.000Z"

  it("reads the account's claim row; a 'client' row is blockable", async () => {
    fake.state.respond = () => ({ data: { ip_hash: HASH, ip_scheme: "client", created_at: AT }, error: null })

    await expect(signupNetworkOf(USER)).resolves.toEqual({ hash: HASH, blockable: true, signupAt: AT })
    expect(fake.state.calls).toHaveLength(1)
    expect(fake.state.calls[0]).toMatchObject({
      table: "signup_signals",
      columns: "ip_hash, ip_scheme, created_at",
      terminal: "maybeSingle",
      filters: [
        ["eq", "user_id", USER],
        ["eq", "source", "claim"],
      ],
    })
  })

  it("a row with no marker (an unknown or pre-458 address) is not blockable", async () => {
    fake.state.respond = () => ({ data: { ip_hash: HASH, ip_scheme: null, created_at: AT }, error: null })
    await expect(signupNetworkOf(USER)).resolves.toEqual({ hash: HASH, blockable: false, signupAt: AT })
  })

  it.each(["42703", "PGRST204"])(
    "before migration 458 adds the column (%s), it reads again without it — and nothing is blockable",
    async (code) => {
      fake.state.respond = (call) =>
        call.columns?.includes("ip_scheme")
          ? { data: null, error: { code, message: "column signup_signals.ip_scheme does not exist" } }
          : { data: { ip_hash: HASH, created_at: AT }, error: null }

      await expect(signupNetworkOf(USER)).resolves.toEqual({ hash: HASH, blockable: false, signupAt: AT })
      expect(fake.state.calls.map((c) => c.columns)).toEqual(["ip_hash, ip_scheme, created_at", "ip_hash, created_at"])
    },
  )

  it("null when the account never claimed", async () => {
    fake.state.respond = () => ({ data: null, error: null })
    await expect(signupNetworkOf(USER)).resolves.toBeNull()
  })

  it("throws any other read error", async () => {
    const error = { code: "XX000", message: "boom" }
    fake.state.respond = () => ({ data: null, error })
    await expect(signupNetworkOf(USER)).rejects.toBe(error)
    expect(fake.state.calls).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// collateralOf
// ---------------------------------------------------------------------------

describe("collateralOf", () => {
  const SOURCE = "00000000-0000-4000-8000-000000000001"
  const HASH = "b".repeat(64)
  const id = (n: number) => `00000000-0000-4000-8000-${String(n + 100).padStart(12, "0")}`

  it("counts the OTHER accounts that signed up there, and which of them ever paid — a cancelled subscription included", async () => {
    const others = [id(1), id(2), id(3), id(4), id(5)]
    fake.state.respond = (call) => {
      if (call.table === "signup_signals") return { data: others.map((user_id) => ({ user_id })), error: null, count: 5 }
      if (call.table === "subscriptions") return { data: [{ user_id: id(1) }], error: null }
      return {
        data: [
          { id: id(1), tier: "free", subscription_tier: null, lifetime_topup_credits: 0 }, // subscribed once, cancelled
          { id: id(2), tier: null, subscription_tier: "pro", lifetime_topup_credits: null },
          { id: id(3), tier: "free", subscription_tier: null, lifetime_topup_credits: 500 },
          { id: id(4), tier: "basic", subscription_tier: null, lifetime_topup_credits: 0 },
          { id: id(5), tier: "free", subscription_tier: null, lifetime_topup_credits: 0 }, // never paid
          { id: SOURCE, tier: "free", subscription_tier: null, lifetime_topup_credits: 0 },
        ],
        error: null,
      }
    }

    await expect(collateralOf(HASH, SOURCE)).resolves.toEqual({ otherAccounts: 5, payingAccounts: 4, targetPaying: false })

    const signals = fake.state.calls.find((c) => c.table === "signup_signals")!
    expect(signals.options).toEqual({ count: "exact" })
    expect(signals.filters).toEqual([
      ["eq", "ip_hash", HASH],
      ["eq", "source", "claim"],
      ["neq", "user_id", SOURCE],
    ])
    expect(signals.limit).toBe(500)
    const profiles = fake.state.calls.filter((c) => c.table === "profiles")
    expect(profiles).toHaveLength(1)
    expect(profiles[0]!.filters).toEqual([["in", "id", [...others, SOURCE]]])
    const subscriptions = fake.state.calls.filter((c) => c.table === "subscriptions")
    expect(subscriptions).toHaveLength(1)
    expect(subscriptions[0]!.filters).toEqual([["in", "user_id", [...others, SOURCE]]])
  })

  it("counts the account the block is taken from: a paying target needs a super admin even alone on its network", async () => {
    fake.state.respond = (call) => {
      if (call.table === "signup_signals") return { data: [], error: null, count: 0 }
      if (call.table === "subscriptions") return { data: [{ user_id: SOURCE }], error: null }
      return { data: [{ id: SOURCE, tier: "free", subscription_tier: null, lifetime_topup_credits: 0 }], error: null }
    }
    const c = await collateralOf(HASH, SOURCE)
    expect(c).toEqual({ otherAccounts: 0, payingAccounts: 0, targetPaying: true })
    expect(needsSuperAdmin(c)).toBe(true)
  })

  it("nobody else and no target: zero, without reading a single profile", async () => {
    fake.state.respond = () => ({ data: [], error: null, count: 0 })
    await expect(collateralOf(HASH, null)).resolves.toEqual({ otherAccounts: 0, payingAccounts: 0, targetPaying: false })
    expect(fake.state.calls.filter((c) => c.table === "profiles")).toHaveLength(0)
  })

  it("reports the exact count past the 500-row sample, reading profiles 100 at a time", async () => {
    const sample = Array.from({ length: 500 }, (_, i) => ({ user_id: id(i) }))
    fake.state.respond = (call) =>
      call.table === "signup_signals" ? { data: sample, error: null, count: 750 } : { data: [], error: null }

    await expect(collateralOf(HASH, SOURCE)).resolves.toEqual({ otherAccounts: 750, payingAccounts: 0, targetPaying: false })
    const profileReads = fake.state.calls.filter((c) => c.table === "profiles")
    // 500 others and the target: five full chunks and one more.
    expect(profileReads.map((read) => (read.filters[0]![2] as string[]).length)).toEqual([100, 100, 100, 100, 100, 1])
  })

  it("without an account to exclude, every claim on the network counts", async () => {
    fake.state.respond = () => ({ data: [], error: null, count: 0 })
    await collateralOf(HASH, null)
    expect(fake.state.calls[0]!.filters).toEqual([
      ["eq", "ip_hash", HASH],
      ["eq", "source", "claim"],
    ])
  })

  it("throws a read error rather than answering zero collateral", async () => {
    const error = { code: "XX000", message: "boom" }
    fake.state.respond = () => ({ data: null, error, count: null })
    await expect(collateralOf(HASH, SOURCE)).rejects.toBe(error)
  })
})
