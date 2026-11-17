/**
 * Where a picture on the words shows in the frame: beside the speaker (the
 * frame split in two, the default), in a window over the video, or filling
 * the frame. Pure geometry; `run/place-picture.ts` sends it to the editor.
 *
 * Beside the speaker leaves the footage as it is: for the picture's seconds a
 * silent copy of the footage, cropped to the speaker, takes one half and the
 * picture the other, and the two cover the footage under them. Taking the
 * picture off is taking both off; nothing has to be put back.
 */
import type { ItemTransform, TimelineItemView, TimelineView } from "./edit-plan"
import { PICTURE_FILE } from "./picture-rows"
import { slotPlacement, type Rect } from "./speaker-layout"

/** The part of the frame a clip's box covers, as far as it is inside the frame. */
export function boxOf(transform: ItemTransform, canvas: Canvas): Rect {
  const left = Math.max(0, canvas.width / 2 + transform.x - transform.width / 2)
  const top = Math.max(0, canvas.height / 2 + transform.y - transform.height / 2)
  const right = Math.min(canvas.width, canvas.width / 2 + transform.x + transform.width / 2)
  const bottom = Math.min(canvas.height, canvas.height / 2 + transform.y + transform.height / 2)
  return { x: left, y: top, w: Math.max(0, right - left), h: Math.max(0, bottom - top) }
}

export const PICTURE_PLACES = ["split", "window", "full"] as const
export type PicturePlace = (typeof PICTURE_PLACES)[number]
export const DEFAULT_PICTURE_PLACE: PicturePlace = "split"

export interface Canvas {
  readonly width: number
  readonly height: number
}

/** A window's corners: a fortieth of the frame's shorter side. */
export const windowCornerRadius = (canvas: Canvas) => Math.round(Math.min(canvas.width, canvas.height) * 0.025)

/**
 * The part of the frame the picture takes, and the speaker's part when the
 * frame is split. A window takes the picture's own shape (`aspect`, its width
 * over its height), as large as fits the room a window has, so nothing of it
 * is cut and its corners can be rounded. On a tall frame it sits in the middle
 * across, above the speaker's face.
 */
export function pictureSlots(canvas: Canvas, place: PicturePlace, aspect?: number): { readonly picture: Rect; readonly speaker?: Rect } {
  const { width: W, height: H } = canvas
  const wide = W >= H
  if (place === "full") return { picture: { x: 0, y: 0, w: W, h: H } }
  if (place === "window") {
    // The room a window has; a picture of another shape takes the largest part of it that keeps its shape.
    const room = wide ? { w: Math.round(W * 0.5), h: Math.round(H * 0.62) } : { w: Math.round(W * 0.84), h: Math.round(H * 0.36) }
    const scale = aspect ? Math.min(room.w / aspect, room.h) : room.h
    const w = aspect ? Math.round(scale * aspect) : room.w
    const h = Math.round(scale)
    return { picture: wide ? { x: Math.round(W * 0.06), y: Math.round(H * 0.1), w, h } : { x: Math.round((W - w) / 2), y: Math.round(H * 0.06), w, h } }
  }
  // A wide frame is split left and right; a tall one, top and bottom. The picture comes first.
  const half = wide ? Math.round(W / 2) : Math.round(H / 2)
  return wide
    ? { picture: { x: 0, y: 0, w: half, h: H }, speaker: { x: half, y: 0, w: W - half, h: H } }
    : { picture: { x: 0, y: 0, w: W, h: half }, speaker: { x: 0, y: half, w: W, h: H - half } }
}

/** The shape to ask the image model for, so the picture fills its part without losing much. */
export const pictureAspect = (canvas: Canvas, place: PicturePlace): "1:1" | "9:16" | "16:9" => (place === "split" ? "1:1" : canvas.height > canvas.width ? "9:16" : "16:9")

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/** The part of a clip's picture the frame shows now, as fractions of the picture, from where the clip is placed. */
export function visibleRegion(transform: ItemTransform, canvas: Canvas): Rect {
  const left = clamp((transform.width / 2 - canvas.width / 2 - transform.x) / transform.width, 0, 1)
  const top = clamp((transform.height / 2 - canvas.height / 2 - transform.y) / transform.height, 0, 1)
  return { x: left, y: top, w: clamp(canvas.width / transform.width, 0, 1 - left), h: clamp(canvas.height / transform.height, 0, 1 - top) }
}

/**
 * The part of what the frame shows that the speaker's half keeps: the largest
 * piece of it in the half's shape, centred across, and a little above the
 * middle (a face sits in the upper part of a talking shot).
 */
