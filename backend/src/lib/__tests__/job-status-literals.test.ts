/**
 * Guard: no hand-rolled `jobs.status` VOCABULARY. Import from `lib/job-status.ts`.
 *
 * WHY. `pending_review` (spec §6.1, D14) is a real, in-flight `jobs.status`.
 * Any place that re-declares the vocabulary by hand — a `z.enum([...])` in a
 * route schema, a `CANCELLABLE_STATUSES` const — silently omits it, and the
 * omission is invisible: the enum rejects a live row's status at response-
 * validation time (a 500 on `GET /v1/jobs/:id` for a held job), or the const
 * refuses an operation the API promises. That is exactly how the constraint
 * drifted three times for `workflow_executions.trigger_type`
 * (`src/__tests__/trigger-type-constraint-sync.test.ts`).
 *
 * WHAT IS AND IS NOT A "VOCABULARY" — the load-bearing distinction.
 *
 * Spec §11.1 prescribes two shapes: (i) contains `pending` AND `processing`,
 * lacks `pending_review`; (ii) contains `pending` AND `completed`, lacks
 * `pending_review`. Applied naively to `backend/src` those flag **30 array
 * literals that are correct and must stay narrow** — every one of them the
 * second argument of a `.in("status", [...])` query predicate:
 *
 *   • CAS WRITE GUARDS. `workers/shared.ts:160,180`, `render-worker.ts:772,960`,
 *     `video-worker.ts:406`, `toolkit.ts:632` and the eight reconcile modules
 *     compare-and-swap a row `.eq("id", jobId).in("status", ["pending",
 *     "processing"])`. D9 is explicit that `markJobCompleted`'s CAS is **NOT**
 *     widened to admit `pending_review` — widening it would let a stray worker
 *     complete a held row and re-enter the result gate. Adding the literal to
 *     these is a BUG, not a fix.
 *   • SWEEP PREDICATES. Spec §6.2 lists ~18 `.in`/`.eq` status filters as
 *     "exempt with NO change — positive filters": a held row is out of
 *     `pending|processing` by construction, which is the whole reason no
 *     liveness sweep can touch it.
 *
 * So this guard scans for a re-declared vocabulary, not for every status
 * filter: an array literal that is the argument of `.in("status", …)` is a
 * query predicate and is skipped. Recorded as a correction to spec §11.1 — the
 * two shapes are right, the scope was not stated.
 *
 * KNOWN HOLE, stated rather than hidden: `lib/mcp/tasks.ts:139`
 * (`markJobCancelled`) is a `.in("status", ["pending","processing"])` that spec
 * §6.3 says MUST widen (D17 — user cancel wins over a held job). It is a
 * predicate, so this guard cannot see it. It is covered by WS4's own tests, not
 * by a grep.
 *
 * Also skipped: `__tests__` (they assert the predicates above verbatim), and
 * any literal whose preceding context names a DIFFERENT state machine
 * (`workflow_executions`, MCP tasks, copilot turns, pipelines, trigger types) —
 * those legitimately share the words "pending"/"completed".
 */

import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const BACKEND_SRC = join(__dirname, "..", "..")

/**
 * Files that re-declare the vocabulary today and are fixed by a LATER
 * workstream in this same release. Each entry is a TODO with an owner: when the
 * owner lands, the file stops matching and the "no stale entry" assertion below
 * fails until the entry is deleted. That is deliberate — a permanent allowlist
 * is how a guard dies.
 */
const TODO_ALLOWLIST: ReadonlyMap<string, string> = new Map([
  // EMPTY, and that is the point: every entry this guard shipped with has been
  // deleted by the workstream that fixed its file. For the record —
  //   • `lib/cancel-job.ts` — CANCELLABLE_STATUSES is IN_FLIGHT_JOB_STATUSES
  //     now, with an explicit `pending_review` branch (D17);
  //   • `routes/workflow-execution.ts` — :664's activeJobStatuses, found BY
  //     this guard and named in no blueprint: it answered 409 for a job the
  //     single-job cancel route cancels;
  //   • `lib/private-plugins/toolkit.ts` — the post-CAS liveness probe, also
  //     found by this guard, which read a held job as terminal;
  //   • `ee/routes/admin-jobs.ts` and `lib/mcp/tools/jobs.ts` — both hand-rolled
  //     z.enums, now `z.enum(JOB_STATUSES)`.
  // The next entry added here needs an owner and a deletion date, not a home.
])

/** Other state machines that share the words "pending"/"processing"/"completed":
 *  `workflow_executions`, MCP tasks, copilot turns, pipeline stages, trigger
 *  types. `attnum`-style precision is not available to a grep, so the ENCLOSING
 *  IDENTIFIER is the signal — and the window it is read from matters more than
 *  the pattern. A wide window (say 200 characters) reaches back into unrelated
 *  code: every jobs route names `workflow_id` in its Zod schemas, so a real
 *  `z.object({ workflow_id: …, status: z.enum(["pending", …]) })` in
 *  routes/jobs.ts would be skipped — the exact file class this guard exists
 *  for. Two lines is where a declaration's identifier actually lives
 *  (`const X_STATUSES =`, `status:`, `.in("status",`). */
