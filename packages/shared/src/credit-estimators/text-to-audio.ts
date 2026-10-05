/**
 * Text to Audio (sound effects) pricing — which price row a run is charged
 * from, by the length of the clip it asks for. One mapping for every place
 * that names the row: the route (`POST /v1/text-to-audio`), the workflow run's
 * reservation, the node's Run button and the workflow estimates.
 *
 * `elevenlabs-sfx` is priced per second: one `model_pricing` row per whole
 * second (`elevenlabs-sfx:1s` … `elevenlabs-sfx:30s`); the credit amounts live
 * there, never here. The requested length is rounded UP to whole seconds, and
 * a request that names no length is priced as 5 seconds. Worked examples
 * (repeated in docs/nodes/ai-audio/text-to-audio.md):
 *   0.5 s → `:1s`,  6 s → `:6s`,  22.3 s → `:23s`,  no duration → `:5s`.
 */

import { DEFAULT_TEXT_TO_AUDIO_PROVIDER } from "../model-constants.js"

export const TEXT_TO_AUDIO_PRICING = {
  /** The engine priced per second of requested audio. */
  PER_SECOND_PROVIDER: "elevenlabs-sfx",
  /** The longest clip a request may ask for, in seconds. */
  MAX_DURATION_SEC: 30,
  /** The length priced when a request names none (the model picks the length). */
  DEFAULT_BILLED_SEC: 5,
} as const

/** Every per-second price row, shortest first: `elevenlabs-sfx:1s` … `:30s`. */
export const TEXT_TO_AUDIO_SFX_CREDIT_IDS: readonly string[] = Array.from(
  { length: TEXT_TO_AUDIO_PRICING.MAX_DURATION_SEC },
  (_, i) => `${TEXT_TO_AUDIO_PRICING.PER_SECOND_PROVIDER}:${i + 1}s`,
)

/**
 * The whole seconds a request of `duration` seconds is billed for: rounded up,
 * at most the 30 s cap. No usable length (absent, empty, non-numeric, zero or
 * negative) bills the 5 s default. A numeric string counts — a field mapping
 * can deliver the length as text.
 */
export function textToAudioBilledSeconds(duration: unknown): number {
  const seconds =
    typeof duration === "number"
      ? duration
      : typeof duration === "string" && duration.trim() !== ""
        ? Number(duration)
        : Number.NaN
  if (!Number.isFinite(seconds) || seconds <= 0) return TEXT_TO_AUDIO_PRICING.DEFAULT_BILLED_SEC
  return Math.min(Math.ceil(seconds), TEXT_TO_AUDIO_PRICING.MAX_DURATION_SEC)
}

/**
 * The price row for a Text to Audio request. A request with no provider runs
 * (and is priced as) the default engine. An engine that is not priced per
 * second keeps its own flat row.
 */
export function textToAudioCreditId(provider: string | null | undefined, duration: unknown): string {
  const engine = provider || DEFAULT_TEXT_TO_AUDIO_PROVIDER
  if (engine !== TEXT_TO_AUDIO_PRICING.PER_SECOND_PROVIDER) return engine
  return `${engine}:${textToAudioBilledSeconds(duration)}s`
}
