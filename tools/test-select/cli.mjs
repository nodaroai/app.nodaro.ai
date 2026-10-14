#!/usr/bin/env node
// tools/test-select/cli.mjs
// CI:    GH_TOKEN=… node tools/test-select/cli.mjs --project frontend --pr 123 --repo o/r --list sel.txt --summary "$GITHUB_STEP_SUMMARY" --github-output "$GITHUB_OUTPUT"
// Local: node tools/test-select/cli.mjs --project backend --run        (diff against origin/dev + working tree)
// --shadow (PRs into dev until TEST_SELECT_ENFORCE=true): the same selection,
// reported only — the output says selection=shadow (the full suite runs) and
// shadow_selection=<affected|none|full> for the miss check; the list, JSON and
// summary are still what the selector WOULD run. With --run it runs what CI
// runs in shadow mode: the full suite, whatever the selection.
import { execFileSync } from "node:child_process"
import { appendFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { parseArgs } from "node:util"
import { fetchPrChanges, mergeChanges, parseNameStatus } from "./changes.mjs"
import { runSelection } from "./engine.mjs"
import { renderSummary } from "./summary.mjs"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const { values: o } = parseArgs({ options: {
  project: { type: "string" }, pr: { type: "string" }, repo: { type: "string" }, base: { type: "string" },
  list: { type: "string" }, json: { type: "string" }, summary: { type: "string" },
  "github-output": { type: "string" }, run: { type: "boolean" }, shadow: { type: "boolean" },
  // the test graph this run built, for the pass cache's plan (pass-cache-cli.mjs --graph)
  "graph-out": { type: "string" },
  // CI on a pull request: the change is the checked-out merge commit against
  // its first parent — fixed by the run's SHA, so every shard selects from the
  // same diff even if the PR moves while the shards start (the files API
  // answers for whatever the PR is NOW).
  "merge-commit": { type: "boolean" },
} })
if (!["frontend", "backend"].includes(o.project)) {
  process.stderr.write("--project must be frontend or backend\n")
  process.exit(2)
}

const big = { encoding: "utf8", maxBuffer: 64 << 20 }
async function readChanges() {
  if (o["merge-commit"]) {
    const git = (...args) => execFileSync("git", ["-C", repoRoot, ...args], big)
    const parents = git("rev-list", "--parents", "-n", "1", "HEAD").trim().split(" ").slice(1)
    if (parents.length !== 2) throw new Error(`--merge-commit: HEAD has ${parents.length} parent(s), not a pull-request merge commit`)
    return parseNameStatus(git("diff", "--name-status", "--no-renames", "HEAD^1", "HEAD"))
  }
  if (o.pr) {
    return fetchPrChanges({ repo: o.repo, pr: o.pr, token: process.env.GH_TOKEN || process.env.GITHUB_TOKEN })
  }
  const git = (...args) => execFileSync("git", ["-C", repoRoot, ...args], big)
  const base = o.base ?? "origin/dev"
  return mergeChanges([
    ...parseNameStatus(git("diff", "--name-status", "--no-renames", `${base}...HEAD`)),
    ...parseNameStatus(git("diff", "--name-status", "--no-renames", "HEAD")),
    ...git("ls-files", "--others", "--exclude-standard").split("\n").filter(Boolean).map((p) => ({ status: "A", path: p })),
  ])
}

const result = await runSelection({
  project: o.project,
  readChanges,
  loadGraph: async () => {
    const tests = await (await import("./graph.mjs")).buildTestGraph(repoRoot, o.project)
    if (o["graph-out"]) writeFileSync(o["graph-out"], JSON.stringify(tests))
    return tests
  },
  loadPackageChunks: async () => (await import("./package-chunks.mjs")).loadPackageChunks(repoRoot),
})
const projectRelative = result.files.map((f) => path.posix.relative(o.project, f.file))
if (o.list) writeFileSync(o.list, projectRelative.map((f) => `${f}\n`).join(""))
if (o.json) writeFileSync(o.json, `${JSON.stringify(result, null, 1)}\n`)
if (o.summary) appendFileSync(o.summary, renderSummary(o.project, result, { shadow: Boolean(o.shadow) }))
if (o["github-output"]) {
  appendFileSync(o["github-output"], o.shadow ? `selection=shadow\nshadow_selection=${result.mode}\n` : `selection=${result.mode}\n`)
}
process.stdout.write(`${o.project}: ${o.shadow ? `shadow (would run: ${result.mode})` : result.mode} — ${result.reason}\n`)

if (o.run && (o.shadow || result.mode !== "none")) {
  try {
    execFileSync("npx", ["vitest", "run", ...(result.mode === "affected" && !o.shadow ? projectRelative : [])],
      { cwd: path.join(repoRoot, o.project), stdio: "inherit" })
  } catch {
    process.exitCode = 1
  }
}
