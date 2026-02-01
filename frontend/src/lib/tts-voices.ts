export interface TTSVoice {
  readonly id: string
  readonly name: string
}

export const TTS_VOICES: readonly TTSVoice[] = [
  { id: "Rachel", name: "Rachel (Female)" },
  { id: "Aria", name: "Aria (Female)" },
  { id: "Domi", name: "Domi (Female)" },
  { id: "Bella", name: "Bella (Female)" },
  { id: "Elli", name: "Elli (Female)" },
  { id: "Sarah", name: "Sarah (Female)" },
  { id: "Jane", name: "Jane (Female)" },
  { id: "Hope", name: "Hope (Female)" },
  { id: "Josh", name: "Josh (Male)" },
  { id: "Arnold", name: "Arnold (Male)" },
  { id: "Adam", name: "Adam (Male)" },
  { id: "Sam", name: "Sam (Male)" },
  { id: "Drew", name: "Drew (Male)" },
  { id: "Paul", name: "Paul (Male)" },
  { id: "Dave", name: "Dave (Male)" },
  { id: "James", name: "James (Male)" },
  { id: "Fin", name: "Fin (Male)" },
]

export function getVoiceName(voiceId: string): string {
  return TTS_VOICES.find((v) => v.id === voiceId)?.name ?? (voiceId || "Rachel")
}
