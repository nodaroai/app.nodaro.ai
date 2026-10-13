import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { insertSyncJob } from "../lib/insert-job.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
// Core-safe commit/refund (keyed by job id, `ee/` reached via dynamic import) —
// keeps this route out of the core→ee allowlist that web-scrape still sits on.
import { commitReservedCreditsForJob, refundReservedCreditsForJob } from "../lib/credits-job-lifecycle.js"
// The two job-status funnels (CAS-guarded against a mid-flight cancel) instead
// of a direct jobs UPDATE — no service-role client in this file, and the
// completion/failure invariants stay in one place.
import { commitJobCredits, markJobCompleted } from "../workers/shared.js"
import { markJobFailed } from "../lib/job-failure.js"
import { baseCreditCostFor } from "../lib/credit-base-cost.js"
import { runMetaAdsScrape, type MetaAd } from "../providers/apify/meta-ads.js"
import { searchMetaAdvertisers } from "../providers/apify/meta-ads-advertisers.js"
import { MissingProviderKeyError } from "../providers/provider-keys.js"
import { classifyAndStoreMetaAdsMedia, metaAdsWithoutMedia } from "../lib/meta-ads-media.js"
import { analyzeMetaAds } from "../lib/meta-ads-analysis.js"
import {
  LLM_FEATURE_DEFAULTS,
  LLM_MODEL_IDS,
  META_ADS_ADVERTISER_MAX_RESULTS,
  META_ADS_ANALYSIS_FOCUS_MAX,
  META_ADS_FORMATS,
  META_ADS_PLATFORMS,
  STRUCTURED_VISION_MODELS,
  clampMetaAdsFeaturedIndex,
  featuredMetaAdOutputs,
  isFacebookPageUrl,
  metaAdsAdvertisersFrom,
  metaAdsAnalysisCreditId,
  metaAdsAnalysisTierFrom,
  META_ADS_SCRAPE_DEFAULT_COUNT,
  META_ADS_SCRAPE_DEFAULT_COUNTRY,
  META_ADS_SCRAPE_MAX_COUNT,
  META_ADS_SCRAPE_MAX_QUERY_LENGTH,
  META_ADS_SCRAPE_MAX_SOURCES,
  META_ADS_SCRAPE_NODE_TYPE,
  META_ADS_SCRAPE_PERIODS,
  META_ADS_SCRAPE_STATUSES,
  buildMetaAdsScrapeCreditId,
  resolveMetaAdsScrapeCreditId,
} from "@nodaro/shared"
import { extractWorkflowId, extractNodeId, extractForcePrivate, wantsJobIdFirst } from "../lib/request-helpers.js"
import { buildJobInputData } from "../lib/job-input-data.js"
import { normalizeWebUrlInput } from "../lib/web-url-input.js"
import { formatZodError } from "../lib/zod-error.js"
import { sendInternalError } from "../lib/http-errors.js"
import { config } from "../lib/config.js"
import { shouldRunOnCloud } from "../providers/nodaro/run-on-cloud.js"
import { callCloudRoute, createCloudJob, waitForCloudJob } from "../providers/nodaro/client.js"

const ROUTE_PATH = "/v1/meta-ads-scrape"
const ADVERTISERS_ROUTE_PATH = "/v1/meta-ads-scrape/advertisers"

/** A name to look up; Meta's own search box floor is two characters. */
const advertisersBody = z.object({
  query: z.string().trim().min(2).max(META_ADS_SCRAPE_MAX_QUERY_LENGTH),
})

/**
 * Lookups charge no credits but each cache miss starts an actor run on OUR
 * account, and the per-route rate limit is keyed by credential (a refreshed
 * JWT is a fresh bucket). So a second, per-USER meter: a daily allowance
 * counted after auth, where the identity is known. In-memory per process
 * like the route limiter; generous for any real use, fatal for a loop.
 */
export const META_ADS_ADVERTISER_LOOKUPS_PER_DAY = 100
const lookupsToday = new Map<string, { readonly day: string; count: number }>()

