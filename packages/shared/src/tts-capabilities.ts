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
import { MODEL_CATALOG, type TtsCapabilities, type TtsDirectionSheet, type TtsSettingLever } from "./model-catalog.js"
import { REPLICA_CONSENT_ATTESTATION, type TtsNamedVoice, type TtsReplica } from "./gemini-tts.js"

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

/**
 * The named voices the model speaks, or `undefined` when it speaks the
 * ElevenLabs voices (premade, library, clones). See `TtsCapabilities.voices`.
 */
export function ttsNamedVoices(provider: string | undefined): readonly TtsNamedVoice[] | undefined {
  return getTtsCapabilities(provider).voices
}

/**
 * Whether `voice` is one the model can speak: on a model with named voices,
 * one of them by its exact wire name; on any other model, any id (the
 * ElevenLabs voice checks apply there, as before).
 */
export function ttsAcceptsVoice(provider: string | undefined, voice: string): boolean {
  const named = ttsNamedVoices(provider)
  return !named || named.some((v) => v.id === voice)
}

/**
 * The voice a request on a named-voice model runs with: the one it names when
 * the model speaks it, else the model's default. `undefined` on an ElevenLabs
 * model (its own default applies downstream).
 */
export function ttsNamedVoiceFor(provider: string | undefined, voice: unknown): string | undefined {
  const caps = getTtsCapabilities(provider)
  if (!caps.voices) return undefined
  return typeof voice === "string" && caps.voices.some((v) => v.id === voice) ? voice : caps.defaultVoice
}

/** The style direction the model takes (`TtsCapabilities.direction`), or `undefined` when it takes none. */
export function ttsDirection(provider: string | undefined): TtsDirectionSheet | undefined {
  return getTtsCapabilities(provider).direction
}

/** The model writes its tone tags `<in angle brackets>` from a closed list (`TtsCapabilities.tagSyntax`). */
export function ttsAngleTags(provider: string | undefined): readonly string[] | undefined {
  const caps = getTtsCapabilities(provider)
  return caps.audioTags && caps.tagSyntax === "angle" ? (caps.tags ?? []) : undefined
}

/**
 * The style direction of a request, as the model takes it: each field kept
 * only when the model's sheet names it and the value is one it accepts (a
 * listed choice, or free text within its cap — trimmed, an empty one
 * dropped). What the provider funnel sends and the workflow engine passes on;
 * the REST route rejects instead of dropping (`ttsDirectionProblem`).
 */
export interface TtsDirectionValues {
  styleDirection?: string
  pace?: string
  accent?: string
  audioProfile?: string
}

export function ttsDirectionFor(provider: string | undefined, values: Readonly<Record<string, unknown>>): TtsDirectionValues {
  const sheet = ttsDirection(provider)
  if (!sheet) return {}
  const text = (value: unknown, max: number | undefined): string | undefined => {
    if (max === undefined || typeof value !== "string") return undefined
    const trimmed = value.trim()
    return trimmed && trimmed.length <= max ? trimmed : undefined
  }
  const choice = (value: unknown, choices: readonly string[] | undefined): string | undefined =>
    choices && typeof value === "string" && choices.includes(value) ? value : undefined
  const out: TtsDirectionValues = {}
  const style = sheet.styles ? choice(values.styleDirection, sheet.styles) : text(values.styleDirection, sheet.styleMaxChars)
  if (style !== undefined) out.styleDirection = style
  const pace = choice(values.pace, sheet.paces)
  if (pace !== undefined) out.pace = pace
  const accent = choice(values.accent, sheet.accents)
  if (accent !== undefined) out.accent = accent
  const profile = text(values.audioProfile, sheet.audioProfileMaxChars)
  if (profile !== undefined) out.audioProfile = profile
  return out
}

/**
 * Why a request's style direction cannot run on the model, or `undefined`
 * when it can. Only the fields the model takes are judged; on a model that
 * takes none, or a field it does not take, the value is never sent (as the
 * neighbour text on a model that does not stitch), so it is no problem.
 */
export function ttsDirectionProblem(provider: string | undefined, values: Readonly<Record<string, unknown>>): { field: keyof TtsDirectionValues; message: string } | undefined {
  const sheet = ttsDirection(provider)
  if (!sheet) return undefined
  const textProblem = (field: keyof TtsDirectionValues, max: number | undefined) => {
    const value = values[field]
    if (max === undefined || value === undefined) return undefined
    if (typeof value !== "string") return { field, message: `${field} must be a string` }
    return value.trim().length > max ? { field, message: `${field} must be at most ${max} characters` } : undefined
  }
  const choiceProblem = (field: keyof TtsDirectionValues, choices: readonly string[] | undefined) => {
    const value = values[field]
    if (!choices || value === undefined || value === "") return undefined
    return typeof value === "string" && choices.includes(value) ? undefined : { field, message: `${field} must be one of: ${choices.join(", ")}` }
  }
  return (
    (sheet.styles ? choiceProblem("styleDirection", sheet.styles) : textProblem("styleDirection", sheet.styleMaxChars)) ??
    choiceProblem("pace", sheet.paces) ??
    choiceProblem("accent", sheet.accents) ??
    textProblem("audioProfile", sheet.audioProfileMaxChars)
  )
}

