/**
 * What a use-case run on several recordings or a Master audio reports about
 * its cameras (decided 2026-10-17): per speaker, first heard first, the camera
 * position Speaker Map gave them (null = no camera of their own: the wide
 * shot) and its lead in dB, plus Audio Sync's and Speaker Map's notes
 * verbatim. The wrapper job carries it on `cameras`, the server engine's node
 * output and the node's saved data on `useCaseCameras` — one shape, one
 * reader (`usecaseCamerasReportOf`) for every lane. Pure.
 */

/** One speaker of a multicam run, first heard first: the camera Speaker Map put them on. */
export interface UseCaseCameraSpeaker {
  /** The transcript's own label. */
  readonly speaker: string
  /** 1 = the first voice heard (what a Cameras override names). */
  readonly ordinal: number
  /** The recording's position (1-based); null = no camera of their own (the wide shot). */
  readonly camera: number | null
  /** How far their camera's level led the next (dB); null when unknown. */
  readonly marginDb: number | null
}

export interface UseCaseCamerasReport {
  readonly speakers: readonly UseCaseCameraSpeaker[]
  /** Audio Sync's notes, verbatim. */
  readonly syncNotes: readonly string[]
  /** Speaker Map's notes, verbatim. */
  readonly mapNotes: readonly string[]
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v)
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null)
const notes = (v: readonly unknown[]): string[] => v.filter((n): n is string => typeof n === "string")

/** A cameras report as a lane reads it, when it is one: a speaker row or note of another shape is dropped. */
export function usecaseCamerasReportOf(raw: unknown): UseCaseCamerasReport | undefined {
  if (!isRecord(raw) || !Array.isArray(raw.speakers) || !Array.isArray(raw.syncNotes) || !Array.isArray(raw.mapNotes)) return undefined
  return {
    speakers: raw.speakers.flatMap((s): UseCaseCameraSpeaker[] => {
      if (!isRecord(s) || typeof s.speaker !== "string" || typeof s.ordinal !== "number") return []
      return [{ speaker: s.speaker, ordinal: s.ordinal, camera: num(s.camera), marginDb: num(s.marginDb) }]
    }),
    syncNotes: notes(raw.syncNotes),
    mapNotes: notes(raw.mapNotes),
  }
}
