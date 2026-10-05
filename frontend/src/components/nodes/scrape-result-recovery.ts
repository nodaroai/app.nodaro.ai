import { applyWebScrapeResult, webScrapeFingerprint } from "./web-scrape-run-state"
import { applyMetaAdsScrapeResult, metaAdsScrapeFingerprint } from "./meta-ads-scrape-run-state"
import { applyInstagramScrapeResult, instagramScrapeFingerprint } from "./instagram-scrape-run-state"
import { applySocialSearchResult, socialSearchResults, socialSearchServerRunPatch } from "./social-search-run-state"
import { socialPostsFrom } from "@nodaro/shared"
import type { InstagramScrapeNodeData, MetaAdsScrapeNodeData, SocialSearchNodeData, WebScrapeNodeData } from "@/types/nodes"

/**
 * Putting a scrape job's result on its node — the ONE rule the live run, the
 * poll restored after a reload, and the load-time recovery all share.
 *
 * A scrape runs for minutes (a 20-page site crawl measured 252 s), so the tab
 * that started it is often not the tab that is open when it finishes. The two
 * recovery layers that exist for that — `applyRestoredJobCompletion` for a job
 * still running at reload, `reconcileCompletedSingleNodeJobs` for one that
 * finished while the tab was closed — only knew media URLs plus a short list
 * of JSON emitters, and no scraper was on it: a restored scrape completed its
 * node EMPTY, and a finished one was never painted at all. Billed, stored on
 * the job, nothing on the canvas.
 */

/** Builders read the node's own data where the result depends on it (Social
 *  Search passes on the first `pickTop` posts); the others ignore it. */
type ScrapePatchBuilder = (json: unknown, data?: Readonly<Record<string, unknown>>) => Record<string, unknown>

const SCRAPE_RESULT_PATCH: ReadonlyMap<string, ScrapePatchBuilder> = new Map<string, ScrapePatchBuilder>([
  ["web-scrape", applyWebScrapeResult],
  ["meta-ads-scrape", applyMetaAdsScrapeResult],
  ["instagram-scrape", applyInstagramScrapeResult],
  ["social-search", applySocialSearchResult],
])

/** True for the nodes whose result is `output_data.json` written by a scrape. */
export function isScrapeNodeType(nodeType: string | undefined): boolean {
  return nodeType !== undefined && SCRAPE_RESULT_PATCH.has(nodeType)
}

/**
 * The node-data patch for a finished scrape job.
 *
 * `lastAppliedJobId` is what makes recovery idempotent. A scrape node KEEPS its
 * last good payload through a failed or empty rerun (#765), so "already holds a
 * result" is the normal state of any node that has run before and says nothing
 * about whether THIS job's result is the one it holds. Deliberately not declared
 * on the node data types: it is bookkeeping, not something a workflow author
 * sets, and the generated node docs list every declared field.
 */
export function scrapeResultPatch(
  nodeType: string,
  json: unknown,
  jobId: string,
  data?: Readonly<Record<string, unknown>>,
): Record<string, unknown> | null {
  const build = SCRAPE_RESULT_PATCH.get(nodeType)
  if (!build) return null
  return { ...build(json, data), lastAppliedJobId: jobId }
}

/** The run-input fingerprint each scraper's card compares against its settings ("Inputs changed — rerun"). */
const SCRAPE_FINGERPRINT: ReadonlyMap<string, (data: Readonly<Record<string, unknown>>) => string> = new Map<
  string,
  (data: Readonly<Record<string, unknown>>) => string
>([
  ["web-scrape", (d) => webScrapeFingerprint(d as WebScrapeNodeData)],
  ["meta-ads-scrape", (d) => metaAdsScrapeFingerprint(d as MetaAdsScrapeNodeData)],
  ["instagram-scrape", (d) => instagramScrapeFingerprint(d as InstagramScrapeNodeData)],
])

