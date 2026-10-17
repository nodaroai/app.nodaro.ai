// tools/test-dedup/runners.mjs
// The two test runners behind tools/test-dedup/equivalence.mjs. Both answer
// one question — "run these test files (with this source overlay); which
// tests passed and which failed?" — as
//   { tests: [{ id, file, name, state, hookFailed, timedOut }], timedOut,
//     overlayLoaded, unhandledErrors, durationMs }
// where `id` is `<repo-relative file>#<describe > … > title>`, `hookFailed`
// says a beforeAll/afterAll (or the module itself) of an enclosing suite threw
// — the test's own state is then "skipped" or even "passed", yet the file is
// red — and `timedOut` that its only errors are timeouts. A module that failed
// to load is one `<module>` entry. `run(files, { only, exclude })` narrows a
// run to, or past, some test ids (by exact full name, per file).
//
// - createVitestRunner: the real one. One long-lived Vitest instance per
//   project (backend, frontend), created with `createVitest` (the same entry
//   tools/test-select/graph.mjs uses). A mutant is served from memory: the
//   `load` of every Vite environment's plugin container — the root's and each
//   `test.projects` entry's (a plugin passed to createVitest reaches only the
//   root server; the frontend's projects build their own) — answers for the
//   subject's path, and the subject is invalidated before each run. A product
//   file is NEVER written to disk: other agents share these checkouts, and
//   snapshots are never written either (`update: "none"`). `overlayLoaded`
//   says whether the run actually requested the overlaid file (false = the
//   mutant never reached the tests: a wrong subject, or a worker that kept a
//   cached copy).
// - createNodeTestRunner: node:test files in a scratch copy, run by a
//   `node --test` child (fixtures; the harness's own self-test, which must run
//   without npm ci).
// Vitest is imported lazily: importing this module needs no node_modules.
// @reads-none the caller names every file it runs or overlays
import { spawnSync } from "node:child_process"
import { cpSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"

import { testId } from "./verdicts.mjs"

const toPosix = (p) => p.split(path.sep).join("/")
const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

function withTimeout(promise, ms, onTimeout) {
  let timer
  const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve(onTimeout()), ms) })
  return Promise.race([promise.finally(() => clearTimeout(timer)), timeout])
}

/**
 * The name filter for one file of a run: `only` and `exclude` are test ids;
 * the result is a RegExp over a test's full name as both runners match it
 * (describe path and title joined by single spaces), or undefined. An exact
 * match per name, so `exclude` of "a" never skips "a b". Two names that join
 * to the same text are indistinguishable here — the caller checks what ran.
 */
export function namePattern(file, { only = [], exclude = [] }) {
  const names = (ids) => ids.filter((id) => id.startsWith(`${file}#`)).map((id) => id.slice(file.length + 1).split(" > ").join(" "))
  const alt = (list) => list.map(escapeRegExp).join("|")
  const o = names(only)
  const x = names(exclude)
  if (o.length > 0 && x.length > 0) throw new Error("a run narrows to `only` or past `exclude`, not both")
  if (o.length > 0) return new RegExp(`^(?:${alt(o)})$`)
  if (x.length > 0) return new RegExp(`^(?!(?:${alt(x)})$)`)
  return undefined
}

/**
 * SIGKILL every Vitest worker process this process forked. A worker stuck in
 * a synchronous loop answers neither cancel nor close — Vitest's close() then
 * waits forever — and it outlives this process when that is killed (found
 * spinning at 100% CPU, orphaned, after a timed-out run). Returns the pids.
 */
export function killVitestWorkers() {
  let ps = ""
  try { ps = spawnSync("ps", ["-A", "-o", "pid=,ppid=,command="], { encoding: "utf8" }).stdout ?? "" } catch { return [] }
  const pids = ps.split("\n").map((l) => l.trim().split(/\s+/))
    .filter(([, ppid, ...cmd]) => Number(ppid) === process.pid && cmd.join(" ").includes("vitest/dist/workers"))
    .map(([pid]) => Number(pid))
  for (const pid of pids) { try { process.kill(pid, "SIGKILL") } catch { /* gone already */ } }
  return pids
}

const isTimeoutError = (e) => /\b(?:test|hook) timed out\b/i.test(String(e?.message ?? e))

/**
 * @param {{ repoRoot: string, project: string, coverage?: { include: string[], reportsDirectory: string } }} opts
 *   project: the Vitest root, relative to repoRoot ("backend", "frontend").
 */
