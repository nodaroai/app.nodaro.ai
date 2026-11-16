// @test-watches supabase/migrations/654_subscription_renewal_on_paid_invoice.sql supabase/migrations/.sequence
/**
 * Text guards on migration 654 (a failed renewal charge puts the period's
 * credits on hold; they come back once, when the renewal is paid). Behaviour
 * is proven against a real Postgres by
 * supabase/tests/subscription-renewal-credits.behavior.sql (CI "Migration
 * Behavior").
 *
 *   1. Both functions are service-role only: SECURITY DEFINER with a pinned
 *      search_path, revoked from PUBLIC, anon and authenticated, granted to
 *      service_role. Postgres grants EXECUTE to PUBLIC on a new function and
 *      PostgREST publishes every public-schema function, so a missed REVOKE
 *      lets an account hold or release its own credits.
 *   2. Both lock the profile before the subscription (the order every pool
 *      write uses), never touch top-ups, never raise, and write no ledger row
 *      (the caller does).
 *   3. The release decides before it writes: the claim comes before any
 *      credit moves, and a held amount is ADDED back, never SET.
 *   4. The ended statuses both refuse are the ones the webhook treats as ended.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it, vi } from "vitest"

vi.mock("@/lib/supabase.js", () => ({ supabase: {} }))
vi.mock("@/ee/billing/credits.js", () => ({ CreditsService: {} }))
vi.mock("@/ee/notifications/founder-notify.js", () => ({ notifyPaidConversion: vi.fn() }))
vi.mock("@/ee/billing/balance-cache.js", () => ({ invalidateBalanceCache: vi.fn() }))

import { ENDED_STATUSES } from "../subscription-grant.js"

const MIGRATIONS_DIR = join(__dirname, "..", "..", "..", "..", "..", "supabase", "migrations")
const FILE = "654_subscription_renewal_on_paid_invoice.sql"
const strip = (text: string) => text.replace(/\r/g, "").replace(/--[^\n]*/g, "")
const sql = strip(readFileSync(join(MIGRATIONS_DIR, FILE), "utf8"))

function functionBlock(text: string, name: string): string {
  const start = text.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`)
  expect(start, `function ${name} not found`).toBeGreaterThanOrEqual(0)
  return text.slice(start, text.indexOf("$$;", text.indexOf("AS $$", start)) + 3)
}

const FUNCTIONS = [
  {
    name: "hold_subscription_renewal_credits",
    signature: "public.hold_subscription_renewal_credits(uuid, text, timestamptz)",
  },
  {
    name: "release_subscription_renewal_credits",
    signature: "public.release_subscription_renewal_credits(uuid, text, text, timestamptz, timestamptz, integer, numeric, text)",
  },
] as const

function at(block: string, needle: string): number {
  const i = block.indexOf(needle)
  expect(i, `"${needle}" not found`).toBeGreaterThan(0)
  return i
}

describe("654 — the migration number", () => {
  it("is the number .sequence holds", () => {
    const sequence = readFileSync(join(MIGRATIONS_DIR, ".sequence"), "utf8").trim()
    expect(Number(sequence)).toBeGreaterThanOrEqual(654)
    expect(FILE.startsWith("654_")).toBe(true)
  })
})

describe("654 — service-role only", () => {
  it.each(FUNCTIONS)("$name is SECURITY DEFINER with a pinned search_path, revoked from every browser role", ({ name, signature }) => {
    const block = functionBlock(sql, name)
    expect(block).toMatch(/SECURITY DEFINER/)
    expect(block).toMatch(/SET search_path = public, pg_temp/)
    for (const role of ["PUBLIC", "anon", "authenticated"]) {
      expect(sql).toContain(`REVOKE ALL ON FUNCTION ${signature} FROM ${role};`)
    }
    expect(sql).toContain(`GRANT EXECUTE ON FUNCTION ${signature} TO service_role;`)
    expect(sql).not.toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION ${signature.replace(/[().]/g, "\\$&")} TO (anon|authenticated|PUBLIC)`))
  })

  it.each(FUNCTIONS)("$name locks the profile before the subscription, never touches top-ups, never raises, writes no ledger row", ({ name }) => {
    const block = functionBlock(sql, name)
    const profile = at(block, "FROM profiles\n   WHERE id = p_user_id\n     FOR UPDATE;")
    const subscription = at(block, "FROM subscriptions")
    expect(subscription).toBeGreaterThan(profile)
    expect(block).not.toMatch(/topup_credits/)
    expect(block).not.toMatch(/RAISE/)
    expect(block).not.toMatch(/credit_transactions/)
  })

  it.each(FUNCTIONS)("$name refuses exactly the webhook's ENDED_STATUSES and a subscription never granted", ({ name }) => {
    const block = functionBlock(sql, name)
    const list = /v_sub\.status IN \(([^)]*)\)/.exec(block)
    expect(list, "an ended-status list").not.toBeNull()
    const statuses = list![1]!.split(",").map((s) => s.trim().replace(/^'|'$/g, ""))
    expect(new Set(statuses)).toEqual(new Set(ENDED_STATUSES))
    expect(block).toMatch(/v_sub\.plan_granted IS NOT TRUE/)
  })

  it("asks PostgREST to reload its schema cache", () => {
    expect(sql).toMatch(/NOTIFY pgrst, 'reload schema';/)
  })
})

