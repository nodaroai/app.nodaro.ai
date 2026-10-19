/**
 * What one Speaker Map run is sent, read off the node's wired inputs and its
 * data — the rules both engines apply before anything is reserved (the
 * server's payload, the editor's run), so a run is refused, ordered and
 * normalized the same way wherever it starts. Pure. Names no node type: the
 * caller passes its own when it words a problem.
 */
import { SPEAKER_MAP_DEFAULT_MARGIN_DB, SPEAKER_MAP_MAX_SOURCES, SPEAKER_MAP_MIN_CAMERAS, transcriptSpeakerLabels } from "@nodaro/shared/edl"
import { orderSourceRows, type UnitInputValue, type UnitSourceRow } from "./unit-input-lanes"

/** The largest lead (dB) a run takes: the route refuses more, a run from the canvas is clamped to it. */
export const SPEAKER_MAP_MAX_MARGIN_DB = 30

/** A JSON input's value: a string parsed when it is JSON, anything else as it is. */
export function parseJsonInput(raw: unknown): unknown {
  if (typeof raw !== "string") return raw
  try {
    return JSON.parse(raw) as unknown
  } catch {
    return raw
  }
}

/** Whether a value (or its JSON) is an Audio Sync result: an object with an `offsets` list. */
export function isAudioSyncResult(raw: unknown): boolean {
  const v = parseJsonInput(raw)
  return !!v && typeof v === "object" && !Array.isArray(v) && Array.isArray((v as { offsets?: unknown }).offsets)
}

/** The lead a run uses: a finite number clamped to 0–30 dB, else the 3 dB default. */
export function speakerMapMarginDb(raw: unknown): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return SPEAKER_MAP_DEFAULT_MARGIN_DB
  return Math.min(SPEAKER_MAP_MAX_MARGIN_DB, Math.max(0, raw))
}

/** Why a run is refused, in the order the checks run. */
export type SpeakerMapRunProblem =
  | { readonly code: "joined-sources"; readonly sourceId: string }
  | { readonly code: "too-few-sources"; readonly count: number }
  | { readonly code: "too-many-sources"; readonly count: number }
  | { readonly code: "unfetchable-source"; readonly sourceId: string }
  | { readonly code: "no-transcript" }
  | { readonly code: "empty-transcript" }
  | { readonly code: "no-speakers" }
  | { readonly code: "empty-offsets" }
  | { readonly code: "not-audio-sync" }
  | { readonly code: "wide-sound-only"; readonly sourceId: string }
  | { readonly code: "wide-is-master"; readonly sourceId: string }

/** The run's body (the route's, less the caller's own fields). */
export interface SpeakerMapRunBody {
  readonly sources: UnitSourceRow[]
  readonly transcript: unknown
  readonly offsets?: unknown
  readonly masterSourceId?: string
  readonly wideSourceId?: string
  readonly marginDb: number
}

const isString = (v: unknown): v is string => typeof v === "string"

/**
 * The run of a node holding `data` with `unitInputs` wired (undefined =
 * nothing wired): its body, or the first problem.
 * - Sources: the Cameras rows in `data.sourceOrder` (`orderSourceRows`). A
 *   List wired as a whole lands its items joined into one value — named, not
 *   counted as one recording (a media URL holds no whitespace). Then 2–6
 *   recordings, then each fetchable by the caller's own rule (`fetchable`;
 *   none = every URL passes).
 * - A wired JSON input whose upstream produced nothing is "" — refused, never
 *   read as unwired. The transcript must carry speaker labels; the offsets,
 *   when wired, must be an Audio Sync result.
 * - A master / wide naming a recording no longer wired is dropped (the panel
 *   shows none); the wide must be a camera and not the master.
 * - The lead is `speakerMapMarginDb(data.marginDb)`.
 */
