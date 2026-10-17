// @test-watches backend/src/**/*.{ts,tsx} frontend/src/**/*.{ts,tsx}
/**
 * `jobs` and `workflow_executions` are joined by TWO foreign keys:
 * `jobs.workflow_execution_id` (the run a job belongs to) and
 * `workflow_executions.wrapper_job_id` (the job that wraps an inline run,
 * migration 509). PostgREST then refuses an embed between the two tables that
 * does not name the key it follows (PGRST201, "more than one relationship was
 * found") — the WHOLE select fails. That is how the jobs list (`GET /v1/jobs`)
 * answered 500 once 509 applied: its `workflow_executions!left(...)` named a
 * join modifier, not a key. The route tests mock supabase, so this guard is
 * what holds it.
 *
 * Every embed between the two tables names its key — e.g.
 * `workflow_executions!workflow_execution_id(...)` from `jobs`,
 * `jobs!wrapper_job_id(...)` or `jobs!workflow_execution_id(...)` from
 * `workflow_executions`. A join modifier (`!left`, `!inner`) alone is not a key.
 * (`!hint!left` is valid PostgREST, but supabase-js's typed select parser
 * rejects it; `!left` is the default join for an embed anyway, so drop it.)
 */
import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, relative, sep } from "node:path"

const SRC = join(__dirname, "..", "..")
const FRONTEND_SRC = join(__dirname, "..", "..", "..", "..", "frontend", "src")

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  let names: string[]
  try {
    names = readdirSync(dir)
  } catch {
    return out
  }
  for (const name of names) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) {
      if (name === "__tests__" || name === "node_modules") continue
      out.push(...sourceFiles(full))
    } else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) && !/\.d\.ts$/.test(name)) {
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

/**
 * The text with every comment blanked to spaces (newlines kept, so offsets and
 * line numbers still line up) — prose like "the caller's own jobs (…)" is not
 * an embed. A small scanner, not a regex, so `//` inside a string ("https://")
 * stays code.
 */
function stripComments(text: string): string {
  const out = text.split("")
  let quote: string | null = null
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quote) {
      if (c === "\\") i++
      else if (c === quote) quote = null
      continue
    }
    if (c === '"' || c === "'" || c === "`") {
      quote = c
    } else if (c === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") out[i++] = " "
    } else if (c === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2)
      const stop = end === -1 ? text.length : end + 2
      for (; i < stop; i++) if (text[i] !== "\n") out[i] = " "
      i--
    }
  }
  return out.join("")
}

/** PostgREST join modifiers — they choose the join type, never the key. */
const JOIN_MODIFIERS = new Set(["left", "inner"])

/**
 * Embeds of `embedded` that name no key: the table name, any `!word` suffixes,
 * then `(` — where every suffix is a join modifier (or there is none).
 */
function unkeyedEmbeds(text: string, embedded: string): number[] {
  const re = new RegExp(`(?<![\\w!])${embedded}((?:\\s*!\\s*\\w+)*)\\s*\\(`, "g")
  const out: number[] = []
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const hints = m[1]
      .split("!")
      .map((h) => h.trim())
      .filter(Boolean)
    if (hints.every((h) => JOIN_MODIFIERS.has(h))) out.push(m.index)
  }
  return out
}

const PAIRS: ReadonlyArray<readonly [from: string, embedded: string]> = [
  ["jobs", "workflow_executions"],
  ["workflow_executions", "jobs"],
]

describe("jobs ⇄ workflow_executions embeds name their key", () => {
  it("no select embeds one table from the other without a key hint", () => {
    const offenders: string[] = []
    for (const root of [SRC, FRONTEND_SRC]) {
      for (const file of sourceFiles(root)) {
        const text = stripComments(readFileSync(file, "utf8"))
        for (const [from, embedded] of PAIRS) {
          for (const offset of unkeyedEmbeds(text, embedded)) {
            if (tableAt(text, offset) !== from) continue
            const line = text.slice(0, offset).split("\n").length
            offenders.push(`${relative(root, file).split(sep).join("/")}:${line} — ${from} embeds ${embedded} with no key`)
          }
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it("the scan sees a bare or modifier-only embed and lets a keyed one through", () => {
    const bare = `supabase.from("jobs").select("id, workflow_executions(is_component_execution)")`
    const modifierOnly = `supabase.from("jobs").select("id, workflow_executions!left(is_component_execution)")`
    const keyed = `supabase.from("jobs").select("id, workflow_executions!workflow_execution_id(is_component_execution)")`
    const reverseBare = `supabase.from("workflow_executions").select("id, jobs!inner(status)")`
    const reverseKeyed = `supabase.from("workflow_executions").select("id, jobs!wrapper_job_id(status)")`
    expect(unkeyedEmbeds(bare, "workflow_executions").map((o) => tableAt(bare, o))).toEqual(["jobs"])
    expect(unkeyedEmbeds(modifierOnly, "workflow_executions").map((o) => tableAt(modifierOnly, o))).toEqual(["jobs"])
    expect(unkeyedEmbeds(keyed, "workflow_executions")).toEqual([])
    expect(unkeyedEmbeds(reverseBare, "jobs").map((o) => tableAt(reverseBare, o))).toEqual(["workflow_executions"])
    expect(unkeyedEmbeds(reverseKeyed, "jobs")).toEqual([])
  })
})
