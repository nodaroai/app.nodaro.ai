// The private-marker gate (scripts/check-private-markers.sh) runs at publish
// time AND on every PR into dev/main. The real list is a repo secret, so these
// tests drive the script with a FAKE list against throwaway repos. They pin:
// a hit fails and prints only `marker #N` plus file paths, never a value; a
// clean tree passes; a required list that is missing fails.
//
// Fake markers are random and built at runtime: they cannot coincide with the
// real list, and none is spelled in this tracked file.
import { test } from "node:test"
import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import { randomBytes } from "node:crypto"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const REPO = fileURLToPath(new URL("../..", import.meta.url))
const SCRIPT = join(REPO, "scripts/check-private-markers.sh")

const fakeMarker = () => `fake-marker-${randomBytes(6).toString("hex")}`

// A real list or a REQUIRE flag exported in the shell running the tests must
// not decide the outcome.
const { PRIVATE_LEAK_MARKERS: _list, MIRROR_REQUIRE_MARKERS: _require, ...BASE_ENV } = process.env

const HEADER = "== private-marker gate (strings that must never appear in a published tree) =="

// git grep reads TRACKED files, so the fixtures are added to the index (forced,
// so a global excludes file cannot silently untrack one).
function withRepo(files, fn) {
  const dir = mkdtempSync(join(tmpdir(), "private-markers-"))
  try {
    execFileSync("git", ["init", "-q"], { cwd: dir, env: BASE_ENV })
    track(dir, files)
    return fn(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

function track(dir, files) {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true })
    writeFileSync(join(dir, path), content)
  }
  execFileSync("git", ["add", "-f", "--", ...Object.keys(files)], { cwd: dir, env: BASE_ENV })
}

function runGate(cwd, env = {}) {
  const r = spawnSync("bash", [SCRIPT], { cwd, encoding: "utf8", env: { ...BASE_ENV, ...env } })
  return { status: r.status, out: `${r.stdout}${r.stderr}` }
}

function assertNoValues(out, markers) {
  for (const m of markers) {
    assert.ok(!out.toLowerCase().includes(m.toLowerCase()), "a marker value was printed")
  }
}

