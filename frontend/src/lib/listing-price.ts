/**
 * A listing's price in two parts (decided 2026-10-07): fixed credits, plus
 * credits per minute of the recording the app, component or template is given
 * when its price follows that recording's length (an Apply EDL render of a
 * whole episode, an Edit Plan's planning pass). A listing shows both
 * (`<CreditCost perMinute>`); 0 per minute shows exactly as before.
 */
import { EDIT_PLAN_MAX_MINUTES } from "@nodaro/shared"

/** The longest recording a per-minute listing is priced for: an Edit Plan's 180-minute cap. */
export const LISTING_MAX_MINUTES = EDIT_PLAN_MAX_MINUTES

/**
 * The most one run of a listing can cost: the fixed part plus the per-minute
 * part at the longest recording. What a figure that must never under-quote
 * reads when no recording is known yet — a component's price inside a run
 * estimate, the app runner's fallback before its live estimate — the same
 * figure the listing stored before it was split.
 */
export function listingCeilingCredits(fixed: number | null | undefined, perMinute: number | null | undefined): number {
  return (fixed ?? 0) + Math.max(0, perMinute ?? 0) * LISTING_MAX_MINUTES
}
