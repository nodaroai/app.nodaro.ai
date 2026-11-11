/**
 * Prism reference audio: what audio the reference video a Nodaro Motion Prism
 * run (internal id `"seedance-2-5"`, also the engine of a run that names none)
 * sends to the video model carries, chosen PER OUTPUT RESOLUTION (the engine
 * may take a reference with the song's audio at one resolution and refuse it
 * at another). Pure (no database).
 *
 * Each resolution (`"480p"`, `"720p"`, `"1080p"`) takes two controls:
 * - a mode (`CAST_SWAP_PRISM_REFERENCE_AUDIO_MODES`): `"none"` (a silent
 *   reference), `"full"` (the clip's whole audio mix), `"voice"` (only the
 *   vocals, split from the music), `"full-one-tone"` (the whole mix flattened
 *   to one steady tone) or `"voice-one-tone"` (the vocals flattened to one
 *   steady tone);
 * - a pitch shift in semitones, -24 to 24 in steps of 0.5, applied before the
 *   flattening; at 0 the pitch step does not run. `"none"` has none (it is
 *   ignored there and never sent).
 * A resolution the setting leaves out is the default, the full mix at +4
 * (`CAST_SWAP_PRISM_REFERENCE_AUDIO_DEFAULT`). In every mode the original
 * audio goes back on the final video. A voice mode whose split finds no vocals
 * sends a silent reference (the engine's fallback, which it records).
 *
 * Before the two controls a resolution held one id
 * (`CAST_SWAP_PRISM_REFERENCE_AUDIO_IDS`), and every id reads as the value it
 * always sounded like (`prismReferenceAudioValueOfId`): `"full"` the full mix
 * at +4, `"voice"` the vocals at +4, `"one-tone"` the full mix flattened,
 * unpitched, `"octave"` the full mix at +12, `"none"` silent. A value one id
 * says is STORED as that id (`prismReferenceAudioStoredOf`), so every setting
 * saved before the two controls is stored, and read by a server from before
 * them, exactly as it was; only a value no id says is stored as
 * `{ mode, semitones }`.
 *
 * Set by an admin, never by the person running it: per trend
 * (`TrendVersionData.prismReferenceAudio`, sent by `composeTrendRun`), and for
 * every DIRECT run by the `nodaro_motion_prism_reference_audio` app setting
 * (this module's key; written by
 * `PUT /v1/admin/nodaro-motion/prism-reference-audio`, read by the
 * `/v1/cast-swap` hook, middleware/nodaro-motion-prism-reference-audio.ts).
 * Both were one id for every resolution at first: a stored plain id is read
 * as that id at every resolution (`prismReferenceAudioByResolutionOf`).
 *
 * On the wire (`prismReferenceAudioWire`), only on a Prism run, and only for
 * the resolutions off the default (no key when every one is the default):
 * - an engine declaring `castSwap.prismReferenceAudioPitch === true` is sent
 *   the object form, `{ mode, semitones }` per resolution (`{ mode: "none" }`
 *   for a silent one);
 * - any other engine is sent today's ids, as before: the object of ids to an
 *   engine declaring `castSwap.prismReferenceAudioPerResolution`, the id of
 *   the run's own resolution (a draft is 480p) to one declaring only
 *   `castSwap.prismReferenceAudio`, nothing to any other. A value no id says
 *   is the full audio there; so a shared setting or a published trend holding
 *   one needs every environment's engine to declare the pitch shift
 *   (`prismReferenceAudioRequirementsOf`), as "one-tone" and "octave" need an
 *   engine that lists them in `castSwap.prismReferenceAudioModes`. A value no
 *   id says is also what older code cannot read, so a save that changes a
 *   resolution to one also waits for every environment's platform claim (the
 *   hold, ee/lib/nodaro-motion-prism-reference-audio-modes.ts).
 * A body without the key is the default, so every run that keeps it — and
 * every run on an engine from before the setting — is sent exactly the body
 * it was sent before. The engine quotes the voice modes with the audio split
 * in them, so the estimate must carry the key exactly as the run does.
 */
