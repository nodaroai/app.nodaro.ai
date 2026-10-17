// tools/__tests__/test-dedup-equivalence-vitest.test.mjs
// The proof harness (tools/test-dedup/) through the REAL Vitest runner path —
// createVitest, the in-memory mutant overlay, coverage — and the real CLI.
// Each review probe of PR #2302 (each once a false PROVEN with exit 0) is a
// case here and must come out NOT proven, or exit 2 where it is vacuous.
// The fixtures are a small Vitest project of their own
// (fixtures/test-dedup/vitest/, `.cases.mjs` so no other suite collects them).
// Needs node_modules (vitest, typescript, @vitest/coverage-v8). CI runs it in
// the "Test De-dup Harness" job, with TEST_DEDUP_REQUIRE_VITEST=1 so a missing
// install fails instead of skipping; the Diff Gate runs that job when a file
// matching the globs below changes (ci.yml's case list mirrors them — guarded
// in test-dedup-equivalence.test.mjs). CI's no-npm-ci tools job skips it.
// @test-watches tools/test-dedup/** tools/__tests__/test-dedup-* tools/__tests__/fixtures/test-dedup/** tools/test-select/annotations.mjs package.json package-lock.json .github/workflows/ci.yml
import { test } from "node:test"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { cpSync, existsSync, lstatSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { proveGuard, proveMerge, proveRemoval, scratchWorktree } from "../test-dedup/equivalence.mjs"

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, "../..")
const project = "tools/__tests__/fixtures/test-dedup/vitest"
const F = (file) => `${project}/${file}`
const cli = path.join(repoRoot, "tools/test-dedup/equivalence.mjs")

const installed = (() => {
  try {
    import.meta.resolve("vitest/node")
    import.meta.resolve("typescript")
    import.meta.resolve("@vitest/coverage-v8")
    return true
  } catch {
    return false
  }
})()
if (!installed && process.env.TEST_DEDUP_REQUIRE_VITEST === "1") throw new Error("TEST_DEDUP_REQUIRE_VITEST=1 but vitest / typescript / @vitest/coverage-v8 do not resolve: run npm ci")
const vtest = (name, fn) => test(name, { skip: installed ? false : "vitest / typescript / @vitest/coverage-v8 are not installed (this job runs without npm ci); runs wherever node_modules exists" }, fn)

/** The real CLI, as a reviewer runs it: { code, stdout, stderr }. */
function equivalence(...args) {
  const env = { ...process.env }
  delete env.NODE_TEST_CONTEXT
  const r = spawnSync(process.execPath, [cli, ...args, "--quiet"], { cwd: repoRoot, env, encoding: "utf8", timeout: 300_000, maxBuffer: 64 << 20 })
  return { code: r.status, stdout: r.stdout, stderr: r.stderr }
}

async function inProcess(fn) {
  const { createVitestRunner } = await import("../test-dedup/runners.mjs")
  const runner = await createVitestRunner({ repoRoot, project })
  try {
    return await fn(runner)
  } finally {
    await runner.close()
  }
}

async function removal(candidate, keepers, subject) {
  const { loadTypeScript, mutationSites } = await import("../test-dedup/mutate.mjs")
  const readSource = (file) => readFileSync(path.join(repoRoot, file), "utf8")
  const sites = mutationSites(loadTypeScript(repoRoot), readSource(subject), subject)
  return inProcess((runner) => proveRemoval({ runner, candidate, keepers, sites, readSource }))
}

const labels = (r) => r.unique.map((m) => m.label.replace(`${project}/`, ""))

// ---- probe 1: hook failures ---------------------------------------------------