const OTHER_STATE_MACHINE = /EXECUTION|WORKFLOW|TASK|TURN|PIPELINE|TRIGGER/i

/** The literal's own line plus the one above it. */
function enclosingContext(src: string, index: number): string {
  return src.slice(0, index).split("\n").slice(-2).join("\n")
}

/**
 * Blank out comments while PRESERVING every byte offset (spaces for comment
 * characters, newlines kept) so reported line numbers match the real file. A
 * `stripComments` that deletes text reports the wrong line, which is worse than
 * no line at all in a guard whose whole output is a file:line list.
 */
function blankComments(src: string): string {
  const blank = (m: string) => m.replace(/[^\n]/g, " ")
  return src
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    // Negative lookbehind on ":" so "https://…" inside a string survives.
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1: string) => p1 + blank(m.slice(p1.length)))
}

function tsFiles(dir: string): string[] {
  const out: string[] = []
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    if (ent.name === "node_modules" || ent.name === "__tests__" || ent.name === "test") continue
    const p = join(dir, ent.name)
    if (ent.isDirectory()) out.push(...tsFiles(p))
    else if (ent.name.endsWith(".ts") && !ent.name.endsWith(".d.ts")) out.push(p)
  }
  return out
}

/** An array literal made only of lowercase snake_case string literals. */
const ARRAY_LITERAL =
  /\[(\s*(?:"[a-z][a-z_]*"|'[a-z][a-z_]*')\s*(?:,\s*(?:"[a-z][a-z_]*"|'[a-z][a-z_]*')\s*)*,?\s*)\]/g

/** `.in("status", [` — a query predicate, not a vocabulary. See the header. */
const STATUS_PREDICATE = /\.in\(\s*["']status["']\s*,\s*$/

interface Hit {
  file: string
  line: number
  values: string[]
}

function handRolledVocabularies(): Hit[] {
  const hits: Hit[] = []
  for (const abs of tsFiles(BACKEND_SRC)) {
    const src = blankComments(readFileSync(abs, "utf8"))
    for (const m of src.matchAll(ARRAY_LITERAL)) {
      const values = [...m[1].matchAll(/["']([a-z][a-z_]*)["']/g)].map((x) => x[1])
      const has = (v: string) => values.includes(v)
      if (has("pending_review")) continue
      const shapeI = has("pending") && has("processing")
      const shapeII = has("pending") && has("completed")
      if (!shapeI && !shapeII) continue

      const before = enclosingContext(src, m.index)
      if (STATUS_PREDICATE.test(before)) continue
      if (OTHER_STATE_MACHINE.test(before)) continue

      hits.push({
        file: abs.slice(BACKEND_SRC.length + 1).split("\\").join("/"),
        line: src.slice(0, m.index).split("\n").length,
        values,
      })
    }
  }
  return hits
}

describe("no hand-rolled jobs.status vocabulary", () => {
  const hits = handRolledVocabularies()

  it("every status vocabulary in backend/src derives from lib/job-status.ts", () => {
    const violations = hits
      .filter((h) => !TODO_ALLOWLIST.has(h.file))
      .map((h) => `  • ${h.file}:${h.line} → [${h.values.join(", ")}]`)

    expect(
      violations,
      `These array literals re-declare the jobs.status vocabulary by hand and omit ` +
        `"pending_review" (spec §6.1, D14). A held job's status then fails a z.enum ` +
        `response schema (a 500 on GET /v1/jobs/:id) or is silently refused by an ` +
        `operation the API promises. Import JOB_STATUSES / IN_FLIGHT_JOB_STATUSES / ` +
        `TERMINAL_JOB_STATUSES / PARKED_JOB_STATUSES from lib/job-status.js instead ` +
        `of listing the literals.\n\n` +
        `If this really is a narrow CAS guard or sweep predicate, it belongs inside ` +
        `.in("status", […]) — which this guard skips by construction (§6.2, D9).\n\n` +
        `${violations.join("\n")}`,
    ).toEqual([])
  })

  it("has no stale TODO allowlist entry (delete yours when your workstream lands)", () => {
    const stillMatching = new Set(hits.map((h) => h.file))
    const stale = [...TODO_ALLOWLIST.entries()]
      .filter(([file]) => !stillMatching.has(file))
      .map(([file, why]) => `  • ${file} — ${why}`)

    expect(
      stale,
      `These files are on TODO_ALLOWLIST in this test but no longer re-declare the ` +
        `vocabulary — the workstream that owns them has landed. Delete the entries ` +
        `from TODO_ALLOWLIST in ${"backend/src/lib/__tests__/job-status-literals.test.ts"}:\n\n` +
        `${stale.join("\n")}`,
    ).toEqual([])
  })

  it("is not vacuous — it walks the real tree and the shapes actually match something", () => {
    // Anti-vacuity: a refactor that breaks tsFiles() or ARRAY_LITERAL would
    // otherwise make this suite green by finding nothing at all.
    expect(tsFiles(BACKEND_SRC).length).toBeGreaterThan(200)
    expect(new Set(hits.map((h) => h.file))).toEqual(new Set(TODO_ALLOWLIST.keys()))
  })
})