import { z } from "zod"
import { CAST_SWAP_ENGINE_WHEN_OMITTED, CAST_SWAP_RESOLUTIONS_BY_ENGINE, castSwapEngineFrom } from "@nodaro/shared/models"
import { getPluginSupports } from "./private-plugins/supports-registry.js"

/** What a resolution's reference carries. */
export const CAST_SWAP_PRISM_REFERENCE_AUDIO_MODES = ["none", "full", "voice", "full-one-tone", "voice-one-tone"] as const

export type CastSwapPrismReferenceAudioMode = (typeof CAST_SWAP_PRISM_REFERENCE_AUDIO_MODES)[number]

/** The pitch shift, in semitones: at 0 the pitch step does not run. */
export const PRISM_REFERENCE_AUDIO_SEMITONES_MIN = -24
export const PRISM_REFERENCE_AUDIO_SEMITONES_MAX = 24
export const PRISM_REFERENCE_AUDIO_SEMITONES_STEP = 0.5

/** One resolution's reference audio: a mode and, but on `"none"`, its pitch shift. */
export interface CastSwapPrismReferenceAudioValue {
  readonly mode: CastSwapPrismReferenceAudioMode
  /** -24 to 24 in steps of 0.5; 0 = no pitch step. Never on `"none"`. */
  readonly semitones?: number
}

/** A Prism run's reference audio at a resolution the setting leaves out: the full mix at +4, as every run was before the setting. */
export const CAST_SWAP_PRISM_REFERENCE_AUDIO_DEFAULT: CastSwapPrismReferenceAudioValue = { mode: "full", semitones: 4 }

/** The ids a resolution held before the two controls: still read, stored where a value is one, and all an engine without the pitch shift takes. */
export const CAST_SWAP_PRISM_REFERENCE_AUDIO_IDS = ["full", "voice", "none", "one-tone", "octave"] as const

export type CastSwapPrismReferenceAudioId = (typeof CAST_SWAP_PRISM_REFERENCE_AUDIO_IDS)[number]

/** What a run sends of an id: every id but the default. */
export type CastSwapPrismReferenceAudioIdSent = Exclude<CastSwapPrismReferenceAudioId, "full">

/** What each id reads as: the value it always sounded like. */
const VALUE_OF_ID: Readonly<Record<CastSwapPrismReferenceAudioId, CastSwapPrismReferenceAudioValue>> = {
  full: CAST_SWAP_PRISM_REFERENCE_AUDIO_DEFAULT,
  voice: { mode: "voice", semitones: 4 },
  "one-tone": { mode: "full-one-tone", semitones: 0 },
  octave: { mode: "full", semitones: 12 },
  none: { mode: "none" },
}

/** The value an id reads as (the carry-over of a setting saved before the two controls). */
export function prismReferenceAudioValueOfId(id: CastSwapPrismReferenceAudioId): CastSwapPrismReferenceAudioValue {
  return VALUE_OF_ID[id]
}

/** A value's pitch shift (0 on `"none"`, and where none is given). */
function semitonesOf(value: CastSwapPrismReferenceAudioValue): number {
  return value.mode === "none" ? 0 : (value.semitones ?? 0)
}

/** The id that says exactly this value, or undefined: only the object form can (`castSwap.prismReferenceAudioPitch`). */
export function prismReferenceAudioIdOf(value: CastSwapPrismReferenceAudioValue): CastSwapPrismReferenceAudioId | undefined {
  if (value.mode === "none") return "none"
  return CAST_SWAP_PRISM_REFERENCE_AUDIO_IDS.find((id) => {
    const of = VALUE_OF_ID[id]
    return of.mode === value.mode && semitonesOf(of) === semitonesOf(value)
  })
}

