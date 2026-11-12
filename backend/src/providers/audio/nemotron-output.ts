/**
 * Nemotron 3.5 Transcribe (KIE `nvidia/nemotron-3-5-transcribe`) result →
 * the transcribe output shape. Pure: no I/O, so the worker and the KIE
 * reconcile (which recovers a stalled task from its saved task id) build the
 * SAME `output_data` from the same two inputs.
 *
 * What KIE returns (probed 2026-11-12, four real tasks):
 *  - `resultJson.resultObject`: `{ text, duration, url, expires_at, usage,
 *    target_language? (a translation), status, bytes, … }` — no language field;
 *    the spoken language is detected but never reported.
 *  - the result FILE at `resultObject.url` (a JSON file, kept ~14 days):
 *    `{ task: "transcribe" | "translate", duration, text }`, and with
 *    `timestamps: true` also `text_with_speakers` ("<spk:0> …"), `words`
 *    (`{ word, start, end, speaker: "0" }`, SECONDS, a speaker label per word)
 *    and `diarization` (speaker turns). Documented, not seen in the probe:
 *    `silent: true` (almost no sound; `text` is "") and `truncated: true` (the
 *    output hit the length limit for the audio, which usually means it repeats).
 */
import type { Caption } from "@remotion/captions"
import type { Transcript } from "@nodaro/shared/edl"
import { buildTranscriptFromOutput } from "./transcript-normalize.js"
import { wordTimestampContractBreak } from "./transcribe-output.js"

/** KIE's `resultJson.resultObject` for this model, as far as it is read. */
export interface NemotronResultObject {
  readonly text?: unknown
  readonly duration?: unknown
  readonly url?: unknown
  readonly target_language?: unknown
  readonly silent?: unknown
  readonly truncated?: unknown
}

/** The result file at `resultObject.url`, as far as it is read. */
export interface NemotronResultFile {
  readonly text?: unknown
  readonly duration?: unknown
  readonly words?: unknown
  readonly silent?: unknown
  readonly truncated?: unknown
}

export interface NemotronTranscribeOutput {
  text: string
  /** The translation's language; "unknown" for a transcription (KIE reports no detected language). */
  language: string
  /** Caption-shaped words (ms), each with its speaker (`speaker_<n>`, Scribe's form). Only with word timings. */
  words?: Array<Caption & { speaker?: string }>
  /** SECONDS. A transcript with no word timings (a plain one, or a translation) is one segment over the whole audio, as Whisper's plain lane hands back segments, so a `json` consumer never gets an empty transcript. */
  segments?: Array<{ start: number; end: number; text: string }>
  json: Transcript
  /** The audio's length as KIE decoded it (seconds) — what KIE bills by. */
  durationSec?: number
  /** KIE says the output hit its length limit for the audio (it usually repeats itself). */
  truncated?: true
}

function finiteSeconds(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : undefined
}

/**
 * Nemotron's words → `{ text, start, end, speaker }` in seconds, with the
 * speaker label in Scribe's form (`"0"` → `speaker_0`), so a diarized transcript
 * reads the same whichever engine made it. A malformed entry is dropped (the
 * transcript normaliser drops a broken time too).
 */
function nemotronWords(raw: unknown): Array<{ text: string; start: number; end: number; speaker?: string }> {
  if (!Array.isArray(raw)) return []
  const out: Array<{ text: string; start: number; end: number; speaker?: string }> = []
  for (const w of raw) {
    if (!w || typeof w !== "object") continue
    const entry = w as Record<string, unknown>
    if (typeof entry.word !== "string" || typeof entry.start !== "number" || typeof entry.end !== "number") continue
    const speaker = entry.speaker === undefined || entry.speaker === null || entry.speaker === "" ? undefined : `speaker_${String(entry.speaker)}`
    out.push({ text: entry.word, start: entry.start, end: entry.end, ...(speaker ? { speaker } : {}) })
  }
  return out
}

/**
 * Scripts written without spaces between words: Chinese and Japanese (KIE
 * returns one "word" per character there) and Thai. Two tokens are joined
 * WITHOUT the leading-space delimiter when either side of the join is in one.
 */
const NO_SPACE_SCRIPT = /[\u0E00-\u0E7F\u3000-\u303F\u3040-\u30FF\u31F0-\u31FF\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF]/u

function joinsWithoutSpace(previous: string, next: string): boolean {
  return NO_SPACE_SCRIPT.test(previous.slice(-1)) || NO_SPACE_SCRIPT.test(next.slice(0, 1))
}

