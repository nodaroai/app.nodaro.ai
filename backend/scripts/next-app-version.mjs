#!/usr/bin/env node
/**
 * Compute the next app version + release notes from conventional commits.
 *
 * Source of truth is the last `v*` git tag on the current branch — never
 * package.json (which sat at 1.23.0 for six months while 5,882 commits
 * shipped; see the versioning spec). Bump rule, derived so no human has to
 * remember:
 *   - any commit subject with a `!` before the colon, or a BREAKING CHANGE
 *     footer  -> major
 *   - else any `feat:` / `feat(scope):`                      -> minor
 *   - else (fix/docs/chore/refactor/test/perf/ci — anything) -> patch
 * Merge commits are ignored (their subjects are noise; their content is the
 * underlying commits, which are scanned).
 *
 * Modes:
 *   --json   {current, next, bump, counts, notes}
 *   --next   just the next version (for shell)
 *   --notes  just the markdown notes body
 *
 * Deterministic and side-effect free: reads git, writes stdout.
 */
import { execFileSync } from "node:child_process"

const CAP_PER_SECTION = 60
/** ASCII record separator — cannot appear in commit messages. */
const SEP = "\x1e"

function git(...args) {
  return execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).trim()
}

export function lastVersionTag() {
  try {
    return git("describe", "--tags", "--match", "v[0-9]*", "--abbrev=0")
  } catch {
    return null
  }
}

export function parseVersion(tag) {
  const m = /^v(\d+)\.(\d+)\.(\d+)$/.exec(tag)
  if (!m) throw new Error(`not a vX.Y.Z tag: ${tag}`)
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) }
}

/** One record per non-merge commit since the tag: subject + full body. */
export function commitsSince(tag) {
  const raw = git("log", `${tag}..HEAD`, "--no-merges", `--format=%s%n%b${SEP}`)
  if (!raw) return []
  return raw
    .split(SEP)
    .map((c) => c.trim())
    .filter(Boolean)
    .map((c) => {
      const nl = c.indexOf("\n")
      return { subject: nl === -1 ? c : c.slice(0, nl), body: nl === -1 ? "" : c.slice(nl + 1) }
    })
}

const CONVENTIONAL = /^(\w+)(\([^)]*\))?(!)?:\s*(.*)$/

export function classify(commits) {
  let breaking = 0
  const breakingSubjects = []
  const feats = []
  const fixes = []
  const others = []
  for (const { subject, body } of commits) {
    const m = CONVENTIONAL.exec(subject)
    const isBreaking = (m && m[3] === "!") || /(^|\n)BREAKING[ -]CHANGE/.test(body)
    if (isBreaking) {
      breaking++
      breakingSubjects.push(subject)
    }
    if (!m) {
      others.push(subject)
      continue
    }
    const [, type, , , desc] = m
    if (type === "feat") feats.push(desc)
    else if (type === "fix") fixes.push(desc)
    else others.push(subject)
  }
  return { breaking, breakingSubjects, feats, fixes, others }
}

export function nextVersion(current, { breaking, feats }) {
  if (breaking > 0) return { major: current.major + 1, minor: 0, patch: 0 }
  if (feats.length > 0) return { major: current.major, minor: current.minor + 1, patch: 0 }
  return { major: current.major, minor: current.minor, patch: current.patch + 1 }
}

function section(title, items) {
  if (!items.length) return ""
  const shown = items.slice(0, CAP_PER_SECTION)
  const more = items.length - shown.length
  return (
    `## ${title}\n\n` +
    shown.map((s) => `- ${s}`).join("\n") +
    (more > 0 ? `\n- …and ${more} more` : "") +
    "\n\n"
  )
}

export function releaseNotes(fromTag, next, cls) {
  const header =
    `Changes since ${fromTag}: ${cls.feats.length} features, ${cls.fixes.length} fixes` +
    (cls.breaking ? `, ${cls.breaking} BREAKING` : "") +
    ".\n\n"
  return (
    (header +
      (cls.breaking ? `**This is a MAJOR release — read before upgrading.**\n\n` : "") +
      section("Breaking changes", cls.breakingSubjects ?? []) +
      section("Features", cls.feats) +
      section("Fixes", cls.fixes)).trim() + "\n"
  )
}

export function compute() {
  const tag = lastVersionTag()
  if (!tag) {
    throw new Error(
      "no v* tag found — bootstrap one first (e.g. `git tag v1.23.0 <commit> && git push origin v1.23.0`)",
    )
  }
  const commits = commitsSince(tag)
  const cls = classify(commits)
  const current = parseVersion(tag)
  const bump = cls.breaking > 0 ? "major" : cls.feats.length > 0 ? "minor" : "patch"
  const n = nextVersion(current, cls)
  const next = `v${n.major}.${n.minor}.${n.patch}`
  return {
    current: tag,
    next,
    bump,
    commitCount: commits.length,
    counts: { feats: cls.feats.length, fixes: cls.fixes.length, breaking: cls.breaking, other: cls.others.length },
    notes: releaseNotes(tag, next, cls),
  }
}

const invokedDirectly =
  process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())
if (invokedDirectly) {
  const mode = process.argv[2] ?? "--json"
  const out = compute()
  if (out.commitCount === 0) {
    console.error(`no commits since ${out.current} — nothing to release`)
    process.exit(2)
  }
  if (mode === "--next") process.stdout.write(out.next + "\n")
  else if (mode === "--notes") process.stdout.write(out.notes)
  else process.stdout.write(JSON.stringify(out, null, 2) + "\n")
}
