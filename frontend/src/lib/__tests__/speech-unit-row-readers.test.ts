/**
 * Totality, editor side: every surface that prices speech by length reads the
 * ONE estimator (lib/speech-estimate.ts) through the one hook — no component,
 * loop or helper names the unit row, builds its id, counts units or reads the
 * floor on its own. A file outside the allowlist that names any of the tokens
 * fails the build (decided 2026-10-06).
 */
import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, relative, resolve } from "node:path"

const SRC = resolve(__dirname, "../..")

function* sourceFiles(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    if (name === "__tests__" || name === "node_modules") continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) yield* sourceFiles(full)
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) yield full
  }
}
const FILES = [...sourceFiles(SRC)].map((path) => ({ rel: relative(SRC, path), text: readFileSync(path, "utf8") }))

const TOKENS = [/SPEECH_UNIT_CREDIT_SUFFIX/, /speechUnitCreditId\(/, /speechPriceUnits\(/, /SPEECH_FLOOR_UNITS/, /:per-100-chars/]
const names = (text: string) => TOKENS.some((t) => t.test(text))

const ALLOWLIST = [
  // The editor's estimator — the backend's mirror (one fixture pins the two).
  "lib/speech-estimate.ts",
  // The one hook: the unit row's price from the server, the quote for the pill, panel and Run button.
  "ee/hooks/use-speech-pricing.ts",
].sort()

describe("the speech unit-row readers census (editor)", () => {
  it("the scan covers the estimate loops (not vacuous)", () => {
    const rels = FILES.map((f) => f.rel)
    for (const must of ["components/editor/config-panels/helpers.ts", "components/editor/workflow-editor/types.ts", "hooks/use-live-run-estimate.ts", "lib/speech-estimate.ts"]) expect(rels).toContain(must)
  })

  it("every allowlisted file exists and names the formula", () => {
    for (const rel of ALLOWLIST) {
      const file = FILES.find((f) => f.rel === rel)
      expect(file, `${rel} is allowlisted but missing`).toBeDefined()
      expect(names(file!.text), `${rel} is allowlisted but names none of the tokens`).toBe(true)
    }
  })

  it("no other source file names the suffix, the unit id builder, the units function, the floor or the literal", () => {
    const offenders = FILES.filter((f) => !ALLOWLIST.includes(f.rel) && names(f.text)).map((f) => f.rel)
    expect(offenders, `read speechQuote / useSpeechPricing instead of the formula in:\n${offenders.join("\n")}`).toEqual([])
  })
})
