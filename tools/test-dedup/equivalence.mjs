#!/usr/bin/env node
// tools/test-dedup/equivalence.mjs
// The proof harness of plan §5.7 (PR 2): before a test is removed, merged or
// a guard dropped, show that what it asserts is still asserted elsewhere.
// Each mode prints a markdown table for the PR description and exits non-zero
// unless the proof holds (0 proven, 1 not proven, 2 inconclusive).
//
//   remove --project backend --candidate <file>[#<test>] --keepers <files> --subject <file[:from-to]>…
//          Kill-set subsumption: mutate the subjects one site at a time
//          (mutate.mjs, the gate) and require killed(keepers) ⊇
//          killed(candidate), the keepers scored in runs without the
//          candidate. A coverage run of the candidate's file drops the sites
//          it never executes (--no-prefilter: none dropped;
//          --prefilter-candidate-only: the candidate's tests alone, only for
//          files whose tests share no module state). --stryker-report <mutation.json> reads the kill matrix
//          of a StrykerJS run instead (an optional cross-check; it must have
//          used disableBail: true and coverageAnalysis: "perTest").
//   merge  --project backend --before <files> --after <files> --subject <files>
//          Census: the same test names (per original file when the merged
//          file wraps each in a top-level describe), the same pass count, the
//          same covered statements, branch arms and functions of the
//          subjects, and the statics of census.mjs (environment, mocks, hooks,
//          assertions, test bodies, @test-watches, shared-worker files, size).
//   guard  --project backend --candidate <file> --keepers <files> --seeds <dir>
//          Applies each <dir>/*.patch in a scratch worktree of HEAD (commit
//          first) and requires the keepers to fail wherever the candidate does.
//
// Files are repo-relative; --keepers/--before/--after/--subject repeat or take
// a comma list. A test is `<file>#<describe > … > title>` (or just its title
// when that is unique in the file).
// @reads frontend/src/test/no-isolate-files.json
import { execFileSync } from "node:child_process"
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, realpathSync, rmSync, symlinkSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { parseArgs } from "node:util"
import { applySite, describeSite, loadTypeScript, mutationSites, parseSubject } from "./mutate.mjs"
import {
  censusDiff, coverageDiff, guardVerdict, killVerdict, mergeVerdict, renderGuard, renderMerge, renderRemove,
  resolveTests, splitId, staticsDiff, strykerMatrix, strykerReportProblem,
} from "./verdicts.mjs"

const unique = (list) => [...new Set(list)]

/** Why a run over `files` is not green, or null. */
function redness(run, files) {
  if (run.timedOut) return "timed out"
  const bad = run.tests.filter((t) => files.includes(t.file) && (t.state === "failed" || t.hookFailed)).map((t) => t.id)
  if (bad.length > 0) return bad.join(", ")
  if (run.unhandledErrors > 0) return `${run.unhandledErrors} unhandled error(s)`
  return null
}

/**
 * Which of the `selected` test ids a run detected the mutant with: the test
 * failed, or a hook of a suite around it (or of its module) threw — a
 * beforeAll that throws leaves its tests "skipped", an afterAll that throws
 * leaves them "passed", and either way the file is red. A module that failed
 * to load takes every selected test of its file. `timeoutOnly`: the kills
 * whose only errors were timeouts.
 */
export function detected(run, selected) {
  const sel = new Set(selected)
  const killed = new Set()
  const timeoutOnly = new Set()
  const moduleFailed = new Set(run.tests.filter((t) => t.name === "<module>" && t.state === "failed").map((t) => t.file))
  for (const id of sel) if (moduleFailed.has(splitId(id).file)) killed.add(id)
  for (const t of run.tests) {
    if (!sel.has(t.id) || !(t.state === "failed" || t.hookFailed)) continue
    killed.add(t.id)
    if (t.timedOut) timeoutOnly.add(t.id)
  }
  return { killed, timeoutOnly }
}

/**
 * The tests a mutant made up: in `run`, under `files`, not among the
 * baseline's ids. Test names built from data (a catalog's ids, it.each) are
 * renamed when the mutant changes that data, so a failing test can carry a
 * name no baseline test had.
 */
export function strangers(run, files, baselineIds) {
  return run.tests.filter((t) => files.includes(t.file) && t.name !== "<module>" && !baselineIds.has(t.id))
}

