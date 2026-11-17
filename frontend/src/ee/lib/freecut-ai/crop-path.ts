/**
 * The phone version's framing, as pure functions: where the face is, moment by
 * moment (from the platform's face boxes), a crop that follows it calmly, and
 * the editor edits that put the picture into 9:16 or back to wide.
 */
import type { ItemTransform, TimelineItemView, TimelineView } from "./edit-plan"

export interface FaceBox {
  /** Source seconds. */
  readonly t: number
  /** The face's center and width, as fractions of the frame. */
  readonly cx: number
  readonly w: number
}

/** A point of the crop's path: at source second `t`, the crop is centered at `cx` (a fraction of the frame width). */
export interface PathPoint {
  readonly t: number
  readonly cx: number
  /** It jumps here instead of gliding (another person, a new shot). */
  readonly cut?: boolean
}

interface TrackSetLike {
  readonly sources?: ReadonlyArray<{
    readonly tracks?: ReadonlyArray<{ readonly speaker?: string; readonly boxes?: ReadonlyArray<{ readonly ms: number; readonly x: number; readonly y: number; readonly w: number; readonly h: number }> }>
  }>
}

/** Who speaks at source second `t`: the speaker of the word then, or of the last word in the second before. */
export function speakerAt(words: ReadonlyArray<{ readonly start: number; readonly end: number; readonly speaker?: string }>, t: number): string | undefined {
  let last: string | undefined
  for (const w of words) {
    if (w.start > t) break
    if (w.end >= t - 1 && w.speaker) last = w.speaker
  }
  return last
}

/**
 * The face to frame at each sampled moment: the one who is speaking when the
 * face tracks are labelled with the speakers, else the biggest face (the
 * person closest to the camera, who talks in a talking video).
 */
export function mainFaces(set: TrackSetLike, speakerOf?: (t: number) => string | undefined): FaceBox[] {
  const byMs = new Map<number, ReadonlyArray<FaceBox & { readonly speaker?: string }>>()
  for (const source of set.sources ?? []) {
    for (const track of source.tracks ?? []) {
      for (const box of track.boxes ?? []) {
        if (!(box.w > 0) || !(box.h > 0)) continue
        const face = { t: box.ms / 1000, cx: Math.min(1, Math.max(0, box.x + box.w / 2)), w: box.w, ...(track.speaker ? { speaker: track.speaker } : {}) }
        byMs.set(box.ms, [...(byMs.get(box.ms) ?? []), face])
      }
    }
  }
  return [...byMs.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, faces]) => {
      const who = speakerOf?.(faces[0]!.t)
      const speaking = who ? faces.find((f) => f.speaker === who) : undefined
      const pick = speaking ?? faces.reduce((a, b) => (b.w > a.w ? b : a))
      return { t: pick.t, cx: pick.cx, w: pick.w }
    })
}

/**
 * A crop path that follows the face without fidgeting: it stays put while the
 * face stays within a dead zone, then glides, never faster than a set speed.
 */
export function followPath(faces: readonly FaceBox[], opts: { readonly deadZone?: number; readonly maxSpeed?: number; readonly cutOver?: number } = {}): PathPoint[] {
  const deadZone = opts.deadZone ?? 0.06
  const maxSpeed = opts.maxSpeed ?? 0.35 // frame widths per second
  // A jump this big (another person, a new shot) is cut to, never glided across the frame.
  const cutOver = opts.cutOver ?? 0.3
  if (faces.length === 0) return []
  const path: PathPoint[] = [{ t: faces[0]!.t, cx: faces[0]!.cx }]
  let cx = faces[0]!.cx
  let last = faces[0]!.t
  for (const face of faces.slice(1)) {
    const dt = Math.max(0, face.t - last)
    last = face.t
    const off = face.cx - cx
    if (Math.abs(off) > cutOver) {
      cx = face.cx
      path.push({ t: face.t, cx, cut: true })
      continue
    }
    if (Math.abs(off) > deadZone) {
      const want = off - Math.sign(off) * deadZone
      cx += Math.sign(want) * Math.min(Math.abs(want), maxSpeed * dt)
    }
    // Between detections (a face missed for a moment) the crop holds where it was.
    path.push({ t: face.t, cx })
  }
  return path
}

/** The crop's center at source second `t`, between the path's points. */
export function pathAt(path: readonly PathPoint[], t: number): number {
  if (path.length === 0) return 0.5
  if (t <= path[0]!.t) return path[0]!.cx
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]!
    const b = path[i]!
    if (t <= b.t) return a.cx + ((b.cx - a.cx) * (t - a.t)) / Math.max(1e-6, b.t - a.t)
  }
  return path.at(-1)!.cx
}

export interface Size {
  readonly width: number
  readonly height: number
}

