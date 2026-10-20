/**
 * SYNCHRONOUS JOB ROWS CARRY THEIR BOOKKEEPING COLUMNS.
 *
 * A queued job gets `job_type` and `started_at` from the worker's pickup, and
 * `progress` / `completed_at` from `markJobCompleted`. A route that works its
 * job inside the request and settles the row itself has neither: unless the
 * insert and the in-route terminal write say so, the row lives forever with
 * `job_type` NULL, `started_at` NULL, `completed_at` NULL and `progress` 0.
 * It still holds its credits, but every tally, job list and duration read
 * keyed on those columns silently drops it. Image to Text shipped exactly
 * that way, and so did most of the text/JSON routes beside it.
 *
 * Three rules, each derived from the code rather than from a hand list:
 *
 *  1. A file that settles its own jobs — an in-route `status: "completed"`
 *     write on `jobs`, a completed insert, or a `markJobCompleted` call — must
 *     create them with `insertSyncJob` (job_type is a required argument there,
 *     started_at is stamped), not plain `insertJob` / `insertJobs` /
 *     `insertJobIdempotent`. A file that ALSO has queued lanes names how many
 *     queued inserts it has in MIXED_LANE_FILES, with the reason; the count is
 *     exact, so a new insert in that file has to be classified.
 *  2. Every in-route `status: "completed"` write on `jobs` (an update or an
 *     insert row) spreads `completedJobColumns()` — progress 100 and
 *     completed_at, spelled once in `lib/job-status.ts`.
 *  3. Every in-route `status: "failed"` write on `jobs` stamps `completed_at`.
 *     (Most failures belong in `markJobFailed`, which stamps it for you; the
 *     result-gate totality guard decides which files may still write inline.)
 *
 * Parsed with the TypeScript compiler (see source-scan.ts): comments are not
 * nodes, and a reformatted chain still matches.
 */
import { describe, expect, it } from "vitest"
import ts from "typescript"
import { eachSourceFile, lineOf, SCAN_TIMEOUT_MS, walk } from "./source-scan.js"

/** Plain insert helpers: they leave job_type / started_at to a worker pickup. */
const PLAIN_INSERTS = new Set(["insertJob", "insertJobs", "insertJobIdempotent"])
/** Every request-path insert helper, for the completed-insert check. */
const ROW_INSERTS = new Set([...PLAIN_INSERTS, "insertSyncJob", "insertSyncJobIdempotent", "insertInternalJob"])
const COMPLETION_FUNNELS = new Set(["markJobCompleted", "markJobCompletedDetailed"])

/**
 * Files that settle some jobs in-route AND enqueue others. The queued inserts
 * get job_type and started_at at worker pickup, so they stay plain. The number
 * is the exact count of plain insert calls the file is expected to have.
 */
const MIXED_LANE_FILES: ReadonlyMap<string, { readonly queuedInserts: number; readonly why: string }> = new Map([
  ["routes/suno.ts", {
    queuedInserts: 12,
    why: "every Suno generation lane is queued; style-boost and the voice validate/create lanes settle in-route and use insertSyncJob",
  }],
  ["routes/motion-graphics-ai.ts", {
    queuedInserts: 1,
    why: "the Lottie render lane is queued (motion-graphics-lottie); the plan lane settles in-route",
  }],
  ["lib/private-plugins/toolkit.ts", {
    queuedInserts: 1,
    why: "http.insertJobWithProvenance is a plugin route's QUEUED lane (insert pending -> reserve -> videoQueue.add; " +
      "the worker's pickup stamps job_type/started_at); the file only settles through tk.jobs.markJobCompleted, " +
      "the core completion funnel it hands to plugin worker handlers",
  }],
])

interface Site { readonly file: string; readonly line: number }

