// The Prism reference audio as the admin screens read and write it: per
// output resolution a mode and a pitch shift in semitones, a resolution left
// out being the default (the full mix at +4). A resolution is stored, and
// saved, as one of today's ids where one says its value ("full", "voice",
// "none", "one-tone", "octave"), else as `{ mode, semitones }`; a value saved
// before the setting was per resolution is a plain id, meaning that id at
// every resolution. The server reads and writes it the same way
// (backend/src/lib/cast-swap-prism-reference-audio.ts).

import { CAST_SWAP_RESOLUTIONS_BY_ENGINE } from "@nodaro/shared/models"
import type {
  CastSwapPrismReferenceAudioByResolution,
  CastSwapPrismReferenceAudioId,
  CastSwapPrismReferenceAudioMode,
  CastSwapPrismReferenceAudioStored,
  CastSwapPrismReferenceAudioValue,
  TrendEngineEnvironment,
  TrendResolution,
} from "@/lib/api"
import { SHARED_SETTING_ENVIRONMENTS } from "./clip-preparation"

/** The resolutions a Prism run renders, in the order the screens show them (its 480p draft first). */
export const PRISM_RESOLUTIONS: readonly TrendResolution[] = CAST_SWAP_RESOLUTIONS_BY_ENGINE["seedance-2-5"]

/** The modes, in the order the screens offer them. */
export const PRISM_REFERENCE_AUDIO_MODES: readonly CastSwapPrismReferenceAudioMode[] = ["none", "full", "voice", "full-one-tone", "voice-one-tone"]

/** Each mode's name on screen. */
export const PRISM_REFERENCE_AUDIO_MODE_LABELS: Readonly<Record<CastSwapPrismReferenceAudioMode, string>> = {
  none: "No audio",
  full: "Full mix",
  voice: "Voice only",
  "full-one-tone": "Full mix, one tone",
  "voice-one-tone": "Voice only, one tone",
}

/** The ids a resolution held before it was a mode and a pitch shift. */
export const PRISM_REFERENCE_AUDIO_IDS: readonly CastSwapPrismReferenceAudioId[] = ["full", "voice", "none", "one-tone", "octave"]

/** The pitch shift: -24 to 24 semitones, in steps of 0.5; at 0 there is none. */
export const PRISM_REFERENCE_AUDIO_SEMITONES = { min: -24, max: 24, step: 0.5 } as const

/** One resolution as the screens edit it: a mode and its pitch shift (kept on "No audio", which ignores it, for the next mode). */
export interface PrismReferenceAudioFormValue {
  readonly mode: CastSwapPrismReferenceAudioMode
  readonly semitones: number
}

/** A resolution left out: the full mix at +4, as every run was before the setting. */
export const DEFAULT_PRISM_REFERENCE_AUDIO: PrismReferenceAudioFormValue = { mode: "full", semitones: 4 }

/**
 * The pitch shift a mode starts at when an admin picks it: 0 for the one-tone
 * modes (today's one-tone is unpitched), +4 for the others (today's full mix
 * and voice).
 */
export function prismReferenceAudioDefaultSemitones(mode: CastSwapPrismReferenceAudioMode): number {
  return mode === "full-one-tone" || mode === "voice-one-tone" ? 0 : DEFAULT_PRISM_REFERENCE_AUDIO.semitones
}

/**
 * A resolution switched to `mode`. Its pitch shift moves to the new mode's
 * default (`prismReferenceAudioDefaultSemitones`) unless it is the admin's own
 * (`own`): typed here (`typed`), or, while the pitch field is open (`pitchOpen`),
 * off its mode's default as it came (a value saved earlier, e.g. today's octave
 * at +12). With the field closed the next mode lands on what every environment
 * takes. No audio keeps the pitch it was given, for the next mode.
 */
export function prismReferenceAudioSwitchMode(
  cur: PrismReferenceAudioFormValue,
  mode: CastSwapPrismReferenceAudioMode,
  typed: boolean,
  pitchOpen: boolean,
): { readonly value: PrismReferenceAudioFormValue; readonly own: boolean } {
  const own = typed || (pitchOpen && cur.mode !== "none" && cur.semitones !== prismReferenceAudioDefaultSemitones(cur.mode))
  return { value: { mode, semitones: own || mode === "none" ? cur.semitones : prismReferenceAudioDefaultSemitones(mode) }, own }
}

/** What each id reads as: the value it always sounded like ("none" keeps the default pitch shift for the next mode). */
const VALUE_OF_ID: Readonly<Record<CastSwapPrismReferenceAudioId, PrismReferenceAudioFormValue>> = {
  full: DEFAULT_PRISM_REFERENCE_AUDIO,
  voice: { mode: "voice", semitones: 4 },
  "one-tone": { mode: "full-one-tone", semitones: 0 },
  octave: { mode: "full", semitones: 12 },
  none: { mode: "none", semitones: DEFAULT_PRISM_REFERENCE_AUDIO.semitones },
}

