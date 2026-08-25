import { describe, it, expect } from "vitest"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { toAccessRow, UnjudgeableWorkflowRow, WORKFLOW_ACCESS_COLS } from "../workflow-route-access.js"

/**
 * The coercion that decides whether a row can be judged at all.
 *
 * This is the piece with a trap in it, and the trap is silent. The natural
 * spelling — `row.workspace_id ?? null` — reads a column the QUERY forgot to
 * select as a confident "this workflow is personal", and personal is the
 * permissive answer in three directions at once: the rule then skips the
 * suspension check, skips the archived-workspace cap, and skips the cap that
 * holds a non-member's editor grant down to `view`. TypeScript cannot see it
 * (`Record<string, unknown>` makes a missing key and a null key one shape) and
 * neither can the tenant-scope lint. So it is tested here, twice: the helper
 * refuses, and no route is allowed to hand it a short projection.
 */

const CALLER = "00000000-0000-4000-8000-000000000001"
const WF = "00000000-0000-4000-8000-000000000020"
const WS = "00000000-0000-4000-8000-000000000030"

const FULL = { id: WF, user_id: CALLER, workspace_id: WS, visibility: "workspace" }

describe("toAccessRow", () => {
  it("passes a complete row through unchanged", () => {
    expect(toAccessRow({ ...FULL })).toEqual(FULL)
  })

  it("keeps a NULL workspace — personal work is a real answer, not an absence", () => {
    const personal = { ...FULL, workspace_id: null }
    expect(toAccessRow(personal).workspace_id).toBeNull()
  })

  it("THROWS when a column the rule reads was not selected", () => {
    // Each one on its own, because a route forgets one column, not all four.
    for (const missing of ["id", "user_id", "workspace_id", "visibility"] as const) {
      const short: Record<string, unknown> = { ...FULL }
      delete short[missing]
      expect(() => toAccessRow(short), `missing "${missing}" must refuse`).toThrow(
        UnjudgeableWorkflowRow,
      )
    }
  })

  it("does NOT quietly downgrade a workspace workflow to personal", () => {
    // The specific escalation: with `workspace_id` read as null, an outside
    // collaborator's editor grant stops being capped at `view` and a run stops
    // asking for membership. Answering "personal" here would be worse than
    // failing, because failing is visible.
    const { workspace_id: _dropped, ...short } = FULL
    expect(() => toAccessRow(short)).toThrow(/workspace_id/)
  })
})

describe("every route that judges a workflow selects the columns to judge it by", () => {
  it("no `loadWorkflowFor` call passes a projection missing an access column", () => {
    // The throw above is what stops a short projection from becoming a silent
    // grant. This is what stops one from reaching production as a 500 instead:
    // `loadWorkflowFor` takes its columns as an argument, so the mistake is
    // visible in the source and can be refused before it ships.
    //
    // Deliberately narrow. Inline `toAccessRow` call sites are NOT scanned —
    // matching a call to the select that fed it needs real dataflow, and a
    // regex that guesses would either miss the case or fail on the move
    // authorization's own three-column reads, which feed a different rule
    // entirely. Those sites are covered by the runtime refusal.
    const routesDir = join(__dirname, "..", "..", "routes")
    const required = WORKFLOW_ACCESS_COLS.split(",").map((c) => c.trim())
    const offenders: string[] = []
    let callSites = 0

    for (const file of readdirSync(routesDir).filter((f) => f.endsWith(".ts"))) {
      // Comment lines dropped first: the `tenant-scope-ignore` notes name
      // `loadWorkflowFor(..., "edit")` on purpose, and a scan that read those
      // as call sites would report three phantom offenders forever.
      const src = readFileSync(join(routesDir, file), "utf8")
        .split(/\r?\n/)
        .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
        .join("\n")
      if (!src.includes("loadWorkflowFor(")) continue

      for (const m of src.matchAll(/loadWorkflowFor\(([\s\S]{0,400}?)\)/g)) {
        const args = m[1]!
        callSites++
        // Either a literal column list or one of the shared constants, both of
        // which carry all four.
        const literal = args.match(/"((?:[a-z_]+\s*,\s*)+[a-z_]+)"/)
        if (!literal) {
          if (/WORKFLOW_(FULL|META|ACCESS)_COLS/.test(args)) continue
          offenders.push(`${file}: loadWorkflowFor with an unrecognised projection`)
          continue
        }
        const cols = literal[1]!.split(",").map((c) => c.trim())
        const missing = required.filter((c) => !cols.includes(c))
        if (missing.length > 0) {
          offenders.push(`${file}: loadWorkflowFor("${literal[1]}") is missing ${missing.join(", ")}`)
        }
      }
    }

    // A guard that found nothing to check is not a passing guard.
    expect(callSites).toBeGreaterThan(0)
    expect(
      offenders,
      `the access rule reads ${WORKFLOW_ACCESS_COLS}:\n${offenders.join("\n")}`,
    ).toEqual([])
  })
})
