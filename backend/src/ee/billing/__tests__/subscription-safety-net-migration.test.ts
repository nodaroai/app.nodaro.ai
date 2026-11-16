// @test-watches supabase/migrations/656_subscription_unpaid_and_safety_net_renewal.sql
/**
 * Text guards on migration 656 (`unpaid` is a storable subscription status;
 * the renewal safety net grants in one locked database call). Behaviour is
 * proven against a real Postgres by
 * supabase/tests/subscription-safety-net-renewal.behavior.sql (CI "Migration
 * Behavior").
 *
 *   1. The status CHECK keeps every status it allowed and adds `unpaid`,
 *      re-created idempotently; every status the billing code names is one
 *      it accepts.
 *   2. The safety net's function is service-role only (SECURITY DEFINER, a
 *      pinned search_path, revoked from PUBLIC, anon and authenticated,
 *      granted to service_role), locks the profile before the subscription,
 *      and refuses a held, unpaid, ungranted or moved subscription and a pool
 *      already reset — every check before its one write.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it, vi } from "vitest"

vi.mock("@/lib/supabase.js", () => ({ supabase: {} }))
vi.mock("@/ee/billing/credits.js", () => ({ CreditsService: {} }))
vi.mock("@/ee/notifications/founder-notify.js", () => ({ notifyPaidConversion: vi.fn() }))
vi.mock("@/ee/billing/balance-cache.js", () => ({ invalidateBalanceCache: vi.fn() }))

import { ENDED_STATUSES, GRANTING_STATUSES, PAID_TIER_STATUSES } from "../subscription-grant.js"
import { HOLDING_STATUSES } from "../subscription-renewal.js"
import { LIVE_SUBSCRIPTION_STATUSES } from "../downgrade-floor.js"

const MIGRATIONS_DIR = join(__dirname, "..", "..", "..", "..", "..", "supabase", "migrations")
const FILE = "656_subscription_unpaid_and_safety_net_renewal.sql"
const strip = (text: string) => text.replace(/\r/g, "").replace(/--[^\n]*/g, "")
const sql = strip(readFileSync(join(MIGRATIONS_DIR, FILE), "utf8"))

const SIGNATURE = "public.renew_subscription_credits_safety_net(uuid, uuid, timestamptz, integer)"

function functionBlock(name: string): string {
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`)
  expect(start, `function ${name} not found`).toBeGreaterThanOrEqual(0)
  return sql.slice(start, sql.indexOf("$$;", sql.indexOf("AS $$", start)) + 3)
}

describe("656 — subscriptions.status accepts unpaid", () => {
  const check = /ADD CONSTRAINT subscriptions_status_check\s+CHECK \(status IN \(([^)]*)\)\);/.exec(sql)
  const statuses = new Set(check?.[1]?.split(",").map((s) => s.trim().replace(/^'|'$/g, "")) ?? [])

  it("drops and re-adds the CHECK with every status 650 allowed, plus unpaid", () => {
    expect(sql).toMatch(/ALTER TABLE public\.subscriptions DROP CONSTRAINT IF EXISTS subscriptions_status_check;/)
    expect(check, "the status CHECK is re-added").not.toBeNull()
    expect(statuses).toEqual(
      new Set(["active", "trialing", "past_due", "unpaid", "paused", "canceled", "incomplete", "incomplete_expired", "expired"]),
    )
  })

  it("accepts every status the billing code classifies", () => {
    const named = [...GRANTING_STATUSES, ...PAID_TIER_STATUSES, ...HOLDING_STATUSES, ...LIVE_SUBSCRIPTION_STATUSES, ...ENDED_STATUSES]
    expect(named.filter((s) => !statuses.has(s))).toEqual([])
  })
})

describe("656 — renew_subscription_credits_safety_net", () => {
  const body = functionBlock("renew_subscription_credits_safety_net")

  it("is SECURITY DEFINER with a pinned search_path and returns whether it granted", () => {
    expect(body).toMatch(/RETURNS boolean\s+LANGUAGE plpgsql\s+SECURITY DEFINER\s+SET search_path = public, pg_temp/)
  })

  it("is service-role only", () => {
    for (const role of ["PUBLIC", "anon", "authenticated"]) {
      expect(sql).toContain(`REVOKE ALL ON FUNCTION ${SIGNATURE} FROM ${role};`)
    }
    expect(sql).toContain(`GRANT EXECUTE ON FUNCTION ${SIGNATURE} TO service_role;`)
  })

  it("locks the profile, then the subscription, before deciding", () => {
    const profileLock = body.search(/FROM profiles\s+WHERE id = p_user_id\s+FOR UPDATE/)
    const subscriptionLock = body.search(/FROM subscriptions\s+WHERE id = p_subscription_id\s+AND user_id = p_user_id\s+FOR UPDATE/)
    expect(profileLock).toBeGreaterThanOrEqual(0)
    expect(subscriptionLock).toBeGreaterThan(profileLock)
  })

  it("refuses unless active, granted, unheld, the period end as read, and not reset since — all before its one write", () => {
    const write = body.indexOf("UPDATE profiles")
    expect(write).toBeGreaterThan(0)
    const decide = body.slice(0, write)
    expect(decide).toMatch(/v_sub\.status <> 'active'/)
    expect(decide).toMatch(/v_sub\.plan_granted IS NOT TRUE/)
    expect(decide).toMatch(/v_sub\.renewal_credits_held IS NOT NULL/)
    expect(decide).toMatch(/v_sub\.collection_paused IS TRUE/)
    expect(decide).toMatch(/v_sub\.current_period_end IS DISTINCT FROM p_period_end/)
    expect(decide).toMatch(/v_reset_at IS NOT NULL AND v_reset_at >= p_period_end/)
    expect(body.match(/UPDATE /g)).toHaveLength(1)
    expect(body.slice(write)).toMatch(/SET subscription_credits = p_credits,\s+credits_reset_at = now\(\)/)
    expect(body).not.toMatch(/topup_credits/)
  })

  it("reloads PostgREST's schema cache", () => {
    expect(sql).toMatch(/NOTIFY pgrst, 'reload schema';/)
  })
})