/** How many tests carry each id (it.each rows can share one). */
export function idCounts(tests) {
  const m = new Map()
  for (const t of tests) if (t.name !== "<module>") m.set(t.id, (m.get(t.id) ?? 0) + 1)
  return m
}

/**
 * Whether a mutant changed which tests `files` collect: a name no baseline
 * test had, or a name more tests carry than at baseline (the candidate
 * renamed onto a sibling's name: `it.each([0, 1])` under `0` → `1` collects
 * two "n=1").
 */
export function collectionChanged(run, files, baselineCounts) {
  const counts = idCounts(run.tests.filter((t) => files.includes(t.file)))
  for (const [id, n] of counts) if (n > (baselineCounts.get(id) ?? 0)) return true
  return false
}

/**
 * Whether a run narrowed past `excluded` ran exactly what it should: every
 * `expected` test reported (a skip only under a hook that threw), none of the
 * `excluded` ones run, and nothing else run either — a test no baseline had
 * (a renamed candidate is not left out by its old name, and a renamed keeper
 * would vanish silently). Names are matched as text, so two tests whose names
 * join alike — or a mutant that changes which tests exist — show here.
 */
export function selectionProblem(run, expected, excluded, baselineCounts) {
  const byId = new Map(run.tests.map((t) => [t.id, t]))
  const moduleFailed = new Set(run.tests.filter((t) => t.name === "<module>").map((t) => t.file))
  for (const id of expected) {
    if (moduleFailed.has(splitId(id).file)) continue
    const t = byId.get(id)
    if (!t) return `${id} did not run`
    if (t.state === "skipped" && !t.hookFailed) return `${id} was skipped`
  }
  for (const id of excluded) {
    const t = byId.get(id)
    if (t && t.state !== "skipped") return `${id} ran although it was left out`
  }
  const known = new Set([...expected, ...excluded])
  const extra = run.tests.find((t) => t.name !== "<module>" && !known.has(t.id) && t.state !== "skipped")
  if (extra) return `${extra.id} ran but is no test the run named (renamed or new)`
  // A test renamed onto a name the run does expect: one id, more tests.
  if (baselineCounts) {
    for (const [id, n] of idCounts(run.tests)) if (n > (baselineCounts.get(id) ?? 0)) return `${id} names ${n} tests, ${baselineCounts.get(id) ?? 0} at baseline (a test renamed onto it)`
  }
  return null
}

/**
 * Remove mode, fallback producer. `runner` is a runners.mjs runner, `sites`
 * the mutation sites (mutate.mjs), `readSource(file)` the subject's text,
 * `coverage` (optional) an async (files, onlyIds) => site predicate for the
 * pre-filter. The pre-filter runs the candidate's WHOLE file by default — the
 * order stage 1 runs it in: alone, a candidate can take another branch than
 * after a sibling left module state behind, and a site it reaches only in
 * file order must not be dropped as "never executed" (a false PROVEN).
 * `prefilterCandidateOnly` narrows it to the candidate's own tests: fewer
 * mutants, sound only for a file whose tests share no module state. Per mutant:
 *   1. the candidate's file: which candidate tests detect it. Most mutants
 *      stop here (the candidate does not kill them).
 *   2. the keepers WITHOUT the candidate (it is left out of its own file by
 *      name): a same-file keeper may fail a mutant only because the candidate
 *      ran first and left state behind, which is no evidence once the
 *      candidate is gone. A keeper's kill must repeat in a second such run and
 *      be more than a timeout; else the mutant is unresolved.
 * Both narrowed runs are checked to have run what they should, and the
 * keepers must pass on their own before any mutant (a keeper that needs the
 * candidate would "kill" everything).
 */
