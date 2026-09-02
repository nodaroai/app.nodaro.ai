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
import { whisperWordsToCaptions, fastWhisperWordsToCaptions } from "./captions-mappers.js"

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
}

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
  return result
}

export function mapFastWhisperOutput(
  output: FastWhisperOutput,
  opts: { language?: string; wordTimestamps?: boolean },
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
  }
  return result
}
