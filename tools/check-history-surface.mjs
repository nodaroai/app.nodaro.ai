#!/usr/bin/env node
// The never-public checks, applied to COMMITS instead of the tip.
//
// Why this exists: check-public-surface reads the TRACKED TREE, and so does
// every other leak gate (the marker gate greps `git ls-files`, the pricing and
// EE checks walk directories). But a merge publishes a BRANCH, not a tree: the
// mirror pushes full history to the public remote, and this repo merges feature
// branches with a regular merge, so every feature commit lands in public
// history. A line one commit adds and a later commit scrubs is then
// world-readable forever through `git log -p` / `git log -S`, with every
// tree-scanning gate green — and public history can never be re-scrubbed.
//
// So this gate reads every commit in a range that is not yet published — the
// lines it ADDS, the paths it writes, and its MESSAGE (published verbatim, like
// the PR title the squash commit takes) — against the same lists the tree
// gates use (imported or loaded the same way, never copied). It runs at the two
// moments a fix is still possible:
//   - pre-merge (CI, `origin/$BASE..HEAD`) — a rebase or a reword costs nothing;
//   - pre-publish (scripts/publish-to-public.sh, `$BRANCH --not <public heads>`)
//     — the last point before the push is irrevocable.
//
// Checks (HISTORY_CHECKS=<comma list> picks some; default: all):
//   surface        the check-public-surface categories, on added lines + messages
//   internal-docs  a path under specs/ or docs/superpowers/ (scripts/check-internal-docs.sh)
//   markers        the private marker list (scripts/check-private-markers.sh), any path
//   symbols        the private symbol list (tools/check-private-leaks.mjs), outside tools/
//   secrets        gitleaks over the messages (`gitleaks detect` reads only the diffs)
// The two lists come from the same secrets / untracked files as their tree
// gates, and their VALUES are never printed (a hit names the commit and file).
// A check whose input is missing is skipped with a note, or fails when the
// matching *_REQUIRE_* variable is 1 — the publish path sets all three.
//
// Scope notes, deliberately:
//   - A merge commit is read through `--remerge-diff`: only what its conflict
//     resolution wrote, never what either parent brought (a first-parent diff
//     of a dev→main merge is all of dev, which public/dev already carries).
//   - per-line only, no de-wrapping: hunks are not contiguous prose, so the
//     wrapped-phrase view the tree gate takes has no meaning across a diff.
//
// A finding on a commit that is already merged cannot be rebased away. Pin it
// in .github/mirror-history-pins.txt — `<sha> <rule> <file | :message>` — to
// publish it anyway; the pin is reviewed on the PR that adds it.
//
// Run locally: node tools/check-history-surface.mjs [<rev-list args>]
//   e.g. `origin/dev..HEAD`, or `dev --not <public-main> <public-dev>` — the
//   publish path needs the second shape because "already published" is the
//   union of BOTH public heads: after a dev→main promotion, main..public/main
//   is full of commits the world already read on public/dev, and re-flagging
//   them would abort the mirror with no fix left.
//   (no argument: `origin/$GITHUB_BASE_REF..HEAD` in CI, else `origin/dev..HEAD`)
//   PR_TITLE, when set, is read as one more message, and so is PR_BODY (the
//   PR description). The description never enters git (the squash commit takes
//   the commit messages, the release merge takes the title), but it is what
//   the what's-new and social posts are written from, so it is held to the
//   same lists. Editing either clears its finding; no pin can name them.

import { execFileSync } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { ruleTrippedByLine, scannablePath, RULES } from "./check-public-surface.mjs"

/** Refuse an unexpectedly huge range rather than hang a CI job on it. */
const MAX_COMMITS = 2000

/** The `file` of a finding in a commit message (or the PR title). */
export const MESSAGE = ":message"
/** The `sha` of a finding in the PR title, which no pin can name. */
export const PR_TITLE_SHA = "PR-title"
/** The `sha` of a finding in the PR description, which no pin can name either. */
export const PR_BODY_SHA = "PR-description"
/** Never tracked in this repo; scripts/check-internal-docs.sh holds the same list. */
export const INTERNAL_DOC_DIRS = ["specs/", "docs/superpowers/"]
export const CHECKS = ["surface", "internal-docs", "markers", "symbols", "secrets"]
export const PINS_FILE = ".github/mirror-history-pins.txt"

function git(args, cwd) {
  return execFileSync("git", ["-c", "core.quotePath=false", ...args], {
    cwd,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  })
}

/**
 * The lines a patch ADDS, with the file each belongs to.
 * @param {string} patch  unified diff text (`git show -U0`, or `--remerge-diff`)
 * @returns {{path: string, text: string}[]}
 */
