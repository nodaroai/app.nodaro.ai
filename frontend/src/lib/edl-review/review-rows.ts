/**
 * The rows the review inspector's transcript lists (R11, decided 2026-10-06):
 * the transcript's paragraphs, each with the gap chips that sit in it, and
 * long cuts collapsed into one row.
 *
 * COLLAPSING. A run of consecutive paragraphs whose words are ALL cut
 * collapses into one row when either:
 *  - it is COLLAPSE_MIN_PARAGRAPHS (2) or more paragraphs; or
 *  - its cut span runs COLLAPSE_MIN_CUT_MS (60 s) or more.
 * The run's span reaches from the end of the kept time before its first word
 * to the start of the kept time after its last word, so a long silence around
 * a cut paragraph counts. The row names the run's cut time, its word count and
 * the dominant reason by duration ("[Tangent · 2:14 · 312 words ▸ ↺]"). It
 * expands in place: a run whose id is in `expanded` lists its paragraphs again,
 * each marked with the run's id (find and follow playback expand the run that
 * hides a word: `collapsedRunOfWord`).
 *
 * GAPS (dropped spans that hold no whole word) sit in the row of the word they
 * come before; one after the last word sits in the last row.
 *
 * Times: `inMs` / `outMs` are on the master clock (transcript time + offset).
 */
import type { Edl } from "@nodaro/shared"
import { spanIntersect, toIntervalSet, type IntervalSet } from "./intervals"
import type { Paragraph } from "./paragraphs"
import type { WordGap, WordIndex } from "./word-index"

export const COLLAPSE_MIN_PARAGRAPHS = 2
export const COLLAPSE_MIN_CUT_MS = 60_000

export interface ParagraphRow {
  readonly kind: "paragraph"
  readonly key: string
  /** Index in the paragraphs list. */
  readonly paragraph: number
  /** The row's words are transcript.words[first..end). */
  readonly first: number
  readonly end: number
  readonly inMs: number
  readonly outMs: number
  readonly speaker?: string
  readonly gaps: readonly WordGap[]
  /** The collapsed run this paragraph belongs to, when that run is expanded. */
  readonly run?: string
}

export interface CollapsedRow {
  readonly kind: "collapsed"
  readonly key: string
  /** The run's id: stable while its first word stays its first. */
  readonly run: string
  /** The run's paragraphs are paragraphs[fromParagraph..toParagraph). */
  readonly fromParagraph: number
  readonly toParagraph: number
  readonly first: number
  readonly end: number
  /** The run's cut span on the master clock. */
  readonly inMs: number
  readonly outMs: number
  /** The dropped time inside that span. */
  readonly cutMs: number
  readonly words: number
  /** The reason that dropped most of it; absent when no dropped span covers it. */
  readonly reason?: string
  readonly gaps: readonly WordGap[]
}

export type ReviewRow = ParagraphRow | CollapsedRow

export interface ReviewRowsInput {
  readonly paragraphs: readonly Paragraph[]
  readonly wordIndex: WordIndex
  readonly words: readonly { readonly startMs: number; readonly endMs: number }[]
  readonly offsetMs: number
  /** The edit as it stands (`buildEdited`): its kept time and dropped spans. */
  readonly edited: Edl
  /** Ids of collapsed runs the reviewer opened. */
  readonly expanded?: ReadonlySet<string>
}

const runId = (firstWord: number): string => `run-${firstWord}`

/** Index of the last element whose key is ≤ `t`, or 0 when none is. */
function lastAtOrBefore(n: number, key: (i: number) => number, t: number): number {
  let lo = 0
  let hi = n
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (key(mid) <= t) lo = mid + 1
    else hi = mid
  }
  return Math.max(0, lo - 1)
}

/** The cut span around [s, e): from the kept time before it to the kept time after it. */
function cutSpanAround(kept: IntervalSet, s: number, e: number): { inMs: number; outMs: number } {
  // The first kept piece ending after `s`: the ones before it end by `s`.
  let lo = 0
  let hi = kept.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (kept[mid]!.outMs <= s) lo = mid + 1
    else hi = mid
  }
  const inMs = lo > 0 ? Math.min(kept[lo - 1]!.outMs, s) : s
  let next = lo
  while (next < kept.length && kept[next]!.inMs < e) next++
  const outMs = next < kept.length ? Math.max(kept[next]!.inMs, e) : e
  return { inMs, outMs }
}

/** The dropped time in [inMs, outMs), and the reason with the most of it. */
function cutOf(edited: Edl, inMs: number, outMs: number): { cutMs: number; reason?: string } {
  const span = { inMs, outMs }
  const byReason = new Map<string, number>()
  const inside = []
  for (const d of edited.dropped ?? []) {
    const parts = spanIntersect(span, toIntervalSet([d]))
    if (parts.length === 0) continue
    inside.push(...parts)
    byReason.set(d.reason, (byReason.get(d.reason) ?? 0) + parts.reduce((ms, p) => ms + (p.outMs - p.inMs), 0))
  }
  let reason: string | undefined
  let most = 0
  for (const [r, ms] of byReason) {
    if (ms > most) {
      most = ms
      reason = r
    }
  }
  const cutMs = toIntervalSet(inside).reduce((ms, p) => ms + (p.outMs - p.inMs), 0)
  return reason === undefined ? { cutMs } : { cutMs, reason }
}

