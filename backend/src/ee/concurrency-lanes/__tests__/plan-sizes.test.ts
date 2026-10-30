// The Cloud lane-size reader: per-plan rows, per-account overrides, payer
// lines, the provider ceilings and the waiting limits, all read from the
// shared database with a 60 s cache, and every bad or missing read answered by
// the code defaults.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

type PgError = { code: string; message: string }
type Row = Record<string, unknown>

/** What each table answers: its rows, or an error for every query. */
const db = vi.hoisted(() => ({
  tables: {} as Record<string, { rows: Row[]; error?: PgError }>,
  queries: [] as string[],
}))

vi.mock("@/lib/supabase.js", () => {
  function from(table: string) {
    db.queries.push(table)
    const filters: Array<[string, (v: unknown) => boolean]> = []
    const result = () => {
      const t = db.tables[table] ?? { rows: [] }
      if (t.error) return { data: null, error: t.error }
      return { data: t.rows.filter((r) => filters.every(([col, ok]) => ok(r[col]))), error: null }
    }
    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: (col: string, v: unknown) => {
        filters.push([col, (x) => x === v])
        return chain
      },
      in: (col: string, vs: unknown[]) => {
        filters.push([col, (x) => vs.includes(x)])
        return chain
      },
      maybeSingle: async () => {
        const r = result()
        return r.error ? r : { data: (r.data as Row[])[0] ?? null, error: null }
      },
      then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => Promise.resolve(result()).then(resolve, reject),
    }
    return chain
  }
  return { supabase: { from } }
})

const { config } = await import("@/lib/config.js")
const { defaultLaneSizesForTier } = await import("@/lib/concurrency-lanes/defaults.js")
const {
  cloudLaneSettings,
  cloudLaneSizesFor,
  cloudPlanSizes,
  cloudProviderCeilings,
  cloudProviderCeilingsAsRead,
  invalidateLaneConfigCache,
  resetLaneConfigLogForTests,
  resetLaneTierCacheForTests,
} = await import("../plan-sizes.js")
const { FALLBACK_TIER: DEPLOYMENT_FALLBACK_TIER } = await import("@/lib/deployment-payer.js")

const SEEDED_PLANS: Row[] = [
  { tier: "free", provider: 2, llm: 4, local: 4, run: 2 },
  { tier: "payg", provider: 4, llm: 8, local: 8, run: 4 },
  { tier: "basic", provider: 4, llm: 8, local: 8, run: 4 },
  { tier: "standard", provider: 6, llm: 12, local: 12, run: 6 },
  // An admin-edited pro row, so a read of the table is told apart from the code default.
  { tier: "pro", provider: 11, llm: 21, local: 22, run: 9 },
  { tier: "business", provider: 12, llm: 24, local: 24, run: 12 },
]

const profile = (id: string, tier: string | null, lifetime_topup_credits = 0): Row => ({
  id,
  tier,
  subscription_tier: tier,
  lifetime_topup_credits,
})

const override = (user_id: string, o: Partial<Record<"provider" | "llm" | "local" | "run", number | null>>): Row => ({
  user_id,
  provider: null,
  llm: null,
  local: null,
  run: null,
  ...o,
})

const userLine = (userId: string, tier: string | null = null) => ({ userId, payer: `user:${userId}` as const, tier })

const MISSING_TABLE: PgError = { code: "42P01", message: 'relation "public.lane_plan_sizes" does not exist' }

