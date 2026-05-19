import { promises as fs } from "node:fs"
import { join } from "node:path"
import {
  cleanupWorkDir,
  createWorkDir,
  downloadFile,
  runFfmpegCapture,
} from "../../../providers/video/ffmpeg-utils.js"
import { uploadBufferToR2 } from "../../../lib/storage.js"

/**
 * Phase 1C.2 sub-step 7g — trim the generated music track to the exact target
 * duration and extract a beat-grid for the Editor LLM.
 *
 * **Beat detection strategy:** aubio is NOT available in our Dockerfile —
 * confirmed by the only `apt-get install` blocks shipping `ffmpeg curl
 * ca-certificates yt-dlp` (no `aubio-tools`). Adding aubio is out of scope
 * for 1C.2; we fall back to the FFmpeg `silencedetect` filter as documented
 * in the plan. silencedetect is less accurate than onset-based beat detection
 * — it returns silence boundaries which we use as a heuristic proxy for beat
 * markers. For most cinematic scores this surfaces 8-32 markers across the
 * track, which is enough for the Editor LLM to snap cut points to.
 *
 * TODO(Phase 1C.3+): bake `aubio-tools` into the production image and swap
 * the silencedetect heuristic for `aubio onset` (proper beat detection).
 *
 * **Pipeline:**
 *   1. Download the generated music track to a tmp file.
 *   2. Trim to target duration + add fade-out + run silencedetect — ALL in
 *      one ffmpeg pass. silencedetect is metadata-only (no audio transform);
 *      chained after afade so a single decode pass writes the trimmed mp3
 *      AND emits `silence_start` markers on stderr.
 *   3. Upload the trimmed track to R2; return URL + beat grid + BPM estimate
 *      (`60 / median_inter_onset_interval`).
 *
 * Failure handling: silencedetect errors are non-fatal — the result carries
 * an empty beat grid + BPM=0 and the caller (music-timeline orchestrator)
 * proceeds without snap targets.
 */

export interface PipelineExtractBeatGridArgs {
  /** R2 URL of the music track produced by sub-step 7f (pipelineGenerateMusic). */
  musicUrl: string
  /** Target duration of the final film (seconds). Music is trimmed to this. */
  targetDurationSec: number
  /** Fade-out duration applied to the trimmed audio. Default 0.8s — matches
   *  the §6 sub-step 7g spec ("trim to exact target with 0.8s fade-out"). */
  fadeOutDurationSec?: number
  /** Track user id for storage tracking on the uploaded trimmed audio. */
  userId?: string
}

export interface PipelineExtractBeatGridResult {
  /** R2 URL of the trimmed audio (target_duration + fade-out applied). */
  trimmedAssetUrl: string
  /** Beat onset markers in seconds, relative to the start of the trimmed
   *  track. Empty array when silencedetect found no markers OR extraction
   *  failed (the caller proceeds without snap targets in that case). */
  beatGridSeconds: number[]
  /** Estimated BPM, computed as `60 / median(inter-onset intervals)`. 0 when
   *  fewer than 2 onsets were detected. */
  detectedBPM: number
}

export async function pipelineExtractBeatGrid(
  args: PipelineExtractBeatGridArgs,
): Promise<PipelineExtractBeatGridResult> {
  const {
    musicUrl,
    targetDurationSec,
    fadeOutDurationSec = 0.8,
    userId,
  } = args

  const workDir = await createWorkDir("pipeline-beat-grid-")
  const sourcePath = join(workDir, "music.mp3")
  const trimmedPath = join(workDir, "trimmed.mp3")

  try {
    // 1. Download.
    await downloadFile(musicUrl, sourcePath)

    // 2. Trim + fade-out + silencedetect in a single ffmpeg pass. `silencedetect`
    //    is a metadata-only filter — it doesn't transform audio, it only emits
    //    `silence_start: <sec>` markers on stderr. Chaining it after `afade`
    //    keeps the audio intact while scanning silence boundaries in one decode
    //    pass (vs. the previous two-pass approach: trim → re-read trimmed file).
    //    `-t` caps total duration; threshold `-30dB` + min duration `0.05s`
    //    catches inter-beat low points without flooding on noise floor jitter.
    const fadeStartSec = Math.max(0, targetDurationSec - fadeOutDurationSec)
    let beatGridSeconds: number[] = []
    try {
      const { stderr } = await runFfmpegCapture([
        "-y",
        "-i", sourcePath,
        "-t", String(targetDurationSec),
        "-af",
        `afade=t=out:st=${fadeStartSec.toFixed(3)}:d=${fadeOutDurationSec},silencedetect=noise=-30dB:d=0.05`,
        "-c:a", "libmp3lame",
        "-b:a", "192k",
        trimmedPath,
      ])
      beatGridSeconds = parseSilenceDetectMarkers(stderr)
    } catch (err) {
      // runFfmpegCapture attaches stderr to the thrown error — try to parse
      // it before giving up. Many FFmpeg builds exit non-zero on `-f null -`
      // but still emit the silencedetect lines.
      const e = err as { stderr?: string }
      if (e?.stderr) {
        try {
          beatGridSeconds = parseSilenceDetectMarkers(e.stderr)
        } catch {
          // Final fallback — empty grid.
        }
      }
      if (beatGridSeconds.length === 0) {
        console.warn(
          "[pipeline-extract-beat-grid] silencedetect failed:",
          err instanceof Error ? err.message : err,
        )
      }
    }

    // 3. Upload trimmed track to R2.
    const trimmedBuffer = await fs.readFile(trimmedPath)
    const r2Key = `pipeline-music/${Date.now()}-${Math.random().toString(36).slice(2)}.mp3`
    const trimmedAssetUrl = await uploadBufferToR2(
      trimmedBuffer,
      r2Key,
      "audio/mpeg",
      userId,
    )

    return {
      trimmedAssetUrl,
      beatGridSeconds,
      detectedBPM: estimateBPM(beatGridSeconds),
    }
  } finally {
    await cleanupWorkDir(workDir)
  }
}

/**
 * Parses `silencedetect` stderr output for `silence_start: <seconds>` lines.
 * Exported for unit testing.
 *
 * Format: `[silencedetect @ 0x…] silence_start: 12.345`
 */
export function parseSilenceDetectMarkers(stderr: string): number[] {
  const markers: number[] = []
  const re = /silence_start:\s*([0-9]+\.?[0-9]*)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(stderr)) !== null) {
    const value = parseFloat(m[1]!)
    if (Number.isFinite(value) && value >= 0) markers.push(value)
  }
  return markers
}

/**
 * Computes BPM from inter-onset intervals. Uses the median to be robust
 * against outliers (occasional false-positive silences in noisy tracks).
 * Exported for unit testing.
 */
export function estimateBPM(beatGridSeconds: number[]): number {
  if (beatGridSeconds.length < 2) return 0
  const intervals: number[] = []
  for (let i = 1; i < beatGridSeconds.length; i++) {
    const delta = beatGridSeconds[i]! - beatGridSeconds[i - 1]!
    if (delta > 0) intervals.push(delta)
  }
  if (intervals.length === 0) return 0
  const sorted = [...intervals].sort((a, b) => a - b)
  const median = sorted[Math.floor(sorted.length / 2)]!
  if (median <= 0) return 0
  return Math.round(60 / median)
}
