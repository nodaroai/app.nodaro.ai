import { runtimeSurfaceProfile } from "./surface-profile.js"
import { FALLBACK_VOICES, PREMADE_VOICE_IDS } from "./premade-voices.js"
import { DeterministicJobError } from "./deterministic-job-error.js"

/**
 * Voice-gender policy (B4c). A DATA seam: the allowed genders live on the B1
 * SurfaceProfile (`voice.allowedGenders`), ride the /config.js channel, and are
 * read backend-authoritatively here. `[]` = no restriction (B1 narrowing
 * contract). Community ignores the profile (surfaceGateOpen), so this is inert
 * there. ONE normalizer maps the codebase's inconsistent gender vocabulary
 * (voices.ts "neutral", voice-matcher.ts "non-binary", free-form ElevenLabs
 * labels) to three tokens — nothing else should string-match gender.
 *
 * Under a lock (a non-empty `voice.allowedGenders`) a voice is allowed only
 * when its gender is KNOWN and allowed. `knownVoiceGender` keeps a missing or
 * unrecognised label apart from "neutral", so a lock that allows neutral never
 * admits a voice nobody can vouch for. This module is synchronous and pure:
 * the lookups that establish a non-premade voice's gender (the caller's clone
 * row, the library record) are `lib/voice-gender.ts`.
 */
export type VoiceGender = "male" | "female" | "neutral"

/** The code every refusal of a voice under the lock answers with. */
export const VOICE_NOT_AVAILABLE_CODE = "voice_not_available"

/** What a refused voice answers, wherever it is refused (a route's 400, a plugin's `PluginHttpError`, a failed job). */
export const VOICE_NOT_AVAILABLE_MESSAGE = "The selected voice is not available on this deployment."

export function voiceNotAvailableBody(message: string = VOICE_NOT_AVAILABLE_MESSAGE): {
  error: { code: typeof VOICE_NOT_AVAILABLE_CODE; message: string }
} {
  return { error: { code: VOICE_NOT_AVAILABLE_CODE, message } }
}

export function normalizeVoiceGender(raw: string | undefined | null): VoiceGender {
  const v = (raw ?? "").trim().toLowerCase()
  if (v === "male") return "male"
  if (v === "female") return "female"
  return "neutral"
}

/**
 * The gender a label states, or `undefined` when it states none this policy
 * recognises (missing, empty, free text). Unlike `normalizeVoiceGender`, which
 * reads anything else as neutral, this is what the lock judges by.
 */
export function knownVoiceGender(raw: string | undefined | null): VoiceGender | undefined {
  const v = (raw ?? "").trim().toLowerCase()
  if (v === "male") return "male"
  if (v === "female") return "female"
  if (v === "neutral" || v === "non-binary" || v === "nonbinary" || v === "non binary") return "neutral"
  return undefined
}

export function allowedVoiceGenders(): VoiceGender[] {
  return runtimeSurfaceProfile().voice.allowedGenders.map(normalizeVoiceGender)
}

/** True when the deployment restricts voice genders. Read at call time. */
export function voiceLockActive(): boolean {
  return allowedVoiceGenders().length > 0
}

export function isVoiceGenderAllowed(raw: string | undefined | null): boolean {
  const allowed = allowedVoiceGenders()
  if (allowed.length === 0) return true
  const g = knownVoiceGender(raw)
  return g !== undefined && allowed.includes(g)
}

/** Premade voice name for a premade voice's ElevenLabs id (the map read backwards). */
const PREMADE_NAME_BY_ID: ReadonlyMap<string, string> = new Map(
  Object.entries(PREMADE_VOICE_IDS).map(([name, id]) => [id, name]),
)

/**
 * The premade catalog's gender for a premade voice addressed by its NAME or by
 * its ElevenLabs id; `undefined` for any other voice (a clone, a library voice,
 * an unknown id). The catalog stores most voices by name, so the id is mapped
 * back through `PREMADE_VOICE_IDS` first: a premade voice sent by its id is
 * judged exactly like one sent by its name.
 */
export function premadeCatalogGender(voice: string | undefined | null): VoiceGender | undefined {
  if (!voice) return undefined
  const name = PREMADE_NAME_BY_ID.get(voice) ?? voice
  const hit = FALLBACK_VOICES.find((v) => v.name === name || v.voice_id === voice)
  return hit ? knownVoiceGender(hit.gender) : undefined
}

