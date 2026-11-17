// @test-watches supabase/migrations/663_subscription_claim_one_live_per_user.sql
/**
 * Text guards on migration 663 (claim_subscription_grant: one live granted
 * subscription per account, decided where the plan grant is claimed).
 * Behaviour is proven against a real Postgres by
 * supabase/tests/subscription-claim-one-live.behavior.sql and
 * backend/scripts/verify-subscription-claim-concurrency.mjs (CI "Migration
 * Behavior").
 *
 *   1. Service-role only: SECURITY DEFINER, a pinned search_path, revoked
 *      from PUBLIC, anon and authenticated, granted to service_role.
 *   2. It locks the account's profile row before it reads the subscription.
 *   3. Its status lists are the billing code's: the ended statuses refuse a
 *      claim and never block one; another subscription blocks when it is
 *      claimed (plan_claimed_at) or granted in LIVE_SUBSCRIPTION_STATUSES. A
 *      status added on one side only fails here.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it, vi } from "vitest"

vi.mock("@/lib/supabase.js", () => ({ supabase: {} }))
vi.mock("@/ee/billing/credits.js", () => ({ CreditsService: {} }))
vi.mock("@/ee/notifications/founder-notify.js", () => ({ notifyPaidConversion: vi.fn() }))
vi.mock("@/ee/billing/balance-cache.js", () => ({ invalidateBalanceCache: vi.fn() }))

import { ENDED_STATUSES } from "../subscription-grant.js"
import { LIVE_SUBSCRIPTION_STATUSES } from "../downgrade-floor.js"

const MIGRATIONS_DIR = join(__dirname, "..", "..", "..", "..", "..", "supabase", "migrations")
const FILE = "663_subscription_claim_one_live_per_user.sql"
const strip = (text: string) => text.replace(/\r/g, "").replace(/--[^\n]*/g, "")
const sql = strip(readFileSync(join(MIGRATIONS_DIR, FILE), "utf8"))
const SIGNATURE = "public.claim_subscription_grant(text, uuid)"

const start = sql.indexOf("CREATE OR REPLACE FUNCTION public.claim_subscription_grant(")
const body = sql.slice(start, sql.indexOf("$$;", sql.indexOf("AS $$", start)) + 3)

const statusList = (pattern: RegExp) => {
  const match = pattern.exec(body)
  expect(match, String(pattern)).not.toBeNull()
  return new Set(match![1]!.split(",").map((s) => s.trim().replace(/^'|'$/g, "")))
}

describe("663 — claim_subscription_grant", () => {
  it("exists, returns the outcome table, and is SECURITY DEFINER with a pinned search_path", () => {
    expect(start).toBeGreaterThanOrEqual(0)
    expect(body).toMatch(
      /RETURNS TABLE \(outcome text, other_stripe_subscription_id text\)\s+LANGUAGE plpgsql\s+SECURITY DEFINER\s+SET search_path = public, pg_temp/,
    )
  })

  it("is service-role only", () => {
    for (const role of ["PUBLIC", "anon", "authenticated"]) {
      expect(sql).toContain(`REVOKE ALL ON FUNCTION ${SIGNATURE} FROM ${role};`)
    }
    expect(sql).toContain(`GRANT EXECUTE ON FUNCTION ${SIGNATURE} TO service_role;`)
  })

  it("locks the profile, then reads the subscription of that account", () => {
    const profileLock = body.search(/FROM profiles WHERE id = p_user_id FOR UPDATE/)
    const subscriptionRead = body.search(/FROM subscriptions s\s+WHERE s\.stripe_subscription_id = p_stripe_subscription_id\s+AND s\.user_id = p_user_id/)
    expect(profileLock).toBeGreaterThanOrEqual(0)
    expect(subscriptionRead).toBeGreaterThan(profileLock)
  })

  it("adds the claim time, nullable, idempotently", () => {
    expect(sql).toMatch(/ALTER TABLE public\.subscriptions\s+ADD COLUMN IF NOT EXISTS plan_claimed_at TIMESTAMPTZ NULL;/)
  })

  it("refuses the ended statuses the billing code names", () => {
    expect(statusList(/v_sub\.status IN \(([^)]*)\)/)).toEqual(new Set(ENDED_STATUSES))
  })

  it("is blocked by another subscription that has not ended and is claimed, or granted in exactly LIVE_SUBSCRIPTION_STATUSES", () => {
    expect(body).toMatch(/s\.id <> v_sub\.id/)
    expect(statusList(/AND s\.status NOT IN \(([^)]*)\)/)).toEqual(new Set(ENDED_STATUSES))
    expect(statusList(/s\.plan_granted IS TRUE AND s\.status IN \(([^)]*)\)/)).toEqual(new Set(LIVE_SUBSCRIPTION_STATUSES))
    expect(body).toMatch(/OR s\.plan_claimed_at IS NOT NULL/)
  })

  it("writes only the marker and the claim time, and only after every refusal", () => {
    expect(body.match(/UPDATE /g)).toHaveLength(1)
    const write = body.indexOf("UPDATE subscriptions")
    expect(body.slice(write)).toMatch(/SET plan_granted = true,\s+plan_claimed_at = now\(\)\s+WHERE id = v_sub\.id\s+AND plan_granted = false/)
    expect(body.indexOf("'other_live'")).toBeLessThan(write)
  })

  it("reloads PostgREST's schema cache", () => {
    expect(sql).toMatch(/NOTIFY pgrst, 'reload schema';/)
  })
})
