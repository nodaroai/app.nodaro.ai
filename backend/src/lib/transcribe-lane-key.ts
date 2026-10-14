/**
 * The local key a transcribe job runs on: ElevenLabs Scribe on the ElevenLabs
 * key, every other engine (Whisper) on the Replicate token. One function for
 * the workers (`handleTranscribe`, the caption render's transcription) and the
 * use-case preflight, so the route refuses exactly when the worker would have.
 */
import { config } from "./config.js"

export type TranscribeLaneKeyName = "ELEVENLABS_API_KEY" | "REPLICATE_API_TOKEN"

export function transcribeLaneKeyName(provider: string | undefined): TranscribeLaneKeyName {
  return provider === "elevenlabs-stt" ? "ELEVENLABS_API_KEY" : "REPLICATE_API_TOKEN"
}

export function transcribeLaneKey(provider: string | undefined): string | undefined {
  return config[transcribeLaneKeyName(provider)] as string | undefined
}
