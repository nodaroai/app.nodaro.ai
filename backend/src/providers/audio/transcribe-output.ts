/**
 * Pure Replicate-output → `jobs.output_data` mappers for the transcribe lane.
 *
 * Extracted from `transcribe.ts` so the reconcile cron can rebuild the exact
 * shape the worker handler writes (`workers/handlers/audio-ai.ts:279`) from a
 * prediction it re-fetched. Without this, a stalled whisper job hit
 * `reconcile/replicate.ts`'s URL extraction, found none in
 * `{transcription, segments}` / `{text, chunks}`, and was force-failed +
 * refunded even though the provider had produced (and billed) the transcript.
 *
 * No I/O, no imports from the provider client — these must stay pure so both
 * the live path and the recovery path can call them.
 *
 * Input shapes below mirror the ORIGINAL `transcribe.ts` local interfaces
 * (verified against `captions-mappers.ts`'s `WhisperSegment`/`FastWhisperOutput`
 * and the live audio-wrappers.test.ts fixtures, not the shape guessed in the
 * task brief): openai/whisper segments carry a mandatory `id`. Omitting it
 * here would fail to typecheck against `whisperWordsToCaptions`'s own local
 * (unexported) `WhisperSegment`, which requires it.
 */
import type { Caption } from "@remotion/captions"
import type { Transcript } from "@nodaro/shared/edl"
import { whisperWordsToCaptions, fastWhisperWordsToCaptions } from "./captions-mappers.js"
import { buildTranscriptFromOutput } from "./transcript-normalize.js"

export interface WhisperOutput {
  transcription?: string
  detected_language?: string
  segments?: Array<{
    id: number
    start: number
    end: number
    text: string
    words?: Array<{ word: string; start: number; end: number; probability?: number }>
  }>
}

export interface FastWhisperOutput {
  text?: string
  chunks?: Array<{ timestamp: [number, number]; text: string }>
}

export interface TranscribeOutputShape {
  text: string
  language: string
  segments?: Array<{ start: number; end: number; text: string }>
  words?: Array<Caption & { speaker?: string }>
  /** Normalized `Transcript` — the node's `json` output handle. Always set (the
   *  worker reads it verbatim), so it is rebuilt on the reconcile path too. */
  json?: Transcript
}

/**
 * Deliberately NON-throwing on an empty word list: openai/whisper has no
 * word-timestamps capability at all, so `transcribe()` rejects the request
 * before this lane can run with `wordTimestamps: true`. The only caller that
 * still reaches it that way is the reconcile cron rebuilding a pre-existing
 * stalled row — which must recover the transcript it already paid for, not
 * fail on a flag the lane never honoured.
 */
export function mapWhisperOutput(
  output: WhisperOutput,
  opts: { wordTimestamps?: boolean },
): TranscribeOutputShape {
  const segments = output.segments?.map((seg) => ({ start: seg.start, end: seg.end, text: seg.text }))
  const result: TranscribeOutputShape = {
    text: output.transcription ?? "",
    language: output.detected_language ?? "unknown",
    ...(segments ? { segments } : {}),
  }
  if (opts.wordTimestamps) {
    const words = whisperWordsToCaptions(output)
    if (words.length) result.words = words
  }
  result.json = buildTranscriptFromOutput(result)
  return result
}

/**
 * The ONE failure a word-timestamps request can end in: the lane said it does
 * word timings and then did not. Shared by every live lane that enforces the
 * contract (`incredibly-fast-whisper` here, direct Scribe in `transcribe.ts`) so
 * the job fails — and refunds — with one recognisable message instead of
 * handing back a transcript whose `words` cannot do what the caller asked for.
 */
export function wordTimestampContractBreak(reason: string): Error {
  return new Error(
    `Transcription provider returned no word timestamps for audio that has speech — ` +
      `word timings were requested but not delivered (${reason}).`,
  )
}

/**
 * Is this caption a single WORD? The break we actually have to catch is not an
 * empty list — it is the model answering `timestamp: "word"` with SENTENCE
 * chunks (`[" Hello there.", " How are you today?"]`), which arrives as a
 * perfectly healthy-looking 2-entry word list and then renders as two captions
 * that sit on screen for seconds each. Internal whitespace after trimming is
 * the tell: the mappers keep the provider's leading-space delimiter, so a real
 * word never has any.
 */
function isWordGranular(text: string): boolean {
  return !/\s/.test(text.trim())
}

/**
 * `opts.enforceWordTimestamps` turns a word-timestamps request into a CONTRACT:
 * a lane that says it returns word timings must return them for audio that has
 * speech, or the job fails (and refunds) instead of quietly returning `words: []`.
 * It is opt-IN because the reconcile cron calls these mappers directly to rebuild
 * a stalled job's output, and an uncaught throw there is only counted by the cron's
 * error tally — the row would never be failed, refunded or attempt-bumped, and
 * would retry identically forever (the audit-Blocker-B1 shape documented in
 * `lib/reconcile/replicate.ts`). The live lane (`transcribe()`) passes it; the
 * recovery lane keeps today's non-throwing behaviour.
 */
export function mapFastWhisperOutput(
  output: FastWhisperOutput,
  opts: { language?: string; wordTimestamps?: boolean; enforceWordTimestamps?: boolean },
): TranscribeOutputShape {
  const segments = output.chunks?.map((chunk) => ({
    start: chunk.timestamp[0],
    end: chunk.timestamp[1],
    text: chunk.text,
  }))
  const result: TranscribeOutputShape = {
    text: output.text ?? "",
    language: opts.language && opts.language !== "auto" ? opts.language : "auto",
    ...(segments ? { segments } : {}),
  }
  if (opts.wordTimestamps) {
    const words = fastWhisperWordsToCaptions(output)
    if (words.length) result.words = words
    if (opts.enforceWordTimestamps) {
      // Two ways `timestamp: "word"` goes unhonoured, and the SECOND is the one
      // that actually happens:
      //  1. nothing timed came back at all while the model still produced text.
      //     (`words.length === 0` ⟺ no chunks — the mapper is 1:1 over
      //     `output.chunks` — so a separate "but there were chunks" condition
      //     here was unreachable and has been removed.)
      //  2. chunks came back at SENTENCE granularity. The list looks healthy
      //     (2 "words" for a whole paragraph) and every downstream consumer
      //     treats each entry as one spoken word, so the render is wrong in a
      //     way nothing else can detect. One non-word-granular entry is enough:
      //     the mapper never splits, so the provider chose the granularity for
      //     the whole response.
      // Genuinely empty audio (no chunks AND no text) is not a break: it has
      // nothing to time, and still succeeds with no words.
      if (words.length === 0) {
        if (result.text.trim().length > 0) {
          throw wordTimestampContractBreak("the response carried text but no timed entries")
        }
      } else if (!words.every((w) => isWordGranular(w.text))) {
        throw wordTimestampContractBreak(
          "the timed entries are sentence/phrase-level, not per-word",
        )
      }
    }
  }
  result.json = buildTranscriptFromOutput(result)
  return result
}
