/**
 * What the four background scrapes share (web-scrape, site-capture,
 * meta-ads-scrape, instagram-scrape): the payload every one of their video
 * worker jobs carries, the outcome a settle reports, and the logger a settle
 * writes to.
 *
 * Each scrape's settle — run the provider, store its media, run the ad
 * analysis, then commit or refund — lives in one module beside this one, and
 * is called from two places: the video worker's handler
 * (workers/handlers/background-scrape.ts) for a request answered with a job id,
 * and the route itself for web-scrape's and meta-ads-scrape's synchronous mode.
 * One body, so what is charged and what is stored cannot differ between them.
 */
import type { BillingContext } from "../billing-context.js"

/**
 * The fields every background scrape job carries, all decided by the route's
 * own server code: the row, its user and payer line (`lineOf` in
 * lib/concurrency-lanes/worker-admit.ts trusts the line only when the row
 * bears it out), and the reservation the settle commits or refunds. Never a
 * client body's field.
 */
export interface BackgroundScrapeJobBase {
  readonly jobId: string
  readonly userId: string
  readonly billingContext?: BillingContext
  readonly usageLogId?: string
}

/** What a settle did, for the synchronous mode to answer with. Never thrown. */
export type ScrapeOutcome =
  | { readonly ok: true; readonly result: Record<string, unknown> }
  | { readonly ok: false; readonly status: number; readonly code: string; readonly message: string }

/** The logger a settle writes to: the request's in the synchronous mode, the worker's below otherwise. */
export interface ScrapeLog {
  info(obj: Record<string, unknown>, msg: string): void
  warn(obj: Record<string, unknown>, msg: string): void
  error(obj: Record<string, unknown>, msg: string): void
}

/**
 * Media work (the library copy) and the AI analysis never start past this
 * point of a run: the actor may take 480 of the first 600 s, and the rest is
 * the copy and the analysis. Counted from the run's start (on a worker, the
 * handler's start — never the request's, so a wait in line costs nothing).
 */
export const SCRAPE_MEDIA_DEADLINE_MS = 570_000

/** The video worker's: one line per entry, as the worker's own lines are. */
export const workerScrapeLog: ScrapeLog = {
  info: (obj, msg) => console.info(msg, obj),
  warn: (obj, msg) => console.warn(msg, obj),
  error: (obj, msg) => console.error(msg, obj),
}
