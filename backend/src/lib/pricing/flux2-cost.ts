/**
 * Canonical provider-cost formula for Replicate Flux 2 image models — CORE
 * (not ee/): `providers/replicate/image.ts` needs the real USD cost
 * regardless of edition, and `ee/billing/credits.ts` needs it to seed the
 * at-cost credit-reservation table. The model-id enum and UI resolution
 * options stay in `@nodaro/shared` (`flux2-pricing.ts`) — this file holds
 * only the provider-$ rate table and the formulas derived from it.
 *
 * Moved out of `packages/shared` (published Apache-2.0 on npm — an
 * irrevocable grant) per the 2026-07-06 public-flip IP audit, S5.
 *
 * Pricing (provisional, locked by product):
 *   flux-2-pro:   base $0.015, perOutMP $0.015, perRefMP $0.015
 *   flux-2-max:   base $0,     perOutMP $0.07,  perRefMP $0.03
 *   flux-2-klein: base $0,     perOutMP $0.006, perRefMP $0.006
 *
 * Ref approximation: each reference image's MP is treated as equal to outputMP.
 */
import type { Flux2Model } from "@nodaro/shared"

const RATES: Record<Flux2Model, { base: number; perOutMP: number; perRefMP: number }> = {
  "flux-2-pro":   { base: 0.015, perOutMP: 0.015, perRefMP: 0.015 },
  "flux-2-max":   { base: 0,     perOutMP: 0.07,  perRefMP: 0.03  },
  "flux-2-klein": { base: 0,     perOutMP: 0.006, perRefMP: 0.006 },
}

/** Real provider cost (USD). Each ref's MP is approximated as outputMP. */
export function flux2CostUsd(model: Flux2Model, outputMP: number, refCount = 0): number {
  const r = RATES[model]
  return r.base + r.perOutMP * outputMP + r.perRefMP * outputMP * Math.max(0, refCount)
}

/** 0%-base credits for the reservation table (markup applied once at lookup). 1 credit = $0.02.
 *
 * Uses milli-credit intermediate rounding to avoid IEEE-754 division noise
 * (e.g., 0.14 / 0.02 = 7.000000000000001 in float64 → would ceil to 8 without this guard).
 * 1000 milli-credits per credit gives sub-0.1% resolution, well below any pricing granularity.
 */
export function flux2BaseCredits(model: Flux2Model, outputMP: number, refCount = 0): number {
  const milliCredits = Math.round(flux2CostUsd(model, outputMP, refCount) / 0.02 * 1000)
  return Math.ceil(milliCredits / 1000)
}
