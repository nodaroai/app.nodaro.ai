// @test-watches supabase/migrations/527_yearly_plan_monthly_credits.sql supabase/migrations/426_welcome_offer.sql
/**
 * Text guards on migration 527 (monthly credits on yearly plans) — the
 * invariants that are cheap to prove from the SQL and expensive to find in
 * production. Behaviour is proven against a real Postgres by
 * supabase/tests/yearly-monthly-credits.behavior.sql and, for two concurrent
 * callers, backend/scripts/verify-yearly-monthly-credits-concurrency.mjs (CI
 * "Migration Behavior").
 *
 *   1. `credits_reset_at` joins the profiles UPDATE denylist. The policy's
 *      guard (`check_profiles_update_allowed`) pins NAMED columns; any column it
 *      does not name is writable by the row's owner through PostgREST. The
 *      monthly grant is due when `credits_reset_at` is older than the month's
 *      anchor, so a writable column is a self-serve mint: rewind it, wait for
 *      the hourly run, repeat.
 *   2. The grant RPC is revoked from PUBLIC, anon AND authenticated (Postgres
 *      grants EXECUTE to PUBLIC on a new function, and PostgREST publishes
 *      every public-schema function at /rest/v1/rpc/), granted to the service
 *      role only, SECURITY DEFINER with its search_path pinned.
 *   3. It takes the profile's row lock before it decides, SETs the pool (never
 *      adds to it), never touches top-ups, and writes its ledger row in the
 *      same transaction as the grant.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const MIGRATIONS_DIR = join(__dirname, "..", "..", "..", "..", "..", "supabase", "migrations")
const RAW = readFileSync(join(MIGRATIONS_DIR, "527_yearly_plan_monthly_credits.sql"), "utf8").replace(/\r/g, "")
/** Comments blanked, line count preserved (the ordering checks index by line). */
const sql = RAW.replace(/--[^\n]*/g, "")
const lines = sql.split("\n")

/** 426's guard — the previous definition whose columns 527 must carry. */
const previous = readFileSync(join(MIGRATIONS_DIR, "426_welcome_offer.sql"), "utf8").replace(/\r/g, "")

function lineOf(re: RegExp): number {
  return lines.findIndex((l) => re.test(l))
}

/** p_-parameters of a guard definition, in order, identity arg included. */
function guardParams(text: string): string[] {
  const start = text.indexOf("CREATE OR REPLACE FUNCTION check_profiles_update_allowed(")
  expect(start, "no guard definition found").toBeGreaterThanOrEqual(0)
  const sig = text.slice(start, text.indexOf(") RETURNS BOOLEAN", start))
  return [...sig.matchAll(/p_(\w+)/g)].map((m) => m[1])
}

