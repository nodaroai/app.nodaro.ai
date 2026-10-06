/**
 * Capability lookups for the text-to-speech lane.
 *
 * Every "does this model do X" decision on that lane reads the model's `tts`
 * sheet in `MODEL_CATALOG` through these helpers — tag stripping, which voice
 * settings are sent and shown, the language picker, whether neighbouring text
 * is sent. Declare the sheet honestly
 * on the catalog entry and a new model is covered everywhere; do not compare a
 * provider id by hand.
 *
 * "The text-to-speech lane" means the models that list the `tts` mode. The
 * dialogue models carry a sheet too, read by `dialogue-capabilities.ts`; a
 * text-to-speech request that names one runs as the fallback model, so these
 * helpers answer for the fallback there.
 */
import { MODEL_CATALOG, type TtsCapabilities, type TtsSettingLever } from "./model-catalog.js"

/** Legacy provider ids that are another model under an old name. They have no catalog entry of their own. */
export const TTS_PROVIDER_ALIASES: Readonly<Record<string, string>> = {
  elevenlabs: "elevenlabs-turbo",
}

/** The model a request runs on when its provider id is missing or unknown. */
export const TTS_FALLBACK_PROVIDER = "elevenlabs-turbo"

/**
 * Resolve a legacy alias to the catalog id it runs as. Any other id passes
 * through unchanged. Own properties only: an id that happens to be the name of
 * an inherited object member (`constructor`, `__proto__`, `toString`) is an
 * unknown id like any other, never a function.
 */
export function canonicalTtsProvider(provider: string): string {
  return typeof provider === "string" && Object.hasOwn(TTS_PROVIDER_ALIASES, provider) ? TTS_PROVIDER_ALIASES[provider]! : provider
}

/** The capability sheet of a text-to-speech model, or `undefined` when the id is not one. */
export function findTtsCapabilities(provider: string | undefined): TtsCapabilities | undefined {
  // `typeof`: node data can be written straight into workflow JSON, so the "string" is not guaranteed — and
  // `Object.hasOwn` would coerce an array like ["elevenlabs-v3"] into that model's id. A non-string is an unknown id.
  if (typeof provider !== "string" || !provider) return undefined
  const id = canonicalTtsProvider(provider)
  if (!Object.hasOwn(MODEL_CATALOG, id)) return undefined
  const entry = MODEL_CATALOG[id]!
  return entry.modes.includes("tts") ? entry.tts : undefined
}

/**
 * The capability sheet a text-to-speech request will actually run under: a
 * missing or unknown provider id runs as {@link TTS_FALLBACK_PROVIDER}, so it
 * gets that sheet — including its `maxChars` (turbo's 40,000), where
 * `getMaxTtsChars` keeps answering its 5,000 default for such ids.
 */
export function getTtsCapabilities(provider: string | undefined): TtsCapabilities {
  return findTtsCapabilities(provider) ?? MODEL_CATALOG[TTS_FALLBACK_PROVIDER]!.tts!
}

/** The model performs inline `[audio tags]`. false ⇒ strip them before sending. */
export function ttsSupportsAudioTags(provider: string | undefined): boolean {
  return getTtsCapabilities(provider).audioTags
}

/** The model honours SSML `<break time="…"/>` tags. */
export function ttsSupportsSsmlBreaks(provider: string | undefined): boolean {
  return getTtsCapabilities(provider).ssmlBreaks
}

/**
 * The model conditions on neighbouring text (`previous_text` / `next_text`).
 * false ⇒ the provider funnel never puts the fields on the wire, whatever the
 * request carries — the model would reject them.
 */
export function ttsSupportsStitching(provider: string | undefined): boolean {
  return getTtsCapabilities(provider).stitching
}

/** The model honours this voice-setting lever. */
export function ttsHasLever(provider: string | undefined, lever: TtsSettingLever): boolean {
  return getTtsCapabilities(provider).levers.includes(lever)
}

/** The model answers `/v1/text-to-speech/{voice}/with-timestamps` (character timings). */
export function ttsSupportsTimestamps(provider: string | undefined): boolean {
  return getTtsCapabilities(provider).timestamps
}

/** Language codes offered for the model, in catalog order. */
export function ttsLanguageCodes(provider: string | undefined): readonly string[] {
  return getTtsCapabilities(provider).languages
}
