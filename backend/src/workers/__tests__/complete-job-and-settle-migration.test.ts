// @test-watches supabase/migrations/513_complete_job_and_settle.sql backend/src/workers/shared.ts
/**
 * `complete_job_and_settle` (migration 513, its approval form 514) and its
 * callers agree.
 *
 * The behaviour itself is proven against a real Postgres by
 * `supabase/tests/complete-job-and-settle.behavior.sql`. This file pins what a
 * text read can: the grants, the live-status CAS, and that the SQL predicate
 * for "a ready managed reservation" is the same rule as the TypeScript one the
 * two-step fallback uses — a drift between them would settle on one path and
 * not the other.
 */
import { describe, it, expect, vi } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"

vi.mock("@/lib/supabase.js", () => ({ supabase: { from: vi.fn(), rpc: vi.fn() } }))

const ROOT = join(__dirname, "..", "..", "..", "..")
/** The function's current definition — the migration that last replaced it. */
const SQL = readFileSync(join(ROOT, "supabase", "migrations", "514_approve_held_job_and_settle.sql"), "utf8")
const SHARED = readFileSync(join(__dirname, "..", "shared.ts"), "utf8")
const REVIEW = readFileSync(join(__dirname, "..", "..", "lib", "job-policy-review.ts"), "utf8")
const SIG = "public.complete_job_and_settle(UUID, JSONB, BOOLEAN)"

describe("complete_job_and_settle (current definition: migration 514)", () => {
  it("is a SECURITY DEFINER with an empty search_path, executable by service_role only", () => {
    expect(SQL).toMatch(/SECURITY DEFINER SET search_path = ''/)
    for (const role of ["PUBLIC", "anon", "authenticated"]) {
      expect(SQL).toContain(`REVOKE ALL ON FUNCTION ${SIG} FROM ${role};`)
    }
    expect(SQL).toContain(`GRANT EXECUTE ON FUNCTION ${SIG} TO service_role;`)
    // Replaced, not overloaded: a two-argument named call must resolve to one function.
    expect(SQL).toContain("DROP FUNCTION IF EXISTS public.complete_job_and_settle(UUID, JSONB);")
  })

  it("completes only a live row for a worker, only a held row for an approval — the PostgREST CASes", () => {
    expect(SQL).toContain("CASE WHEN $3 THEN j.status = ''pending_review''")
    expect(SQL).toContain("ELSE j.status IN (''pending'', ''processing'') END")
    expect(SQL).toContain("p_from_review BOOLEAN DEFAULT FALSE")
    expect(SHARED).toContain('.in("status", ["pending", "processing"])')
    expect(REVIEW).toContain('.eq("status", "pending_review")')
    expect(REVIEW).toContain("completeJobAndSettleAtomically(jobId, completion, true)")
  })

  it("settles through the one managed settlement, inside a subtransaction", () => {
    expect(SQL).toMatch(/BEGIN\s+v_settlement := public\.settle_checkpointed_job_reservation\(v_usage_log_id\);\s+EXCEPTION WHEN OTHERS THEN/)
  })

  it("uses the same ready rule as isReadyManagedReservation", async () => {
    expect(SQL).toContain("v_metadata->>'reservation_mode' = 'job-once'")
    expect(SQL).toContain("v_metadata->'job_settlement_checkpoint'->'ready' = 'true'::jsonb OR v_metadata ? 'job_settlement'")

    const { isReadyManagedReservation } = await import("../shared.js")
    const checkpoint = (ready: unknown) => ({ reservation_mode: "job-once", job_settlement_checkpoint: { ready } })
    expect(isReadyManagedReservation(checkpoint(true))).toBe(true)
    expect(isReadyManagedReservation(checkpoint(false))).toBe(false)
    // JSON `true` only — the SQL compares against 'true'::jsonb, not a string.
    expect(isReadyManagedReservation(checkpoint("true"))).toBe(false)
    expect(isReadyManagedReservation({ reservation_mode: "job-once", job_settlement: {} })).toBe(true)
    expect(isReadyManagedReservation({ job_settlement_checkpoint: { ready: true } })).toBe(false)
    expect(isReadyManagedReservation(null)).toBe(false)
  })

  it("the caller reaches it only after the result gate's verdict", () => {
    const gate = SHARED.indexOf("const applied = await applyResultGate(")
    const call = SHARED.indexOf("await completeJobAndSettle(jobId, completion)")
    expect(gate).toBeGreaterThan(0)
    expect(call).toBeGreaterThan(gate)
    expect(SHARED.slice(gate, call)).toContain('if (applied !== "allow") return applied')
  })
})
