/**
 * Audio-to-video: one audio clip drives the picture and the clip is as long as
 * the audio (catalog `drivingAudio`, LTX 2.5 Fast — decided 2026-11-23).
 *
 * THE one rule every surface prices such a run by — the routes, the workflow
 * run, the server's estimate, the editor's quote — from the audio's length as
 * the SERVER measures it (a caller's stated length is never read):
 *   - the run is priced on the measured length rounded UP to a whole second,
 *     forgiving the platform's charge grace (`CLIP_PRICE_GRACE_SEC`, 0.05 s: a
 *     decoder's few hundredths at a file's end are not a whole second more),
 *     one price row per whole second at the resolution sent;
 *   - the length SENT is the measured one less a small margin
 *     (`DRIVING_AUDIO_SEND_MARGIN_SEC`, to the hundredth, rounded down; never
 *     below the shortest clip), never more than the seconds priced: the
 *     endpoint refuses a length longer than the audio, and another decoder may
 *     read an MP3 or AAC file a few hundredths shorter, so what renders is at
 *     most what was held;
 *   - audio shorter than `minSec` plus that margin (`drivingAudioMinSec`), longer than `maxSec`, or longer than the
 *     model's `longClipLimit` at its resolution and frame rate, is refused
 *     before anything is held, naming the setting to change;
 *   - audio whose length could not be measured is refused: it is never priced
 *     on a guess.
 */
import { MODEL_CATALOG, videoFrameRateFor, type ModelCatalogEntry } from "./model-catalog.js"
import { normalizeLtx25Resolution, isLtx25Provider } from "./model-constants.js"
import { CLIP_PRICE_GRACE_SEC } from "./priced-clip-seconds.js"

/**
 * How far under the measured audio the length sent stays: another decoder
 * (the provider's) may read an MP3 or AAC file a few hundredths of a second
 * shorter than ours, and the endpoint refuses a length past the audio's end.
 */
export const DRIVING_AUDIO_SEND_MARGIN_SEC = 0.05

/** The model's audio-to-video lengths, or undefined for a model that runs none. */
export function drivingAudioOf(provider: string | undefined): ModelCatalogEntry["drivingAudio"] {
  return provider ? MODEL_CATALOG[provider]?.drivingAudio : undefined
}

/** Does this model run audio-to-video from a wired / sent audio clip? */
export function takesDrivingAudio(provider: string | undefined): boolean {
  return drivingAudioOf(provider) !== undefined
}

/** A run of `provider` with `audioCount` audio clips is audio-to-video. */
export function isDrivingAudioRun(provider: string | undefined, audioCount: number): boolean {
  return takesDrivingAudio(provider) && audioCount > 0
}

/** The resolution and frame rate an audio-driven run is sent and priced at. */
function sentSettings(provider: string, resolution: unknown, fps: unknown): { resolution: string; fps: number | undefined } {
  const res = isLtx25Provider(provider)
    ? normalizeLtx25Resolution(provider, typeof resolution === "string" ? resolution : undefined)
    : (typeof resolution === "string" ? resolution : "")
  return { resolution: res, fps: videoFrameRateFor(provider, fps) }
}

/**
 * The shortest audio an audio-driven run takes: the endpoint's shortest clip
 * plus the margin the length sent keeps under the audio, so a clip at the
 * minimum is never sent shorter than its own end allows.
 */
export function drivingAudioMinSec(provider: string): number {
  const spec = drivingAudioOf(provider)
  return spec ? Math.round((spec.minSec + DRIVING_AUDIO_SEND_MARGIN_SEC) * 100) / 100 : 0
}

/**
 * The longest audio an audio-driven run takes at this resolution and frame
 * rate: `drivingAudio.maxSec`, or the `longClipLimit` where it applies (LTX 2.5
 * Fast: 10 s at 1440p or 48 / 50 fps).
 */
export function drivingAudioMaxSec(provider: string, at: { resolution?: unknown; fps?: unknown }): number {
  const spec = drivingAudioOf(provider)
  if (!spec) return 0
  const limit = MODEL_CATALOG[provider]?.longClipLimit
  if (!limit) return spec.maxSec
  const { resolution, fps } = sentSettings(provider, at.resolution, at.fps)
  const limited =
    (limit.resolutions ?? []).some((r) => r.toLowerCase() === resolution.toLowerCase()) ||
    (fps !== undefined && (limit.frameRates ?? []).includes(fps))
  return limited ? Math.min(spec.maxSec, limit.maxSeconds) : spec.maxSec
}

/** The price row of an audio-driven run of `seconds` (whole) at `resolution`. */
export function drivingAudioCreditId(provider: string, resolution: string, seconds: number): string {
  return `${provider}:${seconds}s:${resolution}`
}

/** Why an audio-driven run is refused. */
export type DrivingAudioRefusalCode = "audio_unmeasured" | "audio_too_short" | "audio_too_long"

