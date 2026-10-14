/**
 * A published app's listed price (decided 2026-10-06): the PREVIEW part with
 * the creator's fee, plus the FINAL part without it.
 *
 * - The preview part is the whole graph at its saved settings, each render set
 *   to Preview at Preview. With the preview stop rule off an app run executes
 *   all of it and earns the fee on all of it; staging and production share one
 *   database, so the stored listing cannot follow the flag and must never
 *   under-quote that run. With the flag on a run stops at each Preview, so
 *   this part over-quotes by the tail (accepted; revisit when production turns
 *   the flag on).
 * - The final part is each Render final: the render at Final and the nodes
 *   after it, run outside the app run at the nodes' own prices
 *   (`services/app-render-final.ts`). An app with no Preview render, and a
 *   component, has none.
 *
 * Stored on the version: `base_estimated_credits` is the part the fee applies
 * to (the preview part), `estimated_credits` the listed price. The final part
 * is their difference less the fee, so the monetization recalculation stays
 * exact without another column — and a listing stored before the split reads
 * as having none until its next publish recomputes it.
 *
 * Each part is fixed credits plus credits per minute of the episode (decided
 * 2026-10-07; 0 per minute when the price does not follow a recording's
 * length). The fee applies to the preview part's two halves as a run is
 * charged it (`calculateMonetizationMarkup` on the run's total, in the
 * orchestrator): the flat fee once, on the fixed half; the percentage on each
 * half, each rounded up to a whole credit, so the listed price at any length
 * is never below the charge. `base_per_minute_credits` /
 * `per_minute_credits` store the per-minute pair the way the fixed pair is
 * stored.
 *
 * A List the app's user fills adds a third pair (decided 2026-10-07):
 * `base_per_item_credits` / `per_item_credits`, credits per item beyond the
 * creator's saved count, priced like the per-minute pair (the percentage
 * only, rounded up; the final part's carries no fee).
 *
 * The parts come from the listing estimator (`estimateWorkflowListingCredits`).
 */
import { calculateMonetizedCost } from "@nodaro/shared"

export interface AppListingSplit {
  /** The whole graph at its saved settings (each render set to Preview at Preview): fixed credits. */
  readonly preview: number
  /** Each Render final: the render at Final and what follows it: fixed credits. */
  readonly final: number
  /** The preview part's credits per minute of the episode (0 or absent: none). */
  readonly previewPerMinute?: number
  /** The final part's credits per minute of the episode (0 or absent: none). */
  readonly finalPerMinute?: number
  /** The preview part's credits per item beyond the creator's saved count, for
   *  a List the app's user fills (decided 2026-10-07; 0 or absent: none). */
  readonly previewPerItem?: number
  /** The final part's credits per further item (0 or absent: none). */
  readonly finalPerItem?: number
}

export interface AppMonetization {
  readonly enabled: boolean
  readonly flatFee: number
  readonly percent: number
}

/** Does the fee apply to the preview run? Never on a free one (as before the split), as the run settles it. */
function feeApplies(m: AppMonetization, preview: number, previewPerMinute: number): boolean {
  return m.enabled && (preview > 0 || previewPerMinute > 0)
}

/** The preview's fixed half with the fee: the flat fee and the percentage of it. */
function previewWithFee(preview: number, previewPerMinute: number, m: AppMonetization): number {
  return feeApplies(m, preview, previewPerMinute) ? calculateMonetizedCost(preview, m.flatFee, m.percent) : preview
}

/** The preview's per-minute half with the fee: the percentage alone, rounded up (the flat fee is once, in the fixed half). */
function previewPerMinuteWithFee(previewPerMinute: number, m: AppMonetization): number {
  return feeApplies(m, 0, previewPerMinute) ? calculateMonetizedCost(previewPerMinute, 0, m.percent) : previewPerMinute
}

