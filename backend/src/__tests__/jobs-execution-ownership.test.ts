/**
 * `jobs` rows and the execution they belong to (decided 2026-10-06).
 *
 * A job row says which workflow run it belongs to (`workflow_execution_id`),
 * and the backend reads a run's jobs with the service role — to resume a
 * fan-out, to adopt an in-flight render, to reconcile a crashed run, to size
 * its wait budget. So that pointer, and every other field on a job, is written
 * by the server only, and every read from a run to its jobs asks for the run
 * owner's jobs.
 *
 * Three guards:
 *   1. The migration takes every write on `jobs` and on `workflow_executions`
 *      away from the browser roles
 *      (nothing in this repo, studio or the cloud plugins writes `jobs` from a
 *      browser), and no later migration gives one back.
 *   2. The database keeps the invariant itself: rows planted before 474 are
 *      detached, and a trigger refuses any write (service role included) that
 *      points a job at an execution its user does not own.
 *   3. Every backend read of `jobs` keyed by `workflow_execution_id` also
 *      filters `user_id` — or, for a read across many owners' executions,
 *      selects `user_id` and compares it in code (listed below, with why).
 */
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { describe, expect, it } from "vitest"

const REPO_ROOT = join(__dirname, "..", "..", "..")
const MIGRATIONS_DIR = join(REPO_ROOT, "supabase", "migrations")
const BACKEND_SRC = join(REPO_ROOT, "backend", "src")
const LOCK_MIGRATION = "474_jobs_execution_ownership.sql"

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

function laterMigrations(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql") && versionOf(f) > versionOf(LOCK_MIGRATION))
}