export async function proveRemoval({ runner, candidate, keepers, sites, readSource, coverage, prefilterCandidateOnly = false, timeoutMs, log = () => {} }) {
  const candidateFile = splitId(candidate).file
  const files = unique([candidateFile, ...keepers])
  const baseline = await runner.run(files)
  const red = redness(baseline, files)
  if (red) throw new Error(`the baseline (no mutant) must pass: ${red}`)
  const ran = baseline.tests.filter((t) => t.state === "passed" && files.includes(t.file))
  const baselineIds = new Set(baseline.tests.map((t) => t.id))
  const baselineCounts = idCounts(baseline.tests)
  const candidateIds = resolveTests(ran, candidate)
  const keeperIds = ran.filter((t) => keepers.includes(t.file) && !candidateIds.includes(t.id)).map((t) => t.id)
  if (keeperIds.length === 0) throw new Error("no keeper test ran")
  const exclude = candidateIds.filter((id) => keepers.includes(splitId(id).file))
  const runKeepers = (opts = {}) => runner.run(keepers, { ...opts, exclude })
  const alone = await runKeepers()
  const aloneRed = redness(alone, keepers)
  if (aloneRed) throw new Error(`the keepers must pass without the candidate (do they depend on it?): ${aloneRed}`)
  const aloneSel = selectionProblem(alone, keeperIds, exclude, baselineCounts)
  if (aloneSel) throw new Error(`could not run the keepers without the candidate: ${aloneSel}`)
  const perRunTimeout = timeoutMs ?? Math.max(15_000, 5 * Math.max(baseline.durationMs, alone.durationMs))

  let candidateSites = sites
  let filtered = 0
  if (coverage) {
    const reachable = await coverage([candidateFile], prefilterCandidateOnly ? candidateIds : [])
    candidateSites = sites.filter((s) => reachable(s))
    filtered = sites.length - candidateSites.length
  }

  // A keeper run that cannot be read: why, or null.
  const unreadable = (r) => (r.timedOut ? "timeout" : r.unhandledErrors > 0 ? "unhandled" : selectionProblem(r, keeperIds, exclude, baselineCounts) ? "selection" : null)
  const mutants = sites.filter((s) => !candidateSites.includes(s)).map((s) => ({ label: describeSite(s), outcome: "evaluated", killedBy: [], site: s }))
  const sources = new Map()
  let i = 0
  for (const site of candidateSites) {
    i++
    if (!sources.has(site.file)) sources.set(site.file, readSource(site.file))
    const overlay = new Map([[site.file, applySite(sources.get(site.file), site)]])
    const label = describeSite(site)
    const push = (outcome, killedBy = []) => { mutants.push({ label, outcome, killedBy, site }); log(`${i}/${candidateSites.length} ${outcome === "evaluated" ? (killedBy.length ? `killed by ${killedBy.length}` : "survived") : outcome} ${label}`) }
    const r1 = await runner.run([candidateFile], { overlay, timeoutMs: perRunTimeout })
    if (r1.timedOut) { push("timeout"); continue }
    if (r1.overlayLoaded === false) { push("not-loaded"); continue }
    // When the mutant changed which tests the file collects (a name no
    // baseline test had, or one name on more tests than before), a failing
    // test may be the candidate under a new name (a mutant of the data its
    // name is built from): any failure in the file counts as the candidate's
    // kill. Over-counting can only refute, never prove.
    const renamedFail = (strangers(r1, [candidateFile], baselineIds).length > 0 || collectionChanged(r1, [candidateFile], baselineCounts))
      && r1.tests.some((t) => t.file === candidateFile && (t.state === "failed" || t.hookFailed))
    const byCandidate = renamedFail ? [...candidateIds] : [...detected(r1, candidateIds).killed]
    if (byCandidate.length === 0) { push(r1.unhandledErrors > 0 ? "unhandled" : "evaluated"); continue }
    const k1 = await runKeepers({ overlay, timeoutMs: perRunTimeout })
    if (unreadable(k1)) { push(unreadable(k1), byCandidate); continue }
    const first = detected(k1, keeperIds)
    if (first.killed.size === 0) { push("evaluated", byCandidate); continue }
    // A keeper's kill must repeat (a flake is no evidence) and be more than
    // a timeout both times (a 5 s test timeout under load is none either).
    const k2 = await runKeepers({ overlay, timeoutMs: perRunTimeout })
    if (unreadable(k2)) { push(unreadable(k2), byCandidate); continue }
    const again = detected(k2, keeperIds)
    const confirmed = [...first.killed].filter((id) => again.killed.has(id) && !(first.timeoutOnly.has(id) && again.timeoutOnly.has(id)))
    if (confirmed.length === 0) { push([...first.killed].some((id) => again.killed.has(id)) ? "keeper-timeout" : "flaky", byCandidate); continue }
    push("evaluated", [...byCandidate, ...confirmed])
  }
  const result = killVerdict({ mutants, candidateIds, keeperIds })
  return { ...result, candidateIds, keeperIds, prefiltered: filtered }
}

