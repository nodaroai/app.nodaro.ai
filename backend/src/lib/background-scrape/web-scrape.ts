/**
 * Web Scrape: what a run is (its body), and the one settle both of its modes
 * share — the `web-scrape` video-worker job for a
 * request answered with a job id, and the route itself for a synchronous one.
 */
import { z } from "zod"
import { markJobCompleted } from "../../workers/shared.js"
import { markJobFailed } from "../job-failure.js"
// Core-safe commit/refund (keyed by job id, `ee/` reached via dynamic import).
import { commitReservedCreditsForJob, refundReservedCreditsForJob } from "../credits-job-lifecycle.js"
import { runScraper } from "../../providers/apify/scraper.js"
import { fetchRssItems } from "../../providers/rss/parser.js"
import { safeUrlSchema } from "../url-validator.js"
import { normalizeWebUrlInput } from "../web-url-input.js"
import { config } from "../config.js"
import { shouldRunOnCloud } from "../../providers/nodaro/run-on-cloud.js"
import { createCloudJob, waitForCloudJob } from "../../providers/nodaro/client.js"
import type { BackgroundScrapeJobBase, ScrapeLog, ScrapeOutcome } from "./common.js"
import { apifyRunHooks, cloudJobOf, type ScrapeRunTracker } from "./scrape-run.js"

export { WEB_SCRAPE_JOB_TYPE } from "./job-types.js"

const ROUTE_PATH = "/v1/web-scrape"

// People type addresses the way the address bar shows them ("pletor.ai",
// "www.pletor.ai/products"); the missing scheme is inferred BEFORE the strict
// URL check so every usual spelling runs instead of failing "Invalid URL".
const webAddress = z.preprocess(normalizeWebUrlInput, z.string().url().max(2048))

const contentCrawlerBody = z.object({
  actor: z.literal("content-crawler"),
  url: webAddress,
  mode: z.enum(["page", "site"]).default("page"),
})
const googleSearchBody = z.object({
  actor: z.literal("google-search"),
  query: z.string().min(1).max(500),
  maxResults: z.number().int().min(1).max(10).optional(),
  countryCode: z.string().length(2).optional(),
})
const instagramBody = z.object({
  actor: z.literal("instagram"),
  target: webAddress,
  resultsLimit: z.number().int().min(1).max(20).optional(),
})
const tiktokBody = z.object({
  actor: z.literal("tiktok"),
  target: webAddress,
  resultsLimit: z.number().int().min(1).max(20).optional(),
})
// RSS is the only actor that doesn't go through Apify — we fetch + parse
// directly on this server, so the URL needs SSRF protection via safeUrlSchema.
const rssBody = z.object({
  actor: z.literal("rss"),
  url: z.preprocess(normalizeWebUrlInput, safeUrlSchema),
  resultsLimit: z.number().int().min(1).max(50).optional(),
})
export const webScrapeBody = z.discriminatedUnion("actor", [
  contentCrawlerBody, googleSearchBody, instagramBody, tiktokBody, rssBody,
])
export type WebScrapeBody = z.infer<typeof webScrapeBody>

/** The `web-scrape` worker job's payload. */
export interface WebScrapeJobData extends BackgroundScrapeJobBase {
  readonly body: WebScrapeBody
}

/**
 * The relay asks the cloud for the job id first and polls it, because the
 * cloud sits behind the same ~100 s edge timeout a browser does: held open, a
 * site crawl was cut off there while the cloud finished and billed the
 * connected account. A cloud that predates `respondAsync` ignores the flag and
 * answers when the work is done — that answer carries a `jobId` too, and the
 * poll finds the job already terminal, so a scrape UNDER the edge timeout reads
 * the same way against both generations. A longer one against such a cloud is
 * cut off exactly as it always was (this install fails and refunds its own job;
 * the connected account is still billed there) — no better, no worse.
 * The cloud job's `output_data` is the shape this module builds locally.
 */
