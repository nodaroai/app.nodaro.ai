import { execFile } from "node:child_process"
import { promises as fs } from "node:fs"
import { join } from "node:path"
import { promisify } from "node:util"
import {
  cleanupWorkDir,
  createWorkDir,
  downloadFile,
  runFfmpegCapture,
} from "../../../providers/video/ffmpeg-utils.js"
import { uploadBufferToR2 } from "../../../lib/storage.js"

const execFileAsync = promisify(execFile)

/**
 * Phase 1C.2 sub-step 7g — trim the generated music track to the exact target
 * duration and extract a beat-grid for the Editor LLM.
 *
 * **Beat detection strategy (1C.2.1):** when `aubio` is on PATH (production
 * Dockerfile installs `aubio-tools`), call `aubio onset <trimmed.mp3>` to get
 * proper onset detection — one float per line on stdout, in seconds. When
 * aubio is absent (e.g. local dev without aubio-tools), fall back to the
 * original FFmpeg `silencedetect` heuristic. The aubio path is preferred
 * because silence boundaries are only a proxy for beat markers; aubio's
 * energy-based onset detector finds actual transients.
 *
 * **Pipeline:**
 *   1. Download the generated music track to a tmp file.
 *   2. Trim to target duration + add fade-out + (when aubio is unavailable)
 *      run silencedetect — ALL in one ffmpeg pass. silencedetect is
 *      metadata-only (no audio transform); chained after afade so a single
 *      decode pass writes the trimmed mp3 AND emits `silence_start` markers
 *      on stderr.
 *   3. When aubio is available, run `aubio onset` against the trimmed mp3 to
 *      get the beat grid. Otherwise parse the silencedetect markers from
 *      stderr.
 *   4. Upload the trimmed track to R2; return URL + beat grid + BPM estimate
 *      (`60 / median_inter_onset_interval`).
 *
 * Failure handling: both detector paths are non-fatal — the result carries
 * an empty beat grid + BPM=0 and the caller (music-timeline orchestrator)
 * proceeds without snap targets.
 */

/**
 * Module-init detection: probe whether `aubio` is on PATH so we can pick the
 * detector path at run-time without paying the spawn cost per call. The
 * promise is cached at module load so a single `aubio --version` is paid
 * once per process. Test paths that mock `child_process.execFile` always
 * win because the mock replaces the binding before this promise resolves.
 */
let aubioAvailablePromise: Promise<boolean> | null = null

function detectAubio(): Promise<boolean> {
  if (aubioAvailablePromise === null) {
    aubioAvailablePromise = execFileAsync("aubio", ["--version"])
      .then(() => true)
      .catch(() => false)
  }
  return aubioAvailablePromise
}

/**
 * Resets the cached aubio detection. Test-only — production code paths read
 * the cached promise exactly once per process lifetime.
 */
export function _resetAubioDetectionForTests(): void {
  aubioAvailablePromise = null
}

/**
 * Runs `aubio onset <path>` and parses its stdout (one float per line, in
 * seconds). Returns an empty array on parse failures.
 */
async function extractBeatGridAubio(audioPath: string): Promise<number[]> {
  const { stdout } = await execFileAsync("aubio", ["onset", audioPath])
  const markers: number[] = []
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const value = parseFloat(trimmed)
    if (Number.isFinite(value) && value >= 0) markers.push(value)
  }
  return markers
}

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

    // 2. Trim + fade-out (+ silencedetect when aubio isn't available) in a
    //    single ffmpeg pass. `silencedetect` is a metadata-only filter — it
    //    doesn't transform audio, it only emits `silence_start: <sec>`
    //    markers on stderr. We always emit silencedetect lines so the
    //    fallback path keeps working even if aubio is on PATH but fails at
    //    run-time (e.g. unsupported codec).
    //    `-t` caps total duration; threshold `-30dB` + min duration `0.05s`
    //    catches inter-beat low points without flooding on noise floor jitter.
    const fadeStartSec = Math.max(0, targetDurationSec - fadeOutDurationSec)
    let beatGridSeconds: number[] = []
    const aubioAvailable = await detectAubio()
    let trimStderr = ""
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
      trimStderr = stderr
    } catch (err) {
      // runFfmpegCapture attaches stderr to the thrown error — save it for
      // the fallback silencedetect parse below.
      const e = err as { stderr?: string }
      if (e?.stderr) trimStderr = e.stderr
      console.warn(
        "[pipeline-extract-beat-grid] ffmpeg trim+fade failed:",
        err instanceof Error ? err.message : err,
      )
    }

    if (aubioAvailable) {
      try {
        beatGridSeconds = await extractBeatGridAubio(trimmedPath)
      } catch (err) {
        // Fall back to silencedetect — aubio failed at run-time despite the
        // probe passing at module init.
        console.warn(
          "[pipeline-extract-beat-grid] aubio onset failed; falling back to silencedetect:",
          err instanceof Error ? err.message : err,
        )
        beatGridSeconds = parseSilenceDetectMarkers(trimStderr)
      }
    } else {
      beatGridSeconds = parseSilenceDetectMarkers(trimStderr)
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
