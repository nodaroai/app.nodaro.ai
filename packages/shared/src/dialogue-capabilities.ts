/**
 * Capability lookups for the DIALOGUE lane (`/v1/text-to-dialogue`, the Text to
 * Dialogue node, the voiced-video multi-speaker track).
 *
 * The dialogue models carry a `tts` sheet in `MODEL_CATALOG` like the
 * text-to-speech models, but each lane answers only for its own models: the
 * text-to-speech lookups (`tts-capabilities.ts`) treat a dialogue-only id as
 * unknown, and these treat a text-to-speech-only id as unknown (a model in both
 * lanes — Gemini — has one sheet, read by either). An unknown id here runs as
 * {@link DEFAULT_DIALOGUE_PROVIDER} (v3 dialogue) — not as the text-to-speech
 * fallback (turbo), which has no dialogue form.
 */
import { MODEL_CATALOG, type TtsCapabilities, type TtsSettingLever } from "./model-catalog.js"
import { DEFAULT_DIALOGUE_PROVIDER, DEFAULT_TTS_OUTPUT_FORMAT, TTS_OUTPUT_FORMATS, type DialogueProvider, type TtsOutputFormat } from "./model-constants.js"
import { replicaOf, ttsDirectionFor, ttsDirectionProblem, ttsReplicaProblem, ttsTakesReplica, ttsVoiceForModel, type TtsDirectionValues } from "./tts-capabilities.js"

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

/** The dialogue model answers `/v1/text-to-dialogue/with-timestamps` (character timings + per-line voice segments). */
export function dialogueSupportsTimestamps(provider: unknown): boolean {
  return getDialogueCapabilities(provider).timestamps
}

/** `value` is a stability this platform accepts for the dialogue model: one of its steps, or any finite 0–1 when it has none. */
export function dialogueStabilityAccepted(provider: unknown, value: number): boolean {
  if (!Number.isFinite(value) || value < 0 || value > 1) return false
  const steps = getDialogueCapabilities(provider).stabilitySteps
  return steps ? steps.includes(value) : true
}

/** The ElevenLabs dialogue lane's own limit on distinct voices in one script (probed 2026-08-30: an 11th → 400). */
export const ELEVENLABS_DIALOGUE_MAX_VOICES = 10

/** The most speakers (distinct voices) one script on the dialogue model may have: its sheet's, else the ElevenLabs limit. */
export function dialogueMaxSpeakers(provider: unknown): number {
  return getDialogueCapabilities(provider).dialogueSpeakers ?? ELEVENLABS_DIALOGUE_MAX_VOICES
}

/** The dialogue model adds filler words between two speakers on request (`TtsCapabilities.fillerWords`). */
export function dialogueTakesFillerWords(provider: unknown): boolean {
  return getDialogueCapabilities(provider).fillerWords === true
}

/**
 * Each line's voice on the dialogue model, when the model and the voices may
 * have been chosen apart (a published app's Model card, a field mapping, the
 * editor's model switch): the text-to-speech lane's `ttsVoiceForModel` rule,
 * per speaker. A voice the model speaks stays. On a model with named voices
 * (Gemini) every other voice moves onto one of its voices that the script does
 * not use yet, its default first — so two speakers are never merged into one
 * voice by the move. On an ElevenLabs model a voice only a named-voice model
 * speaks becomes "" (the deployment's default voice). Returns the voices in
 * line order.
 */
export function dialogueVoicesForModel(provider: unknown, voices: readonly unknown[], speakers?: unknown): string[] {
  const sheet = getDialogueCapabilities(provider)
  const id = dialogueProviderOf(provider)
  const named = sheet.voices
  if (!named) return voices.map((v) => ttsVoiceForModel(id, v) ?? "")
  // A speaker cloned for this request (`replica`) is the model's own voice too, on a model that clones;
  // on any other model it is a foreign voice and moves (decided 2026-11-13: one rule, `dialogueReplicaVoices`).
  const clones = dialogueReplicaVoices(id, speakers)
  const own = (v: unknown): v is string => typeof v === "string" && (named.some((n) => n.id === v) || clones.has(v))
  const used = new Set(voices.filter(own))
  const pool = [sheet.defaultVoice, ...named.map((n) => n.id)].filter((v): v is string => typeof v === "string")
  const moved = new Map<string, string>()
  return voices.map((v) => {
    if (own(v)) return v
    const key = typeof v === "string" ? v : ""
    const kept = moved.get(key)
    if (kept !== undefined) return kept
    const next = pool.find((p) => !used.has(p)) ?? sheet.defaultVoice ?? named[0]!.id
    used.add(next)
    moved.set(key, next)
    return next
  })
}