/** True when this user may run one more lookup today (and counts it). */
export function takeAdvertiserLookup(userId: string, now: () => number = Date.now): boolean {
  const day = new Date(now()).toISOString().slice(0, 10)
  const row = lookupsToday.get(userId)
  if (!row || row.day !== day) {
    lookupsToday.set(userId, { day, count: 1 })
    return true
  }
  if (row.count >= META_ADS_ADVERTISER_LOOKUPS_PER_DAY) return false
  row.count += 1
  return true
}

/** Test seam. */
export function _resetAdvertiserLookupMeterForTests(): void {
  lookupsToday.clear()
}

/**
 * No Apify token of its own + a live nodaro.ai connection: the connection
 * runs the scrape (billed to the connected account) and this route relays
 * the result. Mirrors web-scrape.
 *
 * The relay asks the cloud for the job id first and polls it: the cloud sits
 * behind the same ~100 s edge timeout a browser does. A cloud that predates
 * `respondAsync` ignores the flag and answers when the work is done — that
 * answer carries a `jobId` too, and the poll finds the job already terminal,
 * so a run UNDER the edge timeout reads the same way against both generations.
 * A longer one against such a cloud is cut off exactly as it always was — no
 * better, no worse. The cloud job's `output_data` is the shape this route
 * builds locally.
 */
async function scrapeViaConnection(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const cloudJobId = await createCloudJob(ROUTE_PATH, { ...body, respondAsync: true })
  const cloudJob = await waitForCloudJob(cloudJobId)
  return (cloudJob.output_data as Record<string, unknown> | null) ?? {}
}

type ScrapeOutcome =
  | { readonly ok: true; readonly result: Record<string, unknown> }
  | { readonly ok: false; readonly status: number; readonly code: string; readonly message: string }

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

const STRUCTURED_VISION_MODEL_IDS = new Set(STRUCTURED_VISION_MODELS.map((m) => m.id))

/** The request owns 600 s; the actor may take 480 of them. Media work never starts past this point. */
const MEDIA_DEADLINE_MS = 570_000

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

