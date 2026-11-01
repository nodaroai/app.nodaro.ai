/**
 * Meta Ads Library scrape: what a run is (its body), the plan its route decides
 * before it reserves (who runs it, which Pages, how the analysis bills), and
 * the one settle both of its modes share — the `meta-ads-scrape` video-worker
 * job for a request answered with a job id, and the route itself for a
 * synchronous one. The ad analysis runs inside the settle, so on the worker
 * its LLM calls run under the job's own provider slot and take none of their own.
 */
import { z } from "zod"
import { commitJobCredits, markJobCompleted } from "../../workers/shared.js"
import { markJobFailed } from "../job-failure.js"
import { commitReservedCreditsForJob, refundReservedCreditsForJob } from "../credits-job-lifecycle.js"
import { baseCreditCostFor } from "../credit-base-cost.js"
import { runMetaAdsScrape, type MetaAd } from "../../providers/apify/meta-ads.js"
import { classifyAndStoreMetaAdsMedia, metaAdsWithoutMedia } from "../meta-ads-media.js"
import { analyzeMetaAds } from "../meta-ads-analysis.js"
import { LlmSpend } from "../llm-billing.js"
import { fixedPlusLlmSpendTracker, settleFixedPlusLlmCalls, settleFixedPlusLlmCallsAfterCancel, type FixedPlusLlmHold } from "../llm-fixed-plus-calls.js"
import { LLM_MODEL_IDS, STRUCTURED_VISION_MODELS } from "@nodaro/shared/llm-models"
import {
  META_ADS_ANALYSIS_FOCUS_MAX,
  META_ADS_FORMATS,
  META_ADS_PLATFORMS,
  META_ADS_SCRAPE_DEFAULT_COUNT,
  META_ADS_SCRAPE_DEFAULT_COUNTRY,
  META_ADS_SCRAPE_MAX_COUNT,
  META_ADS_SCRAPE_MAX_QUERY_LENGTH,
  META_ADS_SCRAPE_MAX_SOURCES,
  META_ADS_SCRAPE_PERIODS,
  META_ADS_SCRAPE_STATUSES,
  buildMetaAdsScrapeCreditId,
  clampMetaAdsFeaturedIndex,
  featuredMetaAdOutputs,
  isFacebookPageUrl,
  metaAdsAnalysisCreditId,
  type MetaAdsAnalysisTier,
} from "@nodaro/shared/social"
import { normalizeWebUrlInput } from "../web-url-input.js"
import { createCloudJob, waitForCloudJob } from "../../providers/nodaro/client.js"
import { SCRAPE_MEDIA_DEADLINE_MS, type BackgroundScrapeJobBase, type ScrapeLog, type ScrapeOutcome } from "./common.js"
import { apifyRunHooks, cloudJobOf, type ScrapeRunTracker } from "./scrape-run.js"

export { META_ADS_SCRAPE_JOB_TYPE } from "./job-types.js"

const ROUTE_PATH = "/v1/meta-ads-scrape"


const STRUCTURED_VISION_MODEL_IDS = new Set(STRUCTURED_VISION_MODELS.map((m) => m.id))

/**
 * A Facebook PAGE address — scheme inferred like every other url field, then
 * pinned to facebook.com so the actor is never handed an arbitrary site. The
 * SAME predicate that admits a stored advertiser pick (packages/shared), so a
 * pick the card shows and the badge quotes can never be one Zod rejects.
 */
const facebookPageUrl = z.preprocess(
  normalizeWebUrlInput,
  z.string().url().max(2048).refine(isFacebookPageUrl, { message: "Expected a Facebook Page URL (https://www.facebook.com/page-name)" }),
)

const countryCode = z.preprocess(
  (value) => (typeof value === "string" ? value.trim().toUpperCase() : value),
  z.string().regex(/^(ALL|[A-Z]{2})$/, "Expected a 2-letter country code or ALL").default(META_ADS_SCRAPE_DEFAULT_COUNTRY),
)

