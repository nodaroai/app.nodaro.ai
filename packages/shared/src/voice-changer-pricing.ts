/**
 * How a Voice Changer run is priced (decided 2026-11-22): from the length of
 * the audio it revoices as the server reads it before anything is held — the
 * video's when the run is given one (a video wins, as the run itself does),
 * else the audio's — never a length the caller declares.
 *
 * - The run is charged {@link VOICE_CHANGER_RATE_ID} once per started
 *   {@link VOICE_CHANGER_RATE_SECONDS} seconds of the audio, at least once,
 *   after forgiving `CLIP_PRICE_GRACE_SEC` past a mark. The hold IS the charge.
 * - Audio longer than {@link VOICE_CHANGER_MAX_SEC} (5 minutes, a hair past it
 *   forgiven) is refused before anything is held.
 *
 * The route, the workflow run, the MCP verb (which calls the route) and both
 * estimates read this one module. The flat `elevenlabs-voice-changer` row is
 * not this rate: the voiced-video add-on and the film pipeline still charge it.
 */
import { CLIP_PRICE_GRACE_SEC, gracedMeasuredSec } from "./priced-clip-seconds.js"

/** Float noise: a length that is arithmetic can land a hair past the limit, and must not be refused for it. */
const FLOAT_NOISE_SEC = 1e-9

/** The row a Voice Changer run reserves and is charged: the price of ten seconds of audio. */
export const VOICE_CHANGER_RATE_ID = "elevenlabs-voice-changer:per-10s"

/** The seconds of audio one unit of {@link VOICE_CHANGER_RATE_ID} prices. */
export const VOICE_CHANGER_RATE_SECONDS = 10

/** The longest audio a run takes: 5 minutes. */
export const VOICE_CHANGER_MAX_SEC = 300

/** The most units a run can be charged: the 5-minute cap's. */
export const VOICE_CHANGER_MAX_UNITS = VOICE_CHANGER_MAX_SEC / VOICE_CHANGER_RATE_SECONDS

/**
 * The units of {@link VOICE_CHANGER_RATE_ID} an audio of `seconds` is
 * charged: every started ten seconds after the grace, at least one, at most
 * the cap's. THE one rounding every lane reads.
 */
export function voiceChangerUnits(seconds: number): number {
  if (!Number.isFinite(seconds) || seconds <= 0) return 1
  const units = Math.ceil(gracedMeasuredSec(seconds) / VOICE_CHANGER_RATE_SECONDS)
  return Math.min(VOICE_CHANGER_MAX_UNITS, Math.max(1, units))
}

/** What the length check answers for an audio of a given length. */
export type VoiceChangerLengthCheck =
  | { readonly ok: true; readonly units: number }
  | { readonly ok: false; readonly code: "audio_too_long"; readonly message: string }

/**
 * The refusal of an audio past the 5-minute cap: how long it is, the limit,
 * and what to do. The length is stated in whole seconds rounded up, so a
 * refused audio never reads as the limit itself.
 */
export function voiceChangerTooLongMessage(seconds: number): string {
  const total = Math.ceil(seconds - FLOAT_NOISE_SEC)
  const minutes = Math.floor(total / 60)
  const rest = total - minutes * 60
  const length = rest > 0 ? `${minutes} min ${rest} s` : `${minutes} min`
  return `The audio is ${length} long. Voice Changer takes audio up to 5 minutes: split or trim it to 5 minutes or less first.`
}

/**
 * Whether an audio of `seconds` can run, and the units it is charged. Past
 * the 5-minute cap by more than `CLIP_PRICE_GRACE_SEC` is refused; within
 * that grace it is charged at the cap.
 */
export function checkVoiceChangerLength(seconds: number): VoiceChangerLengthCheck {
  if (seconds > VOICE_CHANGER_MAX_SEC + CLIP_PRICE_GRACE_SEC + FLOAT_NOISE_SEC) {
    return { ok: false, code: "audio_too_long", message: voiceChangerTooLongMessage(seconds) }
  }
  return { ok: true, units: voiceChangerUnits(seconds) }
}

/**
 * The units an ESTIMATE quotes before the run reads the audio: the length
 * the graph gives, at most the cap; a length it does not know quotes the cap
 * (the most a run can be charged), and the caller marks it as an estimate.
 */
export function voiceChangerEstimateUnits(knownSec?: number | null): number {
  if (knownSec == null || !Number.isFinite(knownSec) || knownSec <= 0) return VOICE_CHANGER_MAX_UNITS
  return voiceChangerUnits(knownSec)
}