/**
 * The patch for a scraper a SERVER run executed — Execute workflow, Run from
 * here, Run selected: the single-node Run's own result mapping, stamped with
 * the job, so the card shows the posts / ads / pages exactly as after a
 * single-node Run. (A schedule's or an app's run reaches an open canvas through
 * the live lane only — the load-time restores list manual runs.) The three
 * lanes that paint a server run used to know only media URLs, so a scraper's
 * card stayed "Not run yet" while every node after it had run on its posts —
 * and its featured image landed in `generatedResults` as if it were the result.
 *
 * - `null`: not a scraper this covers, or no `json` in the output — the
 *   caller's generic mapping applies.
 * - Social Search: its server run carries every post found on
 *   `searchResults`, so it has its own mapping (`socialSearchServerRunPatch`),
 *   stamped with the job like the others so a reopen that sees the run again
 *   never resets the picks made since. It never falls through to the generic
 *   writes (a text history in `generatedResults` would be read as its list).
 * - `{}`: nothing to change, and the generic writes must not run either:
 *   - the state carries NO job — the run did not execute the node, it passed
 *     its SAVED data through (outside a Run from here / Run selected subset,
 *     or skipped). Applying a fresh-run patch there would reset the featured
 *     post the person picked, and the next partial run would hand post #1
 *     downstream instead of theirs;
 *   - or the node already holds this job's result.
 * - otherwise the patch: the run's result, the fingerprint of the settings the
 *   run used (the node's current ones — so a fresh result never reads as
 *   "Inputs changed"), and the media fields an older build wrote as if they
 *   were the result cleared (the single-node Run never writes them on a
 *   scraper; the server's saved-list reader would otherwise hand on the
 *   featured image instead of the posts).
 *
 * `reopened`: the run is being seen AGAIN by a load-time lane, not landing
 * live — see `socialSearchRunPatch`.
 */
export function scrapeServerRunPatch(
  nodeType: string | undefined,
  output: Readonly<Record<string, unknown>> | undefined,
  jobId: string | undefined,
  data?: Readonly<Record<string, unknown>>,
  opts: { readonly reopened?: boolean } = {},
): Record<string, unknown> | null {
  if (nodeType === "social-search") return socialSearchRunPatch(output, jobId, data, opts.reopened === true)
  if (nodeType === undefined || !isScrapeNodeType(nodeType)) return null
  if (!output || output.json === undefined) return null
  if (!jobId || data?.lastAppliedJobId === jobId) return {}
  const patch = scrapeResultPatch(nodeType, output.json, jobId, data)
  if (!patch) return null
  const fingerprint = SCRAPE_FINGERPRINT.get(nodeType)
  return {
    ...patch,
    ...(fingerprint ? { lastRunFingerprint: fingerprint(data ?? {}) } : {}),
    generatedResults: undefined,
    generatedImageUrl: undefined,
    generatedText: undefined,
    activeResultIndex: undefined,
  }
}

/**
 * Social Search's server-run patch. A state with no job keeps the live run's
 * old behaviour (painted, unstamped): a seeded state never reaches here, every
 * lane asks `isSeededState` first.
 *
 * On a REOPEN, a node with no stamp that already lists exactly this run's posts
 * is only stamped, never repainted. An older build's live lane painted Social
 * Search without recording the job, so the stamp cannot say the node holds
 * this run — and the timing guard cannot either, since that lane stamped
 * `lastRunAt` when the NODE finished, while a reopen compares against when the
 * whole RUN settled (minutes later when a video step follows). Repainting
 * there would reset the picks made since. The live lane never takes this
 * shortcut: a rerun that finds the same posts is a new run, and its outcome,
 * time and fingerprint must land.
 */