const commonFields = {
  count: z.number().int().min(1).max(META_ADS_SCRAPE_MAX_COUNT).default(META_ADS_SCRAPE_DEFAULT_COUNT),
  period: z.enum(META_ADS_SCRAPE_PERIODS).default("30d"),
  activeStatus: z.enum(META_ADS_SCRAPE_STATUSES).default("active"),
  countryCode,
  /** Empty / every platform = no filter (the provider treats both the same). */
  platforms: z.array(z.enum(META_ADS_PLATFORMS)).max(META_ADS_PLATFORMS.length).optional(),
  /** Keep only ads whose primary creative has one of these formats (classified from its pixels); empty = all. May return fewer than `count`. */
  formats: z.array(z.enum(META_ADS_FORMATS)).max(META_ADS_FORMATS.length).optional(),
  /** Which returned ad feeds the typed text / image / video outputs (clamped). */
  featuredIndex: z.number().int().min(0).optional(),
  /** Copy the featured ad's video into the library too (only when its video output is wired — the expensive bytes). */
  ingestVideo: z.boolean().optional(),
  /** Copy EVERY returned ad's video into the library (the "copy all videos" setting — the expensive bytes, opt-in). */
  ingestAllVideos: z.boolean().optional(),
  /** Per-ad AI analysis (the "competitor ad analyst" pass): priced per requested ad by the model's tier, settled per ad analysed. */
  analyze: z.boolean().optional(),
  /** An image-capable structured-output model; absent = the feature default. */
  analysisModel: z
    .enum(LLM_MODEL_IDS as [string, ...string[]])
    .refine((id) => STRUCTURED_VISION_MODEL_IDS.has(id), { message: "analysisModel must be an image-capable model with structured output" })
    .optional(),
  /** The user's optional analyst focus, appended to the fixed prompt. */
  analysisFocus: z.string().trim().max(META_ADS_ANALYSIS_FOCUS_MAX).optional(),
}

const searchBody = z.object({
  mode: z.literal("search"),
  query: z.string().trim().min(1).max(META_ADS_SCRAPE_MAX_QUERY_LENGTH),
  ...commonFields,
})

const pagesBody = z.object({
  mode: z.literal("pages"),
  // Either Page urls, advertiser names to resolve, or both — the combined
  // count (1..MAX_SOURCES) is checked in the handler (a discriminated-union
  // member must stay a bare object, so no cross-field refine here).
  pageUrls: z.array(facebookPageUrl).max(META_ADS_SCRAPE_MAX_SOURCES).default([]),
  advertiserNames: z.array(z.string().trim().min(2).max(META_ADS_SCRAPE_MAX_QUERY_LENGTH)).max(META_ADS_SCRAPE_MAX_SOURCES).optional(),
  ...commonFields,
})

export const metaAdsScrapeBody = z.discriminatedUnion("mode", [searchBody, pagesBody])
export type MetaAdsScrapeBody = z.infer<typeof metaAdsScrapeBody>

export interface ResolvedAdvertiser {
  readonly name: string
  readonly pageId: string
  readonly url: string
}

/**
 * What the route decides before it reserves, all from the validated body and
 * server state — never a client field: who runs the scrape (`viaCloud`), the
 * Page urls its advertiser names resolved to (resolved in the route, where the
 * per-user lookup meter lives), the sources billed, and how the analysis bills
 * (`analysisHold` when it is metered).
 */
export interface MetaAdsScrapePlan {
  readonly body: MetaAdsScrapeBody
  readonly viaCloud: boolean
  readonly resolvedPageUrls: readonly string[]
  readonly resolvedAdvertisers: readonly ResolvedAdvertiser[]
  readonly sources: number
  readonly analysisTier: MetaAdsAnalysisTier | null
  readonly analysisModel: string
  readonly analysisHold?: FixedPlusLlmHold
}

/** The `meta-ads-scrape` worker job's payload. */
export interface MetaAdsScrapeJobData extends BackgroundScrapeJobBase, MetaAdsScrapePlan {}

/**
 * No Apify token of its own + a live nodaro.ai connection: the connection
 * runs the scrape (billed to the connected account) and this job relays
 * the result. Mirrors web-scrape.
 *
 * The relay asks the cloud for the job id first and polls it: the cloud sits
 * behind the same ~100 s edge timeout a browser does. A cloud that predates
 * `respondAsync` ignores the flag and answers when the work is done — that
 * answer carries a `jobId` too, and the poll finds the job already terminal,
 * so a run UNDER the edge timeout reads the same way against both generations.
 * A longer one against such a cloud is cut off exactly as it always was — no
 * better, no worse. The cloud job's `output_data` is the shape this module
 * builds locally.
 */
