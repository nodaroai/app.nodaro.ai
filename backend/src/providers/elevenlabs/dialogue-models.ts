import { DEFAULT_DIALOGUE_PROVIDER, dialogueProviderOf, type DialogueProvider } from "@nodaro/shared/models"

/** The dialogue models ElevenLabs renders (the Gemini dialogue models run on KIE: providers/kie/gemini-tts.ts). */
export type ElevenLabsDialogueProvider = Extract<DialogueProvider, `elevenlabs-${string}`>

/**
 * Our dialogue model id → ElevenLabs' model id, and the text-to-speech model
 * whose voices it shares (the voiced-video synth picks the dialogue model from
 * the voices' own text-to-speech model — workers/handlers/video-ai.ts).
 *
 * The ONE place a raw ElevenLabs model name is written for dialogue; those
 * names never leave the backend. Typed over the ElevenLabs dialogue ids, so an
 * `elevenlabs-*` model added to DIALOGUE_PROVIDERS without a row here fails `tsc`.
 */
export const DIALOGUE_WIRE_MODELS: Readonly<Record<ElevenLabsDialogueProvider, { readonly wire: string; readonly speechModel: string }>> = {
  "elevenlabs-dialogue": { wire: "eleven_v3", speechModel: "elevenlabs-v3" },
  "elevenlabs-dialogue-v4": { wire: "eleven_v4", speechModel: "elevenlabs-v4" },
}

/** Whether the dialogue model a request runs as is one ElevenLabs renders. */
export function isElevenLabsDialogueModel(provider: unknown): boolean {
  return Object.hasOwn(DIALOGUE_WIRE_MODELS, dialogueProviderOf(provider))
}

/**
 * The ElevenLabs dialogue model a request on this funnel runs as: its own when
 * it is one, else the default — the ElevenLabs funnel never renders another
 * provider's model (the worker sends a Gemini model to KIE before it gets here).
 */
function elevenLabsDialogueModel(provider: unknown): ElevenLabsDialogueProvider {
  const id = dialogueProviderOf(provider)
  return (Object.hasOwn(DIALOGUE_WIRE_MODELS, id) ? id : DEFAULT_DIALOGUE_PROVIDER) as ElevenLabsDialogueProvider
}

/** The ElevenLabs model id sent as `model_id`. */
export function dialogueWireModel(provider: unknown): string {
  return DIALOGUE_WIRE_MODELS[elevenLabsDialogueModel(provider)].wire
}

/** OUR key for the egress seam — the id the request runs as, which IS its credit identifier. */
export function dialogueModelKey(provider: unknown): DialogueProvider {
  return elevenLabsDialogueModel(provider)
}

/** The text-to-speech model whose voice rendering this ElevenLabs dialogue model shares. */
export function dialogueSpeechModel(provider: ElevenLabsDialogueProvider): string {
  return DIALOGUE_WIRE_MODELS[provider].speechModel
}
