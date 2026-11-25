// tools/vitest/slow-tests-reporter.mjs
// Lists, in CI, the tests that relied on the default time limit and ran past
// the LOCAL default (ci-limits.mjs explains why CI's limit is bigger). Such a
// test passes in CI but fails on a developer's machine at normal speed — or it
// is a normally fast test on a slow host, which the list then shows as a
// block of unrelated tests. Information only: it never changes the result.
// A test's duration includes its beforeEach and afterEach hooks (Vitest starts
// the clock before them), so a slow per-test hook is listed with its test.
// beforeAll / afterAll are not: the reporter API gives them no duration.
// Output: one line per test in the log, and a table in the GitHub job summary
// when GITHUB_STEP_SUMMARY is set.
import { appendFileSync } from "node:fs"
import { basename, relative } from "node:path"
import { LOCAL_TEST_TIMEOUT_MS } from "./ci-limits.mjs"

const MAX_ROWS = 50

export default class SlowTestsReporter {
  constructor(options = {}) {
    this.thresholdMs = options.thresholdMs ?? LOCAL_TEST_TIMEOUT_MS
    this.slow = []
    this.root = process.cwd()
  }

  onInit(vitest) {
    try {
      this.root = vitest.config.root
      const { testTimeout, hookTimeout } = vitest.config
      process.stdout.write(`Time limits: ${testTimeout} ms per test, ${hookTimeout} ms per hook (tools/vitest/ci-limits.mjs)\n`)
    } catch {
      // never let the listing break a run
    }
  }

  onTestCaseResult(testCase) {
    try {
      const duration = testCase.diagnostic()?.duration
      if (duration === undefined || duration <= this.thresholdMs) return
      // A test with a limit of its own was sized for its work on purpose.
      if (testCase.task.timeout !== testCase.project.config.testTimeout) return
      this.slow.push({
        file: relative(this.root, testCase.module.moduleId),
        name: testCase.fullName,
        ms: Math.round(duration),
        state: testCase.result().state,
      })
    } catch {
      // never let the listing break a run
    }
  }

  onTestRunEnd() {
    try {
      if (this.slow.length === 0) return
      const suite = basename(this.root)
      const rows = [...this.slow].sort((a, b) => b.ms - a.ms)
      const limit = `${this.thresholdMs / 1000} s`
      process.stdout.write(`\n${rows.length} test(s) in ${suite} ran past the local ${limit} limit on the default limit:\n`)
      for (const r of rows) process.stdout.write(`  ${r.ms} ms  ${r.file} > ${r.name}\n`)
      process.stdout.write(`::notice title=Slow tests (${suite})::${rows.length} test(s) ran past the local ${limit} limit without a limit of their own — listed in the job summary\n`)
      const summary = process.env.GITHUB_STEP_SUMMARY
      if (!summary) return
      const cell = (s) => String(s).replace(/\|/g, "\\|").replace(/\n/g, " ")
      const lines = [
        `### Slow tests: ${suite}`,
        "",
        `${rows.length} test(s) relied on the default time limit and took over ${limit}, the limit a developer's machine uses. ` +
          "CI allows more because its hosts can run several times slower than normal. A test listed here on its own is " +
          "probably slow everywhere: speed it up, or give it a limit of its own. Many unrelated tests listed together " +
          "usually mean a slow host.",
        "",
        "| ms | test | file | result |",
        "| ---: | --- | --- | --- |",
        ...rows.slice(0, MAX_ROWS).map((r) => `| ${r.ms} | ${cell(r.name)} | ${cell(r.file)} | ${r.state} |`),
        ...(rows.length > MAX_ROWS ? ["", `… and ${rows.length - MAX_ROWS} more in the log.`] : []),
        "",
      ]
      appendFileSync(summary, lines.join("\n") + "\n")
    } catch {
      // information only
    }
  }
}
