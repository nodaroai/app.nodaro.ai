import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"

/**
 * Migration 373 — the admin read side of the free-credit abuse gate.
 *
 * Text-level pins for the properties that make this function SAFE rather than
 * merely present: it is service-role only (it is a lookup oracle over other
 * people's devices), it clamps the page arguments a client controls, and it
 * only ever READS signup_signals. The behavioral half — does a shared key
 * group, is a lone account absent, is an unknown axis zero rows, does
 * total_count survive paging, is `authenticated` actually refused — is
 * `supabase/tests/signup-signal-clusters.behavior.sql`, run against a real
 * Postgres by CI's migration-behavior job.
 */

const MIGRATION = join(import.meta.dirname, "../../../supabase/migrations/373_signup_signal_clusters.sql")
const RAW = readFileSync(MIGRATION, "utf8")
/** SQL with comments stripped, so a pin cannot be satisfied by prose. */
const SQL = RAW.split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n")

const SIGNATURE = "public.signup_signal_clusters(text, integer, integer)"

describe("373 — the function", () => {
  it("is replaceable, never a bare CREATE FUNCTION", () => {
    expect(SQL).toContain("CREATE OR REPLACE FUNCTION public.signup_signal_clusters(")
    expect(SQL).not.toMatch(/\bCREATE\s+(?!OR\s+REPLACE\s+)FUNCTION\b/)
  })

  it("is SECURITY DEFINER with a pinned search_path", () => {
    expect(SQL).toContain("SECURITY DEFINER")
    expect(SQL).toContain("SET search_path = public, pg_temp")
  })
})

describe("373 — service role only", () => {
  it("revokes EXECUTE from every client role", () => {
    for (const role of ["PUBLIC", "anon", "authenticated"]) {
      expect(SQL).toContain(`REVOKE EXECUTE ON FUNCTION ${SIGNATURE} FROM ${role};`)
    }
  })

  it("never grants it back", () => {
    expect(SQL).not.toMatch(/GRANT[\s\S]*?TO\s+(anon|authenticated|PUBLIC)/i)
  })
})

describe("373 — a client cannot make it scan the table", () => {
  it("clamps the page size and the offset", () => {
    expect(SQL).toMatch(/LEAST\(GREATEST\(COALESCE\(p_limit, 50\), 1\), 200\)/)
    expect(SQL).toMatch(/GREATEST\(COALESCE\(p_offset, 0\), 0\)/)
  })
})

describe("373 — it only reads", () => {
  it("writes nothing anywhere in the file", () => {
    for (const verb of [/\bINSERT\s+INTO\b/i, /\bUPDATE\s+\w/i, /\bDELETE\s+FROM\b/i, /\bALTER\s+TABLE\b/i]) {
      expect(SQL).not.toMatch(verb)
    }
  })

  it("keeps the cluster guard: claims only, and more than one account", () => {
    expect(SQL).toMatch(/HAVING count\(\*\) > 1/)
    expect(SQL).toMatch(/WHERE s\.source = 'claim'/)
  })
})

describe("373 — the allocator lock", () => {
  it("bumps .sequence at least to 373 (later migrations move it further)", () => {
    // A hard `toBe("373")` pin broke the first PR that added migration 374.
    // The shared migration-versions test already enforces ".sequence ==
    // highest migration"; this test only needs to prove 373 itself was
    // accounted for, so it is a floor, not an equality.
    const sequence = readFileSync(join(import.meta.dirname, "../../../supabase/migrations/.sequence"), "utf8").trim()
    expect(Number(sequence)).toBeGreaterThanOrEqual(373)
  })
})
