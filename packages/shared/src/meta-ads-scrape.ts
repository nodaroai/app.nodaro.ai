/**
 * Meta Ads scraper node — shared vocabulary + credit identifiers.
 *
 * The node pulls PUBLIC ads (Facebook + Instagram placements) out of Meta's
 * Ad Library, either by keyword search or by Facebook Page URL, and emits a
 * JSON array of normalized ads. Everything the backend guard/reservation, the
 * frontend credit badge and the docs formula must agree on lives here so the
 * three cannot drift apart.
 *
 * The editor has a third, node-only mode — "advertiser": pick advertisers by
 * name (a page lookup) and run as their Page urls. The wire contract stays
 * search / pages; `metaAdsScrapeWireSources` is the ONE mapping both engines
 * call, and `metaAdsScrapeSources` the ONE source count every quote reads.
 *
 * Pricing shape: 1 credit per REQUESTED ad, rounded UP to a fixed tier. The
 * requested total is `count × sources` (search = 1 source; pages = one per
 * URL). The route's Zod bounds `count ≤ 100` and `sources ≤ 5`, so the total
 * can never land outside the tier set — an identifier missing from
 * `model_pricing` is a 503 `price_not_configured`, never a silent fallback.
 */
import { LLM_CREDIT_RUNGS, LLM_FEATURE_DEFAULTS, llmCreditRung } from "./llm-models.js"

export const META_ADS_SCRAPE_NODE_TYPE = "meta-ads-scrape" as const

/** The WIRE modes — what `POST /v1/meta-ads-scrape` accepts. */
export const META_ADS_SCRAPE_MODES = ["search", "pages"] as const
export type MetaAdsScrapeMode = (typeof META_ADS_SCRAPE_MODES)[number]

/** The NODE modes — the wire modes plus the editor-only advertiser picker (runs as pages). */
export const META_ADS_NODE_MODES = [...META_ADS_SCRAPE_MODES, "advertiser"] as const
export type MetaAdsNodeMode = (typeof META_ADS_NODE_MODES)[number]

/** Coerce stored node data to a node mode; anything unknown is the default keyword search. */
export function metaAdsNodeMode(value: unknown): MetaAdsNodeMode {
  return typeof value === "string" && (META_ADS_NODE_MODES as readonly string[]).includes(value) ? (value as MetaAdsNodeMode) : "search"
}

/** An advertiser the user picked by name — stored on the node, run as its Page url. */
export interface MetaAdsAdvertiser {
  readonly pageId: string
  readonly name: string
  /** The Facebook Page url. The actor resolves it to the Ad Library advertiser itself — the Page id and the advertiser id are NOT the same number. */
  readonly url: string
  readonly imageUrl?: string
  readonly verified?: boolean
}

/** How many matches an advertiser lookup returns — more than the pick cap, so a same-name brand can be told apart by its badge / avatar. */
export const META_ADS_ADVERTISER_MAX_RESULTS = 8
const META_ADS_URL_MAX_LENGTH = 2048

function httpUrlOnHost(value: unknown, host: RegExp): value is string {
  if (typeof value !== "string" || value.length > META_ADS_URL_MAX_LENGTH) return false
  try {
    const url = new URL(value)
    return (url.protocol === "https:" || url.protocol === "http:") && host.test(url.hostname)
  } catch {
    return false
  }
}

/** http(s) url on facebook.com (any subdomain) — the ONE predicate for a Page address, on the route's Zod and on stored picks alike. */
export function isFacebookPageUrl(value: unknown): value is string {
  return httpUrlOnHost(value, /(^|\.)facebook\.com$/i)
}

/** A Page avatar lives on Meta's CDN; anything else is not stored (it would be fetched by every viewer's browser and our image proxy). */
export function isMetaCdnImageUrl(value: unknown): value is string {
  return httpUrlOnHost(value, /(^|\.)(fbcdn\.net|facebook\.com)$/i)
}