export async function metaAdsScrapeRoutes(app: FastifyInstance) {
  // Advertiser lookup for the editor's "advertiser" mode: a name → the
  // Facebook Pages that match it; the pick's Page url then runs through the
  // scrape route in pages mode. No credits (a fraction of a cent of actor
  // time), so it is rate-limited per caller and cached per query in the
  // provider. A keyless install relays it exactly like the scrape. Literal
  // path on purpose: route-path-parity.test.ts greps for it.
  app.post("/v1/meta-ads-scrape/advertisers", {
    config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
  }, async (req, reply) => {
    const parsed = advertisersBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: "validation_error", ...formatZodError(parsed.error) },
      })
    }
    const userId = req.userId
    if (!userId) {
      return reply.status(401).send({ error: { code: "unauthorized", message: "Authentication required" } })
    }
    if (!takeAdvertiserLookup(userId)) {
      return reply.status(429).send({
        error: { code: "rate_limit_exceeded", message: `Advertiser lookups are limited to ${META_ADS_ADVERTISER_LOOKUPS_PER_DAY} a day.` },
      })
    }
    try {
      const viaCloud = await shouldRunOnCloud(config.APIFY_API_TOKEN)
      const lookup = viaCloud
        ? { items: metaAdsAdvertisersFrom((await callCloudRoute(ADVERTISERS_ROUTE_PATH, { query: parsed.data.query })).advertisers, META_ADS_ADVERTISER_MAX_RESULTS), cached: false }
        : await searchMetaAdvertisers(parsed.data.query)
      // The only trace a lookup leaves — no job row, no usage log — so volume is visible.
      req.log.info({ userId, query: parsed.data.query, matches: lookup.items.length, cached: lookup.cached, viaCloud }, "[meta-ads-scrape] advertiser lookup")
      return reply.send({ advertisers: lookup.items })
    } catch (err) {
      // A missing key says exactly what to do (connect nodaro.ai / add the
      // key) — that message must reach the panel. Everything else is a fixed
      // line: the detail is logged, not shown.
      if (err instanceof MissingProviderKeyError) {
        return reply.status(503).send({ error: { code: err.code, message: err.message } })
      }
      req.log.warn({ err, userId }, "[meta-ads-scrape] advertiser lookup failed")
      return reply.status(502).send({ error: { code: "lookup_error", message: "Advertiser lookup failed — try again in a moment." } })
    }
  })

  // Literal path on purpose: sync-http-route-parity.test.ts greps for it.
  app.post("/v1/meta-ads-scrape", {
    // Guard reads the RAW body (pre-Zod) and only CHECKS affordability — a
    // malformed body is checked at the fixed mid tier and the 400 below fires
    // before any reservation is made.
    preHandler: creditGuard((req) => resolveMetaAdsScrapeCreditId(req.body)),
    config: { requestTimeout: 600_000 } as Record<string, unknown>,
  }, async (req, reply) => {
    req.raw.setTimeout(600_000)
    reply.raw.setTimeout(600_000)
    const startedAt = Date.now()

    const parsed = metaAdsScrapeBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: "validation_error", ...formatZodError(parsed.error) },
      })
    }

    const userId = req.userId
    if (!userId) {
      return reply.status(401).send({ error: { code: "unauthorized", message: "Authentication required" } })
    }

    const body = parsed.data
    const advertiserNames = body.mode === "pages" ? (body.advertiserNames ?? []) : []
    if (body.mode === "pages") {
      const total = body.pageUrls.length + advertiserNames.length
      if (total < 1 || total > META_ADS_SCRAPE_MAX_SOURCES) {
        return reply.status(400).send({
          error: { code: "validation_error", message: `Provide 1 to ${META_ADS_SCRAPE_MAX_SOURCES} Facebook Page URLs or advertiser names.` },
        })
      }
    }

    const analysisTier = metaAdsAnalysisTierFrom(body)
    // Decided up front: a keyless install relays the WHOLE run (scrape,
    // advertiser resolution and analysis) to the connected account, so only a
    // local run needs an LLM key — and a run that could never analyse must
    // refuse before it reserves.
    const viaCloud = await shouldRunOnCloud(config.APIFY_API_TOKEN)
    if (analysisTier && !viaCloud && !config.KIE_API_KEY && !config.ANTHROPIC_API_KEY && !config.GEMINI_API_KEY) {
      return reply.status(503).send({
        error: { code: "provider_unavailable", message: "AI analysis needs an LLM key (KIE_API_KEY, ANTHROPIC_API_KEY or GEMINI_API_KEY) — or run without analysis." },
      })
    }

    // Advertiser names → Page urls, resolved here (before anything is
    // reserved) so a name that finds nobody fails cleanly with no job. Cloud
    // relays the names untouched — the connected account resolves them. The
    // heuristic: the first VERIFIED match, else the first (that is what tells
    // the real brand from a fan page).
    let resolvedPageUrls = body.mode === "pages" ? [...body.pageUrls] : []
    let resolvedAdvertisers: Array<{ name: string; pageId: string; url: string }> = []
    if (advertiserNames.length > 0 && !viaCloud) {
      // Case-insensitive dedupe: a repeated name is one lookup and one source.
      const uniqueNames = [...new Map(advertiserNames.map((n) => [n.toLowerCase(), n])).values()]
      let metered = true
      for (const name of uniqueNames) {
        // Each resolution is an actor start on our account — meter it per user
        // exactly like the standalone lookup route, so a paid scrape cannot be
        // a free, unbounded, un-audited way to hammer the actor. On exhaustion
        // stop resolving; the names left over simply don't resolve.
        if (!takeAdvertiserLookup(userId)) { metered = false; break }
        try {
          const lookup = await searchMetaAdvertisers(name)
          const pick = lookup.items.find((a) => a.verified) ?? lookup.items[0]
          req.log.info({ userId, name, matches: lookup.items.length, cached: lookup.cached, matched: !!pick }, "[meta-ads-scrape] advertiser name resolution")
          if (pick) resolvedAdvertisers.push({ name, pageId: pick.pageId, url: pick.url })
        } catch (err) {
          req.log.warn({ err, name }, "[meta-ads-scrape] advertiser name resolution failed")
        }
      }
      resolvedPageUrls = [...resolvedPageUrls, ...resolvedAdvertisers.map((a) => a.url)]
      if (resolvedPageUrls.length === 0) {
        return reply.status(metered ? 404 : 429).send(
          metered
            ? { error: { code: "advertiser_not_found", message: `No Facebook advertiser matched ${advertiserNames.map((n) => `"${n}"`).join(", ")}.` } }
            : { error: { code: "rate_limit_exceeded", message: `Advertiser lookups are limited to ${META_ADS_ADVERTISER_LOOKUPS_PER_DAY} a day.` } },
        )
      }
    }

    // Sources bill AFTER resolution: page urls plus the names that resolved
    // (cloud can't be resolved here, so its names count as sources — the guard
    // over-checked the same way).
    const sources = body.mode === "pages"
      ? (viaCloud ? body.pageUrls.length + advertiserNames.length : resolvedPageUrls.length)
      : 1
    const modelIdentifier = buildMetaAdsScrapeCreditId({ count: body.count, sources, analysis: analysisTier })

    const { data: job, error: jobError } = await insertSyncJob(req, {
      workflow_id: extractWorkflowId(req.body),
      node_id: extractNodeId(req.body),
      force_private: extractForcePrivate(req.body) || undefined,
      user_id: userId,
      status: "pending",
      input_data: buildJobInputData(body, META_ADS_SCRAPE_NODE_TYPE),
    })

    if (jobError || !job) {
      return sendInternalError(reply, req, jobError, "Failed to create job")
    }

    const reservation = await reserveCreditsForJob(req, reply, job.id, modelIdentifier)
    if (reply.sent) return
    const usageLogId = reservation?.usageLogId

    /**
     * Run the scrape and settle the job — the ONE body both reply modes share,
     * so what is charged and what is stored cannot differ between them.
     *
     * Never throws: in the job-id-first mode nothing awaits it, and an escaping
     * rejection there is an unhandled one. Mark-failed and the refund are
     * themselves wrapped, so a failure inside them is logged, not thrown.
     */
    const runAndSettle = async (): Promise<ScrapeOutcome> => {
      try {
        // Local run scrapes the resolved Page urls (names already turned into
        // urls above); cloud gets the raw body (names included) to resolve itself.
        const scrapeArgs = body.mode === "pages" ? { ...body, pageUrls: resolvedPageUrls } : body
        const scraped = viaCloud
          ? await scrapeViaConnection(body as Record<string, unknown>)
          : await runMetaAdsScrape(scrapeArgs)
        // Cloud reports who it resolved; surface that instead of the local list.
        const relayedResolved = (scraped as Record<string, unknown>).resolvedAdvertisers
        if (viaCloud && Array.isArray(relayedResolved)) {
          resolvedAdvertisers = relayedResolved as typeof resolvedAdvertisers
        }

        // Classify every creative's format, apply the format filter, and copy
        // the kept creatives into the user's library (durable urls) — under
        // the request deadline, never failing the paid scrape. A cloud relay
        // already stored them on the connected account, so only classify.
        const scrapedAds = (Array.isArray(scraped.json) ? scraped.json : []) as MetaAd[]
        const featuredIndex = clampMetaAdsFeaturedIndex(body.featuredIndex, scrapedAds.length)
        const media = await classifyAndStoreMetaAdsMedia(scrapedAds, {
          userId,
          jobId: job.id,
          deadlineAt: startedAt + MEDIA_DEADLINE_MS,
          storeImages: !viaCloud,
          storeFeaturedVideoIndex: body.ingestVideo && !viaCloud ? featuredIndex : undefined,
          storeAllVideos: body.ingestAllVideos === true && !viaCloud,
          formats: body.formats,
        }).catch((err: unknown) => {
          // The media step degrades internally; this is the belt to its braces —
          // a scrape the user already paid for never fails because the library
          // copy did. Source urls go out instead (they expire; the UI says so).
          req.log.warn({ err, jobId: job.id }, "[meta-ads-scrape] media step failed; returning the ads with their source urls")
          return { ads: metaAdsWithoutMedia(scrapedAds), stats: { classified: 0, stored: 0, videosStored: 0, kept: scrapedAds.length, filteredOut: 0 } }
        })
        // Per-ad AI analysis, under what is left of the same deadline. A cloud
        // relay already analysed on the connected account (its `analysis`
        // stats ride along); locally each ad is one structured vision call.
        const analysisModel = body.analysisModel ?? LLM_FEATURE_DEFAULTS["meta-ads-analysis"]
        const analyzed = analysisTier && !viaCloud
          ? await analyzeMetaAds(media.ads, { modelId: analysisModel, focus: body.analysisFocus, deadlineAt: startedAt + MEDIA_DEADLINE_MS })
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
        const completed = await markJobCompleted(job.id, {
          output_data: result,
          ...(analyzed ? { provider_cost: analyzed.stats.providerCostUsd || null } : {}),
        })
        if (!completed) {
          req.log.info({ jobId: job.id }, "[meta-ads-scrape] job left pending before completion; skipping settlement")
          return { ok: false, status: 409, code: "job_cancelled", message: "The job was cancelled before it completed." }
        }

        // The job IS completed and its result stored from here on, so a commit
        // that fails must not fall into the catch below: `markJobFailed` would
        // miss its CAS on a completed row, nothing would be refunded, and a held
        // caller would get a 502 for ads that are sitting on the job. The
        // reservation stays `reserved` and this line is what ops finds it by.
        const settle = async (): Promise<void> => {
          if (!usageLogId) return
          if (analyzed && analysisTier) {
            // The reservation priced analysis per REQUESTED ad; settle per ad
            // actually analysed (count-based metered commit: BASE credits in,
            // the reservation's own margin re-applied, never above the reservation).
            const [scrapeBase, perAd] = await Promise.all([
              baseCreditCostFor(buildMetaAdsScrapeCreditId({ count: body.count, sources })),
              baseCreditCostFor(metaAdsAnalysisCreditId(analysisTier)),
            ])
            await commitJobCredits(usageLogId, job.id, null, scrapeBase + perAd * analyzed.stats.analyzed, true)
          } else {
            await commitReservedCreditsForJob(job.id)
          }
        }
        await settle().catch((commitErr: unknown) => {
          req.log.error({ err: commitErr, jobId: job.id }, "[meta-ads-scrape] job completed but its reservation did not commit")
        })

        return { ok: true, result }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Scrape failed"
        try {
          // Refund only when WE flipped the row — a cancelled job was refunded by cancel.
          const flipped = await markJobFailed(job.id, { error_message: message, extra: { output_data: { error: message } } })
          if (flipped && usageLogId) await refundReservedCreditsForJob(job.id)
        } catch (failErr) {
          req.log.error({ err: failErr, jobId: job.id }, "[meta-ads-scrape] failed to mark job failed / refund")
        }
        req.log.error({ err, jobId: job.id }, "[meta-ads-scrape] scrape failed")
        return { ok: false, status: 502, code: "scrape_error", message }
      }
    }

    // Job id first: the scrape, the media copy and the analysis run as detached
    // work and the caller polls GET /v1/jobs/:id. A run that copies every video
    // and analyses every ad outlasts the ~100 s edge timeout — held open, the
    // browser is cut off with a 524 while the job finishes server-side and is
    // charged. Durability is unchanged: the work was always in-process here.
    if (wantsJobIdFirst(req.body)) {
      reply.send({ jobId: job.id, status: "pending" })
      void runAndSettle()
      return
    }

    const outcome = await runAndSettle()
    if (!outcome.ok) {
      return reply.status(outcome.status).send({ error: { code: outcome.code, message: outcome.message } })
    }
    return reply.send({ jobId: job.id, ...outcome.result })
  })
}
