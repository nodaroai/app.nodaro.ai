/**
 * The alternate route's LISTED prices: `PluginServices.alternateRoutes.prices()`
 * (USD per platform price id), read once per loaded service — the plugin's
 * table never changes while it is loaded — and kept apart from the default
 * prices, which it never overwrites. Listings only (model lists, "from"
 * prices): a routed run is held from the route's `quote` and charged from
 * what its task billed (ee/billing/video-route-pricing.ts).
 *
 * Also the process's `RouteView` (video-route-decision.ts). ONE source for
 * every process of an environment: a process that loaded the plugins reads
 * its service, and publishes what it read (`video_route_listing`, per
 * environment); a process that loads no plugin (the standalone orchestrator)
 * reads that published copy, so it lists — and decides "is this model
 * routed here" — exactly as the API does.
 */
import { getPluginServices, pluginServicesLoaded } from "./private-plugins/services-registry.js"
import type { PluginAlternateRoutesService } from "./private-plugins/types.js"
import { getRuntimeEnv } from "./runtime-env.js"
import { ROUTABLE_VIDEO_MODELS } from "./video-route-policy.js"
import { routeViewOf, type RouteView } from "./video-route-decision.js"

/** The app_settings row the listing is published under, one entry per environment. */
export const VIDEO_ROUTE_LISTING_KEY = "video_route_listing"

/** What a process with the plugin publishes for its environment. */
export interface RouteListingSnapshot {
  /** The route speaks the second version of the contract. */
  readonly v2: boolean
  /** The routable models it knows (`capable`). */
  readonly capable: readonly string[]
  /** USD per listed platform price id. */
  readonly pricesUsd: Readonly<Record<string, number>>
  readonly at: string
}

let memo: { service: PluginAlternateRoutesService; prices: Readonly<Record<string, number>> | null } | null = null

function readPrices(service: PluginAlternateRoutesService): Readonly<Record<string, number>> | null {
  if (typeof service.prices !== "function") return null
  let raw: unknown
  try {
    raw = service.prices()
  } catch (err) {
    console.error(`[ALERT] [video-route] the alternate route's prices() threw; it lists no prices: ${err instanceof Error ? err.message : String(err)}`)
    return Object.freeze({})
  }
  const out: Record<string, number> = {}
  if (!Array.isArray(raw)) return Object.freeze(out)
  for (const entry of raw as unknown[]) {
    const { id, usd } = (entry ?? {}) as { id?: unknown; usd?: unknown }
    // A listed price is a positive USD cost under a platform id; anything else is not a price.
    if (typeof id === "string" && id.length > 0 && typeof usd === "number" && Number.isFinite(usd) && usd > 0) out[id] = usd
  }
  return Object.freeze(out)
}

/** The route's listed USD prices by platform id in this process; null when it has no V2 route service. */
export function alternateRoutePrices(): Readonly<Record<string, number>> | null {
  const service = getPluginServices().alternateRoutes
  if (!service) return null
  if (memo?.service !== service) memo = { service, prices: readPrices(service) }
  return memo.prices
}

/**
 * This process's route view, or null when no route service is loaded here.
 * `modelOf` names the model a price id prices (the billing side's
 * `routedPriceIdOf`), so a route that lists only extend or finalize rows of a
 * model still reads as knowing it.
 */
export function currentRouteView(modelOf?: (priceId: string) => string | undefined): RouteView | null {
  return routeViewOf(getPluginServices().alternateRoutes, alternateRoutePrices(), modelOf)
}

/** What this process would publish for its environment (null: no plugins loaded here — nothing to say). */
export function routeListingSnapshotOf(modelOf?: (priceId: string) => string | undefined, now = new Date()): RouteListingSnapshot | null {
  if (!pluginServicesLoaded()) return null
  const view = currentRouteView(modelOf)
  return {
    v2: view?.v2 === true,
    capable: view?.v2 ? ROUTABLE_VIDEO_MODELS.filter((m) => view.capable(m)) : [],
    pricesUsd: alternateRoutePrices() ?? {},
    at: now.toISOString(),
  }
}

/** The published snapshot of THIS environment, from the settings row's value. */
export function routeListingSnapshotFor(raw: unknown, env = getRuntimeEnv()): RouteListingSnapshot | null {
  if (typeof raw !== "object" || raw === null) return null
  const s = (raw as Record<string, unknown>)[env] as Partial<RouteListingSnapshot> | undefined
  if (!s || typeof s !== "object") return null
  const pricesUsd: Record<string, number> = {}
  for (const [id, usd] of Object.entries(s.pricesUsd ?? {})) if (typeof usd === "number" && Number.isFinite(usd) && usd > 0) pricesUsd[id] = usd
  return {
    v2: s.v2 === true,
    capable: Array.isArray(s.capable) ? s.capable.filter((m): m is string => typeof m === "string") : [],
    pricesUsd,
    at: typeof s.at === "string" ? s.at : "",
  }
}

/**
 * The listing source of this process: its own route when it loaded the
 * plugins, else its environment's published snapshot (`raw` — the settings
 * row's value). A snapshot's view answers capability from the published list
 * and accepts nothing (no admission ever runs from it: the orchestrator
 * admits through the API).
 */
export function routeListingSource(
  raw: unknown,
  modelOf?: (priceId: string) => string | undefined,
): { view: RouteView | null; pricesUsd: Readonly<Record<string, number>> | null } {
  if (pluginServicesLoaded()) return { view: currentRouteView(modelOf), pricesUsd: alternateRoutePrices() }
  const snap = routeListingSnapshotFor(raw)
  if (!snap) return { view: null, pricesUsd: null }
  return {
    view: { v2: snap.v2, capable: (m) => snap.capable.includes(m), accepts: () => null },
    pricesUsd: snap.pricesUsd,
  }
}

/** Test seam. */
export function _resetAlternateRoutePricesForTests(): void {
  memo = null
}
