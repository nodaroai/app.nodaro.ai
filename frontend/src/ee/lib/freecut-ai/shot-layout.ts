/**
 * A speaker layout decided shot by shot, as pure functions.
 *
 * An edited recording changes who is in the picture at every cut: two people
 * on a stage, then one guest alone, then a wide shot of four. So the layout is
 * not one split for the whole video. Each shot (the span between two of the
 * cuts the face tracks report) is framed for the people seen in it: one person
 * seen close fills the frame, two or three each get a part of their own, and a
 * shot with nobody, a crowd, or faces too small to enlarge is shown whole.
 *
 * On a phone frame the look stays one look through the changes: parts meet on
 * one seam (the first person above it, the others below), and a shot shown
 * whole is the picture at the frame's width over a blurred copy of itself,
 * ending near the same line. The captions sit on that line.
 *
 * On the timeline the video is split at the shot changes; a shot with several
 * parts shows its clip once per part (the copies), each cropped to its person.
 */
import type { Size } from "./crop-path"
import type { TimelineItemView } from "./edit-plan"
import { layoutSlots, slotPlacement, type Rect, type SpeakerFace, type SpeakerLayout } from "./speaker-layout"

type Box = { readonly ms: number; readonly x: number; readonly y: number; readonly w: number; readonly h: number; readonly score?: number }

export interface ShotTrackSet {
  readonly sampleFps?: number
  readonly sources?: ReadonlyArray<{
    /** Where the picture changes shot, in ms of the source. */
    readonly cuts?: readonly number[]
    readonly tracks?: ReadonlyArray<{ readonly boxes?: readonly Box[] }>
  }>
}

export interface Shot {
  readonly fromMs: number
  readonly toMs: number
  /** The people seen in the shot, left to right. */
  readonly people: readonly SpeakerFace[]
}

/** One person filling the frame, the whole picture, or a part per person. */
export type FramingKind = "close" | "whole" | "parts"

/** How one shot is shown: the parts of the canvas, and the region of the source that fills each. */
export interface ShotFraming {
  readonly fromMs: number
  readonly toMs: number
  readonly kind: FramingKind
  readonly slots: readonly Rect[]
  readonly regions: readonly Rect[]
  /** The first part is a blurred backdrop behind the second (the whole picture on a narrower frame). */
  readonly backdrop?: boolean
}

/** A find the detector is unsure of is nobody. */
const MIN_SCORE = 0.5
/** A person is in a shot for at least this share of the moments looked at in it. */
const MIN_SHOT_PRESENCE = 0.25
/** A face this much smaller than the shot's largest, and too small for a part, is in the background. */
const BACKGROUND_FACE = 0.38
/** Two finds this close in one shot, never seen at the same moment, are one person lost and found again. */
const SAME_PLACE = { x: 0.1, y: 0.14 }
/** A face smaller than this share of the picture's height is too small to give a part to. */
const MIN_PART_FACE = 0.07
/** People closer together than this share of the picture's width are shown together, not in parts. */
const MIN_PART_GAP = 0.15
/** The most parts one shot is split into. */
export const MAX_SHOT_PARTS = 3
/** A shot shorter than this is framed like the shot before it: a part that flashes by reads as a glitch. */
const MIN_SHOT_MS = 1200
/** How much of a person a region holds: its height in face heights. */
const FACE_HEIGHTS = { alone: 3.5, part: 3 }
/** A part never enlarges the picture more than this (against a picture at least this tall). */
const MAX_ENLARGE = 1.5
const REFERENCE_HEIGHT = 1080
/** One person fills a narrower frame only when their face is at least this share of the picture's height: smaller, and the enlargement shows. */
const CLOSE_FACE = 0.2
/** Where the parts of a phone frame meet, from its top. */
export const SEAM = 0.6
/** Where a picture shown whole ends on a phone frame, from its top: just above the captions. */
const WHOLE_END = 0.55

