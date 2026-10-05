import { DEFAULT_TTS_PROVIDER, getMaxTtsChars, type TtsProvider } from "@nodaro/shared"

/**
 * The speech model a request runs on when nothing names one — the ONE rule every
 * omitted-provider lane reads: the REST route (its credit guard and its handler), the
 * workflow engine's text-to-speech dispatch, the narration pipeline and the worker's
 * defensive default. So the model billed is the model run, whichever way a node or a
 * request reaches the provider.
 *
 * The default speech model (`DEFAULT_TTS_PROVIDER`) takes the text up to its own
 * per-request cap (`getMaxTtsChars`, 10,000 characters on v4); longer text runs on
 * turbo (cap 40,000), so it is never billed for a model that cannot take it and then
 * truncated or rejected. Reads the model and its cap from the shared constants, so
 * moving the default moves this rule with it.
 *
 * `text` is the text that is actually sent (after any pre/post text). A caller that
 * names a model never comes here: the length rule never overrides a chosen model.
 */
export function resolveOmittedTtsProvider(text: string): TtsProvider {
  return text.length <= getMaxTtsChars(DEFAULT_TTS_PROVIDER) ? DEFAULT_TTS_PROVIDER : "elevenlabs-turbo"
}
