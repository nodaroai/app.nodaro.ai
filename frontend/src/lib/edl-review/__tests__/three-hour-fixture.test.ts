/**
 * The latency budgets' scaling: coverage and the CI runner are separate
 * slowdowns, so each gets its own factor. A local `test:coverage` run must get
 * the coverage allowance with CI unset, and a CI run without coverage must not.
 */
import { describe, expect, it } from "vitest"
import { coverageRequested, TIMING_UNDER_COVERAGE } from "@/test/coverage-flag"
import { budgetMs } from "./three-hour-fixture"

describe("budgetMs", () => {
  it("is the stated budget on a developer machine without coverage", () => {
    expect(budgetMs(50, {})).toBe(50)
  })

  it("covers the measured restore judgement under local coverage, CI unset", () => {
    // 59-68 ms measured for one restore judgement under coverage locally.
    expect(budgetMs(50, { [TIMING_UNDER_COVERAGE]: "1" })).toBe(250)
    expect(budgetMs(50, { [TIMING_UNDER_COVERAGE]: "1" })).toBeGreaterThan(68)
  })

  it("scales CI by the runner factor only, when coverage is off", () => {
    expect(budgetMs(50, { CI: "true" })).toBe(125)
  })

  it("multiplies both factors for a CI coverage run", () => {
    expect(budgetMs(50, { CI: "true", [TIMING_UNDER_COVERAGE]: "1" })).toBe(625)
  })
})

describe("coverageRequested", () => {
  it.each([
    [["vitest", "run", "--coverage"], true],
    [["vitest", "run", "--coverage=true"], true],
    [["vitest", "run", "--coverage.enabled"], true],
    [["vitest", "run", "--coverage.enabled=true"], true],
    [["vitest", "run"], false],
    [["vitest", "run", "--coverage=false"], false],
    [["vitest", "run", "--coverage.enabled=false"], false],
    [["vitest", "run", "--coverage.include=src/**"], false],
    [["vitest", "run", "--coverage", "--coverage.enabled=false"], false],
  ])("%j → %s", (argv, expected) => {
    expect(coverageRequested(argv)).toBe(expected)
  })
})
