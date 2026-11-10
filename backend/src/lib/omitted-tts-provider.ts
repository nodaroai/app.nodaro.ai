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
 * `ttsModelOf` is the speech model a text-to-speech request runs: the one it names
 * (the legacy "elevenlabs" is turbo), else the omitted-provider rule. The route's
 * credit guard, its handler and the job's recorded model all read it, and so does
 * the editor's speech menu (`@nodaro/render-rules`, where both live, so a menu row
 * is judged as the model it runs). A caller that names a model never reaches the
 * length rule: it never overrides a chosen model.
 */
export { resolveOmittedTtsProvider, ttsModelOf } from "@nodaro/render-rules"
