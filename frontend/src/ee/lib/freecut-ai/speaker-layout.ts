/**
 * A speaker layout, as pure functions: who is in the picture and where (from
 * the platform's face tracks, or an even split of the frame by the speakers
 * heard), the parts of the canvas a layout gives them, and the editor edits
 * that show each speaker in a part of their own.
 *
 * One recording is shown several times: each speaker's part is a copy of the
 * video's clips, cropped to that speaker and placed in their part.
 */
import type { SpeakerLayoutKind, TimelineItemView, TimelineView } from "./edit-plan"
import type { Size } from "./crop-path"

export type SpeakerLayout = SpeakerLayoutKind

/** The most speakers a layout shows. */
export const MAX_LAYOUT_SPEAKERS = 4

/** A rectangle: of the source picture in fractions (a region), or of the canvas in pixels from its top-left (a slot). */
export interface Rect {
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
}

export interface SpeakerFace {
  /** The face's center and size, as fractions of the picture. */
  readonly cx: number
  readonly cy: number
  readonly w: number
  readonly h: number
  /** The speaker this face is, when the tracks say. */
  readonly speaker?: string
}

interface TrackSetLike {
  readonly sources?: ReadonlyArray<{
    readonly tracks?: ReadonlyArray<{ readonly speaker?: string; readonly boxes?: ReadonlyArray<{ readonly ms: number; readonly x: number; readonly y: number; readonly w: number; readonly h: number }> }>
  }>
}