beforeEach(() => {
  db.tables = {
    lane_plan_sizes: { rows: SEEDED_PLANS.map((r) => ({ ...r })) },
    lane_user_overrides: { rows: [] },
    lane_provider_ceilings: { rows: [] },
    app_settings: { rows: [] },
    profiles: { rows: [] },
  }
  db.queries = []
  invalidateLaneConfigCache()
  resetLaneTierCacheForTests()
  resetLaneConfigLogForTests()
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe("cloudLaneSizesFor — personal line", () => {
  it("uses the plan row for a pro user", async () => {
    db.tables.profiles.rows = [profile("u1", "pro")]
    expect(await cloudLaneSizesFor(userLine("u1"))).toEqual({ provider: 11, llm: 21, local: 22, run: 9 })
  })

  it("resolves the effective tier: free with lifetime top-ups is payg", async () => {
    db.tables.lane_plan_sizes.rows.push({ tier: "payg", provider: 5, llm: 9, local: 9, run: 5 })
    db.tables.lane_plan_sizes.rows = db.tables.lane_plan_sizes.rows.filter((r) => !(r.tier === "payg" && r.provider === 4))
    db.tables.profiles.rows = [profile("u1", "free", 500)]
    expect(await cloudLaneSizesFor(userLine("u1"))).toEqual({ provider: 5, llm: 9, local: 9, run: 5 })
  })

  it("reads the tier from the profile, not the caller's hint", async () => {
    db.tables.profiles.rows = [profile("u1", "pro")]
    expect(await cloudLaneSizesFor(userLine("u1", "free"))).toEqual({ provider: 11, llm: 21, local: 22, run: 9 })
  })

  it("a {provider: 20} override replaces only provider", async () => {
    db.tables.profiles.rows = [profile("u1", "pro")]
    db.tables.lane_user_overrides.rows = [override("u1", { provider: 20 })]
    expect(await cloudLaneSizesFor(userLine("u1"))).toEqual({ provider: 20, llm: 21, local: 22, run: 9 })
  })

  it("ignores an out-of-range or non-integer override column and keeps the plan's value", async () => {
    db.tables.profiles.rows = [profile("u1", "pro")]
    db.tables.lane_user_overrides.rows = [override("u1", { provider: 0, llm: 501, local: 2.5, run: 3 })]
    expect(await cloudLaneSizesFor(userLine("u1"))).toEqual({ provider: 11, llm: 21, local: 22, run: 3 })
  })

  it("sizes a user with no profile row as free", async () => {
    expect(await cloudLaneSizesFor(userLine("ghost"))).toEqual(defaultLaneSizesForTier("free"))
  })

  it("a tier with no plan row, or a bad row, is sized by its code default", async () => {
    db.tables.lane_plan_sizes.rows = db.tables.lane_plan_sizes.rows
      .filter((r) => r.tier !== "standard")
      .map((r) => (r.tier === "pro" ? { ...r, llm: 0 } : r))
    db.tables.profiles.rows = [profile("u1", "standard"), profile("u2", "pro"), profile("u3", "business")]
    expect(await cloudLaneSizesFor(userLine("u1"))).toEqual(defaultLaneSizesForTier("standard"))
    expect(await cloudLaneSizesFor(userLine("u2"))).toEqual(defaultLaneSizesForTier("pro"))
    expect(await cloudLaneSizesFor(userLine("u3"))).toEqual({ provider: 12, llm: 24, local: 24, run: 12 })
  })
})

describe("cloudLaneSizesFor — workspace line", () => {
  it("uses the workspace plan row and ignores the member's override", async () => {
    db.tables.lane_plan_sizes.rows = db.tables.lane_plan_sizes.rows.map((r) =>
      r.tier === "business" ? { ...r, provider: 15 } : r,
    )
    db.tables.profiles.rows = [profile("u1", "free")]
    db.tables.lane_user_overrides.rows = [override("u1", { provider: 99, run: 99 })]
    const sizes = await cloudLaneSizesFor({ userId: "u1", payer: "workspace:w1", tier: "business" })
    expect(sizes).toEqual({ provider: 15, llm: 24, local: 24, run: 12 })
    expect(db.queries).not.toContain("profiles")
    expect(db.queries).not.toContain("lane_user_overrides")
  })
})

describe("cloudLaneSizesFor — deployment line", () => {
  it("uses the payer's tier and the payer's override", async () => {
    db.tables.profiles.rows = [profile("u1", "pro"), profile("payer1", "standard")]
    db.tables.lane_user_overrides.rows = [override("u1", { provider: 99 }), override("payer1", { llm: 40 })]
    const sizes = await cloudLaneSizesFor({ userId: "u1", payer: "deployment:payer1", tier: "basic" })
    expect(sizes).toEqual({ provider: 6, llm: 40, local: 12, run: 6 })
  })

  const deploymentLine = (tier: string | null = null) => ({ userId: "m1", payer: "deployment:p1" as const, tier })
  const basicRow = { tier: "basic", provider: 5, llm: 9, local: 10, run: 5 }

  it("a payer on a tier with no sizes of its own runs at the deployment fallback grade (its admin row), never free", async () => {
    expect(DEPLOYMENT_FALLBACK_TIER).toBe("basic")
    db.tables.lane_plan_sizes.rows = db.tables.lane_plan_sizes.rows.map((r) => (r.tier === "basic" ? { ...basicRow } : r))
    db.tables.profiles.rows = [profile("p1", "retired-tier")]
    expect(await cloudLaneSizesFor(deploymentLine("pro"))).toEqual({ provider: 5, llm: 9, local: 10, run: 5 })
  })

  it("an unknown hint on a failed profile read runs at the deployment fallback grade", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined)
    db.tables.profiles = { rows: [], error: { code: "08006", message: "connection failure" } }
    expect(await cloudLaneSizesFor(deploymentLine("retired-tier"))).toEqual({ provider: 4, llm: 8, local: 8, run: 4 })
  })

  it("a payer with no profile row is sized as a failed read: its hint, else the fallback grade", async () => {
    expect(await cloudLaneSizesFor(deploymentLine())).toEqual({ provider: 4, llm: 8, local: 8, run: 4 })
    resetLaneTierCacheForTests()
    expect(await cloudLaneSizesFor(deploymentLine("pro"))).toEqual({ provider: 11, llm: 21, local: 22, run: 9 })
  })

  it("a payer genuinely on free stays free, as deployment-payer.ts sizes it", async () => {
    db.tables.profiles.rows = [profile("p1", "free")]
    expect(await cloudLaneSizesFor(deploymentLine())).toEqual({ provider: 2, llm: 4, local: 4, run: 2 })
  })

  it("a tier with an extra plan row keeps that row on a deployment line", async () => {
    db.tables.lane_plan_sizes.rows.push({ tier: "partner", provider: 30, llm: 60, local: 60, run: 30 })
    db.tables.profiles.rows = [profile("p1", "partner")]
    expect(await cloudLaneSizesFor(deploymentLine())).toEqual({ provider: 30, llm: 60, local: 60, run: 30 })
  })

  it("a payer on enterprise is sized by the enterprise row, not the fallback grade", async () => {
    db.tables.profiles.rows = [profile("p1", "enterprise")]
    // No enterprise row: its code default, business's sizes.
    expect(await cloudLaneSizesFor(deploymentLine())).toEqual({ provider: 12, llm: 24, local: 24, run: 12 })
    // An admin-edited enterprise row wins.
    db.tables.lane_plan_sizes.rows.push({ tier: "enterprise", provider: 20, llm: 40, local: 40, run: 20 })
    invalidateLaneConfigCache()
    expect(await cloudLaneSizesFor(deploymentLine())).toEqual({ provider: 20, llm: 40, local: 40, run: 20 })
  })

  it("a personal line on enterprise is sized by the enterprise row", async () => {
    db.tables.lane_plan_sizes.rows.push({ tier: "enterprise", provider: 20, llm: 40, local: 40, run: 20 })
    db.tables.profiles.rows = [profile("u1", "enterprise")]
    expect(await cloudLaneSizesFor(userLine("u1"))).toEqual({ provider: 20, llm: 40, local: 40, run: 20 })
  })

  it("a personal line keeps today's sizing: an unknown tier is free, and so is a missing profile", async () => {
    db.tables.profiles.rows = [profile("u1", "retired-tier")]
    expect(await cloudLaneSizesFor(userLine("u1"))).toEqual(defaultLaneSizesForTier("free"))
    expect(await cloudLaneSizesFor(userLine("u9", "pro"))).toEqual(defaultLaneSizesForTier("free"))
  })
})

