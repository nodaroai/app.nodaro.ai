/**
 * speaker-map (podcast use-case nodes, decided 2026-10-12/17) — which camera
 * each speaker is on, worked out from the cameras' own microphones: the
 * structural pieces every caller shares (the canvas engines, MCP, the SDK).
 * HOW the levels are compared is the server's. Pure, no I/O.
 */
import type { Edl } from "./edl.js"

export const SPEAKER_MAP_VERSION = 1 as const
/** Recordings one run reads (cameras, plus the master when it also emits the edit). */
export const SPEAKER_MAP_MAX_SOURCES = 6
/** Candidate cameras a comparison needs. */
export const SPEAKER_MAP_MIN_CAMERAS = 2
/** How far the loudest camera must beat the next for the speaker to get it. */
export const SPEAKER_MAP_DEFAULT_MARGIN_DB = 3

export interface SpeakerMapConfidence {
  /** The camera the speaker got; "" = none clear (shown on the wide shot). */
  readonly camera: string
  /** The loudest camera's lead over the next, in dB; null when there was nothing to compare. */
  readonly marginDb: number | null
}

export interface SpeakerMapResult {
  readonly version: typeof SPEAKER_MAP_VERSION
  /** Transcript speaker label → camera source id; "" = no camera of their own. Feeds Camera Switch's `speakerMap`. */
  readonly speakerMap: Readonly<Record<string, string>>
  readonly confidence: Readonly<Record<string, SpeakerMapConfidence>>
  readonly notes: readonly string[]
  /** The recordings as one edit on the master clock (offsets applied, roles and speakers set, one segment). */
  readonly edl?: Edl
}

const parse = (raw: unknown): unknown => {
  if (typeof raw !== "string") return raw
  try { return JSON.parse(raw) } catch { return undefined }
}
const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v)

const isConfidence = (v: unknown): boolean =>
  isRecord(v) && typeof v.camera === "string" && (v.marginDb === null || (typeof v.marginDb === "number" && Number.isFinite(v.marginDb)))

/** A Speaker Map result (an object or its JSON string), or null when it is not
 *  one: every map value and confidence camera a string, every margin a finite
 *  number or null, every note a string — so a reader can trust each field. */
export function speakerMapResultOf(raw: unknown): SpeakerMapResult | null {
  const v = parse(raw)
  if (!isRecord(v) || v.version !== SPEAKER_MAP_VERSION || !isRecord(v.speakerMap) || !isRecord(v.confidence) || !Array.isArray(v.notes)) return null
  if (!Object.values(v.speakerMap).every((c) => typeof c === "string")) return null
  if (!Object.values(v.confidence).every(isConfidence)) return null
  if (!v.notes.every((n) => typeof n === "string")) return null
  return v as unknown as SpeakerMapResult
}

/** An ordinal key: a whole number from 1, written plainly ("1", "12" — never " 1", "01", "1.0", "1e0"). */
const ORDINAL = /^[1-9]\d*$/

/**
 * The override keyed by ordinal ("1" = the first voice heard) as a map keyed
 * by the transcript's own labels. `labels` is the transcript's speakers in
 * first-heard order — the caller passes `transcriptSpeakerLabels(transcript)`,
 * so this module imports nothing from camera-switch-contract (one import
 * direction: camera-switch-contract → speaker-map-contract, no cycle for the
 * structure ratchet). An ordinal past the transcript's speakers maps nobody,
 * and so do a key that is not a plain ordinal and an override that is not an
 * object (a hand-written workflow).
 */
export function speakerMapByOrdinal(labels: readonly string[], byOrder: Readonly<Record<string, string>> | undefined): Record<string, string> {
  if (!isRecord(byOrder)) return {}
  const out: Record<string, string> = {}
  for (const [ordinal, camera] of Object.entries(byOrder)) {
    if (!ORDINAL.test(ordinal)) continue
    const label = labels[Number(ordinal) - 1]
    if (label !== undefined && typeof camera === "string") out[label] = camera
  }
  return out
}
