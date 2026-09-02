import {
  normalizeVideoRequestParams,
  pricedVideoSelection,
  type ModelInputAdjustment,
} from "@nodaro/shared"

/**
 * The normalized + priced video params for one request — the values a video
 * lane prices, persists to `input_data` and sends on the wire. They must be the
 * SAME values at all three billing sites (credit-identifier preHandler,
 * `computeCredits`, reservation) because `commit_credits` (migration 176) only
 * ever refunds a surplus and never collects a shortfall, so the reservation IS
 * the final charge.
 */
export interface VideoRequestNorm {
  /** Catalog-snapped aspect ratio. Billing-neutral; rides along so the wire and
   *  `input_data` record what we actually sent. */
  aspectRatio?: string
  /** Catalog-snapped resolution, or — when the request omitted one — the band
   *  the credit identifier prices, where the platform declares it. */
  resolution?: string
  /** Set ONLY when the provider's price is keyed to a seeded duration tier the
   *  request missed (LTX). `undefined` means "send the requested duration". */
  duration?: number
  /** Levers the caller asked for and did not get, for disclosure. */
  adjustments: ModelInputAdjustment[]
}

/**
 * The ONE place a video request's catalog-governed params become the values we
 * price, persist and send. Both video routes call it at all three billing sites
 * and in their handler, and the orchestrator's video branches call it too; it is
 * pure, so those sites cannot disagree by construction.
 *
 * Two steps, in order — the second depends on the first:
 *   1. `normalizeVideoRequestParams` snaps aspectRatio/resolution onto the
 *      model's catalog list (NEAREST, case-canonicalised, never dropped —
 *      dropping a resolution would LOWER the reserved tier).
 *   2. `pricedVideoSelection` fills what the credit identifier ASSUMES for a
 *      lever the request omitted (only where the platform declares that band as
 *      the provider's own default) and carries the seeded LTX duration tier.
 *      Without it a route reserves 1080p and sends no resolution at all, letting
 *      the provider apply its own undocumented default — and reserves the 6s LTX
 *      tier while sending 7s.
 *
 * Lives in `lib/` rather than beside its first caller so the orchestrator can
 * reach it without importing a route module (the video routes statically import
 * `ee/billing/credits.js`, which core code may not pull in transitively).
 */
export function resolveVideoRequestNorm(input: {
  provider: string
  aspectRatio?: string
  resolution?: string
  duration?: number | string
}): VideoRequestNorm {
  const norm = normalizeVideoRequestParams(input.provider, {
    aspectRatio: input.aspectRatio,
    resolution: input.resolution,
  })
  const priced = pricedVideoSelection({
    provider: input.provider,
    resolution: norm.resolution,
    duration: input.duration,
  })
  return {
    aspectRatio: norm.aspectRatio,
    resolution: norm.resolution ?? priced.resolution,
    duration: priced.duration,
    adjustments: [...norm.adjustments, ...priced.adjustments],
  }
}