export async function createVitestRunner({ repoRoot, project, coverage }) {
  const root = path.join(repoRoot, project)
  const { createVitest } = await import("vitest/node")
  const overlay = new Map() // absolute path -> code
  const loaded = new Set()
  // Vite's loadAndTransform asks `environment.pluginContainer.load(id)` first
  // and reads the file only when that returns null.
  const hookLoad = (environment) => {
    const container = environment.pluginContainer
    if (!container || container.__testDedupOverlay) return
    const original = container.load.bind(container)
    container.load = async (id, ...rest) => {
      const file = id.split("?")[0]
      if (!overlay.has(file)) return original(id, ...rest)
      loaded.add(file)
      return { code: overlay.get(file), map: null }
    }
    container.__testDedupOverlay = true
  }
  let vitest = null
  const start = async () => {
    const prev = process.cwd()
    const argv = process.argv
    process.chdir(root) // createVitest resolves the config and projects from the cwd
    // A config that keys behaviour off its own command line (the frontend's
    // coverage-flag.ts: TIMING_UNDER_COVERAGE widens wall-clock budgets) sees
    // `--coverage` while it loads, as `vitest run --coverage` would give it.
    if (coverage) process.argv = [...argv, "--coverage"]
    try {
      vitest = await createVitest("test", {
        watch: false,
        run: true,
        root,
        update: "none", // never write a snapshot: a missing one fails, as on CI
        reporters: [{ onInit() {} }],
        ...(coverage ? { coverage: { enabled: true, provider: "v8", reporter: ["json"], include: coverage.include, reportsDirectory: coverage.reportsDirectory, clean: true } } : {}),
      }, {}, {})
    } finally {
      process.argv = argv
      process.chdir(prev)
    }
    // Coverage is set up by vitest.start(); runs here go through
    // runTestSpecifications, so the provider is created explicitly.
    if (coverage) {
      await vitest.initCoverageProvider()
      await vitest.coverageProvider?.clean?.(true) // creates the reports' .tmp directory
    }
    for (const server of [vitest.vite, ...vitest.projects.map((p) => p.vite)]) {
      for (const environment of Object.values(server.environments ?? {})) hookLoad(environment)
    }
  }
  await start()

  const rel = (abs) => toPosix(path.relative(repoRoot, abs))

  async function run(files, { overlay: next = new Map(), timeoutMs = 120_000, only = [], exclude = [] } = {}) {
    const touched = new Set([...overlay.keys(), ...next.keys()])
    overlay.clear()
    for (const [file, code] of next) overlay.set(path.resolve(repoRoot, file), code)
    for (const file of touched) vitest.invalidateFile(path.resolve(repoRoot, file))
    loaded.clear()
    const started = Date.now()
    const abs = files.map((f) => path.resolve(repoRoot, f))
    const found = (await vitest.getRelevantTestSpecifications(abs)).filter((s) => abs.includes(s.moduleId))
    const missing = abs.filter((f) => !found.some((s) => s.moduleId === f))
    if (missing.length > 0) throw new Error(`not a test file of ${project}: ${missing.map(rel).join(", ")}`)
    const specs = found.map((s) => {
      const testNamePattern = namePattern(rel(s.moduleId), { only, exclude })
      return testNamePattern ? s.project.createSpecification(s.moduleId, { testNamePattern }, s.pool) : s
    })
    vitest.resetGlobalTestNamePattern()
    // A mutant's unhandled error sets process.exitCode = 1; this run's verdict
    // is in its result, so the caller's (a test file's) exit code stays its own.
    const exitCode = process.exitCode
    const result = await withTimeout(vitest.runTestSpecifications(specs, true), timeoutMs, () => null)
    process.exitCode = exitCode
    if (result === null) {
      // A mutant that loops forever never returns: drop the whole instance
      // and start a fresh one. Its stuck worker answers neither cancel nor
      // close, so each gets a deadline and the worker is killed outright.
      await withTimeout(vitest.cancelCurrentRun("keyboard-input").catch(() => {}), 5_000, () => null)
      killVitestWorkers()
      await withTimeout(vitest.close().catch(() => {}), 10_000, () => null)
      killVitestWorkers()
      await start()
      process.exitCode = exitCode // the killed worker's exit marks the process failed
      return { tests: [], timedOut: true, overlayLoaded: null, unhandledErrors: 0, durationMs: Date.now() - started }
    }
    const tests = []
    // A suite or module with errors of its own (a throwing beforeAll/afterAll,
    // a collection error) — not one that merely holds a failed test.
    const ownErrors = (entity) => (entity.errors?.() ?? []).length > 0
    const ancestorErrors = (t) => {
      const out = []
      for (let p = t.parent; p; p = p.type === "module" ? null : p.parent) out.push(...(p.errors?.() ?? []))
      return out
    }
    // testModules is every module this Vitest instance has ever run — a
    // previous run's results would credit (or blame) the wrong tests.
    for (const mod of result.testModules.filter((m) => abs.includes(m.moduleId))) {
      const file = rel(mod.moduleId)
      const all = [...mod.children.allTests()]
      if (all.length === 0 && (mod.state() === "failed" || ownErrors(mod))) tests.push({ id: testId(file, "<module>"), file, name: "<module>", state: "failed", hookFailed: true, timedOut: false })
      for (const t of all) {
        const name = t.fullName
        const r = t.result()
        const hookErrors = ancestorErrors(t)
        const errors = [...(r.state === "failed" ? r.errors ?? [] : []), ...hookErrors]
        tests.push({
          id: testId(file, name), file, name, state: r.state === "pending" ? "skipped" : r.state,
          hookFailed: hookErrors.length > 0, timedOut: errors.length > 0 && errors.every(isTimeoutError),
        })
      }
    }
    const overlayLoaded = next.size === 0 ? null : [...overlay.keys()].some((f) => loaded.has(f))
    return { tests, timedOut: false, overlayLoaded, unhandledErrors: result.unhandledErrors.length, durationMs: Date.now() - started }
  }

  async function close() {
    const exitCode = process.exitCode
    await withTimeout(Promise.resolve(vitest?.close()).catch(() => {}), 30_000, () => null)
    killVitestWorkers()
    process.exitCode = exitCode
  }
  return { run, close, root }
}