/** Every voice name a named-voice model speaks (all of them, across models). Built once from the catalog. */
let namedVoiceIds: ReadonlySet<string> | undefined
function anyModelsNamedVoice(voice: string): boolean {
  namedVoiceIds ??= new Set(
    Object.values(MODEL_CATALOG).flatMap((m) => (m.modes.includes("tts") ? (m.tts?.voices ?? []).map((v) => v.id) : [])),
  )
  return namedVoiceIds.has(voice)
}

/**
 * The voice a text-to-speech run on `provider` speaks, when the model and the
 * voice may have been chosen apart — a published app's Model card, a field
 * mapping onto the model, an upstream Character's voice, a preset's voice with
 * a model the caller named (decided 2026-11-13: the editor's model-switch rule,
 * applied wherever the editor is not there to apply it):
 *   - a model with named voices (Gemini): the voice when it is one of them, its
 *     default voice for any other voice, and none (its default) for none;
 *   - an ElevenLabs model: none (the deployment's default) for a voice that only
 *     a named-voice model speaks (`Fola`, `Kore`…), else the voice as given.
 * Returns `undefined` for "no voice named"; never a voice the model refuses.
 */
export function ttsVoiceForModel(provider: string | undefined, voice: unknown): string | undefined {
  const named = typeof voice === "string" && voice.length > 0 ? voice : undefined
  const caps = getTtsCapabilities(provider)
  if (caps.voices) {
    if (named === undefined) return undefined
    return caps.voices.some((v) => v.id === named) ? named : caps.defaultVoice
  }
  return named !== undefined && anyModelsNamedVoice(named) ? undefined : named
}

/** The model clones a speaker's voice for one request (`TtsCapabilities.replica`: Gemini 3.8 Flash). */
export function ttsTakesReplica(provider: string | undefined): boolean {
  return getTtsCapabilities(provider).replica === true
}

/** Every model that takes a one-off clone, in catalog order (for a refusal's sentence). */
export function replicaModels(): string[] {
  return Object.values(MODEL_CATALOG).filter((m) => m.modes.includes("tts") && m.tts?.replica === true).map((m) => m.id)
}

/** Whether `value` is an https link (the only scheme a recording is fetched from). */
function isHttpsLink(value: unknown): value is string {
  if (typeof value !== "string") return false
  try {
    return new URL(value).protocol === "https:"
  } catch {
    return false
  }
}

/** A request's one-off clone as the platform reads it: two https links, or undefined when absent or not that shape. */
export function replicaOf(value: unknown): TtsReplica | undefined {
  if (!value || typeof value !== "object") return undefined
  const { sourceAudioUrl, consentAudioUrl } = value as Record<string, unknown>
  return isHttpsLink(sourceAudioUrl) && isHttpsLink(consentAudioUrl) ? { sourceAudioUrl, consentAudioUrl } : undefined
}

/**
 * Why a request's one-off clone (`replica`) cannot run on the model, or
 * undefined (none asked, or one it takes). Refused, never dropped: a clone
 * that is not sent is someone else's voice. The recordings themselves (WAV,
 * size, length) are judged where they are fetched (backend
 * `lib/voice-replica.ts`).
 */
export function ttsReplicaProblem(provider: string | undefined, value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined
  if (!ttsTakesReplica(provider)) {
    return `${provider ?? "This model"} does not clone a voice; a one-off clone runs on ${replicaModels().join(", ")}`
  }
  return replicaOf(value) ? undefined : "replica needs sourceAudioUrl and consentAudioUrl, each an https link to a WAV recording"
}

/**
 * Why an API or MCP clone lacks its consent, or undefined: a `replica` asked
 * must say `consent: true` — the caller's confirmation of
 * `REPLICA_CONSENT_ATTESTATION`, what the editor's checkbox says (decided
 * 2026-11-13). Refused before anything is read or held.
 */
export function replicaConsentProblem(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined
  return (value as { consent?: unknown }).consent === true
    ? undefined
    : `replica.consent must be true: it confirms "${REPLICA_CONSENT_ATTESTATION}"`
}

