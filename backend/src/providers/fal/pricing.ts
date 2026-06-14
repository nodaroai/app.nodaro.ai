/**
 * fal.ai provider pricing.
 *
 * fal bills per endpoint in one of three shapes:
 *  - `per_second` — `rate` is USD per second of OUTPUT media (e.g. lip-sync,
 *    video generation). Cost = seconds × rate.
 *  - `per_image`  — `rate` is USD per generated image. Cost = images × rate
 *    (defaults to 1 image when the caller doesn't pass a count).
 *  - `flat`       — fixed USD per request regardless of output size.
 *
 * `FAL_PRICING` is keyed by our internal model id (NOT the fal endpoint slug) so
 * the rest of the codebase keeps a stable identifier even if fal renames an
 * endpoint. `falCostUsd` returns the raw provider USD cost (no markup) — the
 * credit layer applies markup downstream, mirroring the Replicate `extractCost`
 * convention. Unknown ids return `null` (cost unknown) rather than 0 so callers
 * can distinguish "free" from "not priced".
 */

export type FalBillingUnit = "per_second" | "per_image" | "flat"

export interface FalPrice {
  unit: FalBillingUnit
  /** USD rate. Meaning depends on `unit` (per second / per image / flat). */
  rate: number
}

/**
 * fal endpoint pricing, keyed by our internal model id.
 * `sync-lipsync-v3` → fal endpoint `fal-ai/sync-lipsync/v3`, $0.13333/output-second.
 */
export const FAL_PRICING: Record<string, FalPrice> = {
  "sync-lipsync-v3": { unit: "per_second", rate: 0.13333 },
}

/**
 * Compute the raw provider USD cost for a fal generation.
 *
 * @param id internal model id (a key of `FAL_PRICING`)
 * @param m  measured output: `seconds` for per_second, `images` for per_image
 * @returns USD cost, or `null` when `id` has no pricing entry.
 */
export function falCostUsd(
  id: string,
  m: { seconds?: number; images?: number },
): number | null {
  const price = FAL_PRICING[id]
  if (!price) return null
  switch (price.unit) {
    case "per_second":
      return (m.seconds ?? 0) * price.rate
    case "per_image":
      return (m.images ?? 1) * price.rate
    case "flat":
      return price.rate
  }
}
