/**
 * Pulse reference audio ("audio in", decided 2026-11-18): what audio the clip
 * a Nodaro Pulse run (internal id `"kling-4"`) sends to the video model
 * carries, chosen PER OUTPUT RESOLUTION (`"720p"`, `"1080p"`). Pure (no
 * database). Separate from the Pulse audio (`pulseAudio`, "audio out",
 * cast-swap-pulse-audio.ts), which keeps deciding only what sound the final
 * video carries; any combination of the two is allowed.
 *
 * Each resolution takes the same two controls as the Prism reference audio
 * (cast-swap-prism-reference-audio.ts, whose mode list and value schema this
 * module reuses): a mode (`"none"`, `"full"`, `"voice"`, `"full-one-tone"`,
 * `"voice-one-tone"`) and a pitch shift in semitones (-24 to 24 in steps of
 * 0.5; absent = 0; never on `"none"`).
 *
 * A resolution the setting leaves out follows the audio out in effect
 * (`pulseReferenceAudioDefault`): the full mix at +4 when the run delivers the
 * original audio (`pulseAudio` "original", or absent), the full mix unpitched
 * when it delivers Kling's own track (`"generated"`) — exactly what every
 * Pulse run sent before the setting. So everything that compares, keeps or
 * sends a value reads it against the audio out in effect: for a direct run the
 * body's `pulseAudio` once the Pulse audio hook has run; for the setting's save
 * the stored Pulse audio; for a trend the trend's own `pulseAudio`.
 *
 * Set by an admin, never by the person running it: per trend
 * (`TrendVersionData.pulseReferenceAudio`, sent by `composeTrendRun`), and for
 * every DIRECT run by the `nodaro_motion_pulse_reference_audio` app setting
 * (this module's key, its own row: the `nodaro_motion_pulse_audio` row is never
 * widened; written by `PUT /v1/admin/video-remake/pulse-reference-audio`, read
 * by the `/v1/cast-swap` hook, middleware/nodaro-motion-pulse-reference-audio.ts).
 *
 * On the wire one shape, only on a Pulse run, only to an engine declaring
 * `castSwap.pulseReferenceAudio`, and only the resolutions off the default of
 * that run's audio out: `{ "720p"?: { mode, semitones }, "1080p"?: … }`
 * (`{ mode: "none" }` for a silent clip). No key when every resolution is the
 * default, so every run that keeps it — and every run on an engine from before
 * the setting — is sent exactly the body it was sent before. The engine quotes
 * the voice modes with the vocals split in them, so the estimate carries the
 * key exactly as the run does.
 */
import { z } from "zod"
import { CAST_SWAP_RESOLUTIONS_BY_ENGINE, castSwapEngineFrom } from "@nodaro/shared/models"
import { getPluginSupports } from "./private-plugins/supports-registry.js"
import {
  CAST_SWAP_PRISM_REFERENCE_AUDIO_MODES,
  castSwapPrismReferenceAudioValueSchema,
  type CastSwapPrismReferenceAudioMode,
  type CastSwapPrismReferenceAudioValue,
} from "./cast-swap-prism-reference-audio.js"
import type { CastSwapPulseAudio } from "./cast-swap-pulse-audio.js"

/** What a resolution's clip carries: the Prism reference audio's modes. */
export const CAST_SWAP_PULSE_REFERENCE_AUDIO_MODES = CAST_SWAP_PRISM_REFERENCE_AUDIO_MODES

export type CastSwapPulseReferenceAudioMode = CastSwapPrismReferenceAudioMode

/** One resolution's value: a mode and, but on `"none"`, its pitch shift (absent = 0). */
export type CastSwapPulseReferenceAudioValue = CastSwapPrismReferenceAudioValue

/** The resolutions a Pulse run renders, its default (720p) first. */
export const CAST_SWAP_PULSE_RESOLUTIONS = CAST_SWAP_RESOLUTIONS_BY_ENGINE["kling-4"]

export type CastSwapPulseResolution = (typeof CAST_SWAP_PULSE_RESOLUTIONS)[number]

/** The setting (as stored, as a trend holds it, and as a run is sent it): a value per output resolution, a missing key being the default. */
export type CastSwapPulseReferenceAudio = { [R in CastSwapPulseResolution]?: CastSwapPulseReferenceAudioValue }

