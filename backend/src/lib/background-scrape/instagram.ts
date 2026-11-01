/**
 * Instagram scrape: what a run is (its body), the plan its route decides
 * before it reserves (who runs it, the normalized targets, how the analysis
 * bills), and its settle — run by the `instagram-scrape` video-worker job (the
 * route always answers with a job id; it has no synchronous mode). The post
 * analysis runs inside the settle, so its LLM calls run under the job's own
 * provider slot and take none of their own.
 */
import { z } from "zod"
import { commitJobCredits, markJobCompleted } from "../../workers/shared.js"
import { markJobFailed } from "../job-failure.js"
import { commitReservedCreditsForJob, refundReservedCreditsForJob } from "../credits-job-lifecycle.js"
import { baseCreditCostFor } from "../credit-base-cost.js"
import { runInstagramScrape, type InstagramPost } from "../../providers/apify/instagram.js"
import { classifyAndStoreInstagramMedia, instagramWithoutMedia } from "../instagram-media.js"
import { analyzeInstagramPosts } from "../instagram-analysis.js"
import { LlmSpend } from "../llm-billing.js"
import { fixedPlusLlmSpendTracker, settleFixedPlusLlmCalls, settleFixedPlusLlmCallsAfterCancel, type FixedPlusLlmHold } from "../llm-fixed-plus-calls.js"
import {
  INSTAGRAM_SCRAPE_DEFAULT_COUNT,
  INSTAGRAM_SCRAPE_MAX_COUNT,
  INSTAGRAM_SCRAPE_MAX_SOURCES,
  INSTAGRAM_SCRAPE_MAX_TARGET_LENGTH,
  INSTAGRAM_SCRAPE_MODES,
  INSTAGRAM_SCRAPE_PERIODS,
  META_ADS_ANALYSIS_FOCUS_MAX,
  META_ADS_FORMATS,
  buildInstagramScrapeCreditId,
  clampInstagramFeaturedIndex,
  featuredInstagramOutputs,
  instagramAnalysisCreditId,
  type MetaAdsAnalysisTier,
} from "@nodaro/shared/social"
import { LLM_MODEL_IDS, STRUCTURED_VISION_MODELS } from "@nodaro/shared/llm-models"
import { createCloudJob, waitForCloudJob } from "../../providers/nodaro/client.js"
import { SCRAPE_MEDIA_DEADLINE_MS, type BackgroundScrapeJobBase, type ScrapeLog } from "./common.js"
import { apifyRunHooks, cloudJobOf, type ScrapeRunTracker } from "./scrape-run.js"

export { INSTAGRAM_SCRAPE_JOB_TYPE } from "./job-types.js"

const ROUTE_PATH = "/v1/instagram-scrape"


const STRUCTURED_VISION_MODEL_IDS = new Set(STRUCTURED_VISION_MODELS.map((m) => m.id))

export const instagramScrapeBody = z.object({
  mode: z.enum(INSTAGRAM_SCRAPE_MODES).default("profile"),
  /** Usernames (profile), hashtags (hashtag) or post links (post), one per item; 1..5. */
  targets: z.array(z.string().trim().min(1).max(INSTAGRAM_SCRAPE_MAX_TARGET_LENGTH)).min(1).max(INSTAGRAM_SCRAPE_MAX_SOURCES),
  count: z.number().int().min(1).max(INSTAGRAM_SCRAPE_MAX_COUNT).default(INSTAGRAM_SCRAPE_DEFAULT_COUNT),
  period: z.enum(INSTAGRAM_SCRAPE_PERIODS).default("30d"),
  formats: z.array(z.enum(META_ADS_FORMATS)).max(META_ADS_FORMATS.length).optional(),
  featuredIndex: z.number().int().min(0).optional(),
  ingestVideo: z.boolean().optional(),
  ingestAllVideos: z.boolean().optional(),
  analyze: z.boolean().optional(),
  analysisModel: z
    .enum(LLM_MODEL_IDS as [string, ...string[]])
    .refine((id) => STRUCTURED_VISION_MODEL_IDS.has(id), { message: "analysisModel must be an image-capable model with structured output" })
    .optional(),
  analysisFocus: z.string().trim().max(META_ADS_ANALYSIS_FOCUS_MAX).optional(),
})
export type InstagramScrapeBody = z.infer<typeof instagramScrapeBody>

