import { REPLICA_MAX_BYTES, dialogueVoicesForModel, getDialogueCapabilities } from "@nodaro/shared/models"
import { replicaOf, ttsTakesReplica } from "@nodaro/shared/model-catalog"
import type { TtsReplica } from "@nodaro/shared/models"
import type { DialogueLine, DialogueSpeakerDirection } from "@/types/nodes"
import { dialogueTakesReplica, replicaConsentIsYours } from "./dialogue-direction"

export { replicaConsentIsYours }

/**
 * The editor's rules for a one-off clone of a person's voice (Gemini 3.8 Flash,
 * decided 2026-11-13): the recordings are the person's ordinary library uploads
 * (WAV), their links go in `replica`, and the person's consent is the record
 * the server signs for them (`replicaConsent: { userId, signature }`),
 * cleared whenever a recording changes. A clone runs only with both recordings
 * and the runner's OWN consent; otherwise the run is refused before any
 * request, never sent without it and never dropped for another voice.
 */

/** A clone switched on whose recordings are not in yet. */
export const PENDING_REPLICA: TtsReplica = { sourceAudioUrl: "", consentAudioUrl: "" }

/** Which recording: the reference (`sourceAudioUrl`) or the consent (`consentAudioUrl`). */
export type ReplicaRecording = "source" | "consent"

/** The clone with one recording set (or removed: `""`) — the consent always goes with the change. */
export function withRecording(replica: unknown, which: ReplicaRecording, url: string): { replica: TtsReplica; replicaConsent: undefined } {
  const current = replica && typeof replica === "object" ? (replica as Partial<TtsReplica>) : {}
  const next: TtsReplica = {
    sourceAudioUrl: which === "source" ? url : (typeof current.sourceAudioUrl === "string" ? current.sourceAudioUrl : ""),
    consentAudioUrl: which === "consent" ? url : (typeof current.consentAudioUrl === "string" ? current.consentAudioUrl : ""),
  }
  return { replica: next, replicaConsent: undefined }
}

/** Why a chosen file cannot be a recording, before it is uploaded: not a WAV, or over the size the platform takes. */
export function recordingFileProblem(file: { readonly name: string; readonly type: string; readonly size: number }): "not-wav" | "too-large" | undefined {
  const wav = /\.wav$/i.test(file.name) || file.type === "audio/wav" || file.type === "audio/x-wav" || file.type === "audio/wave"
  if (!wav) return "not-wav"
  return file.size > REPLICA_MAX_BYTES ? "too-large" : undefined
}

/** Why a clone cannot run yet, or undefined when it can (both recordings in and `userId`'s own consent). */
export function cloneRunProblem(replica: unknown, consent: unknown, userId: string | undefined): "recordings" | "consent" | undefined {
  if (!replicaOf(replica)) return "recordings"
  return replicaConsentIsYours(consent, userId) ? undefined : "consent"
}

/** A Text to Speech node's clone, as the run judges it: none, refused for the model, waiting on a recording or the consent, or ready. */
export function ttsCloneRunProblem(
  provider: string | undefined,
  data: { readonly replica?: unknown; readonly replicaConsent?: unknown },
  userId: string | undefined,
): "model" | "recordings" | "consent" | undefined {
  if (data.replica == null) return undefined
  if (!ttsTakesReplica(provider)) return "model"
  return cloneRunProblem(data.replica, data.replicaConsent, userId)
}

/** The clone labels of a dialogue node, in order: every speaker entry holding a clone (set up or ready), on a model that clones. */
export function dialogueCloneLabels(provider: unknown, speakers: unknown): string[] {
  if (!dialogueTakesReplica(provider) || !Array.isArray(speakers)) return []
  const out: string[] = []
  for (const s of speakers) {
    const entry = s as { voice?: unknown; replica?: unknown } | null
    if (entry && typeof entry.voice === "string" && entry.voice && entry.replica != null && !out.includes(entry.voice)) out.push(entry.voice)
  }
  return out
}

/** A stand-in pair of links for a clone whose recordings are not in yet, used ONLY to resolve voices in the panel. */
const SET_UP_CLONE: TtsReplica = { sourceAudioUrl: "https://clone.invalid/source.wav", consentAudioUrl: "https://clone.invalid/consent.wav" }

