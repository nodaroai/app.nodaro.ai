// tools/__tests__/vitest-ci-limits.test.mjs
// Every Vitest suite takes its CI time limits from ONE place,
// tools/vitest/ci-limits.mjs (decided 2026-11-25, after a 3-4x slow CI host
// failed tests that take 1.5-2.3 s normally against Vitest's 5 s default).
// These tests hold that: every workspace whose tests run on Vitest has a
// config, every suite config spreads `ciTestOptions()` (or sizes its own
// limits), no test sets a file-wide limit below the CI default without
// `scaledTimeout`, every workspace whose tests use Testing Library gives its
// waits (findBy*, waitFor) the shared CI limit in a setup file and no file
// sets that limit lower (nor gives one wait a plain limit below it), the options are empty outside CI, the CI script that
// replaces the config's reporters names the slow-tests reporter too, and the
// reporter lists exactly the tests that leaned on the default limit.
import { test } from "node:test"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import {
  CI_ASYNC_UTIL_TIMEOUT_MS,
  CI_HOOK_TIMEOUT_MS,
  CI_LIMIT_FACTOR,
  CI_TEST_TIMEOUT_MS,
  LOCAL_ASYNC_UTIL_TIMEOUT_MS,
  LOCAL_TEST_TIMEOUT_MS,
  ciTestOptions,
  isCi,
  scaledTimeout,
  slowTestsReporterPath,
  testingLibraryOptions,
} from "../vitest/ci-limits.mjs"

const SLOW_TESTS_REPORTER = slowTestsReporterPath()
import SlowTestsReporter from "../vitest/slow-tests-reporter.mjs"

const root = fileURLToPath(new URL("../../", import.meta.url))
const read = (rel) => readFileSync(path.join(root, rel), "utf8")

/** Every suite config in the repository; fixtures belong to the tools that load them. */
function suiteConfigs() {
  return execFileSync("git", ["ls-files", "--", ":(glob)**/vitest.config.*", ":(glob)**/vitest.*.config.*"], { cwd: root, encoding: "utf8" })
    .split("\n")
    .filter(Boolean)
    .filter((f) => !f.startsWith("tools/__tests__/fixtures/"))
}

test("every suite config spreads ciTestOptions() or sizes its own limits", () => {
  const configs = suiteConfigs()
  assert.ok(configs.includes("backend/vitest.config.ts") && configs.includes("frontend/vitest.config.ts"), "the config listing found the suites")
  const missing = configs.filter((f) => {
    const src = read(f)
    return !/\.\.\.ciTestOptions\(\)/.test(src) && !/\btestTimeout\s*:/.test(src)
  })
  assert.deepEqual(missing, [], "spread `...ciTestOptions()` from tools/vitest/ci-limits.mjs into the config's `test` block")
})

/** The npm workspaces (root package.json `workspaces`, one level of `*`). */
function workspaces() {
  const globs = JSON.parse(read("package.json")).workspaces ?? []
  return globs.flatMap((g) => {
    if (!g.endsWith("/*")) return [g]
    const dir = g.slice(0, -2)
    return execFileSync("git", ["ls-files", "--", `${dir}/*/package.json`], { cwd: root, encoding: "utf8" })
      .split("\n").filter(Boolean).map((f) => path.dirname(f))
  })
}

test("every workspace whose tests run on Vitest has a config that takes the shared limits", () => {
  const configs = new Set(suiteConfigs())
  const vitestWorkspaces = workspaces().filter((w) => /\bvitest\b/.test(JSON.parse(read(`${w}/package.json`)).scripts?.test ?? ""))
  assert.ok(vitestWorkspaces.includes("backend") && vitestWorkspaces.includes("packages/remotion"), "the workspace listing found the suites")
  // Without a config file Vitest runs on its own defaults: the 5 s limit in CI too.
  const missing = vitestWorkspaces.filter((w) => ![...configs].some((c) => path.dirname(c) === w && /\/vitest\.config\.[^/]+$/.test(c)))
  assert.deepEqual(missing, [], "add a vitest.config.ts that spreads `...ciTestOptions()` (tools/vitest/ci-limits.mjs)")
})

