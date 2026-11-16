// What the never-public CLIs print of a finding's line (tools/private-marker-list.mjs):
// - with the private marker list loaded, a line that holds a marker's term is
//   withheld, in the tree check (tools/check-public-surface.mjs) as in the
//   history gate (tools/check-history-surface.mjs);
// - in CI (`CI=true`) with no list, neither prints any line: only the file (and
//   its line number, or commit) and the rule, since nothing rules a marker out;
// - outside CI with no list, both print the line as they always have.
// And the wiring: no secret reaches the Check Public Surface job (it runs the
// PR's own code), and the Private Marker Gate's base-branch checkout carries
// every file the gates import.
//
// Every value is fake and built at runtime (random words; the third-party
// name and the planning phrase from split strings): the real list is a
// secret, and the publish path greps it across every tracked file.
import { test } from "node:test"
import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import { randomBytes } from "node:crypto"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, posix } from "node:path"
import { fileURLToPath } from "node:url"
import { printedText } from "../check-public-surface.mjs"
import { LINES_NOT_SHOWN, WITHHELD } from "../private-marker-list.mjs"

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..")
const TREE_CLI = join(REPO, "tools/check-public-surface.mjs")
const HISTORY_CLI = join(REPO, "tools/check-history-surface.mjs")
const COMPETITOR = ["artl", "st"].join("i")
const PLANNING = ["pl", "an re", "po"].join("")
const fakeWord = () => `zq${randomBytes(6).toString("hex")}`

// A real list, a REQUIRE flag or a PR title in the shell running the tests must not decide the outcome.
// So does CI: these tests run in CI and locally, and each names the mode it means.
const {
  PRIVATE_LEAK_MARKERS: _list,
  MIRROR_REQUIRE_MARKERS: _require,
  HISTORY_CHECKS: _checks,
  PR_TITLE: _title,
  PR_BODY: _body,
  CI: _ci,
  ...BASE_ENV
} = process.env
const IN_CI = { CI: "true" }
const IDENTITY = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.com", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.com" }

/** A throwaway repository: `files` committed on top of a seed commit; `base` is the seed. */
function withRepo(files, fn) {
  const dir = mkdtempSync(join(tmpdir(), "surface-withholding-"))
  const git = (...args) => execFileSync("git", ["-c", "commit.gpgsign=false", ...args], { cwd: dir, encoding: "utf8", env: { ...BASE_ENV, ...IDENTITY } })
  try {
    git("init", "-q", "-b", "main")
    writeFileSync(join(dir, "seed.txt"), "seed\n")
    git("add", "-A")
    git("commit", "-qm", "seed")
    const base = git("rev-parse", "HEAD").trim()
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, path)), { recursive: true })
      writeFileSync(join(dir, path), text)
    }
    git("add", "-A")
    git("commit", "-qm", "add files")
    fn({ dir, base, head: git("rev-parse", "HEAD").trim() })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/** A CLI run in `dir`, its whole output; the timeout turns a hang into a red test (spawnSync blocks node:test's own). */
function run(cli, args, dir, env = {}) {
  const r = spawnSync("node", [cli, ...args], { cwd: dir, encoding: "utf8", timeout: 30000, env: { ...BASE_ENV, ...env } })
  return { status: r.status, out: `${r.stdout}${r.stderr}` }
}

const assertNoValue = (out, value) => {
  // Neither the term nor any cut of it long enough to read.
  assert.ok(!out.toLowerCase().includes(value.slice(0, 6).toLowerCase()), "a marker's term (or part of it) was printed")
}

/** The line printed right after a finding's location, or undefined when none is. */
function lineAfter(out, location) {
  const lines = out.split("\n")
  const at = lines.findIndex((l) => l.trim() === location)
  assert.ok(at >= 0, `no finding at ${location}:\n${out}`)
  const next = lines[at + 1] ?? ""
  return /^ {6}\S/.test(next) ? next.trim() : undefined
}

