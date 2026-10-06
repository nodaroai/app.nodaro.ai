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
 * The two parts come from the listing estimator (`estimateWorkflowListingCredits`).
 */
import { calculateMonetizedCost } from "@nodaro/shared"

export interface AppListingSplit {
  /** The whole graph at its saved settings (each render set to Preview at Preview). */
  readonly preview: number
  /** Each Render final: the render at Final and what follows it. */
  readonly final: number
}

export interface AppMonetization {
  readonly enabled: boolean
  readonly flatFee: number
  readonly percent: number
}

/** The preview with the fee (never on a free preview, as before the split). */
function previewWithFee(preview: number, m: AppMonetization): number {
  return m.enabled && preview > 0 ? calculateMonetizedCost(preview, m.flatFee, m.percent) : preview
}

/** The stored pair: the fee's base, and the listed price. */
export function appListingPrice(split: AppListingSplit, monetization: AppMonetization): { base: number; estimated: number } {
  return { base: split.preview, estimated: previewWithFee(split.preview, monetization) + split.final }
}

/** The final part a stored row holds: its listed price less the preview with its fee. Never negative. */
export function appListingFinalCredits(stored: { readonly base: number; readonly estimated: number }, monetization: AppMonetization): number {
  return Math.max(0, stored.estimated - previewWithFee(stored.base, monetization))
}

/** A `published_apps` row's monetization and stored prices, as the columns hold them. */
export interface StoredAppListing {
  readonly base_estimated_credits?: number | null
  readonly estimated_credits?: number | null
  readonly monetization_enabled?: boolean | null
  readonly monetization_flat_fee?: number | null
  readonly monetization_percent?: number | null
}

/** The final part a stored version holds (`appListingFinalCredits` over its columns). */
export function storedListingFinalCredits(row: StoredAppListing): number {
  return appListingFinalCredits(
    { base: row.base_estimated_credits ?? 0, estimated: row.estimated_credits ?? row.base_estimated_credits ?? 0 },
    { enabled: !!row.monetization_enabled, flatFee: row.monetization_flat_fee ?? 0, percent: row.monetization_percent ?? 0 },
  )
}
