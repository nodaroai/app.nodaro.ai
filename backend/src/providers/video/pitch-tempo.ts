import { join } from "node:path"
import { PITCH_TEMPO_LIMITS, semitonesToPitchRatio } from "@nodaro/shared/credits"
import { DeterministicJobError } from "../../lib/deterministic-job-error.js"
import {
  BIG_MEDIA_DOWNLOAD_LIMITS,
  cleanupWorkDir,
  createWorkDir,
  downloadFile,
  getVideoStreamDuration,
  probeMediaStreams,
  runFfmpeg,
} from "./ffmpeg-utils.js"

/**
 * Pitch & Tempo — pitch shift and time-stretch through ffmpeg's `rubberband`
 * filter (Rubber Band Library, compiled into the pinned GPL ffmpeg build).
 *
 * Audio in → MP3 out. Video in → MP4 out with the picture stream-copied and
 * the audio shifted; tempo is forced to 1 there (a stretched soundtrack would
 * no longer match its picture — speed changes on video belong to Speed Ramp),
 * and the audio is padded/trimmed to the picture's exact length, since Rubber
 * Band can emit a few samples more or less than it was given.
 *
 * Which lane runs is decided from the streams the downloaded file actually
 * carries, never from the field it arrived in: an audio-only M4A served as
 * video/mp4 is audio, and a podcast MP3's cover art is not a picture track.
 *
 * Measured on the production box (decided 2026-10-12): the worst case — 30
 * minutes of stereo at tempo 0.5 — takes ~2 minutes and ~35 MiB, so the
 * runner's default kill budget and memory reservation apply.
 */

export interface PitchTempoSettings {
  /** −12 … +12 semitones (12 = one octave up). */
  readonly semitones: number
  /** 0.5 … 2 speed factor, pitch kept. Ignored on a video input. */
  readonly tempo: number
  /** Keep the voice's formants (natural timbre) while shifting pitch. */
  readonly preserveFormants: boolean
}

export type PitchTempoOptions = PitchTempoSettings & {
  readonly audioUrl?: string
  readonly videoUrl?: string
}

export interface PitchTempoResult {
  readonly outputPath: string
  readonly inputType: "audio" | "video"
}

/** A refusal that depends only on the input: failing it again on a retry is pointless. */
export class PitchTempoInputError extends DeterministicJobError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = "PitchTempoInputError"
  }
}

const NO_AUDIO_MESSAGE = "This media has no audio track to shift."
const NO_RUBBERBAND_MESSAGE =
  "This server's ffmpeg build has no Rubber Band support (librubberband), so Pitch & Tempo cannot run here."

/**
 * Settings held to the node's ranges with its defaults filled in. The route
 * validates its body, but a workflow run builds its payload from node data
 * (and field mappings) without that Zod pass, so the engine is the one funnel
 * every lane goes through.
 */
export function normalizePitchTempoSettings(raw: {
  readonly semitones?: unknown
  readonly tempo?: unknown
  readonly preserveFormants?: unknown
}): PitchTempoSettings {
  const finite = (v: unknown): number | undefined => {
    const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v
    return typeof n === "number" && Number.isFinite(n) ? n : undefined
  }
  const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))
  return {
    semitones: clamp(finite(raw.semitones) ?? 0, PITCH_TEMPO_LIMITS.SEMITONES_MIN, PITCH_TEMPO_LIMITS.SEMITONES_MAX),
    tempo: clamp(finite(raw.tempo) ?? 1, PITCH_TEMPO_LIMITS.TEMPO_MIN, PITCH_TEMPO_LIMITS.TEMPO_MAX),
    preserveFormants: raw.preserveFormants !== false,
  }
}

/** Trim a float to at most 6 decimals for the filter string ("1.189207", "1", "0.5"). */
function num(n: number): string {
  return String(Number(n.toFixed(6)))
}

/**
 * The `rubberband` filter for these settings. `formant` and `pitchq` are always
 * sent: the filter's own defaults (`shifted`, `speed`) are not ours.
 */