function surfaceFiles(w) {
  // The term starts past character 160 on c.ts, so a 160-character cut would not hold it.
  const long = `// ported from ${COMPETITOR} Studio ${"x ".repeat(90)}${w} tail`
  return {
    "src/a.ts": `// ported from ${COMPETITOR} Studio, see ${w} here\n`,
    "src/b.ts": `// ported from ${COMPETITOR} Studio\n`,
    "src/c.ts": `${long}\n`,
    // A phrase split across two comment lines: found only de-wrapped, with the term beside it.
    "src/d.ts": `// the ${PLANNING.split(" ")[0]}\n// ${PLANNING.split(" ")[1]} ${w}\n`,
  }
}

test("the tree check, with the list loaded (in CI or not): a line holding a marker's term is withheld (the full line, and the text around a wrapped match); others print", () => {
  const w = fakeWord()
  withRepo(surfaceFiles(w), ({ dir }) => {
    for (const env of [{}, IN_CI]) {
      const { status, out } = run(TREE_CLI, [], dir, { ...env, PRIVATE_LEAK_MARKERS: ` ${w} \n` })
      assert.equal(status, 1)
      assert.match(out, /\[competitor-citation\]/)
      assert.equal(lineAfter(out, "src/a.ts:1"), WITHHELD)
      assert.equal(lineAfter(out, "src/b.ts:1"), `// ported from ${COMPETITOR} Studio`)
      assert.equal(lineAfter(out, "src/c.ts:1"), WITHHELD)
      assert.equal(lineAfter(out, "src/d.ts (wrapped across lines)"), WITHHELD)
      assert.doesNotMatch(out, /lines not shown/)
      assertNoValue(out, w)
    }
  })
})

test("the tree check in CI with no list: the file, its line and the rule only, never a line", () => {
  const w = fakeWord()
  withRepo(surfaceFiles(w), ({ dir }) => {
    for (const ci of ["true", "1", "TRUE"]) {
      const { status, out } = run(TREE_CLI, [], dir, { CI: ci })
      assert.equal(status, 1)
      assert.match(out, /\[competitor-citation\]/)
      assert.ok(out.includes(LINES_NOT_SHOWN))
      for (const location of ["src/a.ts:1", "src/b.ts:1", "src/c.ts:1", "src/d.ts (wrapped across lines)"]) assert.equal(lineAfter(out, location), undefined, location)
      assert.doesNotMatch(out, /ported from/)
      assertNoValue(out, w)
    }
  })
})

test("the tree check outside CI with no list prints each line as it always has", () => {
  const w = fakeWord()
  withRepo(surfaceFiles(w), ({ dir }) => {
    for (const env of [{}, { CI: "false" }, { CI: "0" }, { CI: "" }]) {
      const { status, out } = run(TREE_CLI, [], dir, env)
      assert.equal(status, 1)
      assert.doesNotMatch(out, /lines not shown/)
      assert.equal(lineAfter(out, "src/b.ts:1"), `// ported from ${COMPETITOR} Studio`)
      assert.equal(lineAfter(out, "src/a.ts:1"), `// ported from ${COMPETITOR} Studio, see ${w} here`)
    }
  })
})

test("the history gate in CI with no list: the commit, the file and the rule only; outside CI it prints the line; with the list, a line holding a term is withheld", () => {
  const w = fakeWord()
  withRepo(surfaceFiles(w), ({ dir, base, head }) => {
    const local = run(HISTORY_CLI, [`${base}..HEAD`], dir, { HISTORY_CHECKS: "surface" })
    assert.equal(local.status, 1)
    assert.doesNotMatch(local.out, /lines not shown/)
    assert.equal(lineAfter(local.out, `${head} src/b.ts`), `// ported from ${COMPETITOR} Studio`)

    const bare = run(HISTORY_CLI, [`${base}..HEAD`], dir, { ...IN_CI, HISTORY_CHECKS: "surface" })
    assert.equal(bare.status, 1)
    assert.match(bare.out, /\[competitor-citation\]/)
    assert.ok(bare.out.includes(LINES_NOT_SHOWN))
    assert.equal(lineAfter(bare.out, `${head} src/b.ts`), undefined)
    assert.doesNotMatch(bare.out, /ported from/)
    assertNoValue(bare.out, w)

    const listed = run(HISTORY_CLI, [`${base}..HEAD`], dir, { ...IN_CI, HISTORY_CHECKS: "surface", PRIVATE_LEAK_MARKERS: ` ${w} \n` })
    assert.equal(listed.status, 1)
    assert.equal(lineAfter(listed.out, `${head} src/a.ts`), WITHHELD)
    assert.equal(lineAfter(listed.out, `${head} src/b.ts`), `// ported from ${COMPETITOR} Studio`)
    assert.equal(lineAfter(listed.out, `${head} src/c.ts`), WITHHELD)
    assert.doesNotMatch(listed.out, /lines not shown/)
    assertNoValue(listed.out, w)
  })
})