export function addedLinesFromPatch(patch) {
  const added = []
  let path = null
  for (const line of patch.split("\n")) {
    if (line.startsWith("diff --git ")) {
      path = null // until the +++ header names the post-image path
      continue
    }
    if (line.startsWith("+++ ")) {
      const target = line.slice(4).trim()
      path = target === "/dev/null" ? null : target.replace(/^b\//, "")
      continue
    }
    if (line.startsWith("--- ") || line.startsWith("@@")) continue
    if (path && line.startsWith("+")) added.push({ path, text: line.slice(1) })
  }
  return added
}

/**
 * Every path a patch writes (added or changed; a deletion writes nothing) —
 * including an empty file, which adds no line.
 * @param {string} patch
 * @returns {string[]}
 */
export function writtenPathsFromPatch(patch) {
  const paths = []
  for (const line of patch.split("\n")) {
    if (!line.startsWith("+++ ")) continue
    const target = line.slice(4).trim()
    if (target !== "/dev/null") paths.push(target.replace(/^b\//, ""))
  }
  return paths
}

/**
 * @typedef {{sha: string, subject: string, message?: string, patch: string, paths?: string[]}} Commit
 *   `paths`: every path the commit writes, from git (a diff gives an empty new
 *   file no `+++` header); without it, the paths are read from the patch.
 * @typedef {{sha: string, subject: string, file: string, text: string, ruleId: string, why: string}} HistoryViolation
 * @typedef {{checks?: Iterable<string>, markers?: string[], symbols?: string[]}} ScanOptions
 */

/** Same matching as `git grep -E` in tools/check-private-leaks.mjs: one alternation. */
function symbolPattern(symbols) {
  return symbols.length > 0 ? new RegExp(symbols.join("|")) : null
}

/**
 * Every never-public line, path or message ANY commit in the range added —
 * whether or not a later commit removed it again.
 * @param {Commit[]} commits
 * @param {ScanOptions} [options]  default: the surface + internal-docs checks
 * @returns {HistoryViolation[]}
 */
export function findHistoryViolations(commits, options = {}) {
  const checks = new Set(options.checks ?? ["surface", "internal-docs"])
  const markers = (options.markers ?? []).map((m) => m.toLowerCase())
  const symbols = symbolPattern(options.symbols ?? [])
  const violations = []
  for (const commit of commits) {
    const found = (file, text, ruleId, why) =>
      violations.push({ sha: commit.sha, subject: commit.subject, file, text, ruleId, why })
    const lines = addedLinesFromPatch(commit.patch)
    const messageLines = (commit.message ?? "").split("\n")

    if (checks.has("surface")) {
      for (const { path, text } of lines) {
        if (!scannablePath(path)) continue
        const rule = ruleTrippedByLine(path, text)
        if (rule) found(path, text.trim().slice(0, 160), rule.id, rule.why)
      }
      for (const text of messageLines) {
        const rule = ruleTrippedByLine(MESSAGE, text)
        if (rule) found(MESSAGE, text.trim().slice(0, 160), rule.id, rule.why)
      }
    }
    if (checks.has("internal-docs")) {
      for (const path of new Set(commit.paths ?? writtenPathsFromPatch(commit.patch))) {
        if (!INTERNAL_DOC_DIRS.some((d) => path.startsWith(d))) continue
        found(path, "", "internal-planning-doc", "internal specs and plans live in the private planning repo, never here")
      }
    }
    // The two private lists: report the commit and file only, never the line.
    if (checks.has("markers") && markers.length > 0) {
      const hit = (text) => {
        const lower = text.toLowerCase()
        const i = markers.findIndex((m) => lower.includes(m))
        return i < 0 ? 0 : i + 1
      }
      const seen = new Set()
      for (const { path, text } of [...lines, ...messageLines.map((text) => ({ path: MESSAGE, text }))]) {
        const n = hit(text)
        if (!n || seen.has(`${path} ${n}`)) continue
        seen.add(`${path} ${n}`)
        found(path, "", "private-marker", `private marker #${n}`)
      }
    }
    if (checks.has("symbols") && symbols) {
      const seen = new Set()
      for (const { path, text } of [...lines, ...messageLines.map((text) => ({ path: MESSAGE, text }))]) {
        if (path.startsWith("tools/") || seen.has(path) || !symbols.test(text)) continue
        seen.add(path)
        found(path, "", "private-symbol", "a private-extraction symbol")
      }
    }
  }
  return violations
}

/**
 * gitleaks over the commit messages, as one stream: `gitleaks detect` reads
 * each commit's diff and never its message. Each finding is mapped back to its
 * commit by line number.
 * @param {Commit[]} commits
 * @param {{gitleaks?: string, config?: string}} [options]
 * @returns {HistoryViolation[]}
 */
export function findMessageSecrets(commits, options = {}) {
  const owner = []
  const text = []
  for (const commit of commits) {
    for (const line of (commit.message ?? "").split("\n")) {
      owner.push(commit)
      text.push(line)
    }
  }
  if (text.length === 0) return []
  const dir = mkdtempSync(join(tmpdir(), "history-secrets-"))
  try {
    const report = join(dir, "report.json")
    const args = ["stdin", "--no-banner", "--redact", "-f", "json", "-r", report, "--exit-code", "0"]
    if (options.config && existsSync(options.config)) args.push("-c", options.config)
    execFileSync(options.gitleaks ?? "gitleaks", args, { input: text.join("\n"), stdio: ["pipe", "ignore", "pipe"] })
    const findings = JSON.parse(readFileSync(report, "utf8") || "[]")
    return findings.map((f) => {
      const commit = owner[f.StartLine - 1] ?? { sha: "?", subject: "" }
      return {
        sha: commit.sha,
        subject: commit.subject,
        file: MESSAGE,
        text: "",
        ruleId: `gitleaks:${f.RuleID}`,
        why: "a secret in a commit message (gitleaks)",
      }
    })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/**
 * The commits a rev-list selection names, newest first, merges included. A
 * merge's patch is its `--remerge-diff`: what its conflict resolution wrote.
 * @param {string | string[]} revs  one range, or full rev-list arguments
 * @returns {Commit[]}
 */
export function readCommits(revs, cwd) {
  const args = Array.isArray(revs) ? revs : [revs]
  const rows = git(["rev-list", "--parents", ...args], cwd).split("\n").filter(Boolean)
  if (rows.length > MAX_COMMITS) {
    throw new Error(`[check-history-surface] range ceiling ${MAX_COMMITS} exceeded (${rows.length} commits in ${args.join(" ")})`)
  }
  return rows.map((row) => {
    const [sha, ...parents] = row.split(" ")
    const message = git(["show", "--no-patch", "--format=%B", sha], cwd)
    const diff = parents.length > 1 ? ["--remerge-diff"] : []
    const show = ["show", ...diff, "--format=", "--no-color", "--no-renames"]
    return {
      sha,
      subject: message.split("\n")[0],
      message,
      patch: git([...show, "-U0", sha], cwd),
      // Added, modified or type-changed; a deletion writes nothing.
      paths: git([...show, "--name-only", "--diff-filter=AMT", sha], cwd).split("\n").filter(Boolean),
    }
  })
}

/**
 * Reviewed exceptions: `<sha> <rule> <file | :message>` per line, `#` comments.
 * @returns {Set<string>}
 */
export function loadPins(cwd) {
  const file = join(cwd, PINS_FILE)
  if (!existsSync(file)) return new Set()
  const pins = new Set()
  for (const raw of readFileSync(file, "utf8").split("\n")) {
    const [sha, rule, path] = raw.replace(/#.*/, "").trim().split(/\s+/)
    if (sha && rule && path) pins.add(`${sha} ${rule} ${path}`)
  }
  return pins
}

export const pinKey = (v) => `${v.sha} ${v.ruleId} ${v.file}`

/**
 * @param {string | string[]} revs  one range, or full rev-list arguments
 * @param {ScanOptions & {title?: string, body?: string, gitleaks?: string}} [options]
 * @returns {HistoryViolation[]}  unpinned findings only
 */
export function scanRange(revs, cwd, options = {}) {
  const checks = new Set(options.checks ?? ["surface", "internal-docs"])
  const commits = readCommits(revs, cwd)
  if (options.title) commits.push({ sha: PR_TITLE_SHA, subject: options.title, message: options.title, patch: "" })
  // GitHub stores a description typed in the browser with CRLF line ends.
  const body = options.body?.replace(/\r\n?/g, "\n").trim()
  if (body) commits.push({ sha: PR_BODY_SHA, subject: body.split("\n")[0], message: body, patch: "" })
  const violations = findHistoryViolations(commits, options)
  if (checks.has("secrets")) {
    violations.push(...findMessageSecrets(commits, { gitleaks: options.gitleaks, config: join(cwd, ".gitleaks.toml") }))
  }
  const pins = loadPins(cwd)
  return violations.filter((v) => !pins.has(pinKey(v)))
}

function readList(envName, file) {
  const raw = process.env[envName]?.trim() ? process.env[envName] : existsSync(file) ? readFileSync(file, "utf8") : ""
  return raw.split("\n").map((l) => l.trim()).filter(Boolean)
}

function hasGitleaks() {
  try {
    execFileSync("gitleaks", ["version"], { stdio: "ignore" })
    return true
  } catch {
    return false
  }
}

/**
 * Which checks can run here, from HISTORY_CHECKS and what this machine has.
 * @returns {{options: ScanOptions, notes: string[], missing: string[]}}
 */
function resolveOptions(env = process.env) {
  const wanted = env.HISTORY_CHECKS?.trim()
    ? env.HISTORY_CHECKS.split(",").map((c) => c.trim()).filter(Boolean)
    : CHECKS
  const unknown = wanted.filter((c) => !CHECKS.includes(c))
  if (unknown.length > 0) throw new Error(`[check-history-surface] unknown HISTORY_CHECKS: ${unknown.join(", ")}`)
  const checks = new Set(wanted)
  const notes = []
  const missing = []
  const markers = readList("PRIVATE_LEAK_MARKERS", ".leak-markers")
  const symbols = readList("PRIVATE_LEAK_SYMBOLS", ".leak-symbols")
  const inputs = [
    ["markers", markers.length > 0, "MIRROR_REQUIRE_MARKERS", "no marker list (PRIVATE_LEAK_MARKERS or .leak-markers)"],
    ["symbols", symbols.length > 0, "PRIVATE_LEAK_REQUIRE_SYMBOLS", "no symbol list (PRIVATE_LEAK_SYMBOLS or .leak-symbols)"],
    ["secrets", checks.has("secrets") && hasGitleaks(), "HISTORY_REQUIRE_GITLEAKS", "gitleaks is not installed"],
  ]
  for (const [check, available, requireVar, why] of inputs) {
    if (!checks.has(check) || available) continue
    checks.delete(check)
    if (env[requireVar] === "1") missing.push(`${check}: ${why}, and ${requireVar}=1`)
    else notes.push(`${check} skipped — ${why}`)
  }
  return { options: { checks, markers, symbols }, notes, missing }
}

/** @returns {string[] | null} */
function resolveRevs() {
  const args = process.argv.slice(2)
  if (args.length > 0) return args
  const base = process.env.GITHUB_BASE_REF
  if (base) return [`origin/${base}..HEAD`]
  try {
    git(["rev-parse", "--verify", "--quiet", "origin/dev"], process.cwd())
    return ["origin/dev..HEAD"]
  } catch {
    return null
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { options, notes, missing } = resolveOptions()
  for (const note of notes) console.log(`[check-history-surface] ${note}`)
  if (missing.length > 0) {
    for (const m of missing) console.error(`[check-history-surface] REQUIRED check cannot run — ${m}`)
    process.exit(1)
  }
  const revs = resolveRevs()
  if (!revs) {
    // No base to compare against (a shallow clone, a fork with no origin/dev).
    // Say so loudly and pass: the tree gate still ran, and a skipped JOB would
    // break every `needs:` chain that lists this one.
    console.log("[check-history-surface] no base ref to compare against — skipped (pass a range explicitly)")
    process.exit(0)
  }
  const selection = revs.join(" ")
  const title = process.env.PR_TITLE?.trim() || undefined
  const body = process.env.PR_BODY?.trim() || undefined
  const violations = scanRange(revs, process.cwd(), { ...options, title, body })
  const ran = [...options.checks].join(", ")
  const pr = [title && "title", body && "description"].filter(Boolean).join(" and ")
  const plus = pr ? ` + the PR ${pr}` : ""
  if (violations.length > 0) {
    console.error(`History check FAILED — ${violations.length} never-public finding(s) in ${selection}${plus}:\n`)
    const byRule = new Map()
    for (const v of violations) {
      if (!byRule.has(v.ruleId)) byRule.set(v.ruleId, [])
      byRule.get(v.ruleId).push(v)
    }
    for (const [id, list] of byRule) {
      console.error(`  [${id}] ${list[0].why}`)
      for (const v of list) {
        console.error(`    ${v.sha} ${v.file}${v.ruleId === "private-marker" ? ` (${v.why})` : ""}`)
        if (v.text) console.error(`      ${v.text}`)
      }
      console.error("")
    }
    console.error("Scrubbing the tip is not enough: the mirror publishes these COMMITS, their")
    console.error("messages included, where `git log -p` reads them and history can never be")
    console.error("re-scrubbed. Before merge: rewrite the branch so no commit ever carried it")
    console.error("(rebase + amend or reword, then force-with-lease the feature branch). A")
    console.error(`${PR_TITLE_SHA} or ${PR_BODY_SHA} finding needs only an edit of the PR title or`)
    console.error("description; the edit re-runs this check. Already merged: decide it may go")
    console.error(`public, then pin each line above in ${PINS_FILE} as \`<full sha> <rule> <file>\``)
    console.error("on a reviewed PR.")
    process.exit(1)
  }
  console.log(`History check passed — ${ran} (${RULES.length} surface categories) over ${selection}${plus}`)
}
