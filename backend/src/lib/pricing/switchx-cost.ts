// Beeble SwitchX provider-cost formula — CORE (not ee/, though today only
// ee/billing/credits.ts references it; kept alongside its sibling provider-
// cost modules in lib/pricing/ for consistency). Beeble's published rate
// (developer.beeble.ai/pricing) is metered per 30-frame block; we reserve a
// block tier and commit it verbatim, so a clip snaps to the exact number of
// blocks Beeble bills (ceil(frames/30)) — no tier over-charge.
//
// AT-COST: this is a straight pass-through of Beeble's published per-block
// rate (zero platform margin baked in here) — the admin panel's global
// cost_markup_percent is applied on top, same as every other provider.
//
// Moved out of `packages/shared` (published Apache-2.0 on npm — an
// irrevocable grant) per the 2026-07-06 public-flip IP audit, S5. The
// non-monetary tier list, tier-picker, and credit-id builder stay in
// `@nodaro/shared` (`switchx-pricing.ts`) — this file holds only the
// $-per-block → credits conversion.
import { SWITCHX_BLOCK_FRAMES, pickSwitchXFrameTier } from "@nodaro/shared"

// At-cost credits per 30-frame block: 720p, 1080p.
const SWITCHX_BLOCK_CREDITS: Record<720 | 1080, number> = { 720: 5, 1080: 15 }

export function switchXHoldCredits(frames: number | undefined, res: 720 | 1080): number {
  // tier is always a 30-frame multiple, so (tier / 30) is the integer block count.
  const blocks = pickSwitchXFrameTier(frames) / SWITCHX_BLOCK_FRAMES
  return blocks * SWITCHX_BLOCK_CREDITS[res]
}
