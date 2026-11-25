// tools/vitest/ci-limits.mjs
// The per-test and per-hook time limits every Vitest suite uses in CI, and the
// reporter that lists the tests leaning on them. One definition: every suite
// config spreads `ciTestOptions()` into its `test` block, and
// tools/__tests__/vitest-ci-limits.test.mjs fails a config that does not (or
// that sets no limit of its own).
//
// Why CI gets a bigger limit than a developer's machine: the CI runners are
// containers on shared hosts, and one host can run a whole job 3-4x slower
// than its neighbours (measured on the Backend Tests shards, 2026-11-25:
// every phase — npm ci, transform, import, the tests themselves — slowed
// together, so it is the host, not a test). A CPU-bound test that takes 1.5-
// 2.3 s on a normal host then passed Vitest's 5 s default and failed a run
// that tested nothing wrong. The CI limit is the local default times
// CI_LIMIT_FACTOR, so a test normally under the local limit still passes on
// the slowest host seen.
//
// Locally nothing changes: the 5 s / 10 s defaults keep a slow test visible to
// whoever writes it. In CI the same visibility comes from the reporter below,
// which lists every test that relied on the default limit and ran past the
// LOCAL one — a real regression hiding behind the bigger CI limit shows up in
// the job summary instead of passing silently.
//
// The cost of the bigger limits is paid when something really hangs: a hung
// test now fails after 20 s instead of 5 s, and a hung beforeEach after 40 s
// instead of 10 s — once per test it runs before, so a file of N tests behind
// a hanging beforeEach takes about N x 40 s before the job moves on.
//
// A test that needs more than the default sets its own limit through
// `scaledTimeout(ms)`: `ms` locally, `ms` x CI_LIMIT_FACTOR in CI, so its
// budget keeps the same margin over the default on a slow host. A limit set
// as a plain number is used as written everywhere (right for a limit that is
// part of what the test asserts).
import { fileURLToPath } from "node:url"

/** Vitest's own defaults: what a developer's run uses. */
export const LOCAL_TEST_TIMEOUT_MS = 5_000
export const LOCAL_HOOK_TIMEOUT_MS = 10_000
/** The slowest CI host measured ran about 3.8x slower than a normal one. */
export const CI_LIMIT_FACTOR = 4
// One millisecond over the round figure: Vitest records only a test's resolved
// limit, so the reporter tells a test on this default from one that spelled
// `20_000` itself (sixteen do) by the value alone.
export const CI_TEST_TIMEOUT_MS = LOCAL_TEST_TIMEOUT_MS * CI_LIMIT_FACTOR + 1
export const CI_HOOK_TIMEOUT_MS = LOCAL_HOOK_TIMEOUT_MS * CI_LIMIT_FACTOR

/**
 * The reporter's path, worked out only when a config asks: test files import
 * this module too (for `scaledTimeout`), and in a jsdom test `import.meta.url`
 * is no file URL.
 */
export function slowTestsReporterPath() {
  return fileURLToPath(new URL("./slow-tests-reporter.mjs", import.meta.url))
}

/**
 * A test's own time limit: `ms` on a developer's machine, scaled by the CI
 * factor in CI. Use it for a limit that buys time for slow work
 * (`it(name, fn, scaledTimeout(15_000))`, `vi.setConfig({ testTimeout:
 * scaledTimeout(15_000) })`), never for one that is part of the assertion.
 */
export function scaledTimeout(ms, env = process.env) {
  return isCi(env) ? ms * CI_LIMIT_FACTOR : ms
}

/** GitHub Actions (hosted and self-hosted runners alike) sets CI=true. */
export function isCi(env = process.env) {
  const value = env.CI
  return value !== undefined && value !== "" && value !== "0" && value !== "false"
}

/**
 * The `test` options a suite config spreads in. Empty outside CI. In CI: the
 * scaled limits, and the reporters — Vitest's defaults (it adds
 * `github-actions` itself only when a config names no reporter) plus the slow
 * tests reporter. A `--reporter` on the command line replaces these, so a CI
 * script that passes its own (tools/test-select/run-suite.sh) names the slow
 * tests reporter too.
 */
export function ciTestOptions(env = process.env) {
  if (!isCi(env)) return {}
  return {
    testTimeout: CI_TEST_TIMEOUT_MS,
    hookTimeout: CI_HOOK_TIMEOUT_MS,
    reporters: ["default", ...(env.GITHUB_ACTIONS === "true" ? ["github-actions"] : []), slowTestsReporterPath()],
  }
}
