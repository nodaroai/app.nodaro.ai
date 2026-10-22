/**
 * The two price parts of a Meta Ads or Instagram scrape with AI analysis while
 * metered LLM pricing is on: the scrape's own fixed id (no analysis suffix), and
 * the requested items, each analysed by one call of the analysis model — the
 * item count and model both routes hold through `reserveFixedPlusLlmCalls`
 * (the analysis feature `meta-ads-analysis`, both scrapes). ONE rule for the
 * server's estimate and the editor's, so the two can never price a scrape
 * apart. Pure; null for a scrape without analysis and for any other node.
 */
import { LLM_FEATURE_DEFAULTS, llmPriceKey } from "./llm-models.js"
import { unitQuoteCreditId } from "./credit-estimators/unit-quote.js"
import {
  META_ADS_SCRAPE_DEFAULT_COUNT,
  META_ADS_SCRAPE_MAX_COUNT,
  META_ADS_SCRAPE_MAX_SOURCES,
  buildMetaAdsScrapeCreditId,
  metaAdsAnalysisTierFrom,
  metaAdsScrapeSources,
} from "./meta-ads-scrape.js"
import {
  INSTAGRAM_SCRAPE_DEFAULT_COUNT,
  INSTAGRAM_SCRAPE_MAX_COUNT,
  buildInstagramScrapeCreditId,
  instagramAnalysisTierFrom,
  instagramRequestedCount,
  instagramScrapeMode,
  instagramScrapeSources,
} from "./instagram-scrape.js"

/** The analysis feature both scrapes bill their per-item analysis under. */
export const SCRAPE_ANALYSIS_FEATURE = "meta-ads-analysis"

export interface ScrapeAnalysisPriceParts {
  /** The scrape's own fixed credit id (no analysis suffix). */
  readonly fixedId: string
  /** The model every item's analysis call runs on. */
  readonly analysisModel: string
  /** How many analysis calls the run holds: the items requested. */
  readonly items: number
}

const clamp = (n: number, max: number) => Math.min(Math.max(Math.trunc(n) || 1, 1), max)

export function scrapeAnalysisPriceParts(node: { readonly type?: string; readonly data?: Record<string, unknown> }): ScrapeAnalysisPriceParts | null {
  const data = node.data ?? {}
  const analysisModel = typeof data.analysisModel === "string" && data.analysisModel ? data.analysisModel : LLM_FEATURE_DEFAULTS[SCRAPE_ANALYSIS_FEATURE]
  if (node.type === "meta-ads-scrape" && metaAdsAnalysisTierFrom(data)) {
    const count = typeof data.count === "number" ? data.count : META_ADS_SCRAPE_DEFAULT_COUNT
    const sources = metaAdsScrapeSources(data)
    return { fixedId: buildMetaAdsScrapeCreditId({ count, sources }), analysisModel, items: clamp(count, META_ADS_SCRAPE_MAX_COUNT) * clamp(sources, META_ADS_SCRAPE_MAX_SOURCES) }
  }
  if (node.type === "instagram-scrape" && instagramAnalysisTierFrom(data)) {
    // The count the route accepts (its Zod: 1..INSTAGRAM_SCRAPE_MAX_COUNT), as the run sends it.
    const stored = typeof data.count === "number" ? data.count : INSTAGRAM_SCRAPE_DEFAULT_COUNT
    const count = instagramRequestedCount(instagramScrapeMode(data.mode as string | undefined), clamp(stored, INSTAGRAM_SCRAPE_MAX_COUNT))
    const sources = instagramScrapeSources(data)
    return { fixedId: buildInstagramScrapeCreditId({ count, sources }), analysisModel, items: Math.max(1, count * sources) }
  }
  return null
}

/**
 * The whole analysis of a scrape as ONE price id: `<analysis key>:<items>u`
 * (`unitQuoteCreditId` on the analysis model's metered price key). The server
 * prices it as the run is held: the key's estimate × the items, rounded up
 * once, marked up once at the call's charge id — so a client quotes the
 * scrape's fixed id plus this, never the served one-call estimate × the items
 * (rounded up per call, and marked up per call). Answered as an estimate while
 * metered pricing is on; `missing` under the rollback.
 */
export function scrapeAnalysisQuoteId(parts: ScrapeAnalysisPriceParts): string {
  return unitQuoteCreditId(llmPriceKey(SCRAPE_ANALYSIS_FEATURE, parts.analysisModel), parts.items)
}
