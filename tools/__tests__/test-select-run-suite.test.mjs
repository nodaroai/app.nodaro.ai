// tools/__tests__/test-select-run-suite.test.mjs
// run-suite.sh against a stand-in `npx`: which vitest commands it runs, how a
// post-merge failure is labelled, and the shadow-mode miss check.
import { test } from "node:test"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const tools = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
// The script uses mapfile (bash 4+); macOS ships bash 3.2. CI runs Linux.
const bash4 = spawnSync("bash", ["-c", "type mapfile"]).status === 0
const skip = bash4 ? false : "needs bash 4+ (mapfile)"

// FAKE_SCENARIO: pass | flaky (first run fails one file, re-run passes) |
// real (every run fails that file) | mixed (a and c fail; alone, a fails
// again and c passes) | rerun-crash (the re-run fails without
// writing a report) | unhandled (first run fails one file AND prints a Vitest
// unhandled error; a re-run would pass).
const FAKE_NPX = `#!/usr/bin/env bash
echo "$*" >> "$NPX_LOG"
calls=$(wc -l < "$NPX_LOG")
out=""
for a in "$@"; do case "$a" in --outputFile.json=*) out="\${a#--outputFile.json=}" ;; esac; done
if [ "$FAKE_SCENARIO" = pass ]; then
  [ -n "$out" ] && printf '{"testResults":[{"status":"passed","name":"%s/src/a.test.ts"}]}' "$PWD" > "$out"
  exit 0
fi
if [ "$FAKE_SCENARIO" = mixed ]; then
  if [ "$calls" -eq 1 ]; then
    printf '{"testResults":[{"status":"failed","name":"%s/src/a.test.ts"},{"status":"failed","name":"%s/src/c.test.ts"}]}' "$PWD" "$PWD" > "$out"
  else
    printf '{"testResults":[{"status":"failed","name":"%s/src/a.test.ts"},{"status":"passed","name":"%s/src/c.test.ts"}]}' "$PWD" "$PWD" > "$out"
  fi
  exit 1
fi
if [ "$calls" -eq 1 ]; then
  [ -n "$out" ] && printf '{"testResults":[{"status":"failed","name":"%s/src/a.test.ts"},{"status":"passed","name":"%s/src/b.test.ts"}]}' "$PWD" "$PWD" > "$out"
  if [ "$FAKE_SCENARIO" = unhandled ]; then
    echo "⎯⎯⎯⎯ Unhandled Rejection ⎯⎯⎯⎯" >&2
    echo "Vitest caught 1 unhandled error during the test run." >&2
  fi
  exit 1
fi
if [ "$FAKE_SCENARIO" = real ]; then
  [ -n "$out" ] && printf '{"testResults":[{"status":"failed","name":"%s/src/a.test.ts"}]}' "$PWD" > "$out"
  exit 1
fi
[ "$FAKE_SCENARIO" = rerun-crash ] && exit 1
exit 0
`
// "crash": a failed run whose report names no failed file (an unhandled error).
const FAKE_NPX_CRASH = `#!/usr/bin/env bash
echo "$*" >> "$NPX_LOG"
for a in "$@"; do case "$a" in --outputFile.json=*) printf '{"testResults":[]}' > "\${a#--outputFile.json=}" ;; esac; done
exit 1
`