/** The table a `.update(` / `.insert(` chain writes to: the nearest `.from("…")` below it. */
function chainTable(expr: ts.Expression): string | null {
  let cur: ts.Node = expr
  for (;;) {
    if (ts.isParenthesizedExpression(cur) || ts.isNonNullExpression(cur) || ts.isAwaitExpression(cur)) {
      cur = cur.expression
    } else if (ts.isPropertyAccessExpression(cur)) {
      cur = cur.expression
    } else if (ts.isCallExpression(cur)) {
      const callee = cur.expression
      if (ts.isPropertyAccessExpression(callee) && callee.name.text === "from") {
        const arg = cur.arguments[0]
        return arg && ts.isStringLiteralLike(arg) ? arg.text : null
      }
      cur = callee
    } else {
      return null
    }
  }
}

/** A property's key, when it is a plain name (the tree has no parent pointers, so no getText()). */
function propName(name: ts.PropertyName): string | null {
  return ts.isIdentifier(name) || ts.isStringLiteralLike(name) ? name.text : null
}

/** The statuses an object literal's `status` property can write. */
function statusesOf(obj: ts.ObjectLiteralExpression): string[] {
  for (const p of obj.properties) {
    if (!ts.isPropertyAssignment(p) || propName(p.name) !== "status") continue
    const out: string[] = []
    const collect = (e: ts.Expression): void => {
      if (ts.isStringLiteralLike(e)) out.push(e.text)
      else if (ts.isConditionalExpression(e)) { collect(e.whenTrue); collect(e.whenFalse) }
      else if (ts.isParenthesizedExpression(e)) collect(e.expression)
    }
    collect(p.initializer)
    return out
  }
  return []
}

function containsCall(node: ts.Node, name: string): boolean {
  let found = false
  walk(node, (n) => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === name) found = true
  })
  return found
}

function spreadsCompletion(obj: ts.ObjectLiteralExpression): boolean {
  return obj.properties.some((p) => ts.isSpreadAssignment(p) && containsCall(p.expression, "completedJobColumns"))
}

function stampsCompletedAt(obj: ts.ObjectLiteralExpression): boolean {
  if (spreadsCompletion(obj)) return true
  return obj.properties.some((p) => {
    if ((ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) && propName(p.name) === "completed_at") return true
    if (!ts.isSpreadAssignment(p)) return false
    let found = false
    walk(p.expression, (n) => {
      if (ts.isPropertyAssignment(n) && propName(n.name) === "completed_at") found = true
    })
    return found
  })
}

interface FileFacts {
  settles: boolean
  plainInserts: Site[]
  completedWithoutStamp: Site[]
  failedWithoutStamp: Site[]
  completedWrites: number
  failedWrites: number
}

function factsOf(sf: ts.SourceFile, file: string): FileFacts {
  const facts: FileFacts = {
    settles: false, plainInserts: [], completedWithoutStamp: [], failedWithoutStamp: [], completedWrites: 0, failedWrites: 0,
  }
  const judge = (obj: ts.ObjectLiteralExpression, at: ts.Node): void => {
    const statuses = statusesOf(obj)
    if (statuses.includes("completed")) {
      facts.settles = true
      facts.completedWrites++
      if (!spreadsCompletion(obj)) facts.completedWithoutStamp.push({ file, line: lineOf(sf, at) })
    }
    if (statuses.includes("failed")) {
      facts.failedWrites++
      if (!stampsCompletedAt(obj)) facts.failedWithoutStamp.push({ file, line: lineOf(sf, at) })
    }
  }
  walk(sf, (n) => {
    if (!ts.isCallExpression(n)) return
    const callee = n.expression
    // supabase.from("jobs").update({...}) / .insert({...})
    if (ts.isPropertyAccessExpression(callee) && (callee.name.text === "update" || callee.name.text === "insert")) {
      const arg = n.arguments[0]
      if (arg && ts.isObjectLiteralExpression(arg) && chainTable(callee.expression) === "jobs") judge(arg, arg)
      return
    }
    if (!ts.isIdentifier(callee)) return
    if (COMPLETION_FUNNELS.has(callee.text)) facts.settles = true
    if (PLAIN_INSERTS.has(callee.text)) facts.plainInserts.push({ file, line: lineOf(sf, n) })
    if (ROW_INSERTS.has(callee.text)) {
      for (const arg of n.arguments) if (ts.isObjectLiteralExpression(arg)) judge(arg, arg)
    }
  })
  return facts
}

