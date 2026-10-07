/**
 * Times as the review inspector writes them (§2.3 of the inspectors design):
 *  - a POSITION reads like a player: m:ss, floored, h:mm:ss past an hour
 *    (`formatTimecode`);
 *  - a LENGTH under a minute is seconds to one decimal ("1.6 s"); from a
 *    minute on, it is a clock like a position.
 * The words around a number ("s") are the dictionary's (`edlReview.lengthSeconds`),
 * and the number is formatted in the interface language by the caller.
 */
import { formatTimecode } from "@/lib/video-link"

/** A master- or output-clock position, in ms, as m:ss or h:mm:ss. */
export function positionOf(ms: number): string {
  return formatTimecode(Math.max(0, ms) / 1000)
}

export type LengthParts = { readonly seconds: number } | { readonly clock: string }

/** A length, in ms: seconds (one decimal) under a minute, else a clock. */
export function lengthParts(ms: number): LengthParts {
  const seconds = Math.round(Math.max(0, ms) / 100) / 10
  return seconds < 60 ? { seconds } : { clock: formatTimecode(seconds) }
}