/** The stored pairs: the fee's base and the listed price, fixed, per minute and per further item. */
export function appListingPrice(
  split: AppListingSplit,
  monetization: AppMonetization,
): { base: number; estimated: number; basePerMinute: number; perMinute: number; basePerItem: number; perItem: number } {
  const previewPerMinute = split.previewPerMinute ?? 0
  const previewPerItem = split.previewPerItem ?? 0
  return {
    base: split.preview,
    estimated: previewWithFee(split.preview, previewPerMinute, monetization) + split.final,
    basePerMinute: previewPerMinute,
    perMinute: previewPerMinuteWithFee(previewPerMinute, monetization) + (split.finalPerMinute ?? 0),
    basePerItem: previewPerItem,
    // The percentage alone, rounded up, as per minute: the flat fee is once, in the fixed half.
    perItem: previewPerMinuteWithFee(previewPerItem, monetization) + (split.finalPerItem ?? 0),
  }
}

/** A stored row's prices: the fee's bases and the listed prices, fixed and per minute. */
export interface StoredListingPrices {
  readonly base: number
  readonly estimated: number
  readonly basePerMinute?: number
  readonly perMinute?: number
  readonly basePerItem?: number
  readonly perItem?: number
}

/** The final part's fixed credits a stored row holds: its listed price less the preview with its fee. Never negative. */
export function appListingFinalCredits(stored: StoredListingPrices, monetization: AppMonetization): number {
  return Math.max(0, stored.estimated - previewWithFee(stored.base, stored.basePerMinute ?? 0, monetization))
}

/** The final part's per-minute credits a stored row holds. Never negative. */
export function appListingFinalPerMinute(stored: StoredListingPrices, monetization: AppMonetization): number {
  return Math.max(0, (stored.perMinute ?? 0) - previewPerMinuteWithFee(stored.basePerMinute ?? 0, monetization))
}

/** The final part's per-item credits a stored row holds. Never negative. */
export function appListingFinalPerItem(stored: StoredListingPrices, monetization: AppMonetization): number {
  return Math.max(0, (stored.perItem ?? 0) - previewPerMinuteWithFee(stored.basePerItem ?? 0, monetization))
}

/** A `published_apps` row's monetization and stored prices, as the columns hold them. */
export interface StoredAppListing {
  readonly base_estimated_credits?: number | null
  readonly estimated_credits?: number | null
  /** Absent when the column was not read (or does not exist yet): 0. */
  readonly base_per_minute_credits?: number | null
  readonly per_minute_credits?: number | null
  /** Absent when the column was not read (or does not exist yet): 0. */
  readonly base_per_item_credits?: number | null
  readonly per_item_credits?: number | null
  readonly monetization_enabled?: boolean | null
  readonly monetization_flat_fee?: number | null
  readonly monetization_percent?: number | null
}

function storedPricesOf(row: StoredAppListing): { stored: StoredListingPrices; monetization: AppMonetization } {
  return {
    stored: {
      base: row.base_estimated_credits ?? 0,
      estimated: row.estimated_credits ?? row.base_estimated_credits ?? 0,
      basePerMinute: row.base_per_minute_credits ?? 0,
      perMinute: row.per_minute_credits ?? row.base_per_minute_credits ?? 0,
      basePerItem: row.base_per_item_credits ?? 0,
      perItem: row.per_item_credits ?? row.base_per_item_credits ?? 0,
    },
    monetization: { enabled: !!row.monetization_enabled, flatFee: row.monetization_flat_fee ?? 0, percent: row.monetization_percent ?? 0 },
  }
}

/** The final part's fixed credits a stored version holds (`appListingFinalCredits` over its columns). */
export function storedListingFinalCredits(row: StoredAppListing): number {
  const { stored, monetization } = storedPricesOf(row)
  return appListingFinalCredits(stored, monetization)
}

/** The final part's per-minute credits a stored version holds (`appListingFinalPerMinute` over its columns). */
export function storedListingFinalPerMinute(row: StoredAppListing): number {
  const { stored, monetization } = storedPricesOf(row)
  return appListingFinalPerMinute(stored, monetization)
}

/** The final part's per-item credits a stored version holds (`appListingFinalPerItem` over its columns). */
export function storedListingFinalPerItem(row: StoredAppListing): number {
  const { stored, monetization } = storedPricesOf(row)
  return appListingFinalPerItem(stored, monetization)
}

