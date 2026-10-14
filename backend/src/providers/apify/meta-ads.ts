import { getApifyClient, sanitizeApifyError } from "./client.js"
import { MissingProviderKeyError } from "../provider-keys.js"
import type { MetaAdsPlatform, MetaAdsScrapeMode, MetaAdsScrapePeriod, MetaAdsScrapeStatus } from "@nodaro/shared/social"

/**
 * Meta Ad Library via Apify. Deliberately its OWN definition, not a member of
 * the web-scrape `ACTORS` union — the node is a first-class type with its own
 * route, pricing and output schema, so nothing here couples to web-scrape.
 *
 * Actor input schema (verified 2026-09-17 from the actor's OpenAPI build):
 *   urls: [{ url }]            — Ad Library SEARCH urls or Facebook PAGE urls
 *   limitPerSource: int        — per input url ("may exceed by up to 30")
 *   scrapeAdDetails: bool      — EU reach etc.; off (slow, unneeded)
 *   "scrapePageAds.period":    "" | last24h | last7d | last14d | last30d
 *   "scrapePageAds.activeStatus": all | active | inactive
 *   "scrapePageAds.sortBy":    impressions_desc | most_recent
 *   "scrapePageAds.countryCode": ISO alpha-2 | ALL
 * The `scrapePageAds.*` keys are literal dotted keys and apply to PAGE urls;
 * a keyword search carries its filters inside the Ad Library url instead.
 */
/** 480 s leaves the route ~90 s of its 600 s request for classifying + storing the creatives after the scrape. */
export const META_ADS_ACTOR = {
  apifyActorId: "curious_coder/facebook-ads-library-scraper",
  timeoutSecs: 480,
} as const

const CONTEXT = "meta-ads-scrape"

export interface MetaAdsScrapeArgs {
  mode: MetaAdsScrapeMode
  /** Keyword search — required when mode = "search". */
  query?: string
  /** Facebook Page urls — required when mode = "pages". */
  pageUrls?: string[]
  /** Ads per source (Zod-bounded 1..100). */
  count: number
  period: MetaAdsScrapePeriod
  activeStatus: MetaAdsScrapeStatus
  /** ISO 3166-1 alpha-2 uppercase, or "ALL". */
  countryCode: string
  /** Keep only ads delivered on these platforms; empty/absent = all. */
  platforms?: MetaAdsPlatform[]
}

/** One normalized ad — the node's OUTPUT contract (independent of the actor's raw shape). */
export interface MetaAd {
  adArchiveId: string
  adLibraryUrl: string
  pageName: string
  pageId: string
  startDate: string | null
  endDate: string | null
  isActive: boolean
  platforms: string[]
  text: string
  title: string | null
  caption: string | null
  ctaText: string | null
  linkUrl: string | null
  images: string[]
  videos: string[]
  videoPreviews: string[]
  collationCount: number | null
}

export interface MetaAdsScrapeOutput {
  json: MetaAd[]
}

const PAGE_PERIOD: Record<MetaAdsScrapePeriod, "" | "last24h" | "last7d" | "last30d"> = {
  "24h": "last24h",
  "7d": "last7d",
  "30d": "last30d",
  all: "",
}