function scan(): Map<string, FileFacts> {
  const out = new Map<string, FileFacts>()
  eachSourceFile(['"jobs"', "insertJob", "insertSyncJob", "insertInternalJob", "markJobCompleted"], (sf, rel) => {
    if (rel === "lib/insert-job.ts") return
    out.set(rel, factsOf(sf, rel))
  })
  return out
}

const fmt = (sites: readonly Site[]) => sites.map((s) => `  • ${s.file}:${s.line}`).join("\n")

describe("synchronous job rows carry job_type, started_at, progress and completed_at", () => {
  const facts = scan()
  const all = [...facts.values()]

  it("scans the real population (the guard is wired to something)", () => {
    expect([...facts.entries()].filter(([, f]) => f.settles).length).toBeGreaterThan(20)
    expect(all.reduce((n, f) => n + f.completedWrites, 0)).toBeGreaterThan(20)
    expect(all.reduce((n, f) => n + f.failedWrites, 0)).toBeGreaterThan(5)
  }, SCAN_TIMEOUT_MS)

  it("a file that settles its own jobs creates them with insertSyncJob", () => {
    const violations: string[] = []
    for (const [file, f] of facts) {
      if (!f.settles || f.plainInserts.length === 0) continue
      const mixed = MIXED_LANE_FILES.get(file)
      if (mixed && mixed.queuedInserts === f.plainInserts.length) continue
      violations.push(
        mixed
          ? `  • ${file}: ${f.plainInserts.length} plain inserts, MIXED_LANE_FILES expects ${mixed.queuedInserts} — classify the new one\n${fmt(f.plainInserts)}`
          : fmt(f.plainInserts),
      )
    }
    expect(
      violations,
      `These files settle their own jobs (no worker pickup ever stamps the row) but create ` +
        `them with a plain insert, so the row keeps job_type and started_at NULL for life.\n\n` +
        `Use insertSyncJob(req, "<node type>", row) from lib/insert-job.js. If the insert is a ` +
        `QUEUED lane in a file that also settles in-route, count it in MIXED_LANE_FILES with the reason.\n\n` +
        violations.join("\n"),
    ).toEqual([])
  }, SCAN_TIMEOUT_MS)

  it("has no stale MIXED_LANE_FILES entry", () => {
    const stale = [...MIXED_LANE_FILES.keys()].filter((file) => {
      const f = facts.get(file)
      return !f || !f.settles || f.plainInserts.length === 0
    })
    expect(stale, `MIXED_LANE_FILES entries that no longer mix lanes:\n${stale.join("\n")}`).toEqual([])
  }, SCAN_TIMEOUT_MS)

  it("every in-route completion spreads completedJobColumns()", () => {
    const sites = all.flatMap((f) => f.completedWithoutStamp)
    expect(
      sites,
      `These write status:"completed" on jobs without progress/completed_at. Spread ` +
        `...completedJobColumns() from lib/job-status.js into the same object (keep the ` +
        `status literal inline — the result-gate totality guard finds the write by it).\n\n${fmt(sites)}`,
    ).toEqual([])
  }, SCAN_TIMEOUT_MS)

  it("every in-route failure stamps completed_at", () => {
    const sites = all.flatMap((f) => f.failedWithoutStamp)
    expect(
      sites,
      `These write status:"failed" on jobs without completed_at. Prefer markJobFailed from ` +
        `lib/job-failure.js (it stamps it); a writer the totality guard allows to stay inline ` +
        `must stamp completed_at itself.\n\n${fmt(sites)}`,
    ).toEqual([])
  }, SCAN_TIMEOUT_MS)
})