describe("jobs: the browser roles write nothing", () => {
  const sql = sqlOf(LOCK_MIGRATION)

  it("revokes INSERT, UPDATE, DELETE and TRUNCATE from anon and authenticated", () => {
    expect(sql).toMatch(/revoke insert, update, delete, truncate on public\.jobs from anon, authenticated;/)
  })

  it("drops the owner INSERT policy (the backend creates every job)", () => {
    expect(sql).toContain('drop policy if exists "users can insert own jobs" on public.jobs;')
  })

  it("keeps the browser's read: SELECT is not revoked here", () => {
    expect(sql).not.toMatch(/revoke [^;]*\bselect\b[^;]* on public\.jobs/)
  })

  it("no later migration grants a write on jobs back or adds a permissive write policy", () => {
    for (const file of laterMigrations()) {
      const text = sqlOf(file)
      expect(text, `${file} grants a write on jobs`).not.toMatch(
        /grant [^;]*\b(insert|update|delete|truncate|all)\b[^;]* on (table )?(public\.)?jobs to [^;]*\b(anon|authenticated|public)\b/,
      )
      expect(text, `${file} grants writes on every table, jobs included`).not.toMatch(
        /grant [^;]* on all tables in schema public to [^;]*\b(anon|authenticated|public)\b/,
      )
      // A RESTRICTIVE policy only narrows — 394 and 451 add those, and more
      // are welcome. A permissive one is what would let a browser write again.
      expect(text, `${file} adds a permissive write policy on jobs`).not.toMatch(
        /create policy [^;]* on (public\.)?jobs (as permissive )?for (insert|update|delete|all)/,
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

describe("workflow_executions: the browser roles write nothing either", () => {
  // Its `status` decides whether a run is in progress (the app run's permanent
  // delete, and with it a monetized app's creator fee), its `node_states`
  // names the job ids MCP reads back with the service role, and deleting it
  // cascades its app run away (044). No client writes it.
  const sql = sqlOf(LOCK_MIGRATION)

  it("revokes INSERT, UPDATE, DELETE and TRUNCATE from anon and authenticated", () => {
    expect(sql).toMatch(/revoke insert, update, delete, truncate on public\.workflow_executions from anon, authenticated;/)
  })

  it("drops 036's owner INSERT, UPDATE and DELETE policies", () => {
    for (const verb of ["insert", "update", "delete"]) {
      expect(sql).toContain(`drop policy if exists "users can ${verb} own workflow executions" on public.workflow_executions;`)
    }
  })

  it("keeps the browser's read: SELECT is not revoked here", () => {
    expect(sql).not.toMatch(/revoke [^;]*\bselect\b[^;]* on public\.workflow_executions/)
  })

  it("no later migration grants a write on workflow_executions back or adds a permissive write policy", () => {
    for (const file of laterMigrations()) {
      const text = sqlOf(file)
      expect(text, `${file} grants a write on workflow_executions`).not.toMatch(
        /grant [^;]*\b(insert|update|delete|truncate|all)\b[^;]* on (table )?(public\.)?workflow_executions to [^;]*\b(anon|authenticated|public)\b/,
      )
      expect(text, `${file} adds a permissive write policy on workflow_executions`).not.toMatch(
        /create policy [^;]* on (public\.)?workflow_executions (as permissive )?for (insert|update|delete|all)/,
      )
    }
  })
})

describe("the database keeps a job on its own user's executions", () => {
  const sql = sqlOf(LOCK_MIGRATION)

  it("474 detaches the job rows that already point at another user's execution", () => {
    expect(sql).toMatch(
      /update public\.jobs j set workflow_execution_id = null from public\.workflow_executions we where we\.id = j\.workflow_execution_id and j\.user_id is distinct from we\.user_id;/,
    )
  })

  it("a trigger refuses any write that points a job at an execution its user does not own — service role included", () => {
    expect(sql).toMatch(
      /create trigger trg_jobs_execution_owner before insert or update of workflow_execution_id, user_id on public\.jobs for each row execute function public\.jobs_execution_owner_check\(\);/,
    )
    const def = latestDefinitionOf("jobs_execution_owner_check")
    expect(def?.body).toMatch(/we\.id = new\.workflow_execution_id and we\.user_id = new\.user_id/)
    expect(def?.body).toMatch(/raise exception/)
    // The clean-up runs first, or the table would hold rows the trigger forbids.
    expect(sql.indexOf("update public.jobs j set workflow_execution_id = null")).toBeLessThan(
      sql.indexOf("create trigger trg_jobs_execution_owner"),
    )
    for (const file of laterMigrations()) {
      expect(sqlOf(file), `${file} drops the execution-owner trigger`).not.toMatch(
        /drop trigger (if exists )?trg_jobs_execution_owner\b/,
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

/** Each `.from("jobs")` query: its text up to the next `.from(` (or 1500 chars). */
function jobQueries(): Array<{ file: string; where: string; text: string }> {
  const queries: Array<{ file: string; where: string; text: string }> = []
  for (const file of sourceFiles(BACKEND_SRC)) {
    const src = readFileSync(file, "utf8")
    const re = /\.from\(\s*["']jobs["']\s*\)/g
    let m: RegExpExecArray | null
    while ((m = re.exec(src))) {
      const rest = src.slice(m.index + m[0].length)
      const next = rest.search(/\.from\(/)
      const text = rest.slice(0, next === -1 ? 1500 : Math.min(next, 1500))
      const line = src.slice(0, m.index).split("\n").length
      const rel = relative(REPO_ROOT, file)
      queries.push({ file: rel, where: `${rel}:${line}`, text })
    }
  }
  return queries
}

/**
 * Reads across MANY owners' executions in one query (an app's runs belong to
 * many runners), so no single `user_id` filter fits. Each selects `user_id`
 * and drops a row whose user is not its execution's owner, in code.
 */
const COMPARED_IN_CODE: Readonly<Record<string, string>> = {
  "backend/src/lib/collect-app-r2-keys.ts": "an app's runs span every runner; keys come only from each run owner's own jobs",
  "backend/src/lib/app-report-sweep.ts": "failed executions span every user; a job covers only its own user's execution",
}

describe("every read from an execution to its jobs asks for the execution owner's jobs", () => {
  const queries = jobQueries()
  const byExecution = queries.filter((q) => /\.(eq|in)\(\s*["']workflow_execution_id["']/.test(q.text))

  it("finds the jobs queries (the census is not empty)", () => {
    expect(queries.length).toBeGreaterThan(50)
    expect(byExecution.length).toBeGreaterThan(5)
  })

  it("a lookup by workflow_execution_id also filters user_id", () => {
    const unfiltered = byExecution
      .filter((q) => !(q.file in COMPARED_IN_CODE))
      .filter((q) => !/\.eq\(\s*["']user_id["']/.test(q.text))
      .map((q) => q.where)
    expect(unfiltered).toEqual([])
  })

  it("a lookup across many owners' executions selects user_id to compare it", () => {
    const blind = byExecution
      .filter((q) => q.file in COMPARED_IN_CODE)
      .filter((q) => !/\.select\(\s*["'`][^"'`]*\buser_id\b/.test(q.text))
      .map((q) => q.where)
    expect(blind).toEqual([])
    // An entry that no longer matches a query is stale: drop it rather than
    // let it excuse a future read in the same file.
    for (const file of Object.keys(COMPARED_IN_CODE)) {
      expect(byExecution.some((q) => q.file === file), `${file} is listed but has no such read`).toBe(true)
    }
  })
})
