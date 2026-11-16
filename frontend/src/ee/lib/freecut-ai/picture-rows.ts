/**
 * The pictures laid over the words (b-roll), read back from the timeline as
 * the editor reports it: each clip whose file the panel made or the person
 * gave, in order, joined with what the run knows about it (the words it
 * illustrates, what it shows). A picture the image model would not make has no
 * clip, so it is listed from the run's record, where its words are now. Read
 * from the clips themselves, so the list is right after later cuts and an undo.
 */
import { timelineFrameOf, type TimelineView } from "./edit-plan"

/** A picture comes in a moment before its words. */
export const PICTURE_LEAD_SECONDS = 0.3
const MIN_SECONDS = 1.6
const MAX_SECONDS = 3.2

/** How long a picture stays over words of this length. */
export const pictureSeconds = (start: number, end: number) => Math.min(MAX_SECONDS, Math.max(MIN_SECONDS, end - start))

/** Every picture file the panel lays is named so; the person's own carry `-mine`. */
export const PICTURE_FILE = /^ai-broll/i
const OWN_FILE = /^ai-broll-mine/i

/** A picture file's name in the editor, for a picture made (`mine: false`) or given by the person. */
export const pictureFileBase = (mine: boolean, stamp: string, n: number) => `ai-broll-${mine ? "mine-" : ""}${stamp}-${n}`

const baseOf = (fileName: string) => fileName.replace(/\.[a-z0-9]+$/i, "")

/** What a run knows about one picture. */
export interface PictureRecord {
  /** The file's name in the editor, without its extension. */
  readonly id: string
  /** Two to four words, in the language of the video. */
  readonly label: string
  /** The words it illustrates. */
  readonly said: string
  /** What it shows, as the image model was asked (English). */
  readonly prompt: string
  /** Those words, in seconds of the video. */
  readonly start: number
  readonly end: number
  /** The video it lies over, as the editor knows it. */
  readonly mediaId: string
  /** Where the platform keeps a picture it made, for the panel to show. */
  readonly url?: string
  /** It was not made. */
  readonly failed?: boolean
  /** Why, in the platform's own words, when it said. */
  readonly reason?: string
}

export type PictureSource = "made" | "mine" | "none"

export interface PictureRow {
  readonly key: string
  readonly source: PictureSource
  /** Timeline frames. */
  readonly from: number
  readonly to: number
  /** The clip, for a picture that is on the timeline. */
  readonly itemId?: string
  readonly record?: PictureRecord
}

type View = Pick<TimelineView, "items" | "media" | "fps">

/** The pictures on the words, in order: the clips on the timeline, and the ones that were not made. */
export function pictureRows(view: View, records: readonly PictureRecord[]): PictureRow[] {
  const files = new Map((view.media ?? []).filter((m) => m.fileName && PICTURE_FILE.test(m.fileName)).map((m) => [m.id, m.fileName!]))
  const byId = new Map(records.map((r) => [r.id, r]))
  const rows: PictureRow[] = []
  for (const item of view.items) {
    const file = item.mediaId ? files.get(item.mediaId) : undefined
    if (!file) continue
    const record = byId.get(baseOf(file))
    rows.push({ key: item.id, source: OWN_FILE.test(file) ? "mine" : "made", from: item.from, to: item.from + item.durationInFrames, itemId: item.id, ...(record ? { record } : {}) })
  }
  for (const record of records) {
    if (!record.failed) continue
    const timeline = view as TimelineView
    const at = timelineFrameOf(timeline, record.mediaId, Math.max(0, record.start - PICTURE_LEAD_SECONDS)) ?? timelineFrameOf(timeline, record.mediaId, record.start)
    // Its words were cut away since: nothing to list.
    if (!at) continue
    rows.push({ key: `none:${record.id}`, source: "none", from: at.frame, to: at.frame + Math.round(pictureSeconds(record.start, record.end) * view.fps), record })
  }
  return rows.sort((a, b) => a.from - b.from)
}

/** How many pictures come from each source. */
export function pictureCounts(rows: readonly PictureRow[]): Record<PictureSource, number> {
  const counts: Record<PictureSource, number> = { made: 0, mine: 0, none: 0 }
  for (const row of rows) counts[row.source] += 1
  return counts
}