/**
 * Nemotron's words → caption-shaped words (ms), in the @remotion/captions
 * convention every word-timed lane follows: each word after the first carries
 * the leading space the caption overlays join on — except between words of a
 * script written without spaces (Chinese, Japanese, Thai), where a space would
 * render "我 们 今 天" instead of "我们今天".
 */
export function nemotronWordsToCaptions(
  words: ReadonlyArray<{ text: string; start: number; end: number; speaker?: string }>,
): Array<Caption & { speaker?: string }> {
  return words.map((w, i) => {
    const previous = i > 0 ? words[i - 1]!.text : ""
    const spaced = i === 0 || /^\s/.test(w.text) || joinsWithoutSpace(previous, w.text) ? w.text : ` ${w.text}`
    return {
      text: spaced,
      startMs: Math.round(w.start * 1000),
      endMs: Math.round(w.end * 1000),
      timestampMs: null,
      confidence: null,
      ...(w.speaker ? { speaker: w.speaker } : {}),
    }
  })
}

/**
 * Map one task's result. `wordTimestamps` is what the task was asked
 * (`timestamps: true`); `targetLanguage` a translation's target.
 *
 * The "speech in, word timings out" contract of the other word-capable lanes
 * holds here too: a word-timed task whose transcript has speech but whose file
 * carries no word entries is a provider contract break — it fails (and is
 * refunded) rather than handing back a transcript every caption consumer would
 * read as "this clip has no words". A file that could not be read is the same
 * break when words were asked for; a plain transcript falls back to the
 * `resultObject`'s text.
 */
export function mapNemotronResult(
  resultObject: NemotronResultObject,
  file: NemotronResultFile | undefined,
  opts: {
    readonly wordTimestamps?: boolean
    readonly targetLanguage?: string
    /** The length measured before the run: the segment's end when KIE reports none. */
    readonly measuredSec?: number
  },
): NemotronTranscribeOutput {
  const text = typeof file?.text === "string" ? file.text : typeof resultObject.text === "string" ? resultObject.text : ""
  const words = opts.wordTimestamps ? nemotronWordsToCaptions(nemotronWords(file?.words)) : []
  const silent = file?.silent === true || resultObject.silent === true
  const truncated = file?.truncated === true || resultObject.truncated === true
  if (opts.wordTimestamps && words.length === 0 && text.trim().length > 0 && !silent) {
    throw wordTimestampContractBreak(
      file === undefined ? "the result file with the word timings could not be read" : "the response carried speech but no word entries",
    )
  }
  const target =
    opts.targetLanguage ?? (typeof resultObject.target_language === "string" && resultObject.target_language ? resultObject.target_language : undefined)
  const durationSec = finiteSeconds(file?.duration) ?? finiteSeconds(resultObject.duration)
  // No word timings (a plain transcript, a translation): the text as one
  // segment over the whole audio, so the `json` output carries it.
  const segmentEnd = durationSec ?? finiteSeconds(opts.measuredSec) ?? 0
  const segments = words.length === 0 && text.trim().length > 0 ? [{ start: 0, end: segmentEnd, text }] : undefined
  return {
    text,
    language: target ?? "unknown",
    ...(words.length ? { words } : {}),
    ...(segments ? { segments } : {}),
    json: buildTranscriptFromOutput({ ...(target ? { language: target } : {}), words, ...(segments ? { segments } : {}) }),
    ...(durationSec !== undefined ? { durationSec } : {}),
    ...(truncated ? { truncated: true as const } : {}),
  }
}

/** KIE's price for this model: $0.0015 per minute of the decoded audio (0.3 KIE credits), billed by the second. */
export const NEMOTRON_USD_PER_MINUTE = 0.0015

/** The KIE credits this model bills per minute of decoded audio (billed by the second). */
export const NEMOTRON_KIE_CREDITS_PER_MINUTE = 0.3

/**
 * The seconds of audio KIE billed, derived from its `creditsConsumed` (0.3 a
 * minute, billed by the second) — the length to charge on when KIE's result
 * carries no `duration`. Undefined when KIE reported no credits.
 */
export function nemotronSecondsFromKieCredits(kieCredits: number | undefined): number | undefined {
  if (typeof kieCredits !== "number" || !Number.isFinite(kieCredits) || kieCredits <= 0) return undefined
  return (kieCredits / NEMOTRON_KIE_CREDITS_PER_MINUTE) * 60
}

/** What a task cost us in USD, from the audio's length (seconds) — the fallback when KIE's own figure is missing. */
export function nemotronProviderCostUsd(durationSec: number): number {
  return Math.round(((durationSec / 60) * NEMOTRON_USD_PER_MINUTE) * 1e6) / 1e6
}