/** Whether a value is the default: what a resolution left out (and a body without the key) means. */
export function isDefaultPrismReferenceAudio(value: CastSwapPrismReferenceAudioValue): boolean {
  return prismReferenceAudioIdOf(value) === "full"
}

/**
 * The ids an engine takes only when it lists them in
 * `castSwap.prismReferenceAudioModes` (0.426.0): an engine from before them
 * would refuse the run (its schema knows only "full", "voice" and "none").
 * "voice" and "none" keep their rule (`prismReferenceAudio` /
 * `prismReferenceAudioPerResolution`), so nothing chosen before them moves.
 */
export const DECLARED_ONLY_PRISM_REFERENCE_AUDIO_IDS = ["one-tone", "octave"] as const satisfies readonly CastSwapPrismReferenceAudioIdSent[]

/** The modes an engine with the pitch shift takes only when it lists them in `castSwap.prismReferenceAudioModes`. */
export const DECLARED_ONLY_PRISM_REFERENCE_AUDIO_MODES = ["full-one-tone", "voice-one-tone"] as const satisfies readonly CastSwapPrismReferenceAudioMode[]

function isDeclaredOnlyId(id: CastSwapPrismReferenceAudioId): boolean {
  return (DECLARED_ONLY_PRISM_REFERENCE_AUDIO_IDS as readonly string[]).includes(id)
}

function isDeclaredOnlyMode(mode: CastSwapPrismReferenceAudioMode): boolean {
  return (DECLARED_ONLY_PRISM_REFERENCE_AUDIO_MODES as readonly string[]).includes(mode)
}

/** The part of an engine's `castSwap` declaration the reference audio reads. */
export interface PrismReferenceAudioSupports {
  readonly prismReferenceAudio?: boolean
  readonly prismReferenceAudioPerResolution?: boolean
  readonly prismReferenceAudioModes?: readonly string[]
  readonly prismReferenceAudioPitch?: boolean
}

/** Whether an engine takes the object form: a mode and a pitch shift per resolution (`castSwap.prismReferenceAudioPitch`). */
function takesPitch(cs: PrismReferenceAudioSupports | undefined): boolean {
  return cs?.prismReferenceAudioPitch === true
}

function lists(cs: PrismReferenceAudioSupports | undefined, name: string): boolean {
  return (cs?.prismReferenceAudioModes ?? []).includes(name)
}

/**
 * Whether an engine without the pitch shift takes `id` on a Prism run: "full"
 * always (it sends no key); "voice" and "none" on an engine that takes the
 * setting at all; "one-tone" and "octave" only when it lists them in
 * `castSwap.prismReferenceAudioModes`.
 */
export function engineTakesPrismReferenceAudioId(cs: PrismReferenceAudioSupports | undefined, id: CastSwapPrismReferenceAudioId): boolean {
  if (id === "full") return true
  if (cs?.prismReferenceAudio !== true && cs?.prismReferenceAudioPerResolution !== true) return false
  return isDeclaredOnlyId(id) ? lists(cs, id) : true
}

/**
 * Whether a (loaded or recorded) engine takes `value` on a Prism run: the
 * default always; with the pitch shift, any value of a mode it takes (a
 * one-tone mode only where it lists it); without it, only a value an id says,
 * as it takes that id.
 */
export function engineTakesPrismReferenceAudioValue(cs: PrismReferenceAudioSupports | undefined, value: CastSwapPrismReferenceAudioValue): boolean {
  if (isDefaultPrismReferenceAudio(value)) return true
  if (takesPitch(cs)) return !isDeclaredOnlyMode(value.mode) || lists(cs, value.mode)
  const id = prismReferenceAudioIdOf(value)
  return id !== undefined && engineTakesPrismReferenceAudioId(cs, id)
}

