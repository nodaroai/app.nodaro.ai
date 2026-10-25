// @test-watches backend/src/**/*.ts
/**
 * EVERY READER HONOURS THE TRASH (decided 2026-10-25, migration 561).
 *
 * A job in the Trash (`jobs.deleted_at` set) reads, for every caller and every
 * user-facing read, exactly as a job that does not exist. There is no single
 * read funnel for `jobs` — each route and MCP tool queries it itself — so this
 * guard holds every one of them: each `.from("jobs")` READ (a chain with a
 * `.select(` and no write) in a file outside the internal directories below
 * must either FILTER `TRASHED_JOB_COLUMN` in the chain itself (`.is(…)` /
 * `.not(…)`, or the feed's `FEED_LIVE_JOB_FILTER`), or carry a
 * `// trash-read: <why>` comment in or just above the chain saying why it may
 * see a trashed job (the Trash's own routes; totals of spending; a write's own
 * pre-check; a read that checks the column in code). Naming the column in a
 * select is not enough. The same holds for any chain on another table whose
 * select embeds `jobs` (`jobs!…`, `:jobs(`), wherever in the chain it is.
 *
 * A new read anywhere a user can reach therefore fails here until it decides.
 * The internal directories are exempt as a whole, each for its stated reason:
 * they run jobs, settle them and sweep them, and never answer a user with a
 * job a person deleted.
 */
import { describe, expect, it } from "vitest"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative, sep } from "node:path"

const SRC = join(__dirname, "..", "..")