const PERIOD_DAYS: Record<MetaAdsScrapePeriod, number | null> = {
  "24h": 1,
  "7d": 7,
  "30d": 30,
  all: null,
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

const ALL_PLATFORM_COUNT = 6

/** The platforms that actually narrow the result: none, or a strict subset. */
export function activePlatformFilter(platforms: readonly MetaAdsPlatform[] | undefined): MetaAdsPlatform[] {
  const unique = [...new Set(platforms ?? [])]
  return unique.length === 0 || unique.length >= ALL_PLATFORM_COUNT ? [] : unique
}

/**
 * Ad Library search url — the same url the Ad Library UI produces for a
 * keyword search, which is what the actor parses. `start_date[min|max]` is
 * the UI's own date filter; "all" omits it.
 */
export function buildAdLibrarySearchUrl(args: MetaAdsScrapeArgs, now: Date = new Date()): string {
  const url = new URL("https://www.facebook.com/ads/library/")
  url.searchParams.set("active_status", args.activeStatus)
  url.searchParams.set("ad_type", "all")
  url.searchParams.set("country", args.countryCode)
  url.searchParams.set("q", args.query ?? "")
  url.searchParams.set("search_type", "keyword_unordered")
  url.searchParams.set("media_type", "all")
  // The UI's own platform filter (`publisher_platforms[i]=facebook`); a full
  // or empty selection is the same as no filter.
  for (const [i, p] of activePlatformFilter(args.platforms).entries()) {
    url.searchParams.set(`publisher_platforms[${i}]`, p.toLowerCase())
  }
  const days = PERIOD_DAYS[args.period]
  if (days !== null) {
    url.searchParams.set("start_date[min]", isoDate(new Date(now.getTime() - days * 86_400_000)))
    url.searchParams.set("start_date[max]", isoDate(now))
    // The keyword search ignores the date window (it filters nothing — live
    // 2026-09-17), so results come back in relevance order spanning years and
    // the post-filter throws most away. This sort DOES take: `desc` +
    // `relevancy_monthly_grouped` front-loads the most recent ads
    // (live-verified 2026-09-18: top results all within the last two months
    // vs a 2023-2026 spread unsorted), so the over-fetch actually fills the
    // window. Only set when a window is in play; "all" keeps relevance order.
    url.searchParams.set("sort_data[direction]", "desc")
    url.searchParams.set("sort_data[mode]", "relevancy_monthly_grouped")
  }
  return url.toString()
}

export function metaAdsSourceUrls(args: MetaAdsScrapeArgs, now: Date = new Date()): string[] {
  return args.mode === "pages" ? [...(args.pageUrls ?? [])] : [buildAdLibrarySearchUrl(args, now)]
}

/**
 * A keyword search does NOT honour the url's `start_date[min|max]` window
 * (live-verified 2026-09-17: a "last 30 days" search returned ads that
 * started in May/June), so the period is enforced by `filterMetaAdsByPeriod`
 * AFTER the fetch. Over-fetch when a window is set so the post-filter still
 * has enough to fill the paid-for count; the actor bills per ad scraped and
 * the multiplier is a sub-cent difference.
 */
const ACTOR_MAX_PER_SOURCE = 300
// Post-filter headroom by window. Even with the recency sort above, the
// tighter the window the more of the recent-first stream falls outside it, so
// a narrower period asks for more. Capped at the actor ceiling.
const PERIOD_OVERFETCH: Record<MetaAdsScrapePeriod, number> = { "24h": 8, "7d": 5, "30d": 3, all: 1 }

export function actorLimitPerSource(count: number, period: MetaAdsScrapePeriod, mode: MetaAdsScrapeMode): number {
  // Page urls honour `scrapePageAds.period` server-side; only a keyword
  // search needs the post-filter headroom.
  if (period === "all" || mode === "pages") return count
  return Math.min(ACTOR_MAX_PER_SOURCE, count * PERIOD_OVERFETCH[period])
}

/** Pure — exported for tests. `count` (the actor's TOTAL cap) is left unset on purpose: the per-url cap plus our own slice is the contract. */
export function buildMetaAdsActorInput(args: MetaAdsScrapeArgs, now: Date = new Date()): Record<string, unknown> {
  return {
    urls: metaAdsSourceUrls(args, now).map((url) => ({ url })),
    scrapeAdDetails: false,
    limitPerSource: actorLimitPerSource(args.count, args.period, args.mode),
    "scrapePageAds.period": PAGE_PERIOD[args.period],
    "scrapePageAds.activeStatus": args.activeStatus,
    "scrapePageAds.sortBy": "most_recent",
    "scrapePageAds.countryCode": args.countryCode,
  }
}

type Raw = Record<string, unknown>

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null
}

function unixToIso(v: unknown): string | null {
  if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) return null
  return new Date(v * 1000).toISOString()
}

function firstUrl(o: Raw, keys: string[]): string | null {
  for (const k of keys) {
    const s = str(o[k])
    if (s) return s
  }
  return null
}

function asRawArray(v: unknown): Raw[] {
  return Array.isArray(v) ? v.filter((x): x is Raw => !!x && typeof x === "object") : []
}