test("no test sets a file-wide limit below the CI default as a plain number", () => {
  const files = execFileSync("git", ["ls-files", "--", ":(glob)**/*.test.ts", ":(glob)**/*.test.tsx", ":(glob)**/*.test.mts"], { cwd: root, encoding: "utf8" })
    .split("\n").filter(Boolean).filter((f) => !f.startsWith("tools/__tests__/fixtures/"))
  const low = []
  for (const f of files) {
    for (const m of read(f).matchAll(/setConfig\(\s*\{[^}]*\btestTimeout\s*:\s*([0-9_]+)\b/g)) {
      const ms = Number(m[1].replace(/_/g, ""))
      if (ms < CI_TEST_TIMEOUT_MS) low.push(`${f}: ${m[1]}`)
    }
  }
  // Written to be generous, such a limit gets LESS time in CI than a test on the
  // default; `scaledTimeout(ms)` keeps it ms locally and scales it in CI.
  assert.deepEqual(low, [], "use testTimeout: scaledTimeout(ms) from tools/vitest/ci-limits.mjs")
})

/** The workspace a repository path belongs to: the longest workspace directory it is under. */
function workspaceOf(file, dirs) {
  return dirs.filter((w) => file.startsWith(`${w}/`)).sort((a, b) => b.length - a.length)[0]
}

/** The setup files a suite config names (`setupFiles: ["./a.ts", …]`), as repository paths. */
function setupFilesOf(config) {
  const list = read(config).match(/\bsetupFiles\s*:\s*\[([^\]]*)\]/)
  if (!list) return []
  return [...list[1].matchAll(/["'`]([^"'`]+)["'`]/g)].map((m) => path.posix.join(path.posix.dirname(config), m[1]))
}

test("every workspace whose tests use Testing Library gives its waits the shared CI limit in a setup file", () => {
  const dirs = workspaces()
  const testFiles = execFileSync("git", ["grep", "-l", "-E", "from ['\"]@testing-library/(react|dom)['\"]", "--", ":(glob)**/*.test.*", ":(glob)**/__tests__/**"], { cwd: root, encoding: "utf8" })
    .split("\n").filter(Boolean).filter((f) => !f.startsWith("tools/"))
  const users = [...new Set(testFiles.map((f) => workspaceOf(f, dirs)).filter(Boolean))].sort()
  assert.ok(users.includes("frontend") && users.includes("packages/picker-ui"), `the listing found the Testing Library workspaces: ${users.join(", ")}`)
  const configs = suiteConfigs()
  const missing = users.filter((w) => {
    const config = configs.find((c) => path.dirname(c) === w && /\/vitest\.config\.[^/]+$/.test(c))
    if (!config) return true
    // configure() from @testing-library/dom (/react re-exports the same one) fed by the shared helper.
    return !setupFilesOf(config).some((s) => {
      if (!existsSync(path.join(root, s))) return false
      const src = read(s)
      return /\bconfigure\(\s*testingLibraryOptions\(\)\s*\)/.test(src) && /["']@testing-library\/(dom|react)["']/.test(src) && /ci-limits\.mjs["']/.test(src)
    })
  })
  // Testing Library's waits default to 1 s; a slow CI host expires them while the test's own limit is far off.
  assert.deepEqual(missing, [], "call configure(testingLibraryOptions()) (tools/vitest/ci-limits.mjs) in a setup file the workspace's vitest.config names")
})

test("no file sets Testing Library's wait limit below the CI value as a plain number", () => {
  const files = execFileSync("git", ["grep", "-l", "asyncUtilTimeout", "--", ":(glob)**/*.ts", ":(glob)**/*.tsx", ":(glob)**/*.mts", ":(glob)**/*.mjs", ":(glob)**/*.js"], { cwd: root, encoding: "utf8" })
    .split("\n").filter(Boolean).filter((f) => !f.startsWith("tools/__tests__/"))
  const low = []
  for (const f of files) {
    for (const m of read(f).matchAll(/\basyncUtilTimeout\s*:\s*([0-9_]+)\b/g)) {
      const ms = Number(m[1].replace(/_/g, ""))
      if (ms < CI_ASYNC_UTIL_TIMEOUT_MS) low.push(`${f}: ${m[1]}`)
    }
  }
  // A file-wide configure({ asyncUtilTimeout: 2000 }) would give every wait in it LESS time in CI than the shared default.
  assert.deepEqual(low, [], "use configure({ asyncUtilTimeout: scaledTimeout(ms) }) or the shared testingLibraryOptions() from tools/vitest/ci-limits.mjs")
})

test("no Testing Library test gives one wait a plain limit below the CI value", () => {
  // The files that use Testing Library: their `{ timeout: N }` is a wait's own limit
  // (`waitFor(fn, { timeout })`, `findBy*(q, {}, { timeout })`), which replaces the
  // shared one, so a plain number below CI_ASYNC_UTIL_TIMEOUT_MS gets LESS time on a
  // slow CI host than a wait left on the default. A test-level `{ timeout: N }` that
  // low would be shorter than the CI test limit too, so any such number is flagged.
  // Only literal numbers are read: a limit held in a variable is not seen.
  const files = execFileSync("git", ["grep", "-l", "-E", "from ['\"]@testing-library/(react|dom)['\"]", "--", ":(glob)**/*.test.*", ":(glob)**/__tests__/**"], { cwd: root, encoding: "utf8" })
    .split("\n").filter(Boolean).filter((f) => !f.startsWith("tools/"))
  assert.ok(files.length > 100, `the listing found the Testing Library test files: ${files.length}`)
  const low = []
  for (const f of files) {
    for (const m of read(f).matchAll(/\btimeout\s*:\s*([0-9_]+)\b/g)) {
      const ms = Number(m[1].replace(/_/g, ""))
      if (ms < CI_ASYNC_UTIL_TIMEOUT_MS) low.push(`${f}: ${m[1]}`)
    }
  }
  assert.deepEqual(low, [], "leave the wait on the shared limit, or give it { timeout: scaledTimeout(ms) } from tools/vitest/ci-limits.mjs")
})

test("testingLibraryOptions: empty locally (Testing Library's 1 s), the CI factor in CI", () => {
  assert.equal(LOCAL_ASYNC_UTIL_TIMEOUT_MS, 1_000)
  assert.equal(CI_ASYNC_UTIL_TIMEOUT_MS, LOCAL_ASYNC_UTIL_TIMEOUT_MS * CI_LIMIT_FACTOR)
  for (const env of [{}, { CI: "" }, { CI: "false" }, { CI: "0" }]) assert.deepEqual(testingLibraryOptions(env), {}, JSON.stringify(env))
  assert.deepEqual(testingLibraryOptions({ CI: "true" }), { asyncUtilTimeout: CI_ASYNC_UTIL_TIMEOUT_MS })
  // A wait that fails must report its own error, well before the test's limit cuts it off: room for several such waits.
  assert.ok(CI_ASYNC_UTIL_TIMEOUT_MS * 4 < CI_TEST_TIMEOUT_MS, "the wait limit stays well under the per-test limit")
})

test("scaledTimeout: the budget as written locally, scaled by the CI factor in CI", () => {
  assert.equal(scaledTimeout(15_000, {}), 15_000)
  assert.equal(scaledTimeout(15_000, { CI: "true" }), 60_000)
})

test("outside CI the options are empty: a developer's run keeps Vitest's defaults", () => {
  for (const env of [{}, { CI: "" }, { CI: "false" }, { CI: "0" }]) {
    assert.equal(isCi(env), false, JSON.stringify(env))
    assert.deepEqual(ciTestOptions(env), {})
  }
})

test("in CI the limits scale the local defaults and the slow-tests reporter is added beside Vitest's own", () => {
  // 20 s and one millisecond: a value no test spells, so the reporter can tell the default from a chosen 20 s
  assert.equal(CI_TEST_TIMEOUT_MS, 20_001)
  assert.equal(CI_HOOK_TIMEOUT_MS, 40_000)
  assert.deepEqual(ciTestOptions({ CI: "true" }), {
    testTimeout: CI_TEST_TIMEOUT_MS,
    hookTimeout: CI_HOOK_TIMEOUT_MS,
    reporters: ["default", SLOW_TESTS_REPORTER],
  })
  // Vitest adds github-actions itself only when a config names no reporter.
  assert.deepEqual(ciTestOptions({ CI: "true", GITHUB_ACTIONS: "true" }).reporters, ["default", "github-actions", SLOW_TESTS_REPORTER])
  assert.ok(existsSync(SLOW_TESTS_REPORTER))
})

test("run-suite.sh, whose --reporter flags replace the config's, names the slow-tests reporter on every main run", () => {
  const script = read("tools/test-select/run-suite.sh")
  const def = script.match(/^SLOW_TESTS_REPORTER="\$\(dirname "\$\{BASH_SOURCE\[0\]\}"\)\/(.+?)"$/m)
  assert.ok(def, "SLOW_TESTS_REPORTER is found from the script's own directory")
  assert.equal(path.join(root, "tools/test-select", def[1]), SLOW_TESTS_REPORTER)
  assert.match(script, /^JSON_ARGS=\(--reporter=default --reporter=json "\$\{SLOW_ARGS\[@\]\}" .*\)$/m)
  // Only the post-merge re-run of failed files (a labelling run) spells its own reporters.
  const inline = script.split("\n").filter((l) => /npx vitest run .*--reporter=/.test(l))
  assert.deepEqual(inline.map((l) => l.includes('"${failed[@]}"')), inline.map(() => true), inline.join("\n"))
})

/** A finished test case as the reporter API hands it over. */
function testCase({ name, ms, own }) {
  return {
    fullName: `suite > ${name}`,
    module: { moduleId: "/repo/backend/src/x.test.ts" },
    project: { config: { testTimeout: CI_TEST_TIMEOUT_MS } },
    task: { timeout: own ?? CI_TEST_TIMEOUT_MS },
    diagnostic: () => ({ duration: ms }),
    result: () => ({ state: "passed" }),
  }
}

test("the reporter lists the tests on the default limit that ran past the local one, and only those", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "slow-tests-"))
  const summary = path.join(dir, "summary.md")
  const saved = process.env.GITHUB_STEP_SUMMARY
  const write = process.stdout.write
  let out = ""
  process.env.GITHUB_STEP_SUMMARY = summary
  process.stdout.write = (s) => { out += s; return true }
  try {
    const reporter = new SlowTestsReporter()
    reporter.onInit({ config: { root: "/repo/backend", testTimeout: CI_TEST_TIMEOUT_MS, hookTimeout: CI_HOOK_TIMEOUT_MS } })
    reporter.onTestCaseResult(testCase({ name: "fast", ms: LOCAL_TEST_TIMEOUT_MS - 1 }))
    reporter.onTestCaseResult(testCase({ name: "slow", ms: LOCAL_TEST_TIMEOUT_MS + 2_000 }))
    reporter.onTestCaseResult(testCase({ name: "sized for its work", ms: 30_000, own: 60_000 }))
    reporter.onTestCaseResult(testCase({ name: "chose twenty seconds", ms: 6_000, own: 20_000 }))
    reporter.onTestRunEnd()
  } finally {
    process.stdout.write = write
    if (saved === undefined) delete process.env.GITHUB_STEP_SUMMARY
    else process.env.GITHUB_STEP_SUMMARY = saved
  }
  assert.match(out, /Time limits: 20001 ms per test, 40000 ms per hook/)
  assert.match(out, /7000 ms {2}src\/x\.test\.ts > suite > slow/)
  assert.doesNotMatch(out, /fast|sized for its work|chose twenty seconds/)
  const table = readFileSync(summary, "utf8")
  assert.match(table, /### Slow tests: backend/)
  assert.match(table, /\| 7000 \| suite > slow \| src\/x\.test\.ts \| passed \|/)
  rmSync(dir, { recursive: true })
})
