/**
 * Pulse audio: what sound a Nodaro Motion Pulse run (the Kling engine,
 * internal id `"kling-4"`) delivers. Pure (no database).
 *
 * - `"original"` (the default, and what every run did before the setting):
 *   the source clip's original audio goes back on the result, exactly.
 * - `"generated"`: Kling keeps the clip's sound and its own output track is
 *   delivered as is.
 *
 * Set by an admin, never by the person running it: per trend
 * (`TrendVersionData.pulseAudio`, sent by `composeTrendRun`), and for every
 * DIRECT run by the `nodaro_motion_pulse_audio` app setting (this module's
 * key; written by `PUT /v1/admin/nodaro-motion/pulse-audio`, read by the
 * `/v1/cast-swap` hook, middleware/nodaro-motion-pulse-audio.ts).
 *
 * On the wire the run body carries `pulseAudio: "generated"` only, and only to an
 * engine that declares `castSwap.pulseAudio === true`: a body without the key
 * is the original audio, so every run that keeps the default — and every run
 * on an engine from before the setting — is sent exactly the body it was
 * sent before (`pulseAudioSent`).
 */
import { z } from "zod"
import { castSwapEngineFrom } from "@nodaro/shared/models"
import { getPluginSupports } from "./private-plugins/supports-registry.js"

export const CAST_SWAP_PULSE_AUDIO = ["original", "generated"] as const

export type CastSwapPulseAudio = (typeof CAST_SWAP_PULSE_AUDIO)[number]

/** A Pulse run's audio when nothing names one. */
export const CAST_SWAP_PULSE_AUDIO_DEFAULT: CastSwapPulseAudio = "original"

export const castSwapPulseAudioSchema = z.enum(CAST_SWAP_PULSE_AUDIO)

/** The `app_settings` row of the direct runs' Pulse audio: the value itself (`"original"` | `"generated"`). */
export const NODARO_MOTION_PULSE_AUDIO_KEY = "nodaro_motion_pulse_audio"

/**
 * The tolerant read of the stored row: a valid value, else null (never saved,
 * or a value this app does not know, read as the default).
 */
export function parseNodaroMotionPulseAudio(value: unknown): CastSwapPulseAudio | null {
  const parsed = castSwapPulseAudioSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

/** Whether the loaded Cast Swap engine takes a run's `pulseAudio` (`castSwap.pulseAudio`). */
export function engineTakesPulseAudio(): boolean {
  return getPluginSupports().castSwap?.pulseAudio === true
}

/**
 * What a run on `engine` (any vocabulary; absent = Prism) is sent of a Pulse
 * audio choice: `{ pulseAudio: "generated" }` only for a Pulse run asking for
 * Kling's audio on an engine that declares it, else nothing (the original).
 */
export function pulseAudioSent(engine: unknown, choice: CastSwapPulseAudio | null | undefined): { pulseAudio?: "generated" } {
  if (choice !== "generated") return {}
  if (castSwapEngineFrom(engine) !== "kling-4") return {}
  return engineTakesPulseAudio() ? { pulseAudio: "generated" } : {}
}