test("printedText: nothing with no list; the withheld note for a term in the line, past the cut, or straddling a wrapped match's edge", () => {
  const w = fakeWord()
  const term = w
  assert.equal(printedText({ text: "// anything" }, null), undefined)
  assert.equal(printedText({ text: "// anything" }, []), "// anything")
  assert.equal(printedText({ text: `// ${"x".repeat(170)} ${w.toUpperCase()}` }, [term]), WITHHELD)
  // The match printed is `…a match…`; the term sits right after it in the de-wrapped text.
  assert.equal(printedText({ text: "…a match… (wrapped across lines)", context: `the a match ${w} and more` }, [term]), WITHHELD)
  assert.equal(printedText({ text: "…a match… (wrapped across lines)", context: "the a match and more" }, [term]), "…a match… (wrapped across lines)")
})

/** The `env:` lines of one step of one job in a workflow file, by the step's name. */
function stepEnv(workflow, jobId, stepName) {
  const job = workflow.split(/\n(?=  [a-z0-9-]+:\n)/).find((block) => block.startsWith(`  ${jobId}:\n`) || block.startsWith(`${jobId}:\n`))
  assert.ok(job, `no job ${jobId}`)
  const step = job.split(/\n(?=      - )/).find((s) => s.includes(`name: ${stepName}`))
  assert.ok(step, `no step ${stepName} in ${jobId}`)
  return { job, step }
}

test("CI: no secret reaches the Check Public Surface job, which runs the PR's own copy of both checks", () => {
  const ci = readFileSync(join(REPO, ".github/workflows/ci.yml"), "utf8")
  const { job } = stepEnv(ci, "check-public-surface", "Check every tracked file for never-public content")
  assert.match(job, /run: node tools\/check-public-surface\.mjs/)
  assert.doesNotMatch(job, /secrets\./)
  assert.doesNotMatch(job, /PRIVATE_LEAK_MARKERS|MIRROR_REQUIRE_MARKERS/)
})

test("the Private Marker Gate's base-branch checkout carries every file the gates it runs import", () => {
  const workflow = readFileSync(join(REPO, ".github/workflows/private-marker-check.yml"), "utf8")
  const m = workflow.match(/sparse-checkout: \|\n((?: {12}\S.*\n)+)/)
  assert.ok(m, "no sparse-checkout list")
  const listed = new Set(m[1].split("\n").map((l) => l.trim()).filter(Boolean))
  const missing = []
  const seen = new Set()
  const walk = (path) => {
    if (seen.has(path) || !path.endsWith(".mjs")) return
    seen.add(path)
    const source = readFileSync(join(REPO, path), "utf8")
    for (const [, spec] of source.matchAll(/(?:^|\n)\s*(?:import|export)\b[^"'\n]*?from\s+["'](\.{1,2}\/[^"']+)["']/g)) {
      const target = posix.normalize(posix.join(posix.dirname(path), spec))
      if (!listed.has(target)) missing.push(`${path} → ${target}`)
      walk(target)
    }
  }
  for (const path of listed) walk(path)
  assert.ok(seen.has("tools/check-history-surface.mjs") && seen.has("tools/check-public-surface.mjs"), "the walk read none of the gates")
  assert.deepEqual(missing, [])
})
