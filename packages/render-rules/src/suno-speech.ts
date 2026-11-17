/**
 * Suno Speech (decided 2026-11-17): what a run takes and what it sends — one
 * rule for the route, the workflow payload, the worker, the editor's panel and
 * its Run. Suno Speech performs spoken audio (tone, rhythm, emotion, optional
 * background music); it is not a fixed-voice text-to-speech.
 *
 * Two modes, whose provider fields are mutually exclusive:
 *   - Brief (`customMode: false`): a one-line scene description; the model
 *     writes the script and performs it. Sends `customMode` and `prompt` only.
 *   - Script (`customMode: true`): the words to speak, plus an optional tone,
 *     variety (0-4), voice gender and background music. Sends `customMode`,
 *     `script` and only the optional fields that are set.
 *
 * Limits are counted after trimming, as the provider counts them.
 */

export const SUNO_SPEECH_MODES = ["brief", "script"] as const
export type SunoSpeechMode = (typeof SUNO_SPEECH_MODES)[number]

/** A node or request that names no mode is a Brief run. */
export const DEFAULT_SUNO_SPEECH_MODE: SunoSpeechMode = "brief"

export const SUNO_SPEECH_LIMITS = {
  /** Brief: the scene description, 1-3,000 characters. */
  promptMax: 3000,
  /** Script: the words to speak, 1-5,000 characters (multiline). */
  scriptMax: 5000,
  /** Script: tone, rhythm, emotion and setting, 0-1,000 characters. */
  toneMax: 1000,
  /** Script: how far the two takes may differ, a whole number 0-4. */
  varietyMin: 0,
  varietyMax: 4,
} as const

/** The voice genders the node offers, in the platform's spelling (the provider takes `f` / `m`). */
export const SUNO_SPEECH_VOCAL_GENDERS = ["female", "male"] as const
export type SunoSpeechVocalGender = (typeof SUNO_SPEECH_VOCAL_GENDERS)[number]

/** What a Suno Speech run is asked for, as the node, the API and MCP spell it. */
export interface SunoSpeechSettings {
  readonly mode?: unknown
  readonly prompt?: unknown
  readonly script?: unknown
  readonly tone?: unknown
  readonly variety?: unknown
  readonly vocalGender?: unknown
  readonly backgroundMusic?: unknown
}

/** A run's settings, normalized: what every lane sends on. */
export interface SunoSpeechRun {
  readonly mode: SunoSpeechMode
  /** Brief only. */
  readonly prompt?: string
  /** Script only. */
  readonly script?: string
  readonly tone?: string
  readonly variety?: number
  readonly vocalGender?: SunoSpeechVocalGender
  readonly backgroundMusic?: boolean
}

function trimmed(v: unknown): string {
  return typeof v === "string" ? v.trim() : ""
}

/** The mode a value names; Brief for anything else. */
export function sunoSpeechMode(v: unknown): SunoSpeechMode {
  return v === "script" ? "script" : DEFAULT_SUNO_SPEECH_MODE
}

/** A variety the provider takes (a whole number 0-4), else none. */
export function sunoSpeechVariety(v: unknown): number | undefined {
  return typeof v === "number" && Number.isInteger(v) && v >= SUNO_SPEECH_LIMITS.varietyMin && v <= SUNO_SPEECH_LIMITS.varietyMax ? v : undefined
}

/** A voice gender the node offers, else none (the model picks). Also takes the provider's `f` / `m`. */
export function sunoSpeechVocalGender(v: unknown): SunoSpeechVocalGender | undefined {
  if (v === "female" || v === "f") return "female"
  if (v === "male" || v === "m") return "male"
  return undefined
}

/**
 * A run from its settings: the mode's own fields only, text trimmed, an
 * unusable variety or gender dropped. Never checks the limits — see
 * {@link sunoSpeechProblem}.
 */
export function sunoSpeechRun(s: SunoSpeechSettings): SunoSpeechRun {
  const mode = sunoSpeechMode(s.mode)
  if (mode === "brief") return { mode, prompt: trimmed(s.prompt) }
  const tone = trimmed(s.tone)
  const variety = sunoSpeechVariety(s.variety)
  const vocalGender = sunoSpeechVocalGender(s.vocalGender)
  return {
    mode,
    script: trimmed(s.script),
    ...(tone ? { tone } : {}),
    ...(variety !== undefined ? { variety } : {}),
    ...(vocalGender ? { vocalGender } : {}),
    ...(typeof s.backgroundMusic === "boolean" ? { backgroundMusic: s.backgroundMusic } : {}),
  }
}

/** Why a run cannot be sent (a sentence a person can act on), or undefined when it can. */
export function sunoSpeechProblem(run: SunoSpeechRun): string | undefined {
  if (run.mode === "brief") {
    const n = run.prompt?.length ?? 0
    if (n === 0) return "Suno Speech needs a brief: describe the scene in one line."
    if (n > SUNO_SPEECH_LIMITS.promptMax) return `The brief is ${n} characters; Suno Speech takes at most ${SUNO_SPEECH_LIMITS.promptMax}.`
    return undefined
  }
  const n = run.script?.length ?? 0
  if (n === 0) return "Suno Speech needs a script: write the words to speak."
  if (n > SUNO_SPEECH_LIMITS.scriptMax) return `The script is ${n} characters; Suno Speech takes at most ${SUNO_SPEECH_LIMITS.scriptMax}.`
  const t = run.tone?.length ?? 0
  if (t > SUNO_SPEECH_LIMITS.toneMax) return `The tone is ${t} characters; Suno Speech takes at most ${SUNO_SPEECH_LIMITS.toneMax}.`
  return undefined
}

/**
 * The provider's `input` for a run: an allow-list, never a spread. Brief sends
 * exactly `customMode: false` and `prompt`; Script sends `customMode: true`,
 * `script` and each optional field only when set, the gender as `f` / `m`.
 */
export function sunoSpeechProviderInput(run: SunoSpeechRun): Record<string, unknown> {
  if (run.mode === "brief") return { customMode: false, prompt: run.prompt ?? "" }
  return {
    customMode: true,
    script: run.script ?? "",
    ...(run.tone ? { tone: run.tone } : {}),
    ...(run.variety !== undefined ? { variety: run.variety } : {}),
    ...(run.vocalGender ? { vocalGender: run.vocalGender === "female" ? "f" : "m" } : {}),
    ...(run.backgroundMusic !== undefined ? { backgroundMusic: run.backgroundMusic } : {}),
  }
}
