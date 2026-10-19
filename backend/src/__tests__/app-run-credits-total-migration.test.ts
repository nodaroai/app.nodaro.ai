// @test-watches supabase/migrations/.sequence supabase/migrations/537_app_run_credits_total.sql supabase/tests/app-run-credits-total.behavior.sql
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { SERVER_STAMPED_TRIGGER_TYPES } from "../lib/server-started-runs.js"
import { APP_RUN_STAMP_KEY, appRunResumeStamp } from "../lib/app-run-stamp.js"
import { appRunCreditsUsed } from "../lib/app-run-credits.js"

/**
 * Migration 537 (decided 2026-10-19): an app run's `credits_used` is its total across its
 * attempts — the execution it points at plus every execution that one continued (a Retry's
 * `resumedFrom`). The walk runs in the database, so it restates the backend's trust rules for a
 * stamp (lib/server-started-runs.ts, lib/app-run-stamp.ts) in SQL; these pin that copy to the
 * TypeScript it mirrors. What it DOES is proven against a real Postgres in
 * supabase/tests/app-run-credits-total.behavior.sql (CI: Migration Behavior).
 */
const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, "../../..")
const sql = readFileSync(join(ROOT, "supabase/migrations/537_app_run_credits_total.sql"), "utf8")
const proof = readFileSync(join(ROOT, "supabase/tests/app-run-credits-total.behavior.sql"), "utf8")
/** The statements, comments removed. */
const code = sql.replace(/--.*$/gm, "")