describe("cache", () => {
  it("a raised override admits the next waiter after the cache TTL", async () => {
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(new Date("2026-10-30T12:00:00Z"))
    db.tables.profiles.rows = [profile("u1", "pro")]
    db.tables.lane_user_overrides.rows = [override("u1", { provider: 1 })]
    expect((await cloudLaneSizesFor(userLine("u1"))).provider).toBe(1)

    db.tables.lane_user_overrides.rows = [override("u1", { provider: 2 })]
    vi.advanceTimersByTime(59_999)
    expect((await cloudLaneSizesFor(userLine("u1"))).provider).toBe(1)

    vi.advanceTimersByTime(1)
    expect((await cloudLaneSizesFor(userLine("u1"))).provider).toBe(2)
  })

  it("a plan-row edit is seen after the cache TTL", async () => {
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(new Date("2026-10-30T12:00:00Z"))
    db.tables.profiles.rows = [profile("u1", "pro")]
    expect((await cloudLaneSizesFor(userLine("u1"))).run).toBe(9)
    db.tables.lane_plan_sizes.rows = db.tables.lane_plan_sizes.rows.map((r) => (r.tier === "pro" ? { ...r, run: 30 } : r))
    vi.advanceTimersByTime(59_999)
    expect((await cloudLaneSizesFor(userLine("u1"))).run).toBe(9)
    vi.advanceTimersByTime(1)
    expect((await cloudLaneSizesFor(userLine("u1"))).run).toBe(30)
  })

  it("invalidateLaneConfigCache makes the next read see the new value at once", async () => {
    db.tables.profiles.rows = [profile("u1", "pro")]
    db.tables.lane_user_overrides.rows = [override("u1", { provider: 1 })]
    expect((await cloudLaneSizesFor(userLine("u1"))).provider).toBe(1)
    db.tables.lane_user_overrides.rows = [override("u1", { provider: 2 })]
    invalidateLaneConfigCache()
    expect((await cloudLaneSizesFor(userLine("u1"))).provider).toBe(2)
  })

  it("concurrent reads of one line share one query per table", async () => {
    db.tables.profiles.rows = [profile("u1", "pro")]
    await Promise.all([cloudLaneSizesFor(userLine("u1")), cloudLaneSizesFor(userLine("u1")), cloudLaneSizesFor(userLine("u1"))])
    expect(db.queries.filter((q) => q === "profiles")).toHaveLength(1)
    expect(db.queries.filter((q) => q === "lane_user_overrides")).toHaveLength(1)
    expect(db.queries.filter((q) => q === "lane_plan_sizes")).toHaveLength(1)
  })

  it("reads the overrides table once per TTL however many accounts ask", async () => {
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(new Date("2026-10-30T12:00:00Z"))
    const ids = ["a1", "a2", "a3", "a4", "a5"]
    db.tables.profiles.rows = ids.map((id) => profile(id, "pro"))
    db.tables.lane_user_overrides.rows = [override("a3", { run: 7 })]
    const lines = [...ids.map((id) => userLine(id)), { userId: "m1", payer: "deployment:a4" as const, tier: null }]
    const sizes = await Promise.all(lines.map((l) => cloudLaneSizesFor(l)))
    expect(sizes[2].run).toBe(7)
    expect(sizes[0].run).toBe(9)
    expect(db.queries.filter((q) => q === "lane_user_overrides")).toHaveLength(1)
    // One profile read per account, the only per-account query.
    expect(db.queries.filter((q) => q === "profiles")).toHaveLength(5)

    vi.advanceTimersByTime(59_999)
    for (const l of lines) await cloudLaneSizesFor(l)
    expect(db.queries.filter((q) => q === "lane_user_overrides")).toHaveLength(1)
    vi.advanceTimersByTime(1)
    for (const l of lines) await cloudLaneSizesFor(l)
    expect(db.queries.filter((q) => q === "lane_user_overrides")).toHaveLength(2)
  })

  it("invalidateLaneConfigCache re-reads the lane tables with one query each but keeps the profile tiers", async () => {
    db.tables.profiles.rows = [profile("u1", "pro"), profile("u2", "pro")]
    await cloudLaneSizesFor(userLine("u1"))
    await cloudLaneSizesFor(userLine("u2"))
    db.queries = []
    invalidateLaneConfigCache()
    await cloudLaneSizesFor(userLine("u1"))
    await cloudLaneSizesFor(userLine("u2"))
    expect(db.queries.filter((q) => q === "profiles")).toHaveLength(0)
    expect(db.queries.filter((q) => q === "lane_user_overrides")).toHaveLength(1)
    expect(db.queries.filter((q) => q === "lane_plan_sizes")).toHaveLength(1)
  })

  it("returns a fresh object every call", async () => {
    db.tables.profiles.rows = [profile("u1", "pro")]
    const a = await cloudLaneSizesFor(userLine("u1"))
    a.provider = 999
    expect((await cloudLaneSizesFor(userLine("u1"))).provider).toBe(11)
  })
})

