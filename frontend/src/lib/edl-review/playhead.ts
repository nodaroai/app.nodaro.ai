/**
 * Where the review's player is, on the transcript (follow playback, §2.3 of
 * the inspectors design).
 *
 *  - `masterOfPlayback`: the master instant the player is at. On a take, its
 *    output time through the take's clock map (review-clock.ts) — unknown
 *    (null) when the take has none, because it is stale or sits behind Camera
 *    Switch (R3 a). On the original, the file's time plus its offset.
 *  - `wordAt`: the word whose time holds that instant, by binary search over
 *    the words in time order (`wordClock`, built once per transcript); -1
 *    between words.
 */
import type { Edl } from "@nodaro/shared"
import type { TimedUnit } from "./kept-set"
import { masterOfPreviewTime } from "./review-clock"

export interface WordClock {
  /** Word indices in time order. */
  readonly order: Int32Array
  /** Start and end on the master clock, in `order`. */
  readonly starts: Float64Array
  readonly ends: Float64Array
}

export function wordClock(words: readonly TimedUnit[], offsetMs: number): WordClock {
  const order = Int32Array.from(words.keys())
  let sorted = true
  for (let i = 1; i < words.length && sorted; i++) sorted = words[i]!.startMs >= words[i - 1]!.startMs
  if (!sorted) order.sort((a, b) => words[a]!.startMs - words[b]!.startMs || a - b)
  const starts = new Float64Array(words.length)
  const ends = new Float64Array(words.length)
  order.forEach((w, i) => {
    starts[i] = words[w]!.startMs + offsetMs
    ends[i] = Math.max(starts[i]!, words[w]!.endMs + offsetMs)
  })
  return { order, starts, ends }
}

/** The word playing at master instant `ms`, or -1. */
export function wordAt(clock: WordClock, ms: number | null): number {
  if (ms === null) return -1
  const { starts, ends, order } = clock
  let lo = 0
  let hi = starts.length - 1
  let at = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (starts[mid]! <= ms) {
      at = mid
      lo = mid + 1
    } else hi = mid - 1
  }
  return at >= 0 && ms < ends[at]! ? order[at]! : -1
}

/** What the player plays: a take (with its clock map, or none) or the original. */
export type PlaybackClock =
  | { readonly kind: "take"; readonly map: Edl | null }
  | { readonly kind: "original"; readonly sourceOffsetMs: number }

/** The master instant at the player's time `ms` (its own clock); null when unknown. */
export function masterOfPlayback(clock: PlaybackClock, ms: number): number | null {
  return clock.kind === "original" ? ms + clock.sourceOffsetMs : masterOfPreviewTime(clock.map, ms)
}