/**
 * What the route decides before it reserves, all from the validated body and
 * server state — never a client field: the body with its targets normalized
 * (the same source set the guard and the reservation counted), who runs the
 * scrape (`viaCloud`), and how the analysis bills (`analysisHold` when it is
 * metered).
 */
export interface InstagramScrapePlan {
  readonly body: InstagramScrapeBody
  readonly viaCloud: boolean
  readonly requestedCount: number
  readonly sources: number
  readonly analysisTier: MetaAdsAnalysisTier | null
  readonly analysisModel: string
  readonly analysisHold?: FixedPlusLlmHold
}

/** The `instagram-scrape` worker job's payload. */
export interface InstagramScrapeJobData extends BackgroundScrapeJobBase, InstagramScrapePlan {}

/**
 * No Apify token + a live nodaro.ai connection: relay the whole run (billed to
 * the connected account). The cloud route answers with a job id and runs the
 * scrape in the background, so create the cloud job and poll it to a terminal
 * state; its `output_data` is the same shape this module builds locally.
 */
async function scrapeViaConnection(body: Record<string, unknown>, runs: ScrapeRunTracker): Promise<Record<string, unknown>> {
  const cloudJobId = await cloudJobOf(runs, (idempotencyKey) => createCloudJob(ROUTE_PATH, body, { idempotencyKey }))
  const cloudJob = await waitForCloudJob(cloudJobId)
  return (cloudJob.output_data as Record<string, unknown> | null) ?? {}
}

export interface InstagramScrapeSettleInput extends InstagramScrapePlan {
  readonly jobId: string
  readonly userId: string
  readonly usageLogId: string | undefined
  /** When the run started: its media and analysis deadline counts from here (never from a wait for a slot). */
  readonly startedAt: number
  /** The run this job already started (re-attach), and where a new one is saved. */
  readonly runs: ScrapeRunTracker
  readonly log: ScrapeLog
}

/**
 * Run the scrape, the media copy and the analysis, and settle the job. Never
 * throws: the worker job must not be retried for a scrape that failed (a retry
 * would run — and bill — the provider again), and mark-failed and the refund
 * are themselves wrapped, so a failure inside them is logged, not thrown.
 */
