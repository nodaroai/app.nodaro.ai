/**
 * `app_runs` holds TWO foreign keys to `workflow_executions` once migration 473
 * applies: `execution_id` (the run) and `final_execution_id` (its Render final,
 * decided 2026-10-04). PostgREST then refuses an embed between the two tables
 * that does not name the key it follows (PGRST201, "more than one relationship
 * found") — the WHOLE select fails: the runner's run list, a run's detail, the
 * archive and the creator's analytics among them. Staging cannot show it
 * before the promotion (the column is absent there), and the route tests mock
 * supabase, so this guard is what holds it.
 *
 * Every embed between the two tables names its key — `workflow_executions!execution_id(...)`
 * from `app_runs`, `app_runs!execution_id(...)` from `workflow_executions` —
 * which PostgREST also accepts while only one key exists (decided 2026-10-06).
 */
import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, relative, sep } from "node:path"

const SRC = join(__dirname, "..", "..")

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) {
      if (name === "__tests__" || name === "node_modules") continue
      out.push(...sourceFiles(full))
    } else if (/\.ts$/.test(name) && !/\.test\.ts$/.test(name) && !/\.d\.ts$/.test(name)) {
      out.push(full)
    }
  }
  return out
}

/** The table of the query an offset sits in: the nearest `.from("…")` before it. */
function tableAt(text: string, offset: number): string | null {
  const re = /\.from\(\s*["'`]([a-z_]+)["'`]\s*\)/g
  let table: string | null = null
  for (let m = re.exec(text); m && m.index < offset; m = re.exec(text)) table = m[1]
  return table
}

/** An embed of `embedded` with no key named: the table name followed straight by `(`. */
function bareEmbeds(text: string, embedded: string): number[] {
  const re = new RegExp(`(?<![\\w!])${embedded}\\s*\\(`, "g")
  const out: number[] = []
  for (let m = re.exec(text); m; m = re.exec(text)) out.push(m.index)
  return out
}

const PAIRS: ReadonlyArray<readonly [from: string, embedded: string]> = [
  ["app_runs", "workflow_executions"],
  ["workflow_executions", "app_runs"],
]

describe("app_runs ⇄ workflow_executions embeds name their key", () => {
  it("no select embeds one table from the other without a key hint", () => {
    const offenders: string[] = []
    for (const file of sourceFiles(SRC)) {
      const text = readFileSync(file, "utf8")
      for (const [from, embedded] of PAIRS) {
        for (const offset of bareEmbeds(text, embedded)) {
          if (tableAt(text, offset) !== from) continue
          const line = text.slice(0, offset).split("\n").length
          offenders.push(`${relative(SRC, file).split(sep).join("/")}:${line} — ${from} embeds ${embedded}( with no key`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it("the scan sees a bare embed and lets a hinted one through", () => {
    const bare = `supabase.from("app_runs").select("id, workflow_executions(status)")`
    const hinted = `supabase.from("app_runs").select("id, workflow_executions!execution_id(status)")`
    expect(bareEmbeds(bare, "workflow_executions").map((o) => tableAt(bare, o))).toEqual(["app_runs"])
    expect(bareEmbeds(hinted, "workflow_executions")).toEqual([])
  })
})
