/**
 * Where a speaker layout changes, read back from the timeline as the editor
 * reports it: a moment that shows the video once is one person close, twice is
 * two parts (or the whole picture over its blurred copy), three times is three
 * parts. Read from the clips themselves, so the list is right after later
 * cuts, after an undo, and when the project is opened again.
 */
import type { TimelineItemView, TimelineView } from "./edit-plan"
import { allSpeakerCopies } from "./picture-place"

export type ShotKind = "close" | "whole" | "two" | "three"

export interface LayoutRow {
  readonly kind: ShotKind
  /** Timeline frames. */
  readonly from: number
  readonly to: number
}

/** One moment of the laid-out video: its footage clip, and the copies shown with it (nearest the footage first). */
export interface LaidMoment {
  readonly footage: TimelineItemView
  readonly copies: readonly TimelineItemView[]
}

type View = Pick<TimelineView, "items" | "tracks" | "media" | "width" | "height">

/** The video laid out on the timeline (the one shown several times at one moment), moment by moment. */
export function laidVideo(view: Pick<TimelineView, "items" | "tracks" | "media">): { readonly mediaId: string; readonly moments: readonly LaidMoment[] } | null {
  const order = new Map((view.tracks ?? []).map((t) => [t.id, t.order ?? 0]))
  // The speaker's copy beside a picture on the words is that picture's, not a part of a speaker layout.
  const beside = allSpeakerCopies(view)
  const byMedia = new Map<string, Map<string, TimelineItemView[]>>()
  for (const item of view.items) {
    if (item.type !== "video" || !item.mediaId || beside.has(item.id)) continue
    const moments = byMedia.get(item.mediaId) ?? new Map<string, TimelineItemView[]>()
    const key = `${item.from}:${item.durationInFrames}`
    moments.set(key, [...(moments.get(key) ?? []), item])
    byMedia.set(item.mediaId, moments)
  }
  const laid = [...byMedia].filter(([, moments]) => [...moments.values()].some((items) => items.length > 1)).sort((a, b) => b[1].size - a[1].size)[0]
  if (!laid) return null
  // Lower `order` is higher on screen: the footage is the highest order, the copy in front the lowest.
  const moments = [...laid[1].values()]
    .map((items) => {
      const [footage, ...copies] = [...items].sort((a, b) => (order.get(b.trackId) ?? 0) - (order.get(a.trackId) ?? 0))
      return { footage: footage!, copies }
    })
    .sort((a, b) => a.footage.from - b.footage.from)
  return { mediaId: laid[0], moments }
}

/** How one moment is shown. */
function kindOf(moment: LaidMoment, view: View): ShotKind {
  if (moment.copies.length >= 2) return "three"
  if (moment.copies.length === 0) return "close"
  // The whole picture sits at the frame's width and is shorter than the frame; a part fills its share of it.
  const front = moment.copies[moment.copies.length - 1]!.transform
  return view.width !== undefined && view.height !== undefined && front !== undefined && front.width <= view.width + 2 && front.height < view.height * 0.9 ? "whole" : "two"
}

/** The rows of the layout on the timeline, in order; none when no video is laid out. */
export function layoutRows(view: View): LayoutRow[] {
  const rows: LayoutRow[] = []
  for (const moment of laidVideo(view)?.moments ?? []) {
    const { from, durationInFrames } = moment.footage
    const kind = kindOf(moment, view)
    const last = rows[rows.length - 1]
    if (last && last.kind === kind && from <= last.to) rows[rows.length - 1] = { ...last, to: from + durationInFrames }
    else rows.push({ kind, from, to: from + durationInFrames })
  }
  return rows
}

/** How many frames of the layout are shown each way. */
export function layoutShares(rows: readonly LayoutRow[]): Record<ShotKind, number> {
  const shares: Record<ShotKind, number> = { close: 0, whole: 0, two: 0, three: 0 }
  for (const row of rows) shares[row.kind] += row.to - row.from
  return shares
}