test("a hit fails and prints only `marker #N` and the offending paths, never a value", () => {
  const [hit1, miss, hit3] = [fakeMarker(), fakeMarker(), fakeMarker()]
  const files = {
    "clean.txt": "nothing to see\n",
    // Matching is case-insensitive.
    "src/leak.ts": `// ${hit1.toUpperCase()}\n`,
    "docs/notes.md": `see ${hit3}\n`,
    "docs/more.md": `and ${hit3} again\n`,
  }
  withRepo(files, (dir) => {
    const { status, out } = runGate(dir, { PRIVATE_LEAK_MARKERS: `${hit1}\n${miss}\n${hit3}\n` })
    assert.equal(status, 1)
    // Every marker is checked before the abort, each hit under its own number.
    assert.match(out, /^ABORT: private marker #1 found in tracked files:\nsrc\/leak\.ts$/m)
    assert.match(out, /^ABORT: private marker #3 found in tracked files:\ndocs\/more\.md\ndocs\/notes\.md$/m)
    assert.ok(!out.includes("marker #2"))
    assert.ok(!out.includes("clean.txt"))
    assert.ok(!out.includes("clean ("))
    assertNoValues(out, [hit1, miss, hit3])
    const allowed = new Set([HEADER, ...Object.keys(files)])
    for (const line of out.trimEnd().split("\n")) {
      assert.ok(
        allowed.has(line) || /^ABORT: private marker #\d+ found in tracked files:$/.test(line),
        `unexpected output line: ${line}`,
      )
    }
  })
})

test("a clean tree passes, and blank lines in the list are not markers", () => {
  withRepo({ "a.txt": "alpha\n", "src/b.ts": "export const b = 1\n" }, (dir) => {
    const markers = [fakeMarker(), fakeMarker()]
    const { status, out } = runGate(dir, {
      PRIVATE_LEAK_MARKERS: `\n${markers[0]}\n\n${markers[1]}\n\n`,
      MIRROR_REQUIRE_MARKERS: "1",
    })
    assert.equal(status, 0)
    assert.equal(out, `${HEADER}\nclean (2 markers checked)\n`)
  })
})

test("MIRROR_REQUIRE_MARKERS=1 with no list fails, whether the list is unset or empty", () => {
  withRepo({ "a.txt": "alpha\n" }, (dir) => {
    for (const env of [{ MIRROR_REQUIRE_MARKERS: "1" }, { MIRROR_REQUIRE_MARKERS: "1", PRIVATE_LEAK_MARKERS: "" }]) {
      const { status, out } = runGate(dir, env)
      assert.equal(status, 1)
      assert.match(out, /^ABORT: MIRROR_REQUIRE_MARKERS=1 but no marker list/m)
    }
  })
})

test("with no list and no requirement, the gate skips with a note", () => {
  withRepo({ "a.txt": "alpha\n" }, (dir) => {
    const { status, out } = runGate(dir)
    assert.equal(status, 0)
    assert.match(out, /^\(no marker list — set PRIVATE_LEAK_MARKERS or \.leak-markers/m)
  })
})

test("a local .leak-markers file is the fallback list, and never trips on itself", () => {
  const marker = fakeMarker()
  withRepo({ "a.txt": "alpha\n" }, (dir) => {
    writeFileSync(join(dir, ".leak-markers"), `${marker}\n`) // untracked, as in a real checkout
    let r = runGate(dir, { MIRROR_REQUIRE_MARKERS: "1" })
    assert.equal(r.status, 0)
    assert.match(r.out, /^clean \(1 markers checked\)$/m)

    track(dir, { "src/c.ts": `// ${marker}\n` })
    r = runGate(dir, { MIRROR_REQUIRE_MARKERS: "1" })
    assert.equal(r.status, 1)
    assert.match(r.out, /^ABORT: private marker #1 found in tracked files:\nsrc\/c\.ts$/m)
    assertNoValues(r.out, [marker])
  })
})

test("run from a subdirectory, the gate still scans the whole checkout", () => {
  const marker = fakeMarker()
  withRepo({ "docs/x.md": `${marker}\n`, "src/y.ts": "ok\n" }, (dir) => {
    const { status, out } = runGate(join(dir, "src"), { PRIVATE_LEAK_MARKERS: marker })
    assert.equal(status, 1)
    assert.match(out, /^docs\/x\.md$/m)
  })
})

test("the publish path and the PR check run this one script", () => {
  const publish = readFileSync(join(REPO, "scripts/publish-to-public.sh"), "utf8")
  assert.match(publish, /check-private-markers\.sh/)
  assert.ok(!publish.includes("git grep -I -l -i -F"), "publish-to-public.sh re-implements the gate")

  const workflow = readFileSync(join(REPO, ".github/workflows/private-marker-check.yml"), "utf8")
  // The PR check runs the BASE branch's copy of the gate (a branch cut before
  // the gate existed has none, and a PR must not edit the check it is judged
  // by), from the PR checkout's root, so it scans the PR's tracked files.
  assert.match(workflow, /gate=\.gate-base\/scripts\/check-private-markers\.sh/)
  assert.match(workflow, /ref: \$\{\{ github\.base_ref \|\| github\.ref_name \}\}\s*\n\s*path: \.gate-base/)
  assert.ok(!/run: bash scripts\/check-private-markers\.sh/.test(workflow), "the PR check runs the PR's own copy of the gate")
  assert.match(workflow, /PRIVATE_LEAK_MARKERS: \$\{\{ secrets\.PRIVATE_LEAK_MARKERS \}\}/)
  assert.match(workflow, /MIRROR_REQUIRE_MARKERS: "1"/)
})

test("the PR check runs the base branch's gate, and the PR's own copy only while the base has none", () => {
  const workflow = readFileSync(join(REPO, ".github/workflows/private-marker-check.yml"), "utf8")
  // The check step's shell, exactly as the workflow runs it.
  const m = workflow.match(/Check tracked files for private markers[\s\S]*?run: \|\n((?: {10}.*\n?)+)/)
  assert.ok(m, "could not find the check step's run block")
  const script = m[1].split("\n").map((l) => l.slice(10)).join("\n")
  const dir = mkdtempSync(join(tmpdir(), "marker-gate-step-"))
  try {
    mkdirSync(join(dir, "scripts"), { recursive: true })
    mkdirSync(join(dir, ".gate-base", "scripts"), { recursive: true })
    writeFileSync(join(dir, "scripts", "check-private-markers.sh"), "echo ran-pr-copy\n")
    writeFileSync(join(dir, ".gate-base", "scripts", "check-private-markers.sh"), "echo ran-base-copy\n")
    writeFileSync(join(dir, "step.sh"), script)
    const both = spawnSync("bash", ["step.sh"], { cwd: dir, encoding: "utf8" })
    assert.equal(both.status, 0)
    assert.match(both.stdout, /ran-base-copy/)
    assert.doesNotMatch(both.stdout, /ran-pr-copy/, "the PR's copy ran although the base has one")

    rmSync(join(dir, ".gate-base"), { recursive: true, force: true })
    const bootstrap = spawnSync("bash", ["step.sh"], { cwd: dir, encoding: "utf8" })
    assert.equal(bootstrap.status, 0)
    assert.match(bootstrap.stdout, /ran-pr-copy/)
    assert.match(bootstrap.stdout, /no copy of the gate yet/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test(".leak-markers is gitignored, so the list can never be committed", () => {
  const r = spawnSync("git", ["check-ignore", "-q", ".leak-markers"], { cwd: REPO, env: BASE_ENV })
  assert.equal(r.status, 0, ".leak-markers is not ignored (or is tracked)")
})