/** Stored / relayed advertisers, sanitized: a page id, a name, a facebook.com url, a Meta-CDN avatar; deduped by page id; at most `limit` (the pick cap by default). */
export function metaAdsAdvertisersFrom(raw: unknown, limit: number = META_ADS_SCRAPE_MAX_SOURCES): MetaAdsAdvertiser[] {
  if (!Array.isArray(raw) || limit < 1) return []
  const seen = new Set<string>()
  const out: MetaAdsAdvertiser[] = []
  for (const item of raw) {
    if (!item || typeof item !== "object") continue
    const r = item as Record<string, unknown>
    const pageId =
      typeof r.pageId === "string" ? r.pageId.trim() : typeof r.pageId === "number" && Number.isFinite(r.pageId) ? String(r.pageId) : ""
    const name = typeof r.name === "string" ? r.name.trim().slice(0, 120) : ""
    if (!pageId || !name || !isFacebookPageUrl(r.url) || seen.has(pageId)) continue
    seen.add(pageId)
    out.push({
      pageId,
      name,
      url: r.url,
      ...(isMetaCdnImageUrl(r.imageUrl) ? { imageUrl: r.imageUrl } : {}),
      ...(r.verified === true ? { verified: true } : {}),
    })
    if (out.length >= limit) break
  }
  return out
}

export const META_ADS_SCRAPE_PERIODS = ["24h", "7d", "30d", "all"] as const
export type MetaAdsScrapePeriod = (typeof META_ADS_SCRAPE_PERIODS)[number]

export const META_ADS_SCRAPE_STATUSES = ["active", "inactive", "all"] as const
export type MetaAdsScrapeStatus = (typeof META_ADS_SCRAPE_STATUSES)[number]

/** Meta's `publisher_platform` vocabulary — the values an ad's `platforms` carries and the filter the node accepts. */
export const META_ADS_PLATFORMS = ["FACEBOOK", "INSTAGRAM", "AUDIENCE_NETWORK", "MESSENGER", "WHATSAPP", "THREADS"] as const
export type MetaAdsPlatform = (typeof META_ADS_PLATFORMS)[number]

export function isMetaAdsPlatform(value: unknown): value is MetaAdsPlatform {
  return typeof value === "string" && (META_ADS_PLATFORMS as readonly string[]).includes(value)
}

/**
 * Creative format, classified from the creative's measured pixels — the
 * user's "phone vs web" question. `vertical` = Stories / Reels / mobile feed
 * (9:16, 4:5), `square` = 1:1 (±5 %), `horizontal` = feed / web / banners
 * (16:9, 1.91:1). One classifier for the route (node setting), the Results
 * chips and the card, so they can never disagree.
 */
export const META_ADS_FORMATS = ["vertical", "square", "horizontal"] as const
export type MetaAdsFormat = (typeof META_ADS_FORMATS)[number]
export type MetaAdsCreativeFormat = MetaAdsFormat | "unknown"

export function isMetaAdsFormat(value: unknown): value is MetaAdsFormat {
  return typeof value === "string" && (META_ADS_FORMATS as readonly string[]).includes(value)
}

/** The featured ad index, clamped so a rerun that returned fewer ads never indexes past the end. */
export function clampMetaAdsFeaturedIndex(stored: unknown, count: number): number {
  if (count <= 0) return 0
  const n = typeof stored === "number" && Number.isFinite(stored) ? Math.trunc(stored) : 0
  return Math.min(Math.max(n, 0), count - 1)
}

export interface FeaturedMetaAdOutputs {
  readonly text?: string
  readonly imageUrl?: string
  readonly videoUrl?: string
}

function urlStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string" && v.trim().length > 0) : []
}

/**
 * What the node's typed `text` / `image` / `video` handles carry: the
 * FEATURED ad's copy (headline + body), first image (else the video poster)
 * and first video. ONE derivation for the route's output_data, the backend
 * saved-output hydration and the editor's extractNodeOutput, so a thumb pick
 * re-hydrates the handles identically everywhere.
 */
