// @test-watches supabase/migrations/603_plan_change_credit_peak.sql
/**
 * Text guards on migration 603 (plan upgrades grant once per credit period,
 * only when paid). Behaviour is proven against a real Postgres by
 * supabase/tests/plan-change-credits.behavior.sql (CI "Migration Behavior").
 *
 *   1. Everything is service-role only: the table has RLS on and is revoked
 *      from PUBLIC, anon and authenticated; every function is SECURITY
 *      DEFINER with a pinned search_path, revoked from PUBLIC, anon and
 *      authenticated, and granted to service_role. Postgres grants EXECUTE to
 *      PUBLIC on a new function and PostgREST publishes every public-schema
 *      function, so a missed REVOKE is a self-serve credit grant.
 *   2. The grant locks the profile row before it reads the period, claims the
 *      invoice before it moves credits, and ADDS (never SETs) the pool.
 *   3. The period follows `credits_reset_at` through an AFTER UPDATE trigger.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const MIGRATIONS_DIR = join(__dirname, "..", "..", "..", "..", "..", "supabase", "migrations")
const RAW = readFileSync(join(MIGRATIONS_DIR, "603_plan_change_credit_peak.sql"), "utf8").replace(/\r/g, "")
const sql = RAW.replace(/--[^\n]*/g, "")

function functionBlock(name: string): string {
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`)
  expect(start, `function ${name} not found`).toBeGreaterThanOrEqual(0)
  return sql.slice(start, sql.indexOf("$$;", start) + 3)
}

const FUNCTIONS = [
  { name: "plan_credit_period_on_reset", signature: "public.plan_credit_period_on_reset()" },
  { name: "note_plan_credit_peak", signature: "public.note_plan_credit_peak(uuid, integer)" },
  {
    name: "grant_plan_change_credits",
    signature: "public.grant_plan_change_credits(uuid, text, integer, integer, numeric, text)",
  },
  { name: "restart_plan_credit_period", signature: "public.restart_plan_credit_period(uuid, integer)" },
] as const

describe("603 — service-role only", () => {
  it("the period table has RLS on and no browser role can touch it", () => {
    expect(sql).toMatch(/ALTER TABLE public\.plan_credit_periods ENABLE ROW LEVEL SECURITY;/)
    for (const role of ["PUBLIC", "anon", "authenticated"]) {
      expect(sql).toContain(`REVOKE ALL ON public.plan_credit_periods FROM ${role};`)
    }
    expect(sql).not.toMatch(/CREATE POLICY[^;]*plan_credit_periods/)
  })

  it.each(FUNCTIONS)("$name is SECURITY DEFINER with a pinned search_path, revoked from every browser role", ({ name, signature }) => {
    const block = functionBlock(name)
    expect(block).toMatch(/SECURITY DEFINER/)
    expect(block).toMatch(/SET search_path = public/)
    for (const role of ["PUBLIC", "anon", "authenticated"]) {
      expect(sql).toContain(`REVOKE ALL ON FUNCTION ${signature} FROM ${role};`)
    }
    expect(sql).toContain(`GRANT EXECUTE ON FUNCTION ${signature} TO service_role;`)
    expect(sql).not.toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION ${signature.replace(/[().]/g, "\\$&")} TO (anon|authenticated)`))
  })
})

describe("603 — the grant", () => {
  const block = functionBlock("grant_plan_change_credits")

  it("locks the profile, then claims the invoice, then moves credits — in that order", () => {
    const lock = block.indexOf("FROM profiles WHERE id = p_user_id FOR UPDATE")
    const claim = block.indexOf("ON CONFLICT (stripe_transaction_id) DO NOTHING")
    const add = block.indexOf("SET subscription_credits = subscription_credits + v_gap")
    expect(lock).toBeGreaterThan(0)
    expect(claim).toBeGreaterThan(lock)
    expect(add).toBeGreaterThan(claim)
  })

  it("adds the gap above the period's peak and the plan left, never SETs the pool or touches top-ups", () => {
    expect(block).toMatch(/v_base := GREATEST\(COALESCE\(v_peak, 0\), COALESCE\(p_from_credits, 0\)\);/)
    expect(block).toMatch(/v_gap {2}:= GREATEST\(0, p_to_credits - v_base\);/)
    expect(block).not.toMatch(/subscription_credits\s*=\s*p_/)
    expect(block).not.toMatch(/topup_credits/)
  })

  it("reads only the CURRENT period's peak", () => {
    expect(block).toMatch(/pcp\.period_reset_at IS NOT DISTINCT FROM v_reset/)
  })
})

describe("603 — a mid-period restart grants nothing", () => {
  const block = functionBlock("restart_plan_credit_period")

  it("locks the profile, stamps the reset, carries the peak, and never writes the pool", () => {
    const lock = block.indexOf("FROM profiles WHERE id = p_user_id FOR UPDATE")
    const stamp = block.indexOf("UPDATE profiles SET credits_reset_at = now() WHERE id = p_user_id")
    const carry = block.indexOf("INSERT INTO plan_credit_periods")
    expect(lock).toBeGreaterThan(0)
    expect(stamp).toBeGreaterThan(lock)
    expect(carry).toBeGreaterThan(stamp)
    expect(block).not.toMatch(/subscription_credits/)
    expect(block).not.toMatch(/topup_credits/)
  })
})

describe("603 — the period follows credits_reset_at", () => {
  it("an AFTER UPDATE trigger on profiles fires only when credits_reset_at moves", () => {
    expect(sql).toMatch(/DROP TRIGGER IF EXISTS plan_credit_period_on_reset ON public\.profiles;/)
    expect(sql).toMatch(
      /CREATE TRIGGER plan_credit_period_on_reset\s+AFTER UPDATE ON public\.profiles\s+FOR EACH ROW\s+WHEN \(NEW\.credits_reset_at IS DISTINCT FROM OLD\.credits_reset_at\)/,
    )
  })
})