/** The default with the original audio out (or none named): the clip's full mix at +4, what every such run sent before. */
export const CAST_SWAP_PULSE_REFERENCE_AUDIO_DEFAULT_ORIGINAL: CastSwapPulseReferenceAudioValue = Object.freeze({ mode: "full", semitones: 4 })

/** The default with Kling's own audio out (`"generated"`): the clip's full mix unpitched, what every such run sent before. */
export const CAST_SWAP_PULSE_REFERENCE_AUDIO_DEFAULT_GENERATED: CastSwapPulseReferenceAudioValue = Object.freeze({ mode: "full", semitones: 0 })

/** A resolution's value when nothing sets it, by the audio out in effect (absent = the original audio). Never `"none"`. */
export function pulseReferenceAudioDefault(out: CastSwapPulseAudio | null | undefined): CastSwapPulseReferenceAudioValue {
  return out === "generated" ? CAST_SWAP_PULSE_REFERENCE_AUDIO_DEFAULT_GENERATED : CAST_SWAP_PULSE_REFERENCE_AUDIO_DEFAULT_ORIGINAL
}

/** The audio out a run body (or a trend) holds: `"generated"` only when it says so, else the original. */
export function pulseAudioOutOf(value: unknown): CastSwapPulseAudio {
  return value === "generated" ? "generated" : "original"
}

/** A value in its one written form: `{ mode: "none" }` for a silent clip, else `{ mode, semitones }` with the pitch shift spelled out. A new object. */
export function canonicalPulseReferenceAudio(value: CastSwapPulseReferenceAudioValue): CastSwapPulseReferenceAudioValue {
  return value.mode === "none" ? { mode: "none" } : { mode: value.mode, semitones: value.semitones ?? 0 }
}

function sameValue(a: CastSwapPulseReferenceAudioValue, b: CastSwapPulseReferenceAudioValue): boolean {
  const ca = canonicalPulseReferenceAudio(a)
  const cb = canonicalPulseReferenceAudio(b)
  return ca.mode === cb.mode && (ca.semitones ?? 0) === (cb.semitones ?? 0)
}

/** Whether a value is the default of the audio out in effect (absent semitones read as 0). */
export function isDefaultPulseReferenceAudio(value: CastSwapPulseReferenceAudioValue, out: CastSwapPulseAudio | null | undefined): boolean {
  return sameValue(value, pulseReferenceAudioDefault(out))
}

/** One resolution, parsed to its written form (Prism's value schema: strict, `{ mode, semitones? }`). */
const valueSchema = castSwapPrismReferenceAudioValueSchema.transform(canonicalPulseReferenceAudio)

/**
 * The setting as a write takes it (the admin PUT, a trend draft): a strict
 * object of the two Pulse resolutions, each a strict `{ mode, semitones? }`
 * (no ids, no plain string). Parses to the written form
 * (`canonicalPulseReferenceAudio`). What is the default is dropped only where
 * the audio out is known (`pulseReferenceAudioNotDefault`).
 */
export const castSwapPulseReferenceAudioSchema = z.strictObject({
  "720p": valueSchema.optional(),
  "1080p": valueSchema.optional(),
} satisfies Record<CastSwapPulseResolution, unknown>)

/** The `app_settings` row of the direct runs' Pulse reference audio: the per-resolution object, only the resolutions off the default. */
export const NODARO_MOTION_PULSE_REFERENCE_AUDIO_KEY = "nodaro_motion_pulse_reference_audio"

/**
 * The tolerant read of a stored value (the app setting, a trend's, or a body
 * composed from one): the per-resolution object in its written form, else null
 * (never saved, or a value this app does not know: the default everywhere).
 */
export function parseNodaroMotionPulseReferenceAudio(value: unknown): CastSwapPulseReferenceAudio | null {
  const parsed = castSwapPulseReferenceAudioSchema.safeParse(value)
  if (!parsed.success) return null
  const out: CastSwapPulseReferenceAudio = {}
  for (const r of CAST_SWAP_PULSE_RESOLUTIONS) {
    const v = parsed.data[r]
    if (v !== undefined) out[r] = v
  }
  return out
}

/**
 * The resolutions of `choice` off the default of the audio out `out`, in their
 * written form, or undefined when every one is the default: what is stored,
 * and what is sent.
 */
