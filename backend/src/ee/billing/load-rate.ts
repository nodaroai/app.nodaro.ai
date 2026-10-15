/**
 * Pay-as-you-go load rate — prices every "load $Y" purchase.
 *
 * ONE function is the source of truth for how many credits a dollar buys:
 * the arbitrary-amount checkout route quotes it, the Stripe webhook
 * re-derives the grant from the settled amount through it (metadata is
 * never trusted for sizing), and the frontend mirrors it for the live
 * preview (sync-pinned by load-rate.test.ts).
 *
 * Shape: the four live credit packs ARE the anchors — piecewise-linear
 * interpolation between them, the $10 rate extended down to the $5
 * minimum, and the $100 rate (360 credits/$) extended flat up to the
 * $1,000 maximum. The ceiling is deliberate and pinned by tests; raising
 * it is a pricing decision, not a refactor.
 */

export interface LoadRateAnchor {
  readonly usd: number
  readonly credits: number
}

/** Ascending anchors — must equal the live TOP_UPS grants (test-pinned). */
export const LOAD_RATE_ANCHORS: readonly LoadRateAnchor[] = [
  { usd: 10, credits: 3300 },
  { usd: 25, credits: 8500 },
  { usd: 50, credits: 17500 },
  { usd: 100, credits: 36000 },
]

export const MIN_LOAD_USD = 5
export const MAX_LOAD_USD = 1000

/** The Stripe currency a load is charged in — the checkout's `price_data.currency`. */
export const LOAD_CURRENCY = "usd"

/** Rate applied beyond the top anchor (= the $100 anchor's rate). */
const CEILING_RATE_PER_USD =
  LOAD_RATE_ANCHORS[LOAD_RATE_ANCHORS.length - 1].credits /
  LOAD_RATE_ANCHORS[LOAD_RATE_ANCHORS.length - 1].usd

/** Rate applied below the bottom anchor (= the $10 anchor's rate). */
const FLOOR_RATE_PER_USD = LOAD_RATE_ANCHORS[0].credits / LOAD_RATE_ANCHORS[0].usd

/**
 * Credits granted for a whole-dollar load amount.
 * Throws on out-of-bounds or non-integer input — callers validate first;
 * this is the last line of defense for the webhook's grant sizing.
 */
export function creditsForLoadUsd(amountUsd: number): number {
  if (!Number.isInteger(amountUsd)) {
    throw new Error(`Load amount must be a whole dollar figure, got ${amountUsd}`)
  }
  if (amountUsd < MIN_LOAD_USD || amountUsd > MAX_LOAD_USD) {
    throw new Error(
      `Load amount out of bounds: $${amountUsd} (allowed $${MIN_LOAD_USD}-$${MAX_LOAD_USD})`
    )
  }

  const first = LOAD_RATE_ANCHORS[0]
  const last = LOAD_RATE_ANCHORS[LOAD_RATE_ANCHORS.length - 1]

  if (amountUsd <= first.usd) {
    return Math.round(amountUsd * FLOOR_RATE_PER_USD)
  }
  if (amountUsd >= last.usd) {
    return Math.round(amountUsd * CEILING_RATE_PER_USD)
  }

  for (let i = 0; i < LOAD_RATE_ANCHORS.length - 1; i++) {
    const a = LOAD_RATE_ANCHORS[i]
    const b = LOAD_RATE_ANCHORS[i + 1]
    if (amountUsd >= a.usd && amountUsd <= b.usd) {
      const t = (amountUsd - a.usd) / (b.usd - a.usd)
      return Math.round(a.credits + t * (b.credits - a.credits))
    }
  }
  // Unreachable by construction (anchors are contiguous) — defensive.
  throw new Error(`No anchor segment for $${amountUsd}`)
}
