/**
 * Canonical cost formula for Replicate Flux 2 image models.
 * Single source of truth — backend billing, frontend pricing display,
 * and credit-identifier builder all derive from these functions.
 *
 * Pricing (provisional, locked by product):
 *   flux-2-pro:   base $0.015, perOutMP $0.015, perRefMP $0.015
 *   flux-2-max:   base $0,     perOutMP $0.07,  perRefMP $0.03
 *   flux-2-klein: base $0,     perOutMP $0.006, perRefMP $0.006
 *
 * Ref approximation: each reference image's MP is treated as equal to outputMP.
 */

export type Flux2Model = "flux-2-klein" | "flux-2-pro" | "flux-2-max"

/** Megapixel tiers offered in the UI (strings; the value space for data.resolution). */
export const FLUX2_RES_MP = ["0.5", "1", "2", "4"] as const

const RATES: Record<Flux2Model, { base: number; perOutMP: number; perRefMP: number }> = {
  "flux-2-pro":   { base: 0.015, perOutMP: 0.015, perRefMP: 0.015 },
  "flux-2-max":   { base: 0,     perOutMP: 0.07,  perRefMP: 0.03  },
  "flux-2-klein": { base: 0,     perOutMP: 0.006, perRefMP: 0.006 },
}

export function isFlux2Model(m: string): m is Flux2Model {
  return m === "flux-2-klein" || m === "flux-2-pro" || m === "flux-2-max"
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
