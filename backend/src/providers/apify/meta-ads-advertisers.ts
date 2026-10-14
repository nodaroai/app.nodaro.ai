import { getApifyClient, sanitizeApifyError } from "./client.js"
import { MissingProviderKeyError } from "../provider-keys.js"
import { META_ADS_ADVERTISER_MAX_RESULTS, metaAdsAdvertisersFrom, type MetaAdsAdvertiser } from "@nodaro/shared/social"

/**
 * Advertiser lookup for the Meta Ads node's "advertiser" mode: a NAME → the
 * Facebook Pages that match it, so the user picks one the way the Ad
 * Library's own search box suggests advertisers. The pick's Page url is what
 * a run hands the ads actor, which resolves the Ad Library advertiser itself
 * — a Page id and an Ad Library advertiser id are DIFFERENT numbers for the
 * same brand (OpenArt AI: page 615…, advertiser 372…), so nothing here builds
 * an Ad Library url.
 *
 * Chosen 2026-09-17 against three candidates for "OpenArt AI": this actor
 * answered in ~6 s with the verified page first; Apify's official page search
 * took 76 s per lookup, and the "Ad Library page resolver" returned a wrong
 * page url. Billing is per actor START (a fraction of a cent), no charge per
 * row — which is why the route meters lookups per user (it charges no
 * credits) and this module never starts two runs for one query.
 */
export const META_ADS_ADVERTISER_ACTOR = {
  apifyActorId: "data-slayer/facebook-search-pages",
  timeoutSecs: 60,
} as const

const CONTEXT = "meta-ads-advertisers"

/** Platform-side charged-items cap. Same floor class as the ads actor: never under 10. */
const MAX_CHARGED_ITEMS = 20

/**
 * One actor run per distinct query. A hit is reused for hours (a brand's
 * Pages do not move); an EMPTY answer is kept too, briefly — a typo retried
 * ten times must not start ten runs. A lookup still in flight is shared by
 * every concurrent caller of the same query (single-flight), so two panels
 * asking for the same brand at once start one run, not two.
 */
const CACHE_TTL_MS = 6 * 60 * 60 * 1000
const EMPTY_CACHE_TTL_MS = 10 * 60 * 1000
const CACHE_MAX_ENTRIES = 200
const cache = new Map<string, { readonly at: number; readonly items: MetaAdsAdvertiser[] }>()
const inflight = new Map<string, Promise<MetaAdsAdvertiser[]>>()

export function normalizeAdvertiserQuery(query: string): string {
  return query.trim().replace(/\s+/g, " ").toLowerCase()
}

function remember(key: string, items: MetaAdsAdvertiser[], at: number): void {
  // Re-inserting moves the key to the back, so eviction is least-recently-WRITTEN, not first-ever.
  cache.delete(key)
  if (cache.size >= CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value
    if (oldest !== undefined) cache.delete(oldest)
  }
  cache.set(key, { at, items })
}

/** Test seam. */
export function _resetMetaAdvertiserCacheForTests(): void {
  cache.clear()
  inflight.clear()
}

type Raw = Record<string, unknown>

interface ActorRunLike {
  id?: string
  status?: string
  defaultDatasetId: string
}

/**
 * The actor's rows → our vocabulary. Pages only (the actor can also list
 * people / groups), deduped by page id, kept in the actor's relevance order
 * (the verified brand page came first in every probe), capped for the picker.
 */
export function projectMetaAdvertisers(items: readonly Raw[]): MetaAdsAdvertiser[] {
  const candidates = items
    .filter((r): r is Raw => !!r && typeof r === "object" && (r.type === undefined || r.type === "page"))
    .map((r) => {
      const image = r.image && typeof r.image === "object" ? (r.image as Raw).uri : r.image
      return {
        pageId: r.facebook_id ?? r.pageId ?? r.id,
        name: r.name ?? r.title,
        url: r.profile_url ?? r.pageUrl ?? r.url,
        imageUrl: typeof image === "string" ? image : undefined,
        verified: r.is_verified === true,
      }
    })
  return metaAdsAdvertisersFrom(candidates, META_ADS_ADVERTISER_MAX_RESULTS)
}

/** The lookup itself; `searchMetaAdvertisers` wraps it with the cache and single-flight. Result: `{ items, cached: false }`. */
async function runAdvertiserLookup(query: string): Promise<MetaAdsAdvertiser[]> {
  try {
    const client = getApifyClient()
    const run = (await client
      .actor(META_ADS_ADVERTISER_ACTOR.apifyActorId)
      .call(
        { query: query.trim(), maxPages: 1 },
        { waitSecs: META_ADS_ADVERTISER_ACTOR.timeoutSecs, timeout: META_ADS_ADVERTISER_ACTOR.timeoutSecs, maxItems: MAX_CHARGED_ITEMS },
      )) as ActorRunLike

    // Same lifecycle as the ads actor: `.call()` never throws on FAILED and a
    // still-RUNNING run keeps billing after we gave up — abort it.
    if (run.status === "RUNNING" || run.status === "READY") {
      if (run.id) {
        await client.run(run.id).abort().catch((err: unknown) => {
          console.warn(`[${CONTEXT}] abort of run ${run.id} failed: ${err instanceof Error ? err.message : String(err)}`)
        })
      }
      throw new Error(`timeout: actor run still ${run.status} after ${META_ADS_ADVERTISER_ACTOR.timeoutSecs}s`)
    }
    if (run.status && run.status !== "SUCCEEDED") {
      throw new Error(run.status.includes("TIM") ? `timeout: actor run ${run.status}` : `actor run ${run.status}`)
    }

    const { items } = await client.dataset(run.defaultDatasetId).listItems({ limit: MAX_CHARGED_ITEMS })
    return projectMetaAdvertisers(items as Raw[])
  } catch (err) {
    if (err instanceof MissingProviderKeyError) throw err
    throw sanitizeApifyError(err, CONTEXT)
  }
}

export interface MetaAdvertiserLookup {
  readonly items: MetaAdsAdvertiser[]
  /** True when no actor run was started for this call (a cache hit or a shared in-flight lookup). */
  readonly cached: boolean
}

export async function searchMetaAdvertisers(query: string, now: () => number = Date.now): Promise<MetaAdvertiserLookup> {
  const key = normalizeAdvertiserQuery(query)
  const hit = cache.get(key)
  if (hit && now() - hit.at < (hit.items.length > 0 ? CACHE_TTL_MS : EMPTY_CACHE_TTL_MS)) return { items: hit.items, cached: true }

  const shared = inflight.get(key)
  if (shared) return { items: await shared, cached: true }

  const pending = runAdvertiserLookup(query)
    .then((items) => {
      remember(key, items, now())
      return items
    })
    .finally(() => {
      inflight.delete(key)
    })
  inflight.set(key, pending)
  return { items: await pending, cached: false }
}
