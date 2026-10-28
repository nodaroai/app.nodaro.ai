/**
 * Prism reference audio: what audio the reference video a Nodaro Motion Prism
 * run (internal id `"seedance-2-5"`, also the engine of a run that names none)
 * sends to the video model carries. Pure (no database).
 *
 * - `"full"` (the default, and what every run did before the setting): the
 *   clip's audio, pitched.
 * - `"voice"`: only the singing or speaking voice, split from the music,
 *   pitched.
 * - `"none"`: a silent reference.
 *
 * In every mode the original audio goes back on the final video.
 *
 * Set by an admin, never by the person running it: per trend
 * (`TrendVersionData.prismReferenceAudio`, sent by `composeTrendRun`), and for
 * every DIRECT run by the `nodaro_motion_prism_reference_audio` app setting
 * (this module's key; written by
 * `PUT /v1/admin/nodaro-motion/prism-reference-audio`, read by the
 * `/v1/cast-swap` hook, middleware/nodaro-motion-prism-reference-audio.ts).
 *
 * On the wire the run body carries `prismReferenceAudio` only for `"voice"` or
 * `"none"`, and only to an engine that declares
 * `castSwap.prismReferenceAudio === true`: a body without the key is the full
 * audio, so every run that keeps the default — and every run on an engine from
 * before the setting — is sent exactly the body it was sent before
 * (`prismReferenceAudioSent`). The engine quotes `"voice"` with the audio split
 * in it, so the estimate must carry the key exactly as the run does.
 */
import { z } from "zod"
import { CAST_SWAP_ENGINE_WHEN_OMITTED, castSwapEngineFrom } from "@nodaro/shared/models"
import { getPluginSupports } from "./private-plugins/supports-registry.js"

export const CAST_SWAP_PRISM_REFERENCE_AUDIO = ["full", "voice", "none"] as const

export type CastSwapPrismReferenceAudio = (typeof CAST_SWAP_PRISM_REFERENCE_AUDIO)[number]

/** What a run sends of the setting: every value but the default. */
export type CastSwapPrismReferenceAudioSent = Exclude<CastSwapPrismReferenceAudio, "full">

/** A Prism run's reference audio when nothing names one. */
export const CAST_SWAP_PRISM_REFERENCE_AUDIO_DEFAULT: CastSwapPrismReferenceAudio = "full"

export const castSwapPrismReferenceAudioSchema = z.enum(CAST_SWAP_PRISM_REFERENCE_AUDIO)

/** The `app_settings` row of the direct runs' Prism reference audio: the value itself (`"full"` | `"voice"` | `"none"`). */
export const NODARO_MOTION_PRISM_REFERENCE_AUDIO_KEY = "nodaro_motion_prism_reference_audio"

/**
 * The tolerant read of the stored row: a valid value, else null (never saved,
 * or a value this app does not know, read as the default).
 */
export function parseNodaroMotionPrismReferenceAudio(value: unknown): CastSwapPrismReferenceAudio | null {
  const parsed = castSwapPrismReferenceAudioSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

/** Whether the loaded Cast Swap engine takes a run's `prismReferenceAudio` (`castSwap.prismReferenceAudio`). */
export function engineTakesPrismReferenceAudio(): boolean {
  return getPluginSupports().castSwap?.prismReferenceAudio === true
}

/**
 * Whether a run naming `engine` (any vocabulary) is a Prism run. A run that
 * names no engine is one (`CAST_SWAP_ENGINE_WHEN_OMITTED`); a value no
 * vocabulary knows is not.
 */
export function isPrismRun(engine: unknown): boolean {
  const resolved = engine === undefined ? CAST_SWAP_ENGINE_WHEN_OMITTED : castSwapEngineFrom(engine)
  return resolved === "seedance-2-5"
}

/**
 * What a run on `engine` (any vocabulary; absent = Prism) is sent of a Prism
 * reference audio choice: `{ prismReferenceAudio }` only for a Prism run
 * asking for the voice or no audio, on an engine that declares it, else
 * nothing (the full audio).
 */
export function prismReferenceAudioSent(
  engine: unknown,
  choice: CastSwapPrismReferenceAudio | null | undefined,
): { prismReferenceAudio?: CastSwapPrismReferenceAudioSent } {
  if (choice !== "voice" && choice !== "none") return {}
  if (!isPrismRun(engine)) return {}
  return engineTakesPrismReferenceAudio() ? { prismReferenceAudio: choice } : {}
}