/** The body of `CREATE OR REPLACE FUNCTION public.<fn>(` up to its closing `$$`, then the statement end. */
function fnBody(fn: string): string {
  const at = code.search(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${fn}\\(`))
  expect(at, `${fn} is defined`).toBeGreaterThanOrEqual(0)
  const rest = code.slice(at)
  const open = rest.indexOf("$$")
  const close = rest.indexOf("$$", open + 2)
  return rest.slice(0, rest.indexOf(";", close) + 1)
}

describe("migration 537 — an app run's credits are its total across attempts", () => {
  it("bumps .sequence to at least its number (migration-versions holds it equal to the highest)", () => {
    expect(Number(readFileSync(join(ROOT, "supabase/migrations/.sequence"), "utf8").trim())).toBeGreaterThanOrEqual(537)
  })

  it("trusts a stamp only on the lanes that write stamps — the same list as the backend", () => {
    const lists = [...code.matchAll(/trigger_type IN \(([^)]*)\)/g)].map((m) =>
      m[1]!.split(",").map((s) => s.trim().replace(/^'|'$/g, "")).sort(),
    )
    expect(lists.length).toBeGreaterThanOrEqual(2)
    for (const list of lists) expect(list).toEqual([...SERVER_STAMPED_TRIGGER_TYPES].sort())
  })

  it("reads the Retry's link under the keys the resume route writes", () => {
    const stamp = appRunResumeStamp("run", "exec") as Record<string, Record<string, string>>
    expect(Object.keys(stamp)).toEqual([APP_RUN_STAMP_KEY])
    expect(Object.keys(stamp[APP_RUN_STAMP_KEY]!).sort()).toEqual(["appRunId", "resumedFrom"])
    const total = fnBody("app_run_credits_total")
    expect(total).toContain(`trigger_data -> '${APP_RUN_STAMP_KEY}' ->> 'appRunId'`)
    expect(total).toContain(`trigger_data -> '${APP_RUN_STAMP_KEY}' ->> 'resumedFrom'`)
    // The link is followed only when the stamp names THIS run.
    expect(total).toMatch(/->> 'appRunId'\) = p_run_id::text/)
  })

  it("walks only the runner's own executions of one workflow, bounded and cycle-safe", () => {
    const total = fnBody("app_run_credits_total")
    expect(total).toMatch(/v_row\.user_id IS DISTINCT FROM p_runner_id/)
    expect(total).toMatch(/v_row\.workflow_id IS DISTINCT FROM v_workflow/)
    expect(total).toMatch(/cardinality\(v_seen\) < 100/)
    expect(total).toMatch(/EXIT WHEN v_id = ANY \(v_seen\)/)
    // A link is cast only once it reads as a uuid: a malformed one ends the walk, never raises.
    expect(total.indexOf("!~ '^[0-9a-f]{8}-")).toBeLessThan(total.indexOf("v_next::uuid"))
  })

  it("re-totals on every change of an execution's spend and every move of a run's pointer", () => {
    expect(code).toMatch(
      /CREATE TRIGGER trg_app_run_credits_on_execution_spend\s+AFTER UPDATE OF total_credits_used ON public\.workflow_executions\s+FOR EACH ROW\s+WHEN \(OLD\.total_credits_used IS DISTINCT FROM NEW\.total_credits_used\)/,
    )
    expect(code).toMatch(/CREATE TRIGGER trg_app_run_credits_on_pointer\s+BEFORE INSERT OR UPDATE OF execution_id ON public\.app_runs/)
    // Re-runnable.
    expect(code).toMatch(/DROP TRIGGER IF EXISTS trg_app_run_credits_on_execution_spend ON public\.workflow_executions;/)
    expect(code).toMatch(/DROP TRIGGER IF EXISTS trg_app_run_credits_on_pointer ON public\.app_runs;/)
  })

  it("never fails the write a trigger rides on", () => {
    for (const fn of ["app_run_credits_on_execution_spend", "app_run_credits_on_pointer"]) {
      expect(fnBody(fn), fn).toMatch(/EXCEPTION WHEN OTHERS THEN\s+RAISE WARNING/)
    }
  })

  it("the analytics trigger adds each execution's OWN spend and no longer writes the run's column", () => {
    const analytics = fnBody("update_app_analytics")
    expect(analytics).toMatch(/v_credits := COALESCE\(NEW\.total_credits_used, 0\);/)
    expect(analytics).toMatch(/total_credits = app_analytics\.total_credits \+ v_credits/)
    expect(analytics).not.toMatch(/UPDATE app_runs SET credits_used/)
    expect(analytics).not.toMatch(/app_run_credits_total/)
    expect(analytics).toMatch(/SECURITY DEFINER SET search_path = public;/)
  })

  it("the only writers of app_runs.credits_used go through the one helper (the backfill too)", () => {
    const writes = [...code.matchAll(/(?:SET credits_used = |NEW\.credits_used := )([^;\n]+)/g)].map((m) => m[1]!.trim())
    expect(writes.length).toBe(3)
    expect(writes).toEqual(["t.total", "v_total", "t.total"])
    expect([...code.matchAll(/public\.app_run_credits_total\(ar\.id, ar\.runner_id, ar\.execution_id\) AS total/g)]).toHaveLength(2)
  })

  it("the helper is no client's to call", () => {
    expect(code).toMatch(/REVOKE ALL ON FUNCTION public\.app_run_credits_total\(uuid, uuid, uuid\) FROM PUBLIC, anon, authenticated;/)
    for (const fn of ["app_run_credits_total", "app_run_credits_on_execution_spend", "app_run_credits_on_pointer"]) {
      expect(fnBody(fn), fn).toMatch(/SET search_path = public, pg_temp/)
    }
  })

  it("the behavior proof covers the decided cases", () => {
    for (const label of [
      "S1: failed attempt + Retry = the sum",
      "S1: analytics count each attempt''s spend once (30 + 20 + 5)",
      "S1: a second settlement of the same run is a no-op",
      "S2: a run without a Retry is its execution''s spend",
      "S3: a start-over is its own spend only",
      "S4: a webhook row''s posted stamp links nothing",
      "S5: another user''s execution is not summed",
      "S6: a link stamped for another run is not followed",
      "S7: a malformed link is its own spend",
    ]) {
      expect(proof, label).toContain(label)
    }
    expect(proof).toContain("ALL BEHAVIOR ASSERTIONS PASSED")
  })
})

describe("appRunCreditsUsed — what every run surface reports", () => {
  it("is the run's total (the column), not the current attempt's spend", () => {
    expect(appRunCreditsUsed({ credits_used: 50 }, { total_credits_used: 20 })).toBe(50)
  })

  it("a run never retried: the column and the execution agree", () => {
    expect(appRunCreditsUsed({ credits_used: 5 }, { total_credits_used: 5 })).toBe(5)
  })

  it("reads the execution's own spend when the row carries no total", () => {
    expect(appRunCreditsUsed({}, { total_credits_used: 7 })).toBe(7)
    expect(appRunCreditsUsed({ credits_used: null }, { total_credits_used: 7 })).toBe(7)
    expect(appRunCreditsUsed({ credits_used: null }, null)).toBe(0)
    expect(appRunCreditsUsed({})).toBe(0)
  })

  it("never reports less than the current attempt has spent (a stale column: before 537 applies, or a trigger that only warned)", () => {
    // Before 537 the column is written only when an execution ends: 0 for a run in flight.
    expect(appRunCreditsUsed({ credits_used: 0 }, { total_credits_used: 12 })).toBe(12)
    // A Retry in flight whose column still holds only the previous attempt.
    expect(appRunCreditsUsed({ credits_used: 30 }, { total_credits_used: 38 })).toBe(38)
    // A column that is the chain total is never below its own attempt, so the total stands.
    expect(appRunCreditsUsed({ credits_used: 38 }, { total_credits_used: 8 })).toBe(38)
  })
})
