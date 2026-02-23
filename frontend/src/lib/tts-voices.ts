export interface TTSVoice {
  readonly id: string
  readonly name: string
}

export const TTS_VOICES: readonly TTSVoice[] = [
  // Female voices
  { id: "Alice", name: "Alice (Female, British)" },
  { id: "Aria", name: "Aria (Female)" },
  { id: "Charlotte", name: "Charlotte (Female, English-Swedish)" },
  { id: "Domi", name: "Domi (Female, American)" },
  { id: "Dorothy", name: "Dorothy (Female, British)" },
  { id: "Emily", name: "Emily (Female, American)" },
  { id: "Freya", name: "Freya (Female, American)" },
  { id: "Gigi", name: "Gigi (Female, American)" },
  { id: "Glinda", name: "Glinda (Female, American)" },
  { id: "Grace", name: "Grace (Female, American-Southern)" },
  { id: "Jessica", name: "Jessica (Female)" },
  { id: "Laura", name: "Laura (Female)" },
  { id: "Lily", name: "Lily (Female, British)" },
  { id: "Matilda", name: "Matilda (Female, American)" },
  { id: "Mimi", name: "Mimi (Female, English-Swedish)" },
  { id: "Nicole", name: "Nicole (Female, American)" },
  { id: "Rachel", name: "Rachel (Female, American)" },
  { id: "Sarah", name: "Sarah (Female, American)" },
  { id: "Serena", name: "Serena (Female, American)" },

  // Male voices
  { id: "Adam", name: "Adam (Male, American)" },
  { id: "Antoni", name: "Antoni (Male, American)" },
  { id: "Arnold", name: "Arnold (Male, American)" },
  { id: "Bill", name: "Bill (Male, American)" },
  { id: "Brian", name: "Brian (Male, American)" },
  { id: "Callum", name: "Callum (Male, American)" },
  { id: "Charlie", name: "Charlie (Male, Australian)" },
  { id: "Chris", name: "Chris (Male, American)" },
  { id: "Clyde", name: "Clyde (Male, American)" },
  { id: "Daniel", name: "Daniel (Male, British)" },
  { id: "Dave", name: "Dave (Male, British-Essex)" },
  { id: "Drew", name: "Drew (Male, American)" },
  { id: "Eric", name: "Eric (Male)" },
  { id: "Ethan", name: "Ethan (Male, American)" },
  { id: "Fin", name: "Fin (Male, Irish)" },
  { id: "George", name: "George (Male, British)" },
  { id: "Giovanni", name: "Giovanni (Male, English-Italian)" },
  { id: "Harry", name: "Harry (Male, American)" },
  { id: "James", name: "James (Male, Australian)" },
  { id: "Jeremy", name: "Jeremy (Male, American-Irish)" },
  { id: "Jessie", name: "Jessie (Male, American)" },
  { id: "Josh", name: "Josh (Male, American)" },
  { id: "Joseph", name: "Joseph (Male, British)" },
  { id: "Liam", name: "Liam (Male, American)" },
  { id: "Michael", name: "Michael (Male, American)" },
  { id: "Patrick", name: "Patrick (Male, American)" },
  { id: "Paul", name: "Paul (Male, American)" },
  { id: "Roger", name: "Roger (Male)" },
  { id: "Sam", name: "Sam (Male, American)" },
  { id: "Thomas", name: "Thomas (Male, American)" },
  { id: "Will", name: "Will (Male)" },

  // Non-binary voices
  { id: "River", name: "River (Non-binary)" },

  // Character voices
  { id: "Santa Claus", name: "Santa Claus (Male)" },
]

/**
 * Voices supported by the ElevenLabs text-to-dialogue-v3 API (via KIE.ai).
 * This is a subset of the full TTS voice library.
 */
export const DIALOGUE_VOICE_IDS = new Set([
  "Adam", "Alice", "Bill", "Brian", "Callum", "Charlie", "Chris",
  "Daniel", "Eric", "George", "Harry", "Jessica", "Laura", "Liam",
  "Lily", "Matilda", "River", "Roger", "Sarah", "Will",
])

export const DIALOGUE_VOICES: readonly TTSVoice[] = TTS_VOICES.filter(
  (v) => DIALOGUE_VOICE_IDS.has(v.id),
)

export const DEFAULT_DIALOGUE_VOICE = "Sarah"

export function getVoiceName(
  voiceId: string,
  dynamicVoices?: readonly { name: string }[],
): string {
  // Try dynamic voices first (from API)
  if (dynamicVoices) {
    const dynamic = dynamicVoices.find((v) => v.name === voiceId)
    if (dynamic) return dynamic.name
  }
  // Fall back to static list
  return TTS_VOICES.find((v) => v.id === voiceId)?.name ?? (voiceId || "Rachel")
}
