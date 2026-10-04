/**
 * The review state: K, the set of kept master-clock intervals.
 *
 * A review holds K and nothing else (decided 2026-10-04). Everything the
 * reviewer sees derives from K and the plan (Edit Plan's EDL): the edited EDL
 * (`buildEdited`), each word's state (`buildWordIndex`), and what was restored
 * (`restoredOf`). "Restored" is the plan's dropped time that K keeps again —
 * the plan's `dropped` minus what the edit still drops. It is derived, never
 * stored, so no flag can fall out of step with the plan it describes.
 *
 * K holds no history: a span restored and then cut again is simply cut, and
 * shows the plan's reason again. Every operation returns a new canonical set
 * (intervals.ts) and is idempotent — applying it twice is applying it once.
 */
import type { Edl, EdlDropped } from "@nodaro/shared"
import {
  spanIntersect,
  subtractIntervals,
  toIntervalSet,
  unionIntervals,
  type Interval,
  type IntervalSet,
} from "./intervals"

/** The kept intervals, on the master clock, in canonical form. */
export type KeptSet = IntervalSet

/** The reason an edit gives the plan's kept time that a reviewer cuts. */
export const MANUAL_REASON = "manual"

/** A stretch of the transcript's own clock: a word, or a transcript segment. */
export interface TimedUnit {
  readonly startMs: number
  readonly endMs: number
}

/** K of an EDL: the union of its segments. The plan's K starts a review; a
 *  saved edit's K reopens one. A segment with no length keeps nothing. */
export function keptSetOf(edl: Edl): KeptSet {
  return toIntervalSet(edl.segments)
}

/** Keep a dropped span's time again: one of the plan's dropped spans, or a
 *  piece of the edit's. Everything inside it comes back, including a shorter
 *  span of another reason nested in it (a filler inside a tangent). */
export function restoreSpan(kept: KeptSet, span: Interval): KeptSet {
  return unionIntervals(kept, toIntervalSet([span]))
}

/** Keep every span dropped for `reason`. For the plan's reasons these are its
 *  spans of that reason; for "manual" they are the reviewer's own cuts (the
 *  plan's kept time K no longer keeps), so restoring the reason undoes them.
 *  A reason nothing was dropped for changes nothing. */
export function restoreReason(kept: KeptSet, base: Edl, reason: string): KeptSet {
  const spans: Interval[] = (base.dropped ?? []).filter((d) => d.reason === reason)
  if (reason === MANUAL_REASON) spans.push(...keptSetOf(base))
  return spans.length === 0 ? kept : unionIntervals(kept, toIntervalSet(spans))
}

/**
 * The whole-word cut a range snaps to (decided 2026-10-04: manual cuts are
 * word-boundary cuts). It runs from the start of the first word the range
 * touches to the end of the last, then widens until no word straddles either
 * end, so overlapping words (crosstalk) are never split either. `null` when the
 * range is empty or touches no word: a cut is always whole words.
 *
 * `words` are on the transcript's own clock; `offsetMs` places them on the
 * master clock (master = source + offset). A transcript without word timings
 * passes its segments instead, and cuts are then whole segments. The result
 * depends on the range and the words only, never on K.
 */
export function snapToWords(range: Interval, words: readonly TimedUnit[], offsetMs = 0): Interval | null {
  if (!(range.outMs > range.inMs)) return null
  let inMs = Infinity
  let outMs = -Infinity
  for (const w of words) {
    const s = w.startMs + offsetMs
    const e = Math.max(s, w.endMs + offsetMs)
    const touched = e > s ? s < range.outMs && range.inMs < e : range.inMs <= s && s < range.outMs
    if (!touched) continue
    if (s < inMs) inMs = s
    if (e > outMs) outMs = e
  }
  if (!(outMs > inMs)) return null
  for (let widened = true; widened; ) {
    widened = false
    for (const w of words) {
      const s = w.startMs + offsetMs
      const e = w.endMs + offsetMs
      if (s < inMs && inMs < e) {
        inMs = s
        widened = true
      }
      if (s < outMs && outMs < e) {
        outMs = e
        widened = true
      }
    }
  }
  return { inMs, outMs }
}

/** Cut the whole words `range` touches (see `snapToWords`) out of K. */
export function cutRange(kept: KeptSet, range: Interval, words: readonly TimedUnit[], offsetMs = 0): KeptSet {
  const cut = snapToWords(range, words, offsetMs)
  return cut ? subtractIntervals(kept, [cut]) : kept
}

/** What the plan dropped that K keeps again: for each of the plan's dropped
 *  spans, in its order, the parts K keeps, with the span's reason. Two
 *  overlapping spans (a silence inside a tangent) each report their part. */
export function restoredOf(base: Edl, kept: KeptSet): EdlDropped[] {
  const restored: EdlDropped[] = []
  for (const d of base.dropped ?? []) {
    for (const part of spanIntersect(d, kept)) restored.push({ inMs: part.inMs, outMs: part.outMs, reason: d.reason })
  }
  return restored
}