/**
 * Merge mode: run both sides, compare the census, the subjects' coverage
 * (`coverage(files)` → Map<file, Set<key>>) and the statics (census.mjs, as
 * { before, after, sharedWorker }).
 */
export async function proveMerge({ runner, before, after, coverage, statics }) {
  const b = await runner.run(before)
  const a = await runner.run(after)
  const problems = []
  for (const [side, r] of [["before", b], ["after", a]]) {
    if (r.timedOut) problems.push(`the ${side} run timed out`)
    if (r.unhandledErrors > 0) problems.push(`the ${side} run had ${r.unhandledErrors} unhandled error(s)`)
  }
  const census = censusDiff({ before: b.tests, after: a.tests })
  const cov = coverage ? coverageDiff(await coverage(before), await coverage(after)) : null
  const stat = statics ? staticsDiff(statics) : null
  // A run that timed out has no census to compare.
  const verdict = b.timedOut || a.timedOut ? "unresolved" : mergeVerdict({ census, coverage: cov, statics: stat, problems })
  return { ok: verdict === "equal", verdict, exitCode: { equal: 0, different: 1, unresolved: 2 }[verdict], census, coverage: cov, statics: stat, problems }
}

/** A guard-mode side: "pass", "caught" or "timeout" (guardVerdict). */
function sideOf(r) {
  if (r.timedOut) return "timeout"
  const failing = r.tests.filter((t) => t.state === "failed" || t.hookFailed)
  if (failing.some((t) => !t.timedOut) || r.unhandledErrors > 0) return "caught"
  return failing.length > 0 ? "timeout" : "pass"
}

/**
 * Guard mode. `workspace` is a directory the seeds apply to (git apply), and
 * `makeRunner(root)` a runner over it. A fresh runner per seed: scanners read
 * the tree, and a reused Vitest could hold a module the seed changed.
 * `onApply(seed)` / `onRevert(seed)` (optional) run after each patch is
 * applied / reverted — the CLI rebuilds a workspace package a seed touches.
 */
export async function proveGuard({ workspace, makeRunner, candidate, keepers, seeds, timeoutMs, onApply = () => {}, onRevert = () => {} }) {
  const sides = async () => {
    const runner = await makeRunner(workspace)
    try {
      const c = await runner.run([candidate], { timeoutMs })
      const k = await runner.run(keepers, { timeoutMs })
      return { candidate: sideOf(c), keepers: sideOf(k) }
    } finally {
      await runner.close()
    }
  }
  const baseline = await sides()
  const results = []
  for (const seed of seeds) {
    execFileSync("git", ["apply", "--whitespace=nowarn", seed], { cwd: workspace, stdio: "pipe" })
    try {
      await onApply(seed)
      results.push({ seed: path.basename(seed), ...(await sides()) })
    } finally {
      execFileSync("git", ["apply", "-R", "--whitespace=nowarn", seed], { cwd: workspace, stdio: "pipe" })
      await onRevert(seed)
    }
  }
  return guardVerdict({ baseline, seeds: results })
}

// ---- the guard's scratch worktree ---------------------------------------------

// Caches a run writes into node_modules: never shared with the checkout.
const CACHE_DIRS = new Set([".vite", ".vitest", ".cache", ".tmp"])
const isInside = (dir, p) => { const r = path.relative(dir, p); return r !== "" && !r.startsWith("..") && !path.isAbsolute(r) }

/**
 * A scratch worktree of HEAD that runs tests against ITS OWN files. Each
 * node_modules is a real directory of links into the checkout's, except the
 * workspace links (`@nodaro/shared` → `../../packages/shared`), which are made
 * again relative, so they land in the worktree: a symlinked node_modules
 * realpaths every `@nodaro/*` import back into the checkout and a seed under
 * packages/ would change nothing. Package `dist/` directories are copied (a
 * link would let a rebuild write into the checkout); `rebuild(pkgDir)` builds
 * one in the worktree, `restore(pkgDir)` copies the checkout's back.
 */
