import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import path from "node:path"
import fg from "fast-glob"
import { CREDIT_BASE_USD } from "@nodaro/shared/models"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const BACKEND_SRC = path.resolve(HERE, "../../..")
const REPO_ROOT = path.resolve(BACKEND_SRC, "../..")

/** Strip line + block comments so prose about "$0.02" never trips the scan. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")
}

/**
 * Credit<->USD arithmetic against a literal base. Matches `/ 0.02`, `* 0.002`,
 * etc. — the shapes that bypass CREDIT_BASE_USD. Plain occurrences of the
 * number (a provider rate table, a tolerance) are deliberately NOT matched;
 * only multiplication and division, which is what a conversion looks like.
 */
const BYPASS = /[*/]\s*0\.0{1,2}2\b/

describe("CREDIT_BASE_USD is the single arithmetic source of truth", () => {
  it("pins the constant's value so a re-denomination is a deliberate, visible diff", () => {
    // Flipped from 0.02 to 0.002 by the credit re-denomination (Phase 2).
    // It must never move silently — a change here is always deliberate.
    expect(CREDIT_BASE_USD).toBe(0.002)
  })

  it("has no credit<->USD arithmetic against a hardcoded base outside the helper", async () => {
    const files = await fg(
      ["backend/src/**/*.ts", "packages/shared/src/**/*.ts", "packages/prompts/src/**/*.ts"],
      {
        cwd: REPO_ROOT,
        absolute: true,
        ignore: [
          "**/node_modules/**",
          "**/dist/**",
          "**/__tests__/**",
          // The helper is where this arithmetic is SUPPOSED to live.
          "**/packages/shared/src/credit-conversion.ts",
        ],
      },
    )
    // Fail loudly if the glob resolves nothing — an inert guard is worse than none.
    expect(files.length).toBeGreaterThan(100)

    const offenders: string[] = []
    for (const file of files) {
      const code = stripComments(readFileSync(file, "utf8"))
      code.split("\n").forEach((line, i) => {
        if (BYPASS.test(line)) offenders.push(`${path.relative(REPO_ROOT, file)}:${i + 1}  ${line.trim()}`)
      })
    }

    expect(
      offenders,
      `Credit<->USD conversion must go through usdToCredits()/creditsToUsd() from ` +
        `@nodaro/shared so re-denominating the credit stays a one-constant change.\n` +
        offenders.join("\n"),
    ).toEqual([])
  })

  it("detects a bypass when one exists (proves the scan is live)", () => {
    // Same matcher, run against a synthetic source — guards against the regex
    // silently ceasing to match after an edit.
    const sample = stripComments(`
      // a comment mentioning / 0.02 must NOT match
      const rate = 0.02            // a bare literal must NOT match
      const credits = Math.ceil(usd / 0.02)
      const usd2 = credits * 0.002
    `)
    const hits = sample.split("\n").filter(l => BYPASS.test(l))
    expect(hits).toHaveLength(2)
  })
})