function uniq(values: Array<string | null>): string[] {
  return [...new Set(values.filter((v): v is string => !!v))]
}

/**
 * Project the actor's raw Ad Library records onto the node's output schema,
 * dedupe by archive id (collations repeat), and cut to the requested total —
 * the actor over-delivers "by up to 30" per source and the user paid for
 * `maxItems`.
 */
export function projectMetaAds(items: Raw[], maxItems: number): MetaAd[] {
  const seen = new Set<string>()
  const out: MetaAd[] = []
  for (const it of items) {
    const adArchiveId = str(it.ad_archive_id) ?? (typeof it.ad_archive_id === "number" ? String(it.ad_archive_id) : null)
    if (!adArchiveId || seen.has(adArchiveId)) continue
    seen.add(adArchiveId)

    const snapshot = (it.snapshot && typeof it.snapshot === "object" ? it.snapshot : {}) as Raw
    const body = (snapshot.body && typeof snapshot.body === "object" ? snapshot.body : {}) as Raw
    const cards = asRawArray(snapshot.cards)
    const images = asRawArray(snapshot.images)
    const videos = asRawArray(snapshot.videos)

    out.push({
      adArchiveId,
      adLibraryUrl: `https://www.facebook.com/ads/library/?id=${encodeURIComponent(adArchiveId)}`,
      pageName: str(it.page_name) ?? str(snapshot.page_name) ?? "",
      pageId: str(it.page_id) ?? (typeof it.page_id === "number" ? String(it.page_id) : ""),
      startDate: unixToIso(it.start_date),
      endDate: unixToIso(it.end_date),
      isActive: it.is_active === true,
      platforms: Array.isArray(it.publisher_platform)
        ? it.publisher_platform.filter((p): p is string => typeof p === "string")
        : [],
      text: str(body.text) ?? str(cards[0]?.body) ?? "",
      title: str(snapshot.title) ?? str(cards[0]?.title),
      caption: str(snapshot.caption),
      ctaText: str(snapshot.cta_text) ?? str(cards[0]?.cta_text),
      linkUrl: str(snapshot.link_url) ?? str(cards[0]?.link_url),
      images: uniq([
        ...images.map((i) => firstUrl(i, ["original_image_url", "resized_image_url"])),
        ...cards.map((c) => firstUrl(c, ["original_image_url", "resized_image_url"])),
      ]),
      videos: uniq([
        ...videos.map((v) => firstUrl(v, ["video_hd_url", "video_sd_url"])),
        ...cards.map((c) => firstUrl(c, ["video_hd_url", "video_sd_url"])),
      ]),
      videoPreviews: uniq([
        ...videos.map((v) => firstUrl(v, ["video_preview_image_url"])),
        ...cards.map((c) => firstUrl(c, ["video_preview_image_url"])),
      ]),
      collationCount: typeof it.collation_count === "number" ? it.collation_count : null,
    })
    if (out.length >= maxItems) break
  }
  return out
}

/** Keep ads that STARTED inside the window; "all" keeps everything. An ad with no start date cannot prove it is inside the window and is dropped. */
export function filterMetaAdsByPeriod(ads: MetaAd[], period: MetaAdsScrapePeriod, now: Date = new Date()): MetaAd[] {
  const days = PERIOD_DAYS[period]
  if (days === null) return ads
  const floor = now.getTime() - days * 86_400_000
  return ads.filter((ad) => ad.startDate !== null && Date.parse(ad.startDate) >= floor)
}

/** Keep ads delivered on at least one selected platform; no/full selection keeps everything. The url filter is a hint to the search — this is the guarantee, in both modes. */
export function filterMetaAdsByPlatforms(ads: MetaAd[], platforms: readonly MetaAdsPlatform[] | undefined): MetaAd[] {
  const wanted = activePlatformFilter(platforms)
  if (wanted.length === 0) return ads
  const set = new Set<string>(wanted)
  return ads.filter((ad) => ad.platforms.some((p) => set.has(p)))
}

/**
 * Raw actor items → the node's output: normalize, enforce the period and the
 * platform filter, cut to the paid-for count. "Ads per source" is a per-PAGE
 * promise in pages mode: the actor concatenates sources in order and
 * over-delivers per url, so a flat cut would let the first page eat the next
 * page's quota — take `count` per page (by page id) and cap the total at
 * count × sources.
 */
