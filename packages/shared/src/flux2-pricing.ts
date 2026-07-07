/**
 * Model-id enum + UI resolution options for Replicate Flux 2 image models.
 *
 * The provider-$ rate table and the cost/credit FORMULAS derived from it live
 * in `backend/src/lib/pricing/flux2-cost.ts` (core, not ee/ — the Replicate
 * provider integration needs them regardless of edition). They were moved
 * out of this package (published Apache-2.0 on npm — an irrevocable grant)
 * per the 2026-07-06 public-flip IP audit, S5.
 */

export type Flux2Model = "flux-2-klein" | "flux-2-pro" | "flux-2-max"

/** Megapixel tiers offered in the UI (strings; the value space for data.resolution). */
export const FLUX2_RES_MP = ["0.5", "1", "2", "4"] as const

export function isFlux2Model(m: string): m is Flux2Model {
  return m === "flux-2-klein" || m === "flux-2-pro" || m === "flux-2-max"
}
