import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"

/**
 * Migration 492 — the network axis of signup_signal_clusters counts real
 * client networks only.
 *
 * Text-level pins, like 373's: the replacement keeps every property that made
 * the function safe (service-role only, clamped, read-only) and adds the one
 * thing it is for — a row without `ip_scheme = 'client'` has no network key.
 * The behavioral half (a proxy-era row neither forms nor joins a network
 * cluster) is `supabase/tests/signup-signal-clusters.behavior.sql`.
 */

const MIGRATION = join(import.meta.dirname, "../../../supabase/migrations/492_signup_signal_clusters_client_networks.sql")
const RAW = readFileSync(MIGRATION, "utf8")
/** SQL with comments stripped, so a pin cannot be satisfied by prose. */
const SQL = RAW.split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n")

const SIGNATURE = "public.signup_signal_clusters(text, integer, integer)"

describe("492 — the network axis", () => {
  it("takes ip_hash only from rows marked as a real client network", () => {
    expect(SQL).toMatch(/WHEN 'ip'\s+THEN CASE WHEN s\.ip_scheme = 'client' THEN s\.ip_hash END/)
  })

  it("leaves the device and browser axes as they were", () => {
    expect(SQL).toMatch(/WHEN 'device'\s+THEN s\.device_key/)
    expect(SQL).toMatch(/WHEN 'browser'\s+THEN s\.browser_key/)
  })
})

describe("492 — still the same safe function", () => {
  it("is replaceable, SECURITY DEFINER, with a pinned search_path", () => {
    expect(SQL).toContain("CREATE OR REPLACE FUNCTION public.signup_signal_clusters(")
    expect(SQL).not.toMatch(/\bCREATE\s+(?!OR\s+REPLACE\s+)FUNCTION\b/)
    expect(SQL).toContain("SECURITY DEFINER")
    expect(SQL).toContain("SET search_path = public, pg_temp")
  })

  it("revokes EXECUTE from every client role and never grants it back", () => {
    for (const role of ["PUBLIC", "anon", "authenticated"]) {
      expect(SQL).toContain(`REVOKE EXECUTE ON FUNCTION ${SIGNATURE} FROM ${role};`)
    }
    expect(SQL).not.toMatch(/GRANT[\s\S]*?TO\s+(anon|authenticated|PUBLIC)/i)
  })

  it("clamps the page size and the offset, keeps the claim-only and more-than-one guards, and the 25-id cap", () => {
    expect(SQL).toMatch(/LEAST\(GREATEST\(COALESCE\(p_limit, 50\), 1\), 200\)/)
    expect(SQL).toMatch(/GREATEST\(COALESCE\(p_offset, 0\), 0\)/)
    expect(SQL).toContain("WHERE s.source = 'claim'")
    expect(SQL).toContain("HAVING count(*) > 1")
    expect(SQL).toContain("[1:25]")
  })

  it("writes nothing anywhere in the file", () => {
    for (const verb of [/\bINSERT\s+INTO\b/i, /\bUPDATE\s+\w/i, /\bDELETE\s+FROM\b/i, /\bALTER\s+TABLE\b/i]) {
      expect(SQL).not.toMatch(verb)
    }
  })
})

describe("492 — the allocator lock", () => {
  it("bumps .sequence at least to 492", () => {
    const sequence = readFileSync(join(import.meta.dirname, "../../../supabase/migrations/.sequence"), "utf8").trim()
    expect(Number(sequence)).toBeGreaterThanOrEqual(492)
  })
})
