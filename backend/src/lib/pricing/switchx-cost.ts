// Beeble SwitchX provider-cost formula — CORE (not ee/, though today only
// ee/billing/credits.ts references it; kept alongside its sibling provider-
// cost modules in lib/pricing/ for consistency). Beeble's published rate
// (developer.beeble.ai/pricing) is metered per 30-frame block; we reserve a
// block tier and commit it verbatim, so a clip snaps to the exact number of
// blocks Beeble bills (ceil(frames/30)) — no tier over-charge.
//
// A straight pass-through of Beeble's published per-block rate — the admin panel's global
// cost_markup_percent is applied on top, same as every other provider.
//
// Moved out of `packages/shared` (published Apache-2.0 on npm — an
// irrevocable grant) per the 2026-07-06 public-flip IP audit, S5. The
// non-monetary tier list, tier-picker, and credit-id builder stay in
// `@nodaro/shared` (`switchx-pricing.ts`) — this file holds only the
// $-per-block → credits conversion.
import { SWITCHX_BLOCK_FRAMES, pickSwitchXFrameTier, usdToCredits } from "@nodaro/shared"

/**
 * Beeble's published per-30-frame-block rate in USD.
 *
 * PROVENANCE: derived from the credit values this module shipped with
 * (720p = 5 cr, 1080p = 15 cr at CREDIT_BASE_USD = $0.02), which the header
 * above documents as a straight at-cost pass-through of Beeble's published
 * rate. It is NOT quoted from an invoice or from developer.beeble.ai/pricing.
 * Confirm against the published rate before re-deriving anything from it.
 *
 * Recorded in USD rather than credits so the value survives a change to
 * CREDIT_BASE_USD — the credit figures are now derived, not stored. As stored
 * credits, a re-denomination would have silently mispriced this provider by
 * the full re-denomination factor.
 */
export const SWITCHX_BLOCK_USD: Record<720 | 1080, number> = { 720: 0.10, 1080: 0.30 }

export function switchXHoldCredits(frames: number | undefined, res: 720 | 1080): number {
  // tier is always a 30-frame multiple, so (tier / 30) is the integer block count.
  const blocks = pickSwitchXFrameTier(frames) / SWITCHX_BLOCK_FRAMES
  return usdToCredits(blocks * SWITCHX_BLOCK_USD[res])
}
