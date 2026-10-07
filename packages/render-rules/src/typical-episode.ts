/**
 * The recording length the template gallery's "cheapest first" sort prices a
 * listing at (decided 2026-10-07): a typical episode. A listing whose price
 * follows the recording is fixed credits plus credits per minute; the sort
 * orders by the fixed part plus this many minutes of the per-minute part, so
 * "82 + 14/min" sorts as 922, not as 82. The gallery's tooltip states it, and
 * `workflow_templates.typical_episode_credits` (migration 483) is generated
 * from the same number (a guard test reads the migration).
 */
export const TYPICAL_EPISODE_MINUTES = 60

/** A listing's price for a typical episode: fixed + TYPICAL_EPISODE_MINUTES x per minute. */
export function typicalEpisodeCredits(fixed: number, perMinute: number): number {
  return fixed + TYPICAL_EPISODE_MINUTES * perMinute
}
