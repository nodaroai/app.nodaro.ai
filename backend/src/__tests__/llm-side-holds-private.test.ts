// @test-watches supabase/migrations/*.sql backend/src/**/*.ts
/**
 * Metered LLM side holds (migration 554) keep their billing ledger — the
 * provider's own dollar cost and the serving lanes — on their `llm_side_holds`
 * row. Like 552's `jobs.llm_billing`, it must never reach a user:
 *  1. 554 enables RLS with no policy and revokes the table from PUBLIC / anon /
 *     authenticated; no migration ever grants it to a client role;
 *  2. its functions run for the service role only;
 *  3. the only backend sources that name the table are a reasoned allowlist of
 *     server-only readers / writers;
 *  4. a side hold is no reservation OF its job: the reserve never hands the job
 *     to `reserve_credits` (its usage log carries no job, so nothing keyed on
 *     the job's holds can reach it) and never writes the job row.
 */
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { describe, expect, it } from "vitest"

const SRC = join(__dirname, "..")
const MIGRATIONS = join(__dirname, "..", "..", "..", "supabase", "migrations")
const SIDE = readFileSync(join(MIGRATIONS, "554_llm_side_holds.sql"), "utf8")

/** Backend sources that may name the table — each server-only, with why. */
const SIDE_HOLD_READERS: Record<string, string> = {
  "ee/billing/llm-side-hold-impl.ts": "THE implementation: reserves, notes, settles and sweeps side holds (service role)",
  "lib/llm-side-hold.ts": "the core shim: names the table in its docs; its CAS is the service-role RPC",
  "lib/reconcile/side-llm-holds.ts": "the reconcile pass: names the table in its docs (the impl reads it)",
  "ee/billing/credits.ts": "the reserve funnel's side-hold lane (the RPC writes the table), and the refund fallback reads a side log's job id from it for its ledger line (service role, never the ledger)",
  "ee/billing/llm-billing-impl.ts": "the settle's sink parameter: names the table in its docs",
  "ee/routes/admin-credit-audit-llm.ts": "D6 cost monitoring: the admin-only (requireAdmin) credit audit reads side-hold ledgers (service role)",
  "lib/job-step-charge.ts": "R53: sums each job's SETTLED side-hold charges (credits only, never the ledger) for a run step's charge (service role)",
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) {
      if (name === "__tests__" || name === "node_modules") continue
      walk(path, out)
    } else if (/\.ts$/.test(name)) out.push(path)
  }
  return out
}

describe("554 — the side-hold table is server-only", () => {
  it("RLS on, no policy, revoked from every client role", () => {
    expect(SIDE).toMatch(/ALTER TABLE public\.llm_side_holds ENABLE ROW LEVEL SECURITY;/)
    expect(SIDE).not.toMatch(/CREATE POLICY[^;]*llm_side_holds/i)
    for (const role of ["PUBLIC", "anon", "authenticated"]) {
      expect(SIDE).toMatch(new RegExp(`REVOKE ALL ON TABLE public\\.llm_side_holds FROM ${role};`))
    }
    expect(SIDE).toMatch(/GRANT ALL ON TABLE public\.llm_side_holds TO service_role;/)
  })

  it("no migration grants it to anon / authenticated", () => {
    for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql"))) {
      const sql = readFileSync(join(MIGRATIONS, file), "utf8")
      expect(sql, file).not.toMatch(/GRANT[^;]*ON\s+(TABLE\s+)?(public\.)?llm_side_holds[^;]*TO[^;]*(anon|authenticated|PUBLIC)/i)
    }
  })

  it("its functions are revoked from every client role and granted to the service role only", () => {
    for (const fn of ["reserve_llm_side_hold", "llm_side_hold_call_starting", "refund_settled_side_hold", "reverse_settled_llm_charge", "refund_settled_metered_charge"]) {
      expect(SIDE).toMatch(new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}\\([^)]*\\) FROM PUBLIC, anon, authenticated;`))
      expect(SIDE).toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn}\\([^)]*\\) TO service_role;`))
      expect(SIDE).not.toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn}\\([^)]*\\) TO (anon|authenticated)`))
    }
  })

  it("only the reasoned allowlist of server-only sources names the table", () => {
    const naming = walk(SRC)
      .filter((f) => readFileSync(f, "utf8").includes("llm_side_holds"))
      .map((f) => relative(SRC, f))
      .sort()
    expect(naming).toEqual(Object.keys(SIDE_HOLD_READERS).sort())
  })
})

describe("554 — a side hold is no reservation of its job", () => {
  const reserve = SIDE.slice(SIDE.indexOf("CREATE OR REPLACE FUNCTION public.reserve_llm_side_hold"), SIDE.indexOf("CREATE OR REPLACE FUNCTION public.llm_side_hold_call_starting"))

  it("the debit is made with NO job, so 391's 'job already has usage', the managed checkpoints and every job-keyed refund never see it", () => {
    expect(reserve).toMatch(/public\.reserve_credits\(p_user_id, p_credits, NULL, p_charge_id/)
    expect(reserve).not.toMatch(/UPDATE public\.jobs/i)
  })

  it("the call-start CAS stamps the hold, never the job's own call stamp or reconcile state", () => {
    const start = SIDE.slice(SIDE.indexOf("CREATE OR REPLACE FUNCTION public.llm_side_hold_call_starting"), SIDE.indexOf("CREATE OR REPLACE FUNCTION public.refund_settled_side_hold"))
    expect(start).not.toMatch(/UPDATE public\.jobs/i)
    expect(start).toMatch(/FROM public\.jobs WHERE id = v_job_id FOR SHARE/)
  })
})

describe("554 — R57's platform refund reverses only a SIDE log, never twice", () => {
  const refund = SIDE.slice(SIDE.indexOf("CREATE OR REPLACE FUNCTION public.refund_settled_side_hold"))
  it("acts only on a committed side log and never on the job row", () => {
    expect(refund).toMatch(/v_usage\.status IS DISTINCT FROM 'committed'\s+OR v_usage\.metadata->>'reservation_mode' IS DISTINCT FROM 'side'/)
    expect(refund).not.toMatch(/UPDATE public\.jobs/i)
  })

  it("R61's job-charge reversal acts only on the job's OWN committed non-side log, only once the job is failed or cancelled", () => {
    const own = SIDE.slice(SIDE.indexOf("CREATE OR REPLACE FUNCTION public.refund_settled_metered_charge"))
    expect(own).toMatch(/v_usage\.job_id IS DISTINCT FROM p_job_id/)
    expect(own).toMatch(/v_usage\.metadata->>'reservation_mode' IS NOT DISTINCT FROM 'side'/)
    expect(own).toMatch(/v_status NOT IN \('failed', 'cancelled'\)/)
    expect(own).not.toMatch(/UPDATE public\.jobs/i)
  })
})
