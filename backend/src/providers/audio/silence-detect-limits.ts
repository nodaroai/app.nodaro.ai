/**
 * Silence Detect's limits that its route and its provider both read — a leaf
 * with no imports, so the route never loads the ffmpeg provider to know them.
 */

/** The shortest silence `allRanges` lists: below it a long, noisy episode's
 *  list could outgrow what ffmpeg's captured log holds. */
export const ALL_RANGES_MIN_FLOOR_MS = 20