/**
 * The most characters of the free-text style ONE LINE takes on the dialogue
 * model (Gemini 3.8: `direction.styleMaxChars`, a style per turn), or
 * undefined on a model whose style is a speaker's choice (3.1 / 2.5) or that
 * takes none (ElevenLabs).
 */
export function dialogueLineStyleMaxChars(provider: unknown): number | undefined {
  const d = getDialogueCapabilities(provider).direction
  return d && d.styles === undefined ? d.styleMaxChars : undefined
}

/** A line's style as the dialogue model is sent it: trimmed, when the model takes one per line and it fits; else undefined. */
export function dialogueLineStyleFor(provider: unknown, value: unknown): string | undefined {
  const max = dialogueLineStyleMaxChars(provider)
  if (max === undefined || typeof value !== "string") return undefined
  const trimmed = value.trim()
  return trimmed && trimmed.length <= max ? trimmed : undefined
}

/** Whether the dialogue model takes direction per SPEAKER (Gemini 3.1 / 2.5: a style, pace, accent and audio profile per voice). */
export function dialogueTakesSpeakerDirection(provider: unknown): boolean {
  const d = getDialogueCapabilities(provider).direction
  return d !== undefined && (d.styles !== undefined || d.paces !== undefined || d.accents !== undefined || d.audioProfileMaxChars !== undefined)
}

/** One speaker's direction as the dialogue model is sent it (`ttsDirectionFor`), or {} on a model that takes none per speaker. */
export function dialogueSpeakerDirectionFor(provider: unknown, values: Readonly<Record<string, unknown>>): TtsDirectionValues {
  return dialogueTakesSpeakerDirection(provider) ? ttsDirectionFor(dialogueProviderOf(provider), values) : {}
}

/**
 * The files the dialogue model delivers: every speech file format on a model
 * that renders a WAV the platform keeps or encodes (Gemini,
 * `dialogueAnyOutputFormat`); the default MP3 only on the ElevenLabs dialogue
 * models, as the platform calls them.
 */
export function dialogueOutputFormats(provider: unknown): readonly TtsOutputFormat[] {
  return getDialogueCapabilities(provider).dialogueAnyOutputFormat ? TTS_OUTPUT_FORMATS : [DEFAULT_TTS_OUTPUT_FORMAT]
}

/** The file a dialogue request on `provider` asks for, when it is one the model delivers; else undefined (the default MP3). */
export function dialogueOutputFormatFor(provider: unknown, value: unknown): TtsOutputFormat | undefined {
  return typeof value === "string" && (dialogueOutputFormats(provider) as readonly string[]).includes(value) ? (value as TtsOutputFormat) : undefined
}

/** A dialogue request as every lane reads it (the route's body, a node's data, the MCP verb's args mapped). */
export interface DialogueRequestShape {
  readonly dialogue?: unknown
  readonly speakers?: unknown
  /** The file asked for; judged against `dialogueOutputFormats` when given. */
  readonly outputFormat?: unknown
}

/** Why a dialogue request cannot run on its model: where, and the sentence a caller is answered with. */
export interface DialogueProblem {
  readonly path: ReadonlyArray<string | number>
  readonly message: string
}

/**
 * The speakers a dialogue clones for this request: the voice labels whose
 * `speakers` entry carries a `replica` (two https links), on a model that
 * clones (`TtsCapabilities.replica`); none on any other. The ONE predicate
 * every dialogue seam reads — the voice move, the check, the worker — so a
 * cloned speaker is kept on a model that clones and never silently voiced by
 * a stock voice in its place.
 */
export function dialogueReplicaVoices(provider: unknown, speakers: unknown): Set<string> {
  const id = dialogueProviderOf(provider)
  if (!ttsTakesReplica(id) || !Array.isArray(speakers)) return new Set()
  const out = new Set<string>()
  for (const entry of speakers) {
    const s = entry as { voice?: unknown; replica?: unknown } | null
    if (s && typeof s.voice === "string" && s.voice && replicaOf(s.replica)) out.add(s.voice)
  }
  return out
}

/** A cloned speaker's recordings in a dialogue request, by voice label (`dialogueReplicaVoices`' speakers). */
export function dialogueReplicaOf(provider: unknown, speakers: unknown, voice: string): ReturnType<typeof replicaOf> {
  if (!dialogueReplicaVoices(provider, speakers).has(voice) || !Array.isArray(speakers)) return undefined
  const entry = speakers.find((s) => (s as { voice?: unknown } | null)?.voice === voice) as { replica?: unknown } | undefined
  return replicaOf(entry?.replica)
}

