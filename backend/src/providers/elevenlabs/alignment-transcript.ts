/**
 * ElevenLabs `/with-timestamps` alignment → the `@nodaro/shared` `Transcript`
 * (the transcribe node's json shape, so captions, Extract Field and every
 * other json consumer read a dialogue's timings exactly as a transcription's).
 *
 * Pure — no I/O. Defensive by design: the response shape is the vendor's and
 * several details are unverified (see the Phase 6 S3 plan), so anything that
 * does not fit yields `undefined` and the caller delivers the audio without
 * timings. A paid render is never failed over its timestamps.
 */
import { normalizeTranscript, type Transcript } from "@nodaro/shared"

export interface ElevenLabsAlignment {
  characters: string[]
  character_start_times_seconds: number[]
  character_end_times_seconds: number[]
}

export interface ElevenLabsVoiceSegment {
  voice_id?: string
  start_time_seconds: number
  end_time_seconds: number
  /** Indices into `alignment.characters` (end exclusive). */
  character_start_index: number
  character_end_index: number
  /** Which `inputs[]` line the segment voices — the ONLY key lines are matched by (the voice_id is not the id sent). */
  dialogue_input_index: number
}

export interface AlignedWord {
  text: string
  startMs: number
  endMs: number
  /** Span in `alignment.characters` (end exclusive), for matching a word to its voice segment. */
  charStart: number
  charEnd: number
}

const isNumberArray = (v: unknown): v is number[] => Array.isArray(v) && v.every((n) => typeof n === "number" && Number.isFinite(n))
const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every((s) => typeof s === "string")

function readAlignment(raw: unknown): ElevenLabsAlignment | undefined {
  if (!raw || typeof raw !== "object") return undefined
  const a = raw as Record<string, unknown>
  if (!isStringArray(a.characters) || !isNumberArray(a.character_start_times_seconds) || !isNumberArray(a.character_end_times_seconds)) return undefined
  const n = a.characters.length
  if (a.character_start_times_seconds.length !== n || a.character_end_times_seconds.length !== n) return undefined
  return a as unknown as ElevenLabsAlignment
}

/** Inline `[audio tags]` — never a caption word, whether or not the vendor times them. */
const AUDIO_TAG = /\[[^\]]*\]/g

/** A tag longer than this is not a tag: a stray `[` must not swallow the script after it. */
const AUDIO_TAG_MAX_CHARS = 64

/** The index of the `]` closing a tag that opens at `open`, or -1 when there is no tag there. */
function audioTagEnd(characters: string[], open: number): number {
  if (characters[open] !== "[") return -1
  const last = Math.min(characters.length - 1, open + AUDIO_TAG_MAX_CHARS)
  for (let j = open + 1; j <= last; j++) if (characters[j] === "]") return j
  return -1
}

/**
 * Group characters into words on whitespace (the forced-alignment fallback's
 * rule in `forced-alignment.ts`). A word's start is its first character's
 * start, its end the last character's end. A bracketed tag is skipped at the
 * CHARACTER level — a tag may hold spaces (`[clears throat]`), so it cannot be
 * stripped from a whitespace-delimited token afterwards — and is neither part
 * of a word nor a boundary inside one (`a[laughs]b` is one word, `ab`).
 */
export function wordsFromAlignment(raw: unknown): AlignedWord[] | undefined {
  const alignment = readAlignment(raw)
  if (!alignment) return undefined
  const { characters, character_start_times_seconds: starts, character_end_times_seconds: ends } = alignment
  const words: AlignedWord[] = []
  let current = ""
  let charStart = -1
  let lastChar = -1
  const flush = () => {
    const text = current.replace(AUDIO_TAG, "").trim()
    if (text) words.push({ text, startMs: Math.round(starts[charStart]! * 1000), endMs: Math.round(ends[lastChar]! * 1000), charStart, charEnd: lastChar + 1 })
    current = ""
    charStart = -1
    lastChar = -1
  }
  for (let i = 0; i < characters.length; i++) {
    const c = characters[i]!
    const tagEnd = audioTagEnd(characters, i)
    if (tagEnd !== -1) {
      i = tagEnd
      continue
    }
    if (/\s/.test(c)) {
      if (current) flush()
      continue
    }
    if (charStart === -1) charStart = i
    lastChar = i
    current += c
  }
  if (current) flush()
  return words
}

/** One voice (`/v1/text-to-speech/{voice}/with-timestamps`): words only. */
export function transcriptFromSpeechTimestamps(alignment: unknown, opts: { language?: string } = {}): Transcript | undefined {
  const words = wordsFromAlignment(alignment)
  // No words (empty alignment, or only tags) is no timings — never a transcript
  // that a caption node would reject up front instead of transcribing.
  if (!words?.length) return undefined
  return normalizeTranscript({
    version: 1,
    ...(opts.language ? { language: opts.language } : {}),
    words: words.map(({ text, startMs, endMs }) => ({ text, startMs, endMs })),
  })
}

function readSegments(raw: unknown): ElevenLabsVoiceSegment[] {
  if (!Array.isArray(raw)) return []
  return raw.filter((s): s is ElevenLabsVoiceSegment => {
    if (!s || typeof s !== "object") return false
    const o = s as Record<string, unknown>
    return [o.start_time_seconds, o.end_time_seconds, o.character_start_index, o.character_end_index, o.dialogue_input_index]
      .every((n) => typeof n === "number" && Number.isFinite(n))
  })
}

/**
 * A dialogue (`/v1/text-to-dialogue/with-timestamps`): the words, plus one
 * segment per line from `voice_segments`, matched to `lines` by
 * `dialogue_input_index` and labelled with that line's `voice` as the caller
 * sent it. A word's speaker is the segment covering its first character.
 */
export function transcriptFromDialogueTimestamps(
  alignment: unknown,
  voiceSegments: unknown,
  lines: ReadonlyArray<{ text: string; voice: string }>,
  opts: { language?: string } = {},
): Transcript | undefined {
  const words = wordsFromAlignment(alignment)
  if (!words?.length) return undefined
  const segments = readSegments(voiceSegments)
    .filter((s) => Number.isInteger(s.dialogue_input_index) && s.dialogue_input_index >= 0 && s.dialogue_input_index < lines.length)
    .sort((a, b) => a.dialogue_input_index - b.dialogue_input_index)
  const speakerOf = (charIndex: number): string | undefined => {
    const seg = segments.find((s) => charIndex >= s.character_start_index && charIndex < s.character_end_index)
    return seg ? lines[seg.dialogue_input_index]!.voice : undefined
  }
  return normalizeTranscript({
    version: 1,
    ...(opts.language ? { language: opts.language } : {}),
    words: words.map(({ text, startMs, endMs, charStart }) => {
      const speaker = speakerOf(charStart)
      return { text, startMs, endMs, ...(speaker ? { speaker } : {}) }
    }),
    ...(segments.length
      ? {
          segments: segments.map((s) => ({
            startMs: Math.round(s.start_time_seconds * 1000),
            endMs: Math.round(s.end_time_seconds * 1000),
            text: lines[s.dialogue_input_index]!.text,
            speaker: lines[s.dialogue_input_index]!.voice,
          })),
        }
      : {}),
  })
}
