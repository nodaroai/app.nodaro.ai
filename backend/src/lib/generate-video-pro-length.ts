/**
 * How long a Generate Video Pro run delivers, from its configured duration —
 * the one place the run's reservation and the listing read the same rule.
 *
 * `computeGenerateVideoProCreditOverride` (node-executor.ts) prices the run at
 * `duration ?? DEFAULT`, and `computeGenerateVideoProPricing`
 * (ee/billing/generate-video-pro-credits.ts) clamps that onto
 * [the model's shortest segment, `generateVideoProCapSec()`]. The rule itself
 * is `@nodaro/render-rules`' (`generateVideoProLengthSec`, pure, the cap passed
 * in); this module supplies the deployment's cap from its environment.
 */
import {
  GENERATE_VIDEO_PRO_DEFAULT_MAX_DURATION_SEC,
  generateVideoProClampedSec as clampedSecUnder,
  generateVideoProLengthSec as lengthSecUnder,
} from "@nodaro/render-rules"

export { GENERATE_VIDEO_PRO_DEFAULT_DURATION_SEC } from "@nodaro/render-rules"

/** The most seconds one run may ask for (env, default 120 s: the node's own cap). */
export function generateVideoProCapSec(): number {
  return Number(process.env.GENERATE_VIDEO_PRO_MAX_DURATION || GENERATE_VIDEO_PRO_DEFAULT_MAX_DURATION_SEC)
}

/** The requested duration as the run's pricing clamps it, for a provider with a segment menu. */
export function generateVideoProClampedSec(provider: string, duration: number | undefined): number {
  return clampedSecUnder(provider, duration, generateVideoProCapSec())
}

/**
 * The longest clip a Generate Video Pro run delivers for this duration: the
 * clamp, rounded up to the model's next offered length when one segment on a
 * sparse menu, and one second over it when stitched. A provider with no
 * segment menu is bounded by the node's cap.
 */
export function generateVideoProLengthSec(provider: string, duration: number | undefined): number {
  return lengthSecUnder(provider, duration, generateVideoProCapSec())
}
