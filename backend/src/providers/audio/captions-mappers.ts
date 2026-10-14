import type { Caption } from "@remotion/captions"
import type { Transcript } from "@nodaro/shared/edl"

interface FastWhisperOutput {
  text?: string
  chunks?: Array<{ text: string; timestamp: [number, number] }>
}

interface WhisperWord {
  word: string
  start: number
  end: number
  probability?: number
}

interface WhisperSegment {
  id: number
  start: number
  end: number
  text: string
  words?: WhisperWord[]
}

interface WhisperOutput {
  transcription?: string
  detected_language?: string
  segments?: WhisperSegment[]
}

/** Convert incredibly-fast-whisper output (timestamp: "word") to Caption[]. */
export function fastWhisperWordsToCaptions(out: FastWhisperOutput): Caption[] {
  if (!out.chunks) return []
  return out.chunks.map((c): Caption => ({
    text: c.text,
    startMs: Math.round(c.timestamp[0] * 1000),
    endMs: Math.round(c.timestamp[1] * 1000),
    timestampMs: Math.round(c.timestamp[0] * 1000),
    confidence: null,
  }))
}

/** Convert openai/whisper output (with word_timestamps=true) to Caption[]. */
export function whisperWordsToCaptions(out: WhisperOutput): Caption[] {
  if (!out.segments) return []
  const captions: Caption[] = []
  for (const seg of out.segments) {
    if (!seg.words) continue
    for (const w of seg.words) {
      captions.push({
        text: w.word,
        startMs: Math.round(w.start * 1000),
        endMs: Math.round(w.end * 1000),
        timestampMs: Math.round(w.start * 1000),
        confidence: w.probability ?? null,
      })
    }
  }
  return captions
}

/**
 * Convert direct ElevenLabs Scribe words to Caption[]. Scribe emits bare word
 * tokens (its `spacing` entries are dropped by the client), so every word after
 * the first gets the leading space the @remotion/captions spec uses as the word
 * delimiter — the kinetic overlays and createTikTokStyleCaptions concatenate
 * `text` verbatim, and bare tokens rendered as "Twopeopletalking".
 */
export function scribeWordsToCaptions(
  words: ReadonlyArray<{ text: string; start: number; end: number; speaker?: string }>,
): Array<Caption & { speaker?: string }> {
  return words.map((w, i) => ({
    text: i === 0 || /^\s/.test(w.text) ? w.text : ` ${w.text}`,
    startMs: Math.round(w.start * 1000),
    endMs: Math.round(w.end * 1000),
    timestampMs: null,
    confidence: null,
    ...(w.speaker ? { speaker: w.speaker } : {}),
  }))
}

