import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"

/**
 * Migration 366 — the enforcement half of the free-credit abuse gate.
 *
 * Text-level pins for the properties that make the enforcement SAFE rather
 * than merely present: the default drops to zero, both transitions stay
 * service-role-only, the card fingerprint is actually unique, and a deleted
 * account cannot free its card. The behavioral half (does the RPC lock?) runs
 * against a real Postgres in CI's migration-behavior job.
 */

const MIGRATION = join(import.meta.dirname, "../../../supabase/migrations/366_free_grant_enforce.sql")
const RAW = readFileSync(MIGRATION, "utf8")
/** SQL with comments stripped, so a pin cannot be satisfied by prose. */
const SQL = RAW.split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n")

describe("366 — the lever", () => {
  it("drops the signup default to ZERO", () => {
    expect(SQL).toMatch(/ALTER\s+TABLE\s+public\.profiles\s+ALTER\s+COLUMN\s+subscription_credits\s+SET\s+DEFAULT\s+0;/)
  })

  it("does not touch handle_new_user() — the column default is the only lever", () => {
    expect(SQL).not.toMatch(/handle_new_user/)
  })

  it("does not re-raise TIER_CREDITS anywhere — no second literal grant", () => {
    expect(SQL).not.toMatch(/\b1500\b/)
  })
})

describe("366 — claim_signup_grant learns to withhold", () => {
  it("drops the two-argument overload before creating the three-argument one", () => {
    const drop = SQL.indexOf("DROP FUNCTION IF EXISTS public.claim_signup_grant(uuid, integer);")
    const create = SQL.search(/CREATE OR REPLACE FUNCTION public\.claim_signup_grant\(\s*p_user_id uuid,\s*p_grant_amount integer,\s*p_withhold boolean DEFAULT false\s*\)/)
    expect(drop).toBeGreaterThan(-1)
    expect(create).toBeGreaterThan(drop)
  })

  it("defaults p_withhold so PR 1's two-argument call resolves during the deploy window", () => {
    expect(SQL).toMatch(/p_withhold boolean DEFAULT false/)
  })

  it("a withhold never touches the balance and never reports did_claim", () => {
    const withhold = /IF p_withhold THEN([\s\S]*?)ELSE/.exec(SQL)?.[1] ?? ""
    expect(withhold).toMatch(/SET free_grant_state = 'withheld'/)
    expect(withhold).not.toMatch(/subscription_credits\s*=/)
    expect(withhold).toMatch(/RETURNING false/)
  })

  it("keeps the 'unclaimed' predicate as the lock on BOTH branches", () => {
    const body = /IF p_withhold THEN([\s\S]*?)END IF;/.exec(SQL)?.[1] ?? ""
    expect(body.match(/free_grant_state = 'unclaimed'/g)).toHaveLength(2)
  })

  it("is SECURITY DEFINER with a pinned search_path, and revoked from every client role", () => {
    for (const fn of ["claim_signup_grant(uuid, integer, boolean)", "activate_signup_grant(uuid, integer)"]) {
      for (const role of ["PUBLIC", "anon", "authenticated"]) {
        expect(SQL).toContain(`REVOKE EXECUTE ON FUNCTION public.${fn} FROM ${role};`)
      }
      expect(SQL).not.toMatch(new RegExp(`GRANT[^;]*${fn.replace(/[()]/g, "\\$&")}`))
    }
    expect(SQL.match(/SECURITY DEFINER\s*\n\s*SET search_path = public, pg_temp/g)).toHaveLength(2)
  })
})

describe("366 — activate_signup_grant", () => {
  it("moves only 'withheld' rows, tops up with GREATEST, never lowers a balance", () => {
    const body = /FUNCTION public\.activate_signup_grant[\s\S]*?\$\$;/.exec(SQL)?.[0] ?? ""
    expect(body).toMatch(/AND p\.free_grant_state = 'withheld'/)
    expect(body).toMatch(/GREATEST\(p\.subscription_credits, p_grant_amount\)/)
    expect(body).toMatch(/SET free_grant_state = 'granted'/)
  })
})

describe("366 — free_grant_activations: one card, one grant", () => {
  const table = /CREATE TABLE IF NOT EXISTS public\.free_grant_activations \(([\s\S]*?)\);/.exec(SQL)?.[1] ?? ""

  it("is UNIQUE on the card fingerprint — the whole point of collecting it", () => {
    expect(table).toMatch(/UNIQUE \(card_fingerprint_hash\)/)
  })

  it("holds the fingerprint HASHED, and one row per user", () => {
    expect(table).toMatch(/card_fingerprint_hash text NOT NULL/)
    expect(table).toMatch(/UNIQUE \(user_id\)/)
  })

  it("survives account deletion — a deleted account cannot free its card", () => {
    expect(table).toMatch(/user_id uuid REFERENCES auth\.users\(id\) ON DELETE SET NULL/)
    expect(table).not.toMatch(/ON DELETE CASCADE/)
  })

  it("is service-role only: RLS on, no policy, revoked from anon and authenticated", () => {
    expect(SQL).toContain("ALTER TABLE public.free_grant_activations ENABLE ROW LEVEL SECURITY;")
    expect(SQL).not.toMatch(/CREATE POLICY[^;]*free_grant_activations/)
    expect(SQL).toContain("REVOKE ALL ON public.free_grant_activations FROM anon;")
    expect(SQL).toContain("REVOKE ALL ON public.free_grant_activations FROM authenticated;")
  })
})

describe("366 — the decision is recorded, and stays service-role", () => {
  it("adds decision / reasons / decided_at to signup_signals", () => {
    expect(SQL).toMatch(/ADD COLUMN IF NOT EXISTS decision text/)
    expect(SQL).toMatch(/ADD COLUMN IF NOT EXISTS reasons text\[\] NOT NULL DEFAULT '\{\}'/)
    expect(SQL).toMatch(/ADD COLUMN IF NOT EXISTS decided_at timestamptz/)
  })

  it("grants nothing back to a client role anywhere in the file", () => {
    expect(SQL).not.toMatch(/GRANT\s+[^;]*\s+TO\s+(anon|authenticated|PUBLIC)/i)
  })

  it("is idempotent — every statement can re-run", () => {
    expect(SQL).not.toMatch(/\bCREATE TABLE (?!IF NOT EXISTS)/)
    expect(SQL).not.toMatch(/\bCREATE INDEX (?!IF NOT EXISTS)/)
    expect(SQL).not.toMatch(/\bADD COLUMN (?!IF NOT EXISTS)/)
    expect(SQL).not.toMatch(/\bCREATE FUNCTION\b/) // only CREATE OR REPLACE
  })
})
