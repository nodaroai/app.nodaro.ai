/**
 * Prism reference audio: what audio the reference video a Nodaro Motion Prism
 * run (internal id `"seedance-2-5"`, also the engine of a run that names none)
 * sends to the video model carries, chosen PER OUTPUT RESOLUTION (the engine
 * may take a reference with the song's audio at one resolution and refuse it
 * at another). Pure (no database).
 *
 * Each resolution (`"480p"`, `"720p"`, `"1080p"`) takes a mode:
 * - `"full"` (the default, and what every run did before the setting): the
 *   clip's audio, pitched.
 * - `"voice"`: only the singing or speaking voice, split from the music,
 *   pitched.
 * - `"none"`: a silent reference.
 * A resolution the setting leaves out is `"full"`. In every mode the original
 * audio goes back on the final video.
 *
 * Set by an admin, never by the person running it: per trend
 * (`TrendVersionData.prismReferenceAudio`, sent by `composeTrendRun`), and for
 * every DIRECT run by the `nodaro_motion_prism_reference_audio` app setting
 * (this module's key; written by
 * `PUT /v1/admin/nodaro-motion/prism-reference-audio`, read by the
 * `/v1/cast-swap` hook, middleware/nodaro-motion-prism-reference-audio.ts).
 * Both were one mode for every resolution at first: a stored plain string is
 * read as that mode at every resolution (`prismReferenceAudioByResolutionOf`).
 *
 * On the wire (`prismReferenceAudioWire`), only on a Prism run:
 * - an engine declaring `castSwap.prismReferenceAudioPerResolution === true`
 *   is sent the object, its non-`"full"` keys only, and no key when every
 *   resolution is the full audio;
 * - an engine declaring only `castSwap.prismReferenceAudio === true` is sent
 *   the mode of the run's own resolution (a draft is 480p), and no key for
 *   `"full"`;
 * - any other engine is sent no key.
 * A body without the key is the full audio, so every run that keeps the
 * default — and every run on an engine from before the setting — is sent
 * exactly the body it was sent before. The engine quotes `"voice"` with the
 * audio split in it, so the estimate must carry the key exactly as the run
 * does.
 */
import { z } from "zod"
import { CAST_SWAP_ENGINE_WHEN_OMITTED, CAST_SWAP_RESOLUTIONS_BY_ENGINE, castSwapEngineFrom } from "@nodaro/shared/models"
import { getPluginSupports } from "./private-plugins/supports-registry.js"

export const CAST_SWAP_PRISM_REFERENCE_AUDIO_MODES = ["full", "voice", "none"] as const

/** One resolution's reference audio. */
export type CastSwapPrismReferenceAudioMode = (typeof CAST_SWAP_PRISM_REFERENCE_AUDIO_MODES)[number]

/** What a run sends of a mode: every mode but the default. */
export type CastSwapPrismReferenceAudioModeSent = Exclude<CastSwapPrismReferenceAudioMode, "full">

/** The resolutions a Prism run renders, the default (its 480p draft) first. */
export const CAST_SWAP_PRISM_RESOLUTIONS = CAST_SWAP_RESOLUTIONS_BY_ENGINE["seedance-2-5"]

export type CastSwapPrismResolution = (typeof CAST_SWAP_PRISM_RESOLUTIONS)[number]

/** The setting: a mode per output resolution, a missing key being `"full"`. */
export type CastSwapPrismReferenceAudio = { [R in CastSwapPrismResolution]?: CastSwapPrismReferenceAudioMode }

/** The object a per-resolution engine is sent: only the non-`"full"` keys, never empty. */
export type CastSwapPrismReferenceAudioByResolutionSent = { [R in CastSwapPrismResolution]?: CastSwapPrismReferenceAudioModeSent }

/** What a run body carries of the setting, as the loaded engine takes it. */
export type CastSwapPrismReferenceAudioSent = CastSwapPrismReferenceAudioModeSent | CastSwapPrismReferenceAudioByResolutionSent

/** A Prism run's reference audio at a resolution the setting leaves out. */
export const CAST_SWAP_PRISM_REFERENCE_AUDIO_DEFAULT: CastSwapPrismReferenceAudioMode = "full"

export const castSwapPrismReferenceAudioModeSchema = z.enum(CAST_SWAP_PRISM_REFERENCE_AUDIO_MODES)

const byResolutionSchema = z.strictObject({
  "480p": castSwapPrismReferenceAudioModeSchema.optional(),
  "720p": castSwapPrismReferenceAudioModeSchema.optional(),
  "1080p": castSwapPrismReferenceAudioModeSchema.optional(),
} satisfies Record<CastSwapPrismResolution, unknown>)