async function scrapeViaConnection(body: Record<string, unknown>, runs: ScrapeRunTracker): Promise<Record<string, unknown>> {
  const cloudJobId = await cloudJobOf(runs, (idempotencyKey) => createCloudJob(ROUTE_PATH, { ...body, respondAsync: true }, { idempotencyKey }))
  const cloudJob = await waitForCloudJob(cloudJobId)
  return (cloudJob.output_data as Record<string, unknown> | null) ?? {}
}

export interface MetaAdsScrapeSettleInput extends MetaAdsScrapePlan {
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
 * Run the scrape, the media copy and the analysis, and settle the job — the
 * ONE body both reply modes share, so what is charged and what is stored
 * cannot differ between them.
 *
 * Never throws: the worker job must not be retried for a scrape that failed (a
 * retry would run — and bill — the provider again), and mark-failed and the
 * refund are themselves wrapped, so a failure inside them is logged, not thrown.
 */
export async function settleMetaAdsScrape(input: MetaAdsScrapeSettleInput): Promise<ScrapeOutcome> {
  const { jobId, userId, usageLogId, startedAt, runs, log, body, viaCloud, sources, analysisTier, analysisModel, analysisHold } = input
  let resolvedAdvertisers = [...input.resolvedAdvertisers]
  const analysisSpend = new LlmSpend()
  // Each analysis call is recorded as it returns (or fails) — every item is
  // a billed call — and the running ledger lands in the job's server-only
  // billing ledger (R32, never output_data) after each item, so a cancel mid-run commits what was already billed.
  const tracker = analysisHold ? fixedPlusLlmSpendTracker(jobId, analysisHold.chargeId, analysisSpend) : undefined
  try {
    // Local run scrapes the resolved Page urls (names already turned into
    // urls by the route); cloud gets the raw body (names included) to resolve itself.
    const scrapeArgs = body.mode === "pages" ? { ...body, pageUrls: [...input.resolvedPageUrls] } : body
    const scraped = viaCloud
      ? await scrapeViaConnection(body as Record<string, unknown>, runs)
      : await runMetaAdsScrape(scrapeArgs, apifyRunHooks(runs))
    // Cloud reports who it resolved; surface that instead of the local list.
    const relayedResolved = (scraped as Record<string, unknown>).resolvedAdvertisers
    if (viaCloud && Array.isArray(relayedResolved)) {
      resolvedAdvertisers = relayedResolved as typeof resolvedAdvertisers
    }

    // Classify every creative's format, apply the format filter, and copy
    // the kept creatives into the user's library (durable urls) — under
    // the run's deadline, never failing the paid scrape. A cloud relay
    // already stored them on the connected account, so only classify.
    const scrapedAds = (Array.isArray(scraped.json) ? scraped.json : []) as MetaAd[]
    const featuredIndex = clampMetaAdsFeaturedIndex(body.featuredIndex, scrapedAds.length)
    const media = await classifyAndStoreMetaAdsMedia(scrapedAds, {
      userId,
      jobId,
      deadlineAt: startedAt + SCRAPE_MEDIA_DEADLINE_MS,
      storeImages: !viaCloud,
      storeFeaturedVideoIndex: body.ingestVideo && !viaCloud ? featuredIndex : undefined,
      storeAllVideos: body.ingestAllVideos === true && !viaCloud,
      formats: body.formats,
    }).catch((err: unknown) => {
      // The media step degrades internally; this is the belt to its braces —
      // a scrape the user already paid for never fails because the library
      // copy did. Source urls go out instead (they expire; the UI says so).
      log.warn({ err, jobId }, "[meta-ads-scrape] media step failed; returning the ads with their source urls")
      return { ads: metaAdsWithoutMedia(scrapedAds), stats: { classified: 0, stored: 0, videosStored: 0, kept: scrapedAds.length, filteredOut: 0 } }
    })
    // Per-ad AI analysis, under what is left of the same deadline. A cloud
    // relay already analysed on the connected account (its `analysis`
    // stats ride along); locally each ad is one structured vision call.
    const analyzed = analysisTier && !viaCloud
      ? await analyzeMetaAds(media.ads, {
        modelId: analysisModel,
        focus: body.analysisFocus,
        deadlineAt: startedAt + SCRAPE_MEDIA_DEADLINE_MS,
        ...(tracker ? { complete: tracker.complete } : {}),
      })
      : null
    const ads = analyzed ? analyzed.ads : media.ads
    const relayedAnalysis = (scraped as Record<string, unknown>).analysis
    const analysisStats = analyzed
      ? { model: analysisModel, ...analyzed.stats }
      : viaCloud && relayedAnalysis && typeof relayedAnalysis === "object" ? relayedAnalysis : undefined
    const result = {
      json: ads,
      mediaStorage: media.stats,
      ...(analysisStats ? { analysis: analysisStats } : {}),
      // Who each advertiser NAME resolved to, so a list-driven run shows
      // which Page a name landed on.
      ...(resolvedAdvertisers.length > 0 ? { resolvedAdvertisers } : {}),
      // The featured ad's typed outputs ride on output_data so the
      // orchestrator's NodeOutput carries them (see output-extractor).
      ...featuredMetaAdOutputs(ads, featuredIndex),
    }

    // false = the user cancelled mid-flight and the cancel path already
    // refunded — returning the data would be a free scrape.
    // The last running-ledger write lands BEFORE the completion write.
    await tracker?.flush()
    const completed = await markJobCompleted(jobId, {
      output_data: result,
      ...(analyzed ? { provider_cost: analyzed.stats.providerCostUsd || null } : {}),
    })
    if (!completed) {
      // Cancelled mid-run: the analyses it billed are charged, never refunded
      // (D10) — the cancel kept the hold while a call was in flight, so the
      // job settles it now that its calls have ended. (A write lost to another
      // attempt's completion settles nothing there: that attempt owns it.)
      if (analysisHold) await settleFixedPlusLlmCallsAfterCancel(jobId)
      log.info({ jobId }, "[meta-ads-scrape] job left pending before completion; skipping settlement")
      return { ok: false, status: 409, code: "job_cancelled", message: "The job was cancelled before it completed." }
    }

    // The job IS completed and its result stored from here on, so a commit
    // that fails must not fall into the catch below: `markJobFailed` would
    // miss its CAS on a completed row, nothing would be refunded, and a held
    // caller would get a 502 for ads that are sitting on the job. The
    // reservation stays `reserved` and this line is what ops finds it by.
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
        // The reservation priced analysis per REQUESTED ad; settle per ad
        // actually analysed (count-based metered commit: BASE credits in,
        // the reservation's own margin re-applied, never above the reservation).
        const [scrapeBase, perAd] = await Promise.all([
          baseCreditCostFor(buildMetaAdsScrapeCreditId({ count: body.count, sources })),
          baseCreditCostFor(metaAdsAnalysisCreditId(analysisTier)),
        ])
        await commitJobCredits(usageLogId, jobId, null, scrapeBase + perAd * analyzed.stats.analyzed, true)
      } else {
        await commitReservedCreditsForJob(jobId)
      }
    }
    await settle().catch((commitErr: unknown) => {
      log.error({ err: commitErr, jobId }, "[meta-ads-scrape] job completed but its reservation did not commit")
    })

    return { ok: true, result }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Scrape failed"
    try {
      // Refund only when WE flipped the row — a cancelled job was refunded by cancel.
      await tracker?.flush()
      const flipped = await markJobFailed(jobId, { error_message: message, extra: { output_data: { error: message } } })
      if (flipped && analysisHold) {
        // The scrape failed, so its fixed price is refunded; any analysis
        // the provider already billed is charged (never refunded, D10).
        await settleFixedPlusLlmCalls(jobId, analysisHold, analysisSpend, "refund")
      } else if (flipped && usageLogId) await refundReservedCreditsForJob(jobId)
      else if (!flipped && analysisHold) await settleFixedPlusLlmCallsAfterCancel(jobId)
    } catch (failErr) {
      log.error({ err: failErr, jobId }, "[meta-ads-scrape] failed to mark job failed / refund")
    }
    log.error({ err, jobId }, "[meta-ads-scrape] scrape failed")
    return { ok: false, status: 502, code: "scrape_error", message }
  }
}