export async function settleInstagramScrape(input: InstagramScrapeSettleInput): Promise<void> {
  const { jobId, userId, usageLogId, startedAt, runs, log, body, viaCloud, requestedCount, sources, analysisTier, analysisModel, analysisHold } = input
  const analysisSpend = new LlmSpend()
  // Each analysis call is recorded as it returns (or fails) — every item is
  // a billed call — and the running ledger lands in the job's server-only
  // billing ledger (R32, never output_data) after each item, so a cancel mid-run commits what was already billed.
  const tracker = analysisHold ? fixedPlusLlmSpendTracker(jobId, analysisHold.chargeId, analysisSpend) : undefined
  try {
    const scraped = viaCloud
      ? await scrapeViaConnection(body as Record<string, unknown>, runs)
      : await runInstagramScrape(body, apifyRunHooks(runs))

    const scrapedPosts = (Array.isArray(scraped.json) ? scraped.json : []) as InstagramPost[]
    const featuredIndex = clampInstagramFeaturedIndex(body.featuredIndex, scrapedPosts.length)
    const media = await classifyAndStoreInstagramMedia(scrapedPosts, {
      userId,
      jobId,
      deadlineAt: startedAt + SCRAPE_MEDIA_DEADLINE_MS,
      storeImages: !viaCloud,
      storeFeaturedVideoIndex: body.ingestVideo && !viaCloud ? featuredIndex : undefined,
      storeAllVideos: body.ingestAllVideos === true && !viaCloud,
      formats: body.formats,
    }).catch((err: unknown) => {
      log.warn({ err, jobId }, "[instagram-scrape] media step failed; returning posts with their source urls")
      return { posts: instagramWithoutMedia(scrapedPosts), stats: { classified: 0, stored: 0, videosStored: 0, kept: scrapedPosts.length, filteredOut: 0 } }
    })

    const analyzed = analysisTier && !viaCloud
      ? await analyzeInstagramPosts(media.posts, {
        modelId: analysisModel,
        focus: body.analysisFocus,
        deadlineAt: startedAt + SCRAPE_MEDIA_DEADLINE_MS,
        ...(tracker ? { complete: tracker.complete } : {}),
      })
      : null
    const posts = analyzed ? analyzed.posts : media.posts
    const relayedAnalysis = (scraped as Record<string, unknown>).analysis
    const analysisStats = analyzed
      ? { model: analysisModel, ...analyzed.stats }
      : viaCloud && relayedAnalysis && typeof relayedAnalysis === "object" ? relayedAnalysis : undefined

    const result = {
      json: posts,
      mediaStorage: media.stats,
      ...(analysisStats ? { analysis: analysisStats } : {}),
      ...featuredInstagramOutputs(posts, featuredIndex),
    }

    // The last running-ledger write lands BEFORE the completion write.
    await tracker?.flush()
    const completed = await markJobCompleted(jobId, {
      output_data: result,
      ...(analyzed ? { provider_cost: analyzed.stats.providerCostUsd || null } : {}),
    })
    if (!completed) {
      // Cancelled mid-scrape — the refund is the cancel endpoint's job; but
      // the analyses it billed are charged, never refunded (D10): the cancel
      // kept the hold while a call was in flight, so it is settled now that
      // the calls have ended (the cancel's own after-flip rule). A write lost
      // to another attempt's completion settles nothing there: that attempt owns it.
      if (analysisHold) await settleFixedPlusLlmCallsAfterCancel(jobId)
      log.info({ jobId }, "[instagram-scrape] job cancelled before completion; skipping settlement")
      return
    }

    // The job IS completed and its result stored from here on, so a commit
    // that fails must not fall into the catch below: `markJobFailed` would
    // miss its CAS on a completed row and the after-cancel settle would run on
    // a completed job. The reservation stays `reserved` and this line is what
    // ops finds it by (as meta-ads-scrape and web-scrape do).
    const settle = async (): Promise<void> => {
      if (analysisHold) {
        // Metered (B5), settled AFTER the completion write (a cancel that
        // lands first is never charged): the scrape's fixed price plus what
        // the analyses cost; the receipt writes credits_actual + billing.
        await settleFixedPlusLlmCalls(jobId, analysisHold, analysisSpend, "charge")
        return
      }
      if (!usageLogId) return
      if (analyzed && analysisTier) {
        const [scrapeBase, perPost] = await Promise.all([
          baseCreditCostFor(buildInstagramScrapeCreditId({ count: requestedCount, sources })),
          baseCreditCostFor(instagramAnalysisCreditId(analysisTier)),
        ])
        await commitJobCredits(usageLogId, jobId, null, scrapeBase + perPost * analyzed.stats.analyzed, true)
      } else {
        await commitReservedCreditsForJob(jobId)
      }
    }
    await settle().catch((commitErr: unknown) => {
      log.error({ err: commitErr, jobId }, "[instagram-scrape] job completed but its reservation did not commit")
    })
  } catch (err) {
    // Never throws (see above). Mark-failed + refund are themselves wrapped
    // so a failure there is logged, not thrown.
    const message = err instanceof Error ? err.message : "Scrape failed"
    try {
      await tracker?.flush()
      const flipped = await markJobFailed(jobId, { error_message: message, extra: { output_data: { error: message } } })
      if (flipped && analysisHold) {
        // The scrape failed, so its fixed price is refunded; any analysis
        // the provider already billed is charged (never refunded, D10).
        await settleFixedPlusLlmCalls(jobId, analysisHold, analysisSpend, "refund")
      } else if (flipped && usageLogId) await refundReservedCreditsForJob(jobId)
      else if (!flipped && analysisHold) await settleFixedPlusLlmCallsAfterCancel(jobId)
    } catch (failErr) {
      log.error({ err: failErr, jobId }, "[instagram-scrape] failed to mark job failed / refund")
    }
    log.error({ err, jobId }, "[instagram-scrape] scrape failed")
  }
}
