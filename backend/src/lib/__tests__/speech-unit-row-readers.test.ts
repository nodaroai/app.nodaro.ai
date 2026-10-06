/**
 * Totality: every surface that prices speech by length reads the ONE counter,
 * the ONE row reader and the ONE estimator — no surface computes the formula,
 * names the unit row or reads the floor on its own. A file outside this
 * allowlist that names any of the five tokens fails the build (decided
 * 2026-10-06). The pipeline seam, the UGC quote and the routes read
 * `speechLineEstimate` / `speechBaseCredits` / `speechChargeOverride`, never
 * the formula, and must NOT appear here.
 */
import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, relative } from "node:path"

const SRC = join(__dirname, "..", "..")

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) {
      if (name === "__tests__" || name === "node_modules") continue
      out.push(...sourceFiles(path))
    } else if (name.endsWith(".ts") && !name.endsWith(".test.ts")) {
      out.push(path)
    }
  }
  return out
}
const FILES = sourceFiles(SRC).map((path) => ({ rel: relative(SRC, path), text: readFileSync(path, "utf8") }))

/** The five ways a file could price speech on its own. */
const TOKENS = [/SPEECH_UNIT_CREDIT_SUFFIX/, /speechUnitCreditId\(/, /speechPriceUnits\(/, /SPEECH_FLOOR_UNITS/, /:per-100-chars/]
const names = (text: string) => TOKENS.some((t) => t.test(text))

/** The files that MAY read the formula, each for one reason. */
const ALLOWLIST = [
  // The one counter and row reader (Phase 1) + the "is this unit row served" predicate.
  "lib/speech-credits.ts",
  // The one estimator: what a node will send and the (unit row, units) pair; the job override.
  "lib/speech-estimate.ts",
  // The static unit rows, and the price table's flag filter on the suffix.
  "ee/billing/credits.ts",
  // list_models drops a unit row the table does not serve (the suffix).
  "lib/mcp/tools/models.ts",
  // The credit band: excludes unit rows from the flat band; states the length band where on.
  "lib/node-registry.ts",
  // The voiced-video add-on (Phase 1, PR 1B): priced on the synth model's unit row.
  "lib/voiced-dialogue-lines.ts",
].sort()

describe("the speech unit-row readers census", () => {
  it("the scan covers the tree (not vacuous)", () => {
    const rels = FILES.map((f) => f.rel)
    for (const must of ["ee/pipelines/credits.ts", "ee/lib/ugc-quote.ts", "routes/text-to-speech.ts", "lib/speech-estimate.ts"]) expect(rels).toContain(must)
  })

  it("every allowlisted file exists and names the formula (an entry that matches nothing is stale)", () => {
    for (const rel of ALLOWLIST) {
      const file = FILES.find((f) => f.rel === rel)
      expect(file, `${rel} is allowlisted but missing`).toBeDefined()
      expect(names(file!.text), `${rel} is allowlisted but names none of the tokens`).toBe(true)
    }
  })

  it("no other source file names the suffix, the unit id builder, the units function, the floor or the literal", () => {
    const offenders = FILES.filter((f) => !ALLOWLIST.includes(f.rel) && names(f.text)).map((f) => f.rel)
    expect(offenders, `price speech through lib/speech-credits.ts or lib/speech-estimate.ts instead of the formula in:\n${offenders.join("\n")}`).toEqual([])
  })

  it("the consumers that must read the estimator, not the formula, are off the allowlist", () => {
    for (const rel of ["ee/pipelines/credits.ts", "ee/lib/ugc-quote.ts", "ee/pipelines/services/pipeline-generate-speech.ts", "ee/pipelines/services/pipeline-generate-narration.ts", "routes/text-to-speech.ts", "routes/text-to-dialogue.ts", "routes/generate-video.ts"]) {
      expect(ALLOWLIST).not.toContain(rel)
    }
  })
})
