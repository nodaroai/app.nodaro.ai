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
import { unitRouteFiles } from "../unit-source-files.js"

const SRC_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..")
const ROUTES_DIR = join(SRC_DIR, "routes")

/** The ONE file allowed to touch the raw jobs-insert calls: lib/insert-job.ts,
 *  where the helpers live and where each of them asks the request gate first.
 *  Everything else goes through insertJob / insertInternalJob /
 *  insertJobIdempotent / insertStampedJobIdempotent — the plugin toolkit too:
 *  its own insert lane (`tk.http.insertJobWithIdempotencyKey`) stamps its
 *  provenance itself and inserts through insertStampedJobIdempotent. */
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

/** `.from("jobs")` followed by `.insert(` or `.upsert(` (both create rows) —
 *  allowing the newline-and-indent chain style the routes are written in.
 *  `.update(` / `.select(` on jobs are untouched by this rule and must not
 *  match. */
const DIRECT_INSERT = /\.from\(\s*["']jobs["']\s*\)\s*\.(?:insert|upsert)\s*\(|insertWithIdempotencyKey\s*(?:<[^>]*>)?\s*\(\s*["']jobs["']/

/** Comments blanked with byte offsets kept, so a doc comment quoting an insert
 *  is not an insert (same approach as job-policy-request-totality). */
function blankComments(src: string): string {
  const blank = (m: string) => m.replace(/[^\n]/g, " ")
  return src
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1: string) => p1 + blank(m.slice(p1.length)))
}

describe("all job inserts go through insert-job.ts", () => {
  const files = tsFiles(SRC_DIR)

  it("finds source files to check (the guard is wired to something)", () => {
    expect(files.length).toBeGreaterThan(200)
  })

  it("no file inserts into jobs directly", () => {
    const offenders = files
      // Normalize Windows separators so the allowlist matches on every OS
      // (this was a standing Windows-only false-fail).
      .map((f) => relative(SRC_DIR, f).split("\\").join("/"))
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

  /**
   * The funnel's second job (spec §11.1): every exported helper asks the
   * REQUEST gate. Checked as a per-function source slice, not as a
   * file-contains, so removing the call from ONE helper fails — which is
   * exactly how a gate quietly stops covering the lane nobody re-read.
   */
  it("every exported insert helper runs the request gate", () => {
    const src = readFileSync(join(SRC_DIR, "lib", "insert-job.ts"), "utf8")
    const helpers = ["insertJob", "insertInternalJob", "insertJobs", "insertJobIdempotent", "insertStampedJobIdempotent"]
    const missing = helpers.filter((name) => {
      const start = src.indexOf(`export async function ${name}<`)
      if (start < 0) return true
      // Up to the next top-level `export`, i.e. this function's own body.
      const next = src.indexOf("\nexport ", start + 1)
      const body = src.slice(start, next < 0 ? src.length : next)
      return !body.includes("gateJobInsert(")
    })
    expect(
      missing,
      `These insert helpers no longer call gateJobInsert(), so a registered job policy ` +
        `cannot see the jobs they create: ${missing.join(", ")}. The gate must run AFTER ` +
        `provenance stamping and BEFORE the insert in every one of them.`,
    ).toEqual([])
    expect(
      src.includes("applyJobRequestPolicies("),
      "gateJobInsert() must actually ask the registry — otherwise the guard above is vacuous.",
    ).toBe(true)
  })

  /**
   * The same rule, derived rather than listed: inside the funnel, EVERY raw
   * jobs write (`.insert(` / `insertWithIdempotencyKey(`) sits in a function
   * that asked `gateJobInsert(` before it. A helper added tomorrow is covered
   * without anyone remembering to extend the list above.
   */
  it("inside the funnel, every raw jobs write is preceded by the request gate in its own function", () => {
    const src = blankComments(readFileSync(join(SRC_DIR, "lib", "insert-job.ts"), "utf8"))
    const starts = [...src.matchAll(/\n(?:export\s+)?(?:async\s+)?function\s+(\w+)/g)].map((m) => ({ name: m[1]!, at: m.index }))
    const ungated: string[] = []
    let writes = 0
    for (const m of src.matchAll(/\.(?:insert|upsert)\s*\(|\binsertWithIdempotencyKey\s*(?:<[^>]*>)?\s*\(/g)) {
      writes++
      const owner = starts.filter((s) => s.at < m.index).at(-1)
      if (!owner || !src.slice(owner.at, m.index).includes("gateJobInsert(")) ungated.push(owner?.name ?? "<module scope>")
    }
    expect(writes, "found no raw jobs write in insert-job.ts — the scan is wired to nothing").toBeGreaterThanOrEqual(4)
    expect(
      ungated,
      `These functions in lib/insert-job.ts write jobs without asking gateJobInsert() first, so a blocked ` +
        `account, a restricted input and every registered request policy are skipped for the jobs they create.`,
    ).toEqual([])
  })

  /**
   * The plugin toolkit is checked on its own, whatever ALLOWLIST says: the
   * toolkit's insert members are how private plugin routes create jobs, so a
   * raw write there is a plugin lane past the request gate (the hole this
   * guard closed). Its members insert through the insert-job.ts helpers.
   */
  it("the plugin toolkit has no raw jobs write of its own", () => {
    const pluginDir = join(SRC_DIR, "lib", "private-plugins")
    const files = tsFiles(pluginDir)
    expect(files.map((f) => relative(SRC_DIR, f).split("\\").join("/"))).toContain("lib/private-plugins/toolkit.ts")
    const offenders = files
      .filter((f) => DIRECT_INSERT.test(blankComments(readFileSync(f, "utf8"))))
      .map((f) => relative(SRC_DIR, f).split("\\").join("/"))
    expect(
      offenders,
      `These plugin-toolkit files write jobs directly, past the request gate: ${offenders.join(", ")}. ` +
        `Insert through lib/insert-job.ts (insertJobIdempotent for a request's job, insertStampedJobIdempotent ` +
        `for a row that carries its own provenance).`,
    ).toEqual([])
  })

  it("insertJob is actually used by routes (the rule isn't vacuous)", () => {
    // A regex-only guard passes trivially if every route stopped creating jobs.
    const routeFiles = [...tsFiles(ROUTES_DIR), ...unitRouteFiles(join(SRC_DIR, "..", ".."))]
    const users = routeFiles.filter((f) => readFileSync(f, "utf8").includes("insertJob("))
    expect(users.length).toBeGreaterThan(50)
  })
})
