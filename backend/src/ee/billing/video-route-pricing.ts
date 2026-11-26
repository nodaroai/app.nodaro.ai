/**
 * The price of a run on the alternate route (docs/design/alternate-routes.md,
 * "Routing per model"): derived from the ROUTE's cost with the same rule the
 * default provider's video prices are derived from, then marked up exactly
 * as the default price of the same platform id is.
 *
 *   base credits = the USD cost at the credit's value (`usdToCredits`,
 *                  `CREDIT_BASE_USD`), rounded up to the next
 *                  {@link ROUTE_PRICE_ROUND_TO} — the rounding the platform's
 *                  per-second video rows use (`routeUsdToBaseCredits`, the
 *                  one rule, in video-route-listing.ts);
 *   charged      = `applyServiceMarkup(base, settings, priceMarginKey(id))`
 *                  at the platform id, so a per-service margin, the on/off
 *                  switch and the tier gates all stay on the platform's id.
 *
 * ONE function turns a USD cost into base credits ({@link routeUsdToBaseCredits}),
 * used for the admission hold (from the route's `quote`, times the key's
 * correction factor) AND the settlement (from the finished task's
 * `providerCostUsd`). `prices()` (USD) only feeds listings
 * ({@link routedListedBase}), through the same rule.
 */
import type { PluginAlternateRouteRequest, PluginAlternateRoutesService } from "../../lib/private-plugins/types.js"
import { priceMarginKey } from "../../lib/speech-credits.js"
import { pricedAsId } from "../../lib/retired-price-id.js"
import { priceFactorOf, type VideoRoutePriceFactors } from "../../lib/video-route-policy.js"
import { routeUsdToBaseCredits } from "./video-route-listing.js"

export { ROUTE_PRICE_ROUND_TO, modelOfPriceId, routeUsdToBaseCredits, routedListedBase, routedListedPrice, routedPriceIdOf, type RoutedListing, type RoutedPriceId } from "./video-route-listing.js"
import { applyServiceMarkup } from "./service-margin.js"

type MarginSettings = Parameters<typeof applyServiceMarkup>[1]
import { PriceNotConfiguredError } from "./credits.js"


/** `base` marked up exactly as the platform price `priceId` is. */
export function routedChargedCredits(base: number, priceId: string, settings: MarginSettings): number {
  return applyServiceMarkup(base, settings, priceMarginKey(pricedAsId(priceId)))
}

export interface RoutedQuote {
  /** What the route's own rule says it would bill, before any factor. */
  readonly usd: number
  readonly billedSeconds: number
  /** The correction factor applied to the hold. */
  readonly factor: number
  /** Base credits held: `routeUsdToBaseCredits(usd × factor)`. */
  readonly baseCredits: number
  /** The base credits marked up at the platform id: what is held. */
  readonly chargedCredits: number
}

/**
 * The admission price of a routed run: the route's `quote(req)` times the
 * key's correction factor, in base credits, marked up at `priceId`. Throws
 * `PriceNotConfiguredError(priceId)` — 503 `price_not_configured` — when the
 * route has no `quote`, returns null, throws, or quotes a figure that is not a
 * cost: never a silent fall back to the default price.
 */
export function routedQuote(args: {
  service: PluginAlternateRoutesService | undefined
  request: PluginAlternateRouteRequest
  priceId: string
  factorKey: string
  factors: VideoRoutePriceFactors | null | undefined
  settings: MarginSettings
}): RoutedQuote {
  const { service, request, priceId } = args
  let quoted: { billedSeconds: number; usd: number } | null = null
  try {
    quoted = typeof service?.quote === "function" ? service.quote(request) : null
  } catch (err) {
    console.error(`[video-route] quote threw for ${priceId}: ${err instanceof Error ? err.message : String(err)}`)
    quoted = null
  }
  const usd = quoted?.usd
  const billedSeconds = quoted?.billedSeconds
  if (typeof usd !== "number" || !Number.isFinite(usd) || usd <= 0 || typeof billedSeconds !== "number" || !Number.isFinite(billedSeconds) || billedSeconds < 0) {
    console.error(`[credits] PriceNotConfiguredError: the alternate route gave no quote for "${priceId}"`)
    throw new PriceNotConfiguredError(priceId)
  }
  const factor = priceFactorOf(args.factors, args.factorKey)
  const baseCredits = routeUsdToBaseCredits(usd * factor)
  return { usd, billedSeconds, factor, baseCredits, chargedCredits: routedChargedCredits(baseCredits, priceId, args.settings) }
}

/** What a finished routed run is charged: the task's billed cost, in base credits, marked up at `priceId`. */
/**
 * A settled cost above this multiple of the run's quote (times its factor) is
 * charged only up to it: a corrupt or runaway figure must never charge a
 * person many times what they were quoted. The rest is alerted, and the
 * cost-shortfall sweep records it for a person to look at.
 */
export const ROUTE_SETTLE_MAX_OF_QUOTE = 3

/**
 * What a finished routed run is charged: the task's billed cost, in base
 * credits, marked up at `priceId` — at most {@link ROUTE_SETTLE_MAX_OF_QUOTE}
 * × the quote it was held at (`capped` then says so). Throws on a cost that is
 * not a positive number: a run is never settled as free from a missing figure
 * (the caller commits the hold instead).
 */
export function routedSettlementCredits(args: {
  providerCostUsd: number
  priceId: string
  settings: MarginSettings
  /** The quote the run was held at, in USD, times its factor. */
  quotedUsd: number
}): { baseCredits: number; chargedCredits: number; capped: boolean } {
  const { providerCostUsd: cost } = args
  if (typeof cost !== "number" || !Number.isFinite(cost) || cost <= 0) throw new Error(`routed settlement: no billed cost (${String(cost)})`)
  const bound = args.quotedUsd > 0 ? args.quotedUsd * ROUTE_SETTLE_MAX_OF_QUOTE : Number.POSITIVE_INFINITY
  const capped = cost > bound
  const baseCredits = routeUsdToBaseCredits(capped ? bound : cost)
  return { baseCredits, chargedCredits: routedChargedCredits(baseCredits, args.priceId, args.settings), capped }
}


