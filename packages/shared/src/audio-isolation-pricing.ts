/**
 * How an Audio Isolation run is priced (decided 2026-11-18): from the length
 * of its audio as the server reads it before anything is held, never a length
 * the caller declares.
 *
 * - The run is charged {@link AUDIO_ISOLATION_RATE_ID} once per started
 *   {@link AUDIO_ISOLATION_RATE_SECONDS} seconds of the audio, at least once,
 *   after forgiving `CLIP_PRICE_GRACE_SEC` past a mark. The hold IS the charge.
 * - Audio longer than {@link AUDIO_ISOLATION_MAX_SEC} (30 minutes, a hair past
 *   it forgiven) is refused before anything is held; so is a file larger than
 *   {@link AUDIO_ISOLATION_MAX_BYTES}.
 *
 * The route, the workflow run, the MCP verb (which calls the route) and both
 * estimates read this one module.
 */
import { CLIP_PRICE_GRACE_SEC, gracedMeasuredSec } from "./priced-clip-seconds.js"

/** Float noise: a length that is arithmetic can land a hair past the limit, and must not be refused for it. */
const FLOAT_NOISE_SEC = 1e-9

/** The row an Audio Isolation run reserves and is charged: the price of ten seconds of audio. */
export const AUDIO_ISOLATION_RATE_ID = "elevenlabs-isolation:per-10s"

/** The seconds of audio one unit of {@link AUDIO_ISOLATION_RATE_ID} prices. */
export const AUDIO_ISOLATION_RATE_SECONDS = 10

/** The longest audio a run takes: 30 minutes. */
export const AUDIO_ISOLATION_MAX_SEC = 1800

/** The largest file a run takes (the provider's own limit): 500 MB. */
export const AUDIO_ISOLATION_MAX_BYTES = 500 * 1024 * 1024

/** The most units a run can be charged: the 30-minute cap's. */
export const AUDIO_ISOLATION_MAX_UNITS = AUDIO_ISOLATION_MAX_SEC / AUDIO_ISOLATION_RATE_SECONDS

/**
 * The units of {@link AUDIO_ISOLATION_RATE_ID} an audio of `seconds` is
 * charged: every started ten seconds after the grace, at least one, at most
 * the cap's. THE one rounding every lane reads.
 */
export function audioIsolationUnits(seconds: number): number {
  if (!Number.isFinite(seconds) || seconds <= 0) return 1
  const units = Math.ceil(gracedMeasuredSec(seconds) / AUDIO_ISOLATION_RATE_SECONDS)
  return Math.min(AUDIO_ISOLATION_MAX_UNITS, Math.max(1, units))
}

/** What the length check answers for an audio of a given length. */
export type AudioIsolationLengthCheck =
  | { readonly ok: true; readonly units: number }
  | { readonly ok: false; readonly code: "audio_too_long"; readonly message: string }

/** The refusal of an audio past the 30-minute cap: how long it is, the limit, and what to do. */
export function audioIsolationTooLongMessage(seconds: number): string {
  const minutes = Math.floor(seconds / 60)
  const rest = Math.round(seconds - minutes * 60)
  const length = rest > 0 ? `${minutes} min ${rest} s` : `${minutes} min`
  return `The audio is ${length} long. Audio Isolation takes audio up to 30 minutes: split or trim it to 30 minutes or less first.`
}

/**
 * Whether an audio of `seconds` can run, and the units it is charged. Past
 * the 30-minute cap by more than `CLIP_PRICE_GRACE_SEC` is refused; within
 * that grace it is charged at the cap.
 */
export function checkAudioIsolationLength(seconds: number): AudioIsolationLengthCheck {
  if (seconds > AUDIO_ISOLATION_MAX_SEC + CLIP_PRICE_GRACE_SEC + FLOAT_NOISE_SEC) {
    return { ok: false, code: "audio_too_long", message: audioIsolationTooLongMessage(seconds) }
  }
  return { ok: true, units: audioIsolationUnits(seconds) }
}

/**
 * The units an ESTIMATE quotes before the run reads the audio: the length
 * the graph gives, at most the cap; a length it does not know quotes the cap
 * (the most a run can be charged), and the caller marks it as an estimate.
 */
export function audioIsolationEstimateUnits(knownSec?: number | null): number {
  if (knownSec == null || !Number.isFinite(knownSec) || knownSec <= 0) return AUDIO_ISOLATION_MAX_UNITS
  return audioIsolationUnits(knownSec)
}
