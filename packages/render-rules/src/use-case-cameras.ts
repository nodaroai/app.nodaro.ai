/**
 * The recordings of a use-case node (decided 2026-10-17): up to six in all,
 * Master audio included, and the Cameras settings a node with 2+
 * recordings shows — which recording is the wide shot, whether the recordings
 * already share one clock (no Audio Sync), and an override of who is on which
 * camera. Pure.
 *
 * Recording ids: the first keeps P1's `uc-source` (so one recording builds
 * exactly as before); recording i (0-based, i ≥ 1) is `uc-cam-<i + 1>`; the
 * master is `uc-master`. A camera is addressed by its POSITION (1-based, in
 * the recordings' order) everywhere a person or an agent names one; a builder
 * turns a position into the id.
 */
import { orderSourceRows } from "./unit-input-lanes"

export const USE_CASE_MAX_RECORDINGS = 6
export const USE_CASE_MASTER_NODE_ID = "uc-master"

/** The built node recording `index` (0-based) stands for. */
export function usecaseRecordingNodeId(index: number): string {
  return index === 0 ? "uc-source" : `uc-cam-${index + 1}`
}

/** The position (1-based) of the recording a built node stands for, or null for any other node. */
export function usecaseRecordingPosition(nodeId: string): number | null {
  if (nodeId === "uc-source") return 1
  const m = /^uc-cam-([1-9]\d*)$/.exec(nodeId)
  const position = m ? Number(m[1]) : null
  return position !== null && position >= 2 && position <= USE_CASE_MAX_RECORDINGS ? position : null
}

/** How many recordings a run has, and whether Master audio is wired: what the Cameras settings are resolved against. */
export interface UseCaseSourcesShape {
  readonly recordings: number
  readonly masterAudio: boolean
}

export interface UseCaseCameras {
  /** The wide shot's position (1-based), or null for none. */
  readonly wide: number | null
  /** The recordings already share one clock: no Audio Sync. */
  readonly synced: boolean
  /**
   * Who is on which camera, overriding the automatic map: speaker ordinal
   * ("1" = the first voice heard) → camera position, 0 = no camera of their
   * own (the wide shot).
   */
  readonly speakerCameras: Readonly<Record<string, number>>
}

export const USE_CASE_CAMERAS_DEFAULTS: UseCaseCameras = Object.freeze({ wide: null, synced: false, speakerCameras: Object.freeze({}) })

const isInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v)
const isPlainRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v)
/** A speaker ordinal a Cameras override may name: "1" up to the most recordings a run takes. */
const isSpeakerOrdinal = (s: string): boolean => /^[1-9]\d*$/.test(s) && Number(s) <= USE_CASE_MAX_RECORDINGS

/**
 * The node's raw `cameras` as a run reads them: anything unknown or out of
 * range falls back (never passed on). One recording without a master has
 * nothing to line up: the defaults.
 */
export function resolveUseCaseCameras(raw: unknown, shape: UseCaseSourcesShape | undefined): UseCaseCameras {
  const n = shape?.recordings ?? 1
  if (n < 2 && !shape?.masterAudio) return USE_CASE_CAMERAS_DEFAULTS
  const r = isPlainRecord(raw) ? raw : {}
  const wide = isInt(r.wide) && r.wide >= 1 && r.wide <= n ? r.wide : null
  const speakerCameras: Record<string, number> = {}
  for (const [ordinal, cam] of Object.entries(isPlainRecord(r.speakerCameras) ? r.speakerCameras : {})) {
    if (!isSpeakerOrdinal(ordinal) || !isInt(cam) || cam < 0 || cam > n) continue
    speakerCameras[ordinal] = cam
  }
  return { wide, synced: r.synced === true, speakerCameras }
}

/**
 * The node's `mediaOrder` as an ordering reads it: the ids it lists, or none.
 * Nothing validates it on write (a hand edit, an import or an agent may write
 * anything), so a value that is not a list of ids never breaks a run or an
 * estimate: it orders nothing.
 */
export function usecaseMediaOrderOf(data: unknown): readonly string[] | undefined {
  const order = isPlainRecord(data) ? data.mediaOrder : undefined
  return Array.isArray(order) ? order.filter((id): id is string => typeof id === "string") : undefined
}

/**
 * The order recordings are sent and built in — BOTH engines and the estimate
 * call this (decided 2026-10-17): the node's `mediaOrder` (source node ids)
 * first, then any other wired recording in wire order, one row per upstream
 * node. The one ordering rule (`orderSourceRows`), keyed by the upstream node.
 */
export function orderUseCaseMedia<T extends { readonly nodeId: string }>(wired: readonly T[], order: readonly string[] | undefined): T[] {
  return orderSourceRows(wired, order, (w) => w.nodeId)
}

/**
 * The recordings a run of a node reads, in order — what both engines send and
 * the estimate builds on: the wired recordings ordered by the node's
 * `mediaOrder` (read through `usecaseMediaOrderOf`), up to as many as its type
 * takes (`maxRecordings`); a wire past the last is not read.
 */
export function usecaseRecordingsOf<T extends { readonly nodeId: string }>(wired: readonly T[] | undefined, data: unknown, maxRecordings: number): T[] {
  return orderUseCaseMedia(wired ?? [], usecaseMediaOrderOf(data)).slice(0, maxRecordings)
}
