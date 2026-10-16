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
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { parseArgs } from "node:util"
import { fetchPrChanges, isVersionOnlyChange, mergeChanges, parseNameStatus } from "./changes.mjs"
import { LOCALE_DICT, changedKeys, keyUsage } from "./i18n-keys.mjs"
import { affectedNames } from "./package-symbols.mjs"
import { createRequire } from "node:module"
import { AGGREGATE_FILE, memberLineTypes, registryRuleMode, sideEffectsOf, unitOf } from "./registry.mjs"
import { parseRegistryAnnotations } from "./annotations.mjs"
import { runSelection } from "./engine.mjs"
import { renderSummary } from "./summary.mjs"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const { values: o } = parseArgs({ options: {
  project: { type: "string" }, pr: { type: "string" }, repo: { type: "string" }, base: { type: "string" },
  list: { type: "string" }, json: { type: "string" }, summary: { type: "string" },
  "github-output": { type: "string" }, run: { type: "boolean" }, shadow: { type: "boolean" },
  // the registry rule's narrowed selection (registry.mjs), project-relative —
  // what TEST_SELECT_REGISTRY_RULE=enforce would run; checked against the
  // failures as "Registry-rule miss" (shadow-check.mjs)
  "registry-list": { type: "string" },
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
// Locale dict edits: which tests can see the changed keys (i18n-keys.mjs).
// Any doubt leaves the change as it was — today's rule.
function markI18nKeys(changes, before, after) {
  const dicts = changes.filter((c) => c.status === "M" && LOCALE_DICT.test(c.path))
  if (dicts.length === 0) return changes
  const show = (rev, p) => { try { return execFileSync("git", ["-C", repoRoot, "show", `${rev}:${p}`], big) } catch { return null } }
  let files = null
  const sources = () => {
    files ??= execFileSync("git", ["-C", repoRoot, "ls-files", "frontend/src"], big).split("\n")
      .filter((p) => /\.(?:ts|tsx|js|jsx|mjs)$/.test(p))
      .map((p) => { try { return { path: p, source: readFileSync(path.join(repoRoot, p), "utf8") } } catch { return null } })
      .filter(Boolean)
    return files
  }
  return changes.map((c) => {
    if (!dicts.includes(c)) return c
    const keys = changedKeys(show(before, c.path), show(after, c.path))
    if (!keys) return c
    const usage = keyUsage(keys, sources())
    if (!usage.users) { process.stderr.write(`${c.path}: key-level selection off — ${usage.unsafe}\n`); return c }
    return { ...c, i18nKeys: keys, i18nUsers: [...usage.users].sort() }
  })
}

// @nodaro/shared source edits: the exported names they can reach
// (package-symbols.mjs). Any doubt leaves the change as it was.
function markSharedNames(changes) {
  const src = changes.filter((c) => c.path.startsWith("packages/shared/src/") && !/\/__tests__\//.test(c.path))
  if (src.length === 0 || src.some((c) => c.status === "D" || !c.path.endsWith(".ts"))) return changes
  let names = null
  try {
    const files = execFileSync("git", ["-C", repoRoot, "ls-files", "packages/shared/src"], big).split("\n")
      .filter((p) => p.endsWith(".ts") && !p.includes("/__tests__/"))
      .map((p) => ({ path: p, source: readFileSync(path.join(repoRoot, p), "utf8") }))
    names = affectedNames(files, src.map((c) => c.path))
  } catch { names = null }
  if (!names) return changes
  const list = [...names].sort()
  return changes.map((c) => (src.includes(c) ? { ...c, sharedNames: list } : c))
}

// Registry rule inputs (registry.mjs), only once the tree has node units
// (frontend/src/nodes/). A changed module INSIDE a unit folder is marked
// `sideEffects: false` only when it passes G7's own AST check
// (tools/units/structure.mjs sideEffectProblems — declarations, functions and
// pure constructors only). Unmarked = unknown, which never narrows: no
// TypeScript to parse with, an unreadable file, or any module outside a unit
// (the engine never narrows those). The checkout IS the change's result
// (--merge-commit checks out the merge commit), so it is read from disk. With
// a `before` revision, an aggregate diff made only of `// unit:<type>` lines is
// marked with those types and its registry id.
function markRegistry(changes, before) {
  if (!existsSync(path.join(repoRoot, "frontend/src/nodes"))) return changes
  const show = (rev, p) => { try { return execFileSync("git", ["-C", repoRoot, "show", `${rev}:${p}`], big) } catch { return null } }
  const now = (p) => { try { return readFileSync(path.join(repoRoot, p), "utf8") } catch { return null } }
  let ts
  const typescript = () => {
    if (ts === undefined) { try { ts = createRequire(path.join(repoRoot, "package.json"))("typescript") } catch { ts = null } }
    return ts
  }
  return changes.map((c) => {
    if (c.status === "D" || !/\.[cm]?[jt]sx?$/.test(c.path)) return c
    let out = c
    if (unitOf(c.path)) {
      const sideEffects = sideEffectsOf(typescript(), c.path, now(c.path))
      if (sideEffects !== undefined) out = { ...c, sideEffects }
    }
    if (!before || c.status !== "M" || !AGGREGATE_FILE.test(c.path)) return out
    const text = now(c.path)
    if (text === null) return out
    const units = memberLineTypes(show(before, c.path), text)
    const registry = parseRegistryAnnotations(text).exports[0]?.aggregate
    return units && registry ? { ...out, registryUnits: units, registry } : out
  })
}

// Manifests whose diff is only a version bump: no global trigger (select.mjs).
function markVersionOnly(changes, before, after) {
  const show = (rev, p) => { try { return execFileSync("git", ["-C", repoRoot, "show", `${rev}:${p}`], big) } catch { return null } }
  return changes.map((c) => (c.status === "M" && /(?:^|\/)package(?:-lock)?\.json$/.test(c.path)
    && isVersionOnlyChange(c.path, show(before, c.path), show(after, c.path)) ? { ...c, versionOnly: true } : c))
}

async function readChanges() {
  if (o["merge-commit"]) {
    const git = (...args) => execFileSync("git", ["-C", repoRoot, ...args], big)
    const parents = git("rev-list", "--parents", "-n", "1", "HEAD").trim().split(" ").slice(1)
    if (parents.length !== 2) throw new Error(`--merge-commit: HEAD has ${parents.length} parent(s), not a pull-request merge commit`)
    return markRegistry(markI18nKeys(markSharedNames(markVersionOnly(parseNameStatus(git("diff", "--name-status", "--no-renames", "HEAD^1", "HEAD")), "HEAD^1", "HEAD")), "HEAD^1", "HEAD"), "HEAD^1")
  }
  if (o.pr) {
    return fetchPrChanges({ repo: o.repo, pr: o.pr, token: process.env.GH_TOKEN || process.env.GITHUB_TOKEN })
  }
  const git = (...args) => execFileSync("git", ["-C", repoRoot, ...args], big)
  const base = o.base ?? "origin/dev"
  return markRegistry(mergeChanges([
    ...parseNameStatus(git("diff", "--name-status", "--no-renames", `${base}...HEAD`)),
    ...parseNameStatus(git("diff", "--name-status", "--no-renames", "HEAD")),
    ...git("ls-files", "--others", "--exclude-standard").split("\n").filter(Boolean).map((p) => ({ status: "A", path: p })),
  ]))
}

// Its own shadow period (decided 2026-10-16): narrowed selection only when the
// repository variable is exactly `enforce`.
const registryRule = registryRuleMode(process.env.TEST_SELECT_REGISTRY_RULE)
const result = await runSelection({
  project: o.project,
  registryRule,
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
const registrySelection = result.registryRule?.selection ?? { mode: result.mode, files: result.files }
if (o["registry-list"]) writeFileSync(o["registry-list"], registrySelection.files.map((f) => `${path.posix.relative(o.project, f.file)}\n`).join(""))
if (o.json) writeFileSync(o.json, `${JSON.stringify(result, null, 1)}\n`)
if (o.summary) appendFileSync(o.summary, renderSummary(o.project, result, { shadow: Boolean(o.shadow) }))
if (o["github-output"]) {
  appendFileSync(o["github-output"], `${o.shadow ? `selection=shadow\nshadow_selection=${result.mode}\n` : `selection=${result.mode}\n`}registry_rule=${registryRule}\nregistry_selection=${registrySelection.mode}\n`)
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
