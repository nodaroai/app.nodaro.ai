/**
 * The `speakerRegions` rows Speaker View's route accepts, read off whatever a
 * node carries. One reading for the wire (`speakerViewWireSettings`) and for
 * `autoRegions`, which only fills in when no such row is drawn. Pure.
 */
import { SPEAKER_VIEW_MIN_REGION } from "./speaker-view-settings.js"

export interface SpeakerRegionWireRow {
  readonly source: string
  readonly speaker: string
  readonly region: { readonly x: number; readonly y: number; readonly w: number; readonly h: number }
}

const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined)

/** The rows the route will accept: ids that are strings and a region inside
 *  the frame no smaller than the minimum side; `undefined` when none is. */
export function cleanSpeakerRegions(raw: unknown): SpeakerRegionWireRow[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const rows = raw.flatMap((row): SpeakerRegionWireRow[] => {
    const r = row as { source?: unknown; speaker?: unknown; region?: Record<string, unknown> } | null
    if (!r || typeof r.source !== "string" || !r.source || typeof r.speaker !== "string" || !r.speaker) return []
    const [x, y, w, h] = [r.region?.x, r.region?.y, r.region?.w, r.region?.h].map(num)
    if (x === undefined || y === undefined || w === undefined || h === undefined) return []
    if (x < 0 || y < 0 || x + w > 1 + 1e-9 || y + h > 1 + 1e-9 || w < SPEAKER_VIEW_MIN_REGION || h < SPEAKER_VIEW_MIN_REGION) return []
    return [{ source: r.source, speaker: r.speaker, region: { x, y, w, h } }]
  })
  return rows.length > 0 ? rows : undefined
}