function runSuite(selection, scenario, { list = "src/a.test.ts\n", shadowSelection, unset = [], shard, files = ["src/a.test.ts"], runList, event } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "run-suite-"))
  const bin = path.join(root, "bin")
  const project = path.join(root, "frontend")
  mkdirSync(bin)
  mkdirSync(project)
  for (const f of files) { mkdirSync(path.join(project, path.dirname(f)), { recursive: true }); writeFileSync(path.join(project, f), "") }
  // a copy, not a symlink: failed-files.mjs compares argv[1] with its real path
  cpSync(path.join(tools, "test-select"), path.join(root, "tools/test-select"), { recursive: true })
  writeFileSync(path.join(bin, "npx"), scenario === "crash" ? FAKE_NPX_CRASH : FAKE_NPX)
  chmodSync(path.join(bin, "npx"), 0o755)
  const env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    SELECTION: selection,
    LIST: path.join(root, "list.txt"),
    REPORT: path.join(root, "report.json"),
    FAILED: path.join(root, "failed.txt"),
    NPX_LOG: path.join(root, "npx.log"),
    FAKE_SCENARIO: scenario,
    SHADOW_OUT: path.join(root, "shadow.json"),
    PROJECT: "frontend",
    // never the real job summary of the CI run executing this test
    GITHUB_STEP_SUMMARY: path.join(root, "summary.md"),
  }
  if (runList === undefined) delete env.RUN_LIST
  else { env.RUN_LIST = path.join(root, "run.txt"); writeFileSync(env.RUN_LIST, runList); env.GITHUB_EVENT_NAME = event ?? "pull_request" }
  if (shard === undefined) delete env.SHARD
  else env.SHARD = shard
  if (shadowSelection === undefined) delete env.SHADOW_SELECTION
  else env.SHADOW_SELECTION = shadowSelection
  writeFileSync(env.LIST, list)
  for (const name of unset) delete env[name]
  const r = spawnSync("bash", [...(process.env.DEBUG_RUN_SUITE ? ["-x"] : []), path.join(root, "tools/test-select/run-suite.sh")], { cwd: project, env, encoding: "utf8" })
  const read = (f) => { try { return readFileSync(f, "utf8") } catch { return "" } }
  const lines = (f) => read(f).split("\n").filter(Boolean)
  const shadow = read(env.SHADOW_OUT)
  return {
    status: r.status, output: r.stdout + r.stderr, calls: lines(env.NPX_LOG),
    failed: lines(env.FAILED), flaky: lines(`${env.FAILED}.flaky`), unknown: lines(`${env.FAILED}.unknown`),
    shadow: shadow ? JSON.parse(shadow) : null, summary: read(env.GITHUB_STEP_SUMMARY),
  }
}

test("post-merge runs the full suite with a JSON report and no coverage", { skip }, () => {
  const r = runSuite("post-merge", "pass")
  assert.equal(r.status, 0)
  assert.equal(r.calls.length, 1)
  assert.match(r.calls[0], /^vitest run --reporter=default --reporter=json --outputFile\.json=\S+report\.json$/)
  assert.doesNotMatch(r.calls[0], /coverage/)
})

// decided 2026-10-13: the re-run only labels a failure; the run stays red.
test("post-merge: a file that fails once and passes alone is labelled flaky — and the run stays red", { skip }, () => {
  const r = runSuite("post-merge", "flaky")
  assert.equal(r.status, 1, r.output)
  assert.equal(r.calls.length, 2)
  assert.match(r.calls[1], /^vitest run src\/a\.test\.ts /)
  assert.deepEqual(r.failed, [])
  assert.deepEqual(r.flaky, ["src/a.test.ts"])
})

test("post-merge: a file that fails again alone stays failed, not flaky", { skip }, () => {
  const r = runSuite("post-merge", "real")
  assert.equal(r.status, 1, r.output)
  assert.equal(r.calls.length, 2)
  assert.deepEqual(r.failed, ["src/a.test.ts"])
  assert.deepEqual(r.flaky, [])
})

test("post-merge: of two failed files, the one that fails again stays failed and the other is labelled flaky", { skip }, () => {
  const r = runSuite("post-merge", "mixed")
  assert.equal(r.status, 1, r.output)
  assert.match(r.calls[1], /^vitest run src\/a\.test\.ts src\/c\.test\.ts /)
  assert.deepEqual(r.failed, ["src/a.test.ts"])
  assert.deepEqual(r.flaky, ["src/c.test.ts"])
})

test("post-merge: a re-run that crashes without a report labels its files unknown — neither failed again nor flaky", { skip }, () => {
  const r = runSuite("post-merge", "rerun-crash")
  assert.equal(r.status, 1, r.output)
  assert.deepEqual(r.failed, [])
  assert.deepEqual(r.unknown, ["src/a.test.ts"])
  assert.deepEqual(r.flaky, [])
})