export function featuredMetaAdOutputs(json: unknown, featuredIndex: unknown): FeaturedMetaAdOutputs {
  if (!Array.isArray(json) || json.length === 0) return {}
  const ad = json[clampMetaAdsFeaturedIndex(featuredIndex, json.length)]
  if (!ad || typeof ad !== "object") return {}
  const a = ad as Record<string, unknown>
  const title = typeof a.title === "string" ? a.title.trim() : ""
  const body = typeof a.text === "string" ? a.text.trim() : ""
  const text = [title, body].filter((s) => s.length > 0).join("\n\n")
  const imageUrl = urlStrings(a.images)[0] ?? urlStrings(a.videoPreviews)[0]
  const videoUrl = urlStrings(a.videos)[0]
  return {
    ...(text ? { text } : {}),
    ...(imageUrl ? { imageUrl } : {}),
    ...(videoUrl ? { videoUrl } : {}),
  }
}

export function classifyCreativeFormat(width: unknown, height: unknown): MetaAdsCreativeFormat {
  if (typeof width !== "number" || typeof height !== "number" || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return "unknown"
  }
  const ratio = width / height
  if (ratio < 0.95) return "vertical"
  if (ratio <= 1.05) return "square"
  return "horizontal"
}

/** Presets the config panel offers; the route accepts any integer 1..MAX_COUNT. */
export const META_ADS_SCRAPE_COUNT_OPTIONS = [10, 20, 50, 100] as const
export const META_ADS_SCRAPE_DEFAULT_COUNT = 20
export const META_ADS_SCRAPE_MAX_COUNT = 100
export const META_ADS_SCRAPE_MAX_SOURCES = 5
/** Meta caps Ad Library search terms at 100 characters. */
export const META_ADS_SCRAPE_MAX_QUERY_LENGTH = 100
export const META_ADS_SCRAPE_DEFAULT_COUNTRY = "ALL"

/** Requested-total buckets. Sorted ascending; the last one is `MAX_COUNT × MAX_SOURCES`. */
export const META_ADS_SCRAPE_TIERS = [10, 20, 50, 100, 200, 500] as const
export type MetaAdsScrapeTier = (typeof META_ADS_SCRAPE_TIERS)[number]

/**
 * Optional per-ad AI analysis — the "expert competitor ad analyst" pass.
 * Priced per REQUESTED ad like the scrape, by the analysing model's tier,
 * and folded into the SAME tiered identifier so every quote (guard,
 * reservation, card badge, run total, backend estimator) stays one SKU:
 *
 *   meta-ads-scrape:<tier>                             tier
 *   meta-ads-scrape:<tier>:analysis                    tier × (1 + 3)   standard models
 *   meta-ads-scrape:<tier>:analysis:economy            tier × (1 + 1)
 *   meta-ads-scrape:<tier>:analysis:premium            tier × (1 + 4)
 *   meta-ads-scrape:<tier>:analysis:premium-direct     tier × (1 + 10)
 *
 * The per-ad SKUs (`meta-ads-analysis[:economy|:premium|:premium-direct]`)
 * price the SETTLEMENT: a run commits tier + per-ad × ads actually analysed
 * and refunds the rest (an ad the model failed on, or one the deadline skipped).
 *
 * The tiers are the LLM credit rungs, read through `llmCreditRung` exactly as
 * the LLM features read them: a model served on its vendor's own API (today
 * only a `directOnly` one — the routes send no effort and no Advanced flag)
 * moves one rung up, so a premium one bills `premium-direct`. Its per-ad price
 * is the premium one × the LLM direct multiplier, rounded up — the rule every
 * LLM feature's direct rung follows (held to it by a backend billing test).
 */
export const META_ADS_ANALYSIS_TIERS = LLM_CREDIT_RUNGS
export type MetaAdsAnalysisTier = (typeof META_ADS_ANALYSIS_TIERS)[number]
export const META_ADS_ANALYSIS_CREDITS_PER_AD: Record<MetaAdsAnalysisTier, number> = { economy: 1, standard: 3, premium: 4, "premium-direct": 10 }
export const META_ADS_ANALYSIS_CREDIT_ID = "meta-ads-analysis" as const
/** The user's optional analyst focus, appended to the fixed prompt. */
export const META_ADS_ANALYSIS_FOCUS_MAX = 500

/** The per-ad settlement SKU for a tier (the bare id is the standard tier). */
export function metaAdsAnalysisCreditId(tier: MetaAdsAnalysisTier): string {
  return tier === "standard" ? META_ADS_ANALYSIS_CREDIT_ID : `${META_ADS_ANALYSIS_CREDIT_ID}:${tier}`
}