export function selectMetaAds(
  items: Raw[],
  opts: {
    count: number
    sources: number
    mode: MetaAdsScrapeMode
    period: MetaAdsScrapePeriod
    platforms?: readonly MetaAdsPlatform[]
    now?: Date
  },
): MetaAd[] {
  const inWindow = filterMetaAdsByPlatforms(
    filterMetaAdsByPeriod(projectMetaAds(items, Number.POSITIVE_INFINITY), opts.period, opts.now),
    opts.platforms,
  )
  if (opts.mode !== "pages") return inWindow.slice(0, opts.count)

  const perPage = new Map<string, number>()
  const out: MetaAd[] = []
  for (const ad of inWindow) {
    const key = ad.pageId || ad.pageName
    const taken = perPage.get(key) ?? 0
    if (taken >= opts.count) continue
    perPage.set(key, taken + 1)
    out.push(ad)
    if (out.length >= opts.count * opts.sources) break
  }
  return out
}

interface ActorRunLike {
  id?: string
  status?: string
  defaultDatasetId: string
}

/**
 * The actor refuses to START below this charged-results cap — it logs
 * `"Maximum charged results" option must be atleast 10 to run this actor`,
 * then exits SUCCEEDED with an EMPTY dataset, so a small request would come
 * back as "no ads" with the credits already spent (live-observed 2026-09-17
 * with count 3). The cap only bounds what the platform may charge for;
 * `limitPerSource` still decides how many ads the actor actually fetches.
 */
export const META_ADS_ACTOR_MIN_CHARGED_RESULTS = 10

export async function runMetaAdsScrape(args: MetaAdsScrapeArgs): Promise<MetaAdsScrapeOutput> {
  const input = buildMetaAdsActorInput(args)
  const sources = metaAdsSourceUrls(args).length
  // The platform's own ceilings, independent of our client-side wait. `timeout`
  // is the real safety: the run is killed there even if the abort below fails.
  // `maxItems` caps the charged dataset items where an actor bills per RESULT;
  // this actor bills per EVENT, so treat it as belt-and-braces, not a spend cap
  // — but never below the actor's own floor (see the constant above).
  const maxItems = Math.max(
    META_ADS_ACTOR_MIN_CHARGED_RESULTS,
    actorLimitPerSource(args.count, args.period, args.mode) * sources,
  )

  try {
    const client = getApifyClient()
    const run = (await client
      .actor(META_ADS_ACTOR.apifyActorId)
      .call(input, { waitSecs: META_ADS_ACTOR.timeoutSecs, timeout: META_ADS_ACTOR.timeoutSecs, maxItems })) as ActorRunLike

    // `.call()` resolves with the run in WHATEVER state it reached at
    // waitSecs — it never throws on FAILED, and a still-RUNNING run keeps
    // billing us after we've given up. Abort it, then surface a timeout.
    if (run.status === "RUNNING" || run.status === "READY") {
      if (run.id) {
        await client.run(run.id).abort().catch((err: unknown) => {
          console.warn(`[${CONTEXT}] abort of run ${run.id} failed: ${err instanceof Error ? err.message : String(err)}`)
        })
      }
      throw new Error(`timeout: actor run still ${run.status} after ${META_ADS_ACTOR.timeoutSecs}s`)
    }
    if (run.status && run.status !== "SUCCEEDED") {
      throw new Error(run.status.includes("TIM") ? `timeout: actor run ${run.status}` : `actor run ${run.status}`)
    }

    const { items } = await client.dataset(run.defaultDatasetId).listItems()
    return {
      json: selectMetaAds(items as Raw[], {
        count: args.count,
        sources,
        mode: args.mode,
        period: args.period,
        platforms: args.platforms,
      }),
    }
  } catch (err) {
    // A missing-key error already says exactly what to do; the sanitizer's
    // catch-all would rewrite it to "check the URL" (see scraper.ts).
    if (err instanceof MissingProviderKeyError) throw err
    throw sanitizeApifyError(err, CONTEXT)
  }
}