/** Directory prefixes (and file patterns) whose reads are internal, with why. */
const INTERNAL: ReadonlyArray<readonly [RegExp, string]> = [
  [/^workers\//, "job execution: a worker reads the job it runs"],
  [/^services\//, "the workflow engine and artifact services, server-side"],
  [/^providers\//, "provider adapters, server-side"],
  [/^middleware\//, "the credit guard's own bookkeeping"],
  [/^lib\/reconcile\//, "reconcile sweeps settle jobs, deleted or not"],
  [/^ee\/billing\//, "billing settlement counts spending, deleted or not"],
  [/^ee\/pipelines\//, "pipeline orchestration internals"],
  [/^ee\/notifications\//, "notification sends for a job's own lifecycle"],
  [/^ee\/scripts\//, "operator scripts"],
  [/^scripts\//, "operator scripts"],
  [/^lib\/webhooks\//, "outbound webhooks for a job's lifecycle events"],
  [/^lib\/private-plugins\//, "the plugin toolkit: its reads by id serve plugin flows server-side; its owner-scoped reads (readJobsOwnedBy, readOwnedJob) leave the Trash out themselves"],
  [/^ee\/routes\/admin-[^/]+\.ts$/, "admin tools see every job"],
  [/^lib\/mcp\/flows\/hydrate\.ts$/, "canvas write on completion"],
  [/^ee\/routes\/deployment-billing\.ts$/, "billing counts spending, deleted or not"],
  [/^ee\/lib\/credit-guard-impl\.ts$/, "the credit reservation's own bookkeeping"],
  [/^ee\/copilot\/turn-runner\.ts$/, "a Copilot turn settles what it spent"],
  [/^ee\/lib\/trends\/run-delete\.ts$/, "deleting a trend run reads the run it deletes"],
  [/^lib\/(app-expunge-targets|collect-app-r2-keys)\.ts$/, "expunging a published app's content, deleted jobs included"],
  [/^lib\/app-report-sweep\.ts$/, "the sweep classifies failed jobs for admins"],
  [/^lib\/(asset-delete|media-delete|key-ownership|kie-task-ownership)\.ts$/, "who owns stored bytes or a provider task: a deleted job still owns its media until the purge"],
  [/^lib\/(cancel-job|job-cancellation)\.ts$/, "cancelling stops work: a deleted job still running can be stopped"],
  [/^lib\/(discard-job-copies|job-finalize|job-policy-gate|job-policy-review|job-scratch|execution-budget)\.ts$/, "a job's own lifecycle: it finishes whether or not it was deleted"],
  [/^lib\/seedance-[a-z-]+\.ts$/, "a Seedance job's own lifecycle"],
  [/^lib\/(llm-[a-z-]+|meter-sync-llm)\.ts$/, "metered LLM billing counts spending, deleted or not"],
  [/^lib\/use-case\/(continue-claim|execution-wrappers|finalize-wrapper)\.ts$/, "a use-case run's own internals"],
  [/^lib\/dedup-fingerprint\.ts$/, "a lookup by idempotency key: the key is freed when its job goes to the Trash (lib/job-trash.ts), so it never finds one"],
]

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) {
      if (name === "__tests__" || name === "node_modules" || name === "generated") continue
      walk(p, out)
    } else if (name.endsWith(".ts") && !name.endsWith(".test.ts") && !name.endsWith(".d.ts")) {
      out.push(p)
    }
  }
  return out
}

/** The chain that starts at `start`: every following line while a paren is
 *  open, or while the next line continues it (`.`, `//`, `)`). */
function chainAt(lines: readonly string[], start: number): string {
  let depth = 0
  const out: string[] = []
  for (let i = start; i < lines.length; i++) {
    const line = lines[i]!
    out.push(line)
    for (const ch of line.replace(/(["'`])(?:\\.|(?!\1).)*\1/g, "")) {
      if (ch === "(") depth++
      else if (ch === ")") depth--
    }
    const next = lines[i + 1]?.trim() ?? ""
    if (depth <= 0 && !/^(\.|\/\/|\))/.test(next)) break
    if (out.length > 40) break
  }
  return out.join("\n")
}

export interface ReadSite {
  readonly file: string
  readonly line: number
  readonly ok: boolean
}

export function jobReadSites(): ReadSite[] {
  const sites: ReadSite[] = []
  for (const abs of walk(SRC)) {
    const file = relative(SRC, abs).split(sep).join("/")
    if (INTERNAL.some(([re]) => re.test(file))) continue
    const lines = readFileSync(abs, "utf8").replace(/\r\n/g, "\n").split("\n")
    lines.forEach((line, i) => {
      const from = line.match(/\.from\("([a-z_]+)"\)/)
      if (!from) return
      const chain = chainAt(lines, i)
      const fromJobs = from[1] === "jobs"
      // A jobs embed in another table's select (`job:jobs!job_id(...)`, `x:jobs(...)`).
      const embed = !fromJobs && /\.select\([\s\S]*?(\bjobs!|:jobs\()/.test(chain)
      if (!fromJobs && !embed) return
      if (fromJobs && /\.(update|insert|upsert|delete)\(/.test(chain)) return
      if (fromJobs && !chain.includes(".select(")) return
      const above = lines.slice(Math.max(0, i - 3), i).join("\n")
      const ok =
        /\.(is|not)\(\s*TRASHED_JOB_COLUMN/.test(chain) ||
        /\.is\(\s*`job\.\$\{TRASHED_JOB_COLUMN\}`/.test(chain) ||
        chain.includes("FEED_LIVE_JOB_FILTER") ||
        /trash-read:\s*\S/.test(chain) ||
        /trash-read:\s*\S/.test(above)
      sites.push({ file, line: i + 1, ok })
    })
  }
  return sites
}

describe("every user-facing jobs read leaves the Trash out", () => {
  const sites = jobReadSites()

  it("finds the reads it guards (the scan is not vacuous)", () => {
    expect(sites.length).toBeGreaterThan(40)
    expect(sites.some((s) => s.file === "routes/jobs.ts")).toBe(true)
    expect(sites.some((s) => s.file === "lib/mcp/tools/jobs.ts")).toBe(true)
    expect(sites.some((s) => s.file === "lib/gallery-listing.ts")).toBe(true)
  })

  it("each one filters TRASHED_JOB_COLUMN or says why it may read the Trash", () => {
    const missing = sites.filter((s) => !s.ok).map((s) => `${s.file}:${s.line}`)
    expect(missing).toEqual([])
  })
})
