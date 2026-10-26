// tools/__tests__/test-select-bisect-dev.test.mjs
// One post-merge dev run can cover several merges; when it fails,
// dev-failure-bisect.yml re-runs the files that failed again at merges inside
// the batch to name the merge that broke them.
import { test } from "node:test"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { bisect, bisectComment, planBisect, presentFiles } from "../test-select/bisect-dev.mjs"

test("bisect finds the first failing commit with log2 probes, never re-probing the known-failing last one", () => {
  const commits = ["c1", "c2", "c3", "c4", "c5", "c6", "c7", "c8"]
  for (let broken = 0; broken < commits.length; broken++) {
    const probed = []
    const { culprit, probes } = bisect(commits, (sha) => {
      probed.push(sha)
      return commits.indexOf(sha) >= broken ? "fail" : "pass"
    })
    assert.equal(culprit, commits[broken], `broken at ${broken}`)
    assert.ok(probes.length <= 3, `${probes.length} probes`)
    assert.ok(!probed.includes("c8"))
  }
  assert.deepEqual(bisect(["only"], () => assert.fail("no probe for a batch of one")), { culprit: "only", probes: [] })
})

test("plan: bisect only a batch of two or more, from a green baseline, with files that failed again", () => {
  const two = { lastState: "green", merges: [{ sha: "a" }, { sha: "b" }] }
  const failed = { frontend: ["src/a.test.ts"], backend: [] }
  assert.deepEqual(planBisect(two, failed), { go: true, why: null, files: { frontend: ["src/a.test.ts"] }, commits: ["a", "b"] })
  assert.match(planBisect({ ...two, merges: [{ sha: "b" }] }, failed).why, /one merge/)
  assert.match(planBisect({ ...two, lastState: "failed" }, failed).why, /not green/)
  assert.match(planBisect({ ...two, lastState: "none" }, failed).why, /not green/)
  assert.match(planBisect(two, { frontend: [], backend: [] }).why, /no file failed again/)
})

test("a failing file that does not exist yet at a commit is not run there", () => {
  const root = mkdtempSync(path.join(tmpdir(), "bisect-present-"))
  try {
    mkdirSync(path.join(root, "frontend/src"), { recursive: true })
    writeFileSync(path.join(root, "frontend/src/a.test.ts"), "")
    assert.deepEqual(presentFiles(root, "frontend", ["src/a.test.ts", "src/new.test.ts"]), ["src/a.test.ts"])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("bisect over real commits: the merge that broke the file is named", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "bisect-repo-"))
  const git = (...args) => execFileSync("git", args, {
    cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
    env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.com", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.com" },
  }).trim()
  try {
    git("init", "-q", "-b", "dev")
    writeFileSync(path.join(dir, "value.txt"), "ok\n")
    git("add", "-A"); git("commit", "-qm", "baseline (green)")
    const merges = []
    for (const [i, value] of ["ok", "ok", "broken", "broken", "broken"].entries()) {
      writeFileSync(path.join(dir, `m${i}.txt`), `${i}\n`)
      writeFileSync(path.join(dir, "value.txt"), `${value}\n`)
      git("add", "-A"); git("commit", "-qm", `merge ${i}`)
      merges.push(git("rev-parse", "HEAD"))
    }
    const { culprit } = bisect(merges, (sha) => {
      git("checkout", "-q", "-f", sha)
      return git("show", `${sha}:value.txt`) === "broken" ? "fail" : "pass"
    })
    assert.equal(culprit, merges[2])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("the comment names the merge, the files, and every probe", () => {
  const md = bisectComment({
    culprit: "bbbbbbbbb", probes: [{ sha: "bbbbbbbbb", result: "fail" }, { sha: "aaaaaaaaa", result: "pass" }],
    merges: [{ sha: "aaaaaaaaa" }, { sha: "bbbbbbbbb" }, { sha: "ccccccccc" }],
    files: { backend: ["src/x.test.ts"] }, runUrl: "R", bisectUrl: "B",
  })
  assert.match(md, /this merge \(`bbbbbbb`\) is where these files start failing/)
  assert.match(md, /- backend: `src\/x\.test\.ts`/)
  assert.match(md, /The run covered 3 merges/)
  assert.match(md, /- `aaaaaaa`: pass\n- `ccccccc`: fail \(the run\)/)
})