export function buildReviewRows(input: ReviewRowsInput): ReviewRow[] {
  const { paragraphs, wordIndex, words, offsetMs, edited, expanded } = input
  if (paragraphs.length === 0) return []
  const kept = toIntervalSet(edited.segments)
  const gapsOf: WordGap[][] = paragraphs.map(() => [])
  for (const gap of wordIndex.gaps) {
    const p = gap.beforeWord >= words.length ? paragraphs.length - 1 : lastAtOrBefore(paragraphs.length, (i) => paragraphs[i]!.first, gap.beforeWord)
    gapsOf[p]!.push(gap)
  }
  const allCut = (p: Paragraph): boolean => {
    for (let w = p.first; w < p.end; w++) if (wordIndex.marks[w]?.state !== "cut") return false
    return true
  }
  const paragraphRow = (i: number, run?: string): ParagraphRow => {
    const p = paragraphs[i]!
    return {
      kind: "paragraph",
      key: `p-${p.first}`,
      paragraph: i,
      first: p.first,
      end: p.end,
      inMs: p.startMs + offsetMs,
      outMs: p.endMs + offsetMs,
      ...(p.speaker !== undefined ? { speaker: p.speaker } : {}),
      gaps: gapsOf[i]!,
      ...(run ? { run } : {}),
    }
  }

  const rows: ReviewRow[] = []
  for (let i = 0; i < paragraphs.length; ) {
    if (!allCut(paragraphs[i]!)) {
      rows.push(paragraphRow(i++))
      continue
    }
    let j = i + 1
    while (j < paragraphs.length && allCut(paragraphs[j]!)) j++
    const first = paragraphs[i]!.first
    const end = paragraphs[j - 1]!.end
    let lastEnd = -Infinity
    for (let k = i; k < j; k++) lastEnd = Math.max(lastEnd, paragraphs[k]!.endMs)
    const span = cutSpanAround(kept, paragraphs[i]!.startMs + offsetMs, lastEnd + offsetMs)
    const { cutMs, reason } = cutOf(edited, span.inMs, span.outMs)
    const id = runId(first)
    if (j - i < COLLAPSE_MIN_PARAGRAPHS && cutMs < COLLAPSE_MIN_CUT_MS) {
      for (let k = i; k < j; k++) rows.push(paragraphRow(k))
    } else if (expanded?.has(id)) {
      for (let k = i; k < j; k++) rows.push(paragraphRow(k, id))
    } else {
      rows.push({
        kind: "collapsed",
        key: id,
        run: id,
        fromParagraph: i,
        toParagraph: j,
        first,
        end,
        inMs: span.inMs,
        outMs: span.outMs,
        cutMs,
        words: end - first,
        ...(reason !== undefined ? { reason } : {}),
        gaps: gapsOf.slice(i, j).flat(),
      })
    }
    i = j
  }
  return rows
}

/** The row that shows word `word` (a collapsed run's row while it is collapsed). */
export function rowOfWord(rows: readonly ReviewRow[], word: number): number {
  return lastAtOrBefore(rows.length, (i) => rows[i]!.first, word)
}

/** The row playing at master time `ms`: the last row starting at or before it. */
export function rowOfMasterMs(rows: readonly ReviewRow[], ms: number): number {
  return lastAtOrBefore(rows.length, (i) => rows[i]!.inMs, ms)
}

/** The collapsed run hiding word `word`, to expand before scrolling to it. */
export function collapsedRunOfWord(rows: readonly ReviewRow[], word: number): string | undefined {
  const row = rows[rowOfWord(rows, word)]
  return row?.kind === "collapsed" && row.first <= word && word < row.end ? row.run : undefined
}

/** A Cuts-only row (R5 a: no transcript): a kept segment, or a dropped span with its reason. */
export type CutsOnlyRow =
  | { readonly kind: "kept"; readonly inMs: number; readonly outMs: number }
  | { readonly kind: "cut"; readonly inMs: number; readonly outMs: number; readonly reason: string; readonly drop: number }

/** The edit's kept segments and dropped spans, in time order (kept first on a tie). */
export function buildCutsOnlyRows(edited: Edl): CutsOnlyRow[] {
  const rows: CutsOnlyRow[] = [
    ...edited.segments.filter((s) => s.outMs > s.inMs).map((s): CutsOnlyRow => ({ kind: "kept", inMs: s.inMs, outMs: s.outMs })),
    ...(edited.dropped ?? []).map((d, drop): CutsOnlyRow => ({ kind: "cut", inMs: d.inMs, outMs: d.outMs, reason: d.reason, drop })),
  ]
  return rows.sort((a, b) => a.inMs - b.inMs || (a.kind === b.kind ? 0 : a.kind === "kept" ? -1 : 1))
}