export function pulseReferenceAudioNotDefault(
  choice: CastSwapPulseReferenceAudio | null | undefined,
  out: CastSwapPulseAudio | null | undefined,
): CastSwapPulseReferenceAudio | undefined {
  if (!choice) return undefined
  const kept: CastSwapPulseReferenceAudio = {}
  for (const r of CAST_SWAP_PULSE_RESOLUTIONS) {
    const value = choice[r]
    if (value !== undefined && !isDefaultPulseReferenceAudio(value, out)) kept[r] = canonicalPulseReferenceAudio(value)
  }
  return Object.keys(kept).length > 0 ? kept : undefined
}

/**
 * The resolutions a save changes to a value off the default (`next` read
 * against its audio out `nextOut`): those whose stored form — the value kept
 * off the default of each side's own audio out — is not what `before` (against
 * `beforeOut`) stores there. Compared as stored, not as it sounds: a value that
 * sounds as before but is now stored (and sent) where it was not counts. A
 * resolution taken back to the default is not in it (it stores and sends
 * nothing). Empty = nothing a hold would need to wait for.
 */
export function pulseReferenceAudioChangedFrom(
  next: CastSwapPulseReferenceAudio | null | undefined,
  nextOut: CastSwapPulseAudio | null | undefined,
  before: CastSwapPulseReferenceAudio | null | undefined,
  beforeOut: CastSwapPulseAudio | null | undefined,
): CastSwapPulseReferenceAudio {
  const kept = pulseReferenceAudioNotDefault(next, nextOut) ?? {}
  const was = pulseReferenceAudioNotDefault(before, beforeOut) ?? {}
  const changed: CastSwapPulseReferenceAudio = {}
  for (const r of CAST_SWAP_PULSE_RESOLUTIONS) {
    const value = kept[r]
    if (value === undefined) continue
    const old = was[r]
    if (old === undefined || !sameValue(value, old)) changed[r] = value
  }
  return changed
}

/** Whether a save changes some resolution to a value off the default (`pulseReferenceAudioChangedFrom` is not empty). */
export function pulseReferenceAudioChangesToOffDefault(
  next: CastSwapPulseReferenceAudio | null | undefined,
  nextOut: CastSwapPulseAudio | null | undefined,
  before: CastSwapPulseReferenceAudio | null | undefined,
  beforeOut: CastSwapPulseAudio | null | undefined,
): boolean {
  return Object.keys(pulseReferenceAudioChangedFrom(next, nextOut, before, beforeOut)).length > 0
}

/** The part of an engine's `castSwap` declaration the setting reads. */
export interface PulseReferenceAudioSupports {
  readonly pulseReferenceAudio?: boolean
}

/** Whether a (loaded or recorded) engine takes a run's `pulseReferenceAudio` (`castSwap.pulseReferenceAudio`: every mode and pitch shift). */
export function engineTakesPulseReferenceAudioIn(cs: PulseReferenceAudioSupports | undefined): boolean {
  return cs?.pulseReferenceAudio === true
}

/** Whether the loaded Cast Swap engine takes a run's `pulseReferenceAudio`. */
export function engineTakesPulseReferenceAudio(): boolean {
  return engineTakesPulseReferenceAudioIn(getPluginSupports().castSwap)
}

/** Whether a run naming `engine` (any vocabulary) is a Pulse run. A run that names none is a Prism run. */
export function isPulseRun(engine: unknown): boolean {
  return castSwapEngineFrom(engine) === "kling-4"
}

/**
 * What a direct run body is sent of the stored setting, against the audio out
 * in effect (`out`: the body's `pulseAudio` once the Pulse audio hook has
 * run): `{ pulseReferenceAudio }` only on a Pulse run, only to an engine that
 * declares it, and only the resolutions off that default; else nothing.
 */
export function pulseReferenceAudioSent(
  body: { engine?: unknown },
  stored: CastSwapPulseReferenceAudio | null | undefined,
  out: CastSwapPulseAudio | null | undefined,
): { pulseReferenceAudio?: CastSwapPulseReferenceAudio } {
  if (!isPulseRun(body.engine) || !engineTakesPulseReferenceAudio()) return {}
  const sent = pulseReferenceAudioNotDefault(stored, out)
  return sent === undefined ? {} : { pulseReferenceAudio: sent }
}