const median = (values: readonly number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? 0
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/** The shots of the recording, each with the people seen in it. */
export function shotsOf(set: ShotTrackSet): Shot[] {
  const source = set.sources?.[0]
  const tracks = (source?.tracks ?? []).map((t) => (t.boxes ?? []).filter((b) => b.w > 0 && b.h > 0 && (b.score ?? 1) >= MIN_SCORE)).filter((boxes) => boxes.length > 0)
  if (tracks.length === 0) return []
  const step = 1000 / (set.sampleFps ?? 2)
  const end = Math.max(...tracks.map((boxes) => boxes[boxes.length - 1]!.ms)) + step
  const edges = [0, ...[...(source?.cuts ?? [])].filter((c) => c > 0 && c < end).sort((a, b) => a - b), end]
  return edges.slice(0, -1).map((fromMs, i) => {
    const toMs = edges[i + 1]!
    const looked = Math.max(1, Math.round((toMs - fromMs) / step))
    // One person per place: a track lost and found again inside the shot is the same person.
    const found: Array<{ boxes: Box[]; moments: Set<number> }> = []
    const inShot = tracks.map((boxes) => boxes.filter((b) => b.ms >= fromMs && b.ms < toMs)).filter((boxes) => boxes.length > 0).sort((a, b) => b.length - a.length)
    for (const boxes of inShot) {
      const cx = median(boxes.map((b) => b.x + b.w / 2))
      const cy = median(boxes.map((b) => b.y + b.h / 2))
      const same = found.find((p) => Math.abs(median(p.boxes.map((b) => b.x + b.w / 2)) - cx) <= SAME_PLACE.x && Math.abs(median(p.boxes.map((b) => b.y + b.h / 2)) - cy) <= SAME_PLACE.y && !boxes.some((b) => p.moments.has(b.ms)))
      if (same) for (const b of boxes) (same.boxes.push(b), same.moments.add(b.ms))
      else found.push({ boxes: [...boxes], moments: new Set(boxes.map((b) => b.ms)) })
    }
    const faces = found
      .filter((p) => p.moments.size >= Math.max(2, looked * MIN_SHOT_PRESENCE))
      .map((p) => ({ cx: median(p.boxes.map((b) => b.x + b.w / 2)), cy: median(p.boxes.map((b) => b.y + b.h / 2)), w: median(p.boxes.map((b) => b.w)), h: median(p.boxes.map((b) => b.h)) }))
    const largest = Math.max(0, ...faces.map((f) => f.h))
    return { fromMs, toMs, people: faces.filter((f) => f.h >= largest * BACKGROUND_FACE || f.h >= MIN_PART_FACE).sort((a, b) => a.cx - b.cx) }
  })
}

/**
 * The region of the source that fills a slot with one person: as many face
 * heights around them as the framing asks, never so tight that the picture is
 * enlarged past what it can take, the slot's shape, the eyes a third from the
 * top, inside the picture.
 */
export function regionFor(face: SpeakerFace | null, slot: Rect, source: Size, alone: boolean, room = 1): Rect {
  // The slot's shape as a region of the source, in fractions: width per height.
  const shape = (slot.w / slot.h) * (source.height / source.width)
  const loosest = Math.min(1, 1 / shape)
  const tightest = Math.min(loosest, slot.h / (MAX_ENLARGE * Math.max(source.height, REFERENCE_HEIGHT)))
  // `room`: the widest the region may be (a part stops short of the person beside it), when the picture can take it.
  const roomy = Math.max(tightest, Math.min(loosest, room / shape))
  const h = face ? clamp(face.h * (alone ? FACE_HEIGHTS.alone : FACE_HEIGHTS.part), tightest, roomy) : loosest
  const w = h * shape
  const cx = face?.cx ?? 0.5
  // The eyes sit a little above the middle of a face; they go a third from the region's top.
  const eyes = face ? face.cy - face.h * 0.1 : 0.5 - h / 6
  return { x: clamp(cx - w / 2, 0, 1 - w), y: clamp(eyes - h / 3, 0, 1 - h), w, h }
}

/** The widest a person's part may be before the person beside them is in it too. */
const roomOf = (people: readonly SpeakerFace[], i: number) => 1.6 * Math.min(...people.filter((_, j) => j !== i).map((p) => Math.abs(p.cx - people[i]!.cx)))

/**
 * The parts of the canvas for `n` people. Stacked on a tall frame is the phone
 * look: the first person above the seam, the others side by side below it.
 */
export function partSlots(layout: SpeakerLayout, n: number, canvas: Size): Rect[] {
  if (layout !== "stacked" || canvas.height <= canvas.width) return layoutSlots(layout, n, canvas)
  const seam = Math.round(canvas.height * SEAM)
  const below = n - 1
  return [
    { x: 0, y: 0, w: canvas.width, h: seam },
    ...Array.from({ length: below }, (_, i) => ({ x: Math.round((canvas.width * i) / below), y: seam, w: Math.round(canvas.width / below), h: canvas.height - seam })),
  ]
}

type Framed = Omit<ShotFraming, "fromMs" | "toMs">

/**
 * A shot shown whole. A frame narrower than the picture cannot hold it without
 * bars: the picture sits at the frame's width over a blurred copy of itself.
 * Otherwise it is the picture as it is, centred on the people.
 */
function wholeFraming(people: readonly SpeakerFace[], canvas: Size, source: Size): Framed {
  const whole: Rect = { x: 0, y: 0, w: canvas.width, h: canvas.height }
  const loose = regionFor(null, whole, source, true)
  if (canvas.width / canvas.height < source.width / source.height - 0.01) {
    const band = Math.round((canvas.width * source.height) / source.width)
    return { kind: "whole", slots: [whole, { x: 0, y: Math.max(0, Math.round(canvas.height * WHOLE_END) - band), w: canvas.width, h: band }], regions: [loose, { x: 0, y: 0, w: 1, h: 1 }], backdrop: true }
  }
  const middle = people.length > 1 ? people.reduce((a, p) => a + p.cx, 0) / people.length : 0.5
  return { kind: "whole", slots: [whole], regions: [{ ...loose, x: clamp(middle - loose.w / 2, 0, 1 - loose.w) }] }
}

/** A part per person, in the order given: the first is the one above the seam. */
function partsFraming(people: readonly SpeakerFace[], layout: SpeakerLayout, canvas: Size, source: Size): Framed {
  const slots = partSlots(layout, people.length, canvas)
  return { kind: "parts", slots, regions: slots.map((slot, i) => regionFor(people[i]!, slot, source, false, roomOf(people, i))) }
}

/** How a person can ask for a shot to be shown. */
export type ShownAs = "close" | "whole" | "two" | "three"

/**
 * A shot shown the way a person chose, with the person at `first` (counted
 * from the left) in front: alone in the frame, or above the seam. Null when the
 * shot has too few people for the parts asked for.
 */
export function chosenFraming(as: ShownAs, people: readonly SpeakerFace[], first: number, layout: SpeakerLayout, canvas: Size, source: Size): Framed | null {
  if (as === "whole") return wholeFraming(people, canvas, source)
  const front = people[clamp(first, 0, Math.max(0, people.length - 1))]
  const whole: Rect = { x: 0, y: 0, w: canvas.width, h: canvas.height }
  if (as === "close") return { kind: "close", slots: [whole], regions: [regionFor(front ?? null, whole, source, true)] }
  const n = as === "two" ? 2 : 3
  if (!front || people.length < n) return null
  return partsFraming([front, ...people.filter((p) => p !== front)].slice(0, n), layout, canvas, source)
}

const close = (a: Rect, b: Rect) => Math.abs(a.x - b.x) < 0.04 && Math.abs(a.y - b.y) < 0.04 && Math.abs(a.w - b.w) < 0.04

/**
 * How each shot is shown in the layout asked for. Neighbouring shots framed
 * alike are one framing, and a shot too short to read takes the framing of
 * the shot before it, so the video is split only where the picture changes.
 */
export function shotFramings(shots: readonly Shot[], layout: SpeakerLayout, canvas: Size, source: Size): ShotFraming[] {
  const whole: Rect = { x: 0, y: 0, w: canvas.width, h: canvas.height }
  const narrower = canvas.width / canvas.height < source.width / source.height - 0.01
  const framings: ShotFraming[] = []
  for (const shot of shots) {
    const people = shot.people
    const parts = people.length >= 2 && people.length <= MAX_SHOT_PARTS && people.every((p, i) => p.h >= MIN_PART_FACE && (i === 0 || p.cx - people[i - 1]!.cx >= MIN_PART_GAP))
    const alone = people.length === 1 && (!narrower || people[0]!.h >= CLOSE_FACE)
    // A part per person; one person seen close fills the frame; nobody, a crowd or small faces: the shot whole.
    const next: Framed = parts ? partsFraming(people, layout, canvas, source) : alone ? { kind: "close", slots: [whole], regions: [regionFor(people[0]!, whole, source, true)] } : wholeFraming(people, canvas, source)
    const regions = next.regions
    const last = framings[framings.length - 1]
    const brief = shot.toMs - shot.fromMs < MIN_SHOT_MS
    if (last && (brief || (last.kind === next.kind && last.slots.length === next.slots.length && last.regions.every((r, i) => close(r, regions[i]!))))) {
      framings[framings.length - 1] = { ...last, toMs: shot.toMs }
    } else {
      framings.push({ ...next, regions, fromMs: shot.fromMs, toMs: shot.toMs })
    }
  }
  return framings
}

type Piece = Pick<TimelineItemView, "id" | "from" | "durationInFrames" | "sourceStart" | "sourceEnd" | "sourceFps" | "speed">

const clearMotion = (itemId: string) => (["x", "y", "width", "height"] as const).map((property) => ({ op: "removeKeyframes", itemId, property }))

/** Where a piece's source starts, in seconds, and how many timeline frames one source second takes. */
const clock = (piece: Piece, fps: number) => ({ start: (piece.sourceStart ?? 0) / (piece.sourceFps ?? fps), perSecond: fps / (piece.speed && piece.speed > 0 ? piece.speed : 1) })

/** The timeline frames where the video's clips are split: every change of framing that falls inside a clip. */
export function splitFramesOf(pieces: readonly Piece[], framings: readonly ShotFraming[], fps: number): number[] {
  const frames: number[] = []
  for (const framing of framings.slice(1)) {
    const t = framing.fromMs / 1000
    for (const piece of pieces) {
      const { start, perSecond } = clock(piece, fps)
      const frame = piece.from + Math.round((t - start) * perSecond)
      if (frame > piece.from && frame < piece.from + piece.durationInFrames) frames.push(frame)
    }
  }
  return [...new Set(frames)].sort((a, b) => a - b)
}

/** The people in the shot a piece shows (by the middle of the piece), left to right. */
export function peopleOfPiece(piece: Piece, shots: readonly Shot[], fps: number): readonly SpeakerFace[] {
  const { start, perSecond } = clock(piece, fps)
  const middleMs = (start + piece.durationInFrames / 2 / perSecond) * 1000
  return shots.find((s) => middleMs >= s.fromMs && middleMs < s.toMs)?.people ?? []
}

/** The edits that crop and place one clip per part of a framing (`ids`: the clip of each part, in order), named when `label` is given. */
export function placementOps(framing: Pick<ShotFraming, "slots" | "regions">, ids: readonly string[], source: Size, canvas: Size, label?: string): Array<Record<string, unknown>> {
  return framing.slots.flatMap((slot, i) => {
    const id = ids[i]
    if (!id) return []
    const { crop, transform } = slotPlacement(framing.regions[i]!, slot, source, canvas)
    return [...clearMotion(id), { op: "updateItem", id, updates: { crop, ...(label ? { label } : {}) } }, { op: "setTransform", id, transform }]
  })
}

/** How soft a backdrop is, in the editor's blur radius. */
export const BACKDROP_BLUR = 40

/** The framing of the shot a piece shows (by the middle of the piece). */
export function framingOfPiece(piece: Piece, framings: readonly ShotFraming[], fps: number): ShotFraming | undefined {
  const { start, perSecond } = clock(piece, fps)
  const middleMs = (start + piece.durationInFrames / 2 / perSecond) * 1000
  return framings.find((f) => middleMs >= f.fromMs && middleMs < f.toMs) ?? (middleMs < (framings[0]?.fromMs ?? 0) ? framings[0] : framings[framings.length - 1])
}


/**
 * The edits that show every piece in its shot's framing: the canvas, then each
 * piece cropped to its shot's first region and placed in the first part, and
 * its copies (`copiesOf`: a piece's copies, in part order) in the parts after.
 * A piece that is a backdrop is blurred. `names`: what the timeline calls a
 * piece of each kind, when it should say.
 */
export function shotLayoutOps(
  canvas: Size,
  source: Size,
  pieces: readonly Piece[],
  framings: readonly ShotFraming[],
  fps: number,
  copiesOf: ReadonlyMap<string, readonly string[]>,
  names?: (framing: ShotFraming) => string | undefined,
): Array<Record<string, unknown>> {
  const ops: Array<Record<string, unknown>> = [{ op: "setCanvas", width: canvas.width, height: canvas.height }]
  const backdrops: string[] = []
  for (const piece of pieces) {
    const framing = framingOfPiece(piece, framings, fps)
    if (!framing) continue
    const ids = [piece.id, ...(copiesOf.get(piece.id) ?? [])]
    ops.push(...placementOps(framing, ids, source, canvas, names?.(framing)))
    if (framing.backdrop && ids.length > 1) backdrops.push(piece.id)
  }
  if (backdrops.length > 0) ops.push({ op: "blurItems", ids: backdrops, radius: BACKDROP_BLUR })
  return ops
}