/** Whether an engine takes `mode` at some pitch shift ("full" always; without the pitch shift, the modes of the ids it takes). */
export function engineTakesPrismReferenceAudioModeAtAll(cs: PrismReferenceAudioSupports | undefined, mode: CastSwapPrismReferenceAudioMode): boolean {
  if (mode === "full") return true
  if (takesPitch(cs)) return !isDeclaredOnlyMode(mode) || lists(cs, mode)
  return CAST_SWAP_PRISM_REFERENCE_AUDIO_IDS.some((id) => VALUE_OF_ID[id].mode === mode && engineTakesPrismReferenceAudioId(cs, id))
}

/**
 * What a setting needs of an engine beyond the reference audio itself, each
 * once, in this order: an id only some engines list ("one-tone", "octave"),
 * a one-tone mode the object form names ("full-one-tone", "voice-one-tone"),
 * and the pitch shift (`"pitch"`) for a value no id says.
 */
export const PRISM_REFERENCE_AUDIO_REQUIREMENTS = ["one-tone", "octave", "full-one-tone", "voice-one-tone", "pitch"] as const

export type PrismReferenceAudioRequirement = (typeof PRISM_REFERENCE_AUDIO_REQUIREMENTS)[number]

/** The requirements of `choice` (`PRISM_REFERENCE_AUDIO_REQUIREMENTS` order). Today's values need what they needed: one-tone and octave their ids, the rest nothing. */
export function prismReferenceAudioRequirementsOf(choice: CastSwapPrismReferenceAudioChoice | null | undefined): PrismReferenceAudioRequirement[] {
  if (!choice) return []
  const needed = new Set<PrismReferenceAudioRequirement>()
  for (const r of CAST_SWAP_PRISM_RESOLUTIONS) {
    const value = choice[r]
    if (!value || isDefaultPrismReferenceAudio(value)) continue
    const id = prismReferenceAudioIdOf(value)
    if (id !== undefined) {
      if (id === "one-tone" || id === "octave") needed.add(id)
      continue
    }
    if (value.mode === "full-one-tone" || value.mode === "voice-one-tone") needed.add(value.mode)
    needed.add("pitch")
  }
  return PRISM_REFERENCE_AUDIO_REQUIREMENTS.filter((r) => needed.has(r))
}

/**
 * The requirements only a value no id says raises (`prismReferenceAudioRequirementsOf`,
 * less today's ids): the pitch shift, and a one-tone mode's listing. Empty for
 * every value older code reads, so none of those is ever held for that.
 */
export function prismReferenceAudioUnreadableRequirementsOf(choice: CastSwapPrismReferenceAudioChoice | null | undefined): PrismReferenceAudioRequirement[] {
  return prismReferenceAudioRequirementsOf(choice).filter((r) => r !== "one-tone" && r !== "octave")
}

/** Whether an engine meets a requirement: as it takes the values behind it (`engineTakesPrismReferenceAudioValue`). */
export function engineMeetsPrismReferenceAudioRequirement(
  cs: PrismReferenceAudioSupports | undefined,
  requirement: PrismReferenceAudioRequirement,
): boolean {
  if (requirement === "one-tone" || requirement === "octave") return engineTakesPrismReferenceAudioValue(cs, VALUE_OF_ID[requirement])
  if (requirement === "pitch") return takesPitch(cs)
  return takesPitch(cs) && lists(cs, requirement)
}

/** The resolutions a Prism run renders, the default (480p) first. */
export const CAST_SWAP_PRISM_RESOLUTIONS = CAST_SWAP_RESOLUTIONS_BY_ENGINE["seedance-2-5"]

export type CastSwapPrismResolution = (typeof CAST_SWAP_PRISM_RESOLUTIONS)[number]

/** A resolution as stored: its id where one says the value, else the value. */
export type CastSwapPrismReferenceAudioStoredValue = CastSwapPrismReferenceAudioId | CastSwapPrismReferenceAudioValue

/** The setting as stored (and as a save writes it): a value per output resolution, a missing key being the default. */
export type CastSwapPrismReferenceAudio = { [R in CastSwapPrismResolution]?: CastSwapPrismReferenceAudioStoredValue }

