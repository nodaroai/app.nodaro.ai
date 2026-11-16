/**
 * The texts on the screen as the panel lists them, read from the editor's
 * timeline (so the list follows later cuts and an undo), and the part of the
 * frame a text may use at its moment: never on a picture.
 */
import type { TimelineItemView, TimelineView } from "./edit-plan"
import { boxOf, pictureSlots, placeOf } from "./picture-place"
import { PICTURE_FILE } from "./picture-rows"
import type { Rect } from "./speaker-layout"
import { DEFAULT_ENTRY, DEFAULT_TITLE_PLACE, TITLE_ID, type TitleLook, type TitleRecord } from "./title-style"

export interface TitleRow {
  /** The text item's id. */
  readonly key: string
  /** Timeline frames. */
  readonly from: number
  readonly to: number
  readonly trackId: string
  /** What the item says, as the editor reports it. */
  readonly text: string
  readonly record?: TitleRecord
}

type View = Pick<TimelineView, "items" | "media" | "tracks" | "width" | "height">

const textOf = (item: TimelineItemView) => item.text ?? item.label ?? ""

/** The texts on the screen, in order. */
export function titleRows(view: View, records: readonly TitleRecord[]): TitleRow[] {
  const byId = new Map(records.map((r) => [r.id, r]))
  return view.items
    .filter((item) => item.type === "text" && TITLE_ID.test(item.id))
    .map((item) => {
      const record = byId.get(item.id)
      return { key: item.id, from: item.from, to: item.from + item.durationInFrames, trackId: item.trackId, text: textOf(item), ...(record ? { record } : {}) }
    })
    .sort((a, b) => a.from - b.from)
}

/** What the panel takes a text to be when it no longer remembers laying it (the editor was reopened): its words, plainly. */
export function recordOf(row: TitleRow, look: TitleLook): TitleRecord {
  if (row.record) return row.record
  const list = row.text.includes("\n")
  return { id: row.key, kind: list ? "list" : "words", text: row.text, key: "", look, place: DEFAULT_TITLE_PLACE, entry: DEFAULT_ENTRY[list ? "list" : "words"] }
}

/** The track the panel's texts lie on, when there is one. */
export const titleTrackOf = (view: View): string | null => view.items.find((item) => item.type === "text" && TITLE_ID.test(item.id))?.trackId ?? null

/**
 * The part of the frame a text may use from `from` to `to`: the whole frame,
 * the speaker's part while a picture shows beside them or in a window, or
 * none (null) while a picture fills the frame.
 */
export function titleZone(view: View, from: number, to: number): Rect | null {
  const W = view.width ?? 0
  const H = view.height ?? 0
  const whole: Rect = { x: 0, y: 0, w: W, h: H }
  if (!W || !H) return whole
  const files = new Set((view.media ?? []).filter((m) => m.fileName && PICTURE_FILE.test(m.fileName)).map((m) => m.id))
  const pictures = view.items.filter((i) => i.mediaId && files.has(i.mediaId) && i.from < to && i.from + i.durationInFrames > from)
  let zone: Rect = whole
  for (const picture of pictures) {
    const place = placeOf(view, picture)
    if (place === "full") return null
    const slots = pictureSlots({ width: W, height: H }, place)
    if (place === "split" && slots.speaker) zone = slots.speaker
    else if (zone === whole) {
      // Beside a window on a wide frame, under it on a tall one.
      const win = picture.transform ? boxOf(picture.transform, { width: W, height: H }) : slots.picture
      zone = W >= H ? { x: win.x + win.w, y: 0, w: W - (win.x + win.w), h: H } : { x: 0, y: win.y + win.h, w: W, h: H - (win.y + win.h) }
    }
  }
  return zone
}