/** The analysing model's credit rung; an absent model is the feature default. */
export function metaAdsAnalysisTier(modelId?: unknown): MetaAdsAnalysisTier {
  const id = typeof modelId === "string" && modelId ? modelId : LLM_FEATURE_DEFAULTS["meta-ads-analysis"]
  return llmCreditRung(id)
}

/** What one analysed ad carries (`ad.analysis`); fixed fields + string lists only — never a map (Gemini via KIE drops map fields). */
export interface AdCreativeAnalysis {
  readonly assetType: "static" | "motion" | "carousel" | "unknown"
  readonly format: string
  readonly visualHooks: readonly string[]
  readonly audiences: readonly string[]
  readonly graphicIdentity: string
  readonly copywritingHooks: readonly string[]
  readonly usps: readonly string[]
  readonly cta: string
  readonly summary: string
}

const strList = (v: unknown): string[] => (Array.isArray(v) ? v.filter((s): s is string => typeof s === "string" && s.trim().length > 0) : [])
const str = (v: unknown): string => (typeof v === "string" ? v : "")

/** Read a stored analysis back defensively (a node's saved JSON is untrusted shape); null when there is none. */
export function adCreativeAnalysisFrom(raw: unknown): AdCreativeAnalysis | null {
  if (!raw || typeof raw !== "object") return null
  const r = raw as Record<string, unknown>
  if (typeof r.summary !== "string" || !r.summary.trim()) return null
  const assetType = r.assetType === "static" || r.assetType === "motion" || r.assetType === "carousel" ? r.assetType : "unknown"
  return {
    assetType,
    format: str(r.format),
    visualHooks: strList(r.visualHooks),
    audiences: strList(r.audiences),
    graphicIdentity: str(r.graphicIdentity),
    copywritingHooks: strList(r.copywritingHooks),
    usps: strList(r.usps),
    cta: str(r.cta),
    summary: r.summary,
  }
}

/** The `:analysis[:tier]` suffix on a scrape SKU for an analysis tier. */
function analysisSuffix(tier: MetaAdsAnalysisTier): string {
  return tier === "standard" ? ":analysis" : `:analysis:${tier}`
}

function buildMetaAdsCreditCostTable(): Record<string, number> {
  const table: Record<string, number> = { [META_ADS_SCRAPE_NODE_TYPE]: 20 }
  for (const tier of META_ADS_ANALYSIS_TIERS) table[metaAdsAnalysisCreditId(tier)] = META_ADS_ANALYSIS_CREDITS_PER_AD[tier]
  // Key by the TIER value directly (not via a count that clamps at MAX_COUNT):
  // the 200 / 500 tiers are reachable through sources > 1, so their analysis
  // rows must exist and be tier-based, not count-based.
  for (const t of META_ADS_SCRAPE_TIERS) {
    table[`${META_ADS_SCRAPE_NODE_TYPE}:${t}`] = t
    for (const tier of META_ADS_ANALYSIS_TIERS) {
      table[`${META_ADS_SCRAPE_NODE_TYPE}:${t}${analysisSuffix(tier)}`] = t * (1 + META_ADS_ANALYSIS_CREDITS_PER_AD[tier])
    }
  }
  return table
}

/**
 * Credit cost per SKU — mirror of the backend `STATIC_CREDIT_COSTS` rows and
 * migrations 428 / 429, for the frontend badge / estimator. 1 credit per
 * requested ad at every tier, plus the analysis multiples above; the bare
 * identifier is the pre-Zod fallback (mid tier, never the max).
 */
export const META_ADS_SCRAPE_CREDIT_COSTS: Record<string, number> = buildMetaAdsCreditCostTable()

export const META_ADS_SCRAPE_FALLBACK_CREDIT_ID = "meta-ads-scrape:20"

/**
 * Page urls are typed one per line in the config panel (a FieldMapping
 * injects the same text); the route wants an array. Tolerates commas and
 * whitespace as separators (a url never contains either) and an array that
 * already went through this once.
 */
