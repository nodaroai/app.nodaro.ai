/**
 * `app_runs` server-owned fields (decided 2026-10-06).
 *
 * A run row points at the execution it shows (`execution_id`). That pointer,
 * and every other field the server derives (`app_id`, `runner_id`, `status`,
 * `credits_used`, `deleted_at`, the snapshots), is written by the backend only.
 * A client may change exactly the fields the run PATCH accepts — nothing else,
 * through the API or straight through the database.
 *
 * Three guards:
 *   1. The migration grants the browser roles UPDATE on exactly the PATCH's
 *      allowlist, and no INSERT or DELETE — and no later migration widens it.
 *   2. The database keeps the invariant itself: rows planted before 469 are
 *      cleared, the analytics trigger reads only the execution owner's run,
 *      and a trigger refuses any write (service role included) that points a
 *      run at an execution its runner does not own.
 *   3. Every backend read that goes from a run to its execution checks whose
 *      execution it is: a lookup by `execution_id` also filters `runner_id`,
 *      an embedded `workflow_executions(...)` selects `user_id` and
 *      `workflow_id` so the route can compare them (`executionBelongsToRun`),
 *      and a lookup of one run by id is scoped to its runner or its app.
 */
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { describe, expect, it } from "vitest"
import { APP_RUN_CLIENT_WRITABLE_COLUMNS } from "../lib/app-run-ownership.js"

const REPO_ROOT = join(__dirname, "..", "..", "..")
const MIGRATIONS_DIR = join(REPO_ROOT, "supabase", "migrations")
const BACKEND_SRC = join(REPO_ROOT, "backend", "src")
const LOCK_MIGRATION = "469_app_runs_server_owned_fields.sql"

/** SQL without `--` comments, whitespace collapsed, lower-cased. */
function sqlOf(file: string): string {
  return readFileSync(join(MIGRATIONS_DIR, file), "utf8")
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join(" ")
    .replace(/\s+/g, " ")
    .toLowerCase()
}

function versionOf(file: string): number {
  return Number(/^(\d+)_/.exec(file)?.[1] ?? NaN)
}

describe("app_runs: the browser roles write only the PATCH's fields", () => {
  const sql = sqlOf(LOCK_MIGRATION)

  it("revokes INSERT, UPDATE and DELETE from anon and authenticated", () => {
    expect(sql).toMatch(/revoke insert, update, delete(, truncate)? on (public\.)?app_runs from anon, authenticated;/)
  })

  it("drops the runner INSERT and DELETE policies (the backend creates and removes runs)", () => {
    expect(sql).toContain('drop policy if exists "runner can insert own runs" on public.app_runs;')
    expect(sql).toContain('drop policy if exists "runner can delete own runs" on public.app_runs;')
  })

  it("grants UPDATE on exactly the PATCH's allowlist — execution_id is not among them", () => {
    const grant = /grant update \(([^)]*)\) on (?:public\.)?app_runs to authenticated;/.exec(sql)
    expect(grant, "the column grant").toBeTruthy()
    const granted = grant![1].split(",").map((c) => c.trim()).sort()
    expect(granted).toEqual([...APP_RUN_CLIENT_WRITABLE_COLUMNS].sort())
    expect(granted).not.toContain("execution_id")
  })

  it("no later migration grants a write on app_runs back or adds a client write policy", () => {
    const later = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith(".sql") && versionOf(f) > versionOf(LOCK_MIGRATION))
    for (const file of later) {
      const text = sqlOf(file)
      expect(text, `${file} grants a write on app_runs`).not.toMatch(
        /grant [^;]*\b(insert|update|delete|all)\b[^;]* on (public\.)?app_runs to [^;]*\b(anon|authenticated|public)\b/,
      )
      expect(text, `${file} grants writes on every table, app_runs included`).not.toMatch(
        /grant [^;]* on all tables in schema public to [^;]*\b(anon|authenticated|public)\b/,
      )
      // Deliberate: the UPDATE policy stays the one from 051. Restating it (an
      // RLS rewrite) is fine — the column grant above still bounds it — so
      // allow that here on purpose rather than deleting this check.
      expect(text, `${file} adds a write policy on app_runs`).not.toMatch(
        /create policy [^;]* on (public\.)?app_runs (as \w+ )?for (insert|delete|all)/,
      )
    }
  })
})

/** The body of the LAST migration that defines `fn` — the definition in force. */
function latestDefinitionOf(fn: string): { file: string; body: string } | null {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql") && Number.isFinite(versionOf(f)))
    .sort((a, b) => versionOf(a) - versionOf(b))
  let found: { file: string; body: string } | null = null
  const head = new RegExp(`create or replace function (?:public\\.)?${fn}\\(`)
  for (const file of files) {
    const text = sqlOf(file)
    const at = text.search(head)
    if (at === -1) continue
    const rest = text.slice(at)
    const open = rest.indexOf("$$")
    const close = rest.indexOf("$$", open + 2)
    found = { file, body: rest.slice(0, rest.indexOf(";", close) + 1) }
  }
  return found
}