/** The setting as read: each resolution's value, a missing key being the default. */
export type CastSwapPrismReferenceAudioChoice = { [R in CastSwapPrismResolution]?: CastSwapPrismReferenceAudioValue }

/** The object an engine without the pitch shift that takes one per resolution is sent: the ids off the default, never empty. */
export type CastSwapPrismReferenceAudioByResolutionSent = { [R in CastSwapPrismResolution]?: CastSwapPrismReferenceAudioIdSent }

/** The object form an engine with the pitch shift is sent: the values off the default, never empty. */
export type CastSwapPrismReferenceAudioPitchedSent = { [R in CastSwapPrismResolution]?: CastSwapPrismReferenceAudioValue }

/** What a run body carries of the setting, as the loaded engine takes it. */
export type CastSwapPrismReferenceAudioSent =
  | CastSwapPrismReferenceAudioIdSent
  | CastSwapPrismReferenceAudioByResolutionSent
  | CastSwapPrismReferenceAudioPitchedSent

/** A value as stored: its id where one says it, else `{ mode, semitones }` (`{ mode }` alone never: "none" is an id). */
export function prismReferenceAudioStoredOf(value: CastSwapPrismReferenceAudioValue): CastSwapPrismReferenceAudioStoredValue {
  return prismReferenceAudioIdOf(value) ?? { mode: value.mode, semitones: semitonesOf(value) }
}

/** A stored value as read. */
function valueOfStored(stored: CastSwapPrismReferenceAudioStoredValue): CastSwapPrismReferenceAudioValue {
  return typeof stored === "string" ? VALUE_OF_ID[stored] : stored.mode === "none" ? VALUE_OF_ID.none : { mode: stored.mode, semitones: semitonesOf(stored) }
}

export const castSwapPrismReferenceAudioIdSchema = z.enum(CAST_SWAP_PRISM_REFERENCE_AUDIO_IDS)

export const castSwapPrismReferenceAudioSemitonesSchema = z
  .number()
  .min(PRISM_REFERENCE_AUDIO_SEMITONES_MIN)
  .max(PRISM_REFERENCE_AUDIO_SEMITONES_MAX)
  .refine((n) => Number.isInteger(n / PRISM_REFERENCE_AUDIO_SEMITONES_STEP), { message: "in steps of 0.5 semitones" })

/** A resolution's `{ mode, semitones }` (absent semitones = 0). */
export const castSwapPrismReferenceAudioValueSchema = z.strictObject({
  mode: z.enum(CAST_SWAP_PRISM_REFERENCE_AUDIO_MODES),
  semitones: castSwapPrismReferenceAudioSemitonesSchema.optional(),
})

/** One resolution in any form, parsed to how it is stored. */
const storedValueSchema = z
  .union([castSwapPrismReferenceAudioIdSchema, castSwapPrismReferenceAudioValueSchema])
  .transform((v): CastSwapPrismReferenceAudioStoredValue => (typeof v === "string" ? v : prismReferenceAudioStoredOf(v)))

const byResolutionSchema = z.strictObject({
  "480p": storedValueSchema.optional(),
  "720p": storedValueSchema.optional(),
  "1080p": storedValueSchema.optional(),
} satisfies Record<CastSwapPrismResolution, unknown>)

/** One id for every resolution: how a plain string from before the per-resolution setting reads. */
function everyResolution(id: CastSwapPrismReferenceAudioId): CastSwapPrismReferenceAudio {
  return Object.fromEntries(CAST_SWAP_PRISM_RESOLUTIONS.map((r) => [r, id])) as CastSwapPrismReferenceAudio
}

/**
 * The setting as a write takes it: the per-resolution object, each resolution
 * an id or `{ mode, semitones }`, or a plain id (an earlier value, or an
 * earlier client), which reads as that id at every resolution. Parses to the
 * object AS STORED (`prismReferenceAudioStoredOf`): every value an id says
 * as that id, so a setting from before the two controls is stored exactly as
 * it was.
 */