// Line-grouping thresholds for `transcriptToCaptions({ wordLevel: false })`.
// Exported so the mapper test can pin each break rule to an exact boundary
// (the values are deliberately the ONLY source — the mapper reads these, never
// inline literals).
/** A grouped line flushes once it reaches this many words. */
export const CAPTION_LINE_MAX_WORDS = 8
/** A silence longer than this (ms) between two words starts a new line. */
export const CAPTION_LINE_GAP_MS = 700
/** A word whose text ends a sentence closes its line (optional trailing quote/bracket). */
const CAPTION_SENTENCE_END = /[.!?]["'”’)\]]?\s*$/

/**
 * Map a normalized `Transcript`'s words onto the Caption[] the burn-in expects.
 * The transcript is the SAME shape `transcribe` / `apply-edl`'s json handle
 * emit, so timings are already remapped through any upstream cut (D17): this
 * mapper only reshapes, it never re-times.
 *
 *  - `wordLevel: true` (default) → one Caption per word, for the kinetic
 *    per-word styles (karaoke / word-highlight / tiktok-words). Word timings
 *    pass through 1:1 (rounded to integer ms).
 *  - `wordLevel: false` → consecutive words grouped into lines. A line closes on
 *    a speaker change, a sentence-ending word, a gap > CAPTION_LINE_GAP_MS, or
 *    CAPTION_LINE_MAX_WORDS words — whichever comes first. Each line spans its
 *    first word's start to its last word's end.
 *
 * Spacing follows the @remotion/captions spec (a leading space is the token
 * delimiter): the first token/line carries no leading space, every later one
 * does, so the overlays and `createTikTokStyleCaptions` concatenate `text`
 * verbatim without gluing words together (the scribe-mapper rule).
 */
export function transcriptToCaptions(
  transcript: Transcript,
  opts?: { wordLevel?: boolean },
): Caption[] {
  const wordLevel = opts?.wordLevel ?? true
  // Sort by start time so grouped-line spans never invert (endMs < startMs) and
  // word-level output stays monotonic, even when an upstream remap (a clips-mode
  // / reordered EDL) emits words in source order. Copy first — `transcript.words`
  // is readonly; JS sort is stable, so equal-startMs words keep their order.
  const words = [...transcript.words].sort((a, b) => a.startMs - b.startMs)
  if (words.length === 0) return []

  const lead = (text: string, isFirst: boolean): string =>
    isFirst || /^\s/.test(text) ? text : ` ${text}`

  if (wordLevel) {
    return words.map((w, i): Caption => ({
      text: lead(w.text, i === 0),
      startMs: Math.round(w.startMs),
      endMs: Math.round(w.endMs),
      timestampMs: Math.round(w.startMs),
      confidence: w.confidence ?? null,
    }))
  }

  // Grouped lines.
  const lines: Caption[] = []
  let buf: Transcript["words"][number][] = []
  const flush = () => {
    if (buf.length === 0) return
    // Clean each word to a bare token, then join with single spaces so the line
    // reads naturally regardless of the source's own spacing.
    const body = buf.map((w) => w.text.trim()).filter(Boolean).join(" ")
    if (body.length > 0) {
      lines.push({
        text: lead(body, lines.length === 0),
        startMs: Math.round(buf[0].startMs),
        endMs: Math.round(buf[buf.length - 1].endMs),
        timestampMs: Math.round(buf[0].startMs),
        confidence: null,
      })
    }
    buf = []
  }
  for (const w of words) {
    const prev = buf[buf.length - 1]
    const speakerChange = !!prev && (prev.speaker ?? "") !== (w.speaker ?? "")
    const gapBreak = !!prev && w.startMs - prev.endMs > CAPTION_LINE_GAP_MS
    if (speakerChange || gapBreak) flush()
    buf.push(w)
    if (buf.length >= CAPTION_LINE_MAX_WORDS || CAPTION_SENTENCE_END.test(w.text)) flush()
  }
  flush()
  return lines
}

/**
 * PHRASE-level captions from a transcription's `segments` (seconds) — one
 * caption per segment, timed by the segment itself.
 *
 * This is the caption source for a render that does NOT need word timings (a
 * `subtitle`): every lane returns phrase segments, including the ones that
 * cannot return words at all, so `whisper` can caption a subtitle instead of
 * failing the job. The Remotion SubtitleOverlay groups and holds lines itself,
 * so a whole phrase in one caption is exactly what it wants.
 *
 * Sorted by start (an out-of-order lane would otherwise invert a line's span),
 * blank segments dropped, and the @remotion/captions leading-space delimiter
 * applied like every other mapper here.
 */
export function transcribeSegmentsToCaptions(
  segments: ReadonlyArray<{ start: number; end: number; text: string }>,
): Caption[] {
  const usable = segments
    .filter((s) => Number.isFinite(s.start) && Number.isFinite(s.end) && s.text.trim().length > 0)
    .sort((a, b) => a.start - b.start)
  return usable.map((s, i): Caption => {
    const startMs = Math.round(s.start * 1000)
    return {
      text: i === 0 ? s.text.trim() : ` ${s.text.trim()}`,
      startMs,
      // A lane that reports an end before its start would draw a line that is
      // never on screen; clamp to the start so the overlay still shows it.
      endMs: Math.max(startMs, Math.round(s.end * 1000)),
      timestampMs: startMs,
      confidence: null,
    }
  })
}

/** Fallback: split a sentence by whitespace and evenly slice the duration. */
export function syntheticCaptionsFromText(
  text: string,
  range: { startMs: number; endMs: number },
): Caption[] {
  const tokens = splitWithLeadingSpace(text)
  if (tokens.length === 0) return []
  const total = range.endMs - range.startMs
  const slice = total / tokens.length
  return tokens.map((t, i): Caption => ({
    text: t,
    startMs: Math.round(range.startMs + i * slice),
    endMs: Math.round(range.startMs + (i + 1) * slice),
    timestampMs: Math.round(range.startMs + i * slice),
    confidence: null,
  }))
}

/** Split "one two three" into ["one", " two", " three"] (per @remotion/captions spec: spaces are delimiters in the text field). */
function splitWithLeadingSpace(text: string): string[] {
  const words = text.split(/\s+/).filter(Boolean)
  return words.map((w, i) => (i === 0 ? w : ` ${w}`))
}