/** The distinct voices of a script, in the order they first speak. */
export function dialogueVoicesOf(lines: unknown): string[] {
  if (!Array.isArray(lines)) return []
  const out: string[] = []
  for (const line of lines) {
    const voice = (line as { voice?: unknown } | null)?.voice
    if (typeof voice === "string" && !out.includes(voice)) out.push(voice)
  }
  return out
}

/**
 * The first reason a dialogue request cannot run on `provider`, or undefined.
 * The ONE rule the route's schema, the workflow engine and the MCP verb read,
 * so a script is refused the same way at every door and before any hold:
 * at most `dialogueMaxSpeakers` distinct voices; on a model with named voices
 * (Gemini) every voice one of them; a line's style within what the model takes
 * per line; each speaker's direction within what the model takes per speaker.
 * A field the model does not take is never sent, so it is no problem (as on
 * one speaker: `ttsDirectionProblem`). The script's length is the caller's to
 * judge (`dialogueTextBeforeCap`, @nodaro/prompts).
 */
export function dialogueProblem(provider: unknown, request: DialogueRequestShape): DialogueProblem | undefined {
  const id = dialogueProviderOf(provider)
  const sheet = getDialogueCapabilities(id)
  const lines = Array.isArray(request.dialogue) ? request.dialogue : []
  // One entry per speaker: two entries for one voice would leave which one applies to chance.
  if (Array.isArray(request.speakers)) {
    const seen = new Set<string>()
    for (let i = 0; i < request.speakers.length; i++) {
      const voice = (request.speakers[i] as { voice?: unknown } | null)?.voice
      if (typeof voice !== "string") continue
      if (seen.has(voice)) return { path: ["speakers", i, "voice"], message: `speakers lists the voice "${voice}" more than once; give each speaker one entry` }
      seen.add(voice)
    }
  }
  const voices = dialogueVoicesOf(lines)
  const max = dialogueMaxSpeakers(id)
  if (voices.length > max) {
    return { path: ["dialogue"], message: `A dialogue can use at most ${max} unique voices — reuse voices across lines or split the script into two nodes` }
  }
  // A one-off clone (`replica`) on a speaker: refused on a model that does not clone, never dropped.
  if (Array.isArray(request.speakers)) {
    for (let i = 0; i < request.speakers.length; i++) {
      const replica = (request.speakers[i] as { replica?: unknown } | null)?.replica
      const problem = ttsReplicaProblem(id, replica)
      if (problem) return { path: ["speakers", i, "replica"], message: problem }
    }
  }
  const clones = dialogueReplicaVoices(id, request.speakers)
  const named = sheet.voices
  if (named) {
    for (let i = 0; i < lines.length; i++) {
      const voice = (lines[i] as { voice?: unknown } | null)?.voice
      if (typeof voice === "string" && !clones.has(voice) && !named.some((v) => v.id === voice)) {
        return { path: ["dialogue", i, "voice"], message: `${voice} is not a voice of ${id}. Its voices: ${named.map((v) => v.id).join(", ")}` }
      }
    }
  }
  const styleMax = dialogueLineStyleMaxChars(id)
  if (styleMax !== undefined) {
    for (let i = 0; i < lines.length; i++) {
      const style = (lines[i] as { styleDirection?: unknown } | null)?.styleDirection
      if (style === undefined) continue
      if (typeof style !== "string") return { path: ["dialogue", i, "styleDirection"], message: "styleDirection must be a string" }
      if (style.trim().length > styleMax) return { path: ["dialogue", i, "styleDirection"], message: `styleDirection must be at most ${styleMax} characters` }
    }
  }
  if (request.outputFormat !== undefined && dialogueOutputFormatFor(id, request.outputFormat) === undefined) {
    return { path: ["outputFormat"], message: `outputFormat on ${id} must be one of: ${dialogueOutputFormats(id).join(", ")}` }
  }
  if (dialogueTakesSpeakerDirection(id) && Array.isArray(request.speakers)) {
    for (let i = 0; i < request.speakers.length; i++) {
      const speaker = request.speakers[i]
      if (!speaker || typeof speaker !== "object") continue
      const problem = ttsDirectionProblem(id, speaker as Record<string, unknown>)
      if (problem) return { path: ["speakers", i, problem.field], message: problem.message }
    }
  }
  return undefined
}