/**
 * node:test runner for fixture directories. `fixtureDir` is copied to a
 * scratch directory once; overlays are written into that copy (never into the
 * fixture) and restored after each run. Test ids use the fixture-relative
 * file names, so they match the original paths the caller passes. `only` /
 * `exclude` become --test-name-pattern / --test-skip-pattern (node matches a
 * full name joined by spaces too; a skipped test is not reported at all).
 */
export async function createNodeTestRunner({ fixtureDir }) {
  // realpath: the child reports real paths (macOS's tmpdir is a symlink).
  const work = realpathSync(mkdtempSync(path.join(os.tmpdir(), "test-dedup-node-")))
  cpSync(fixtureDir, work, { recursive: true })
  const reporter = new URL("./node-reporter.mjs", import.meta.url).href

  async function run(files, { overlay = new Map(), timeoutMs = 30_000, only = [], exclude = [] } = {}) {
    const originals = new Map()
    for (const [file, code] of overlay) {
      const abs = path.join(work, file)
      originals.set(abs, readFileSync(abs, "utf8"))
      writeFileSync(abs, code)
    }
    // node's name filters apply to every file of the run.
    if (only.length > 0 && files.length > 1) throw new Error("the node:test runner narrows (`only`) one file at a time")
    const filters = []
    for (const file of files) {
      const o = namePattern(file, { only })
      const x = namePattern(file, { exclude })
      if (o) filters.push(`--test-name-pattern=/${o.source}/`)
      if (x) filters.push(`--test-skip-pattern=/${namePattern(file, { only: exclude }).source}/`)
    }
    const started = Date.now()
    try {
      // A clean NODE_TEST_CONTEXT: inherited from a parent test process it
      // would make the child report into the parent instead of to stdout.
      const env = { ...process.env }
      delete env.NODE_TEST_CONTEXT
      const child = spawnSync(process.execPath, [
        "--test", `--test-reporter=${reporter}`, `--test-timeout=${timeoutMs}`, ...filters,
        ...files.map((f) => path.join(work, f)),
      ], { cwd: work, env, encoding: "utf8", timeout: timeoutMs * 2, maxBuffer: 64 << 20 })
      const tests = []
      const stacks = new Map()
      let timedOut = child.error?.code === "ETIMEDOUT"
      for (const line of (child.stdout ?? "").split("\n")) {
        if (!line.startsWith("{")) continue
        const d = JSON.parse(line)
        if (!d.file) continue
        const file = toPosix(path.relative(work, d.file))
        const stack = stacks.get(file) ?? []
        stacks.set(file, stack)
        if (d.type === "test:start") { stack.length = d.nesting; stack.push(d.name); continue }
        if (d.suite) continue
        // The file itself failing (a top-level after() that threw): node
        // reports it as a test named by the file's path.
        if (d.nesting === 0 && d.name === d.file) {
          if (d.type === "test:fail") tests.push({ id: testId(file, "<module>"), file, name: "<module>", state: "failed", hookFailed: true, timedOut: false })
          continue
        }
        if (d.timedOut) timedOut = true
        const name = [...stack.slice(0, d.nesting), d.name].join(" > ")
        const state = d.skip ? "skipped" : d.type === "test:pass" ? "passed" : d.cancelled ? "skipped" : "failed"
        tests.push({ id: testId(file, name), file, name, state, hookFailed: d.cancelled || d.hookFailed, timedOut: false })
      }
      return { tests, timedOut, overlayLoaded: overlay.size === 0 ? null : true, unhandledErrors: 0, durationMs: Date.now() - started }
    } finally {
      for (const [abs, code] of originals) writeFileSync(abs, code)
    }
  }

  async function close() { rmSync(work, { recursive: true, force: true }) }
  return { run, close, root: work }
}