describe("failed and missing reads", () => {
  it("a DB error answers the code defaults", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined)
    const down: PgError = { code: "08006", message: "connection failure" }
    for (const t of Object.keys(db.tables)) db.tables[t] = { rows: [], error: down }
    expect(await cloudLaneSizesFor(userLine("u1", "pro"))).toEqual(defaultLaneSizesForTier("pro"))
    expect(await cloudLaneSizesFor(userLine("u2"))).toEqual(defaultLaneSizesForTier("free"))
    expect(await cloudLaneSizesFor({ userId: "u3", payer: "workspace:w1", tier: "business" })).toEqual(
      defaultLaneSizesForTier("business"),
    )
    expect(await cloudProviderCeilings()).toEqual({})
    expect(await cloudLaneSettings()).toEqual({
      queueTimeoutMs: config.LANE_QUEUE_TIMEOUT_MINUTES * 60_000,
      liveWaitLimitMs: config.LANE_LIVE_WAIT_MINUTES * 60_000,
    })
  })

  it("a failed read keeps the last good value", async () => {
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(new Date("2026-10-30T12:00:00Z"))
    vi.spyOn(console, "warn").mockImplementation(() => undefined)
    db.tables.profiles.rows = [profile("u1", "pro")]
    db.tables.lane_user_overrides.rows = [override("u1", { provider: 20 })]
    expect(await cloudLaneSizesFor(userLine("u1"))).toEqual({ provider: 20, llm: 21, local: 22, run: 9 })

    const down: PgError = { code: "08006", message: "connection failure" }
    for (const t of Object.keys(db.tables)) db.tables[t] = { rows: [], error: down }
    vi.advanceTimersByTime(60_000)
    expect(await cloudLaneSizesFor(userLine("u1"))).toEqual({ provider: 20, llm: 21, local: 22, run: 9 })
  })

  it("a failed tier read is tried again after 5 s, not 60 s", async () => {
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(new Date("2026-10-30T12:00:00Z"))
    vi.spyOn(console, "warn").mockImplementation(() => undefined)
    db.tables.profiles = { rows: [], error: { code: "08006", message: "connection failure" } }
    expect(await cloudLaneSizesFor(userLine("u1"))).toEqual(defaultLaneSizesForTier("free"))

    db.tables.profiles = { rows: [profile("u1", "pro")] }
    vi.advanceTimersByTime(4_999)
    expect(await cloudLaneSizesFor(userLine("u1"))).toEqual(defaultLaneSizesForTier("free"))
    vi.advanceTimersByTime(1)
    expect(await cloudLaneSizesFor(userLine("u1"))).toEqual({ provider: 11, llm: 21, local: 22, run: 9 })
  })

  it("one line's fallback tier never reaches another line of the same account", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined)
    db.tables.profiles = { rows: [], error: { code: "08006", message: "connection failure" } }
    expect(await cloudLaneSizesFor({ userId: "m1", payer: "deployment:x1", tier: "standard" })).toEqual(
      { provider: 6, llm: 12, local: 12, run: 6 },
    )
    expect(await cloudLaneSizesFor({ userId: "x1", payer: "user:x1", tier: null })).toEqual(defaultLaneSizesForTier("free"))
    expect(await cloudLaneSizesFor({ userId: "x1", payer: "user:x1", tier: "pro" })).toEqual(
      { provider: 11, llm: 21, local: 22, run: 9 },
    )
  })

  it("a deployment line with no hint falls back to the deployment payer's grade, never free", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined)
    expect(DEPLOYMENT_FALLBACK_TIER).toBe("basic")
    db.tables.profiles = { rows: [], error: { code: "08006", message: "connection failure" } }
    expect(await cloudLaneSizesFor({ userId: "m1", payer: "deployment:p1", tier: null })).toEqual(
      { provider: 4, llm: 8, local: 8, run: 4 },
    )
  })

  it("the ceilings as read: an empty table is {}, a failed read with nothing good cached throws, a kept good read answers", async () => {
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(new Date("2026-10-30T12:00:00Z"))
    vi.spyOn(console, "warn").mockImplementation(() => undefined)
    expect(await cloudProviderCeilingsAsRead()).toEqual({})

    invalidateLaneConfigCache()
    db.tables.lane_provider_ceilings = { rows: [], error: { code: "08006", message: "connection failure" } }
    await expect(cloudProviderCeilingsAsRead()).rejects.toThrow("could not be read")
    await expect(cloudProviderCeilingsAsRead()).rejects.toThrow("could not be read") // a cache hit on the failure
    expect(await cloudProviderCeilings()).toEqual({}) // the lenient reader still answers

    invalidateLaneConfigCache()
    db.tables.lane_provider_ceilings = { rows: [{ provider: "kie", ceiling: 40 }] }
    expect(await cloudProviderCeilingsAsRead()).toEqual({ kie: 40 })
    db.tables.lane_provider_ceilings = { rows: [], error: { code: "08006", message: "connection failure" } }
    vi.advanceTimersByTime(60_000)
    expect(await cloudProviderCeilingsAsRead()).toEqual({ kie: 40 })
  })

  it("missing lane tables answer the code defaults, logged once per table", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)
    db.tables.lane_plan_sizes = { rows: [], error: MISSING_TABLE }
    db.tables.lane_user_overrides = { rows: [], error: { code: "PGRST205", message: "Could not find the table" } }
    db.tables.lane_provider_ceilings = { rows: [], error: { code: "42P01", message: "does not exist" } }
    db.tables.profiles.rows = [profile("u1", "pro"), profile("u2", "standard"), profile("u3", "free")]

    expect(await cloudLaneSizesFor(userLine("u1"))).toEqual(defaultLaneSizesForTier("pro"))
    expect(await cloudLaneSizesFor(userLine("u2"))).toEqual(defaultLaneSizesForTier("standard"))
    expect(await cloudLaneSizesFor(userLine("u3"))).toEqual(defaultLaneSizesForTier("free"))
    expect(await cloudProviderCeilings()).toEqual({})
    invalidateLaneConfigCache()
    expect(await cloudLaneSizesFor(userLine("u1"))).toEqual(defaultLaneSizesForTier("pro"))
    expect(await cloudProviderCeilings()).toEqual({})

    // One line per missing table for the life of the process, however many reads.
    expect(warn).toHaveBeenCalledTimes(3)
    for (const t of ["lane_plan_sizes", "lane_user_overrides", "lane_provider_ceilings"]) {
      expect(warn.mock.calls.filter(([m]) => String(m).includes(t))).toHaveLength(1)
    }
  })

  it("a missing column reads as a missing table", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined)
    db.tables.lane_user_overrides = { rows: [], error: { code: "42703", message: "column run does not exist" } }
    db.tables.profiles.rows = [profile("u1", "pro")]
    expect(await cloudLaneSizesFor(userLine("u1"))).toEqual({ provider: 11, llm: 21, local: 22, run: 9 })
  })

  it("reads the table again once it arrives (absence is not latched)", async () => {
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(new Date("2026-10-30T12:00:00Z"))
    vi.spyOn(console, "warn").mockImplementation(() => undefined)
    db.tables.lane_plan_sizes = { rows: [], error: MISSING_TABLE }
    db.tables.profiles.rows = [profile("u1", "pro")]
    expect(await cloudLaneSizesFor(userLine("u1"))).toEqual(defaultLaneSizesForTier("pro"))
    db.tables.lane_plan_sizes = { rows: SEEDED_PLANS.map((r) => ({ ...r })) }
    vi.advanceTimersByTime(60_000)
    expect(await cloudLaneSizesFor(userLine("u1"))).toEqual({ provider: 11, llm: 21, local: 22, run: 9 })
  })
})

