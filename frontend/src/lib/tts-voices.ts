export interface TTSVoice {
  readonly id: string
  readonly name: string
  readonly provider: "elevenlabs" | "playht" | "azure" | "bark"
}

export const TTS_VOICES: readonly TTSVoice[] = [
  { id: "default", name: "Default", provider: "elevenlabs" },
  { id: "21m00Tcm4TlvDq8ikWAM", name: "Rachel (Female)", provider: "elevenlabs" },
  { id: "EXAVITQu4vr4xnSDxMaL", name: "Bella (Female)", provider: "elevenlabs" },
  { id: "ErXwobaYiN019PkySvjV", name: "Antoni (Male)", provider: "elevenlabs" },
  { id: "VR6AewLTigWG4xSOukaG", name: "Arnold (Male)", provider: "elevenlabs" },
  { id: "pNInz6obpgDQGcFmaJgB", name: "Adam (Male)", provider: "elevenlabs" },
  { id: "yoZ06aMxZJJ28mfd3POQ", name: "Sam (Male)", provider: "elevenlabs" },
  { id: "v2/en_speaker_0", name: "English Speaker 0", provider: "bark" },
  { id: "v2/en_speaker_1", name: "English Speaker 1", provider: "bark" },
  { id: "v2/en_speaker_6", name: "English Speaker 6", provider: "bark" },
  { id: "v2/en_speaker_9", name: "English Speaker 9", provider: "bark" },
]

export function getVoiceName(voiceId: string): string {
  return TTS_VOICES.find((v) => v.id === voiceId)?.name ?? (voiceId || "Default")
}