/**
 * The transform that fills the canvas with the source and puts the crop's
 * center in the middle, as far as the source reaches (it never shows an edge).
 */
export function coverTransform(source: Size, canvas: Size, cx = 0.5): ItemTransform {
  const scale = Math.max(canvas.width / source.width, canvas.height / source.height)
  const width = Math.round(source.width * scale)
  const height = Math.round(source.height * scale)
  // Whole pixels the picture can move each way and still cover the canvas.
  const spare = Math.max(0, Math.floor((width - canvas.width) / 2))
  const x = Math.max(-spare, Math.min(spare, Math.round((0.5 - cx) * width)))
  return { x: x === 0 ? 0 : x, y: 0, width, height }
}

/** What the phone version keeps, so Wide | Phone can switch back and forth. */
export interface PhoneFraming {
  readonly mediaId: string
  readonly source: Size
  readonly wide: Size
  readonly phone: Size
  readonly path: readonly PathPoint[]
}

const PHONE: Size = { width: 1080, height: 1920 }
/** A keyframe only where the crop moved this much of the canvas width. */
const MIN_MOVE = 0.015

/** The phone version's framing for a video, from its face path. */
export function phoneFraming(mediaId: string, source: Size, wide: Size, path: readonly PathPoint[]): PhoneFraming {
  return { mediaId, source, wide, phone: PHONE, path }
}

/** A new frame drops the moves made for the old one (the crop, zooms, push-ins): they were in its pixels. */
const clearMotion = (itemId: string) => (["x", "width", "height"] as const).map((property) => ({ op: "removeKeyframes", itemId, property }))

/** The edits that frame one clip for the phone: its cover transform, and its crop moving with the face. */
function phonePieceOps(piece: TimelineItemView, framing: PhoneFraming, fps: number): Array<Record<string, unknown>> {
  const sourceFps = piece.sourceFps ?? fps
  const from = (piece.sourceStart ?? 0) / sourceFps
  const to = (piece.sourceEnd ?? (piece.sourceStart ?? 0) + piece.durationInFrames) / sourceFps
  const first = coverTransform(framing.source, framing.phone, pathAt(framing.path, from))
  const ops: Array<Record<string, unknown>> = [...clearMotion(piece.id), { op: "setTransform", id: piece.id, transform: first }]
  let lastX = first.x
  const keys: Array<{ readonly frame: number; readonly value: number; readonly easing: string }> = [{ frame: 0, value: first.x, easing: "ease-in-out" }]
  for (const point of framing.path.filter((p) => p.t > from && p.t < to)) {
    const x = coverTransform(framing.source, framing.phone, point.cx).x
    if (!point.cut && Math.abs(x - lastX) < MIN_MOVE * framing.phone.width) continue
    const frame = Math.round((point.t - from) * fps)
    // Held up to a cut, then straight to the new place.
    if (point.cut) keys.push({ frame: Math.max(0, frame - 1), value: lastX, easing: "hold" })
    lastX = x
    keys.push({ frame, value: x, easing: "ease-in-out" })
  }
  const ordered = keys.filter((k, i) => i === 0 || k.frame > keys[i - 1]!.frame)
  return [...ops, ...ordered.map((k) => ({ op: "addKeyframe", itemId: piece.id, property: "x", ...k }))]
}

/**
 * The edits that put the edit into the phone format (`to: "phone"`) or back to
 * wide: the canvas, the video's clips framed on the face, and every picture
 * laid over it (b-roll, a changed shot) filling the new canvas.
 */
export function formatOps(timeline: TimelineView, framing: PhoneFraming, to: "phone" | "wide"): Array<Record<string, unknown>> {
  const canvas = to === "phone" ? framing.phone : framing.wide
  const ops: Array<Record<string, unknown>> = [{ op: "setCanvas", width: canvas.width, height: canvas.height }]
  const pieces = timeline.items.filter((i) => i.type === "video" && i.mediaId === framing.mediaId)
  for (const piece of pieces) {
    if (to === "phone") ops.push(...phonePieceOps(piece, framing, timeline.fps))
    else ops.push(...clearMotion(piece.id), { op: "setTransform", id: piece.id, transform: coverTransform(framing.source, canvas) })
  }
  // Pictures laid over the video (b-roll, a changed shot) fill the new canvas, centered.
  const media = new Map((timeline.media ?? []).map((m) => [m.id, m]))
  for (const item of timeline.items) {
    if ((item.type !== "image" && item.type !== "video") || item.mediaId === framing.mediaId) continue
    const m = item.mediaId ? media.get(item.mediaId) : undefined
    const size = m?.width && m?.height ? { width: m.width, height: m.height } : framing.source
    ops.push(...clearMotion(item.id), { op: "setTransform", id: item.id, transform: coverTransform(size, canvas) })
  }
  return ops
}