function socialSearchRunPatch(
  output: Readonly<Record<string, unknown>> | undefined,
  jobId: string | undefined,
  data: Readonly<Record<string, unknown>> = {},
  reopened = false,
): Record<string, unknown> | null {
  if (!output) return null
  if (jobId && data.lastAppliedJobId === jobId) return {}
  if (reopened && jobId && data.lastAppliedJobId === undefined && showsSamePosts(data, output)) {
    return { lastAppliedJobId: jobId }
  }
  const patch = socialSearchServerRunPatch(data as SocialSearchNodeData, output)
  return jobId && Object.keys(patch).length > 0 ? { ...patch, lastAppliedJobId: jobId } : patch
}

/** The node lists exactly the posts the run found, in order — and it found some. */
function showsSamePosts(data: Readonly<Record<string, unknown>>, output: Readonly<Record<string, unknown>>): boolean {
  const found = socialPostsFrom(output.searchResults)
  const shown = socialSearchResults(data)
  return found.length > 0 && found.length === shown.length && found.every((post, i) => post.id === shown[i]!.id)
}

/**
 * The browser stamps `lastRunStartedAt`; the server stamps the job, a moment
 * later, on its own clock. Two minutes absorbs ordinary drift between the two —
 * without it a browser running a second fast would read its own run's job as
 * "older than the run" and never recover it. A clock further out than that
 * fails SAFE: the job is left alone.
 */
const RUN_START_SKEW_MS = 120_000

function ms(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

/**
 * Should this completed job be written onto this scrape node?
 *
 * The caller hands over the node's NEWEST terminal job (a newer failed run
 * shadows an older completed one — see `pickLatestTerminalJobPerNode`). Then:
 *
 *  - never while a run is live on the node — that run owns it;
 *  - never twice — `lastAppliedJobId` names the job the payload came from;
 *  - never a job from BEFORE the node's last run started. That run failed or
 *    was abandoned on its own terms, and resurrecting an older result over it
 *    would hide the failure behind stale data;
 *  - never over a run the node already SETTLED as a success or an empty result,
 *    unless the job is clearly newer than that settlement: the settlement is
 *    this job (or a later one), applied live by a build that did not record
 *    job ids yet.
 *
 * What is left is the case this exists for: the node's last run failed or never
 * settled — cut off at the edge, the tab closed mid-crawl — and its job
 * finished anyway.
 */
export function scrapeJobNeedsApplying(
  data: Record<string, unknown>,
  job: { readonly id: string; readonly createdAt?: string | null },
): boolean {
  if (data.executionStatus === "running" || data.executionStatus === "pending") return false
  if (data.lastAppliedJobId === job.id) return false

  const createdAt = job.createdAt ? Date.parse(job.createdAt) : Number.NaN
  // No usable timestamp: nothing ties the job to the node's last run, and a
  // guess here overwrites somebody's result.
  if (!Number.isFinite(createdAt)) return false

  const lastRunStartedAt = ms(data.lastRunStartedAt)
  if (lastRunStartedAt !== undefined && createdAt < lastRunStartedAt - RUN_START_SKEW_MS) return false

  // "Did the node's LAST run settle?" is asked on ONE clock: `lastRunAt` and
  // `lastRunStartedAt` are both the browser's, so a success recorded before the
  // last run began belongs to an EARLIER run and the last one never settled —
  // the quick rerun, tab closed mid-crawl, which is exactly a result somebody
  // paid for. Only the comparison against the server's `createdAt` needs the
  // tolerance: a settled run blocks any job not clearly newer than it. Without
  // that tolerance a browser a minute behind the server re-applied a result it
  // already held, resetting the featured post and the view filter under the
  // user.
  const outcomeSettled = data.lastRunOutcome === "success" || data.lastRunOutcome === "empty"
  const lastRunAt = ms(data.lastRunAt)
  const lastRunSettled =
    outcomeSettled && lastRunAt !== undefined && (lastRunStartedAt === undefined || lastRunAt >= lastRunStartedAt)
  if (lastRunSettled && createdAt <= lastRunAt + RUN_START_SKEW_MS) return false

  return true
}
