import { canonicalTtsProvider, ttsNamedVoices } from "@nodaro/shared/model-catalog"
import { DEFAULT_DIALOGUE_PROVIDER, type DialogueProvider } from "@nodaro/shared/models"
import { DIALOGUE_WIRE_MODELS, dialogueSpeechModel, type ElevenLabsDialogueProvider } from "../providers/elevenlabs/dialogue-models.js"

/**
 * The dialogue model a voiced-video cast is synthesised on. A single voice
 * renders on its own `ttsProvider` (video-ai.ts); a multi-speaker cast renders
 * on the dialogue twin of that model only when EVERY voice names a model and
 * they share one twin — otherwise v3 dialogue, the default (decided 2026-10-06:
 * derived from the voices, no new public field). Computed once in the route
 * (reservation and enqueue) and forwarded to the worker — pass-through, never
 * re-derived. The twin is read from the wire-model table, never compared with
 * a literal.
 */
export function voicedDialogueProvider(voices: ReadonlyArray<{ ttsProvider?: unknown } | null | undefined> | undefined): DialogueProvider {
  if (!voices || voices.length === 0) return DEFAULT_DIALOGUE_PROVIDER
  let chosen: DialogueProvider | undefined
  for (const v of voices) {
    // The credit resolver reads the RAW body before Zod: a voice that is not an
    // object (null, a string) is a voice with no model, never a throw.
    const ttsProvider = v && typeof v === "object" ? (v as { ttsProvider?: unknown }).ttsProvider : undefined
    if (typeof ttsProvider !== "string") return DEFAULT_DIALOGUE_PROVIDER
    const speech = canonicalTtsProvider(ttsProvider)
    // An ElevenLabs dialogue twin only: a voiced cast renders on ElevenLabs (a Gemini model is not offered on this lane).
    const twin = (Object.keys(DIALOGUE_WIRE_MODELS) as ElevenLabsDialogueProvider[]).find((d) => dialogueSpeechModel(d) === speech)
    if (!twin || (chosen && chosen !== twin)) return DEFAULT_DIALOGUE_PROVIDER
    chosen = twin
  }
  return chosen ?? DEFAULT_DIALOGUE_PROVIDER
}

/**
 * The speech model a voiced-video track of ONE voice renders on: the voice's
 * own `ttsProvider`, unless that model speaks only its own named voices
 * (Gemini, decided 2026-11-12) — the voiced lane renders a cast's voices on
 * the direct ElevenLabs API, so such a model is not offered there yet and the
 * voice runs as a request with no model would (undefined: the fallback model).
 * The route's reservation (`planVoicedDialogue`) and the worker read this one
 * rule, so the model priced is the model run, whatever a saved voice carries.
 */
export function voicedSpeechProvider(ttsProvider: unknown): string | undefined {
  if (typeof ttsProvider !== "string") return undefined
  return ttsNamedVoices(canonicalTtsProvider(ttsProvider)) ? undefined : ttsProvider
}