/**
 * What `files` execute in each subject, from a coverage run of their own
 * (Vitest v8 coverage, istanbul JSON), narrowed to the tests `only` names:
 *   lines  Map<repo-relative file, Set<line>> — a line where a covered
 *          statement starts (istanbul's line metric, for the report);
 *   hits   Map<file, Set<key>> — every covered statement, branch arm and
 *          function, keyed by its istanbul index and position (merge mode
 *          compares these: two arms on one line are two keys);
 *   spans  Map<file, [{ start, end, covered }]> — every statement, for the
 *          mutant pre-filter.
 *   missing  the subjects coverage never instrumented (outside the project root).
 * Every test the run was narrowed to must have run and passed: a candidate
 * that did not run would make every site it executes look unreachable.
 */
export async function coveredLines({ repoRoot, project, files, subjects, only = [], reportsDirectory }) {
  const projectRoot = path.join(repoRoot, project)
  const include = subjects.map((s) => toPosix(path.relative(projectRoot, path.resolve(repoRoot, s))))
  const runner = await createVitestRunner({ repoRoot, project, coverage: { include, reportsDirectory } })
  try {
    const res = await runner.run(files, { only })
    if (res.timedOut) throw new Error(`coverage run of ${files.join(", ")} timed out`)
    if (res.unhandledErrors > 0) throw new Error(`coverage run of ${files.join(", ")} had ${res.unhandledErrors} unhandled error(s)`)
    const bad = res.tests.filter((t) => t.state === "failed" || t.hookFailed).map((t) => t.id)
    if (bad.length > 0) throw new Error(`coverage run failed: ${bad.join(", ")}`)
    const passed = new Set(res.tests.filter((t) => t.state === "passed").map((t) => t.id))
    const notRun = only.filter((id) => !passed.has(id))
    if (notRun.length > 0) throw new Error(`coverage run did not run and pass: ${notRun.join(", ")}`)
    if (passed.size === 0) throw new Error(`coverage run of ${files.join(", ")} passed no test`)
  } finally {
    await runner.close()
  }
  const json = JSON.parse(readFileSync(path.join(reportsDirectory, "coverage-final.json"), "utf8"))
  const lines = new Map()
  const hits = new Map()
  const spans = new Map()
  const at = (loc) => `${loc.start.line}:${loc.start.column + 1}`
  for (const [abs, data] of Object.entries(json)) {
    const file = toPosix(path.relative(repoRoot, abs))
    const set = new Set()
    const keys = new Set()
    const all = []
    for (const [k, loc] of Object.entries(data.statementMap)) {
      const covered = data.s[k] > 0
      all.push({ ...loc, covered })
      if (covered) { set.add(loc.start.line); keys.add(`statement ${at(loc)}#${k}`) }
    }
    for (const [k, br] of Object.entries(data.branchMap ?? {})) {
      (data.b[k] ?? []).forEach((n, i) => { if (n > 0) keys.add(`branch ${at(br.locations?.[i] ?? br.loc)} ${br.type}[${i}]#${k}`) })
    }
    for (const [k, fn] of Object.entries(data.fnMap ?? {})) if (data.f[k] > 0) keys.add(`function ${fn.name} ${at(fn.loc)}#${k}`)
    lines.set(file, set)
    hits.set(file, keys)
    spans.set(file, all)
  }
  // A subject coverage never instrumented (outside the project root): not
  // "nothing covered" — the caller decides (merge refuses, the pre-filter
  // keeps every site of it).
  const missing = subjects.filter((s) => !hits.has(toPosix(path.relative(repoRoot, path.resolve(repoRoot, s)))))
  return { lines, hits, spans, missing }
}

/**
 * Whether a candidate can reach a mutation site: the innermost statement
 * containing the site's start ran. Innermost, so a site inside a function that
 * was declared (its declaration ran) but never called is not counted. A site
 * in no statement at all is kept — the filter only ever drops a site the
 * candidate provably never executed.
 */
export function siteCovered(site, spans) {
  const col = site.column - 1 // istanbul columns are 0-based
  // Vitest's v8 → istanbul statements end with a null column: "to the end of
  // that line". As a number (endless), it must still rank a statement that
  // starts later on the line as the inner one.
  const endCol = (end) => end.column ?? 1e5
  const contains = ({ start, end }) => (site.line > start.line || (site.line === start.line && col >= start.column))
    && (site.line < end.line || (site.line === end.line && col <= endCol(end)))
  const size = ({ start, end }) => (end.line - start.line) * 1e6 + (endCol(end) - start.column)
  const inner = (spans.get(site.file) ?? []).filter(contains).sort((a, b) => size(a) - size(b))[0]
  return inner ? inner.covered : true
}
