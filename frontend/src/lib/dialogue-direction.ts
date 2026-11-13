import {
  TTS_PROVIDERS,
  dialogueLineStyleFor,
  dialogueLineStyleMaxChars,
  dialogueMaxSpeakers,
  dialogueProviderOf,
  dialogueSpeakerDirectionFor,
  dialogueTakesFillerWords,
  dialogueTakesSpeakerDirection,
  getDialogueCapabilities,
} from "@nodaro/shared/models"
import { replicaOf, ttsTakesReplica } from "@nodaro/shared/model-catalog"
import type { TtsReplica } from "@nodaro/shared/models"
import type { DialogueLine, DialogueSpeakerDirection } from "@/types/nodes"

/**
 * The Text to Dialogue node's per-line and per-speaker direction in the
 * editor (decided 2026-11-12). The shape rule is the platform's, read from
 * the model's sheet (`@nodaro/shared/models`, the same functions the route's
 * `dialogueProblem` and the server's run read):
 *   - a free-text style (`styleMaxChars`, no `styles` list) is written PER LINE
 *     (`DialogueLine.styleDirection`: Gemini 3.8) — `dialogueLineStyleMaxChars`,
 *     `dialogueLineStyleFor`;
 *   - every other direction field the sheet takes (a `styles` choice, `paces`,
 *     `accents`, `audioProfileMaxChars`) is written PER SPEAKER
 *     (`TextToDialogueData.speakers`, keyed by voice: Gemini 3.1 / 2.5) —
 *     `dialogueTakesSpeakerDirection`, `dialogueSpeakerDirectionFor`.
 * A value of the other shape is never shown and never sent. This module adds
 * what the panel, the model switch and the run do with them.
 */

/** The cap of a per-line style on the dialogue model, or `undefined` when its lines take none. */
export const dialogueLineStyleMax = dialogueLineStyleMaxChars
export { dialogueLineStyleFor, dialogueSpeakerDirectionFor, dialogueTakesSpeakerDirection }

const SPEAKER_FIELDS = ["styleDirection", "pace", "accent", "audioProfile"] as const

/** The dialogue model speaks a speaker in a person's own voice, cloned for the request (`replica`; Gemini 3.8 Flash, decided 2026-11-13). */
export function dialogueTakesReplica(provider: unknown): boolean {
  return ttsTakesReplica(dialogueProviderOf(provider))
}

/**
 * The consent on a clone is the viewer's own: the record the server issued to them (`{ userId, signature }`,
 * decided 2026-11-13). A record issued to someone else (a template's or a published app's copy), a legacy
 * `true` or none is not, so the box shows unticked and the run refuses until they tick it themselves.
 */
export function replicaConsentIsYours(record: unknown, userId: string | undefined): boolean {
  if (!userId || !record || typeof record !== "object") return false
  const { userId: owner, signature } = record as { userId?: unknown; signature?: unknown }
  return owner === userId && typeof signature === "string" && signature.length > 0
}

/** Some speaker of the node holds a one-off clone (any value: a malformed one is refused, never dropped). */
export function dialogueHoldsReplica(speakers: unknown): boolean {
  return Array.isArray(speakers) && speakers.some((s) => s !== null && typeof s === "object" && (s as { replica?: unknown }).replica != null)
}

/**
 * The speakers' entries after the lines' voices moved (`stored[i]` → `sent[i]`,
 * a model switch or a mapped model), re-keyed to the voice each now speaks
 * with. Each keeps only the fields the model takes (as stored, so a value the
 * person is typing is not trimmed under them), and its clone (`replica` and
 * its `replicaConsent`, as stored) only on a model that clones; an entry with
 * nothing left, with no voice, or for a voice already listed is dropped.
 */