export function scratchWorktree(repoRoot) {
  const dir = realpathSync(mkdtempSync(path.join(os.tmpdir(), "test-dedup-guard-")))
  execFileSync("git", ["worktree", "add", "--detach", dir, "HEAD"], { cwd: repoRoot, stdio: "pipe" })
  const linkEntry = (src, dst) => {
    if (lstatSync(src).isSymbolicLink()) {
      const target = readlinkSync(src)
      const resolved = path.resolve(path.dirname(src), target)
      if (!path.isAbsolute(target) && isInside(repoRoot, resolved) && !resolved.split(path.sep).includes("node_modules")) {
        symlinkSync(target, dst)
        return
      }
    }
    symlinkSync(src, dst)
  }
  const linkNodeModules = (rel) => {
    const src = path.join(repoRoot, rel)
    if (!existsSync(src)) return
    const dst = path.join(dir, rel)
    mkdirSync(dst, { recursive: true })
    for (const entry of readdirSync(src)) {
      if (CACHE_DIRS.has(entry) || existsSync(path.join(dst, entry))) continue
      const s = path.join(src, entry)
      if (entry.startsWith("@") && !lstatSync(s).isSymbolicLink()) {
        mkdirSync(path.join(dst, entry))
        for (const member of readdirSync(s)) linkEntry(path.join(s, member), path.join(dst, entry, member))
      } else {
        linkEntry(s, path.join(dst, entry))
      }
    }
  }
  const packages = existsSync(path.join(repoRoot, "packages")) ? readdirSync(path.join(repoRoot, "packages")) : []
  try {
    linkNodeModules("node_modules")
    for (const ws of ["frontend", "backend"]) linkNodeModules(`${ws}/node_modules`)
    for (const pkg of packages) {
      linkNodeModules(`packages/${pkg}/node_modules`)
      const dist = path.join(repoRoot, "packages", pkg, "dist")
      if (existsSync(dist)) cpSync(dist, path.join(dir, "packages", pkg, "dist"), { recursive: true })
    }
  } catch (err) {
    execFileSync("git", ["worktree", "remove", "--force", dir], { cwd: repoRoot, stdio: "pipe" })
    throw err
  }
  const remove = () => {
    try { execFileSync("git", ["worktree", "remove", "--force", dir], { cwd: repoRoot, stdio: "pipe" }) } catch { rmSync(dir, { recursive: true, force: true }) }
    try { execFileSync("git", ["worktree", "prune"], { cwd: repoRoot, stdio: "pipe" }) } catch { /* best effort */ }
  }
  const rebuild = (pkgDir) => execFileSync("npm", ["run", "build"], { cwd: path.join(dir, pkgDir), stdio: "pipe", timeout: 600_000 })
  const restore = (pkgDir) => {
    const target = path.join(dir, pkgDir, "dist")
    rmSync(target, { recursive: true, force: true })
    const source = path.join(repoRoot, pkgDir, "dist")
    if (existsSync(source)) cpSync(source, target, { recursive: true })
  }
  return { dir, remove, rebuild, restore }
}

/** The workspace packages (`packages/<name>`) a patch changes outside their dist/. */
export function packagesTouched(patch) {
  const dirs = new Set()
  for (const m of patch.matchAll(/^(?:\+\+\+|---) [ab]\/(packages\/[^/\s]+)\/(\S+)/gm)) if (!m[2].startsWith("dist/")) dirs.add(m[1])
  return [...dirs].sort()
}

// ---- CLI --------------------------------------------------------------------

const listOf = (values) => (values ?? []).flatMap((v) => v.split(",")).map((v) => v.trim()).filter(Boolean)

/** The project's shared-worker manifest (frontend), as repo-relative test files. */
function sharedWorkerFiles(repoRoot, project) {
  const manifest = path.join(repoRoot, project, "src/test/no-isolate-files.json")
  if (!existsSync(manifest)) return new Set()
  return new Set(JSON.parse(readFileSync(manifest, "utf8")).map((f) => `${project}/${f}`))
}

/**
 * Cleanups that also run on SIGINT / SIGTERM: an interrupted guard run must
 * not leave its worktree registered, nor a scratch directory behind.
 */
