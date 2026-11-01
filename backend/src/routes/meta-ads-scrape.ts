import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { insertSyncJob } from "../lib/insert-job.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
import { searchMetaAdvertisers } from "../providers/apify/meta-ads-advertisers.js"
import { MissingProviderKeyError } from "../providers/provider-keys.js"
import { adCreativeAnalysisPlannedCall } from "../lib/ad-creative-analysis.js"
import { reserveFixedPlusLlmCalls, type FixedPlusLlmHold } from "../lib/llm-fixed-plus-calls.js"
import { LLM_FEATURE_DEFAULTS } from "@nodaro/shared/llm-models"
import {
  META_ADS_ADVERTISER_MAX_RESULTS,
  metaAdsAdvertisersFrom,
  metaAdsAnalysisTierFrom,
  META_ADS_SCRAPE_MAX_COUNT,
  META_ADS_SCRAPE_MAX_QUERY_LENGTH,
  META_ADS_SCRAPE_MAX_SOURCES,
  buildMetaAdsScrapeCreditId,
  resolveMetaAdsScrapeCreditId,
} from "@nodaro/shared/social"
import { extractWorkflowId, extractNodeId, extractForcePrivate, wantsJobIdFirst } from "../lib/request-helpers.js"
import { buildJobInputData } from "../lib/job-input-data.js"
import { formatZodError } from "../lib/zod-error.js"
import { sendInternalError } from "../lib/http-errors.js"
import { config, llmMeteredPricing } from "../lib/config.js"
import { shouldRunOnCloud } from "../providers/nodaro/run-on-cloud.js"
import { callCloudRoute } from "../providers/nodaro/client.js"
import { extendSocketTimeout } from "../lib/llm-route-timeout.js"
import { laneGuard } from "../lib/concurrency-lanes/request-scope.js"
import { syncRouteLane } from "../lib/concurrency-lanes/sync-route-lanes.js"
import {
  META_ADS_SCRAPE_JOB_TYPE,
  metaAdsScrapeBody,
  settleMetaAdsScrape,
  type MetaAdsScrapeJobData,
  type MetaAdsScrapePlan,
  type ResolvedAdvertiser,
} from "../lib/background-scrape/meta-ads.js"
import { enqueueBackgroundScrape } from "../lib/background-scrape/enqueue.js"
import { scrapeRunTracker } from "../lib/background-scrape/scrape-run.js"

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
    preHandler: [
      creditGuard((req) => resolveMetaAdsScrapeCreditId(req.body)),
      // The lane last: a synchronous run waits for its slot before the handler
      // resolves advertisers or reserves; its ad analysis runs under the same
      // slot. A job-id-first request answers at once and takes none.
      laneGuard(...syncRouteLane("/v1/meta-ads-scrape")),
    ],
    config: { requestTimeout: 600_000 } as Record<string, unknown>,
  }, async (req, reply) => {
    extendSocketTimeout(req, reply, 600_000)
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
    const resolvedAdvertisers: ResolvedAdvertiser[] = []
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

    // The model the per-item analysis runs, when one is asked for (resolved before
    // the row so the row records it).
    const analysisModel = body.analysisModel ?? LLM_FEATURE_DEFAULTS["meta-ads-analysis"]
    const { data: job, error: jobError } = await insertSyncJob(req, {
      workflow_id: extractWorkflowId(req.body),
      node_id: extractNodeId(req.body),
      force_private: extractForcePrivate(req.body) || undefined,
      user_id: userId,
      status: "pending",
      input_data: { ...buildJobInputData(body, META_ADS_SCRAPE_JOB_TYPE), ...(analysisTier !== null ? { resolvedModel: analysisModel } : {}) },
    })

    if (jobError || !job) {
      return sendInternalError(reply, req, jobError, "Failed to create job")
    }

    // Per-ad analysis bills METERED (B5): the scrape keeps its fixed price and
    // each requested ad's analysis is held at one call's 1-attempt hold under
    // meta-ads-analysis:<model>, all in ONE reservation; the settle charges the
    // scrape plus what the analyses cost. Under the rollback — and for a cloud
    // relay, whose connected account runs and bills the analysis — the run
    // reserves its tier id exactly as before.
    const meteredAnalysis = analysisTier !== null && !viaCloud && llmMeteredPricing()
    let analysisHold: FixedPlusLlmHold | undefined
    let usageLogId: string | undefined
    if (meteredAnalysis) {
      const requestedAds = Math.min(Math.max(Math.trunc(body.count) || 1, 1), META_ADS_SCRAPE_MAX_COUNT)
        * Math.min(Math.max(sources, 1), META_ADS_SCRAPE_MAX_SOURCES)
      // Held at the typical per-ad cost × the ads requested (D12); the
      // actual is collected at the settle. The planned call (one ad's request)
      // makes the model fail closed when a lane it may use has no rate.
      const planned = adCreativeAnalysisPlannedCall({ modelId: analysisModel, focus: body.analysisFocus })
      analysisHold = await reserveFixedPlusLlmCalls(req, reply, job.id, {
        fixedId: buildMetaAdsScrapeCreditId({ count: body.count, sources }),
        feature: "meta-ads-analysis",
        modelId: analysisModel,
        items: requestedAds,
        plannedRequest: planned.request,
      })
      if (!analysisHold) return
      usageLogId = analysisHold.usageLogId
    } else {
      const reservation = await reserveCreditsForJob(req, reply, job.id, modelIdentifier)
      if (reply.sent) return
      usageLogId = reservation?.usageLogId
    }

    // Everything the run needs, decided here from the validated body and
    // server state: the same plan in both modes.
    const plan: MetaAdsScrapePlan = {
      body, viaCloud, resolvedPageUrls, resolvedAdvertisers, sources, analysisTier, analysisModel,
      ...(analysisHold ? { analysisHold } : {}),
    }

    // Job id first: the scrape, the media copy and the analysis run as the
    // `meta-ads-scrape` video-worker job and the caller polls GET /v1/jobs/:id.
    // A run that copies every video and analyses every ad outlasts the ~100 s
    // edge timeout — held open, the browser is cut off with a 524 while the
    // job finishes server-side and is charged. On the worker it survives a
    // deploy, waits for its slot there, and its analysis runs under that slot.
    if (wantsJobIdFirst(req.body)) {
      const data: MetaAdsScrapeJobData = { ...plan, jobId: job.id, userId, billingContext: req.billingContext, usageLogId }
      return enqueueBackgroundScrape(req, reply, META_ADS_SCRAPE_JOB_TYPE, { ...data })
    }

    // Synchronous: the run happens in the request, under the slot its
    // laneGuard took (the analysis included) — the same settle the worker job runs.
    const outcome = await settleMetaAdsScrape({ ...plan, jobId: job.id, userId, usageLogId, startedAt, runs: scrapeRunTracker(job.id), log: req.log })
    if (!outcome.ok) {
      return reply.status(outcome.status).send({ error: { code: outcome.code, message: outcome.message } })
    }
    return reply.send({ jobId: job.id, ...outcome.result })
  })
}