/**
 * Each line's voice as the panel shows it (`dialogueVoicesForModel`), where a
 * clone still waiting for its recordings keeps its label as a ready clone does.
 * The shared rule counts only a clone with both recordings, so without this a
 * line given a clone's label before its uploads would be shown, and written on
 * the next edit, as a named voice. The run never resolves a waiting clone: it
 * refuses first (`dialogueCloneRunProblem`).
 */
export function panelDialogueVoices(provider: unknown, voices: readonly unknown[], speakers: unknown): string[] {
  const labels = new Set(dialogueCloneLabels(provider, speakers))
  if (labels.size === 0 || !Array.isArray(speakers)) return dialogueVoicesForModel(provider, voices, speakers)
  const resolved = speakers.map((s) => {
    const entry = s as { voice?: unknown; replica?: unknown } | null
    return entry && typeof entry.voice === "string" && labels.has(entry.voice) && !replicaOf(entry.replica) ? { ...entry, replica: SET_UP_CLONE } : s
  })
  return dialogueVoicesForModel(provider, voices, resolved)
}

/**
 * Why a dialogue's clones cannot run, or undefined: a clone the script speaks
 * with (a line's voice is its label) needs both recordings and the consent. A
 * clone no line uses is not sent, so it is no problem.
 */
export function dialogueCloneRunProblem(provider: unknown, speakers: unknown, lineVoices: readonly unknown[], userId: string | undefined): "recordings" | "consent" | undefined {
  if (!dialogueTakesReplica(provider) || !Array.isArray(speakers)) return undefined
  const used = new Set(lineVoices.filter((v): v is string => typeof v === "string"))
  for (const s of speakers) {
    const entry = s as { voice?: unknown; replica?: unknown; replicaConsent?: unknown } | null
    if (!entry || entry.replica == null || typeof entry.voice !== "string" || !used.has(entry.voice)) continue
    const problem = cloneRunProblem(entry.replica, entry.replicaConsent, userId)
    if (problem) return problem
  }
  return undefined
}

/** The first default label not yet taken ("Cloned voice 1", "Cloned voice 2"…): `labelFor(n)` is the label in the page's language. */
export function nextCloneLabel(labelFor: (n: number) => string, taken: readonly string[]): string {
  for (let n = 1; ; n++) {
    const label = labelFor(n)
    if (!taken.includes(label)) return label
  }
}

/** Why a clone cannot take this name: none, or one another clone or a voice of the model already has. */
export function cloneLabelProblem(provider: unknown, label: string, otherLabels: readonly string[]): "empty" | "taken" | undefined {
  const name = label.trim()
  if (!name) return "empty"
  const named = getDialogueCapabilities(provider).voices ?? []
  return otherLabels.includes(name) || named.some((v) => v.id === name) ? "taken" : undefined
}

/** A clone renamed: its speaker entry and every line that speaks with it, in one write. */
export function renameClone(
  lines: readonly DialogueLine[],
  speakers: readonly DialogueSpeakerDirection[],
  from: string,
  to: string,
): { dialogue: DialogueLine[]; speakers: DialogueSpeakerDirection[] } {
  return {
    dialogue: lines.map((l) => (l.voice === from ? { ...l, voice: to, voiceLabel: to } : l)),
    speakers: speakers.map((s) => (s.voice === from ? { ...s, voice: to } : s)),
  }
}

/** The lines with each voice set to `sent[i]`, named by it; a line that keeps its voice is the same object. */
function withVoices(lines: readonly DialogueLine[], sent: readonly string[]): DialogueLine[] {
  return lines.map((line, i) => {
    const voice = sent[i]
    return voice === undefined || voice === line.voice ? line : { ...line, voice, voiceLabel: voice }
  })
}

/**
 * A clone removed: its speaker entry goes, and its lines move onto voices of
 * the model as the panel would show them (`panelDialogueVoices`), in the same
 * write, so no line keeps a label that no longer exists.
 */
export function removeClone(
  provider: unknown,
  lines: readonly DialogueLine[],
  speakers: readonly DialogueSpeakerDirection[],
  label: string,
): { dialogue: DialogueLine[]; speakers: DialogueSpeakerDirection[] | undefined } {
  const kept = speakers.filter((s) => s.voice !== label)
  const sent = panelDialogueVoices(provider, lines.map((l) => l.voice), kept)
  return { dialogue: withVoices(lines, sent), speakers: kept.length > 0 ? kept : undefined }
}
