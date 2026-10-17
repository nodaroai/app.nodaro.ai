// @test-watches backend/src/routes/**/*.ts backend/src/ee/routes/**/*.ts backend/src/nodes/*/route*.ts
/**
 * A ROUTE THAT RESERVES A JOB'S CREDITS AND MARKS THE JOB COMPLETED SETTLES THE HOLD.
 *
 * The synchronous POST /v1/social/publish reserved, wrote `status: "completed"`,
 * and never committed. Every successful publish left its `usage_logs` row
 * `reserved` for good. Nothing failed: the payer was debited at reserve time,
 * so only the accounting was wrong, and over months the stuck rows piled up.
 * Migrations 515 and 516 had to settle hundreds of them.
 *
 * This guard fails the build for any route file (`routes/`, `ee/routes/`) that
 * does both of these in code (comments stripped):
 *   - reserves (`reserveCreditsForJob(` / `.reserveCredits(`);
 *   - writes a job `status: "completed"`;
 * unless the same file also calls one of the settle funnels below. A
 * `creditGuard(..., { checkOnly: true })` route reserves nothing and is not
 * matched. A file that settles through something this list does not name goes
 * in SETTLES_ELSEWHERE, with the reason.
 *
 * It is file-keyed, like the job-policy result guard: it catches a route that
 * never settles, not a second completion path inside a file that already
 * settles once. The behaviour of each route is pinned by its own tests
 * (social-publish-settles-hold.test.ts for this one).
 */
import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { unitRouteFiles } from "../../lib/unit-source-files.js"

const SRC = join(__dirname, "..", "..")
const ROOTS = ["routes", "ee/routes"]

const SETTLE_CALLS = [
  "commitCredits(",
  "commitJobCredits(",
  "commitReservedCreditsForJob(",
  "markJobCompleted(",
  "finalizeJobWithMedia(",
  "completeJobAndSettle",
]

/** Route files that settle their hold through a path this guard cannot see. None today. */
const SETTLES_ELSEWHERE: ReadonlyMap<string, string> = new Map()

function tsFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name)
    if (statSync(abs).isDirectory()) {
      if (name === "__tests__" || name === "node_modules") continue
      out.push(...tsFiles(abs))
    } else if (name.endsWith(".ts") && !name.endsWith(".test.ts") && !name.endsWith(".d.ts")) {
      out.push(abs)
    }
  }
  return out
}

/** Source with line and block comments removed, so a comment that names a
 *  settle call cannot satisfy the guard. */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1")
}

const RESERVES = /reserveCreditsForJob\(|\.reserveCredits\(/
const COMPLETES = /status:\s*["']completed["']/

// The two route trees, plus every node unit's route (labelled nodes/<type>/route.ts).
const files = [...ROOTS.flatMap((root) => tsFiles(join(SRC, root))), ...unitRouteFiles(join(SRC, "..", ".."))].map((abs) => ({
  file: abs.slice(SRC.length + 1).split("\\").join("/"),
  src: code(readFileSync(abs, "utf8")),
}))

const candidates = files.filter((f) => RESERVES.test(f.src) && COMPLETES.test(f.src))

describe("routes that reserve and complete a job settle its hold", () => {
  it("finds the routes it guards (the scan did not silently match nothing)", () => {
    expect(candidates.map((f) => f.file)).toContain("routes/social-publish.ts")
    expect(candidates.length).toBeGreaterThan(10)
  })

  it("every such route calls a settle funnel", () => {
    const unsettled = candidates
      .filter((f) => !SETTLES_ELSEWHERE.has(f.file))
      .filter((f) => !SETTLE_CALLS.some((call) => f.src.includes(call)))
      .map((f) => f.file)
    expect(unsettled, "reserves and marks a job completed but never commits the hold").toEqual([])
  })

  it("every SETTLES_ELSEWHERE entry is still a candidate", () => {
    const names = new Set(candidates.map((f) => f.file))
    expect([...SETTLES_ELSEWHERE.keys()].filter((f) => !names.has(f))).toEqual([])
  })

  it("strips comments, so a comment naming a settle call does not count", () => {
    const src = code(`reserveCreditsForJob(x)\nupdate({ status: "completed" })\n// commitCredits(id)\n/* commitJobCredits(id) */`)
    expect(SETTLE_CALLS.some((call) => src.includes(call))).toBe(false)
  })
})
