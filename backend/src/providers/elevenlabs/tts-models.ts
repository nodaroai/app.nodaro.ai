import { canonicalTtsProvider, TTS_FALLBACK_PROVIDER } from "@nodaro/shared/model-catalog"
import { isGeminiTtsModel } from "../kie/gemini-tts-models.js"

/**
 * Our text-to-speech provider id → ElevenLabs' own model id.
 *
 * The ONE place a raw ElevenLabs speech-model name is written for plain
 * text-to-speech — those names never leave the backend (the API, the SDK, the
 * catalog and every UI speak our ids). A provider with no row here would fall
 * back to {@link TTS_FALLBACK_PROVIDER}'s model, which is a billing bug: the
 * request would be priced as the new model and rendered by turbo; and a row
 * for a provider that is gone would keep reaching its ElevenLabs model.
 * `tts-models.test.ts` therefore fails the build for a `TTS_PROVIDERS` member
 * with no row here or in the Gemini table (`kie/gemini-tts-models.ts`), and for
 * a row whose provider is not a live `TTS_PROVIDERS` member.
 */
export const TTS_WIRE_MODELS: Readonly<Record<string, string>> = {
  "elevenlabs-v3": "eleven_v3",
  "elevenlabs-v4": "eleven_v4",
  "elevenlabs-v4-turbo": "eleven_v4_turbo",
  "elevenlabs-multilingual": "eleven_multilingual_v2",
  "elevenlabs-turbo": "eleven_turbo_v2_5",
}

/**
 * The provider id a request actually runs as: the legacy alias resolved, and any
 * missing, unknown or non-string id falling back to turbo. (Node data can be
 * written straight into workflow JSON, so the "string" is not guaranteed.) A
 * speech model of another provider (Gemini, on KIE — `kie/gemini-tts-models.ts`)
 * runs as itself: without it here, it would be priced and rendered as turbo.
 */
function runsAs(provider: string | undefined): string {
  if (typeof provider !== "string") return TTS_FALLBACK_PROVIDER
  const canonical = canonicalTtsProvider(provider)
  return Object.hasOwn(TTS_WIRE_MODELS, canonical) || isGeminiTtsModel(canonical) ? canonical : TTS_FALLBACK_PROVIDER
}

/**
 * The ElevenLabs model id sent as `model_id`. Throws for a speech model that
 * is not ElevenLabs' (the worker sends those to their own provider first), so
 * no request is ever rendered by a model other than the one priced.
 */
export function ttsWireModel(provider: string | undefined): string {
  const id = runsAs(provider)
  const wire = TTS_WIRE_MODELS[id]
  if (!wire) throw new Error(`${id} is not an ElevenLabs speech model`)
  return wire
}

/** Whether the request runs on an ElevenLabs model (the direct API) — false for a speech model of another provider. */
export function isElevenLabsTtsModel(provider: string | undefined): boolean {
  return Object.hasOwn(TTS_WIRE_MODELS, runsAs(provider))
}

/**
 * OUR key for the egress seam: the provider id the request actually runs as.
 * These strings ARE our credit ids (the TTS route reserves under the same
 * `provider` value) — never a raw ElevenLabs model id.
 */
export function ttsModelKey(provider: string | undefined): string {
  return runsAs(provider)
}
