/**
 * Capability lookups for the DIALOGUE lane (`/v1/text-to-dialogue`, the Text to
 * Dialogue node, the voiced-video multi-speaker track).
 *
 * The dialogue models carry a `tts` sheet in `MODEL_CATALOG` like the
 * text-to-speech models, but each lane answers only for its own models: the
 * text-to-speech lookups (`tts-capabilities.ts`) treat a dialogue id as unknown,
 * and these treat a text-to-speech id as unknown. An unknown id here runs as
 * {@link DEFAULT_DIALOGUE_PROVIDER} (v3 dialogue) — not as the text-to-speech
 * fallback (turbo), which has no dialogue form.
 */
import { MODEL_CATALOG, type TtsCapabilities, type TtsSettingLever } from "./model-catalog.js"
import { DEFAULT_DIALOGUE_PROVIDER, type DialogueProvider } from "./model-constants.js"

/** The sheet of a dialogue model, or `undefined` when the id is not one. Own properties only; a non-string is unknown. */
export function findDialogueCapabilities(provider: unknown): TtsCapabilities | undefined {
  if (typeof provider !== "string" || !provider) return undefined
  if (!Object.hasOwn(MODEL_CATALOG, provider)) return undefined
  const entry = MODEL_CATALOG[provider]!
  return entry.modes.includes("dialogue") ? entry.tts : undefined
}

/** The dialogue model a request naming `provider` runs on (and is billed as). */
export function dialogueProviderOf(provider: unknown): DialogueProvider {
  return findDialogueCapabilities(provider) ? (provider as DialogueProvider) : DEFAULT_DIALOGUE_PROVIDER
}

/** The sheet a dialogue request runs under. */
export function getDialogueCapabilities(provider: unknown): TtsCapabilities {
  return MODEL_CATALOG[dialogueProviderOf(provider)]!.tts!
}

/** The dialogue model honours this voice-setting lever. */
export function dialogueHasLever(provider: unknown, lever: TtsSettingLever): boolean {
  return getDialogueCapabilities(provider).levers.includes(lever)
}

/** `value` is a stability this platform accepts for the dialogue model: one of its steps, or any finite 0–1 when it has none. */
export function dialogueStabilityAccepted(provider: unknown, value: number): boolean {
  if (!Number.isFinite(value) || value < 0 || value > 1) return false
  const steps = getDialogueCapabilities(provider).stabilitySteps
  return steps ? steps.includes(value) : true
}
