/**
 * The local key a transcribe job runs on: ElevenLabs Scribe on the ElevenLabs
 * key, Nemotron 3.5 Transcribe on the KIE key, every other engine (Whisper) on
 * the Replicate token. One function for the workers (`handleTranscribe`, the
 * caption render's transcription) and the use-case preflight, so the route
 * refuses exactly when the worker would have.
 */
import { CAPTION_ENGINE_UNRESTRICTED_DEFAULT } from "@nodaro/render-rules"
import { config } from "./config.js"

export type TranscribeLaneKeyName = "ELEVENLABS_API_KEY" | "KIE_API_KEY" | "REPLICATE_API_TOKEN"

export function transcribeLaneKeyName(provider: string | undefined): TranscribeLaneKeyName {
  if (provider === "elevenlabs-stt") return "ELEVENLABS_API_KEY"
  if (provider === "nemotron-3-5-transcribe") return "KIE_API_KEY"
  return "REPLICATE_API_TOKEN"
}

/**
 * The reconcile kind a transcribe job's provider task id is saved under, so a
 * stall-retry recovers it through the right provider's reconcile (and never
 * re-bills the call): KIE's record-info task for Nemotron, a Replicate
 * prediction for the two whisper lanes. Direct Scribe saves no task id.
 */
export function transcribeTaskKind(provider: string | undefined): "kie-standard" | "replicate-prediction" {
  return provider === "nemotron-3-5-transcribe" ? "kie-standard" : "replicate-prediction"
}

export function transcribeLaneKey(provider: string | undefined): string | undefined {
  return config[transcribeLaneKeyName(provider)] as string | undefined
}

/**
 * The lane Add Captions transcribes on when its node names none and nothing is
 * restricted: the first of the default order (`@nodaro/render-rules`
 * `caption-engine.ts`). Where models are restricted the engine is decided per
 * run (`lib/add-captions-engine.ts`) and written into the job.
 */
export const ADD_CAPTIONS_DEFAULT_TRANSCRIBE_PROVIDER = CAPTION_ENGINE_UNRESTRICTED_DEFAULT