async function scrapeViaConnection(body: Record<string, unknown>, runs: ScrapeRunTracker): Promise<Record<string, unknown>> {
  const cloudJobId = await cloudJobOf(runs, (idempotencyKey) => createCloudJob(ROUTE_PATH, { ...body, respondAsync: true }, { idempotencyKey }))
  const cloudJob = await waitForCloudJob(cloudJobId)
  return (cloudJob.output_data as Record<string, unknown> | null) ?? {}
}

export interface WebScrapeSettleInput {
  readonly jobId: string
  readonly usageLogId: string | undefined
  readonly body: WebScrapeBody
  /** The run this job already started (re-attach), and where a new one is saved. */
  readonly runs: ScrapeRunTracker
  readonly log: ScrapeLog
}

/**
 * Run the scrape and settle the job. Never throws: the worker job must not be
 * retried for a scrape that failed (a retry would run — and bill — the
 * provider again), and mark-failed and the refund are themselves wrapped, so
 * a failure inside them is logged, not thrown.
 */
export async function settleWebScrape({ jobId, usageLogId, body, runs, log }: WebScrapeSettleInput): Promise<ScrapeOutcome> {
  try {
    // RSS bypasses Apify entirely — a plain HTTP GET + XML parse. Keeps
    // this path off the Apify bill and cuts per-run latency ~orders
    // of magnitude.
    const result: Record<string, unknown> = body.actor === "rss"
      ? {
          json: await fetchRssItems({
            url: body.url,
            resultsLimit: body.resultsLimit,
            // A feed host answering some requests and not others is an
            // upstream incident worth seeing in the logs even when the
            // retry saves the run.
            onRetry: (info) => log.warn({ jobId, ...info }, "[web-scrape] rss upstream failed; retrying"),
          }),
        }
      // No Apify token of its own + a live nodaro.ai connection: the
      // connection runs the scrape (billed to the connected account) and
      // this job relays the result. Asked here, when the scrape runs — unless
      // it already started a run, which it re-attaches to on the same side.
      : (runs.savedKind ? runs.savedKind === "nodaro-cloud" : await shouldRunOnCloud(config.APIFY_API_TOKEN))
        ? await scrapeViaConnection(body as Record<string, unknown>, runs)
        : { ...(await runScraper(body, apifyRunHooks(runs))) }

    // false = the job left its live state under us — cancelled mid-scrape,
    // where the cancel path already refunded. Settling it would charge for a
    // run the user stopped; returning the data would be a free scrape.
    const completed = await markJobCompleted(jobId, { output_data: result })
    if (!completed) {
      log.info({ jobId }, "[web-scrape] job left pending before completion; skipping settlement")
      return { ok: false, status: 409, code: "job_cancelled", message: "The job was cancelled before it completed." }
    }

    // The job IS completed and its result stored from here on, so a commit
    // that fails must not fall into the catch below: `markJobFailed` would
    // miss its CAS on a completed row, nothing would be refunded, and a held
    // caller would get a 502 for a scrape that is sitting on the job. The
    // reservation stays `reserved` and this line is what ops finds it by.
    if (usageLogId) {
      await commitReservedCreditsForJob(jobId).catch((commitErr: unknown) => {
        log.error({ err: commitErr, jobId }, "[web-scrape] job completed but its reservation did not commit")
      })
    }
    return { ok: true, result }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Scrape failed"
    try {
      // Refund only when WE flipped the row — a cancelled job was refunded by cancel.
      const flipped = await markJobFailed(jobId, { error_message: message, extra: { output_data: { error: message } } })
      if (flipped && usageLogId) await refundReservedCreditsForJob(jobId)
    } catch (failErr) {
      log.error({ err: failErr, jobId }, "[web-scrape] failed to mark job failed / refund")
    }
    log.error({ err, jobId }, "[web-scrape] scrape failed")
    return { ok: false, status: 502, code: "scrape_error", message }
  }
}
