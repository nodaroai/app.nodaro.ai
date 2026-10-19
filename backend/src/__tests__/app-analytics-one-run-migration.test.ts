// @test-watches supabase/migrations/.sequence supabase/migrations/538_app_analytics_one_run.sql supabase/migrations/539_app_analytics_one_run_backfill.sql supabase/tests/app-analytics-one-run.behavior.sql backend/src/services/app-execution.ts backend/src/routes/app-runner.ts backend/src/routes/app-run-resume.ts
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { SERVER_STAMPED_TRIGGER_TYPES } from "../lib/server-started-runs.js"
import { APP_RUN_STAMP_KEY, appRunResumeStamp } from "../lib/app-run-stamp.js"

/**
 * Migration 538 (decided 2026-10-19): a creator's app analytics count an app run ONCE, by its
 * final outcome. A Retry is the same run going on: it adds no run and moves the run's outcome on
 * the day the run was counted. The decision "is this ending execution a Retry of this run" runs in
 * the database, so it restates the backend's trust rules for a stamp (lib/server-started-runs.ts,
 * lib/app-run-stamp.ts) in SQL; these pin that copy to the TypeScript it mirrors. What it DOES is
 * proven against a real Postgres in supabase/tests/app-analytics-one-run.behavior.sql (CI:
 * Migration Behavior).
 */
const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, "../../..")
const sql = readFileSync(join(ROOT, "supabase/migrations/538_app_analytics_one_run.sql"), "utf8")
const backfillSql = readFileSync(join(ROOT, "supabase/migrations/539_app_analytics_one_run_backfill.sql"), "utf8")
const proof = readFileSync(join(ROOT, "supabase/tests/app-analytics-one-run.behavior.sql"), "utf8")
/** The statements, comments removed. */
const code = sql.replace(/--.*$/gm, "")
const backfillCode = backfillSql.replace(/--.*$/gm, "")

