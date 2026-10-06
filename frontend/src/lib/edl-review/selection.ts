/**
 * The transcript selection, by word index (§2.3 of the inspectors design).
 *
 * The transcript is virtualised: once a drag auto-scrolls past the overscan,
 * the row it started in unmounts and a DOM `Selection` loses its anchor node.
 * So the selection is two word indices — the anchor (where the drag or click
 * started) and the focus (where it is now) — and the highlight, the copied
 * text and the cut all derive from them. Words are `transcript.words`, on the
 * transcript's own clock; `offsetMs` puts them on the master clock.
 */
import { spanIntersect, spanMinus, type Interval } from "./intervals"
import { snapToWords, type KeptSet, type TimedUnit } from "./kept-set"
import type { WordMark } from "./word-index"

export interface WordSelection {
  /** The word the selection started on. */
  readonly anchor: number
  /** The word it reaches now (a drag, a shift-click). */
  readonly focus: number
}

/** A selection of one word: a pointerdown on it. */
export function startSelection(word: number): WordSelection {
  return { anchor: word, focus: word }
}

/** Move the focus, keeping the anchor: a drag over another word, a shift-click. */
export function extendSelection(sel: WordSelection, focus: number): WordSelection {
  return { anchor: sel.anchor, focus }
}

/** The selected words, inclusive, in transcript order. */
export function selectedWords(sel: WordSelection): { readonly first: number; readonly last: number } {
  return sel.anchor <= sel.focus ? { first: sel.anchor, last: sel.focus } : { first: sel.focus, last: sel.anchor }
}

export function isWordSelected(sel: WordSelection, word: number): boolean {
  const { first, last } = selectedWords(sel)
  return first <= word && word <= last
}

/** The selected words that exist, as [first, last], or null when none does. */
function clamped(sel: WordSelection, count: number): { first: number; last: number } | null {
  const { first, last } = selectedWords(sel)
  const from = Math.max(0, first)
  const to = Math.min(count - 1, last)
  return from <= to ? { first: from, last: to } : null
}

/** ⌘C: the selected words' text, from the model, joined by single spaces. */
export function selectionText(sel: WordSelection, words: readonly { readonly text: string }[]): string {
  const range = clamped(sel, words.length)
  if (!range) return ""
  return words.slice(range.first, range.last + 1).map((w) => w.text.trim()).filter(Boolean).join(" ")
}

/** The selection on the master clock: its first word's start to the latest end
 *  among its words. `null` when it holds no word. */
export function selectionRange(sel: WordSelection, words: readonly TimedUnit[], offsetMs = 0): Interval | null {
  const range = clamped(sel, words.length)
  if (!range) return null
  let inMs = Infinity
  let outMs = -Infinity
  for (let i = range.first; i <= range.last; i++) {
    inMs = Math.min(inMs, words[i]!.startMs + offsetMs)
    outMs = Math.max(outMs, words[i]!.endMs + offsetMs)
  }
  return outMs > inMs ? { inMs, outMs } : null
}

/** Restore selection shows (R10 a) when the selection touches a struck word:
 *  one cut, or partly cut. */
export function selectionTouchesCut(sel: WordSelection, marks: readonly WordMark[]): boolean {
  const range = clamped(sel, marks.length)
  if (!range) return false
  for (let i = range.first; i <= range.last; i++) if (marks[i]!.state !== "kept") return true
  return false
}

/** The whole-word time the selection acts on (`snapToWords`), or null. */
function snapped(sel: WordSelection, words: readonly TimedUnit[], offsetMs: number): Interval | null {
  const range = selectionRange(sel, words, offsetMs)
  return range ? snapToWords(range, words, offsetMs) : null
}

const total = (pieces: readonly Interval[]): number => pieces.reduce((ms, p) => ms + (p.outMs - p.inMs), 0)

/** The time Cut selection removes: the selection's kept time. */
export function selectionCutMs(sel: WordSelection, words: readonly TimedUnit[], kept: KeptSet, offsetMs = 0): number {
  const span = snapped(sel, words, offsetMs)
  return span ? total(spanIntersect(span, kept)) : 0
}

/** The time Restore selection brings back: the selection's cut time. */
export function selectionRestoreMs(sel: WordSelection, words: readonly TimedUnit[], kept: KeptSet, offsetMs = 0): number {
  const span = snapped(sel, words, offsetMs)
  return span ? total(spanMinus(span, kept)) : 0
}
