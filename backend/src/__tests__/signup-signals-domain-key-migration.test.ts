/**
 * Guards on migration 506 (`signup_signals.domain_key`): the column the
 * one-grant-per-organisation rule counts on, its index, and the backfill
 * that lets a claim made tomorrow count the accounts made last month.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const REPO_ROOT = join(__dirname, "..", "..", "..")
const sql = readFileSync(join(REPO_ROOT, "supabase", "migrations", "506_signup_signals_domain_key.sql"), "utf8")

describe("migration 506 — signup_signals.domain_key", () => {
  it("adds the column idempotently, bounded like a domain name", () => {
    expect(sql).toMatch(/ALTER TABLE public\.signup_signals\s+ADD COLUMN IF NOT EXISTS domain_key text/)
    expect(sql).toMatch(/char_length\(domain_key\) <= 253/)
  })

  it("indexes it — the rule counts by equality on every claim", () => {
    expect(sql).toMatch(/CREATE INDEX IF NOT EXISTS idx_signup_signals_domain_key ON public\.signup_signals \(domain_key\)/)
  })

  it("backfills existing claim rows from the account's email, only where empty", () => {
    expect(sql).toMatch(/UPDATE public\.signup_signals AS s\s+SET domain_key = lower\(split_part\(p\.email, '@', 2\)\)/)
    expect(sql).toMatch(/s\.domain_key IS NULL/)
  })

  it("does not touch the table's RLS or grants", () => {
    expect(sql).not.toMatch(/CREATE POLICY|GRANT /)
  })
})
