import { dialogueProviderOf, type DialogueProvider } from "@nodaro/shared"

/**
 * Our dialogue model id → ElevenLabs' model id, and the text-to-speech model
 * whose voices it shares (the voiced-video synth picks the dialogue model from
 * the voices' own text-to-speech model — workers/handlers/video-ai.ts).
 *
 * The ONE place a raw ElevenLabs model name is written for dialogue; those
 * names never leave the backend. Typed over `DialogueProvider`, so a model
 * added to DIALOGUE_PROVIDERS without a row here fails `tsc`.
 */
export const DIALOGUE_WIRE_MODELS: Readonly<Record<DialogueProvider, { readonly wire: string; readonly speechModel: string }>> = {
  "elevenlabs-dialogue": { wire: "eleven_v3", speechModel: "elevenlabs-v3" },
}

/** The ElevenLabs model id sent as `model_id`. */
export function dialogueWireModel(provider: unknown): string {
  return DIALOGUE_WIRE_MODELS[dialogueProviderOf(provider)].wire
}

/** OUR key for the egress seam — the id the request runs as, which IS its credit identifier. */
export function dialogueModelKey(provider: unknown): DialogueProvider {
  return dialogueProviderOf(provider)
}

/** The text-to-speech model whose voice rendering this dialogue model shares. */
export function dialogueSpeechModel(provider: unknown): string {
  return DIALOGUE_WIRE_MODELS[dialogueProviderOf(provider)].speechModel
}