export function splitMetaAdsPageUrls(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((v): v is string => typeof v === "string").map((v) => v.trim()).filter((v) => v.length > 0)
  }
  if (typeof value !== "string") return []
  return value.split(/[\n,\s]+/).map((v) => v.trim()).filter((v) => v.length > 0)
}

export function isMetaAdsScrapeMode(value: unknown): value is MetaAdsScrapeMode {
  return typeof value === "string" && (META_ADS_SCRAPE_MODES as readonly string[]).includes(value)
}

/**
 * Advertiser NAMES to resolve at run time (advertiser mode driven by the `in`
 * input) — one per line or comma-separated. Unlike page urls, a name contains
 * spaces, so this never splits on whitespace. Trimmed, de-duped, each 2..100
 * chars, capped at `MAX_SOURCES`.
 */
export function splitMetaAdsAdvertiserNames(value: unknown): string[] {
  const raw = Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string")
    : typeof value === "string"
      ? value.split(/[\n,]+/)
      : []
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of raw) {
    const name = item.trim()
    if (name.length < 2 || name.length > META_ADS_SCRAPE_MAX_QUERY_LENGTH) continue
    const key = name.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(name)
    if (out.length >= META_ADS_SCRAPE_MAX_SOURCES) break
  }
  return out
}

/** The node-data fields that decide what a run scrapes (and therefore what it costs). Index-signature so any node-data bag is accepted as-is. */
export interface MetaAdsNodeSourceFields {
  readonly [key: string]: unknown
  readonly mode?: unknown
  readonly query?: unknown
  readonly pageUrls?: unknown
  readonly advertisers?: unknown
}

/**
 * How many sources a run bills — the number the card badge, the run total,
 * the pre-run estimator and the backend quote must all read, so an advertiser
 * pick can never be quoted as one source while the server reserves five. An
 * empty page list / no picks counts as one (the run then fails validation
 * before anything is reserved).
 */
export function metaAdsScrapeSources(data: MetaAdsNodeSourceFields): number {
  switch (metaAdsNodeMode(data.mode)) {
    case "pages":
      return Math.max(1, Math.min(splitMetaAdsPageUrls(data.pageUrls).length, META_ADS_SCRAPE_MAX_SOURCES))
    case "advertiser":
      return Math.max(1, metaAdsAdvertisersFrom(data.advertisers).length)
    default:
      return 1
  }
}

export type MetaAdsWireSources =
  | { readonly mode: "search"; readonly query: string | undefined }
  | { readonly mode: "pages"; readonly pageUrls: string[]; readonly advertiserNames?: string[] }

/**
 * The wire half of a request from node data — ONE mapping for the editor's
 * executor and the orchestrator's payload builder. The keyword / page list
 * falls back to the upstream text so a Prompt or List node can drive the
 * scrape; advertiser picks are explicit (no upstream fallback) and run as
 * their Page urls, which is why the route never sees "advertiser".
 */
export function metaAdsScrapeWireSources(data: MetaAdsNodeSourceFields, upstream?: unknown): MetaAdsWireSources {
  const upstreamText = typeof upstream === "string" ? upstream : undefined
  switch (metaAdsNodeMode(data.mode)) {
    case "pages": {
      const own = splitMetaAdsPageUrls(data.pageUrls)
      return { mode: "pages", pageUrls: own.length > 0 ? own : splitMetaAdsPageUrls(upstreamText) }
    }
    case "advertiser": {
      // Explicit picks run as their Page urls. With no picks but upstream
      // text, the `in` value is advertiser NAME(s) to resolve at run time
      // (the route looks each up and picks the verified/first Page).
      const picks = metaAdsAdvertisersFrom(data.advertisers)
      if (picks.length > 0) return { mode: "pages", pageUrls: picks.map((a) => a.url) }
      const names = splitMetaAdsAdvertiserNames(upstreamText)
      return { mode: "pages", pageUrls: [], advertiserNames: names }
    }
    default: {
      const own = typeof data.query === "string" ? data.query : ""
      return { mode: "search", query: own || upstreamText }
    }
  }
}

export function isMetaAdsScrapeCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= META_ADS_SCRAPE_MAX_COUNT
}