describe("the database's own reads from an execution to its run check the runner", () => {
  // The analytics trigger (045) runs SECURITY DEFINER on every execution that
  // finishes, and used to find "its" run by execution_id alone — so a run row
  // planted by a client before 469 drew another user's spend into it.
  it("update_app_analytics finds and updates only the execution owner's run", () => {
    const def = latestDefinitionOf("update_app_analytics")
    expect(def, "update_app_analytics is redefined").toBeTruthy()
    const { body } = def!
    expect(body).toMatch(/from app_runs ar where ar\.execution_id = new\.id and ar\.runner_id = new\.user_id/)
    expect(body).toMatch(/update app_runs set credits_used = [^;]* where execution_id = new\.id and runner_id = new\.user_id;/)
    expect(body, "the unique-runner count joins only the runner's own executions").toMatch(
      /join workflow_executions we on we\.id = ar\.execution_id and we\.user_id = ar\.runner_id/,
    )
    // CREATE OR REPLACE resets the function's settings: 050's pin must be restated.
    expect(body).toMatch(/security definer set search_path = public/)
  })

  it("469 clears the run rows that already point at another user's execution", () => {
    const sql = sqlOf(LOCK_MIGRATION)
    expect(sql).toMatch(
      /update public\.app_runs ar set execution_id = null, status = 'draft', credits_used = 0 from public\.workflow_executions we where we\.id = ar\.execution_id and ar\.runner_id is distinct from we\.user_id;/,
    )
  })

  it("a trigger refuses any write that points a run at an execution its runner does not own — service role included", () => {
    const sql = sqlOf(LOCK_MIGRATION)
    expect(sql).toMatch(
      /create trigger trg_app_runs_execution_owner before insert or update of execution_id on public\.app_runs for each row execute function public\.app_runs_execution_owner_check\(\);/,
    )
    const def = latestDefinitionOf("app_runs_execution_owner_check")
    expect(def?.body).toMatch(/we\.id = new\.execution_id and we\.user_id = new\.runner_id/)
    expect(def?.body).toMatch(/raise exception/)
    // The clean-up runs first, or the trigger's own table would hold rows it forbids.
    expect(sql.indexOf("update public.app_runs ar set execution_id = null")).toBeLessThan(
      sql.indexOf("create trigger trg_app_runs_execution_owner"),
    )
    const later = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith(".sql") && versionOf(f) > versionOf(LOCK_MIGRATION))
    for (const file of later) {
      expect(sqlOf(file), `${file} drops the execution-owner trigger`).not.toMatch(
        /drop trigger (if exists )?trg_app_runs_execution_owner\b/,
      )
    }
  })
})

/** Every non-test `.ts` file under backend/src. */
function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) {
      if (name === "__tests__" || name === "node_modules") continue
      sourceFiles(path, out)
    } else if (name.endsWith(".ts") && !name.endsWith(".test.ts") && !name.endsWith(".d.ts")) {
      out.push(path)
    }
  }
  return out
}

/** Each `.from("app_runs")` query: its text up to the next `.from(` (or 1200 chars). */
function appRunQueries(): Array<{ where: string; text: string }> {
  const queries: Array<{ where: string; text: string }> = []
  for (const file of sourceFiles(BACKEND_SRC)) {
    const src = readFileSync(file, "utf8")
    const re = /\.from\(\s*["']app_runs["']\s*\)/g
    let m: RegExpExecArray | null
    while ((m = re.exec(src))) {
      const rest = src.slice(m.index + m[0].length)
      const next = rest.search(/\.from\(/)
      const text = rest.slice(0, next === -1 ? 1200 : Math.min(next, 1200))
      const line = src.slice(0, m.index).split("\n").length
      queries.push({ where: `${relative(REPO_ROOT, file)}:${line}`, text })
    }
  }
  return queries
}

describe("every read from a run to its execution checks whose execution it is", () => {
  const queries = appRunQueries()

  it("finds the app_runs queries (the census is not empty)", () => {
    expect(queries.length).toBeGreaterThan(10)
  })

  it("a lookup by execution_id also filters runner_id", () => {
    const unfiltered = queries
      .filter((q) => /\.eq\(\s*["']execution_id["']/.test(q.text))
      .filter((q) => !/["']runner_id["']/.test(q.text))
      .map((q) => q.where)
    expect(unfiltered).toEqual([])
  })

  it("a lookup of one run by id is scoped to its runner or its app (a pagination cursor too)", () => {
    // The service role reads any row, so a client-supplied run id — a cursor
    // included — is someone else's until a filter says otherwise.
    const unscoped = queries
      .filter((q) => /\.eq\(\s*["']id["']/.test(q.text))
      .filter((q) => !/\.(eq|in)\(\s*["'](runner_id|app_id)["']/.test(q.text))
      .map((q) => q.where)
    expect(unscoped).toEqual([])
  })

  it("an embedded workflow_executions(...) selects user_id and workflow_id", () => {
    const blind: string[] = []
    for (const q of queries) {
      const embed = /workflow_executions(?:![\w]+)?\(([^)]*)\)/g
      let m: RegExpExecArray | null
      while ((m = embed.exec(q.text))) {
        const cols = m[1].split(",").map((c) => c.trim())
        if (!cols.includes("user_id") || !cols.includes("workflow_id")) blind.push(`${q.where} → ${m[0]}`)
      }
    }
    expect(blind).toEqual([])
  })
})