describe("654 — the hold", () => {
  const block = functionBlock(sql, "hold_subscription_renewal_credits")

  it("holds once per period: a period already held or settled, or one the subscription has left, holds nothing", () => {
    expect(block).toMatch(/v_sub\.renewal_hold_period_start >= p_period_start THEN\s+RETURN NULL;/)
    expect(block).toMatch(/p_period_start < v_sub\.current_period_start THEN\s+RETURN NULL;/)
  })

  it("records the hold before it empties the pool, and never holds below zero", () => {
    const record = at(block, "SET renewal_hold_period_start = p_period_start,")
    const empty = at(block, "UPDATE profiles SET subscription_credits = 0")
    expect(empty).toBeGreaterThan(record)
    expect(block).toMatch(/v_held := GREATEST\(COALESCE\(v_pool, 0\), 0\);/)
  })
})

describe("654 — the release", () => {
  const block = functionBlock(sql, "release_subscription_renewal_credits")

  it("claims the invoice before any credit moves, keyed by the invoice id", () => {
    const claim = at(block, "ON CONFLICT (stripe_transaction_id) DO NOTHING;")
    expect(block).toMatch(
      /INSERT INTO transactions \(user_id, stripe_transaction_id, type, amount_usd, credits_granted, tier\)\s+VALUES \(p_user_id, p_invoice_id, 'subscription',/,
    )
    for (const m of block.matchAll(/UPDATE (profiles|subscriptions)/g)) {
      expect(m.index ?? -1).toBeGreaterThan(claim)
    }
  })

  it("ADDs a held amount back (keeps what was granted during the hold), and SETs only a period never reset", () => {
    expect(block).toMatch(/SET subscription_credits = subscription_credits \+ v_give/)
    expect(block).toMatch(/IF v_reset_at IS NULL OR v_reset_at < p_period_start THEN/)
    expect(block).toMatch(/SET subscription_credits = v_give,\s+credits_reset_at = now\(\)/)
    // The catch-up never lowers the pool: what was granted while it waited is kept.
    expect(block).toMatch(/v_give := GREATEST\(p_credits, COALESCE\(v_pool, 0\)\);/)
  })

  it("releases a hold within a day of the invoice's period start, and reports a hold it drops instead of losing it silently", () => {
    expect(block).toMatch(/v_sub\.renewal_hold_period_start > p_period_start - interval '1 day'/)
    expect(block).toMatch(/v_sub\.renewal_hold_period_start < p_period_start \+ interval '1 day'/)
    expect(block).toMatch(/'dropped'::text, v_dropped/)
  })

  it("an older or finished period's invoice gives nothing", () => {
    expect(block).toMatch(/p_period_start < v_sub\.current_period_start - interval '1 day'/)
    expect(block).toMatch(/p_period_end <= now\(\)/)
  })
})
