/**
 * Half-open time intervals [inMs, outMs) on one clock, and sets of them.
 *
 * A set has ONE canonical form: sorted by time, every piece non-empty, and
 * overlapping AND abutting pieces merged. With one form, set equality is plain
 * deep equality, which the review model's round trip relies on (a kept set
 * read back from an edited EDL must equal the set it was built from).
 *
 * Every function returns new arrays and never mutates its inputs.
 */

export interface Interval {
  readonly inMs: number
  readonly outMs: number
}

/** A canonical interval set (see above). Build one with `toIntervalSet`. */
export type IntervalSet = readonly Interval[]

/** The canonical set covering `items` (anything with `inMs`/`outMs`). An empty
 *  or inverted piece covers nothing. Linear when `items` are already in time
 *  order, which segments and dropped lists almost always are. */
export function toIntervalSet(items: Iterable<Interval>): IntervalSet {
  const pieces: Interval[] = []
  let sorted = true
  for (const item of items) {
    if (!(item.outMs > item.inMs)) continue
    if (pieces.length > 0 && item.inMs < pieces[pieces.length - 1].inMs) sorted = false
    pieces.push({ inMs: item.inMs, outMs: item.outMs })
  }
  if (!sorted) pieces.sort((a, b) => a.inMs - b.inMs)
  const merged: Interval[] = []
  for (const piece of pieces) {
    const last = merged[merged.length - 1]
    if (last && piece.inMs <= last.outMs) {
      if (piece.outMs > last.outMs) merged[merged.length - 1] = { inMs: last.inMs, outMs: piece.outMs }
    } else {
      merged.push(piece)
    }
  }
  return merged
}

/** a ∪ b. */
export function unionIntervals(a: IntervalSet, b: IntervalSet): IntervalSet {
  const inOrder: Interval[] = []
  let i = 0
  let j = 0
  while (i < a.length || j < b.length) {
    inOrder.push(j >= b.length || (i < a.length && a[i].inMs <= b[j].inMs) ? a[i++] : b[j++])
  }
  return toIntervalSet(inOrder)
}

/** a ∖ b. */
export function subtractIntervals(a: IntervalSet, b: IntervalSet): IntervalSet {
  const out: Interval[] = []
  for (const piece of a) out.push(...spanMinus(piece, b))
  return out
}

/** a ∩ b. */
export function intersectIntervals(a: IntervalSet, b: IntervalSet): IntervalSet {
  const out: Interval[] = []
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    const inMs = Math.max(a[i].inMs, b[j].inMs)
    const outMs = Math.min(a[i].outMs, b[j].outMs)
    if (inMs < outMs) out.push({ inMs, outMs })
    if (a[i].outMs < b[j].outMs) i++
    else j++
  }
  return out
}

/** Index of the first piece of `set` that ends after `t` (binary search). */
function firstEndingAfter(set: IntervalSet, t: number): number {
  let lo = 0
  let hi = set.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (set[mid].outMs <= t) lo = mid + 1
    else hi = mid
  }
  return lo
}

/** The parts of one span that `set` covers, in time order. O(log n + parts). */
export function spanIntersect(span: Interval, set: IntervalSet): Interval[] {
  const out: Interval[] = []
  if (!(span.outMs > span.inMs)) return out
  for (let i = firstEndingAfter(set, span.inMs); i < set.length && set[i].inMs < span.outMs; i++) {
    out.push({ inMs: Math.max(span.inMs, set[i].inMs), outMs: Math.min(span.outMs, set[i].outMs) })
  }
  return out
}

/** The parts of one span that `set` does not cover, in time order. O(log n + parts). */
export function spanMinus(span: Interval, set: IntervalSet): Interval[] {
  const out: Interval[] = []
  if (!(span.outMs > span.inMs)) return out
  let start = span.inMs
  for (let i = firstEndingAfter(set, span.inMs); i < set.length && set[i].inMs < span.outMs; i++) {
    if (set[i].inMs > start) out.push({ inMs: start, outMs: set[i].inMs })
    start = Math.max(start, set[i].outMs)
  }
  if (start < span.outMs) out.push({ inMs: start, outMs: span.outMs })
  return out
}
