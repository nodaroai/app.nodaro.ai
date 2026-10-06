import { MODEL_CATALOG, canonicalTtsProvider } from "@nodaro/shared"
import type { PluginTtsCapabilities } from "./types.js"

/**
 * `providers.ttsCapabilities` — the capability sheet of a text-to-speech model,
 * answered from THIS app's `@nodaro/shared` (the plugin's own pin lags by
 * releases). Strict: an id that is not a `tts`-mode model (incl. the dialogue
 * lane, whose sheet belongs to its own route) is `undefined`. Copies, so a
 * plugin can never mutate the catalog. Spelled here rather than reusing the
 * shared `findTtsCapabilities`, which is deliberately not exported.
 */
export function hostTtsCapabilities(providerId: string): PluginTtsCapabilities | undefined {
  // `typeof`: the id arrives from plugin code, so "string" is not guaranteed —
  // and `Object.hasOwn` would coerce an array like ["elevenlabs-v4"] into that
  // model's id. A non-string is an unknown id.
  if (typeof providerId !== "string" || !providerId) return undefined
  const id = canonicalTtsProvider(providerId)
  if (!Object.hasOwn(MODEL_CATALOG, id)) return undefined
  const entry = MODEL_CATALOG[id]!
  if (!entry.modes.includes("tts") || !entry.tts) return undefined
  const { maxChars, levers, languages, audioTags } = entry.tts
  return { maxChars, levers: [...levers], languages: [...languages], audioTags }
}
