/**
 * The four voice settings a Text to Speech request may carry, their ranges, and the ONE normaliser every exit that
 * puts them on a wire runs them through.
 *
 * Why at the exits: the text-to-speech worker (workers/handlers/audio-ai.ts) hands an exit the job's values exactly
 * as its enqueuer wrote them, and only the REST route validates them (its Zod reads the ranges below, so the two
 * cannot disagree). A workflow or published-app run copies node data, which an app's inputOverrides, an MCP
 * `run_app` / SDK flat input (typed `text`) or an imported workflow may have written as a string or out of range;
 * the pipelines pass their arguments through. The exits are `directElevenLabsTTS` (direct-tts.ts), the self-host
 * relay `NodaroCloudAudioProvider` (nodaro/audio.ts) and `KieAudioProvider` (kie/audio.ts) — the guard
 * `providers/__tests__/tts-voice-settings-exits.test.ts` finds every exit and fails on one that does not normalise.
 *
 * The rule, the same on every lane: a finite number stays; a decimal numeric string (surrounding spaces allowed)
 * becomes that number; anything else (an empty or non-numeric string, NaN, Infinity, null, a boolean, an object)
 * is ABSENT, so the voice's own stored setting applies and nothing unusable reaches the provider. A number outside
 * the setting's range is CLAMPED into it, never rejected: failing a job after its credits were reserved is worse
 * than a clamped slider. A request that was valid comes out exactly as it went in.
 */

/** ElevenLabs' documented range of each voice setting (stability, similarity boost and style 0–1; speed 0.7–1.2). */
export const TTS_VOICE_SETTING_RANGES = {
  stability: { min: 0, max: 1 },
  similarityBoost: { min: 0, max: 1 },
  style: { min: 0, max: 1 },
  speed: { min: 0.7, max: 1.2 },
} as const

export type TtsVoiceSettingKey = keyof typeof TTS_VOICE_SETTING_RANGES

/** The normalised settings: only finite numbers inside their range; a setting that was unusable is not a key. */
export type TtsVoiceSettings = { [K in TtsVoiceSettingKey]?: number }

const SETTING_KEYS = Object.keys(TTS_VOICE_SETTING_RANGES) as TtsVoiceSettingKey[]

/** A decimal number: optional sign, digits with an optional fraction (or a bare fraction), optional exponent. */
const DECIMAL_NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/

function toFiniteNumber(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined
  if (typeof value !== "string") return undefined
  const trimmed = value.trim()
  if (!DECIMAL_NUMBER.test(trimmed)) return undefined
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : undefined
}

/** One setting: its number clamped into its range, or `undefined` when the value is not a usable number. */
export function normalizeTtsVoiceSetting(key: TtsVoiceSettingKey, value: unknown): number | undefined {
  const n = toFiniteNumber(value)
  if (n === undefined) return undefined
  const { min, max } = TTS_VOICE_SETTING_RANGES[key]
  return Math.min(max, Math.max(min, n))
}

/** The four settings of `options`, normalised. Other keys are not carried over; the input is never mutated. */
export function normalizeTtsVoiceSettings(
  options: Readonly<Partial<Record<TtsVoiceSettingKey, unknown>>> | undefined,
): TtsVoiceSettings {
  const out: TtsVoiceSettings = {}
  for (const key of SETTING_KEYS) {
    const value = normalizeTtsVoiceSetting(key, options?.[key])
    if (value !== undefined) out[key] = value
  }
  return out
}
