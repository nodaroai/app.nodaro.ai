/**
 * Whether this vitest run collects coverage, told to the test workers.
 *
 * Coverage instrumentation slows timed code several-fold on any machine, CI or
 * not, so the wall-clock budgets need to know about it on its own terms
 * (three-hour-fixture.ts `budgetMs`). The workers cannot see the CLI flags, so
 * vitest.config.ts reads them here and passes the answer on as an env var.
 */
export const TIMING_UNDER_COVERAGE = "TIMING_UNDER_COVERAGE"

/**
 * True when `argv` turns coverage on: `--coverage`, `--coverage=true`,
 * `--coverage.enabled` or `--coverage.enabled=true`. The `=false` forms, and
 * coverage sub-options alone (`--coverage.include=…`), leave it off.
 */
export function coverageRequested(argv: readonly string[]): boolean {
  let on = false
  for (const arg of argv) {
    const match = /^--coverage(?:\.enabled)?(?:=(.*))?$/.exec(arg)
    if (match) on = match[1] === undefined || match[1] !== "false"
  }
  return on
}
