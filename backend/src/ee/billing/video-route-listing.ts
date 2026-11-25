/**
 * The LISTING side of the routed price (video-route-pricing.ts has the run
 * side): which platform price ids a route can price, the one USD → credits
 * rule, and a routed model's listed base price. A leaf — it imports nothing
 * from the credits module, so the price table (credits.ts) can read it
 * without an import cycle.
 */
import { usdToCredits } from "@nodaro/shared/credits"
import { pricedAsId } from "../../lib/retired-price-id.js"
import { priceFactorKey, priceFactorOf, videoRouteChoiceFor, type VideoRoutePolicy, type VideoRoutePriceFactors, type VideoRoutePriceKind } from "../../lib/video-route-policy.js"
import type { RouteView } from "../../lib/video-route-decision.js"

/** A routed price is rounded up to a whole multiple of this many base credits (the default video rows' step). */
export const ROUTE_PRICE_ROUND_TO = 10

/**
 * THE one USD → base credits rule of the routed price, used for a listing, a
 * hold and a settlement alike: the cost at the credit's value
 * (`usdToCredits`, `CREDIT_BASE_USD`), rounded up to the next
 * {@link ROUTE_PRICE_ROUND_TO} — the rounding the platform's per-second video
 * rows use. 0 for a zero cost. Throws on a negative or non-finite cost.
 */
export function routeUsdToBaseCredits(usd: number): number {
  const credits = usdToCredits(usd)
  return Math.ceil(credits / ROUTE_PRICE_ROUND_TO) * ROUTE_PRICE_ROUND_TO
}

/**
 * The LISTED base price of `priceId` on the route: its listed USD cost times
 * the correction factor, through {@link routeUsdToBaseCredits}; undefined when
 * the route lists no price for it.
 */
export function routedListedBase(
  pricesUsd: Readonly<Record<string, number>> | null,
  priceId: string,
  factor: number,
): number | undefined {
  const usd = pricesUsd?.[pricedAsId(priceId)]
  if (usd === undefined) return undefined
  return routeUsdToBaseCredits(usd * Math.max(1, factor))
}

// ── Listings ──

/**
 * The platform price ids a route can price, by the id's leading segment: the
 * model the id belongs to and the kind of run it prices. Guarded by
 * `__tests__/video-route-pricing.test.ts`: every Seedance 2.x id in
 * `STATIC_CREDIT_COSTS` must parse here, and an id of another shape must not.
 */
const ROUTED_PRICE_PREFIXES: Readonly<Record<string, { model: string; kind: VideoRoutePriceKind }>> = {
  "seedance-2": { model: "seedance-2", kind: "generate" },
  "seedance-2-fast": { model: "seedance-2-fast", kind: "generate" },
  "seedance-2-mini": { model: "seedance-2-mini", kind: "generate" },
  "seedance-2-5": { model: "seedance-2-5", kind: "generate" },
  "seedance-2-5-flash": { model: "seedance-2-5-flash", kind: "generate" },
  "seedance-2-5-hd": { model: "seedance-2-5", kind: "draft-finalize" },
  "seedance-2-5-extend": { model: "seedance-2-5", kind: "extend" },
  "seedance-2-5-flash-extend": { model: "seedance-2-5-flash", kind: "extend" },
  "seedance-2-0-extend": { model: "seedance-2", kind: "extend" },
}

/** The segments an id may carry after its head; any other segment makes it no routed id. */
const RESOLUTION_SEGMENT = /^(480p|720p|1080p|4k)(-ref)?$/
const SECONDS_SEGMENT = /^(\d{1,2})s(-ref)?$/
const PER_SECONDS_SEGMENT = /^per-(\d{1,2})s$/

export interface RoutedPriceId {
  readonly model: string
  readonly kind: VideoRoutePriceKind
  readonly resolution: string | undefined
  readonly hasRefVideo: boolean
  /** The output seconds the id prices (`:8s:`), when it names them. */
  readonly seconds?: number
}

/** What a platform price id prices, when a route can price it; undefined for every other id. */
export function routedPriceIdOf(priceId: string): RoutedPriceId | undefined {
  const id = pricedAsId(priceId)
  const segments = id.split(":")
  const head = ROUTED_PRICE_PREFIXES[segments[0]!]
  if (!head) return undefined
  let resolution: string | undefined
  let hasRefVideo = false
  let seconds: number | undefined
  for (const seg of segments.slice(1)) {
    const res = RESOLUTION_SEGMENT.exec(seg)
    const sec = SECONDS_SEGMENT.exec(seg)
    if (res && resolution === undefined) {
      resolution = res[1]
      if (res[2]) hasRefVideo = true
    } else if (sec && seconds === undefined) {
      seconds = Number(sec[1])
      if (sec[2]) hasRefVideo = true
    } else if (!PER_SECONDS_SEGMENT.test(seg)) {
      return undefined
    }
  }
  return { model: head.model, kind: head.kind, resolution, hasRefVideo, ...(seconds !== undefined ? { seconds } : {}) }
}

/** The model a platform price id prices, when a route can price it (for `currentRouteView`). */
export function modelOfPriceId(priceId: string): string | undefined {
  return routedPriceIdOf(priceId)?.model
}

/** What the listing side needs to price a routed id. */
export interface RoutedListing {
  readonly policy: VideoRoutePolicy | null | undefined
  readonly view: RouteView | null
  /** USD per listed platform price id. */
  readonly pricesUsd: Readonly<Record<string, number>> | null
  readonly factors: VideoRoutePriceFactors | null | undefined
}

/**
 * The LISTED base of `priceId` when its model is on the alternate route at
 * MODEL level, and this environment's route can take it: `{ routed: true, base }`,
 * base undefined when the route lists no price for the id — then the id is
 * refused (`PriceNotConfiguredError` in the estimate paths), never the default
 * price and never a node-type row. `{ routed: false }` for every other id,
 * and whenever the policy keeps the model on the default route.
 *
 * A listing knows no service: the model lists, `GET /v1/credits/model-cost(s)`
 * and "from" prices cannot honour a per-service override and show the
 * model-level route. Where the service is known (a node's estimate, a quote)
 * the request is priced by the route's own decision for it.
 */
export function routedListedPrice(listing: RoutedListing | undefined, priceId: string): { routed: false } | { routed: true; base: number | undefined } {
  if (!listing) return { routed: false }
  const parsed = routedPriceIdOf(priceId)
  if (!parsed) return { routed: false }
  if (videoRouteChoiceFor(listing.policy, parsed.model, undefined) !== "alternate") return { routed: false }
  const view = listing.view
  if (!view || !view.v2 || !view.capable(parsed.model)) return { routed: false }
  const factor = priceFactorOf(listing.factors, priceFactorKey(parsed))
  return { routed: true, base: routedListedBase(listing.pricesUsd, priceId, factor) }
}
