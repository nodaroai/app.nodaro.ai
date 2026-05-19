import { getVideoDuration } from "../../../providers/video/ffmpeg-utils.js"

/**
 * Phase 1C.3 §J1a — shared audio-duration probe helper.
 *
 * Wraps ffprobe's `format=duration` lookup (via `getVideoDuration`, which
 * works on remote URLs and any audio container — mp3/wav/m4a) and normalizes
 * the result:
 *  - returns the duration in seconds on success
 *  - returns `null` on probe failure OR if the probed value is non-finite/≤0
 *  - never throws — failures are non-fatal so callers can fall back to a
 *    planning-time estimate (e.g. shot duration, narration script length)
 *
 * Used by `pipelineGenerateSpeech` (per-shot dialogue) and
 * `pipelineGenerateNarration` (pipeline-level narration). The TTS workers
 * persist only `audioUrl` to `jobs.output_data` — callers that need the real
 * duration (lip-sync per-second tiering, Editor LLM `dialogue_no_cut_zone`,
 * final-merge narration fit-check) probe here.
 */
export async function probeAudioDuration(
  audioUrl: string,
  logTag = "pipeline-probe-audio",
): Promise<number | null> {
  try {
    const duration = await getVideoDuration(audioUrl)
    if (!Number.isFinite(duration) || duration <= 0) return null
    return duration
  } catch (err) {
    console.warn(
      `[${logTag}] ffprobe failed for ${audioUrl}:`,
      err instanceof Error ? err.message : err,
    )
    return null
  }
}