/** Body of `CREATE OR REPLACE FUNCTION public.<name>` up to its `$$;` close. */
function functionBlock(name: string): string {
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`)
  expect(start, `function ${name} not found`).toBeGreaterThanOrEqual(0)
  return sql.slice(start, sql.indexOf("$$;", start) + 3)
}

describe("527 — credits_reset_at joins the profiles UPDATE denylist", () => {
  const block = sql.slice(sql.indexOf('DROP POLICY IF EXISTS "Users can update own safe columns"'))

  it("drops the policy, then the OLD 21-arg overload, then recreates function and policy — in that order", () => {
    const dropPolicy = lineOf(/DROP POLICY IF EXISTS "Users can update own safe columns" ON public\.profiles/)
    const dropFn = lineOf(
      /DROP FUNCTION IF EXISTS check_profiles_update_allowed\(UUID, TEXT, TEXT, TEXT, INTEGER, INTEGER, INTEGER, INTEGER, BIGINT, INTEGER, TIMESTAMPTZ, BOOLEAN, INTEGER, INTEGER, INTEGER, TIMESTAMPTZ, INTEGER, DATE, TEXT, TEXT, BOOLEAN\)/,
    )
    const createFn = lineOf(/CREATE OR REPLACE FUNCTION check_profiles_update_allowed\(/)
    const createPolicy = lineOf(/CREATE POLICY "Users can update own safe columns" ON public\.profiles/)
    expect(dropPolicy, "no policy drop").toBeGreaterThanOrEqual(0)
    expect(dropFn, "the old 21-arg overload must be dropped explicitly").toBeGreaterThan(dropPolicy)
    expect(createFn, "guard recreation must follow the drops").toBeGreaterThan(dropFn)
    expect(createPolicy, "policy recreation must come last").toBeGreaterThan(createFn)
  })

  it("carries EVERY column 426 pinned, plus credits_reset_at — derived, not re-typed", () => {
    expect(guardParams(sql)).toEqual([...guardParams(previous), "credits_reset_at"])
  })

  it("pins credits_reset_at, and keeps every previous pin", () => {
    expect(block).toMatch(/p_credits_reset_at IS NOT DISTINCT FROM v\.credits_reset_at/)
    for (const c of guardParams(previous)) {
      if (c === "user_id") continue
      expect(block, `pin for ${c} lost in the recreation`).toMatch(new RegExp(`p_${c} IS NOT DISTINCT FROM v\\.${c}`))
    }
  })

  it("restates SECURITY DEFINER and the search_path pin inline", () => {
    const fn = block.slice(block.indexOf("CREATE OR REPLACE FUNCTION check_profiles_update_allowed"))
    const header = fn.slice(0, fn.indexOf("$$"))
    expect(header).toContain("SECURITY DEFINER")
    expect(header).toContain("SET search_path = public")
  })

  it("recreates the policy passing credits_reset_at through to the guard", () => {
    const policy = block.slice(block.indexOf('CREATE POLICY "Users can update own safe columns"'))
    expect(policy).toMatch(/auth\.uid\(\) = id/)
    expect(policy).toMatch(/welcome_consent_pending,\s*credits_reset_at\s*\)/)
  })
})

describe("527 — grant_yearly_plan_monthly_credits", () => {
  const fn = functionBlock("grant_yearly_plan_monthly_credits")
  const header = fn.slice(0, fn.indexOf("$$"))
  const body = fn.slice(fn.indexOf("$$"))
  const SIGNATURE = "public.grant_yearly_plan_monthly_credits(uuid, uuid, text, timestamptz, timestamptz, integer)"

  it("is SECURITY DEFINER with its search_path pinned, and returns whether it granted", () => {
    expect(header).toContain("RETURNS boolean")
    expect(header).toContain("SECURITY DEFINER")
    expect(header).toContain("SET search_path = public")
  })

  it("is revoked from PUBLIC, anon and authenticated, and executable by the service role only", () => {
    expect(sql).toContain(`REVOKE ALL ON FUNCTION ${SIGNATURE} FROM PUBLIC;`)
    expect(sql).toContain(`REVOKE ALL ON FUNCTION ${SIGNATURE} FROM anon;`)
    expect(sql).toContain(`REVOKE ALL ON FUNCTION ${SIGNATURE} FROM authenticated;`)
    expect(sql).toContain(`GRANT EXECUTE ON FUNCTION ${SIGNATURE} TO service_role;`)
    expect(sql).not.toMatch(/GRANT[^;]*grant_yearly_plan_monthly_credits[^;]*TO[^;]*\b(anon|authenticated|PUBLIC)\b/i)
  })

  it("locks the profile row before it decides, and re-reads the subscription under it", () => {
    const lock = body.search(/FROM profiles\s+WHERE id = p_user_id\s+FOR UPDATE/)
    const sub = body.search(/FROM subscriptions/)
    const write = body.search(/UPDATE profiles/)
    expect(lock, "the profile row lock").toBeGreaterThanOrEqual(0)
    expect(sub, "the subscription re-read comes after the lock").toBeGreaterThan(lock)
    expect(write, "the write comes after both").toBeGreaterThan(sub)
  })

  it("re-checks status, price, period and the reset stamp before it writes", () => {
    const decide = body.slice(0, body.search(/UPDATE profiles/))
    expect(decide).toMatch(/status IS DISTINCT FROM 'active'/)
    expect(decide).toMatch(/stripe_price_id IS DISTINCT FROM p_price_id/)
    expect(decide).toMatch(/current_period_start IS DISTINCT FROM p_period_start/)
    // Anchors arrive at millisecond precision: the start is compared at it too.
    expect(decide).toMatch(/p_anchor < date_trunc\('milliseconds', v_sub\.current_period_start\)/)
    expect(decide).toMatch(/p_anchor >= v_sub\.current_period_end/)
    expect(decide).toMatch(/p_anchor > now\(\)/)
    expect(decide).toMatch(/v_reset_at >= p_anchor/)
  })

  it("refuses an ended period, a profile marked ended, and a paused collection", () => {
    const decide = body.slice(0, body.search(/UPDATE profiles/))
    // A late grant after the period end would swallow the year-end renewal.
    expect(decide).toMatch(/now\(\) >= v_sub\.current_period_end/)
    // A cancel whose subscriptions update failed leaves the row 'active'; the
    // profile's subscription_ended_at (cleared by created/updated) still says so.
    expect(decide).toMatch(/SELECT credits_reset_at, subscription_ended_at INTO v_reset_at, v_ended_at/)
    expect(decide).toMatch(/v_ended_at IS NOT NULL/)
    expect(decide).toMatch(/v_sub\.collection_paused/)
  })

  it("adds subscriptions.collection_paused, idempotently, defaulting to not paused", () => {
    expect(sql).toMatch(/ALTER TABLE public\.subscriptions\s+ADD COLUMN IF NOT EXISTS collection_paused boolean NOT NULL DEFAULT false;/)
  })

  it("SETs the subscription pool to the plan amount — never adds to it — and never touches top-ups", () => {
    expect(body).toMatch(/SET subscription_credits = p_credits,\s*credits_reset_at = now\(\)/)
    expect(body).not.toMatch(/subscription_credits\s*=\s*subscription_credits\s*\+/)
    expect(body).not.toMatch(/topup_credits/)
  })

  it("writes its ledger row inside the grant's own transaction", () => {
    const write = body.search(/UPDATE profiles/)
    const ledger = body.search(/INSERT INTO credit_transactions/)
    expect(ledger).toBeGreaterThan(write)
    expect(body).toContain("'subscription_renewal'")
    expect(body).toContain("'Monthly credits — yearly plan'")
  })

  it("asks PostgREST to reload its schema so the new function is callable at once", () => {
    expect(sql).toMatch(/NOTIFY pgrst, 'reload schema';/)
  })
})
