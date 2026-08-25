import { runtimeSurfaceProfile } from "./surface-profile.js"
import { FALLBACK_VOICES } from "./premade-voices.js"

/**
 * Voice-gender policy (B4c). A DATA seam: the allowed genders live on the B1
 * SurfaceProfile (`voice.allowedGenders`), ride the /config.js channel, and are
 * read backend-authoritatively here. `[]` = no restriction (B1 narrowing
 * contract). Community ignores the profile (surfaceGateOpen), so this is inert
 * there. ONE normalizer maps the codebase's inconsistent gender vocabulary
 * (voices.ts "neutral", voice-matcher.ts "non-binary", free-form ElevenLabs
 * labels) to three tokens — nothing else should string-match gender.
 */
export type VoiceGender = "male" | "female" | "neutral"

export function normalizeVoiceGender(raw: string | undefined | null): VoiceGender {
  const v = (raw ?? "").trim().toLowerCase()
  if (v === "male") return "male"
  if (v === "female") return "female"
  return "neutral"
}

export function allowedVoiceGenders(): VoiceGender[] {
  return runtimeSurfaceProfile().voice.allowedGenders.map(normalizeVoiceGender)
}

export function isVoiceGenderAllowed(raw: string | undefined | null): boolean {
  const allowed = allowedVoiceGenders()
  if (allowed.length === 0) return true
  return allowed.includes(normalizeVoiceGender(raw))
}

/**
 * Premade-voice gender by NAME or voice_id; `undefined` for a non-premade or
 * unknown voice (custom clones / library imports have no catalog row). The ONE
 * premade-gender lookup shared by the two enforcement seams — the direct
 * `/v1/text-to-speech` route and the orchestrator/worker dispatch backstop
 * (payload-builder) — so the gender an install allows is judged identically at
 * both, with no drift.
 */
export function premadeVoiceGender(voice: string | undefined): string | undefined {
  if (!voice) return undefined
  const hit = FALLBACK_VOICES.find((v) => v.name === voice || v.voice_id === voice)
  return hit?.gender
}

export function filterVoicesByAllowedGender<T extends { gender?: string }>(voices: readonly T[]): T[] {
  const allowed = allowedVoiceGenders()
  if (allowed.length === 0) return [...voices]
  return voices.filter((v) => allowed.includes(normalizeVoiceGender(v.gender)))
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
  const pick = catalog.find((v) => allowed.includes(normalizeVoiceGender(v.gender)))
  return pick ? pick.name : fallbackId
}
