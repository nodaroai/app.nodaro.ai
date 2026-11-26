// @registry-enumerates prices the HDR add-on id it builds by getModelCreditBaseCost — a credit id, not a node type, so not a @registry-lookup
import { videoHdrAddonCreditId } from "@nodaro/shared/credits"
import { hasCredits } from "./config.js"

/**
 * The BASE (pre-markup) credits of a video run's HDR add-on (decided
 * 2026-11-22): its own price row (`videoHdrAddonCreditId`, Kling 4.0:
 * `kling-4-hdr:<N>s:<res>`), read DB-first like every other row, on the
 * OUTPUT seconds only. 0 for an SDR run, a model without HDR, or an edition
 * without credits.
 *
 * The ONE price every holder and settler of an HDR run reads: both video
 * routes' `computeCredits` (so a quote too), the workflow reservation, and the
 * reference-video settle, which commits a measured base in place of the hold
 * and so must add the add-on back, or it would be refused on every `-ref` run.
 * A pricing failure throws (`PriceNotConfiguredError`), as for the clip's own
 * row: an HDR run is never held without its add-on.
 *
 * Core shim over the ee price lookup (dynamic import, the credit-guard
 * pattern): community/business never load a billing module.
 */
export async function videoHdrAddonBaseCredits(args: {
  provider: string | undefined
  /** The request's duration (the run renders it; `pricedOutputDurationSec` reads it). */
  duration: number | string | undefined
  /** The resolution the run renders at, normalized (`resolveVideoRequestNorm`). */
  resolution: string | undefined
  dynamicRange: unknown
}): Promise<number> {
  if (!hasCredits() || !args.provider) return 0
  const id = videoHdrAddonCreditId(args.provider, args.duration, args.resolution, args.dynamicRange)
  if (id === undefined) return 0
  const { getModelCreditBaseCost } = await import("../ee/billing/credits.js")
  return (await getModelCreditBaseCost(id)).creditCost
}
