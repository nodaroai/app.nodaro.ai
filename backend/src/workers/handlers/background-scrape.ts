/**
 * The background scrapes as video-worker jobs: `web-scrape`, `site-capture`,
 * `meta-ads-scrape` and `instagram-scrape` — each named exactly its job type,
 * so the pickup claim keeps the row's `job_type` (it writes the BullMQ name)
 * and the job budget registry reads the same key.
 *
 * Their routes insert the row, reserve and enqueue; each handler runs the
 * scrape's own settle (lib/background-scrape/) — scrape, media, the ad
 * analysis, then commit or refund — exactly as the route ran it in-process
 * before. On a worker the job waits for its provider slot at pickup when lanes
 * are enforced, holds it for the whole scrape (the analysis's LLM calls run
 * under it and take none of their own), and survives a deploy.
 *
 * What the worker does differently for them (flags below, read in
 * video-worker.ts):
 *   - `outputIsData`: the row stays private and files no Library asset;
 *   - `resumesProviderTask`: a re-picked job whose row saved its external run
 *     (the cloud job or the Apify run, lib/background-scrape/scrape-run.ts)
 *     runs here and re-attaches to that run — never a second run, never the
 *     generic inline reconcile (which has no plan to settle with);
 *   - `ignoresQuietStop`: a quietly stopped account's scrape runs, as it did
 *     in the route (decided 2026-11-01);
 *   - `capacityGroup: "scrape"`: at most a few scrapes per worker process at
 *     once (workers/worker-capacity.ts), so they never fill the media pool.
 *
 * A settle never throws: a failed scrape fails its row and refunds there, and
 * is never retried (a retry would run — and bill — the provider again). Only a
 * payload that is not this row's own is thrown, as a refusal no retry changes.
 */
import type { Job } from "bullmq"
import { DeterministicJobError } from "../../lib/deterministic-job-error.js"
import { workerScrapeLog, type BackgroundScrapeJobBase } from "../../lib/background-scrape/common.js"
import {
  INSTAGRAM_SCRAPE_JOB_TYPE, META_ADS_SCRAPE_JOB_TYPE, SITE_CAPTURE_JOB_TYPE, WEB_SCRAPE_JOB_TYPE, isScrapeRunKind,
} from "../../lib/background-scrape/job-types.js"
import { restampSavedScrapeRun, scrapeRunTracker, type ScrapeRunTracker } from "../../lib/background-scrape/scrape-run.js"
import { settleWebScrape, type WebScrapeJobData } from "../../lib/background-scrape/web-scrape.js"
import { settleSiteCapture, type SiteCaptureJobData } from "../../lib/background-scrape/site-capture.js"
import { settleMetaAdsScrape, type MetaAdsScrapeJobData } from "../../lib/background-scrape/meta-ads.js"
import { settleInstagramScrape, type InstagramScrapeJobData } from "../../lib/background-scrape/instagram.js"
import type { HandlerFn, JobContext } from "../shared.js"

const sameLog = (a: unknown, b: unknown): boolean => (a ?? null) === (b ?? null)

/**
 * The payload, when it is this row's own scrape: its job, its user and its
 * reservation are the row's (the rule the lane admission applies to the payer
 * line — lib/concurrency-lanes/worker-admit.ts `lineOf`). A refusal otherwise.
 * A row that could not be read is a plain (retryable) failure, not a refusal.
 */
function payloadOf<T extends BackgroundScrapeJobBase & { body: unknown }>(job: Job, ctx: JobContext): T {
  const data = job.data as Partial<T> | null
  if (!data || data.jobId !== ctx.jobId || typeof data.userId !== "string" || !data.body || typeof data.body !== "object") {
    throw new DeterministicJobError(`${job.name}: the job's payload is not a background scrape of this job`)
  }
  if (ctx.jobUserId === undefined) throw new Error(`${job.name}: the job's row could not be read`)
  if (data.userId !== ctx.jobUserId || !sameLog(data.usageLogId, ctx.usageLogId)) {
    throw new DeterministicJobError(`${job.name}: the job's payload does not match its row`)
  }
  return data as T
}

/** The row's reservation (the payload agrees with it — see payloadOf). */
const usageLogOf = (ctx: JobContext): string | undefined => ctx.usageLogId ?? undefined

/**
 * The run tracker of this attempt: the run the row saved, re-attached (its
 * staleness clock restarted), else none. A saved task of a kind no scrape
 * starts is refused: re-running would start a second run.
 */
async function runsOf(job: Job, ctx: JobContext): Promise<ScrapeRunTracker> {
  const task = ctx.providerTask
  if (!task) return scrapeRunTracker(ctx.jobId)
  if (!isScrapeRunKind(task.kind)) {
    throw new DeterministicJobError(`${job.name}: the job's row carries a provider task of kind ${String(task.kind)}, which no scrape starts`)
  }
  await restampSavedScrapeRun(ctx.jobId)
  return scrapeRunTracker(ctx.jobId, { kind: task.kind, id: task.id })
}

function scrapeJob(fn: (job: Job, ctx: JobContext) => Promise<void>): HandlerFn {
  return Object.assign(fn, {
    outputIsData: true as const,
    resumesProviderTask: true as const,
    ignoresQuietStop: true as const,
    capacityGroup: "scrape" as const,
  })
}

export const backgroundScrapeHandlers: Record<string, HandlerFn> = {
  [WEB_SCRAPE_JOB_TYPE]: scrapeJob(async (job, ctx) => {
    const data = payloadOf<WebScrapeJobData>(job, ctx)
    await settleWebScrape({ jobId: data.jobId, usageLogId: usageLogOf(ctx), body: data.body, runs: await runsOf(job, ctx), log: workerScrapeLog })
  }),
  [SITE_CAPTURE_JOB_TYPE]: scrapeJob(async (job, ctx) => {
    const data = payloadOf<SiteCaptureJobData>(job, ctx)
    await settleSiteCapture({
      jobId: data.jobId, userId: data.userId, runner: data.runner, body: data.body, usageLogId: usageLogOf(ctx), runs: await runsOf(job, ctx), log: workerScrapeLog,
    })
  }),
  [META_ADS_SCRAPE_JOB_TYPE]: scrapeJob(async (job, ctx) => {
    const data = payloadOf<MetaAdsScrapeJobData>(job, ctx)
    await settleMetaAdsScrape({ ...data, usageLogId: usageLogOf(ctx), startedAt: Date.now(), runs: await runsOf(job, ctx), log: workerScrapeLog })
  }),
  [INSTAGRAM_SCRAPE_JOB_TYPE]: scrapeJob(async (job, ctx) => {
    const data = payloadOf<InstagramScrapeJobData>(job, ctx)
    await settleInstagramScrape({ ...data, usageLogId: usageLogOf(ctx), startedAt: Date.now(), runs: await runsOf(job, ctx), log: workerScrapeLog })
  }),
}
