import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { TIER_CREDITS, FREE_TIER_RESTRICTIONS } from "../stripe-config.js"

// The free tier's numbers live in two places that nothing reconciles: the code
// constants below, and the `tier_config` DB row. Migration 067 repriced every
// paid tier and skipped `free`, so the row sat at an earlier pricing
// structure's 50/mo + 10/day while the code granted 150/mo + 50/day. The
// monthly figure is not cosmetic — getBalance returns it as `monthlyAllocation`,
// which the public SDK exposes via client.credits.balance().
//
// Migration 281 corrected the row; 287 re-seeded it for the credit
// re-denomination. This pins the constants to the LATEST seeding migration, so
// changing a constant without re-seeding the table fails here instead of
// silently misreporting a user's allowance.

const MIGRATIONS_DIR = join(import.meta.dirname, "../../../../../supabase/migrations")

const MIGRATION = join(MIGRATIONS_DIR, "287_credit_redenomination_tier_config.sql")

function seededFreeMonthly(): number {
  const sql = readFileSync(MIGRATION, "utf8")
  const monthly = /monthly_credits\s*=\s*(\d+)/.exec(sql)
  if (!monthly) throw new Error("could not parse the tier_config seeding migration")
  return Number(monthly[1])
}

/**
 * daily_credit_limit for 'free' as the LATEST migration to set it leaves it
 * (null = uncapped). Scanned rather than pinned to one file so a re-seed
 * without a matching constant change (or vice versa) fails here.
 */
function latestSeededFreeDaily(): { value: number | null; migration: string } {
  const hits = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort() // NNN_ prefix sorts chronologically
    .flatMap((f) => {
      const m = /daily_credit_limit\s*=\s*(NULL|\d+)\s+WHERE\s+tier\s*=\s*'free'/i.exec(
        readFileSync(join(MIGRATIONS_DIR, f), "utf8"),
      )
      return m ? [{ value: /null/i.test(m[1]!) ? null : Number(m[1]), migration: f }] : []
    })
  if (hits.length === 0) throw new Error("no migration seeds the free tier daily_credit_limit")
  return hits[hits.length - 1]!
}

describe("free tier_config row matches the code constants", () => {
  it("seeds monthly_credits from TIER_CREDITS.free", () => {
    expect(seededFreeMonthly()).toBe(TIER_CREDITS.free)
  })

  it("seeds daily_credit_limit from FREE_TIER_RESTRICTIONS.dailyCreditCap", () => {
    const { value, migration } = latestSeededFreeDaily()
    expect(
      value,
      `${migration} leaves tier_config.daily_credit_limit at ${value ?? "NULL"}, but ` +
        `FREE_TIER_RESTRICTIONS.dailyCreditCap is ${FREE_TIER_RESTRICTIONS.dailyCreditCap ?? "null"}. ` +
        `Change both together (constant + re-seed migration).`,
    ).toBe(FREE_TIER_RESTRICTIONS.dailyCreditCap)
  })

  it("free tier is 1,500/month with no daily cap", () => {
    // Pinned explicitly: these are the numbers quoted to users, so a change
    // should be a deliberate edit here, not an incidental one elsewhere.
    // The daily cap was removed 2026-08-17 (migration 326) — the one-time
    // 1,500 signup grant bounds free-tier exposure on its own.
    expect(TIER_CREDITS.free).toBe(1500)
    expect(FREE_TIER_RESTRICTIONS.dailyCreditCap).toBeNull()
  })
})

// THE THIRD HOME OF THE FREE GRANT — and the one that broke, twice.
//
// `handle_new_user()` (migration 001) inserts a profile without naming
// subscription_credits, so a new account's opening balance is decided ENTIRELY
// by that column's DEFAULT. For years that default WAS the free grant, and the
// 2026-07-30 x10 re-denomination moved every free-tier number except it (295
// repaired it). Then it was the whole abuse surface: a row that exists has
// been paid, and nothing in the application ever got to decide.
//
// Since migration 366 the default is ZERO and the grant is delivered by the
// claim path (`ee/billing/signup-grant.ts`), which tops the balance up to
// TIER_CREDITS.free for an account it decides to grant. So the invariant is
// now two-sided: the default must stay at zero (a re-raised default would
// silently pay every account BEFORE the decision, gated or not), and the
// amount the claim pays must be the advertised grant.
describe("profiles.subscription_credits default vs. the claim-delivered grant", () => {
  /** The default as the LATEST migration to set it leaves it. */
  function latestSeededDefault(): { value: number; migration: string } {
    const hits = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith(".sql"))
      .sort() // NNN_ prefix sorts chronologically
      .flatMap((f) => {
        const m = /ALTER\s+COLUMN\s+subscription_credits\s+SET\s+DEFAULT\s+(\d+)/i.exec(
          readFileSync(join(MIGRATIONS_DIR, f), "utf8"),
        )
        return m ? [{ value: Number(m[1]), migration: f }] : []
      })
    if (hits.length === 0) throw new Error("no migration sets the subscription_credits default")
    return hits[hits.length - 1]!
  }

  it("is ZERO — a new signup is paid by the claim decision, never by the column", () => {
    const { value, migration } = latestSeededDefault()
    expect(
      value,
      `${migration} leaves the signup default at ${value}. Since 366 the grant is claim-delivered; ` +
        `a non-zero default pays every account before the abuse gate can decide.`,
    ).toBe(0)
  })

  it("the claim pays TIER_CREDITS.free — the advertised grant, from the one constant", () => {
    const src = readFileSync(join(import.meta.dirname, "../signup-grant.ts"), "utf8")
    // Both transitions (claim and activate) pass the constant, never a literal.
    expect(src).toMatch(/p_grant_amount:\s*TIER_CREDITS\.free/)
    expect(src).not.toMatch(/p_grant_amount:\s*\d+/)
    expect(TIER_CREDITS.free).toBe(1500)
  })
})
