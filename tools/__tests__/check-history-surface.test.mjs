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
import { mkdtempSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  addedLinesFromPatch,
  findHistoryViolations,
  scanRange,
} from "../check-history-surface.mjs"

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
