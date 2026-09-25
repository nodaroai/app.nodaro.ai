import { tx, type MessageKey } from "@/lib/i18n"

export type TTSVoiceGender = "female" | "male" | "nonBinary"
export type TTSVoiceAccent = "american" | "british" | "australian" | "englishSwedish"

export interface TTSVoice {
  readonly id: string
  /** The voice's own name — a proper noun, the same in every language. */
  readonly name: string
  readonly gender: TTSVoiceGender
  readonly accent: TTSVoiceAccent
}

const GENDER_KEYS: Record<TTSVoiceGender, MessageKey> = {
  female: "audiocfg.female",
  male: "audiocfg.male",
  nonBinary: "voice.gender.nonBinary",
}

const ACCENT_KEYS: Record<TTSVoiceAccent, MessageKey> = {
  american: "voice.accent.american",
  british: "voice.accent.british",
  australian: "voice.accent.australian",
  englishSwedish: "voice.accent.englishSwedish",
}

/** "Rachel (Female, American)" in the interface language. */
export function ttsVoiceLabel(voice: TTSVoice): string {
  const qualifier = [tx(GENDER_KEYS[voice.gender]), tx(ACCENT_KEYS[voice.accent])].join(tx("common.listComma"))
  return tx("common.qualified", { token: voice.name, qualifier })
}

// Curated "premade" voice catalog for the TTS node — all text-to-speech
// requests route through the direct ElevenLabs API (never KIE), but this
// stays a fixed name list (plus Adam, Bella & Harry via their ElevenLabs
// UUIDs) so premade voices resolve consistently across turbo/multilingual/v3.
// Mirrors FALLBACK_VOICES in backend/src/routes/voices.ts — keep the two in step.
export const TTS_VOICES: readonly TTSVoice[] = [
  // Female voices
  { id: "Alice", name: "Alice", gender: "female", accent: "british" },
  { id: "Aria", name: "Aria", gender: "female", accent: "american" },
  { id: "hpp4J3VqNfWAUOO0d1Us", name: "Bella", gender: "female", accent: "american" },
  { id: "Charlotte", name: "Charlotte", gender: "female", accent: "englishSwedish" },
  { id: "Jessica", name: "Jessica", gender: "female", accent: "american" },
  { id: "Laura", name: "Laura", gender: "female", accent: "american" },
  { id: "Lily", name: "Lily", gender: "female", accent: "british" },
  { id: "Matilda", name: "Matilda", gender: "female", accent: "american" },
  { id: "Rachel", name: "Rachel", gender: "female", accent: "american" },
  { id: "Sarah", name: "Sarah", gender: "female", accent: "american" },

  // Male voices
  { id: "pNInz6obpgDQGcFmaJgB", name: "Adam", gender: "male", accent: "american" },
  { id: "Bill", name: "Bill", gender: "male", accent: "american" },
  { id: "Brian", name: "Brian", gender: "male", accent: "american" },
  { id: "Callum", name: "Callum", gender: "male", accent: "american" },
  { id: "Charlie", name: "Charlie", gender: "male", accent: "australian" },
  { id: "Chris", name: "Chris", gender: "male", accent: "american" },
  { id: "Daniel", name: "Daniel", gender: "male", accent: "british" },
  { id: "Eric", name: "Eric", gender: "male", accent: "american" },
  { id: "George", name: "George", gender: "male", accent: "british" },
  { id: "SOYHLrjzK2X1ezoPC6cr", name: "Harry", gender: "male", accent: "american" },
  { id: "Liam", name: "Liam", gender: "male", accent: "american" },
  { id: "Roger", name: "Roger", gender: "male", accent: "american" },
  { id: "Will", name: "Will", gender: "male", accent: "american" },

  // Non-binary voices
  { id: "River", name: "River", gender: "nonBinary", accent: "american" },
]

export const DEFAULT_DIALOGUE_VOICE = "Sarah"

export function getVoiceName(
  voiceId: string,
  dynamicVoices?: readonly { voice_id: string; name: string }[],
): string {
  // Try dynamic voices by voice_id (UUID) first
  if (dynamicVoices) {
    const byId = dynamicVoices.find((v) => v.voice_id === voiceId)
    if (byId) return byId.name
    // Fallback: match by name (backward compat for legacy voice names)
    const byName = dynamicVoices.find((v) => v.name === voiceId)
    if (byName) return byName.name
  }
  // Fall back to static list
  const known = TTS_VOICES.find((v) => v.id === voiceId)
  return known ? ttsVoiceLabel(known) : voiceId || "Rachel"
}