export const castSwapPrismReferenceAudioSchema = z.union([byResolutionSchema, castSwapPrismReferenceAudioIdSchema.transform(everyResolution)])

/** The `app_settings` row of the direct runs' Prism reference audio: the per-resolution object as stored (a plain id from earlier reads as every resolution). */
export const NODARO_MOTION_PRISM_REFERENCE_AUDIO_KEY = "nodaro_motion_prism_reference_audio"

/** A stored setting as read: each resolution's value. */
export function prismReferenceAudioChoiceOf(stored: CastSwapPrismReferenceAudio | null | undefined): CastSwapPrismReferenceAudioChoice | null {
  if (!stored) return null
  const choice: CastSwapPrismReferenceAudioChoice = {}
  for (const r of CAST_SWAP_PRISM_RESOLUTIONS) {
    const s = stored[r]
    if (s !== undefined) choice[r] = valueOfStored(s)
  }
  return choice
}

/**
 * The tolerant read of a stored value (the app setting, a trend's, or a body
 * composed or shaped from one): each resolution's value, a plain id as that id
 * at every resolution, else null (never saved, or a value this app does not
 * know: the default).
 */
export function prismReferenceAudioByResolutionOf(value: unknown): CastSwapPrismReferenceAudioChoice | null {
  const parsed = castSwapPrismReferenceAudioSchema.safeParse(value)
  return parsed.success ? prismReferenceAudioChoiceOf(parsed.data) : null
}