describe("cloudPlanSizes", () => {
  it("is every plan tier, the table over the code defaults", async () => {
    db.tables.lane_plan_sizes.rows = db.tables.lane_plan_sizes.rows.filter((r) => r.tier !== "standard")
    const plans = await cloudPlanSizes()
    expect(Object.keys(plans).sort()).toEqual(["basic", "business", "enterprise", "free", "payg", "pro", "standard"])
    expect(plans.enterprise).toEqual(defaultLaneSizesForTier("business"))
    expect(plans.pro).toEqual({ provider: 11, llm: 21, local: 22, run: 9 })
    expect(plans.standard).toEqual(defaultLaneSizesForTier("standard"))
  })

  it("returns a fresh object every call", async () => {
    const a = await cloudPlanSizes()
    a.pro.provider = 999
    expect((await cloudPlanSizes()).pro.provider).toBe(11)
  })
})

describe("cloudProviderCeilings", () => {
  it("reads every valid row and skips a bad one", async () => {
    db.tables.lane_provider_ceilings.rows = [
      { provider: "kie", ceiling: 40 },
      { provider: "replicate", ceiling: 0 },
      { provider: "fal", ceiling: 2.5 },
      { provider: "", ceiling: 3 },
      { provider: "elevenlabs", ceiling: 8 },
    ]
    expect(await cloudProviderCeilings()).toEqual({ kie: 40, elevenlabs: 8 })
  })
})

