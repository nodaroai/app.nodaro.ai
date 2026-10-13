/**
 * Guards on migration 507: the neighbourhood hash and hosting mark on
 * signup_signals, and the 60-day signup_addresses table — service-role only,
 * like every signal table (an address is personal data and an oracle).
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const REPO_ROOT = join(__dirname, "..", "..", "..")
const sql = readFileSync(join(REPO_ROOT, "supabase", "migrations", "507_signup_network_signals.sql"), "utf8")

describe("migration 507 — signup network signals", () => {
  it("adds the two signal columns idempotently, the hash shaped like every other hash here", () => {
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS net_key_hash text CHECK \(net_key_hash IS NULL OR net_key_hash ~ '\^\[0-9a-f\]\{64\}\$'\)/)
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS hosting boolean/)
    expect(sql).toMatch(/CREATE INDEX IF NOT EXISTS idx_signup_signals_net_key_hash/)
  })

  it("signup_addresses is one row per account, RLS on, revoked from anon and authenticated, with no policy", () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS public\.signup_addresses \(\s+user_id uuid PRIMARY KEY REFERENCES public\.profiles\(id\) ON DELETE CASCADE/)
    expect(sql).toMatch(/address inet NOT NULL/)
    expect(sql).toMatch(/ALTER TABLE public\.signup_addresses ENABLE ROW LEVEL SECURITY/)
    expect(sql).toMatch(/REVOKE ALL ON public\.signup_addresses FROM anon, authenticated/)
    expect(sql).not.toMatch(/CREATE POLICY|GRANT /)
  })

  it("indexes created_at — the daily purge deletes by it", () => {
    expect(sql).toMatch(/CREATE INDEX IF NOT EXISTS idx_signup_addresses_created_at ON public\.signup_addresses \(created_at\)/)
  })
})
