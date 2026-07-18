// frontend/src/lib/voice.ts

const VOICE_BASE_URL =
  (import.meta.env.VITE_VOICE_URL as string | undefined)?.replace(/\/+$/, "") ||
  "https://voice.nodaro.ai"

/** Voice Changer Pro home — used by the flagship "Open Voice Changer Pro" action. */
export function voiceBaseUrl(): string {
  return VOICE_BASE_URL
}