function cleanups() {
  const list = []
  const runAll = () => { for (const fn of list.splice(0).reverse()) { try { fn() } catch { /* best effort */ } } }
  // SIGALRM too: `perl -e 'alarm N; exec …'` is how long runs are capped, and
  // a killed harness would orphan any Vitest worker still spinning.
  const SIGNALS = { SIGINT: 130, SIGTERM: 143, SIGHUP: 129, SIGALRM: 142 }
  const onSignal = (signal) => { runAll(); process.exit(SIGNALS[signal]) }
  for (const signal of Object.keys(SIGNALS)) process.once(signal, onSignal)
  return {
    add: (fn) => { list.push(fn); return fn },
    drop: (fn) => { const i = list.indexOf(fn); if (i >= 0) list.splice(i, 1) },
    all: () => { runAll(); for (const signal of Object.keys(SIGNALS)) process.off(signal, onSignal) },
  }
}

export async function main(argv) {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
  const [mode, ...rest] = argv
  const { values: o } = parseArgs({
    args: rest,
    options: {
      project: { type: "string" }, candidate: { type: "string" }, keepers: { type: "string", multiple: true },
      subject: { type: "string", multiple: true }, before: { type: "string", multiple: true }, after: { type: "string", multiple: true },
      seeds: { type: "string" }, "stryker-report": { type: "string" }, "no-prefilter": { type: "boolean" },
      "prefilter-candidate-only": { type: "boolean" },
      "timeout-ms": { type: "string" }, quiet: { type: "boolean" },
    },
  })
  if (!["remove", "merge", "guard"].includes(mode) || !o.project) {
    process.stderr.write("usage: equivalence.mjs remove|merge|guard --project backend|frontend … (see the header of tools/test-dedup/equivalence.mjs)\n")
    return 2
  }
  const { createVitestRunner, coveredLines, killVitestWorkers, siteCovered } = await import("./runners.mjs")
  const clean = cleanups()
  clean.add(killVitestWorkers)
  const scratch = mkdtempSync(path.join(os.tmpdir(), "test-dedup-"))
  clean.add(() => rmSync(scratch, { recursive: true, force: true }))
  const log = o.quiet ? () => {} : (line) => process.stderr.write(`${line}\n`)
  const started = Date.now()
  const timeoutMs = o["timeout-ms"] ? Number(o["timeout-ms"]) : undefined
  try {
    if (mode === "remove") {
      const keepers = listOf(o.keepers)
      const subjects = listOf(o.subject)
      if (!o.candidate || keepers.length === 0 || (subjects.length === 0 && !o["stryker-report"])) throw new Error("remove needs --candidate, --keepers and --subject (or --stryker-report)")
      if (o["stryker-report"]) {
        const report = JSON.parse(readFileSync(o["stryker-report"], "utf8"))
        const problem = strykerReportProblem(report)
        if (problem) throw new Error(`--stryker-report: ${problem}`)
        const { tests, mutants } = strykerMatrix(report, o.project)
        const candidateIds = resolveTests(tests, o.candidate)
        const keeperIds = tests.filter((t) => keepers.includes(t.file) && !candidateIds.includes(t.id)).map((t) => t.id)
        const result = killVerdict({ mutants, candidateIds, keeperIds })
        const notes = ["A StrykerJS report is a cross-check, not the gate: it runs a file's tests together, so a same-file keeper's kill may depend on the candidate having run first. Confirm a PROVEN with the fallback mutator."]
        process.stdout.write(`${renderRemove({ candidate: o.candidate, keepers, subjects: subjects.length ? subjects : ["(from the report)"], producer: "StrykerJS report", result, durationMs: Date.now() - started, notes })}\n`)
        return result.exitCode
      }
      const ts = loadTypeScript(repoRoot)
      const readSource = (file) => readFileSync(path.join(repoRoot, file), "utf8")
      const sites = subjects.flatMap((spec) => { const { file, from, to } = parseSubject(spec); return mutationSites(ts, readSource(file), file, { from, to }) })
      const runner = await createVitestRunner({ repoRoot, project: o.project })
      const closeRunner = clean.add(() => { runner.close() })
      try {
        let n = 0
        const coverage = o["no-prefilter"] ? undefined : async (files, only) => {
          const { spans } = await coveredLines({ repoRoot, project: o.project, files, subjects: unique(sites.map((s) => s.file)), only, reportsDirectory: path.join(scratch, `coverage-${n++}`) })
          return (site) => siteCovered(site, spans)
        }
        const candidateOnly = !!o["prefilter-candidate-only"]
        const result = await proveRemoval({ runner, candidate: o.candidate, keepers, sites, readSource, coverage, prefilterCandidateOnly: candidateOnly, timeoutMs, log })
        const filter = o["no-prefilter"] ? "no coverage pre-filter"
          : candidateOnly ? "pre-filter over the candidate's own tests only (--prefilter-candidate-only: sound only when its file's tests share no module state)"
            : "pre-filter over the candidate's whole file"
        const notes = [`${result.prefiltered} of ${sites.length} mutants skipped (${filter}: never executed there). Candidate tests: ${result.candidateIds.length}; keeper tests: ${result.keeperIds.length}, scored without the candidate.`]
        process.stdout.write(`${renderRemove({ candidate: o.candidate, keepers, subjects, producer: "fallback mutator, tools/test-dedup/mutate.mjs", result, durationMs: Date.now() - started, notes })}\n`)
        return result.exitCode
      } finally {
        clean.drop(closeRunner)
        await runner.close()
      }
    }
    if (mode === "merge") {
      const before = listOf(o.before)
      const after = listOf(o.after)
      const subjects = listOf(o.subject)
      if (before.length === 0 || after.length === 0) throw new Error("merge needs --before and --after")
      if (subjects.length === 0) throw new Error("merge needs --subject: the modules whose coverage must not change (plan §2)")
      const ts = loadTypeScript(repoRoot)
      const { testFileStatics } = await import("./census.mjs")
      const staticsOf = (files) => files.map((f) => testFileStatics(ts, f, readFileSync(path.join(repoRoot, f), "utf8")))
      const statics = { before: staticsOf(before), after: staticsOf(after), sharedWorker: sharedWorkerFiles(repoRoot, o.project) }
      const runner = await createVitestRunner({ repoRoot, project: o.project })
      try {
        let n = 0
        const coverage = async (files) => {
          const { hits, missing } = await coveredLines({ repoRoot, project: o.project, files, subjects, reportsDirectory: path.join(scratch, `coverage-${n++}`) })
          if (missing.length > 0) throw new Error(`coverage cannot see ${missing.join(", ")}: a subject must lie under ${o.project}/`)
          return hits
        }
        const result = await proveMerge({ runner, before, after, coverage, statics })
        process.stdout.write(`${renderMerge({ beforeFiles: before, afterFiles: after, census: result.census, coverage: result.coverage, statics: result.statics, problems: result.problems, verdict: result.verdict })}\n`)
        return result.exitCode
      } finally {
        await runner.close()
      }
    }
    const keepers = listOf(o.keepers)
    if (!o.candidate || keepers.length === 0 || !o.seeds) throw new Error("guard needs --candidate, --keepers and --seeds")
    const seedsDir = path.resolve(o.seeds)
    const seeds = readdirSync(seedsDir).filter((f) => f.endsWith(".patch")).sort().map((f) => path.join(seedsDir, f))
    if (seeds.length === 0) throw new Error(`no *.patch in ${o.seeds}`)
    const wt = scratchWorktree(repoRoot)
    const removeWorktree = clean.add(wt.remove)
    try {
      const touched = (seed) => packagesTouched(readFileSync(seed, "utf8"))
      const result = await proveGuard({
        workspace: wt.dir, makeRunner: (root) => createVitestRunner({ repoRoot: root, project: o.project }),
        candidate: o.candidate, keepers, seeds, timeoutMs,
        onApply: (seed) => { for (const pkg of touched(seed)) { log(`rebuilding ${pkg} in the worktree for ${path.basename(seed)}`); wt.rebuild(pkg) } },
        onRevert: (seed) => { for (const pkg of touched(seed)) wt.restore(pkg) },
      })
      process.stdout.write(`${renderGuard({ candidate: o.candidate, keepers, result })}\n`)
      return result.exitCode
    } finally {
      clean.drop(removeWorktree)
      wt.remove()
    }
  } finally {
    clean.all()
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(
    // Always set: a mutant's unhandled error makes Vitest set process.exitCode = 1.
    (code) => { process.exitCode = code; setTimeout(() => process.exit(code), 100).unref() },
    (err) => { process.stderr.write(`${err.stack ?? err}\n`); process.exitCode = 2; setTimeout(() => process.exit(2), 100).unref() },
  )
}
