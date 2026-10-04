/**
 * The word index: every transcript word marked kept, partial or cut against an
 * EDL, with the reason it was cut — one sweep, O(W + S + D) for words, segments
 * and dropped spans in time order (as transcripts and plans are; anything out
 * of order is sorted first).
 *
 * KEPT OR CUT follows remapTranscriptThroughEdl exactly, so the inspector
 * strikes precisely the words the render drops: a word is kept if any part of
 * it meets a kept segment (a word with no length: if its instant does). "kept"
 * means all of it is kept, "partial" that it straddles a cut, "cut" that none
 * of it is.
 *
 * THE REASON of a cut or partial word is that of the dropped span covering most
 * of it; on a tie the longer span wins, so a filler inside a tangent shows as
 * the tangent, and restoring that span brings the whole word back. A word in
 * time the EDL neither keeps nor drops has no reason.
 *
 * GAPS are the dropped spans that hold no whole word, typically a silence
 * between two words. Each is placed by time, before the first word that starts
 * at or after it, so the transcript can show it inline.
 *
 * Words are on the transcript's clock; the transcript's source offset puts them
 * on the master clock, as the remap does (master = source + offset).
 */
import type { Edl, Transcript } from "@nodaro/shared"
import { toIntervalSet } from "./intervals"

export type WordState = "kept" | "partial" | "cut"

export interface WordMark {
  readonly state: WordState
  /** Why a cut or partial word was cut. Absent when kept, or when no dropped span covers it. */
  readonly reason?: string
  /** The index in `edl.dropped` of that span: the span a restore of this word restores. */
  readonly drop?: number
}

/** A dropped span that holds no whole word, shown before word `beforeWord`
 *  (`transcript.words.length` when it comes after the last word). */
export interface WordGap {
  readonly drop: number
  readonly beforeWord: number
}

export interface WordIndex {
  /** One mark per transcript word, aligned with `transcript.words`. */
  readonly marks: readonly WordMark[]
  /** In time order. */
  readonly gaps: readonly WordGap[]
}

const KEPT: WordMark = Object.freeze({ state: "kept" })

/** The transcript source's offset on the master clock (0 when it names none). */
export function transcriptOffsetMs(edl: Edl, transcript: Transcript): number {
  if (!transcript.sourceId) return 0
  return edl.sources.find((s) => s.id === transcript.sourceId)?.offsetMs ?? 0
}

/** Indices 0..n-1 ordered by `key`, stably; no sort when already in order. */
function timeOrder(n: number, key: (i: number) => number): number[] {
  const order = Array.from({ length: n }, (_, i) => i)
  for (let i = 1; i < n; i++) {
    if (key(i) < key(i - 1)) return order.sort((a, b) => key(a) - key(b) || a - b)
  }
  return order
}

export function buildWordIndex(edl: Edl, transcript: Transcript): WordIndex {
  const off = transcriptOffsetMs(edl, transcript)
  const words = transcript.words
  const kept = toIntervalSet(edl.segments)
  const drops = edl.dropped ?? []
  const wordOrder = timeOrder(words.length, (i) => words[i].startMs)
  const dropOrder = timeOrder(drops.length, (i) => drops[i].inMs)
  const marks: WordMark[] = new Array<WordMark>(words.length)
  const holdsWord = new Uint8Array(drops.length)
  const active: number[] = []
  let kp = 0
  let dp = 0

  for (const wi of wordOrder) {
    const s = words[wi].startMs + off
    const e = words[wi].endMs + off
    // Kept intervals that end by this word's start end before every later word too.
    while (kp < kept.length && kept[kp].outMs <= s) kp++
    const k = kept[kp]
    const point = e === s
    const meetsKept = k !== undefined && (point ? k.inMs <= s : e > s && k.inMs < e)
    const state: WordState = !meetsKept ? "cut" : point || (k.inMs <= s && e <= k.outMs) ? "kept" : "partial"

    // Spans that start before this word ends may cover it; spans that end by its
    // start cover no later word either.
    while (dp < dropOrder.length && (drops[dropOrder[dp]].inMs < e || drops[dropOrder[dp]].inMs <= s)) active.push(dropOrder[dp++])
    let live = 0
    for (const di of active) if (drops[di].outMs > s) active[live++] = di
    active.length = live
    let best = -1
    let bestCover = -1
    let bestLength = -1
    for (const di of active) {
      const d = drops[di]
      const cover = point ? (d.inMs <= s ? 0 : -1) : Math.min(e, d.outMs) - Math.max(s, d.inMs)
      if (cover < 0 || (!point && cover === 0)) continue
      if (d.inMs <= s && e <= d.outMs) holdsWord[di] = 1
      const length = d.outMs - d.inMs
      if (cover > bestCover || (cover === bestCover && (length > bestLength || (length === bestLength && di < best)))) {
        best = di
        bestCover = cover
        bestLength = length
      }
    }

    marks[wi] = state === "kept" ? KEPT : best < 0 ? { state } : { state, reason: drops[best].reason, drop: best }
  }

  const gaps: WordGap[] = []
  let wp = 0
  for (const di of dropOrder) {
    const d = drops[di]
    if (holdsWord[di] || !(d.outMs > d.inMs)) continue
    while (wp < wordOrder.length && words[wordOrder[wp]].startMs + off < d.inMs) wp++
    gaps.push({ drop: di, beforeWord: wp < wordOrder.length ? wordOrder[wp] : words.length })
  }
  return { marks, gaps }
}
