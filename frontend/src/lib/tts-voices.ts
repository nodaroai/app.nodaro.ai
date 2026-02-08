export interface TTSVoice {
  readonly id: string
  readonly name: string
}

export const TTS_VOICES: readonly TTSVoice[] = [
  // Default voices
  { id: "Rachel", name: "Rachel (Female)" },
  { id: "Aria", name: "Aria (Female)" },
  { id: "Roger", name: "Roger (Male)" },
  { id: "Sarah", name: "Sarah (Female)" },
  { id: "Laura", name: "Laura (Female)" },
  { id: "Charlie", name: "Charlie (Male)" },
  { id: "George", name: "George (Male)" },
  { id: "Callum", name: "Callum (Male)" },
  { id: "River", name: "River (Non-binary)" },
  { id: "Liam", name: "Liam (Male)" },
  { id: "Charlotte", name: "Charlotte (Female)" },
  { id: "Alice", name: "Alice (Female)" },
  { id: "Matilda", name: "Matilda (Female)" },
  { id: "Will", name: "Will (Male)" },
  { id: "Jessica", name: "Jessica (Female)" },
  { id: "Eric", name: "Eric (Male)" },
  { id: "Chris", name: "Chris (Male)" },
  { id: "Brian", name: "Brian (Male)" },
  { id: "Daniel", name: "Daniel (Male)" },
  { id: "Lily", name: "Lily (Female)" },
  { id: "Bill", name: "Bill (Male)" },
]

export function getVoiceName(voiceId: string): string {
  return TTS_VOICES.find((v) => v.id === voiceId)?.name ?? (voiceId || "Rachel")
}