/** Smallest tier that fits the requested total; clamps to the top tier. */
export function metaAdsScrapeTier(requestedTotal: number): MetaAdsScrapeTier {
  for (const tier of META_ADS_SCRAPE_TIERS) {
    if (requestedTotal <= tier) return tier
  }
  return META_ADS_SCRAPE_TIERS[META_ADS_SCRAPE_TIERS.length - 1]
}

export interface MetaAdsScrapeCreditInput {
  count: number
  /** Number of input URLs in pages mode; 1 for a keyword search. */
  sources: number
  /** The analysing model's tier when per-ad analysis is on; absent / null = scrape only. */
  analysis?: MetaAdsAnalysisTier | null
}

export function buildMetaAdsScrapeCreditId(input: MetaAdsScrapeCreditInput): string {
  const sources = Math.min(Math.max(Math.trunc(input.sources) || 1, 1), META_ADS_SCRAPE_MAX_SOURCES)
  const count = Math.min(Math.max(Math.trunc(input.count) || 1, 1), META_ADS_SCRAPE_MAX_COUNT)
  const base = `${META_ADS_SCRAPE_NODE_TYPE}:${metaAdsScrapeTier(count * sources)}`
  return input.analysis ? `${base}${analysisSuffix(input.analysis)}` : base
}

/** The analysis tier a request / node asks for, or null when analysis is off. */
export function metaAdsAnalysisTierFrom(data: { readonly analyze?: unknown; readonly analysisModel?: unknown }): MetaAdsAnalysisTier | null {
  return data.analyze === true ? metaAdsAnalysisTier(data.analysisModel) : null
}

/**
 * Resolve the credit identifier from an UNVALIDATED request body (the
 * creditGuard preHandler runs before Zod). It must land on the SAME tier the
 * post-Zod reservation computes, so an OMITTED count is the route's default
 * (Zod fills it in the same way); only a present-but-invalid body reserves
 * the fixed mid tier, and the route then rejects it with a 400 and refunds.
 */
export function resolveMetaAdsScrapeCreditId(body: unknown): string {
  const raw = body as { mode?: unknown; count?: unknown; pageUrls?: unknown; advertiserNames?: unknown; analyze?: unknown; analysisModel?: unknown } | null | undefined
  if (!raw || typeof raw !== "object") return META_ADS_SCRAPE_FALLBACK_CREDIT_ID
  const count = raw.count === undefined ? META_ADS_SCRAPE_DEFAULT_COUNT : raw.count
  if (!isMetaAdsScrapeCount(count)) return META_ADS_SCRAPE_FALLBACK_CREDIT_ID
  // Pages mode bills per source: the page urls PLUS any advertiser names the
  // route will resolve to page urls at run time. Counting names may over-check
  // when one doesn't resolve — the safe direction (the reservation trues down).
  const sources = raw.mode === "pages"
    ? (Array.isArray(raw.pageUrls) ? raw.pageUrls.length : 0) + (Array.isArray(raw.advertiserNames) ? raw.advertiserNames.length : 0)
    : 1
  if (sources < 1 || sources > META_ADS_SCRAPE_MAX_SOURCES) return META_ADS_SCRAPE_FALLBACK_CREDIT_ID
  return buildMetaAdsScrapeCreditId({ count, sources, analysis: metaAdsAnalysisTierFrom(raw) })
}

/** The node-data fields a quote reads: what a run scrapes, how many, and whether it analyses. */
export interface MetaAdsNodeQuoteFields extends MetaAdsNodeSourceFields {
  readonly count?: unknown
  readonly analyze?: unknown
  readonly analysisModel?: unknown
}

/**
 * The ONE credit identifier for a node's current settings — the card badge,
 * the run total, the pre-run estimator and the backend quote all read this,
 * and it is the same builder the route's guard + reservation use on the wire
 * body, so no surface can quote a different SKU than the one reserved.
 */
export function metaAdsScrapeCreditIdFromNode(data: MetaAdsNodeQuoteFields): string {
  const count = typeof data.count === "number" ? data.count : META_ADS_SCRAPE_DEFAULT_COUNT
  return buildMetaAdsScrapeCreditId({ count, sources: metaAdsScrapeSources(data), analysis: metaAdsAnalysisTierFrom(data) })
}
