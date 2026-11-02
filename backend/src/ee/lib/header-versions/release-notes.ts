import type { CommitSummary, GitHubReader } from "./github.js"
import { HEADER_REPO, type SiteEnvironment } from "./products.js"
import { compareVersions, isExactVersion, type Release } from "./read-version.js"
import type { Summarize } from "./release-summary.js"
import type { ReleaseChange, ReleaseNote, ReleaseNotesResult } from "./report-types.js"
import { failure } from "./site-readings.js"

/**
 * What each release of the header brought, for every release newer than the
 * oldest version a site serves: the pull requests merged between its tag and
 * the one before it. The header keeps no changelog of its own; its merges say
 * what changed, each in its pull request's title.
 */

/** Releases listed at most; the rest are counted. */
export const RELEASES_SHOWN = 8
/** The commits between two tags never change; this bounds how many comparisons are kept. */
const COMPARISONS_KEPT = 50

const MERGE = /^Merge pull request #(\d+) from \S+\s*\n+([^\n]+)/
const SQUASHED = /\s\(#(\d+)\)$/
/** Commits that change nothing a product sees: release bumps, docs, tests, tooling. */
const NOT_A_CHANGE = /^(?:chore|docs|test|ci|style|build)(?:\([^)]*\))?!?:|^Merge /i
const PREFIX = /^(\w+)(?:\([^)]*\))?!?:\s*/
/** The version a title ends with, as the header's pull requests write it: "… (0.13.0)". */
const VERSION_MARK = /\s*\(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?\)$/

function change(subject: string, pr: string | null): ReleaseChange {
  const type = PREFIX.exec(subject)?.[1]?.toLowerCase()
  const title = subject.replace(PREFIX, "").replace(SQUASHED, "").replace(VERSION_MARK, "").trim()
  return { title, kind: type === "feat" ? "feature" : type === "fix" ? "fix" : "other", url: pr ? `https://github.com/${HEADER_REPO}/pull/${pr}` : null }
}

const subjectOf = (message: string) => message.split("\n", 1)[0]?.trim() ?? ""

interface Entry {
  readonly subject: string
  readonly pr: string | null
}

/** A merge commit's pull request title, or a squashed commit's "(#n)". */
function pullOf(commit: CommitSummary): Entry[] {
  const merge = commit.parents > 1 ? MERGE.exec(commit.message) : null
  if (merge) return [{ subject: merge[2]!.trim(), pr: merge[1]! }]
  const subject = subjectOf(commit.message)
  const squashed = commit.parents > 1 ? null : SQUASHED.exec(subject)
  return squashed ? [{ subject, pr: squashed[1]! }] : []
}

/**
 * A release's changes: its merged pull requests; a release that merged none
 * lists its own commits. Version bumps, docs and tests are left out — of the
 * pull requests too, unless nothing else was merged. Two pull requests that
 * share a title stay two.
 */
export function changesOf(commits: readonly CommitSummary[]): ReleaseChange[] {
  const pulls = commits.flatMap(pullOf)
  const own = commits.filter((c) => c.parents <= 1).map((c): Entry => ({ subject: subjectOf(c.message), pr: null }))
  const source = pulls.length > 0 ? pulls : own
  const meaningful = source.filter((entry) => !NOT_A_CHANGE.test(entry.subject))
  const changes = (meaningful.length > 0 || pulls.length === 0 ? meaningful : source).map((entry) => change(entry.subject, entry.pr))
  const key = (c: ReleaseChange) => c.url ?? c.title
  return changes.filter((c, i) => c.title !== "" && changes.findIndex((other) => key(other) === key(c)) === i)
}

/** One site's version, as the release notes count who lacks a release. */
export interface SiteVersion {
  readonly productId: string
  readonly environment: SiteEnvironment
  readonly version: string
}

export interface ReleaseNotes {
  /** Every release newer than the oldest version in `sites`, newest first, with the sites that lack it. */
  since(releases: readonly Release[], sites: readonly SiteVersion[]): Promise<ReleaseNotesResult>
}

/** A release's commits, or why GitHub would not give them. */
interface Read {
  readonly commits: readonly CommitSummary[]
  readonly error: unknown
}

const previousOf = (releases: readonly Release[], release: Release): Release | undefined => releases[releases.indexOf(release) - 1]

/**
 * Comparisons are kept: a tag's commits never change. A failed read is not
 * kept, and fails its own release only (listed with no changes); every release
 * failing is said as the section's error. `summarize` says a release in plain
 * words (`release-summary.ts`); none leaves every summary `null`.
 */
export function createReleaseNotes(github: GitHubReader, summarize?: Summarize): ReleaseNotes {
  const kept = new Map<string, Promise<CommitSummary[]>>()

  function between(base: string, head: string): Promise<CommitSummary[]> {
    const key = `${base}...${head}`
    const known = kept.get(key)
    if (known) return known
    const loading = github.commitsBetween(HEADER_REPO, base, head)
    kept.set(key, loading)
    loading.catch(() => kept.delete(key))
    if (kept.size > COMPARISONS_KEPT) kept.delete(kept.keys().next().value as string)
    return loading
  }

  function read(previous: Release | undefined, release: Release): Promise<Read> {
    if (!previous) return Promise.resolve({ commits: [], error: null })
    return between(previous.tag, release.tag).then(
      (commits) => ({ commits, error: null }),
      (error: unknown) => ({ commits: [], error }),
    )
  }

  function note(previous: Release | undefined, release: Release, commits: readonly CommitSummary[], sites: readonly SiteVersion[]): ReleaseNote {
    return {
      version: release.version,
      summary: summarize ? summarize(release.version, commits) : null,
      releasedAt: commits.at(-1)?.committedAt ?? null,
      url: previous ? `https://github.com/${HEADER_REPO}/compare/${previous.tag}...${release.tag}` : `https://github.com/${HEADER_REPO}/tree/${release.tag}`,
      changes: changesOf(commits),
      missingOn: sites.filter((site) => compareVersions(site.version, release.version) < 0).map(({ productId, environment }) => ({ productId, environment })),
    }
  }

  return {
    async since(releases, sites) {
      const exact = sites.filter((site) => isExactVersion(site.version))
      // `compared` 0: no site's version could be read, or there is no release to compare it with.
      if (exact.length === 0 || releases.length === 0) return { status: "ok", releases: [], older: 0, compared: 0 }
      const oldest = exact.reduce((min, site) => (compareVersions(site.version, min) < 0 ? site.version : min), exact[0]!.version)
      const newer = [...releases.filter((release) => compareVersions(release.version, oldest) > 0)].reverse()
      const shown = newer.slice(0, RELEASES_SHOWN)
      const reads = await Promise.all(shown.map((release) => read(previousOf(releases, release), release)))
      const refused = reads.find((r) => r.error !== null)
      if (refused && reads.every((r) => r.error !== null)) return failure(refused.error, "the header's release notes")
      const notes = shown.map((release, i) => note(previousOf(releases, release), release, reads[i]!.commits, exact))
      return { status: "ok", releases: notes, older: newer.length - shown.length, compared: exact.length }
    },
  }
}
