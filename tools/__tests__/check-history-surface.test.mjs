// The TREE gate (check-public-surface) reads the tip. A merge publishes the
// whole BRANCH: the mirror pushes full history to the public remote, so a line
// a commit added and a later commit deleted is world-readable forever via
// `git log -p`, with every tree-scanning gate green. These tests pin the
// history gate that closes that hole.
//
// The competitor fixture builds its string at runtime (never a literal): the
// publish path greps FIXED private markers across every tracked file, so a test
// that spells its own target would abort the mirror on itself.
import { test } from "node:test"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { randomBytes } from "node:crypto"
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import {
  addedLinesFromPatch,
  findHistoryViolations,
  INTERNAL_DOC_DIRS,
  MESSAGE,
  PINS_FILE,
  PR_BODY_SHA,
  PR_TITLE_SHA,
  scanRange,
  writtenPathsFromPatch,
} from "../check-history-surface.mjs"

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..")

const COMPETITOR = ["artl", "st"].join("i")

function patch(path, addedLines) {
  return [
    `diff --git a/${path} b/${path}`,
    `--- a/${path}`,
    `+++ b/${path}`,
    `@@ -0,0 +1,${addedLines.length} @@`,
    ...addedLines.map((l) => `+${l}`),
  ].join("\n")
}

test("added lines are read per file, and the +++ header is not one of them", () => {
  const added = addedLinesFromPatch(patch("backend/src/a.ts", ["// one", "// two"]))
  assert.deepEqual(added, [
    { path: "backend/src/a.ts", text: "// one" },
    { path: "backend/src/a.ts", text: "// two" },
  ])
})

test("a commit that ADDS a competitor name is a finding even if a later commit removes it", () => {
  const violations = findHistoryViolations([
    { sha: "aaaaaaa", subject: "add", patch: patch("packages/x/src/m.ts", [`// ported from ${COMPETITOR} Studio`]) },
    { sha: "bbbbbbb", subject: "scrub", patch: patch("packages/x/src/m.ts", ["// ported from the reference app"]) },
  ])
  assert.equal(violations.length, 1)
  assert.equal(violations[0].sha, "aaaaaaa")
  assert.equal(violations[0].ruleId, "competitor-citation")
  assert.equal(violations[0].file, "packages/x/src/m.ts")
})

test("clean history is empty", () => {
  const violations = findHistoryViolations([
    { sha: "ccccccc", subject: "ok", patch: patch("backend/src/a.ts", ["// nothing to see"]) },
  ])
  assert.deepEqual(violations, [])
})

test("paths the tree gate skips are skipped here too", () => {
  const violations = findHistoryViolations([
    { sha: "ddddddd", subject: "vendor", patch: patch("node_modules/p/i.js", [`// ${COMPETITOR}`]) },
    { sha: "eeeeeee", subject: "guards", patch: patch("tools/check-something.mjs", [`// ${COMPETITOR}`]) },
  ])
  assert.deepEqual(violations, [])
})

test("a path-anchored EXCEPTION is honored — and only on its own path", () => {
  // docs/deployment.md documents the SHAPE of an R2 public URL on purpose; the
  // same line anywhere else is the finding. Fake hex, so nothing real leaks.
  const line = "// pub-0123456789abcdef0123456789abcdef.r2.dev"
  assert.deepEqual(
    findHistoryViolations([{ sha: "fffffff", subject: "docs", patch: patch("docs/deployment.md", [line]) }]),
    [],
  )
  const elsewhere = findHistoryViolations([
    { sha: "9999999", subject: "code", patch: patch("backend/src/x.ts", [line]) },
  ])
  assert.equal(elsewhere.length, 1)
  assert.equal(elsewhere[0].ruleId, "production-identifier")
})

test("a rule's allowPaths are honored (a rate card in its sanctioned home)", () => {
  const rate = "  costPerSecond: 0.05, // $0.05/second"
  assert.equal(
    findHistoryViolations([{ sha: "1111111", subject: "rates", patch: patch("backend/src/lib/pricing/x.ts", [rate]) }]).length,
    0,
  )
  assert.equal(
    findHistoryViolations([{ sha: "2222222", subject: "rates", patch: patch("frontend/src/x.ts", [rate]) }]).length,
    1,
  )
})

