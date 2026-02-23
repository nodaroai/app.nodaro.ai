export interface TTSVoice {
  readonly id: string
  readonly name: string
}

// Only voices supported by KIE.ai's ElevenLabs TTS endpoints.
// 21 voices accepted by name, plus Adam & Harry via their ElevenLabs UUIDs.
export const TTS_VOICES: readonly TTSVoice[] = [
  // Female voices
  { id: "Alice", name: "Alice (Female, British)" },
  { id: "Aria", name: "Aria (Female, American)" },
  { id: "Charlotte", name: "Charlotte (Female, English-Swedish)" },
  { id: "Jessica", name: "Jessica (Female, American)" },
  { id: "Laura", name: "Laura (Female, American)" },
  { id: "Lily", name: "Lily (Female, British)" },
  { id: "Matilda", name: "Matilda (Female, American)" },
  { id: "Rachel", name: "Rachel (Female, American)" },
  { id: "Sarah", name: "Sarah (Female, American)" },

  // Male voices
  { id: "pNInz6obpgDQGcFmaJgB", name: "Adam (Male, American)" },
  { id: "Bill", name: "Bill (Male, American)" },
  { id: "Brian", name: "Brian (Male, American)" },
  { id: "Callum", name: "Callum (Male, Transatlantic)" },
  { id: "Charlie", name: "Charlie (Male, Australian)" },
  { id: "Chris", name: "Chris (Male, American)" },
  { id: "Daniel", name: "Daniel (Male, British)" },
  { id: "Eric", name: "Eric (Male, American)" },
  { id: "George", name: "George (Male, British)" },
  { id: "SOYHLrjzK2X1ezoPC6cr", name: "Harry (Male, American)" },
  { id: "Liam", name: "Liam (Male, American)" },
  { id: "Roger", name: "Roger (Male, American)" },
  { id: "Will", name: "Will (Male, American)" },

  // Non-binary voices
  { id: "River", name: "River (Non-binary, American)" },
]

/**
 * Voices supported by the ElevenLabs text-to-dialogue-v3 API (via KIE.ai).
 * @deprecated No longer used for filtering — all voices are now available for dialogue.
 */
export const DIALOGUE_VOICE_IDS = new Set([
  "pNInz6obpgDQGcFmaJgB", "Alice", "Bill", "Brian", "Callum", "Charlie", "Chris",
  "Daniel", "Eric", "George", "SOYHLrjzK2X1ezoPC6cr", "Jessica", "Laura", "Liam",
  "Lily", "Matilda", "River", "Roger", "Sarah", "Will",
])

export const DIALOGUE_VOICES: readonly TTSVoice[] = TTS_VOICES.filter(
  (v) => DIALOGUE_VOICE_IDS.has(v.id),
)

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
  return TTS_VOICES.find((v) => v.id === voiceId)?.name ?? (voiceId || "Rachel")
}