export function speakerMapRunInputs(
  unitInputs: Readonly<Record<string, UnitInputValue>> | undefined,
  data: Readonly<Record<string, unknown>>,
  opts: { readonly fetchable?: (url: string) => boolean } = {},
): { readonly body: SpeakerMapRunBody } | { readonly problem: SpeakerMapRunProblem } {
  const wired = unitInputs?.sources
  const order = Array.isArray(data.sourceOrder) ? (data.sourceOrder as unknown[]).filter(isString) : undefined
  const sources = orderSourceRows(Array.isArray(wired) ? wired : [], order).map(({ id, url, kind }) => ({ id, url, kind }))
  const joined = sources.find((s) => /\s/.test(s.url.trim()))
  if (joined) return { problem: { code: "joined-sources", sourceId: joined.id } }
  if (sources.length < SPEAKER_MAP_MIN_CAMERAS) return { problem: { code: "too-few-sources", count: sources.length } }
  if (sources.length > SPEAKER_MAP_MAX_SOURCES) return { problem: { code: "too-many-sources", count: sources.length } }
  const unfetchable = opts.fetchable ? sources.find((s) => !opts.fetchable!(s.url)) : undefined
  if (unfetchable) return { problem: { code: "unfetchable-source", sourceId: unfetchable.id } }

  const transcriptIn = unitInputs?.transcript
  if (typeof transcriptIn !== "string") return { problem: { code: "no-transcript" } }
  if (transcriptIn === "") return { problem: { code: "empty-transcript" } }
  const transcript = parseJsonInput(transcriptIn)
  if (transcriptSpeakerLabels(transcript).length === 0) return { problem: { code: "no-speakers" } }

  const offsetsIn = unitInputs?.offsets
  if (offsetsIn === "") return { problem: { code: "empty-offsets" } }
  if (offsetsIn !== undefined && !isAudioSyncResult(offsetsIn)) return { problem: { code: "not-audio-sync" } }

  const wiredId = (k: "masterSourceId" | "wideSourceId") => {
    const id = data[k]
    return typeof id === "string" && sources.some((s) => s.id === id) ? id : undefined
  }
  const masterSourceId = wiredId("masterSourceId")
  const wideSourceId = wiredId("wideSourceId")
  if (wideSourceId && sources.find((s) => s.id === wideSourceId)?.kind === "audio") return { problem: { code: "wide-sound-only", sourceId: wideSourceId } }
  if (wideSourceId && wideSourceId === masterSourceId) return { problem: { code: "wide-is-master", sourceId: wideSourceId } }

  return {
    body: {
      sources,
      transcript,
      ...(offsetsIn !== undefined ? { offsets: parseJsonInput(offsetsIn) } : {}),
      ...(masterSourceId ? { masterSourceId } : {}),
      ...(wideSourceId ? { wideSourceId } : {}),
      marginDb: speakerMapMarginDb(data.marginDb),
    },
  }
}

/** A problem in words, for a node of type `type` labelled `label` (each engine's own refusal text). */
export function speakerMapRunProblemText(problem: SpeakerMapRunProblem, who: { readonly type: string; readonly label: string }): string {
  const node = `${who.type}: node "${who.label}"`
  switch (problem.code) {
    case "joined-sources": return `${node} received several recordings joined into one from "${problem.sourceId}" — connect each recording to the Cameras input on its own`
    case "too-few-sources": return `${node} needs at least ${SPEAKER_MAP_MIN_CAMERAS} recordings — connect them to the Cameras input`
    case "too-many-sources": return `${node} takes at most ${SPEAKER_MAP_MAX_SOURCES} recordings — ${problem.count} are connected to the Cameras input`
    case "unfetchable-source": return `${node} received something that is not a media URL from "${problem.sourceId}" — check the connection feeding its Cameras input`
    case "no-transcript": return `${node} needs a transcript — connect Transcribe (with speaker detection on) to its Transcript input`
    case "empty-transcript": return `${node} got nothing on its Transcript input — run the node wired to it first`
    case "no-speakers": return `${who.type}: the transcript has no speaker labels — turn on speaker detection in Transcribe.`
    case "empty-offsets": return `${node} got nothing on its Offsets input — run the node wired to it first, or disconnect it`
    case "not-audio-sync": return `${node} received something that is not an Audio Sync result on its Offsets input — connect Audio Sync's output to it`
    case "wide-sound-only": return `${node} has the sound-only recording "${problem.sourceId}" as its wide shot — pick a camera`
    case "wide-is-master": return `${node} has "${problem.sourceId}" as both its master audio and its wide shot — pick a different one for each`
  }
}
