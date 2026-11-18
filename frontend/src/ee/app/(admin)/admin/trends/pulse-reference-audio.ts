// The Pulse reference audio as the admin screens read and write it: per
// output resolution of a Nodaro Pulse (Kling 4) run, what audio the clip sent
// to the video model carries — Prism's modes and pitch shift (-24 to 24 in
// steps of 0.5). It is "audio in" only: what the result carries stays the
// Pulse audio's choice ("audio out", PulseAudioSelect.tsx), in any combination.
//
// A resolution left out follows the Pulse audio in effect (decided
// 2026-11-18): the full mix at +4 with the original audio, the full mix at 0
// with Kling's audio, which is what every run sent before the setting. So the
// stored object holds only the resolutions off that default, and nothing at
// all when none are; a screen shows a resolution left out as the default of
// the Pulse audio it shows beside it. Every value is `{ mode, semitones }`
// (`{ mode: "none" }` for a silent one): there are no ids. The server reads
// and writes it the same way (backend/src/lib/cast-swap-pulse-reference-audio.ts).

import { CAST_SWAP_RESOLUTIONS_BY_ENGINE } from "@nodaro/shared/models"
import type {
  CastSwapPrismReferenceAudioMode,
  CastSwapPulseAudioId,
  CastSwapPulseReferenceAudioByResolution,
  CastSwapPulseReferenceAudioValue,
  CastSwapPulseResolution,
  TrendEngineEnvironment,
} from "@/lib/api"
import { SHARED_SETTING_ENVIRONMENTS } from "./clip-preparation"
import { PRISM_REFERENCE_AUDIO_MODES, PRISM_REFERENCE_AUDIO_MODE_LABELS, PRISM_REFERENCE_AUDIO_SEMITONES, type PrismReferenceAudioFormValue } from "./prism-reference-audio"

/** The resolutions a Pulse run renders, in the order the screens show them. */
export const PULSE_RESOLUTIONS: readonly CastSwapPulseResolution[] = CAST_SWAP_RESOLUTIONS_BY_ENGINE["kling-4"]

/** One resolution as the screens edit it: a mode and its pitch shift (kept on "No audio", which ignores it, for the next mode). */
export type PulseReferenceAudioFormValue = PrismReferenceAudioFormValue

/** The Pulse audio a screen reads when none is set (the original audio back on the result). */
const DEFAULT_OUT: CastSwapPulseAudioId = "original"

/** A resolution left out, for the Pulse audio in effect: the full mix at +4 with the original audio, at 0 with Kling's audio. */
export function pulseReferenceAudioDefault(out: CastSwapPulseAudioId | null | undefined): PulseReferenceAudioFormValue {
  return (out ?? DEFAULT_OUT) === "generated" ? { mode: "full", semitones: 0 } : { mode: "full", semitones: 4 }
}

/**
 * The pitch shift a mode starts at when an admin picks it: 0 for the one-tone
 * modes (as Prism's), the default's for the others (+4 with the original
 * audio, 0 with Kling's audio).
 */
export function pulseReferenceAudioDefaultSemitones(mode: CastSwapPrismReferenceAudioMode, out: CastSwapPulseAudioId | null | undefined): number {
  return mode === "full-one-tone" || mode === "voice-one-tone" ? 0 : pulseReferenceAudioDefault(out).semitones
}

/**
 * A resolution switched to `mode`. Its pitch shift moves to the new mode's
 * default (`pulseReferenceAudioDefaultSemitones`) unless it is the admin's own:
 * typed here (`typed`), or off its mode's default as it came. No audio keeps
 * the pitch it was given, for the next mode.
 */
export function pulseReferenceAudioSwitchMode(
  cur: PulseReferenceAudioFormValue,
  mode: CastSwapPrismReferenceAudioMode,
  typed: boolean,
  out: CastSwapPulseAudioId | null | undefined,
): { readonly value: PulseReferenceAudioFormValue; readonly own: boolean } {
  const own = typed || (cur.mode !== "none" && cur.semitones !== pulseReferenceAudioDefaultSemitones(cur.mode, out))
  return { value: { mode, semitones: own || mode === "none" ? cur.semitones : pulseReferenceAudioDefaultSemitones(mode, out) }, own }
}

function isMode(v: unknown): v is CastSwapPrismReferenceAudioMode {
  return typeof v === "string" && (PRISM_REFERENCE_AUDIO_MODES as readonly string[]).includes(v)
}

/** Whether `n` is a pitch shift the server takes: -24 to 24, in steps of 0.5. */
function isSemitones(n: unknown): n is number {
  const { min, max, step } = PRISM_REFERENCE_AUDIO_SEMITONES
  return typeof n === "number" && Number.isFinite(n) && n >= min && n <= max && Number.isInteger(n / step)
}

