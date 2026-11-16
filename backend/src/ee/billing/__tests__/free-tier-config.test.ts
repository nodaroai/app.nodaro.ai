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
// re-denomination; 652 lowered it with the grant (1,500 → 300). This pins the
// constants to the LATEST seeding migration, so changing a constant without
// re-seeding the table fails here instead of silently misreporting a user's
// allowance.

const MIGRATIONS_DIR = join(import.meta.dirname, "../../../../../supabase/migrations")

/**
 * Every SQL statement in the migrations that writes tier_config.monthly_credits
 * and can reach the 'free' row: an INSERT or UPDATE naming `monthly_credits`
 * that names 'free', or an UPDATE with no WHERE at all (every row).
 */
function freeMonthlyWrites(): Array<{ migration: string; statement: string }> {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort() // NNN_ prefix sorts chronologically
    .flatMap((f) =>
      readFileSync(join(MIGRATIONS_DIR, f), "utf8")
        .replace(/--.*$/gm, "") // comments may quote a statement; only code counts
        .split(";")
        .map((statement) => statement.trim())
        .filter((statement) => /\b(UPDATE|INSERT\s+INTO)\s+(public\.)?tier_config\b/i.test(statement))
        .filter((statement) => /\bmonthly_credits\b/i.test(statement))
        .filter((statement) => /'free'/i.test(statement) || (/^UPDATE\b/i.test(statement) && !/\bWHERE\b/i.test(statement)))
        .map((statement) => ({ migration: f, statement })),
    )
}

/**
 * monthly_credits for 'free' as the LATEST migration to write it leaves it.
 * Scanned rather than pinned to one file, like the daily limit below. The
 * latest write must be in the one form this reads — `UPDATE tier_config SET
 * monthly_credits = N[, …] WHERE tier = 'free'` — and anything else (an
 * INSERT … ON CONFLICT, a CASE, a bulk UPDATE) fails here by name rather than
 * being skipped for an older, recognised one.
 */
function latestSeededFreeMonthly(
  writes: ReadonlyArray<{ migration: string; statement: string }> = freeMonthlyWrites(),
): { value: number; migration: string } {
  const latest = writes[writes.length - 1]
  if (!latest) throw new Error("no migration seeds the free tier monthly_credits")
  const m = /^UPDATE\s+(public\.)?tier_config\s+SET\b[^;]*?\bmonthly_credits\s*=\s*(\d+)\b[^;]*\bWHERE\s+tier\s*=\s*'free'$/i.exec(
    latest.statement.replace(/\s+/g, " "),
  )
  if (!m) {
    throw new Error(
      `${latest.migration} writes tier_config.monthly_credits for 'free' in a form this test cannot read: ` +
        `"${latest.statement.replace(/\s+/g, " ")}". Write it as UPDATE tier_config SET monthly_credits = N WHERE tier = 'free', ` +
        `or teach latestSeededFreeMonthly the new form.`,
    )
  }
  return { value: Number(m[2]), migration: latest.migration }
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
    const { value, migration } = latestSeededFreeMonthly()
    expect(
      value,
      `${migration} leaves tier_config.monthly_credits for 'free' at ${value}, but TIER_CREDITS.free is ` +
        `${TIER_CREDITS.free}. Change both together (constant + re-seed migration).`,
    ).toBe(TIER_CREDITS.free)
  })

  it("a latest write in a form the scan cannot read fails by name — never skipped for an older one", () => {
    const writes = [
      ...freeMonthlyWrites(),
      {
        migration: "999_free_upsert.sql",
        statement:
          "INSERT INTO tier_config (tier, monthly_credits) VALUES ('free', 300) ON CONFLICT (tier) DO UPDATE SET monthly_credits = EXCLUDED.monthly_credits",
      },
    ]
    expect(() => latestSeededFreeMonthly(writes)).toThrow(/999_free_upsert\.sql/)
    // The recognised form, with another column beside it, still reads.
    expect(
      latestSeededFreeMonthly([{ migration: "998_x.sql", statement: "UPDATE tier_config SET monthly_credits = 300, daily_credit_limit = NULL WHERE tier = 'free'" }]),
    ).toEqual({ value: 300, migration: "998_x.sql" })
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

  it("free tier is a one-time 300 with no daily cap", () => {
    // Pinned explicitly: these are the numbers quoted to users, so a change
    // should be a deliberate edit here, not an incidental one elsewhere.
    // The daily cap was removed 2026-08-17 (migration 326) — the one-time
    // signup grant bounds free-tier exposure on its own. The grant was 1,500
    // until migration 652 lowered it to 300.
    expect(TIER_CREDITS.free).toBe(300)
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
    expect(TIER_CREDITS.free).toBe(300)
  })
})