/** One mode for every resolution: how a plain string from before the per-resolution setting reads. */
function everyResolution(mode: CastSwapPrismReferenceAudioMode): CastSwapPrismReferenceAudio {
  return Object.fromEntries(CAST_SWAP_PRISM_RESOLUTIONS.map((r) => [r, mode])) as CastSwapPrismReferenceAudio
}

/**
 * The setting as a write takes it: the per-resolution object, or a plain mode
 * (an earlier value, or an earlier client), which reads as that mode at every
 * resolution. Parses to the object.
 */
export const castSwapPrismReferenceAudioSchema = z.union([
  byResolutionSchema,
  castSwapPrismReferenceAudioModeSchema.transform(everyResolution),
])

/** The `app_settings` row of the direct runs' Prism reference audio: the per-resolution object (a plain mode from earlier reads as every resolution). */
export const NODARO_MOTION_PRISM_REFERENCE_AUDIO_KEY = "nodaro_motion_prism_reference_audio"

/**
 * The tolerant read of a stored value (the app setting, or a trend's): the
 * per-resolution object, a plain mode as that mode at every resolution, else
 * null (never saved, or a value this app does not know: the full audio).
 */
export function prismReferenceAudioByResolutionOf(value: unknown): CastSwapPrismReferenceAudio | null {
  const parsed = castSwapPrismReferenceAudioSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

/** The tolerant read of the stored `nodaro_motion_prism_reference_audio` row (`prismReferenceAudioByResolutionOf`). */
export function parseNodaroMotionPrismReferenceAudio(value: unknown): CastSwapPrismReferenceAudio | null {
  return prismReferenceAudioByResolutionOf(value)
}

/** The setting's non-`"full"` keys, or undefined when every resolution is the full audio. */
export function prismReferenceAudioNotFull(
  choice: CastSwapPrismReferenceAudio | null | undefined,
): CastSwapPrismReferenceAudioByResolutionSent | undefined {
  if (!choice) return undefined
  const sent: CastSwapPrismReferenceAudioByResolutionSent = {}
  for (const r of CAST_SWAP_PRISM_RESOLUTIONS) {
    const mode = choice[r]
    if (mode === "voice" || mode === "none") sent[r] = mode
  }
  return Object.keys(sent).length > 0 ? sent : undefined
}

/** Whether the loaded Cast Swap engine takes a mode per output resolution (`castSwap.prismReferenceAudioPerResolution`). */
export function engineTakesPrismReferenceAudioPerResolution(): boolean {
  return getPluginSupports().castSwap?.prismReferenceAudioPerResolution === true
}

/** Whether the loaded Cast Swap engine takes a run's `prismReferenceAudio` in either shape. */
export function engineTakesPrismReferenceAudio(): boolean {
  const cs = getPluginSupports().castSwap
  return cs?.prismReferenceAudio === true || cs?.prismReferenceAudioPerResolution === true
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
 * The output resolution of a Prism run body: a draft (`draft: true`, or the
 * deprecated `quality: "draft"`) is 480p; else its `resolution` when it names
 * one Prism renders; else Prism's default (480p).
 */
export function prismRunResolution(body: { resolution?: unknown; draft?: unknown; quality?: unknown }): CastSwapPrismResolution {
  if (body.draft === true || body.quality === "draft") return "480p"
  return CAST_SWAP_PRISM_RESOLUTIONS.find((r) => r === body.resolution) ?? CAST_SWAP_PRISM_RESOLUTIONS[0]
}

/**
 * What a Prism run at `resolution` is sent of `choice`, as the loaded engine
 * takes it (see the module comment): the object of the non-`"full"` keys to a
 * per-resolution engine, the run's own resolution's mode to an engine that
 * takes one mode, else nothing — and nothing for the full audio.
 */
export function prismReferenceAudioWire(
  choice: CastSwapPrismReferenceAudio | null | undefined,
  resolution: CastSwapPrismResolution,
): CastSwapPrismReferenceAudioSent | undefined {
  if (engineTakesPrismReferenceAudioPerResolution()) return prismReferenceAudioNotFull(choice)
  if (getPluginSupports().castSwap?.prismReferenceAudio !== true) return undefined
  const mode = choice?.[resolution]
  return mode === "voice" || mode === "none" ? mode : undefined
}

/**
 * What a direct run body (`engine` in any vocabulary, absent = Prism) is sent
 * of `choice`: `{ prismReferenceAudio }` only on a Prism run whose choice is
 * not the full audio for what the loaded engine reads, else nothing.
 */
export function prismReferenceAudioSent(
  body: { engine?: unknown; resolution?: unknown; draft?: unknown; quality?: unknown },
  choice: CastSwapPrismReferenceAudio | null | undefined,
): { prismReferenceAudio?: CastSwapPrismReferenceAudioSent } {
  if (!isPrismRun(body.engine)) return {}
  const sent = prismReferenceAudioWire(choice, prismRunResolution(body))
  return sent === undefined ? {} : { prismReferenceAudio: sent }
}