/** The ids only some engines list (`castSwap.prismReferenceAudioModes`; the server's `DECLARED_ONLY_PRISM_REFERENCE_AUDIO_IDS`). */
const DECLARED_ONLY_IDS: readonly CastSwapPrismReferenceAudioId[] = ["one-tone", "octave"]

/** The modes an engine with the pitch shift takes only when it lists them (the server's `DECLARED_ONLY_PRISM_REFERENCE_AUDIO_MODES`). */
const DECLARED_ONLY_MODES: readonly CastSwapPrismReferenceAudioMode[] = ["full-one-tone", "voice-one-tone"]

function isId(v: unknown): v is CastSwapPrismReferenceAudioId {
  return typeof v === "string" && (PRISM_REFERENCE_AUDIO_IDS as readonly string[]).includes(v)
}

function isMode(v: unknown): v is CastSwapPrismReferenceAudioMode {
  return typeof v === "string" && (PRISM_REFERENCE_AUDIO_MODES as readonly string[]).includes(v)
}

/** Whether `n` is a pitch shift the server takes: -24 to 24, in steps of 0.5. */
function isSemitones(n: unknown): n is number {
  const { min, max, step } = PRISM_REFERENCE_AUDIO_SEMITONES
  return typeof n === "number" && Number.isFinite(n) && n >= min && n <= max && Number.isInteger(n / step)
}

/** The id that says exactly this value, or undefined: only an engine that takes the pitch shift takes it. */
export function prismReferenceAudioIdOf(value: Readonly<CastSwapPrismReferenceAudioValue>): CastSwapPrismReferenceAudioId | undefined {
  if (value.mode === "none") return "none"
  const semitones = value.semitones ?? 0
  return PRISM_REFERENCE_AUDIO_IDS.find((id) => VALUE_OF_ID[id].mode === value.mode && VALUE_OF_ID[id].semitones === semitones)
}

/** A value as stored and saved: its id where one says it, else `{ mode, semitones }`. */
export function prismReferenceAudioStoredOf(value: PrismReferenceAudioFormValue): CastSwapPrismReferenceAudioStored {
  return prismReferenceAudioIdOf(value) ?? { mode: value.mode, semitones: value.semitones }
}

/** One resolution's stored (or edited) value as the screens edit it, or undefined (not set, or a value this screen does not know). */
function formValueOf(x: unknown): PrismReferenceAudioFormValue | undefined {
  if (isId(x)) return VALUE_OF_ID[x]
  if (!x || typeof x !== "object" || Array.isArray(x)) return undefined
  const { mode, semitones } = x as { mode?: unknown; semitones?: unknown }
  if (!isMode(mode)) return undefined
  // Absent semitones are 0 (no pitch step); "none" has none, and keeps the default for the next mode.
  if (semitones === undefined) return { mode, semitones: mode === "none" ? DEFAULT_PRISM_REFERENCE_AUDIO.semitones : 0 }
  return isSemitones(semitones) ? { mode, semitones } : undefined
}

