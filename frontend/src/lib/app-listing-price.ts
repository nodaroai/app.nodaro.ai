/**
 * A published app's listed price (decided 2026-10-06): the preview part — the
 * whole workflow, each render at Preview — with the creator's fee, plus each
 * Render final — the render at Final and what follows it — without it. It
 * never under-quotes a run, whatever the deployment's flag. `base` is the stored
 * `baseEstimatedCredits` (the part the fee applies to), `final` the server's
 * `finalEstimatedCredits`. Mirrors the server's `appListingPrice`
 * (backend/src/lib/app-listing-price.ts).
 */
import { calculateMonetizedCost } from "@nodaro/shared"

export function listedAppCredits(
  parts: { readonly base: number; readonly final?: number | null },
  monetization: { readonly enabled: boolean; readonly flatFee: number; readonly percent: number },
): number {
  const preview =
    monetization.enabled && parts.base > 0 ? calculateMonetizedCost(parts.base, monetization.flatFee, monetization.percent) : parts.base
  return preview + (parts.final ?? 0)
}