export type DrivingAudioRun =
  | {
      readonly ok: true
      /** The whole seconds the run is priced, held and charged for. */
      readonly billedSec: number
      /** The length sent to the model: the measured length, never more than `billedSec`. */
      readonly sentSec: number
      /** The price row (`<provider>:<billedSec>s:<resolution>`). */
      readonly creditId: string
      /** The resolution and frame rate it is sent and priced at. */
      readonly resolution: string
      readonly fps: number | undefined
    }
  | { readonly ok: false; readonly code: DrivingAudioRefusalCode; readonly message: string }

/**
 * Price an audio-driven run from the audio's length as the server read it (`audioSec`,
 * seconds; undefined = not measured). See the module note for the rule.
 */
export function drivingAudioRun(args: {
  provider: string
  resolution?: unknown
  fps?: unknown
  audioSec: number | undefined
}): DrivingAudioRun {
  const spec = drivingAudioOf(args.provider)
  const label = MODEL_CATALOG[args.provider]?.label ?? args.provider
  if (!spec) {
    return { ok: false, code: "audio_unmeasured", message: `${label} does not make a video from an audio clip.` }
  }
  const { resolution, fps } = sentSettings(args.provider, args.resolution, args.fps)
  const audioSec = args.audioSec
  if (audioSec === undefined || !Number.isFinite(audioSec) || audioSec <= 0) {
    return {
      ok: false,
      code: "audio_unmeasured",
      message: `${label} could not measure the length of the audio clip, so the run cannot be priced. Use an MP3, WAV, M4A, AAC, OGG or FLAC file from a link that answers directly. Nothing was charged.`,
    }
  }
  // The shortest clip plus the margin the length sent keeps under the audio (2.05 s on LTX 2.5 Fast).
  const shortest = drivingAudioMinSec(args.provider)
  if (audioSec < shortest) {
    return {
      ok: false,
      code: "audio_too_short",
      message: `${label} takes an audio clip of at least ${shortest} s; this one is ${audioSec.toFixed(2)} s. Nothing was charged.`,
    }
  }
  const max = drivingAudioMaxSec(args.provider, { resolution, fps })
  if (audioSec > max + CLIP_PRICE_GRACE_SEC) {
    return { ok: false, code: "audio_too_long", message: drivingAudioTooLongMessage({ provider: args.provider, resolution, fps, audioSec }) }
  }
  // Whole seconds, a hair past one forgiven; at least the shortest clip and at most the longest.
  const billedSec = Math.min(max, Math.max(spec.minSec, Math.ceil(audioSec - CLIP_PRICE_GRACE_SEC - 1e-9)))
  // The measured length less the margin, to the hundredth, rounded down — never below the shortest clip.
  const sentSec = Math.max(spec.minSec, Math.min(billedSec, Math.floor((audioSec - DRIVING_AUDIO_SEND_MARGIN_SEC) * 100 + 1e-6) / 100))
  return { ok: true, billedSec, sentSec, creditId: drivingAudioCreditId(args.provider, resolution, billedSec), resolution, fps }
}

/**
 * The refusal for a clip longer than the run takes at this resolution and
 * frame rate, naming the setting to change. `audioSec` is stated only when
 * the length was measured; a decode stopped past the limit says "longer"
 * without a length it never read.
 */
export function drivingAudioTooLongMessage(args: { provider: string; resolution?: unknown; fps?: unknown; audioSec?: number }): string {
  const spec = drivingAudioOf(args.provider)
  const label = MODEL_CATALOG[args.provider]?.label ?? args.provider
  const { resolution, fps } = sentSettings(args.provider, args.resolution, args.fps)
  const max = drivingAudioMaxSec(args.provider, { resolution, fps })
  const clip = args.audioSec !== undefined ? `this clip is ${args.audioSec.toFixed(1)} s` : "this clip is longer"
  return spec && max < spec.maxSec
    ? `${label} takes at most ${max} s of audio at ${resolution}${fps !== undefined ? ` and ${fps} fps` : ""}; ${clip}. Choose 720p or 1080p at 24 or 25 fps (up to ${spec.maxSec} s), or use a shorter clip. Nothing was charged.`
    : `${label} takes at most ${max} s of audio; ${clip}. Use a shorter clip. Nothing was charged.`
}

/**
 * The price row an ESTIMATE of an audio-driven run quotes: the audio's known
 * length by the run's own rule, else — length unknown, or one the run would
 * refuse — the longest clip the run can hold at its resolution and frame rate
 * (an estimate never quotes below what the run may hold).
 */
export function drivingAudioQuoteId(args: { provider: string; resolution?: unknown; fps?: unknown; audioSec: number | undefined }): string {
  const run = drivingAudioRun(args)
  if (run.ok) return run.creditId
  const { resolution, fps } = sentSettings(args.provider, args.resolution, args.fps)
  return drivingAudioCreditId(args.provider, resolution, drivingAudioMaxSec(args.provider, { resolution, fps }))
}