export function remapDialogueSpeakers(
  provider: unknown,
  speakers: readonly unknown[] | undefined,
  stored: readonly unknown[],
  sent: readonly string[],
): DialogueSpeakerDirection[] {
  if (!Array.isArray(speakers)) return []
  const moved = new Map<string, string>()
  stored.forEach((v, i) => {
    if (typeof v === "string" && !moved.has(v) && sent[i] !== undefined) moved.set(v, sent[i]!)
  })
  const out: DialogueSpeakerDirection[] = []
  const seen = new Set<string>()
  for (const entry of speakers) {
    if (!entry || typeof entry !== "object") continue
    const fields = entry as Record<string, unknown>
    const own = typeof fields.voice === "string" ? fields.voice : ""
    const voice = moved.get(own) ?? own
    if (!voice || seen.has(voice)) continue
    const kept = dialogueSpeakerDirectionFor(provider, fields)
    const next: Record<string, unknown> = {}
    for (const f of SPEAKER_FIELDS) {
      if (kept[f] !== undefined && typeof fields[f] === "string") next[f] = fields[f] as string
    }
    if (fields.replica != null && dialogueTakesReplica(provider)) {
      next.replica = fields.replica
      // The consent goes with its recordings: kept beside them (as stored), dropped with them.
      if (fields.replicaConsent != null) next.replicaConsent = fields.replicaConsent
    }
    if (Object.keys(next).length === 0) continue
    seen.add(voice)
    out.push({ voice, ...next } as DialogueSpeakerDirection)
  }
  return out
}

/**
 * What the run sends as `speakers`: the entries of the voices the script
 * speaks with, each as the model takes it — its direction, and on a model that
 * clones its `{ voice, replica }` (the label the lines use and the two
 * recordings). A clone that is not two https links is sent as it is, so the
 * platform refuses it rather than another voice speaking in its place.
 */
export function dialogueSpeakersFor(
  provider: unknown,
  speakers: readonly unknown[] | undefined,
  stored: readonly unknown[],
  sent: readonly string[],
  /** Who runs it: only their own consent says `consent: true` (`replicaConsentIsYours`). */
  userId?: string,
): DialogueSpeakerDirection[] {
  if (!dialogueTakesSpeakerDirection(provider) && !dialogueTakesReplica(provider)) return []
  const inScript = new Set(sent.filter(Boolean))
  return remapDialogueSpeakers(provider, speakers, stored, sent)
    .filter((s) => inScript.has(s.voice))
    .map((s) => {
      const links = s.replica !== undefined ? (replicaOf(s.replica) ?? (s.replica as TtsReplica)) : undefined
      // The person's consent rides with the clone as the route's attestation (`consent: true`); the run refuses
      // an unconsented clone a line uses before any request (`dialogueCloneRunProblem`).
      const replica = links && replicaConsentIsYours(s.replicaConsent, userId) ? { ...links, consent: true as const } : links
      return { voice: s.voice, ...dialogueSpeakerDirectionFor(provider, { ...s }), ...(replica !== undefined ? { replica } : {}) }
    })
    .filter((s) => Object.keys(s).length > 1)
}

/** The distinct voices of a script, in line order (an empty voice is none). */
export function dialogueSpeakerVoices(voices: readonly string[]): string[] {
  return [...new Set(voices.filter(Boolean))]
}

/** Filler words are offered: the model takes them and the script has exactly two speakers. */
export function dialogueFillerWordsOffered(provider: unknown, sent: readonly string[]): boolean {
  return dialogueTakesFillerWords(provider) && dialogueSpeakerVoices(sent).length === 2
}

/** What the run sends as `fillerWords`: the node's choice, only where it is offered. */
export function dialogueFillerWordsFor(provider: unknown, value: unknown, sent: readonly string[]): boolean | undefined {
  return typeof value === "boolean" && dialogueFillerWordsOffered(provider, sent) ? value : undefined
}

/**
 * The provider the per-line tag-aware text area judges tags by, or `undefined`
 * (no warnings, the general tag menu — what every dialogue model had before).
 * The tag helpers read the TEXT-TO-SPEECH lane's sheet; only a dialogue model
 * that is also a text-to-speech model (one id in both lanes: Gemini) is read
 * there as itself. An ElevenLabs dialogue id would be read as the text-to-speech
 * fallback model, whose tag rules are not its own.
 */
