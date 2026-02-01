export interface TTSVoice {
  readonly id: string
  readonly name: string
}

export const TTS_VOICES: readonly TTSVoice[] = [
  { id: "Rachel", name: "Rachel (Female)" },
  { id: "Aria", name: "Aria (Female)" },
  { id: "Domi", name: "Domi (Female)" },
  { id: "Sarah", name: "Sarah (Female)" },
  { id: "Jane", name: "Jane (Female)" },
  { id: "Juniper", name: "Juniper (Female)" },
  { id: "Arabella", name: "Arabella (Female)" },
  { id: "Hope", name: "Hope (Female)" },
  { id: "Blondie", name: "Blondie (Female)" },
  { id: "Priyanka", name: "Priyanka (Female)" },
  { id: "Alexandra", name: "Alexandra (Female)" },
  { id: "Monika", name: "Monika (Female)" },
  { id: "Drew", name: "Drew (Male)" },
  { id: "Clyde", name: "Clyde (Male)" },
  { id: "Paul", name: "Paul (Male)" },
  { id: "Dave", name: "Dave (Male)" },
  { id: "Roger", name: "Roger (Male)" },
  { id: "Fin", name: "Fin (Male)" },
  { id: "James", name: "James (Male)" },
  { id: "Bradford", name: "Bradford (Male)" },
  { id: "Reginald", name: "Reginald (Male)" },
  { id: "Austin", name: "Austin (Male)" },
  { id: "Kuon", name: "Kuon (Male)" },
  { id: "Mark", name: "Mark (Male)" },
  { id: "Grimblewood", name: "Grimblewood (Male)" },
  { id: "Gaming", name: "Gaming" },
]

export function getVoiceName(voiceId: string): string {
  return TTS_VOICES.find((v) => v.id === voiceId)?.name ?? (voiceId || "Rachel")
}