test("shadow: the full suite runs; a failing file outside the selection is a miss, and the run is red", { skip }, () => {
  const r = runSuite("shadow", "real", { list: "src/other.test.ts\n", shadowSelection: "affected" })
  assert.equal(r.status, 1, r.output)
  assert.equal(r.calls.length, 1)
  assert.match(r.calls[0], /^vitest run --reporter=default --reporter=json --outputFile\.json=\S+report\.json$/)
  assert.deepEqual(r.shadow.misses, ["src/a.test.ts"])
  assert.deepEqual(r.shadow.failed, ["src/a.test.ts"])
  assert.equal(r.shadow.selected, 1)
  assert.equal(r.shadow.project, "frontend")
  assert.match(r.output, /::warning title=Selector miss \(frontend\)::src\/a\.test\.ts failed but the selector would have skipped it/)
  assert.match(r.summary, /#### Shadow check/)
})

test("shadow: a failing file inside the selection is no miss — still red", { skip }, () => {
  const r = runSuite("shadow", "real", { shadowSelection: "affected" })
  assert.equal(r.status, 1, r.output)
  assert.deepEqual(r.shadow.misses, [])
})

test("shadow: a pass is a pass, whatever the selector would have run; no shadow_selection means full", { skip }, () => {
  const r = runSuite("shadow", "pass", { list: "", shadowSelection: "none" })
  assert.equal(r.status, 0, r.output)
  assert.equal(r.shadow.error, undefined)
  assert.deepEqual(r.shadow.misses, [])
  assert.deepEqual(runSuite("shadow", "pass").shadow.wouldRun, "full")
})

test("shadow: a green suite exits 0 even with every optional variable unset", { skip }, () => {
  const r = runSuite("shadow", "pass", { unset: ["LIST", "REPORT", "FAILED", "SHADOW_OUT", "PROJECT", "GITHUB_STEP_SUMMARY"] })
  assert.equal(r.status, 0, r.output)
  assert.equal(r.calls.length, 1)
  assert.doesNotMatch(r.output, /unbound variable/)
})

test("shadow: a failed run with no failing test file is recorded unattributed", { skip }, () => {
  const r = runSuite("shadow", "crash", { shadowSelection: "affected" })
  assert.equal(r.status, 1, r.output)
  assert.equal(r.shadow.unattributed, true)
  assert.match(r.summary, /counted as a possible miss/)
})

test("shadow: an unhandled error beside a failure inside the selection is unattributed — the file alone does not explain it", { skip }, () => {
  const r = runSuite("shadow", "unhandled", { shadowSelection: "affected" })
  assert.equal(r.status, 1, r.output)
  assert.deepEqual(r.shadow.misses, [])
  assert.deepEqual(r.shadow.failed, ["src/a.test.ts"])
  assert.equal(r.shadow.unattributed, true)
  assert.match(r.summary, /unhandled error/i)
  // the run's output is still shown, and logged for the check
  assert.match(r.output, /Unhandled Rejection/)
})

test("shadow: a failure inside the selection with no unhandled error is not unattributed", { skip }, () => {
  const r = runSuite("shadow", "real", { shadowSelection: "affected" })
  assert.equal(r.shadow.unattributed, undefined)
})

test("shadow: a check that cannot run never changes the result", { skip }, () => {
  const r = runSuite("shadow", "pass", { shadowSelection: "bogus" })
  assert.equal(r.status, 0, r.output)
  assert.match(r.shadow.error, /unknown wouldRun/)
  assert.match(r.summary, /shadow check could not run/)
})

test("post-merge: an unhandled error alongside a failed file is real — no flake re-run", { skip }, () => {
  const r = runSuite("post-merge", "unhandled")
  assert.notEqual(r.status, 0, r.output)
  assert.equal(r.calls.length, 1, r.calls.join("\n"))
  assert.deepEqual(r.failed, ["src/a.test.ts"])
  assert.match(r.output, /unhandled error/i)
})

test("affected, full, none, and an unknown mode (the retired full-coverage) — never fewer tests than asked", { skip }, () => {
  assert.deepEqual(runSuite("affected", "pass").calls, ["vitest run src/a.test.ts"])
  assert.deepEqual(runSuite("full", "pass").calls, ["vitest run"])
  assert.deepEqual(runSuite("none", "pass").calls, [])
  const old = runSuite("full-coverage", "pass")
  assert.deepEqual(old.calls, ["vitest run"])
  assert.match(old.output, /unknown selection 'full-coverage'/)
})

// Four shards per suite (decided 2026-10-14): every mode runs only its shard,
// and a shard that gets no file passes; the post-merge re-run is not sharded.
test("SHARD: full, affected and shadow run only their shard, and an empty shard passes", { skip }, () => {
  const full = runSuite("full", "pass", { shard: "2/4" })
  assert.equal(full.status, 0, full.output)
  assert.deepEqual(full.calls, ["vitest run --shard=2/4"])
  const affected = runSuite("affected", "pass", { shard: "3/4", list: "src/a.test.ts\nsrc/b.test.ts\n", files: ["src/a.test.ts", "src/b.test.ts"] })
  assert.equal(affected.status, 0, affected.output)
  assert.deepEqual(affected.calls, ["vitest run src/a.test.ts src/b.test.ts --shard=3/4 --passWithNoTests"])
  const shadow = runSuite("shadow", "pass", { shard: "1/4", shadowSelection: "affected" })
  assert.match(shadow.calls[0], /^vitest run --shard=1\/4 --reporter=default --reporter=json /)
})

test("SHARD: post-merge runs its shard, then re-runs the failed files alone, unsharded", { skip }, () => {
  const r = runSuite("post-merge", "flaky", { shard: "4/4" })
  assert.equal(r.status, 1, r.output)
  assert.match(r.calls[0], /^vitest run --shard=4\/4 --reporter=default /)
  assert.match(r.calls[1], /^vitest run src\/a\.test\.ts --reporter=default /)
  assert.doesNotMatch(r.calls[1], /--shard/)
  assert.deepEqual(r.flaky, ["src/a.test.ts"])
})

test("SHARD: only affected mode may pass an empty shard, and only for a list of files that exist", { skip }, () => {
  for (const mode of ["full", "post-merge"]) {
    assert.doesNotMatch(runSuite(mode, "pass", { shard: "1/4" }).calls[0], /passWithNoTests/, mode)
  }
  const stale = runSuite("affected", "pass", { shard: "1/4", list: "src/gone.test.ts\n" })
  assert.equal(stale.status, 1, stale.output)
  assert.deepEqual(stale.calls, [])
  assert.match(stale.output, /src\/gone\.test\.ts, which does not exist/)
})

test("no SHARD: the commands are unchanged", { skip }, () => {
  assert.deepEqual(runSuite("full", "pass").calls, ["vitest run"])
})

// The pass cache (§5.6): a planned list replaces --shard on PR modes; an empty
// one passes; post-merge never uses it.
test("RUN_LIST: full, affected and shadow run the planned files with a JSON report", { skip }, () => {
  const full = runSuite("full", "pass", { shard: "2/4", runList: "src/a.test.ts\nsrc/b.test.ts\n" })
  assert.equal(full.status, 0, full.output)
  assert.match(full.calls[0], /^vitest run src\/a\.test\.ts src\/b\.test\.ts --reporter=default --reporter=json --outputFile\.json=\S+$/)
  assert.doesNotMatch(full.calls[0], /--shard/)
  const affected = runSuite("affected", "pass", { shard: "1/4", runList: "src/a.test.ts\n" })
  assert.match(affected.calls[0], /^vitest run src\/a\.test\.ts --reporter=default --reporter=json /)
  const shadow = runSuite("shadow", "pass", { shard: "3/4", shadowSelection: "affected", runList: "src/a.test.ts\n" })
  assert.match(shadow.calls[0], /^vitest run src\/a\.test\.ts --reporter=default --reporter=json /)
  assert.ok(shadow.shadow, "the shadow check still runs")
})

test("RUN_LIST: an empty plan runs nothing and passes — shadow still records its check", { skip }, () => {
  const full = runSuite("full", "pass", { shard: "1/4", runList: "" })
  assert.equal(full.status, 0, full.output)
  assert.deepEqual(full.calls, [])
  const shadow = runSuite("shadow", "pass", { shard: "1/4", shadowSelection: "full", runList: "" })
  assert.equal(shadow.status, 0, shadow.output)
  assert.deepEqual(shadow.calls, [])
  assert.deepEqual(shadow.shadow?.misses, [])
})

test("RUN_LIST: a failing planned file fails the shard; post-merge ignores the plan", { skip }, () => {
  const fail = runSuite("full", "real", { shard: "1/4", runList: "src/a.test.ts\n" })
  assert.equal(fail.status, 1, fail.output)
  const pm = runSuite("post-merge", "pass", { shard: "1/4", runList: "" })
  assert.match(pm.calls[0], /^vitest run --shard=1\/4 --reporter=default /)
})

test("RUN_LIST: only a pull request may use the plan; a push runs its whole shard", { skip }, () => {
  const push = runSuite("full", "pass", { shard: "1/4", runList: "", event: "push" })
  assert.deepEqual(push.calls, ["vitest run --shard=1/4"])
})
