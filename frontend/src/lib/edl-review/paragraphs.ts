/**
 * The transcript as timestamped speaker paragraphs: the rows the review
 * inspector lists (decided 2026-10-04, with the inspector's mockups).
 *
 * THE RULE. A new paragraph starts:
 *  - at each of the transcript's own segments, when it has segments;
 *  - else at each change of speaker, when its words carry speakers;
 *  - else after a pause of PARAGRAPH_GAP_MS (2 s) or more between words.
 * A paragraph holds at most PARAGRAPH_MAX_WORDS (~60) words: a longer one
 * breaks after its last sentence end that leaves at least PARAGRAPH_MIN_WORDS,
 * else after exactly 60 words.
 *
 * Paragraphs cover transcript.words in order, as index ranges [first, end).
 * Times are on the transcript's own clock. A transcript without word timings
 * has no paragraphs: its segments are already the rows.
 */
import type { Transcript } from "@nodaro/shared"

export const PARAGRAPH_MAX_WORDS = 60
export const PARAGRAPH_MIN_WORDS = 20
export const PARAGRAPH_GAP_MS = 2000

export interface Paragraph {
  /** The paragraph's words are transcript.words[first..end). */
  readonly first: number
  readonly end: number
  /** The first word's start. */
  readonly startMs: number
  /** The latest end among its words. */
  readonly endMs: number
  readonly speaker?: string
}

type Word = Transcript["words"][number]
type SegmentStart = { readonly startMs: number; readonly speaker?: string }

/** A word that ends a sentence: . ? ! … or their full-width forms, then any closing quotes or brackets. */
const SENTENCE_END = /[.?!…。？！](?:["'”’»)\]）」』]*)$/

const endsSentence = (word: Word): boolean => SENTENCE_END.test(word.text.trim())

/** The index of the last segment starting at or before `t`; -1 before the first. */
function segmentAt(segments: readonly SegmentStart[], t: number): number {
  let lo = 0
  let hi = segments.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (segments[mid].startMs <= t) lo = mid + 1
    else hi = mid
  }
  return lo - 1
}

/** Word indices where a paragraph starts by the rule above, before the cap. */
function turnStarts(words: readonly Word[], segments: readonly SegmentStart[]): number[] {
  const starts = [0]
  if (segments.length > 0) {
    for (let i = 1; i < words.length; i++) {
      if (segmentAt(segments, words[i].startMs) !== segmentAt(segments, words[i - 1].startMs)) starts.push(i)
    }
  } else if (words.some((w) => w.speaker !== undefined)) {
    for (let i = 1; i < words.length; i++) if (words[i].speaker !== words[i - 1].speaker) starts.push(i)
  } else {
    let latestEnd = words[0].endMs
    for (let i = 1; i < words.length; i++) {
      if (words[i].startMs - latestEnd >= PARAGRAPH_GAP_MS) starts.push(i)
      latestEnd = Math.max(latestEnd, words[i].endMs)
    }
  }
  return starts
}

/** [first, end) split into runs of at most PARAGRAPH_MAX_WORDS words. */
function capped(words: readonly Word[], first: number, end: number): Array<readonly [number, number]> {
  const runs: Array<readonly [number, number]> = []
  let from = first
  while (end - from > PARAGRAPH_MAX_WORDS) {
    let cut = from + PARAGRAPH_MAX_WORDS
    for (let i = cut - 1; i >= from + PARAGRAPH_MIN_WORDS - 1; i--) {
      if (endsSentence(words[i])) {
        cut = i + 1
        break
      }
    }
    runs.push([from, cut])
    from = cut
  }
  runs.push([from, end])
  return runs
}

export function buildParagraphs(transcript: Transcript): Paragraph[] {
  const words = transcript.words
  if (words.length === 0) return []
  const segments = [...(transcript.segments ?? [])].sort((a, b) => a.startMs - b.startMs)
  const starts = turnStarts(words, segments)
  const paragraphs: Paragraph[] = []
  starts.forEach((turnFirst, t) => {
    const turnEnd = t + 1 < starts.length ? starts[t + 1] : words.length
    for (const [first, end] of capped(words, turnFirst, turnEnd)) {
      let endMs = words[first].endMs
      for (let i = first + 1; i < end; i++) endMs = Math.max(endMs, words[i].endMs)
      const speaker = segments[segmentAt(segments, words[first].startMs)]?.speaker ?? words[first].speaker
      paragraphs.push({ first, end, startMs: words[first].startMs, endMs, ...(speaker !== undefined ? { speaker } : {}) })
    }
  })
  return paragraphs
}
