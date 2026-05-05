import type { Caption } from "@remotion/captions"

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