export function dialogueTagProvider(provider: unknown): string | undefined {
  return typeof provider === "string" && (TTS_PROVIDERS as readonly string[]).includes(provider) ? provider : undefined
}

/**
 * The model takes the ElevenLabs dialogue endpoint's own options (seed, text
 * normalization, the length advice): the models that speak the ElevenLabs
 * voices. The sheet has no flag for them yet; a model with named voices runs
 * on another provider, which takes neither.
 */
export function dialogueTakesElevenLabsOptions(provider: unknown): boolean {
  return getDialogueCapabilities(provider).voices === undefined
}

/**
 * The voice a new line starts with on a model with named voices (Gemini), so a
 * new line keeps the script within its speakers: the most recent voice other
 * than the last line's (the turns alternate); when every line has the same
 * voice, a voice of the model the script does not use yet (its default first),
 * which makes the new line the second speaker. `undefined` on a model that
 * speaks the ElevenLabs voices (the panel's default voice applies there).
 */
export function dialogueNewLineVoice(provider: unknown, sent: readonly string[]): string | undefined {
  const sheet = getDialogueCapabilities(provider)
  if (!sheet.voices) return undefined
  const last = sent[sent.length - 1]
  for (let i = sent.length - 1; i >= 0; i--) {
    if (sent[i] && sent[i] !== last) return sent[i]
  }
  const fallback = last || sheet.defaultVoice || sheet.voices[0]?.id
  if (dialogueMaxSpeakers(provider) < 2) return fallback
  const used = new Set(sent)
  return [sheet.defaultVoice, ...sheet.voices.map((v) => v.id)].find((v): v is string => typeof v === "string" && !used.has(v)) ?? fallback
}

/**
 * The lines with each voice set to the one the run sends (`sent[i]`): a line
 * whose voice moves takes the new voice and is named by it (none on an empty
 * voice). A line that keeps its voice is the same object.
 */
export function withDialogueVoices(lines: readonly DialogueLine[], sent: readonly string[]): DialogueLine[] {
  return lines.map((line, i) => {
    const voice = sent[i]
    if (voice === undefined || voice === line.voice) return line
    if (voice) return { ...line, voice, voiceLabel: voice }
    const copy: Record<string, unknown> = { ...line, voice }
    delete copy.voiceLabel
    return copy as unknown as DialogueLine
  })
}

/**
 * The speakers' list after the person edits one speaker's direction: `patch`
 * merged into that voice's entry (made when missing). A field set to nothing
 * (`undefined`, an emptied text) leaves the entry, an entry with nothing left
 * leaves the list, and an empty list is `undefined` (the key goes).
 */
export function upsertDialogueSpeaker(
  speakers: readonly DialogueSpeakerDirection[] | undefined,
  voice: string,
  patch: Partial<Omit<DialogueSpeakerDirection, "voice">>,
): DialogueSpeakerDirection[] | undefined {
  const list = Array.isArray(speakers) ? speakers : []
  const at = list.findIndex((s) => s?.voice === voice)
  const merged: Record<string, unknown> = { ...(at >= 0 ? list[at] : {}), ...patch, voice }
  for (const f of SPEAKER_FIELDS) {
    if (merged[f] === undefined || merged[f] === "") delete merged[f]
  }
  const entry = merged as unknown as DialogueSpeakerDirection
  // A clone keeps its entry too: editing a cloned speaker's direction never drops the person's voice.
  const filled = SPEAKER_FIELDS.some((f) => entry[f] !== undefined) || entry.replica !== undefined
  const next = at >= 0
    ? list.flatMap((s, i) => (i !== at ? [s] : filled ? [entry] : []))
    : filled ? [...list, entry] : [...list]
  return next.length > 0 ? next : undefined
}