vtest("probe, CLI: an assertion only in a top-level beforeAll — the keeper never calls f → REFUTED, exit 1", () => {
  const r = equivalence("remove", "--project", project, "--candidate", F("hook-before.cases.mjs"), "--keepers", F("hook-keeper.cases.mjs"), "--subject", F("hooks.mjs"))
  assert.equal(r.code, 1, r.stdout + r.stderr)
  assert.match(r.stdout, /### Kill-set subsumption — REFUTED/)
  assert.doesNotMatch(r.stdout, /PROVEN/)
  assert.match(r.stdout, /hooks\.mjs:4:12 compare `>` → `<=`/, "f's comparison: only the hook asserts it")
  assert.match(r.stdout, /mutants skipped \(pre-filter over the candidate's whole file/, "the pre-filter ran (real coverage), over the whole file by default")
})

vtest("probe: an assertion only in a top-level afterAll → NOT proven", async () => {
  const r = await removal(F("hook-after.cases.mjs"), [F("hook-keeper.cases.mjs")], F("hooks.mjs"))
  assert.equal(r.verdict, "not-proven")
  assert.ok(labels(r).includes("hooks.mjs:4:12 compare `>` → `<=`"), labels(r).join("\n"))
})

vtest("a keeper whose beforeAll catches the mutant gets the credit → proven", async () => {
  const r = await removal(F("hook-keeper.cases.mjs"), [F("hook-before.cases.mjs")], F("hooks.mjs"))
  assert.equal(r.verdict, "proven", JSON.stringify({ unique: labels(r), unresolved: r.unresolved.map((m) => `${m.outcome} ${m.label}`) }))
})

// ---- a mutant that spins a worker forever -------------------------------------

/** The vitest worker processes this process has forked. */
function vitestWorkers() {
  const ps = spawnSync("ps", ["-A", "-o", "pid=,ppid=,command="], { encoding: "utf8" }).stdout
  return ps.split("\n").map((l) => l.trim().split(/\s+/)).filter(([, ppid, ...cmd]) => Number(ppid) === process.pid && cmd.join(" ").includes("vitest/dist/workers")).map(([pid]) => Number(pid))
}

vtest("a mutant that loops forever times out (unresolved), the run goes on, and its worker is killed", async () => {
  const started = Date.now()
  const r = await (async () => {
    const { loadTypeScript, mutationSites } = await import("../test-dedup/mutate.mjs")
    const readSource = (file) => readFileSync(path.join(repoRoot, file), "utf8")
    const subject = F("loop.mjs")
    const sites = mutationSites(loadTypeScript(repoRoot), readSource(subject), subject).filter((s) => s.operator === "update" || s.operator === "literal")
    return inProcess((runner) => proveRemoval({ runner, candidate: F("loop.cases.mjs#counts down to zero"), keepers: [F("loop.cases.mjs")], sites, readSource, timeoutMs: 4_000 }))
  })()
  assert.deepEqual(r.unresolved.map((m) => `${m.outcome} ${m.label.replace(`${project}/`, "")}`), ["timeout loop.mjs:4:18 update `--` → `++`"])
  assert.ok(Date.now() - started < 90_000, "a stuck worker must not hold the run")
  assert.deepEqual(vitestWorkers(), [], "no worker left spinning")
})

// ---- a mutant that renames the candidate -------------------------------------

vtest("probe, CLI: a mutant that renames a data-driven candidate (\"a\" → \"\" makes \"price \", which fails) is never PROVEN", () => {
  // Keeper in another file: it never notices the empty id → REFUTED.
  const apart = equivalence("remove", "--project", project, "--candidate", F("ids.cases.mjs#price a"), "--keepers", F("ids-keeper.cases.mjs"), "--subject", F("ids.mjs"))
  assert.equal(apart.code, 1, apart.stdout + apart.stderr)
  assert.match(apart.stdout, /REFUTED[\s\S]*ids\.mjs:3:21 literal `"a"` → `""`/)
  // Keeper in the candidate's own file: the renamed candidate is no longer
  // left out of the keeper run, so that run cannot be read → UNRESOLVED.
  const together = equivalence("remove", "--project", project, "--candidate", F("ids.cases.mjs#price a"), "--keepers", F("ids.cases.mjs"), "--subject", F("ids.mjs"))
  assert.equal(together.code, 2, together.stdout + together.stderr)
  assert.match(together.stdout, /UNRESOLVED[\s\S]*selection: [^\n]*ids\.mjs:3:21 literal `"a"` → `""`/)
})

vtest("probe, CLI: a mutant that renames the candidate to a name another test already has (it.each, 0 → 1 gives two \"n=1\") is never PROVEN", () => {
  const apart = equivalence("remove", "--project", project, "--candidate", F("each.cases.mjs#n=0"), "--keepers", F("each-keeper.cases.mjs"), "--subject", F("each.mjs"))
  assert.equal(apart.code, 1, apart.stdout + apart.stderr)
  assert.match(apart.stdout, /REFUTED[\s\S]*each\.mjs:3:23 literal `0` → `1`/)
  // Same file: the renamed candidate is a second "n=1" in the keeper run,
  // whose failure would otherwise be credited to the keeper "n=1".
  const together = equivalence("remove", "--project", project, "--candidate", F("each.cases.mjs#n=0"), "--keepers", F("each.cases.mjs"), "--subject", F("each.mjs"))
  assert.equal(together.code, 2, together.stdout + together.stderr)
  assert.match(together.stdout, /UNRESOLVED[\s\S]*selection: [^\n]*each\.mjs:3:23 literal `0` → `1`/)
})

// ---- probe 2: same-file order -------------------------------------------------

vtest("probe: a sibling that fails `>` → `<=` only after the candidate pushed \"\" earns nothing → NOT proven", async () => {
  const r = await removal(F("names.cases.mjs#rejects empty"), [F("names.cases.mjs")], F("names.mjs"))
  assert.equal(r.verdict, "not-proven")
  assert.ok(labels(r).includes("names.mjs:5:19 compare `>` → `<=`"), labels(r).join("\n"))
})

vtest("a same-file keeper scored without the candidate still covers a true subset → proven", async () => {
  const r = await removal(F("math.cases.mjs#sums to a number"), [F("math.cases.mjs")], F("math.mjs"))
  assert.equal(r.verdict, "proven", JSON.stringify({ unique: labels(r), unresolved: r.unresolved.map((m) => `${m.outcome} ${m.label}`) }))
  assert.ok(r.candidateKills > 0)
})

vtest("keepers that fail without the candidate are refused, exit 2 (removing it would break them)", () => {
  const r = equivalence("remove", "--project", project, "--candidate", F("depends.cases.mjs#prepares"), "--keepers", F("depends.cases.mjs"), "--subject", F("math.mjs"))
  assert.equal(r.code, 2, r.stdout + r.stderr)
  assert.match(r.stderr, /the keepers must pass without the candidate/)
})

// ---- probe 3: missing operators -----------------------------------------------

vtest("probe: toBe(5) against a keeper that only checks typeof — sum = (a, b) => a + b, pick = (o) => o?.v.map((n) => -n) → NOT proven", async () => {
  const r = await removal(F("math.cases.mjs#sums exactly"), [F("math.cases.mjs")], F("math.mjs"))
  assert.equal(r.verdict, "not-proven")
  for (const site of ["math.mjs:3:32 arithmetic `+` → `-`", "math.mjs:5:44 unary `-n` → `(n)`"]) assert.ok(labels(r).includes(site), `${site}\n${labels(r).join("\n")}`)
})

vtest("a run never writes a snapshot: a missing one fails, as on CI", async () => {
  const dir = path.join(repoRoot, project, "__snapshots__")
  const r = await inProcess((runner) => runner.run([F("snapshot.cases.mjs")]))
  assert.deepEqual(r.tests.map((t) => t.state), ["failed"])
  assert.equal(existsSync(dir), false, "no __snapshots__ written into the checkout")
})

// ---- coverage pre-filter ------------------------------------------------------

vtest("probe, CLI: a branch the candidate reaches only after a sibling set module state — the default pre-filter keeps it → REFUTED", () => {
  const args = ["remove", "--project", project, "--candidate", F("state.cases.mjs#labels zero"), "--keepers", F("state.cases.mjs"), "--subject", F("state.mjs")]
  const safe = equivalence(...args)
  assert.equal(safe.code, 1, safe.stdout + safe.stderr)
  assert.match(safe.stdout, /state\.mjs:10:24 compare `>` → `<=`/)
  // The opt-in runs the candidate alone, drops the strict branch as "never
  // executed", and proves what file order refutes: why it is opt-in only.
  const narrow = equivalence(...args, "--prefilter-candidate-only")
  assert.equal(narrow.code, 0, narrow.stdout + narrow.stderr)
  assert.match(narrow.stdout, /PROVEN[\s\S]*--prefilter-candidate-only: sound only when/)
})


vtest("coverage: the candidate must have run and passed; the config sees --coverage", async () => {
  const { coveredLines } = await import("../test-dedup/runners.mjs")
  const scratch = mkdtempSync(path.join(os.tmpdir(), "test-dedup-cov-"))
  try {
    await assert.rejects(coveredLines({ repoRoot, project, files: [F("math.cases.mjs")], subjects: [F("math.mjs")], only: [F("math.cases.mjs#no such test")], reportsDirectory: path.join(scratch, "a") }), /did not run and pass/)
    const ok = await coveredLines({ repoRoot, project, files: [F("math.cases.mjs")], subjects: [F("math.mjs")], only: [F("math.cases.mjs#sums exactly")], reportsDirectory: path.join(scratch, "b") })
    assert.ok(ok.hits.get(F("math.mjs")).size > 0)
    // A config that keys TIMING_UNDER_COVERAGE-style env off its argv (frontend/vitest.config.ts).
    const flag = `${project}/coverage-flag`
    const seen = await coveredLines({ repoRoot, project: flag, files: [`${flag}/sees.flag.mjs`], subjects: [`${flag}/one.mjs`, F("math.mjs")], reportsDirectory: path.join(scratch, "c") })
    assert.ok(seen.lines.get(`${flag}/one.mjs`).size > 0)
    assert.deepEqual(seen.missing, [F("math.mjs")], "a subject outside the project root is not instrumented, and says so")
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
})

// ---- merge --------------------------------------------------------------------

vtest("merge, CLI: a faithful merge is EQUAL; one with a dropped expect (same names, passes, lines) is DIFFERENT", () => {
  const base = ["merge", "--project", project, "--before", `${F("merge-a.cases.mjs")},${F("merge-b.cases.mjs")}`, "--subject", F("math.mjs")]
  const equal = equivalence(...base, "--after", F("merged.cases.mjs"))
  assert.equal(equal.code, 0, equal.stdout + equal.stderr)
  assert.match(equal.stdout, /### Merge census — EQUAL/)
  const dropped = equivalence(...base, "--after", F("merged-dropped.cases.mjs"))
  assert.equal(dropped.code, 1, dropped.stdout + dropped.stderr)
  assert.match(dropped.stdout, /### Merge census — DIFFERENT/)
  assert.match(dropped.stdout, /\| Same assertions \(3 before, 2 after\) \| \*\*no\*\* \| missing: `expect\(twice\(0\)\)\.toBe\(0\)`/)
  const noSubject = equivalence("merge", "--project", project, "--before", F("merge-a.cases.mjs"), "--after", F("merged.cases.mjs"))
  assert.equal(noSubject.code, 2)
  assert.match(noSubject.stderr, /merge needs --subject/)
})

vtest("merge: a hook failure on one side is a failing test, never an equal census", async () => {
  const { createVitestRunner } = await import("../test-dedup/runners.mjs")
  const runner = await createVitestRunner({ repoRoot, project })
  try {
    const files = [F("hook-after.cases.mjs")]
    assert.equal((await proveMerge({ runner, before: files, after: files })).verdict, "equal")
    // The afterAll throws, the test itself passes: the census must still see a red file.
    const broken = { run: (f) => runner.run(f, { overlay: new Map([[F("hooks.mjs"), "export const f = () => 'small'\nexport const g = (a, b) => a * b\n"]]) }) }
    const m = await proveMerge({ runner: broken, before: files, after: files })
    assert.equal(m.verdict, "different")
    assert.deepEqual(m.census.failed, [F("hook-after.cases.mjs#g multiplies"), F("hook-after.cases.mjs#g multiplies")])
  } finally {
    await runner.close()
  }
})

// ---- guard --------------------------------------------------------------------

async function guard(seedNames) {
  const { createVitestRunner } = await import("../test-dedup/runners.mjs")
  const workspace = realpathSync(mkdtempSync(path.join(os.tmpdir(), "test-dedup-vguard-")))
  cpSync(path.join(repoRoot, project, "guard"), workspace, { recursive: true })
  symlinkSync(path.join(repoRoot, "node_modules"), path.join(workspace, "node_modules"))
  try {
    return await proveGuard({
      workspace,
      makeRunner: (root) => createVitestRunner({ repoRoot: root, project: "." }),
      candidate: "candidate.cases.mjs",
      keepers: ["keeper.cases.mjs"],
      seeds: seedNames.map((s) => path.join(workspace, "seeds", s)),
      timeoutMs: 60_000,
    })
  } finally {
    rmSync(workspace, { recursive: true, force: true })
  }
}

vtest("guard, Vitest: a seed both sides catch → covered; seeds the candidate never catches → vacuous (exit 2)", async () => {
  const covered = await guard(["max.patch"])
  assert.equal(covered.verdict, "covered", JSON.stringify(covered))
  const vacuous = await guard(["names.patch"])
  assert.equal(vacuous.verdict, "vacuous", JSON.stringify(vacuous))
  assert.equal(vacuous.exitCode, 2)
})

vtest("guard, Vitest: a seed that renames a data-driven candidate test (\"a\" → \"\") and fails it is a catch → not covered", async () => {
  const r = await guard(["rename.patch"])
  assert.deepEqual(r.rows.map((row) => [row.seed, row.candidate, row.keepers]), [["rename.patch", "caught", "pass"]])
  assert.equal(r.verdict, "not-covered")
})

vtest("guard, Vitest: a keeper that times out on the seed did not catch it → unresolved (exit 2)", async () => {
  const r = await guard(["hang.patch"])
  assert.deepEqual(r.rows.map((row) => [row.seed, row.candidate, row.keepers]), [["hang.patch", "caught", "timeout"]])
  assert.equal(r.verdict, "unresolved")
  assert.equal(r.exitCode, 2)
})

vtest("guard: the scratch worktree resolves @nodaro/* inside itself, never into the checkout", () => {
  if (!existsSync(path.join(repoRoot, "node_modules/@nodaro/shared"))) return
  const wt = scratchWorktree(repoRoot)
  try {
    assert.equal(realpathSync(path.join(wt.dir, "node_modules/@nodaro/shared")), path.join(wt.dir, "packages/shared"))
    assert.equal(realpathSync(path.join(wt.dir, "backend/node_modules/../../node_modules/@nodaro/shared")), path.join(wt.dir, "packages/shared"))
    assert.ok(realpathSync(path.join(wt.dir, "node_modules/vitest")).startsWith(realpathSync(path.join(repoRoot, "node_modules"))), "third-party packages are shared")
    if (existsSync(path.join(repoRoot, "packages/shared/dist"))) assert.equal(lstatSync(path.join(wt.dir, "packages/shared/dist")).isSymbolicLink(), false, "dist is a copy: a rebuild must not write into the checkout")
    assert.equal(existsSync(path.join(wt.dir, "node_modules/.vite")), false, "caches stay out of the checkout")
  } finally {
    wt.remove()
  }
  assert.equal(existsSync(wt.dir), false)
  const list = spawnSync("git", ["worktree", "list", "--porcelain"], { cwd: repoRoot, encoding: "utf8" }).stdout
  assert.ok(!list.includes(wt.dir), "the worktree is unregistered")
})