test("scanRange reads real commits: add-then-remove is still reported", () => {
  const dir = mkdtempSync(join(tmpdir(), "history-surface-"))
  const git = (...args) =>
    execFileSync("git", args, {
      cwd: dir,
      encoding: "utf8",
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.com",
        GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.com",
      },
    })
  try {
    git("init", "-q", "-b", "main")
    writeFileSync(join(dir, "seed.ts"), "// seed\n")
    git("add", "-A"); git("commit", "-qm", "seed")
    const base = git("rev-parse", "HEAD").trim()

    writeFileSync(join(dir, "seed.ts"), `// seed\n// modeled on ${COMPETITOR} Studio\n`)
    git("add", "-A"); git("commit", "-qm", "borrow")
    const adding = git("rev-parse", "HEAD").trim()

    writeFileSync(join(dir, "seed.ts"), "// seed\n// modeled on the reference app\n")
    git("add", "-A"); git("commit", "-qm", "scrub")

    // The TIP is clean — this is exactly the state the tree gate calls green.
    assert.ok(!git("show", "HEAD:seed.ts").includes(COMPETITOR))

    const violations = scanRange(`${base}..HEAD`, dir)
    assert.equal(violations.length, 1)
    assert.equal(violations[0].sha, adding)
    assert.equal(violations[0].ruleId, "competitor-citation")

    // The publish path passes full rev-list arguments, because "already
    // published" is the union of BOTH public heads, not one range.
    const excluded = scanRange(["HEAD", "--not", base], dir)
    assert.deepEqual(excluded.map((v) => v.sha), [adding])
    assert.deepEqual(scanRange(["HEAD", "--not", adding], dir), [])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------------------
// Commit messages, merge resolutions, internal-doc paths, the private lists,
// and pins. Each reaches public through history alone.

/** A throwaway repository with a fixed identity. */
function tempRepo() {
  const dir = mkdtempSync(join(tmpdir(), "history-surface-"))
  const git = (...args) =>
    execFileSync("git", args, {
      cwd: dir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.com",
        GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.com",
      },
    })
  const write = (path, text) => {
    mkdirSync(dirname(join(dir, path)), { recursive: true })
    writeFileSync(join(dir, path), text)
  }
  git("init", "-q", "-b", "main")
  write("seed.ts", "// seed\n")
  git("add", "-A"); git("commit", "-qm", "seed")
  return { dir, git, write, base: git("rev-parse", "HEAD").trim(), done: () => rmSync(dir, { recursive: true, force: true }) }
}

test("a commit MESSAGE is read against the surface categories", () => {
  const violations = findHistoryViolations([
    { sha: "aaaaaaa", subject: "port", message: `port\n\nModeled on ${COMPETITOR} Studio.\n`, patch: "" },
  ])
  assert.equal(violations.length, 1)
  assert.equal(violations[0].file, MESSAGE)
  assert.equal(violations[0].ruleId, "competitor-citation")
})

test("the PR title is read as one more message, on a real range", () => {
  const r = tempRepo()
  try {
    r.write("a.ts", "// a\n"); r.git("add", "-A"); r.git("commit", "-qm", "clean subject")
    assert.deepEqual(scanRange(`${r.base}..HEAD`, r.dir), [])
    const viaTitle = scanRange(`${r.base}..HEAD`, r.dir, { title: `feat: the ${COMPETITOR} look` })
    assert.deepEqual(viaTitle.map((v) => [v.sha, v.file]), [[PR_TITLE_SHA, MESSAGE]])
  } finally {
    r.done()
  }
})

test("the PR description is read as one more message, CRLF line ends included", () => {
  const r = tempRepo()
  try {
    r.write("a.ts", "// a\n"); r.git("add", "-A"); r.git("commit", "-qm", "clean subject")
    for (const body of [undefined, "", "  \r\n  "]) assert.deepEqual(scanRange(`${r.base}..HEAD`, r.dir, { body }), [])
    const body = `## Summary\r\n\r\nThe new look.\r\nModeled on ${COMPETITOR} Studio.\r\n`
    const viaBody = scanRange(`${r.base}..HEAD`, r.dir, { body })
    assert.deepEqual(viaBody.map((v) => [v.sha, v.file, v.ruleId, v.text]), [
      [PR_BODY_SHA, MESSAGE, "competitor-citation", `Modeled on ${COMPETITOR} Studio.`],
    ])
  } finally {
    r.done()
  }
})

const hasGitleaks = (() => {
  try {
    execFileSync("gitleaks", ["version"], { stdio: "ignore" })
    return true
  } catch {
    return false
  }
})()

test("gitleaks reads the PR description", { skip: !hasGitleaks && "gitleaks is not installed" }, () => {
  const r = tempRepo()
  try {
    r.write("a.ts", "// a\n"); r.git("add", "-A"); r.git("commit", "-qm", "clean subject")
    // Fresh and random, as tools/gitleaks-canary.sh makes it: a key-shaped
    // literal in this file would trip the scan of its own diff.
    const token = `ghp_${randomBytes(48).toString("base64").replace(/[^A-Za-z0-9]/g, "").slice(0, 36)}`
    const found = scanRange(`${r.base}..HEAD`, r.dir, { checks: ["secrets"], body: `## Test plan\n\ntoken = "${token}"\n` })
    assert.deepEqual(found.map((v) => [v.sha, v.file]), [[PR_BODY_SHA, MESSAGE]])
    assert.match(found[0].ruleId, /^gitleaks:/)
  } finally {
    r.done()
  }
})

test("a merge is read through its conflict resolution, and only that", () => {
  const r = tempRepo()
  try {
    // A side branch and main both edit seed.ts; the merge resolves the conflict
    // by writing a line neither parent had, and no later commit carries it.
    r.git("checkout", "-qb", "side")
    r.write("seed.ts", "// side\n"); r.git("commit", "-qam", "side")
    r.git("checkout", "-q", "main")
    r.write("seed.ts", "// main\n"); r.git("commit", "-qam", "main")
    try { r.git("merge", "-q", "side") } catch { /* the conflict is the point */ }
    r.write("seed.ts", `// resolved as in ${COMPETITOR} Studio\n`)
    r.git("add", "-A"); r.git("commit", "-qm", "merge side")
    const merge = r.git("rev-parse", "HEAD").trim()
    r.write("seed.ts", "// resolved\n"); r.git("commit", "-qam", "scrub")

    const violations = scanRange(`${r.base}..HEAD`, r.dir)
    assert.deepEqual(violations.map((v) => [v.sha, v.ruleId]), [[merge, "competitor-citation"]])
  } finally {
    r.done()
  }
})

test("a clean merge reports nothing its parents brought", () => {
  const r = tempRepo()
  try {
    r.git("checkout", "-qb", "side")
    r.write("side.ts", `// from ${COMPETITOR}\n`); r.git("add", "-A"); r.git("commit", "-qm", "side")
    const side = r.git("rev-parse", "HEAD").trim()
    r.git("checkout", "-q", "main")
    r.write("main.ts", "// main\n"); r.git("add", "-A"); r.git("commit", "-qm", "main")
    r.git("merge", "-q", "--no-edit", "side")
    // Only the side commit carries the line; the merge itself wrote nothing.
    assert.deepEqual(scanRange(`${r.base}..HEAD`, r.dir).map((v) => v.sha), [side])
    // Published side (as after a dev→main promotion): the merge adds nothing new.
    assert.deepEqual(scanRange(["HEAD", "--not", side, r.base], r.dir), [])
  } finally {
    r.done()
  }
})

test("an internal planning doc added and later deleted is still a finding", () => {
  const r = tempRepo()
  try {
    r.write("docs/superpowers/plans/x.md", "")  // empty: no added line, still a path
    r.write("specs/y.md", "# plan\n")
    r.git("add", "-A"); r.git("commit", "-qm", "plans")
    const adding = r.git("rev-parse", "HEAD").trim()
    r.git("rm", "-qr", "docs/superpowers", "specs"); r.git("commit", "-qm", "move them out")

    const violations = scanRange(`${r.base}..HEAD`, r.dir)
    assert.deepEqual(
      violations.map((v) => [v.sha, v.ruleId, v.file]).sort(),
      [
        [adding, "internal-planning-doc", "docs/superpowers/plans/x.md"],
        [adding, "internal-planning-doc", "specs/y.md"],
      ],
    )
    // docs/design/ is the public home, and a nested specs/ is not the root one.
    assert.deepEqual(writtenPathsFromPatch("+++ b/docs/design/x.md\n+++ /dev/null"), ["docs/design/x.md"])
  } finally {
    r.done()
  }
})

test("INTERNAL_DOC_DIRS is the same list scripts/check-internal-docs.sh checks", () => {
  const script = readFileSync(join(REPO_ROOT, "scripts/check-internal-docs.sh"), "utf8")
  const m = script.match(/^INTERNAL_DOC_DIRS=\(([^)]*)\)/m)
  assert.ok(m, "scripts/check-internal-docs.sh defines INTERNAL_DOC_DIRS=(...)")
  // The script may spell a directory as a quoted glob (`"a/[b]c/*"`): same match.
  const dirs = m[1].trim().split(/\s+/).map((d) => d.replace(/"/g, "").replace(/\[(.)\]/g, "$1").replace(/\*$/, ""))
  assert.deepEqual(dirs, INTERNAL_DOC_DIRS)
})

test("the private lists: names the commit and file, never the matched text", () => {
  // Fake list entries — the real lists are secrets, never in this repo.
  const markers = ["zz-fake-marker-one"]
  const symbols = ["zzFakeSymbol[0-9]+"]
  const checks = ["markers", "symbols"]
  const commits = [
    { sha: "m1", subject: "a", message: "a\n", patch: patch("backend/src/a.ts", ["// see ZZ-FAKE-MARKER-ONE here"]) },
    { sha: "m2", subject: "b", message: "b\n\nmentions zz-fake-marker-one\n", patch: "" },
    { sha: "s1", subject: "c", message: "c\n", patch: patch("backend/src/b.ts", ["zzFakeSymbol42()"]) },
    { sha: "s2", subject: "d", message: "d\n", patch: patch("tools/check-x.mjs", ["zzFakeSymbol42"]) },
  ]
  const violations = findHistoryViolations(commits, { checks, markers, symbols })
  assert.deepEqual(
    violations.map((v) => [v.sha, v.ruleId, v.file]),
    [
      ["m1", "private-marker", "backend/src/a.ts"],
      ["m2", "private-marker", MESSAGE],
      ["s1", "private-symbol", "backend/src/b.ts"],
      // s2: tools/ is out of the symbol gate's scope, as in check-private-leaks.
    ],
  )
  for (const v of violations) assert.equal(v.text, "", "a private-list hit never carries the line")
  // Without a list, those checks find nothing (the CLI decides skip vs. fail).
  assert.deepEqual(findHistoryViolations(commits, { checks }), [])
})

test("a pin publishes exactly the finding it names", () => {
  const r = tempRepo()
  try {
    r.write("a.ts", `// after ${COMPETITOR}\n`); r.git("add", "-A"); r.git("commit", "-qm", "borrow")
    const sha = r.git("rev-parse", "HEAD").trim()
    r.git("commit", "-q", "--allow-empty", "-m", "msg", "-m", `${COMPETITOR} again`)
    const msgSha = r.git("rev-parse", "HEAD").trim()
    assert.equal(scanRange(`${r.base}..HEAD`, r.dir).length, 2)

    r.write(PINS_FILE, `# reviewed\n${sha} competitor-citation a.ts   # decided it may go public\n`)
    assert.deepEqual(scanRange(`${r.base}..HEAD`, r.dir).map((v) => v.sha), [msgSha])

    // A pin names one rule on one path: another rule or path is not covered.
    r.write(PINS_FILE, `${sha} competitor-citation b.ts\n${msgSha} personal-identity ${MESSAGE}\n`)
    assert.equal(scanRange(`${r.base}..HEAD`, r.dir).length, 2)
  } finally {
    r.done()
  }
})

test("the CLI hard-fails a required check it cannot run, and skips an optional one", () => {
  const cli = join(REPO_ROOT, "tools/check-history-surface.mjs")
  const env = { ...process.env, HISTORY_CHECKS: "markers", PRIVATE_LEAK_MARKERS: "" }
  const r = tempRepo()
  try {
    const run = (extra) => {
      try {
        execFileSync("node", [cli, `${r.base}..HEAD`], { cwd: r.dir, env: { ...env, ...extra }, stdio: "pipe" })
        return 0
      } catch (e) {
        return e.status
      }
    }
    assert.equal(run({}), 0)
    assert.equal(run({ MIRROR_REQUIRE_MARKERS: "1" }), 1)
  } finally {
    r.done()
  }
})