/** One resolution's stored (or edited) value as `{ mode, semitones }` (none on "none"), or undefined (a value this screen does not know). */
function valueOf(x: unknown): CastSwapPulseReferenceAudioValue | undefined {
  if (!x || typeof x !== "object" || Array.isArray(x)) return undefined
  const { mode, semitones } = x as { mode?: unknown; semitones?: unknown }
  if (!isMode(mode)) return undefined
  if (mode === "none") return { mode }
  // Absent semitones are 0 (no pitch step).
  if (semitones === undefined) return { mode, semitones: 0 }
  return isSemitones(semitones) ? { mode, semitones } : undefined
}

/**
 * A stored (or edited) value as the screens hold it: its known resolutions
 * with a value this screen knows, each as `{ mode, semitones }` (`{ mode: "none" }`
 * silent), in resolution order. Nothing set (null, undefined, anything else)
 * is `{}`: every resolution follows the Pulse audio.
 */
export function pulseReferenceAudioOf(value: unknown): CastSwapPulseReferenceAudioByResolution {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  const rec = value as Record<string, unknown>
  const out: CastSwapPulseReferenceAudioByResolution = {}
  for (const r of PULSE_RESOLUTIONS) {
    const v = valueOf(rec[r])
    if (v) out[r] = v
  }
  return out
}

/** One resolution as the screens edit it: its value, else the default of the Pulse audio in effect. */
function formValueAt(value: CastSwapPulseReferenceAudioByResolution, r: CastSwapPulseResolution, out: CastSwapPulseAudioId | null | undefined): PulseReferenceAudioFormValue {
  const v = value[r]
  if (!v) return pulseReferenceAudioDefault(out)
  // "No audio" keeps the default pitch shift for the next mode.
  return { mode: v.mode, semitones: v.mode === "none" ? pulseReferenceAudioDefault(out).semitones : (v.semitones ?? 0) }
}

/** Every resolution as the screens edit it, the default of the Pulse audio in effect where none is set. */
export type PulseReferenceAudioPair = Readonly<Record<CastSwapPulseResolution, PulseReferenceAudioFormValue>>

/** Every resolution's mode and pitch shift (`pulseReferenceAudioDefault(out)` where none is set). */
export function pulseReferenceAudioPair(value: unknown, out: CastSwapPulseAudioId | null | undefined): PulseReferenceAudioPair {
  const v = pulseReferenceAudioOf(value)
  return Object.fromEntries(PULSE_RESOLUTIONS.map((r) => [r, formValueAt(v, r, out)])) as PulseReferenceAudioPair
}

/** A value as stored and saved: `{ mode, semitones }`, or `{ mode: "none" }`. */
export function pulseReferenceAudioStoredOf(value: PulseReferenceAudioFormValue): CastSwapPulseReferenceAudioValue {
  return value.mode === "none" ? { mode: "none" } : { mode: value.mode, semitones: value.semitones }
}

/** Whether a value is the default of the Pulse audio in effect (`{ mode: "none" }` never is). */
export function pulseReferenceAudioIsDefault(value: Readonly<CastSwapPulseReferenceAudioValue>, out: CastSwapPulseAudioId | null | undefined): boolean {
  const d = pulseReferenceAudioDefault(out)
  return value.mode === d.mode && (value.semitones ?? 0) === d.semitones
}

/**
 * Only the resolutions off the default of the Pulse audio in effect, as
 * saved, in resolution order; undefined when every one is the default (no
 * key at all).
 */
export function pulseReferenceAudioNotDefault(value: unknown, out: CastSwapPulseAudioId | null | undefined): CastSwapPulseReferenceAudioByResolution | undefined {
  const v = pulseReferenceAudioOf(value)
  const saved: CastSwapPulseReferenceAudioByResolution = {}
  for (const r of PULSE_RESOLUTIONS) {
    const at = v[r]
    if (at && !pulseReferenceAudioIsDefault(at, out)) saved[r] = pulseReferenceAudioStoredOf(formValueAt(v, r, out))
  }
  return Object.keys(saved).length > 0 ? saved : undefined
}

/** What Admin → Video Remake's Save sends, and what tells a change: the resolutions off the default, `{}` when none are. */
export function pulseReferenceAudioSaved(value: unknown, out: CastSwapPulseAudioId | null | undefined): CastSwapPulseReferenceAudioByResolution {
  return pulseReferenceAudioNotDefault(value, out) ?? {}
}

/**
 * The resolutions a save changes to a value off the default (the server's
 * `pulseReferenceAudioChangedFrom`): those whose stored form — off the default
 * of each side's own Pulse audio, `next` under `nextOut`, `before` under
 * `beforeOut` — is not what `before` stores there. Compared as stored, not as
 * it sounds; a resolution taken back to the default is not in it.
 */
