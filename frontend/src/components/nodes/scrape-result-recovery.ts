import { applyWebScrapeResult } from "./web-scrape-run-state"
import { applyMetaAdsScrapeResult } from "./meta-ads-scrape-run-state"
import { applyInstagramScrapeResult } from "./instagram-scrape-run-state"
import { applySocialSearchResult } from "./social-search-run-state"

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