/** The body of `CREATE OR REPLACE FUNCTION public.<fn>(` up to its closing `$$`, then the statement end. */
function fnBody(fn: string, src: string = code): string {
  const at = src.search(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${fn}\\(`))
  expect(at, `${fn} is defined`).toBeGreaterThanOrEqual(0)
  const rest = src.slice(at)
  const open = rest.indexOf("$$")
  const close = rest.indexOf("$$", open + 2)
  return rest.slice(0, rest.indexOf(";", close) + 1)
}

describe("migration 538 — an app run counts once in its app's analytics", () => {
  it("bumps .sequence to at least its number (migration-versions holds it equal to the highest)", () => {
    expect(Number(readFileSync(join(ROOT, "supabase/migrations/.sequence"), "utf8").trim())).toBeGreaterThanOrEqual(538)
  })

  it("trusts a Retry stamp only on the lanes that write stamps — the same list as the backend", () => {
    const lists = [...(code + backfillCode).matchAll(/trigger_type IN \(([^)]*)\)/g)].map((m) =>
      m[1]!.split(",").map((s) => s.trim().replace(/^'|'$/g, "")).sort(),
    )
    // The trigger, the backfill's candidates, its chain walk and its refused-Retry lookup.
    expect(lists.length).toBeGreaterThanOrEqual(4)
    for (const list of lists) expect(list).toEqual([...SERVER_STAMPED_TRIGGER_TYPES].sort())
  })

  it("reads the Retry's link under the keys the resume route writes, naming THIS run", () => {
    const stamp = appRunResumeStamp("run", "exec") as Record<string, Record<string, string>>
    expect(Object.keys(stamp)).toEqual([APP_RUN_STAMP_KEY])
    expect(Object.keys(stamp[APP_RUN_STAMP_KEY]!).sort()).toEqual(["appRunId", "resumedFrom"])
    const trigger = fnBody("update_app_analytics")
    expect(trigger).toContain(`NEW.trigger_data -> '${APP_RUN_STAMP_KEY}' ->> 'appRunId'`)
    expect(trigger).toContain(`NEW.trigger_data -> '${APP_RUN_STAMP_KEY}' ->> 'resumedFrom'`)
    expect(trigger).toMatch(/->> 'appRunId'\) = v_run_id::text/)
    // A link is cast only once it reads as a uuid: a malformed one is no Retry, never an error.
    expect(trigger.indexOf("!~ '^[0-9a-f]{8}-")).toBeLessThan(trigger.indexOf("v_from::uuid"))
    const backfill = fnBody("app_analytics_recount_retried_runs", backfillCode)
    expect(backfill).toMatch(/->> 'appRunId'\) = ar\.id::text/)
    expect(backfill).toMatch(/->> 'appRunId'\) = v_run\.id::text/)
  })

  it("a Retry adds no run: only a new run's branch adds to total_runs", () => {
    const trigger = fnBody("update_app_analytics")
    expect([...trigger.matchAll(/total_runs = app_analytics\.total_runs \+ 1/g)]).toHaveLength(1)
    const from = trigger.indexOf("IF v_same_run THEN")
    const to = trigger.indexOf("v_counted_on := v_today;")
    expect(from).toBeGreaterThanOrEqual(0)
    expect(to).toBeGreaterThan(from)
    const retryBranch = trigger.slice(from, to)
    expect(retryBranch).toMatch(/total_runs, unique_runners, total_credits, successful_runs, failed_runs\)\s+VALUES \(v_app_id, v_today, 0, 0,/)
    expect(retryBranch).not.toMatch(/total_runs = app_analytics\.total_runs/)
    // The outcome moves on the day the run was counted.
    expect(trigger).toMatch(/WHERE app_id = v_app_id AND date = v_counted_on;/)
  })

  it("finds only the execution owner's run, and locks it while counting", () => {
    const trigger = fnBody("update_app_analytics")
    expect(trigger).toMatch(/FROM app_runs ar WHERE ar\.execution_id = NEW\.id AND ar\.runner_id = NEW\.user_id\s+LIMIT 1\s+FOR UPDATE;/)
    expect(trigger).toMatch(/we\.id = v_from::uuid AND we\.user_id = NEW\.user_id AND we\.workflow_id = NEW\.workflow_id/)
  })

  it("never fails the status write it rides on, and its warning names the run", () => {
    expect(fnBody("update_app_analytics")).toMatch(/EXCEPTION WHEN OTHERS THEN\s+RAISE WARNING 'app analytics not counted for run % \(execution %\): % \(SQLSTATE %\)', v_run_id, NEW\.id, SQLERRM, SQLSTATE;/)
  })

  it("reads a run counted before 538 only from an attempt that ended before 538, as a failure", () => {
    const trigger = fnBody("update_app_analytics")
    expect(trigger).toMatch(/COALESCE\(v_source\.completed_at, v_source\.created_at\) < public\.app_analytics_one_run_since\(\)/)
    expect(trigger).toMatch(/v_outcome := 'failed';/)
    // The cutoff is written once: a re-run keeps the first time.
    expect(code).toMatch(/IF to_regprocedure\('public\.app_analytics_one_run_since\(\)'\) IS NULL THEN/)
    const backfill = fnBody("app_analytics_recount_retried_runs", backfillCode)
    expect(backfill).toMatch(/v_cut\s+timestamptz := public\.app_analytics_one_run_since\(\);/)
    expect(backfill).toMatch(/CONTINUE WHEN v_root\.ended >= v_cut;/)
    expect(backfill).toMatch(/WHERE m\.ended < v_cut;/)
    // Every attempt but the pointer was continued by a Retry, so it was counted failed.
    expect(backfill).toMatch(/CASE WHEN c\.ord = 1 THEN we\.status ELSE 'failed' END AS counted/)
  })

  it("locks app_analytics rows newest day first, in the trigger and in the backfill", () => {
    const trigger = fnBody("update_app_analytics")
    const retry = trigger.slice(trigger.indexOf("IF v_same_run THEN"), trigger.indexOf("v_counted_on := v_today;"))
    // Today's row is upserted unconditionally (it is locked even when the Retry spent nothing),
    // before the counted day's row.
    const today = retry.search(/VALUES \(v_app_id, v_today, 0, 0, GREATEST\(LEAST\(v_add, 2147483647\), 0\), 0, 0\)/)
    expect(today).toBeGreaterThan(0)
    expect(retry.slice(0, today)).not.toMatch(/\bIF v_add\b/)
    expect(today).toBeLessThan(retry.indexOf("WHERE app_id = v_app_id AND date = v_counted_on;"))
    // The backfill locks every run it recounts before any app_analytics row, then writes the rows
    // across runs in one order: by app, newest day first.
    const backfill = fnBody("app_analytics_recount_retried_runs", backfillCode)
    const lockAll = backfill.search(/ORDER BY ar\.id\s+FOR UPDATE OF ar/)
    expect(lockAll).toBeGreaterThan(0)
    const firstWrite = backfill.search(/UPDATE app_analytics SET/)
    expect(lockAll).toBeLessThan(firstWrite)
    expect([...backfill.matchAll(/UPDATE app_analytics SET/g)]).toHaveLength(1)
    expect(backfill).toMatch(/GROUP BY d\.app_id, d\.day\s+ORDER BY d\.app_id, d\.day DESC/)
  })

  it("points the run at an attempt before the attempt is queued, in every lane that starts one", () => {
    // An attempt that ended before its run pointed at it would go uncounted: the trigger finds
    // a run by its pointer. Each enqueue must come after the pointer write that follows the
    // attempt's insert.
    for (const file of ["services/app-execution.ts", "routes/app-runner.ts", "routes/app-run-resume.ts"]) {
      const src = readFileSync(join(ROOT, "backend/src", file), "utf8")
      const adds = [...src.matchAll(/orchestrationQueue\.add\(/g)].map((m) => m.index!)
      expect(adds.length, file).toBeGreaterThan(0)
      for (const at of adds) {
        const before = src.slice(0, at)
        const inserted = Math.max(
          before.lastIndexOf('"workflow_executions",'),
          before.search(/\.from\("workflow_executions"\)\s*\.insert\((?![\s\S]*\.from\("workflow_executions"\)\s*\.insert\()/),
        )
        const pointed = before.lastIndexOf("execution_id: execution.id")
        expect(inserted, `${file}: an attempt is inserted before it is queued`).toBeGreaterThanOrEqual(0)
        expect(pointed, `${file}: the run points at the attempt before it is queued`).toBeGreaterThan(inserted)
      }
    }
  })

  it("the backfill applies once: it takes only runs not counted under these rules yet", () => {
    const backfill = fnBody("app_analytics_recount_retried_runs", backfillCode)
    expect(backfill).toMatch(/WHERE ar\.analytics_counted_on IS NULL/)
    expect(backfill).toMatch(/analytics_counted_on = v_root\.ended::date/)
    expect(backfill).toMatch(/cardinality\(v_seen\) < 100/)
    expect(backfill).toMatch(/EXIT WHEN v_id = ANY \(v_seen\)/)
    // Credits are each attempt's own spend, already added once: the backfill never writes them.
    expect(backfill).not.toMatch(/total_credits\s*=/)
  })

  it("bounds its lock wait and scans nothing under it", () => {
    expect(code).toMatch(/^SET LOCAL lock_timeout = '2s';/m)
    expect(code.indexOf("SET LOCAL lock_timeout")).toBeLessThan(code.indexOf("ALTER TABLE"))
    expect(code).toMatch(/CHECK \(analytics_outcome IN \('completed', 'failed'\)\) NOT VALID;/)
    // The backfill is its own migration: it runs after 538's lock is gone.
    expect(code).not.toMatch(/app_analytics_recount_retried_runs/)
  })

  it("adds the columns idempotently and changes no grant but its own revokes", () => {
    for (const col of ["analytics_counted_on", "analytics_outcome", "analytics_execution_id", "analytics_execution_credits"]) {
      expect(code).toMatch(new RegExp(`ALTER TABLE public\\.app_runs ADD COLUMN IF NOT EXISTS ${col} `))
    }
    expect(code).not.toMatch(/\bGRANT\b/)
    expect(code).not.toMatch(/DISABLE ROW LEVEL SECURITY|DROP POLICY/)
  })

  it("its functions are no client's to call and pin their search_path", () => {
    expect(code).toMatch(/REVOKE ALL ON FUNCTION public\.update_app_analytics\(\) FROM PUBLIC, anon, authenticated;/)
    expect(backfillCode).toMatch(/REVOKE ALL ON FUNCTION public\.app_analytics_recount_retried_runs\(\) FROM PUBLIC, anon, authenticated;/)
    expect(code).toMatch(/REVOKE ALL ON FUNCTION public\.app_analytics_one_run_since\(\) FROM PUBLIC, anon, authenticated;/)
    expect(fnBody("update_app_analytics")).toMatch(/SECURITY DEFINER SET search_path = public, pg_temp;/)
    expect(fnBody("app_analytics_recount_retried_runs", backfillCode)).toMatch(/SET search_path = public, pg_temp/)
  })

  it("the behavior proof covers the decided cases", () => {
    for (const label of [
      "A: a run that fails then completes on Retry is one successful run",
      "B: three attempts are one successful run, each attempt''s spend once (30 + 20 + 5)",
      "C: a Retry refused before it started adds no run",
      "D: the outcome moves on the day the run was counted",
      "E: a start-over is a new run",
      "F: an execution that ends twice is one run, by its last end, its spend once",
      "G: spend then status: one run, its spend once",
      "G: status then spend: one run, counted once (credits as at its end, as before)",
      "H: a webhook row''s posted Retry stamp is a new run",
      "H: a Retry stamp naming another run is a new run",
      "I: a Retry of a run counted before 538 moves that count''s outcome, on its day",
      "J1: a finished Retry chain is one run, by its last attempt, its credits untouched",
      "J1: three days ago: the run, by its last attempt",
      "J4: a run whose first attempt ended after 538 is not recounted",
      "J: a second backfill pass changes nothing",
      "L: the status write landed although counting could not",
      "L: a Retry after a lost count is a new run and leaves the other run''s failure",
      "M: a Retry that spent nothing completes the run",
      "N: a Retry that ends twice is still one run, its spend once",
      "O: a Retry of the start-over completes the start-over''s run",
      "P: a cancelled Retry leaves the run failed",
      "Q: a Retry naming another workflow''s attempt moves nothing",
    ]) {
      expect(proof, label).toContain(label)
    }
    expect(proof).toContain("ALL BEHAVIOR ASSERTIONS PASSED")
  })
})