/** The tolerant read of the stored `nodaro_motion_prism_reference_audio` row, as stored (`castSwapPrismReferenceAudioSchema`), else null. */
export function parseNodaroMotionPrismReferenceAudio(value: unknown): CastSwapPrismReferenceAudio | null {
  const parsed = castSwapPrismReferenceAudioSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

/** The resolutions off the default, as stored, or undefined when every one is the default. */
export function prismReferenceAudioNotDefault(choice: CastSwapPrismReferenceAudioChoice | null | undefined): CastSwapPrismReferenceAudio | undefined {
  if (!choice) return undefined
  const kept: CastSwapPrismReferenceAudio = {}
  for (const r of CAST_SWAP_PRISM_RESOLUTIONS) {
    const value = choice[r]
    if (value !== undefined && !isDefaultPrismReferenceAudio(value)) kept[r] = prismReferenceAudioStoredOf(value)
  }
  return Object.keys(kept).length > 0 ? kept : undefined
}

/**
 * The resolutions of `next` whose value is not what `before` holds there, as
 * they read now (a resolution left out on either side is the default, so a
 * value taken back to the default counts, as itself): how a save tells what it
 * changed, however each side is written. Empty = nothing changed.
 */
export function prismReferenceAudioChangedFrom(
  next: CastSwapPrismReferenceAudioChoice | null | undefined,
  before: CastSwapPrismReferenceAudioChoice | null | undefined,
): CastSwapPrismReferenceAudioChoice {
  const stored = (value: CastSwapPrismReferenceAudioValue | undefined) => JSON.stringify(prismReferenceAudioStoredOf(value ?? CAST_SWAP_PRISM_REFERENCE_AUDIO_DEFAULT))
  const changed: CastSwapPrismReferenceAudioChoice = {}
  for (const r of CAST_SWAP_PRISM_RESOLUTIONS) {
    if (stored(next?.[r]) !== stored(before?.[r])) changed[r] = next?.[r] ?? CAST_SWAP_PRISM_REFERENCE_AUDIO_DEFAULT
  }
  return changed
}

/** Whether the loaded Cast Swap engine takes an id per output resolution (`castSwap.prismReferenceAudioPerResolution`). */
export function engineTakesPrismReferenceAudioPerResolution(): boolean {
  return getPluginSupports().castSwap?.prismReferenceAudioPerResolution === true
}

/** Whether the loaded Cast Swap engine takes the object form, a mode and a pitch shift per resolution (`castSwap.prismReferenceAudioPitch`). */
export function engineTakesPrismReferenceAudioPitch(): boolean {
  return takesPitch(getPluginSupports().castSwap)
}

/** Whether the loaded Cast Swap engine takes a run's `prismReferenceAudio` in any shape. */
export function engineTakesPrismReferenceAudio(): boolean {
  const cs = getPluginSupports().castSwap
  return cs?.prismReferenceAudio === true || cs?.prismReferenceAudioPerResolution === true || takesPitch(cs)
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

/** A value on the object form: `{ mode: "none" }` for a silent reference (its pitch is never sent), else `{ mode, semitones }`. */
function pitchedWireOf(value: CastSwapPrismReferenceAudioValue): CastSwapPrismReferenceAudioValue {
  return value.mode === "none" ? { mode: "none" } : { mode: value.mode, semitones: semitonesOf(value) }
}

/**
 * What a Prism run at `resolution` is sent of `choice`, as the loaded engine
 * takes it (see the module comment): the object form of the values off the
 * default to an engine with the pitch shift; else the object of their ids to
 * a per-resolution engine, the run's own resolution's id to an engine that
 * takes one, or nothing — and nothing for the default. A value the engine
 * does not take is the default for it.
 */
export function prismReferenceAudioWire(
  choice: CastSwapPrismReferenceAudioChoice | null | undefined,
  resolution: CastSwapPrismResolution,
): CastSwapPrismReferenceAudioSent | undefined {
  const cs = getPluginSupports().castSwap
  const taken = (value: CastSwapPrismReferenceAudioValue | undefined): value is CastSwapPrismReferenceAudioValue =>
    value !== undefined && !isDefaultPrismReferenceAudio(value) && engineTakesPrismReferenceAudioValue(cs, value)
  if (takesPitch(cs)) {
    const sent: CastSwapPrismReferenceAudioPitchedSent = {}
    for (const r of CAST_SWAP_PRISM_RESOLUTIONS) {
      const value = choice?.[r]
      if (taken(value)) sent[r] = pitchedWireOf(value)
    }
    return Object.keys(sent).length > 0 ? sent : undefined
  }
  // Without the pitch shift: the id of a value the engine takes (never the default's: it is not sent).
  const idSent = (value: CastSwapPrismReferenceAudioValue | undefined): CastSwapPrismReferenceAudioIdSent | undefined =>
    taken(value) ? (prismReferenceAudioIdOf(value) as CastSwapPrismReferenceAudioIdSent) : undefined
  if (cs?.prismReferenceAudioPerResolution === true) {
    const sent: CastSwapPrismReferenceAudioByResolutionSent = {}
    for (const r of CAST_SWAP_PRISM_RESOLUTIONS) {
      const id = idSent(choice?.[r])
      if (id !== undefined) sent[r] = id
    }
    return Object.keys(sent).length > 0 ? sent : undefined
  }
  if (cs?.prismReferenceAudio !== true) return undefined
  return idSent(choice?.[resolution])
}

/**
 * What a direct run body (`engine` in any vocabulary, absent = Prism) is sent
 * of the stored setting: `{ prismReferenceAudio }` only on a Prism run whose
 * setting is not the default for what the loaded engine reads, else nothing.
 */
export function prismReferenceAudioSent(
  body: { engine?: unknown; resolution?: unknown; draft?: unknown; quality?: unknown },
  stored: CastSwapPrismReferenceAudio | null | undefined,
): { prismReferenceAudio?: CastSwapPrismReferenceAudioSent } {
  if (!isPrismRun(body.engine)) return {}
  const sent = prismReferenceAudioWire(prismReferenceAudioChoiceOf(stored), prismRunResolution(body))
  return sent === undefined ? {} : { prismReferenceAudio: sent }
}
