#!/usr/bin/env node
// The same never-public categories, applied to COMMITS instead of the tip.
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
// So this gate scans the ADDED lines of every commit in a range that is not yet
// published, against the SAME RULES the tree gate uses (imported, not copied —
// one category list, two scopes). It runs at the two moments a fix is still
// possible:
//   - pre-merge (CI, `origin/$BASE..HEAD`) — a rebase still costs nothing;
//   - pre-publish (scripts/publish-to-public.sh, `public/$BRANCH..$BRANCH`) —
//     the last point before the push is irrevocable.
//
// Scope notes, deliberately:
//   - `--no-merges`: a merge commit's diff is the merge itself; content it
//     introduces by conflict resolution survives in the tree, which the tree
//     gate reads.
//   - per-line only, no de-wrapping: hunks are not contiguous prose, so the
//     wrapped-phrase view the tree gate takes has no meaning across a diff.
//
// Run locally: node tools/check-history-surface.mjs [<rev-list args>]
//   e.g. `origin/dev..HEAD`, or `dev --not <public-main> <public-dev>` — the
//   publish path needs the second shape because "already published" is the
//   union of BOTH public heads: after a dev→main promotion, main..public/main
//   is full of commits the world already read on public/dev, and re-flagging
//   them would abort the mirror with no fix left.
//   (no argument: `origin/$GITHUB_BASE_REF..HEAD` in CI, else `origin/dev..HEAD`)

import { execFileSync } from "node:child_process"
import { ruleTrippedByLine, scannablePath, RULES } from "./check-public-surface.mjs"

/** Refuse an unexpectedly huge range rather than hang a CI job on it. */
const MAX_COMMITS = 2000

function git(args, cwd) {
  return execFileSync("git", ["-c", "core.quotePath=false", ...args], {
    cwd,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  })
}

/**
 * The lines a patch ADDS, with the file each belongs to.
 * @param {string} patch  unified diff text (`git show -U0`)
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
 * @typedef {{sha: string, subject: string, patch: string}} Commit
 * @typedef {{sha: string, subject: string, file: string, text: string, ruleId: string, why: string}} HistoryViolation
 */

/**
 * Every never-public line ANY commit in the range added — whether or not a
 * later commit removed it again.
 * @param {Commit[]} commits
 * @returns {HistoryViolation[]}
 */
export function findHistoryViolations(commits) {
  const violations = []
  for (const commit of commits) {
    for (const { path, text } of addedLinesFromPatch(commit.patch)) {
      if (!scannablePath(path)) continue
      const rule = ruleTrippedByLine(path, text)
      if (!rule) continue
      violations.push({
        sha: commit.sha,
        subject: commit.subject,
        file: path,
        text: text.trim().slice(0, 160),
        ruleId: rule.id,
        why: rule.why,
      })
    }
  }
  return violations
}

/**
 * Read the non-merge commits a rev-list selection names, newest first.
 * @param {string | string[]} revs  one range, or full rev-list arguments
 * @returns {Commit[]}
 */
export function readCommits(revs, cwd) {
  const args = Array.isArray(revs) ? revs : [revs]
  const shas = git(["rev-list", "--no-merges", ...args], cwd).split("\n").filter(Boolean)
  if (shas.length > MAX_COMMITS) {
    throw new Error(`[check-history-surface] range ceiling ${MAX_COMMITS} exceeded (${shas.length} commits in ${args.join(" ")})`)
  }
  return shas.map((sha) => ({
    sha,
    subject: git(["show", "--no-patch", "--format=%s", sha], cwd).trim(),
    patch: git(["show", "--format=", "--no-color", "--no-renames", "-U0", sha], cwd),
  }))
}

/**
 * @param {string | string[]} revs  one range, or full rev-list arguments
 * @returns {HistoryViolation[]}
 */
export function scanRange(revs, cwd) {
  return findHistoryViolations(readCommits(revs, cwd))
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
  const revs = resolveRevs()
  if (!revs) {
    // No base to compare against (a shallow clone, a fork with no origin/dev).
    // Say so loudly and pass: the tree gate still ran, and a skipped JOB would
    // break every `needs:` chain that lists this one.
    console.log("[check-history-surface] no base ref to compare against — skipped (pass a range explicitly)")
    process.exit(0)
  }
  const selection = revs.join(" ")
  const violations = scanRange(revs, process.cwd())
  if (violations.length > 0) {
    console.error(`History check FAILED — ${violations.length} never-public line(s) added by commits in ${selection}:\n`)
    const byRule = new Map()
    for (const v of violations) {
      if (!byRule.has(v.ruleId)) byRule.set(v.ruleId, [])
      byRule.get(v.ruleId).push(v)
    }
    for (const [id, list] of byRule) {
      console.error(`  [${id}] ${list[0].why}`)
      for (const v of list) console.error(`    ${v.sha.slice(0, 9)} ${v.file}\n      ${v.text}`)
      console.error("")
    }
    console.error("Scrubbing the tip is not enough: a regular merge publishes these COMMITS to")
    console.error("the public mirror, where `git log -p` reads them and history can never be")
    console.error("re-scrubbed. Rewrite the branch so no commit ever carried the line")
    console.error("(interactive rebase + amend, then force-with-lease the feature branch).")
    process.exit(1)
  }
  console.log(`History check passed — ${RULES.length} categories over every line added in ${selection}`)
}