const median = (values: readonly number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? 0

type Box = { readonly ms: number; readonly x: number; readonly y: number; readonly w: number; readonly h: number; readonly score?: number }
interface Person {
  readonly speaker?: string
  readonly boxes: Box[]
  readonly moments: Set<number>
}

/** A find the detector is unsure of is nobody. */
const MIN_SCORE = 0.5
/** Two tracks this close (in picture widths and heights) and never seen at the same moment are one person. */
const SAME_PLACE = { x: 0.14, y: 0.18 }
/** A person is in the picture for at least this share of the moments looked at. */
const MIN_PRESENCE = 0.3

/**
 * The people in the picture, as the face tracks show them. A detector's
 * tracks are not people: one person is many tracks (lost and found again), and
 * some tracks are not a face at all (a lamp, a poster). So tracks are grouped:
 * by the speaker they are attributed to when any are, else by where they are
 * (two tracks in one place that never appear together are the same person),
 * and only someone present for a real share of the video counts.
 */
function peopleOf(set: TrackSetLike): Person[] {
  const tracks = (set.sources ?? [])
    .flatMap((s) => s.tracks ?? [])
    .map((t) => ({ speaker: t.speaker, boxes: (t.boxes ?? []).filter((b) => b.w > 0 && b.h > 0 && ((b as Box).score ?? 1) >= MIN_SCORE) as Box[] }))
    .filter((t) => t.boxes.length > 0)
  // Tracks the platform tied to a speaker are the people; the rest are then set aside.
  const named = tracks.filter((t) => t.speaker)
  const pool = (named.length > 0 ? named : tracks).sort((a, b) => b.boxes.length - a.boxes.length)
  const people: Person[] = []
  for (const track of pool) {
    const cx = median(track.boxes.map((b) => b.x + b.w / 2))
    const cy = median(track.boxes.map((b) => b.y + b.h / 2))
    const same = people.find((p) => {
      if (track.speaker || p.speaker) return track.speaker === p.speaker
      const pcx = median(p.boxes.map((b) => b.x + b.w / 2))
      const pcy = median(p.boxes.map((b) => b.y + b.h / 2))
      if (Math.abs(pcx - cx) > SAME_PLACE.x || Math.abs(pcy - cy) > SAME_PLACE.y) return false
      const together = track.boxes.filter((b) => p.moments.has(b.ms)).length
      return together <= track.boxes.length * 0.1
    })
    if (same) {
      for (const b of track.boxes) {
        same.boxes.push(b)
        same.moments.add(b.ms)
      }
    } else {
      people.push({ speaker: track.speaker, boxes: [...track.boxes], moments: new Set(track.boxes.map((b) => b.ms)) })
    }
  }
  const looked = new Set(tracks.flatMap((t) => t.boxes.map((b) => b.ms))).size
  return people.filter((p) => p.moments.size >= Math.max(4, looked * MIN_PRESENCE)).sort((a, b) => b.moments.size - a.moments.size)
}

/**
 * The people to lay out, left to right: at most as many as were heard speaking
 * (when the video was heard: someone seen and never heard is not a speaker, and
 * a thing the detector took for a face is nobody), the most present first.
 */
export function facesOf(set: TrackSetLike, heard?: number): SpeakerFace[] {
  const limit = Math.min(MAX_LAYOUT_SPEAKERS, heard === undefined ? MAX_LAYOUT_SPEAKERS : Math.max(1, heard))
  return peopleOf(set)
    .slice(0, limit)
    .map((p) => ({
      cx: median(p.boxes.map((b) => b.x + b.w / 2)),
      cy: median(p.boxes.map((b) => b.y + b.h / 2)),
      w: median(p.boxes.map((b) => b.w)),
      h: median(p.boxes.map((b) => b.h)),
      ...(p.speaker ? { speaker: p.speaker } : {}),
    }))
    .sort((a, b) => a.cx - b.cx)
}

/** The same tracks with only real people's boxes in them: what a crop that follows the face should follow. */
export function peopleTracks(set: TrackSetLike, heard?: number): TrackSetLike {
  const limit = Math.min(MAX_LAYOUT_SPEAKERS, heard === undefined ? MAX_LAYOUT_SPEAKERS : Math.max(1, heard))
  return { sources: [{ tracks: peopleOf(set).slice(0, limit).map((p) => ({ ...(p.speaker ? { speaker: p.speaker } : {}), boxes: [...p.boxes].sort((a, b) => a.ms - b.ms) })) }] }
}

/** The speakers heard, first voice first: a voice heard only briefly (under 5% of the talk) is nobody's part. */
export function speakersHeard(words: ReadonlyArray<{ readonly start: number; readonly end: number; readonly speaker?: string }>): string[] {
  const talk = new Map<string, number>()
  for (const w of words) if (w.speaker) talk.set(w.speaker, (talk.get(w.speaker) ?? 0) + Math.max(0.05, w.end - w.start))
  const total = [...talk.values()].reduce((a, b) => a + b, 0)
  return [...talk].filter(([, t]) => total > 0 && t / total >= 0.05).map(([s]) => s).slice(0, MAX_LAYOUT_SPEAKERS)
}

/** The parts of the canvas a layout gives `n` speakers, in order. */
export function layoutSlots(layout: SpeakerLayout, n: number, canvas: Size): Rect[] {
  const { width: W, height: H } = canvas
  if (layout === "stacked") return Array.from({ length: n }, (_, i) => ({ x: 0, y: Math.round((H * i) / n), w: W, h: Math.round(H / n) }))
  if (layout === "side") return Array.from({ length: n }, (_, i) => ({ x: Math.round((W * i) / n), y: 0, w: Math.round(W / n), h: H }))
  if (layout === "pip") {
    // The first speaker fills the frame; the others sit small along the bottom, right to left.
    const w = Math.round(W * 0.3)
    const h = Math.round(w * (H / W))
    const gap = Math.round(W * 0.03)
    return [{ x: 0, y: 0, w: W, h: H }, ...Array.from({ length: n - 1 }, (_, i) => ({ x: W - (w + gap) * (i + 1), y: H - h - gap, w, h }))]
  }
  const cols = Math.ceil(Math.sqrt(n))
  const rows = Math.ceil(n / cols)
  return Array.from({ length: n }, (_, i) => ({ x: Math.round((W * (i % cols)) / cols), y: Math.round((H * Math.floor(i / cols)) / rows), w: Math.round(W / cols), h: Math.round(H / rows) }))
}

/** The crop and the place that show `region` of the source filling `slot` of the canvas. */
export function slotPlacement(region: Rect, slot: Rect, source: Size, canvas: Size) {
  const scale = Math.max(slot.w / (region.w * source.width), slot.h / (region.h * source.height))
  const width = Math.round(source.width * scale)
  const height = Math.round(source.height * scale)
  return {
    crop: { left: region.x, right: Math.max(0, 1 - region.x - region.w), top: region.y, bottom: Math.max(0, 1 - region.y - region.h) },
    // From the canvas center: the slot's center, minus where the region's center is inside the scaled picture.
    transform: {
      x: Math.round(slot.x + slot.w / 2 - canvas.width / 2 - (region.x + region.w / 2 - 0.5) * width),
      y: Math.round(slot.y + slot.h / 2 - canvas.height / 2 - (region.y + region.h / 2 - 0.5) * height),
      width,
      height,
    },
  }
}

const clearMotion = (itemId: string) => (["x", "y", "width", "height"] as const).map((property) => ({ op: "removeKeyframes", itemId, property }))

/**
 * The edits that take an earlier speaker layout off the timeline, so a new
 * framing starts from the video as it was: the copies made for the other
 * speakers go (a clip shown twice at one moment keeps its lowest track, the
 * footage's own), and what stays is whole again (no crop, no moves, no blur,
 * its file's name).
 * Empty when the video is on the timeline once.
 */
export function unlayOps(timeline: Pick<TimelineView, "items" | "tracks" | "media">, mediaId: string): Array<Record<string, unknown>> {
  const order = new Map((timeline.tracks ?? []).map((t) => [t.id, t.order ?? 0]))
  const moments = new Map<string, TimelineItemView[]>()
  for (const item of timeline.items) {
    if (item.type !== "video" || item.mediaId !== mediaId) continue
    const key = `${item.from}:${item.durationInFrames}`
    moments.set(key, [...(moments.get(key) ?? []), item])
  }
  const shown = [...moments.values()]
  if (!shown.some((items) => items.length > 1)) return []
  // Lower `order` is higher on screen: the footage is the lowest of the copies.
  const kept = shown.map((items) => [...items].sort((a, b) => (order.get(b.trackId) ?? 0) - (order.get(a.trackId) ?? 0))[0]!)
  const keptIds = new Set(kept.map((k) => k.id))
  const copies = shown.flat().filter((i) => !keptIds.has(i.id)).map((i) => i.id)
  const name = timeline.media?.find((m) => m.id === mediaId)?.fileName
  return [
    { op: "removeItems", ids: copies },
    { op: "blurItems", ids: kept.map((k) => k.id), radius: 0 },
    ...kept.flatMap((k) => [...clearMotion(k.id), { op: "updateItem", id: k.id, updates: { crop: { left: 0, right: 0, top: 0, bottom: 0 }, ...(name ? { label: name } : {}) } }]),
  ]
}
