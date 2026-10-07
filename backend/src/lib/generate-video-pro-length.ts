/**
 * How long a Generate Video Pro run delivers, from its configured duration —
 * the one place the run's reservation and the listing read the same rule.
 *
 * `computeGenerateVideoProCreditOverride` (node-executor.ts) prices the run at
 * `duration ?? DEFAULT`, and `computeGenerateVideoProPricing`
 * (ee/billing/generate-video-pro-credits.ts) clamps that onto
 * [the model's shortest segment, `generateVideoProCapSec()`]. A request past
 * the model's longest segment is stitched from several; the plan's raw length
 * is `ceil(D + loss × (joins))` less the `loss` each join eats, so a stitched
 * clip is at most one second longer than the clamp, and a single segment on a
 * sparse menu (VEO's 4/6/8) is the next length the model offers.
 */
import { hasContiguousSegmentDurations, maxSegmentSecFor, minSegmentSecFor, segmentDurationsFor } from "@nodaro/shared"

/** The duration a run with none configured is priced at (node-executor.ts). */
export const GENERATE_VIDEO_PRO_DEFAULT_DURATION_SEC = 8

/** The most seconds one run may ask for (env, default 120 s: the node's own cap). */
export function generateVideoProCapSec(): number {
  return Number(process.env.GENERATE_VIDEO_PRO_MAX_DURATION || 120)
}

/** The requested duration as the run's pricing clamps it, for a provider with a segment menu. */
export function generateVideoProClampedSec(provider: string, duration: number | undefined): number {
  const requested = typeof duration === "number" && Number.isFinite(duration) ? duration : GENERATE_VIDEO_PRO_DEFAULT_DURATION_SEC
  return Math.min(Math.max(Math.round(requested), minSegmentSecFor(provider)), generateVideoProCapSec())
}

/**
 * The longest clip a Generate Video Pro run delivers for this duration: the
 * clamp, rounded up to the model's next offered length when one segment on a
 * sparse menu, and one second over it when stitched. A provider with no
 * segment menu is bounded by the node's cap.
 */
export function generateVideoProLengthSec(provider: string, duration: number | undefined): number {
  const menu = segmentDurationsFor(provider)
  if (menu.length === 0) return generateVideoProCapSec()
  const clamped = generateVideoProClampedSec(provider, duration)
  if (clamped > maxSegmentSecFor(provider)) return clamped + 1
  if (hasContiguousSegmentDurations(provider)) return clamped
  return menu.find((d) => d >= clamped) ?? clamped
}