export function filterVoicesByAllowedGender<T extends { gender?: string | null }>(voices: readonly T[]): T[] {
  const allowed = allowedVoiceGenders()
  if (allowed.length === 0) return [...voices]
  return voices.filter((v) => {
    const g = knownVoiceGender(v.gender)
    return g !== undefined && allowed.includes(g)
  })
}

/**
 * The outbound `gender` query for the ElevenLabs shared-voices library. The
 * client value is ADVISORY: when the deployment restricts to exactly one gender
 * we force it (the fork's "forced gender rather than trusting the client"
 * detail); to several, a disallowed client request is dropped to undefined; when
 * unrestricted, pass the client value through. Response voices are ALSO
 * post-filtered by the caller — never trust the provider to honor the param.
 */
export function clampLibraryGender(clientGender: string | undefined): string | undefined {
  const allowed = allowedVoiceGenders()
  if (allowed.length === 0) return clientGender
  if (allowed.length === 1) return allowed[0]
  return clientGender && allowed.includes(normalizeVoiceGender(clientGender)) ? clientGender : undefined
}

export function defaultAllowedVoiceId<T extends { voice_id: string; name: string; gender?: string }>(
  catalog: readonly T[],
  fallbackId: string,
): string {
  const allowed = allowedVoiceGenders()
  if (allowed.length === 0) return fallbackId
  const pick = catalog.find((v) => {
    const g = knownVoiceGender(v.gender)
    return g !== undefined && allowed.includes(g)
  })
  return pick ? pick.name : fallbackId
}

/** The lock's answer for one voice. A refusal says why, for logs and tests; the client sees one code. */
export type VoiceVerdict =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: "gender_not_allowed" | "gender_unknown" }

const ALLOWED: VoiceVerdict = Object.freeze({ allowed: true })

/** The lock's answer for a voice whose gender is `g` (undefined = nobody can vouch for it). */
export function judgeVoiceGender(g: VoiceGender | undefined): VoiceVerdict {
  const allowed = allowedVoiceGenders()
  if (allowed.length === 0) return ALLOWED
  if (g === undefined) return { allowed: false, reason: "gender_unknown" }
  return allowed.includes(g) ? ALLOWED : { allowed: false, reason: "gender_not_allowed" }
}

/**
 * The lock's answer for speech whose voices no request names: a dub speaks in
 * clones of its source's speakers, or in voices the dubbing service picks
 * itself, so none of them is a voice the platform can vouch for. Refused under
 * a lock (as a voice of unknown gender), allowed without one.
 */
export function judgeUnnamedVoices(): VoiceVerdict {
  return judgeVoiceGender(undefined)
}

/**
 * A voice the lock refused, for a lane with no reply to send (a speech worker,
 * a film-studio pipeline step, a plugin's `PluginHttpError` cause). `reason` is
 * for logs and tests; the client sees one code. A deterministic job error: the
 * same job is refused the same way on every attempt, so the video worker fails
 * and refunds it now instead of retrying it.
 */
export class VoiceNotAvailableError extends DeterministicJobError {
  readonly code = VOICE_NOT_AVAILABLE_CODE
  constructor(
    readonly reason: Extract<VoiceVerdict, { allowed: false }>["reason"],
    message: string = VOICE_NOT_AVAILABLE_MESSAGE,
  ) {
    super(message)
    this.name = "VoiceNotAvailableError"
  }
}

/**
 * The SYNCHRONOUS backstop, for a builder that cannot await a lookup (the
 * workflow engine's `buildPayload`). `resolved` is what the caller looked up
 * ahead of the build (`resolveVoiceGenders`, `lib/voice-gender.ts`); a voice it
 * does not cover is judged by the premade catalog alone. So, under a lock, a
 * voice nobody resolved that is not a premade voice is REFUSED: a caller that
 * skips the lookup fails closed, never open. Empty entries have nothing to
 * judge (the dispatch default voice is the policy's own). With no lock it is
 * always an allow.
 */
export function judgeResolvedVoices(
  voices: readonly string[],
  resolved: ReadonlyMap<string, VoiceGender | undefined> | undefined,
): VoiceVerdict {
  if (!voiceLockActive()) return ALLOWED
  for (const voice of voices) {
    if (!voice) continue
    const verdict = judgeVoiceGender(resolved?.has(voice) ? resolved.get(voice) : premadeCatalogGender(voice))
    if (!verdict.allowed) return verdict
  }
  return ALLOWED
}
