/**
 * Per-service margin resolution.
 *
 * The global `cost_markup_percent` admin setting applies one margin to every
 * priced identifier. Some services warrant their own margin instead — the
 * admin sets those in the `service_margin_percent` setting, a map of
 * identifier-prefix → percent (e.g. `{ "some-service": 30 }`), edited in the
 * admin panel and stored in `app_settings`.
 *
 * DELIBERATELY DATA-DRIVEN: this module contains no service names and no
 * percentages — which services carry their own margin, and how much, is
 * runtime configuration living only in the database. Keep it that way.
 *
 * Semantics:
 * - A prefix matches an identifier when they are equal or the identifier
 *   continues with a `:` composite separator (`"svc"` matches `"svc"` and
 *   `"svc:10s"`, never `"svc-other"`).
 * - The LONGEST matching prefix wins, so `"svc:pro"` can carry a different
 *   margin than the broader `"svc"`.
 * - A matched margin REPLACES the global markup for that identifier (override,
 *   not stacking) — the configured number IS the service's margin.
 * - No match → the global `cost_markup_percent` applies unchanged.
 */
import type { AppSettings } from "../../lib/app-settings.js"
import { pricedAsId } from "../../lib/retired-price-id.js"

/** Settings slice this module needs; `service_margin_percent` tolerated absent
 *  (older cached shapes, partial test doubles) and treated as empty. */
type MarginSettings = Pick<AppSettings, "cost_markup_percent"> &
  Partial<Pick<AppSettings, "service_margin_percent">>

/** True when `prefix` covers `identifier` on a `:` boundary. */
export function serviceMarginPrefixMatches(identifier: string, prefix: string): boolean {
  return identifier === prefix || identifier.startsWith(`${prefix}:`)
}

/**
 * The markup percent to apply for `modelIdentifier`: its longest-prefix
 * service margin when one is configured, else the global markup. A retired
 * video model's id is marked up as the id it runs as (`pricedAsId`), here,
 * where every markup is decided: a quote, a route's reservation (at the
 * request's raw id) and the settle (at the usage log's raw action) then agree.
 */
export function effectiveMarkupPercent(
  settings: MarginSettings,
  modelIdentifier: string,
): number {
  const identifier = pricedAsId(modelIdentifier)
  let matched: { prefix: string; percent: number } | null = null
  for (const [prefix, percent] of Object.entries(settings.service_margin_percent ?? {})) {
    if (!serviceMarginPrefixMatches(identifier, prefix)) continue
    if (!matched || prefix.length > matched.prefix.length) matched = { prefix, percent }
  }
  return matched ? matched.percent : settings.cost_markup_percent
}

/**
 * `base` credits marked up by `percent`, rounded UP to a whole credit — THE
 * single markup-rounding formula for the whole platform.
 *
 * Integer-domain on purpose. `Math.ceil(base * (1 + percent / 100))` rounds a
 * float that IEEE-754 can land a hair ABOVE the true value (e.g. 720 × 1.10 =
 * 792.0000000000001 → ceil 793), over-charging by a full credit whenever the
 * exact product is already an integer. `ceil(base * (100 + percent) / 100)`
 * keeps the multiply in integers (72000 + 7200 = 79200, /100 = 792 → ceil 792).
 * Percent is admin-validated to [0, 500], so `percent <= 0` (and `base <= 0`)
 * are the only no-op cases.
 *
 * Reserve, guard, DAG override, per-service margin, the metered settlement, and
 * the anomaly-detector's "actual" all route through this one function, so a
 * reservation can never round differently from the settlement that trues it up
 * — a drift that would manufacture phantom credit anomalies.
 */
export function applyMarkupPercent(base: number, percent: number): number {
  return percent > 0 && base > 0 ? Math.ceil((base * (100 + percent)) / 100) : base
}

/**
 * `baseCredits` marked up ONCE at `modelIdentifier`'s effective percent — the
 * single formula a reservation and the settlement that trues it up must share.
 * `credit-guard-impl.ts` applies it to every route reservation; the DAG's
 * credit overrides and `commitJobCredits`'s count-based branch call this, so a
 * per-service margin can never be applied at reserve and forgotten at commit
 * (which would silently eat the refund a measured settlement exists to give).
 */
export function applyServiceMarkup(
  baseCredits: number,
  settings: MarginSettings,
  modelIdentifier: string,
): number {
  return applyMarkupPercent(baseCredits, effectiveMarkupPercent(settings, modelIdentifier))
}
