// @vitest-environment node
// @test-watches backend/src/**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs} frontend/src/**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs} backend/tsconfig.json frontend/tsconfig.json tools/structure/*.json
import { appendFileSync } from "node:fs"
import { beforeAll, describe, expect, it } from "vitest"
import { scanAndRun } from "../../../tools/structure/cli.mjs"

/**
 * The structure ratchets (tools/structure/README.md) over backend/src AND
 * frontend/src — one static value-import scan with the TypeScript parser.
 *
 * Fail the build:
 *   C1 cycles        the largest import cycle may not grow; no new cycle of 3+ files
 *   C3 boundaries    frontend src/lib may not import src/components or src/app
 * Report only (decided 2026-10-15) — a trend line and the offenders in the log,
 * the CI notices and the job summary, never a failure:
 *   C2 import budget tests loading more than 300 product files, against the recorded list
 *   C4 hub register  product files loaded by ≥ 25 % of their project's tests
 *
 * Each baseline JSON in tools/structure/ records today's state and may only
 * shrink (`node tools/structure/cli.mjs --tighten`). A C1/C3 failure names the
 * offending edge and the fix; never add the offender to a baseline.
 *
 * It lives in the frontend suite because the tools self-test job runs with no
 * npm install (no TypeScript to parse with) and the backend tsconfig has no
 * `allowJs` for the tools' .mjs modules; the scan covers both projects.
 */

const SCAN_TIMEOUT_MS = 180_000

let result: ReturnType<typeof scanAndRun>

// Written to the process streams: Vitest's default reporter drops a passing
// file's console output.
const log = (line: string) => process.stderr.write(`${line}\n`)
const notice = (title: string, text: string) => process.stdout.write(`::notice title=${title}::${text.replace(/\n/g, "%0A")}\n`)

beforeAll(() => {
  result = scanAndRun()

  for (const line of [...result.reports, ...result.findings]) log(`structure report: ${line}`)
  // A ratchet that loosened (a cycle shrank, a hub dropped out) never fails —
  // these notes are the only prompt to tighten the baseline.
  for (const note of result.notes) log(`structure ratchet: ${note}`)
  if (process.env.GITHUB_ACTIONS !== "true") return

  for (const line of result.reports) notice("Structure report (import budget, hubs)", line)
  if (result.notes.length > 0) {
    const shown = result.notes.slice(0, 5).map((n: string) => n.split("\n")[0])
    const more = result.notes.length > shown.length ? ` (+${result.notes.length - shown.length} more in the log)` : ""
    notice("Structure ratchets can be tightened", `${shown.join(" | ")}${more} — run node tools/structure/cli.mjs --tighten`)
  }
  const summary = process.env.GITHUB_STEP_SUMMARY
  if (summary) {
    const offenders = result.findings.map((f: string) => `- ${f.split("\n")[0]}`)
    try {
      appendFileSync(summary, ["", "#### Structure report (import budget, hubs: report only)", "",
        ...result.reports.map((r: string) => `- ${r}`), ...(offenders.length > 0 ? ["", "Offenders:", ...offenders] : []), ""].join("\n"))
    } catch {
      // A summary that cannot be written is not a test failure.
    }
  }
}, SCAN_TIMEOUT_MS)

const failuresOf = (ratchet: string): string[] => result.failures.filter((f: string) => f.startsWith(`[${ratchet}/`))
// The count, with every failure as the message: an array diff would print each one twice.
const expectNone = (ratchet: string) => {
  const failures = failuresOf(ratchet)
  expect(failures.length, `\n${failures.join("\n\n")}\n`).toBe(0)
}

describe("structure ratchets", () => {
  it("C1: no import cycle grows, and no new cycle of 3+ files appears", () => {
    expectNone("cycles")
  })

  it("C3: frontend src/lib imports no UI module beyond the recorded ones", () => {
    expectNone("boundaries")
  })

  it("only C1 and C3 can fail the build", () => {
    expect(result.failures.filter((f: string) => !/^\[(?:cycles|boundaries)\//.test(f))).toEqual([])
  })

  it("C2 and C4 report a trend line per project instead of failing", () => {
    for (const project of ["backend", "frontend"]) {
      expect(result.reports).toContainEqual(expect.stringMatching(new RegExp(`^\\[import-budget/${project}\\] report only — \\d+ tests over`)))
      expect(result.reports).toContainEqual(expect.stringMatching(new RegExp(`^\\[hubs/${project}\\] report only — \\d+ hubs`)))
    }
  })
})
