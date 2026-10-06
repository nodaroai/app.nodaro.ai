import { canonicalTtsProvider, DEFAULT_DIALOGUE_PROVIDER, DIALOGUE_PROVIDERS, type DialogueProvider } from "@nodaro/shared"
import { dialogueSpeechModel } from "../providers/elevenlabs/dialogue-models.js"

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
    const twin = DIALOGUE_PROVIDERS.find((d) => dialogueSpeechModel(d) === speech)
    if (!twin || (chosen && chosen !== twin)) return DEFAULT_DIALOGUE_PROVIDER
    chosen = twin
  }
  return chosen ?? DEFAULT_DIALOGUE_PROVIDER
}