export function pulseReferenceAudioChangedResolutions(
  next: unknown,
  nextOut: CastSwapPulseAudioId | null | undefined,
  before: unknown,
  beforeOut: CastSwapPulseAudioId | null | undefined,
): CastSwapPulseResolution[] {
  const kept = pulseReferenceAudioNotDefault(next, nextOut) ?? {}
  const was = pulseReferenceAudioNotDefault(before, beforeOut) ?? {}
  return PULSE_RESOLUTIONS.filter((r) => kept[r] !== undefined && JSON.stringify(kept[r]) !== JSON.stringify(was[r]))
}

/** A value in words ("Full mix at +7 semitones", "No audio"). */
export function describePulseReferenceAudio(value: PulseReferenceAudioFormValue): string {
  const label = PRISM_REFERENCE_AUDIO_MODE_LABELS[value.mode]
  if (value.mode === "none") return label
  return `${label} at ${value.semitones > 0 ? `+${value.semitones}` : value.semitones} semitones`
}

/** The environments as the screens read them, by the shared setting's names; unknown while they are. */
function envsByName(envs: readonly TrendEngineEnvironment[]) {
  return SHARED_SETTING_ENVIRONMENTS.map((name) => ({ name: name as string, env: envs.find((e) => e.env === name) }))
}

const engineTakes = (env: TrendEngineEnvironment | undefined) => env?.supports.castSwap?.pulseReferenceAudio === true
/** The server sends a platform's claim only while it is fresh. */
const platformTakes = (env: TrendEngineEnvironment | undefined) => env?.supports.platform?.pulseReferenceAudio === true

/**
 * Whether a value off the default may be chosen: EVERY environment's engine
 * declares `castSwap.pulseReferenceAudio` and its platform claims it (one
 * database: an older app would drop the key, and an older engine is never sent
 * it). Unknown while the environments are: no.
 */
export function pulseReferenceAudioOfferedEverywhere(envs: readonly TrendEngineEnvironment[] | undefined): boolean {
  return !!envs && envsByName(envs).every(({ env }) => engineTakes(env) && platformTakes(env))
}

/** What each environment lacks (of `SHARED_SETTING_ENVIRONMENTS`, in that order). */
export interface PulseReferenceAudioMissing {
  /** Whose engine does not declare `castSwap.pulseReferenceAudio`, or none recorded. */
  readonly engine: readonly string[]
  /** Whose platform does not claim it (an app from before it, or its heartbeat stopped), or none recorded. */
  readonly platform: readonly string[]
}

/** What is missing, for a screen to say; unknown while the environments are. */
export function pulseReferenceAudioMissing(envs: readonly TrendEngineEnvironment[] | undefined): PulseReferenceAudioMissing | undefined {
  if (!envs) return undefined
  const rows = envsByName(envs)
  return {
    engine: rows.filter(({ env }) => !engineTakes(env)).map(({ name }) => name),
    platform: rows.filter(({ env }) => !platformTakes(env)).map(({ name }) => name),
  }
}

/**
 * What a save holds of `next`, each as a sentence saying what is missing: a
 * resolution it CHANGED to a value off the default of `nextOut`
 * (`pulseReferenceAudioChangedResolutions`), while not every environment takes it (the
 * server's 422 `platform_unsupported` / 409 `engine_unsupported`). What it
 * leaves as it ran is never a reason. With the environments unknown it says so
 * (`envsUnreadable`: their read failed) and names none.
 */
export function pulseReferenceAudioHeldIssues(
  next: unknown,
  nextOut: CastSwapPulseAudioId | null | undefined,
  before: unknown,
  beforeOut: CastSwapPulseAudioId | null | undefined,
  envs: readonly TrendEngineEnvironment[] | undefined,
  { envsUnreadable = false }: { readonly envsUnreadable?: boolean } = {},
): string[] {
  if (pulseReferenceAudioOfferedEverywhere(envs)) return []
  const pair = pulseReferenceAudioPair(next, nextOut)
  const missing = pulseReferenceAudioMissing(envs)
  return pulseReferenceAudioChangedResolutions(next, nextOut, before, beforeOut).map((r) => {
    const opening = `Pulse reference audio, ${r}: ${describePulseReferenceAudio(pair[r])} cannot be saved yet:`
    if (!missing) return `${opening} the environments ${envsUnreadable ? "could not be read" : "are still loading"}.`
    const reasons = [
      ...(missing.engine.length > 0 ? [`the Cast Swap engine of ${missing.engine.join(", ")} cannot take it`] : []),
      ...(missing.platform.length > 0 ? [`the platform in ${missing.platform.join(", ")} does not take it`] : []),
    ]
    return `${opening} ${reasons.join(", and ")}.`
  })
}
