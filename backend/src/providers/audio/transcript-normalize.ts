/**
 * Build the normalized `@nodaro/shared` `Transcript` (the transcribe node's
 * `json` output handle) from a transcribe output shape.
 *
 * Kept pure and in the mapper layer (imported by `transcribe-output.ts` and the
 * elevenlabs-stt branch of `transcribe.ts`) so BOTH the live worker path and the
 * reconcile cron — which rebuilds `output_data` from the same mappers — carry
 * the transcript. No I/O, no provider-client imports.
 *
 * Word timings arrive in MS (Caption-shaped, already converted by
 * captions-mappers). Whisper segments arrive in SECONDS and are converted here.
 * `normalizeTranscript` is the single coerce-never-reject gate: it keeps a
 * zero-width word or segment as a point, drops a broken one (a missing or
 * unusable time, or an end before its start — never clamped), drops junk,
 * sorts words by start and enforces the wire shape.
 */
import type { Caption } from "@remotion/captions"
import { normalizeTranscript, type Transcript } from "@nodaro/shared"

export interface TranscriptFromOutput {
  language?: string
  /** SECONDS (whisper/fast-whisper segment/chunk timings). */
  segments?: Array<{ start: number; end: number; text: string }>
  /** MS, Caption-shaped. `speaker` present only on diarized elevenlabs-stt runs. */
  words?: Array<Caption & { speaker?: string }>
}

/**
 * Map a transcribe output shape → a normalized `Transcript`.
 *
 * `sourceId` is intentionally omitted for a bare transcribe node: no `EdlSource`
 * exists yet (edit-plan mints those). The remap functions treat an absent
 * `sourceId` as a zero offset, so leaving it unset is correct here.
 */
export function buildTranscriptFromOutput(src: TranscriptFromOutput, sourceId?: string): Transcript {
  const words = (src.words ?? []).map((w) => ({
    text: w.text,
    startMs: w.startMs,
    endMs: w.endMs,
    ...(w.speaker ? { speaker: w.speaker } : {}),
    // Caption.confidence is `number | null`; keep only real numbers.
    ...(typeof w.confidence === "number" ? { confidence: w.confidence } : {}),
  }))
  const segments = (src.segments ?? []).map((s) => ({
    startMs: Math.round(s.start * 1000),
    endMs: Math.round(s.end * 1000),
    text: s.text,
  }))
  return normalizeTranscript({
    version: 1,
    ...(sourceId ? { sourceId } : {}),
    ...(src.language ? { language: src.language } : {}),
    words,
    ...(segments.length ? { segments } : {}),
  })
}