/**
 * What the app run ALONE is listed at (review round F4, decided 2026-10-07):
 * the listed price less its Render final part, fixed and per minute — the
 * preview with the creator's fee, which is what the run is charged on (a
 * Render final is run and charged separately). The app runner's Run button
 * shows this pair until the recording's length is known, so the exact figure
 * that then replaces it prices the same run. Marketplace cards keep the full
 * listing. A row with no fee base stored reads as having no final part: its
 * listed price.
 */
export function storedListingRunPrice(row: StoredAppListing): { fixed: number; perMinute: number; perItem: number } {
  const { stored } = storedPricesOf(row)
  const fixed = stored.estimated
  const perMinute = stored.perMinute ?? 0
  const perItem = stored.perItem ?? 0
  if (row.base_estimated_credits == null) return { fixed, perMinute, perItem }
  return {
    fixed: fixed - storedListingFinalCredits(row),
    perMinute: perMinute - storedListingFinalPerMinute(row),
    perItem: perItem - storedListingFinalPerItem(row),
  }
}

/**
 * A stored version's listing recomputed under new monetization: the parts
 * read back from the stored pairs, priced again (a fee change on the
 * monetization PATCH). Returns every column of both pairs.
 */
export function relistedAppPrices(
  row: StoredAppListing,
  monetization: AppMonetization,
): {
  estimated_credits: number
  base_per_minute_credits: number
  per_minute_credits: number
  base_per_item_credits: number
  per_item_credits: number
} {
  const split: AppListingSplit = {
    preview: row.base_estimated_credits ?? 0,
    final: storedListingFinalCredits(row),
    previewPerMinute: row.base_per_minute_credits ?? 0,
    finalPerMinute: storedListingFinalPerMinute(row),
    previewPerItem: row.base_per_item_credits ?? 0,
    finalPerItem: storedListingFinalPerItem(row),
  }
  const priced = appListingPrice(split, monetization)
  return {
    estimated_credits: priced.estimated,
    base_per_minute_credits: priced.basePerMinute,
    per_minute_credits: priced.perMinute,
    base_per_item_credits: priced.basePerItem,
    per_item_credits: priced.perItem,
  }
}

/**
 * The "up to" columns (migration 517, decided 2026-10-14) for a listing's
 * CEILING — the most a run can cost over the choices the app's user has
 * (`estimateWorkflowListingRange`) — priced exactly as the "from" columns are
 * (`appListingPrice`: the fee on the preview part, the final part unmarked).
 */
export function appListingMaxColumns(
  ceiling: AppListingSplit,
  monetization: AppMonetization,
): {
  base_max_estimated_credits: number
  max_estimated_credits: number
  base_max_per_minute_credits: number
  max_per_minute_credits: number
  base_max_per_item_credits: number
  max_per_item_credits: number
} {
  const top = appListingPrice(ceiling, monetization)
  return {
    base_max_estimated_credits: top.base,
    max_estimated_credits: top.estimated,
    base_max_per_minute_credits: top.basePerMinute,
    max_per_minute_credits: top.perMinute,
    base_max_per_item_credits: top.basePerItem,
    max_per_item_credits: top.perItem,
  }
}

/** A `published_apps` row's "up to" columns, as stored (NULL: not computed). */
export interface StoredAppListingMax extends StoredAppListing {
  readonly base_max_estimated_credits?: number | null
  readonly max_estimated_credits?: number | null
  readonly base_max_per_minute_credits?: number | null
  readonly max_per_minute_credits?: number | null
  readonly base_max_per_item_credits?: number | null
  readonly max_per_item_credits?: number | null
}

/**
 * The "up to" columns re-priced under new monetization (a fee change), read
 * back from the stored ceiling the way `relistedAppPrices` reads the "from"
 * pair. A row with no ceiling stored gets none ({}): it lists its "from" alone
 * until its next publish or the backfill.
 */