/** A stored value's resolutions: a plain id at every resolution, an object as it is, else undefined. */
function perResolution(value: unknown): Readonly<Record<string, unknown>> | undefined {
  if (isId(value)) return Object.fromEntries(PRISM_RESOLUTIONS.map((r) => [r, value]))
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

/**
 * A stored value as the per-resolution object, as stored: a plain id as that
 * id at every resolution, an object's known resolutions with a value this
 * screen knows (each its id where one says it), else undefined (none set: the
 * default).
 */
export function prismReferenceAudioByResolutionOf(value: unknown): CastSwapPrismReferenceAudioByResolution | undefined {
  const rec = perResolution(value)
  if (!rec) return undefined
  const out: CastSwapPrismReferenceAudioByResolution = {}
  for (const r of PRISM_RESOLUTIONS) {
    const v = formValueOf(rec[r])
    if (v) out[r] = prismReferenceAudioStoredOf(v)
  }
  return out
}

/** Every resolution as the screens edit it, the default where none is set. */
export type PrismReferenceAudioTriple = Readonly<Record<TrendResolution, PrismReferenceAudioFormValue>>

/** Every resolution's mode and pitch shift (`DEFAULT_PRISM_REFERENCE_AUDIO` where none is set). */
export function prismReferenceAudioTriple(value: unknown): PrismReferenceAudioTriple {
  const rec = perResolution(value) ?? {}
  return Object.fromEntries(PRISM_RESOLUTIONS.map((r) => [r, formValueOf(rec[r]) ?? DEFAULT_PRISM_REFERENCE_AUDIO])) as PrismReferenceAudioTriple
}

/** Every resolution as saved (its id where one says it): what the shared setting's Save sends, and what tells a change. */
export function prismReferenceAudioSaved(value: unknown): Record<TrendResolution, CastSwapPrismReferenceAudioStored> {
  const triple = prismReferenceAudioTriple(value)
  return Object.fromEntries(PRISM_RESOLUTIONS.map((r) => [r, prismReferenceAudioStoredOf(triple[r])])) as Record<TrendResolution, CastSwapPrismReferenceAudioStored>
}

/** Only the resolutions off the default, as saved, in resolution order; undefined when every one is the default. */
export function prismReferenceAudioNotDefault(value: unknown): CastSwapPrismReferenceAudioByResolution | undefined {
  const saved = prismReferenceAudioSaved(value)
  const out: CastSwapPrismReferenceAudioByResolution = {}
  for (const r of PRISM_RESOLUTIONS) if (saved[r] !== "full") out[r] = saved[r]
  return Object.keys(out).length > 0 ? out : undefined
}

/** A value in words ("Full mix at +7 semitones", "No audio"). */
export function describePrismReferenceAudio(value: PrismReferenceAudioFormValue): string {
  const label = PRISM_REFERENCE_AUDIO_MODE_LABELS[value.mode]
  if (value.mode === "none") return label
  return `${label} at ${value.semitones > 0 ? `+${value.semitones}` : value.semitones} semitones`
}

type CastSwapSupports = TrendEngineEnvironment["supports"]["castSwap"]

function lists(cs: CastSwapSupports | undefined, name: string): boolean {
  return ((cs?.prismReferenceAudioModes ?? []) as readonly string[]).includes(name)
}

/**
 * Whether an environment's engine takes a value (the server's
 * `engineTakesPrismReferenceAudioValue`): the default always; with the pitch
 * shift (`castSwap.prismReferenceAudioPitch`), any value of a mode it takes (a
 * one-tone mode only where it lists it); without it, only a value an id says,
 * "one-tone" and "octave" only where it lists them.
 */
function engineTakes(cs: CastSwapSupports | undefined, value: Readonly<CastSwapPrismReferenceAudioValue>): boolean {
  const id = prismReferenceAudioIdOf(value)
  if (id === "full") return true
  if (cs?.prismReferenceAudioPitch === true) return !DECLARED_ONLY_MODES.includes(value.mode) || lists(cs, value.mode)
  return id !== undefined && (!DECLARED_ONLY_IDS.includes(id) || lists(cs, id))
}

/** Whether an environment's engine takes a mode at some pitch shift. */
function engineTakesMode(cs: CastSwapSupports | undefined, mode: CastSwapPrismReferenceAudioMode): boolean {
  if (mode === "full") return true
  if (cs?.prismReferenceAudioPitch === true) return !DECLARED_ONLY_MODES.includes(mode) || lists(cs, mode)
  return PRISM_REFERENCE_AUDIO_IDS.some((id) => VALUE_OF_ID[id].mode === mode && (!DECLARED_ONLY_IDS.includes(id) || lists(cs, id)))
}

/** Whether an environment's platform (the app itself) claims it reads a value no id says; the server sends a claim only while it is fresh. */
function platformTakes(env: TrendEngineEnvironment | undefined): boolean {
  return env?.supports.platform?.prismReferenceAudioPitch === true
}

/**
 * What a screen offers of what only some environments take: every environment
 * must, in Admin → Nodaro Motion's setting and a trend's editor alike (one
 * database: an older app cannot read a value no id says, and an engine that
 * does not take a value is sent the full audio). Everything else is every
 * engine's.
 */
export interface PrismReferenceAudioOffer {
  /** Whether a mode may be chosen (at some pitch shift). */
  readonly mode: (mode: CastSwapPrismReferenceAudioMode) => boolean
  /** Whether a resolution's value may be saved as it is (absent semitones = 0). */
  readonly value: (value: Readonly<CastSwapPrismReferenceAudioValue>) => boolean
  /** Whether the pitch field is open: every environment's engine flag and platform claim. */
  readonly pitch: boolean
}

/** The environments as the screens read them, by the shared setting's names; unknown while they are. */
function envsByName(envs: readonly TrendEngineEnvironment[] | undefined) {
  return SHARED_SETTING_ENVIRONMENTS.map((name) => ({ name, env: envs?.find((e) => e.env === name) }))
}

/**
 * What every environment takes (of `SHARED_SETTING_ENVIRONMENTS`; the server
 * refuses the save otherwise: 422 `platform_unsupported`, 409
 * `engine_unsupported`). A value no id says needs each engine's take AND each
 * platform's claim; one an id says, the engine's alone. Unknown while the
 * environments are: only what every engine takes.
 */
export function prismReferenceAudioOfferOfEvery(envs: readonly TrendEngineEnvironment[] | undefined): PrismReferenceAudioOffer {
  const known = envs ? envsByName(envs) : undefined
  const takes = (value: Readonly<CastSwapPrismReferenceAudioValue>) =>
    engineTakes(undefined, value) ||
    (!!known && known.every(({ env }) => engineTakes(env?.supports.castSwap, value) && (prismReferenceAudioIdOf(value) !== undefined || platformTakes(env))))
  return {
    // Voice only, one tone has no id at any pitch shift: it needs the claim too.
    mode: (m) =>
      engineTakesMode(undefined, m) || (!!known && known.every(({ env }) => engineTakesMode(env?.supports.castSwap, m) && (m !== "voice-one-tone" || platformTakes(env)))),
    value: takes,
    pitch: !!known && known.every(({ env }) => env?.supports.castSwap?.prismReferenceAudioPitch === true && platformTakes(env)),
  }
}

/** What each environment lacks of what only some take, by what it lacks (of `SHARED_SETTING_ENVIRONMENTS`, in that order). */
export interface PrismReferenceAudioMissing {
  /** Whose engine does not declare the pitch shift (`castSwap.prismReferenceAudioPitch`), or none recorded. */
  readonly engine: readonly string[]
  /** Whose platform does not claim it (`supports.platform`: an app from before it, or its heartbeat stopped), or none recorded. */
  readonly platform: readonly string[]
  /** For each one-tone mode, whose engine cannot take it at any pitch shift. */
  readonly modes: Readonly<Record<"full-one-tone" | "voice-one-tone", readonly string[]>>
}

/** What is missing, for a screen to say; unknown while the environments are. */
export function prismReferenceAudioMissing(envs: readonly TrendEngineEnvironment[] | undefined): PrismReferenceAudioMissing | undefined {
  if (!envs) return undefined
  const rows = envsByName(envs)
  const lacking = (test: (env: TrendEngineEnvironment | undefined) => boolean) => rows.filter(({ env }) => !test(env)).map(({ name }) => name as string)
  return {
    engine: lacking((env) => env?.supports.castSwap?.prismReferenceAudioPitch === true),
    platform: lacking(platformTakes),
    modes: {
      "full-one-tone": lacking((env) => engineTakesMode(env?.supports.castSwap, "full-one-tone")),
      "voice-one-tone": lacking((env) => engineTakesMode(env?.supports.castSwap, "voice-one-tone")),
    },
  }
}

/**
 * What a save holds of `next`, each as a sentence saying what is missing: a
 * resolution it CHANGED from `before` to what not every environment takes. What
 * it leaves as stored is never a reason (the server's rule, however each side
 * is written). `idsToo: false` for a trend's draft, where the server never
 * refuses a value an id says (its publish does). With the environments unknown
 * it says so (`envsUnreadable`: their read failed) and names none: nothing is
 * known of what any of them lacks.
 */
export function prismReferenceAudioHeldIssues(
  next: unknown,
  before: unknown,
  envs: readonly TrendEngineEnvironment[] | undefined,
  { idsToo = true, envsUnreadable = false }: { readonly idsToo?: boolean; readonly envsUnreadable?: boolean } = {},
): string[] {
  const offer = prismReferenceAudioOfferOfEvery(envs)
  const rows = envsByName(envs)
  const now = prismReferenceAudioSaved(next)
  const then = prismReferenceAudioSaved(before)
  const triple = prismReferenceAudioTriple(next)
  return PRISM_RESOLUTIONS.filter((r) => {
    const v = triple[r]
    return JSON.stringify(now[r]) !== JSON.stringify(then[r]) && !offer.value(v) && (idsToo || prismReferenceAudioIdOf(v) === undefined)
  }).map((r) => {
    const v = triple[r]
    const opening = `Prism reference audio, ${r}: ${describePrismReferenceAudio(v)} cannot be saved yet:`
    if (!envs) return `${opening} the environments ${envsUnreadable ? "could not be read" : "are still loading"}.`
    const engines = rows.filter(({ env }) => !engineTakes(env?.supports.castSwap, v)).map(({ name }) => name)
    const platforms = prismReferenceAudioIdOf(v) === undefined ? rows.filter(({ env }) => !platformTakes(env)).map(({ name }) => name) : []
    const missing = [
      ...(engines.length > 0 ? [`the Cast Swap engine of ${engines.join(", ")} cannot take it`] : []),
      ...(platforms.length > 0 ? [`the platform in ${platforms.join(", ")} does not take it`] : []),
    ]
    return `${opening} ${missing.join(", and ")}.`
  })
}