export function buildRubberbandFilter(settings: PitchTempoSettings): string {
  const pitch = num(semitonesToPitchRatio(settings.semitones))
  const formant = settings.preserveFormants ? "preserved" : "shifted"
  return `rubberband=pitch=${pitch}:tempo=${num(settings.tempo)}:formant=${formant}:pitchq=quality`
}

/**
 * The ffmpeg arguments for one lane. The video lane copies the first picture
 * stream, shifts the first audio stream and pads/trims it to `sourceSec` (the
 * picture's length).
 */
export function buildPitchTempoArgs(opts: {
  readonly inputPath: string
  readonly outputPath: string
  readonly lane: "audio" | "video"
  readonly filter: string
  readonly sourceSec?: number
}): string[] {
  if (opts.lane === "audio") {
    return ["-y", "-i", opts.inputPath, "-vn", "-af", opts.filter, "-c:a", "libmp3lame", "-b:a", "192k", opts.outputPath]
  }
  if (opts.sourceSec === undefined || !(opts.sourceSec > 0)) {
    throw new Error("buildPitchTempoArgs: the video lane needs the picture's length")
  }
  return [
    "-y",
    "-i", opts.inputPath,
    "-map", "0:v:0",
    "-map", "0:a:0",
    "-c:v", "copy",
    "-af", `${opts.filter},apad,atrim=end=${num(opts.sourceSec)}`,
    "-c:a", "aac",
    "-b:a", "192k",
    "-movflags", "+faststart",
    opts.outputPath,
  ]
}

/** The ffmpeg failure a build without librubberband reports. */
export function isMissingRubberbandError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err)
  return /No such filter: '?rubberband'?/i.test(message) || (/Filter not found/i.test(message) && /rubberband/i.test(message))
}

function extensionOf(url: string, fallback: string): string {
  const match = url.match(/\.(\w{2,5})(?:\?|$)/)
  return match?.[1] ?? fallback
}

/**
 * Download the media, pick the lane from its streams, and render. On success
 * the output lands in a fresh work dir the CALLER removes
 * (`dirname(outputPath)`); on failure the work dir is removed here.
 */
export async function pitchTempo(options: PitchTempoOptions): Promise<PitchTempoResult> {
  const sourceUrl = options.videoUrl ?? options.audioUrl
  if (!sourceUrl) throw new Error("pitchTempo: audioUrl or videoUrl is required")

  const workDir = await createWorkDir("pitch-tempo")
  try {
    const inputPath = join(workDir, `input.${extensionOf(sourceUrl, options.videoUrl ? "mp4" : "mp3")}`)
    // Big-media limits: a user-supplied input of up to 30 minutes (a video can
    // be gigabytes) must not die at the flat 120 s default; a dead or drip-fed
    // transfer still fails within minutes.
    await downloadFile(sourceUrl, inputPath, { limits: BIG_MEDIA_DOWNLOAD_LIMITS })

    const streams = await probeMediaStreams(inputPath)
    if (!streams.hasAudio) throw new PitchTempoInputError(NO_AUDIO_MESSAGE)
    const lane: "audio" | "video" = streams.hasVideo ? "video" : "audio"

    const settings = normalizePitchTempoSettings(options)
    const filter = buildRubberbandFilter({ ...settings, tempo: lane === "video" ? 1 : settings.tempo })
    const outputPath = join(workDir, lane === "video" ? "output.mp4" : "output.mp3")
    const sourceSec = lane === "video" ? await getVideoStreamDuration(inputPath) : undefined

    try {
      await runFfmpeg(buildPitchTempoArgs({ inputPath, outputPath, lane, filter, sourceSec }))
    } catch (err) {
      if (isMissingRubberbandError(err)) throw new PitchTempoInputError(NO_RUBBERBAND_MESSAGE, { cause: err })
      throw err
    }
    return { outputPath, inputType: lane }
  } catch (err) {
    await cleanupWorkDir(workDir)
    throw err
  }
}
