/**
 * Routes must create jobs through `insertJob`, never `supabase.from("jobs")
 * .insert(...)` directly.
 *
 * This is the half of the design that doesn't decay. The helper alone is a
 * convention, and conventions lose: `mcp_client` was a genuinely useful column
 * that ended up absent from a large share of insert sites purely because each
 * new route had to remember it, and nothing anywhere reported the gap. The same
 * would happen to `source` / `source_detail` within a few features.
 *
 * So the rule is mechanical: a file that hand-rolls the insert fails this
 * test, with the fix in the message.
 *
 * Scope is ALL of `src/` (originally `src/routes/` only). Workers, pipelines
 * and the orchestrator have no FastifyRequest to derive provenance from, but
 * "no request" never meant "nothing to say": they use `insertInternalJob`,
 * which stamps `source: "internal"` plus a named creator. The null rows the
 * old scope permitted surfaced in the admin Jobs table as "—" and were
 * reported as missing data (meterSyncLlm, the pipeline services, the
 * orchestrator's per-node insert — all fixed when the scope widened).
 */
import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { join, dirname, relative } from "node:path"
import { fileURLToPath } from "node:url"

const SRC_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..")
const ROUTES_DIR = join(SRC_DIR, "routes")

/** The one file allowed to touch `.from("jobs").insert(` — the helpers live
 *  there. Everything else goes through them. */
const ALLOWLIST = new Set(["lib/insert-job.ts"])

function tsFiles(dir: string): string[] {
  const out: string[] = []
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "__tests__") continue
    const full = join(dir, e.name)
    if (e.isDirectory()) out.push(...tsFiles(full))
    else if (e.name.endsWith(".ts") && !e.name.endsWith(".d.ts")) out.push(full)
  }
  return out
}

/** `.from("jobs")` followed by `.insert(` — allowing the newline-and-indent
 *  chain style the routes are written in. `.update(` / `.select(` on jobs are
 *  untouched by this rule and must not match. */
const DIRECT_INSERT = /\.from\(\s*["']jobs["']\s*\)\s*\.insert\s*\(/

describe("all job inserts go through insert-job.ts", () => {
  const files = tsFiles(SRC_DIR)

  it("finds source files to check (the guard is wired to something)", () => {
    expect(files.length).toBeGreaterThan(200)
  })

  it("no file inserts into jobs directly", () => {
    const offenders = files
      .map((f) => relative(SRC_DIR, f))
      .filter((rel) => !ALLOWLIST.has(rel))
      .filter((rel) => DIRECT_INSERT.test(readFileSync(join(SRC_DIR, rel), "utf8")))

    expect(
      offenders,
      offenders.length === 0
        ? ""
        : `These files insert into "jobs" directly, so their rows carry no source/source_detail ` +
          `and render as "—" in the admin provenance view:\n` +
          offenders.map((o) => `  - src/${o}`).join("\n") +
          `\n\nRoutes: use insertJob(req, row) from lib/insert-job.js. Workers/pipelines/` +
          `orchestrator (no request): use insertInternalJob("<creator>", row) from the same ` +
          `file. Both return the same { data, error } shape, so only the call changes.`,
    ).toEqual([])
  })

  it("insertJob is actually used by routes (the rule isn't vacuous)", () => {
    // A regex-only guard passes trivially if every route stopped creating jobs.
    const routeFiles = tsFiles(ROUTES_DIR)
    const users = routeFiles.filter((f) => readFileSync(f, "utf8").includes("insertJob("))
    expect(users.length).toBeGreaterThan(50)
  })
})