describe("cloudLaneSettings", () => {
  it("reads the admin minutes", async () => {
    db.tables.app_settings.rows = [
      { key: "lane_queue_timeout_minutes", value: 30 },
      { key: "lane_live_wait_minutes", value: 2 },
    ]
    expect(await cloudLaneSettings()).toEqual({ queueTimeoutMs: 1_800_000, liveWaitLimitMs: 120_000 })
  })

  it.each([
    ["missing", []],
    [
      "out of range",
      [
        { key: "lane_queue_timeout_minutes", value: 4 },
        { key: "lane_live_wait_minutes", value: 61 },
      ],
    ],
    [
      "not integers",
      [
        { key: "lane_queue_timeout_minutes", value: "30" },
        { key: "lane_live_wait_minutes", value: 2.5 },
      ],
    ],
  ])("falls back to the env minutes when the values are %s", async (_label, rows) => {
    db.tables.app_settings.rows = rows as Row[]
    expect(await cloudLaneSettings()).toEqual({
      queueTimeoutMs: config.LANE_QUEUE_TIMEOUT_MINUTES * 60_000,
      liveWaitLimitMs: config.LANE_LIVE_WAIT_MINUTES * 60_000,
    })
  })

  it("holds each key to its own range", async () => {
    db.tables.app_settings.rows = [
      { key: "lane_queue_timeout_minutes", value: 1440 },
      { key: "lane_live_wait_minutes", value: 0 },
    ]
    expect(await cloudLaneSettings()).toEqual({
      queueTimeoutMs: 1440 * 60_000,
      liveWaitLimitMs: config.LANE_LIVE_WAIT_MINUTES * 60_000,
    })
  })
})