export function speakerRegion(visible: Rect, slot: Rect, picture: Canvas): Rect {
  const vw = visible.w * picture.width
  const vh = visible.h * picture.height
  const shape = slot.w / slot.h
  const [rw, rh] = vw / vh > shape ? [vh * shape, vh] : [vw, vw / shape]
  return { x: (visible.x * picture.width + (vw - rw) / 2) / picture.width, y: (visible.y * picture.height + (vh - rh) * 0.3) / picture.height, w: rw / picture.width, h: rh / picture.height }
}

/** The middle of a picture, in the shape of its part of the frame. */
export function coverRegion(picture: Canvas, slot: Rect): Rect {
  const shape = slot.w / slot.h
  const [rw, rh] = picture.width / picture.height > shape ? [picture.height * shape, picture.height] : [picture.width, picture.width / shape]
  return { x: (picture.width - rw) / 2 / picture.width, y: (picture.height - rh) / 2 / picture.height, w: rw / picture.width, h: rh / picture.height }
}

const clearMotion = (itemId: string) => (["x", "y", "width", "height"] as const).map((property) => ({ op: "removeKeyframes", itemId, property }))

/** The edits that show `region` of a clip in `slot` of the frame, still (its earlier moves taken off). */
export function slotOps(itemId: string, region: Rect, slot: Rect, picture: Canvas, canvas: Canvas, cornerRadius = 0): Array<Record<string, unknown>> {
  const { crop, transform } = slotPlacement(region, slot, picture, canvas)
  // The corners are always named, so a picture moved out of a window loses its rounding.
  return [...clearMotion(itemId), { op: "updateItem", id: itemId, updates: { crop } }, { op: "setTransform", id: itemId, transform: { ...transform, cornerRadius } }]
}

type View = Pick<TimelineView, "items" | "tracks" | "media">

const sameMoment = (a: TimelineItemView, b: TimelineItemView) => a.from === b.from && a.durationInFrames === b.durationInFrames

const pictureMediaOf = (view: View) => new Set((view.media ?? []).filter((m) => m.fileName && PICTURE_FILE.test(m.fileName)).map((m) => m.id))

/**
 * The speaker's copies laid beside a picture: clips of a video at exactly the
 * picture's moment that sit in front of another clip of the same video (the
 * footage is the one furthest back).
 */
export function speakerCopiesOf(view: View, picture: TimelineItemView): TimelineItemView[] {
  const order = new Map((view.tracks ?? []).map((t) => [t.id, t.order ?? 0]))
  const pictures = pictureMediaOf(view)
  const back = (item: TimelineItemView) => order.get(item.trackId) ?? 0
  return view.items.filter(
    (item) =>
      item.type === "video" &&
      !!item.mediaId &&
      !pictures.has(item.mediaId) &&
      sameMoment(item, picture) &&
      view.items.some((other) => other.id !== item.id && other.mediaId === item.mediaId && other.type === "video" && other.from <= item.from && other.from + other.durationInFrames >= item.from + item.durationInFrames && back(other) > back(item)),
  )
}

/** Every speaker's copy laid beside a picture: clips the speaker layout's own list must not count. */
export function allSpeakerCopies(view: View): Set<string> {
  const pictures = pictureMediaOf(view)
  const ids = new Set<string>()
  for (const item of view.items) {
    if (!item.mediaId || !pictures.has(item.mediaId)) continue
    for (const copy of speakerCopiesOf(view, item)) ids.add(copy.id)
  }
  return ids
}

/** The video a picture lies over: the video clip furthest back under its first frame. */
export function videoUnder(view: View, frame: number): string | null {
  const order = new Map((view.tracks ?? []).map((t) => [t.id, t.order ?? 0]))
  const pictures = pictureMediaOf(view)
  const under = view.items
    .filter((i) => i.type === "video" && !!i.mediaId && !pictures.has(i.mediaId) && i.from <= frame && i.from + i.durationInFrames > frame)
    .sort((a, b) => (order.get(b.trackId) ?? 0) - (order.get(a.trackId) ?? 0))
  return under[0]?.mediaId ?? null
}

/** How a picture on the timeline shows now. */
export function placeOf(view: View & Partial<Canvas>, picture: TimelineItemView): PicturePlace {
  if (speakerCopiesOf(view, picture).length > 0) return "split"
  const t = picture.transform
  if (!t || view.width === undefined || view.height === undefined) return "full"
  return t.width >= view.width - 2 && t.height >= view.height - 2 ? "full" : "window"
}
