import { describe, it, expect } from "vitest"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"

/**
 * The browser reads `jobs` in exactly one place, and it is the Realtime hook.
 *
 * Migration 347 revoked table-level SELECT on public.jobs from `authenticated`
 * down to {id, user_id, status, output_data}. PostgREST does not degrade
 * gracefully when a select names a column the role cannot read -- it answers
 * 401 42501 for the WHOLE request, so a reintroduced `.from("jobs")` naming any
 * other column does not lose a field, it loses the page (that is precisely what
 * the admin Jobs table did before it moved to GET /v1/admin/jobs).
 *
 * The migration guard (supabase/tests/jobs-cost-privacy.behavior.sql) proves the
 * database side. This proves the client side: the grant is a MINIMUM, so any new
 * browser read of jobs is a design decision that has to be made deliberately --
 * by adding a GRANT in a migration and an entry here -- rather than by a
 * copy-paste that 401s in production.
 *
 * Both spellings are banned: PostgREST (`.from("jobs")`) and Realtime channel
 * config (`table: "jobs"`). The allowlisted hook uses the SECOND form, so a
 * `.from`-only rule would miss the one file that has to be exempt.
 */

const ROOT = join(__dirname, "..", "..")

/** The only browser surface allowed to touch `jobs`. Its payload type
 *  (JobRealtimeRow) is exactly the four granted columns. */
const ALLOWLIST = new Set([
  "components/editor/location-studio/use-jobs-realtime-sync.ts",
])

const PATTERNS = [
  /\.from\(\s*["'`]jobs["'`]\s*\)/,
  /\btable:\s*["'`]jobs["'`]/,
]

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "__tests__" || e.name === "node_modules") continue
    const full = join(dir, e.name)
    if (e.isDirectory()) out.push(...sourceFiles(full))
    else if (/\.tsx?$/.test(e.name) && !e.name.endsWith(".d.ts")) out.push(full)
  }
  return out
}

describe("the browser does not read the jobs table directly", () => {
  const files = sourceFiles(ROOT)

  it("finds source files to check (the guard is wired to something)", () => {
    expect(files.length).toBeGreaterThan(500)
  })

  it("only the Realtime job-sync hook touches `jobs`", () => {
    const offenders = files
      .map((f) => relative(ROOT, f).split("\\").join("/"))
      .filter((rel) => !ALLOWLIST.has(rel))
      .filter((rel) => {
        const src = readFileSync(join(ROOT, rel), "utf8")
        return PATTERNS.some((p) => p.test(src))
      })

    expect(
      offenders,
      offenders.length === 0
        ? ""
        : `These files read "jobs" with the browser Supabase client. Migration 347 ` +
          `grants \`authenticated\` SELECT on only (id, user_id, status, output_data); ` +
          `PostgREST answers 401 42501 for a select naming anything else, so this ` +
          `fails in production, not in review:\n` +
          offenders.map((o) => `  - frontend/src/${o}`).join("\n") +
          `\n\nRead jobs through a backend route instead (admin listings: ` +
          `GET /v1/admin/jobs; user-facing: GET /v1/jobs, which redacts cost via ` +
          `sanitizeJobForPublic). If a new Realtime column is genuinely needed, ` +
          `add an explicit GRANT in a migration, extend the behavior proof's ` +
          `expected column set, and allowlist the file here.`,
    ).toEqual([])
  })

  it("the allowlisted hook still exists (the exemption isn't stale)", () => {
    for (const rel of ALLOWLIST) {
      expect(statSync(join(ROOT, rel)).isFile()).toBe(true)
    }
  })
})