export function relistedAppMaxPrices(row: StoredAppListingMax, monetization: AppMonetization): Partial<ReturnType<typeof appListingMaxColumns>> {
  if (row.max_estimated_credits == null) return {}
  const asFrom: StoredAppListing = {
    base_estimated_credits: row.base_max_estimated_credits ?? row.max_estimated_credits,
    estimated_credits: row.max_estimated_credits,
    base_per_minute_credits: row.base_max_per_minute_credits ?? 0,
    per_minute_credits: row.max_per_minute_credits ?? 0,
    base_per_item_credits: row.base_max_per_item_credits ?? 0,
    per_item_credits: row.max_per_item_credits ?? 0,
    monetization_enabled: row.monetization_enabled,
    monetization_flat_fee: row.monetization_flat_fee,
    monetization_percent: row.monetization_percent,
  }
  return appListingMaxColumns({
    preview: asFrom.base_estimated_credits ?? 0,
    final: storedListingFinalCredits(asFrom),
    previewPerMinute: asFrom.base_per_minute_credits ?? 0,
    finalPerMinute: storedListingFinalPerMinute(asFrom),
    previewPerItem: asFrom.base_per_item_credits ?? 0,
    finalPerItem: storedListingFinalPerItem(asFrom),
  }, monetization)
}

/** The "up to" a listing shows, on the API's wire. Empty when it has none to show. */
export interface ListingRangeFields {
  readonly maxEstimatedCredits?: number
  readonly maxPerMinuteCredits?: number
  readonly maxPerItemCredits?: number
}

/**
 * The listed "up to" of a stored row — all three figures when any of them is
 * above its "from" counterpart (the card shows "from X – up to Y" only when
 * they differ), else none. A row with no ceiling stored (NULL) has none.
 */
export function storedListingRange(row: {
  readonly estimated_credits?: number | null
  readonly per_minute_credits?: number | null
  readonly per_item_credits?: number | null
  readonly max_estimated_credits?: number | null
  readonly max_per_minute_credits?: number | null
  readonly max_per_item_credits?: number | null
}): ListingRangeFields {
  if (row.max_estimated_credits == null) return {}
  const fixed = Math.max(row.max_estimated_credits, row.estimated_credits ?? 0)
  const perMinute = Math.max(row.max_per_minute_credits ?? 0, row.per_minute_credits ?? 0)
  const perItem = Math.max(row.max_per_item_credits ?? 0, row.per_item_credits ?? 0)
  const differs = fixed > (row.estimated_credits ?? 0) || perMinute > (row.per_minute_credits ?? 0) || perItem > (row.per_item_credits ?? 0)
  return differs ? { maxEstimatedCredits: fixed, maxPerMinuteCredits: perMinute, maxPerItemCredits: perItem } : {}
}

/**
 * A raw listing row as an MCP listing returns it (snake_case): the stored "up
 * to" columns replaced by the listed range — `max_estimated_credits`,
 * `max_per_minute_credits`, `max_per_item_credits` present only when a choice
 * the app's user has can cost more than the "from" figures.
 */
export function withListedRangeSnake(row: Record<string, unknown>): Record<string, unknown> {
  const { max_estimated_credits, max_per_minute_credits, max_per_item_credits, ...rest } = row
  const range = storedListingRange({ ...(rest as Record<string, number | null>), max_estimated_credits: max_estimated_credits as number | null, max_per_minute_credits: max_per_minute_credits as number | null, max_per_item_credits: max_per_item_credits as number | null })
  if (range.maxEstimatedCredits === undefined) return rest
  return { ...rest, max_estimated_credits: range.maxEstimatedCredits, max_per_minute_credits: range.maxPerMinuteCredits, max_per_item_credits: range.maxPerItemCredits }
}

/** A template's listed "up to" (no fee): both figures when either is above its "from", else none. */
export function storedTemplateRange(row: {
  readonly estimated_credits?: number | null
  readonly estimated_per_minute_credits?: number | null
  readonly max_estimated_credits?: number | null
  readonly max_estimated_per_minute_credits?: number | null
}): { maxEstimatedCredits?: number; maxEstimatedPerMinuteCredits?: number } {
  if (row.max_estimated_credits == null) return {}
  const fixed = Math.max(row.max_estimated_credits, row.estimated_credits ?? 0)
  const perMinute = Math.max(row.max_estimated_per_minute_credits ?? 0, row.estimated_per_minute_credits ?? 0)
  const differs = fixed > (row.estimated_credits ?? 0) || perMinute > (row.estimated_per_minute_credits ?? 0)
  return differs ? { maxEstimatedCredits: fixed, maxEstimatedPerMinuteCredits: perMinute } : {}
}
