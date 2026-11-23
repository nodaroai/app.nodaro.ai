/**
 * Mask tracks: the regions of a per-frame mask grouped into one track per
 * subject, so a caller can name a subject ("the person seen from frame 70 to
 * 94") and Mask Erase can drop that subject whole, on every frame it is on.
 *
 * A region joins the open track its bounding box overlaps the most; with no
 * overlap at all, the nearest open track of about its size it can have moved
 * from. A track stays open over a gap of at most `gapLimit` frames and never
 * across a shot cut. Two regions that join the same track on one frame (a
 * subject the mask split in two) are both that track's, while they stay side
 * by side. One that comes away from the rest of its track (`MASK_TRACK_APART_SIDES`,
 * on `MASK_TRACK_APART_FRAMES` frames) was a second subject the mask drew as
 * one with the first for a moment (one head coming out from behind another):
 * it is a track of its own, from the frame it is a region of its own.
 *
 * Video Mask reports the tracks of the mask it drew (`tracks: true`); Mask
 * Erase follows the same rule over the mask it decodes and drops the tracks
 * its seeds land on (`eraseTracks`), so the two agree without a file between
 * them. Pure apart from yielding to the event loop.
 */

import { maskRegionsOf, yieldIfDue, type MaskRegionBox } from "./video-mask.js"

/** The most tracks a mask reports: the longest ones; the rest are counted (`omitted`). */
export const MASK_TRACKS_MAX_REPORTED = 48

/**
 * A subject is best looked at on the frame its box is largest while no wider
 * or taller than this share of the frame: on a larger one (a close-up the
 * mask covers most of) there is little left to tell who it is.
 */
export const MASK_TRACK_VIEW_MAX_SHARE = 0.4

/**
 * …and, when there is such a frame, one where its box is clear of the frame's
 * edges by this share of the frame: a subject half out of the picture is the
 * hardest to tell.
 */
export const MASK_TRACK_VIEW_EDGE_SHARE = 0.01

/**
 * A region of a track is apart from another when the gap between their boxes
 * is more than this many of the smaller one's longer side: farther than the
 * two halves of one subject the mask split are from each other.
 */
export const MASK_TRACK_APART_SIDES = 0.75

/** A region apart from every other region of its track on this many frames is a subject of its own. */
export const MASK_TRACK_APART_FRAMES = 2

/** One subject of a mask: the frames it is on (0-based, inclusive) and where it is best looked at. */
export interface MaskTrackInfo {
  readonly id: number
  readonly fromFrame: number
  readonly toFrame: number
  /** The frames it has a region on (a gap's frames are not counted). */
  readonly frames: number
  /**
   * The frame to look at it on: its largest bounding box within
   * `MASK_TRACK_VIEW_MAX_SHARE` of the frame each way and clear of the
   * frame's edges (`MASK_TRACK_VIEW_EDGE_SHARE`); with none clear of the
   * edges, its largest within the share; when every one is larger, its
   * smallest. Chosen among the frames it is one region on, when it has any,
   * and never the frame it was last one region with a subject that then came
   * away as a track of its own, when it has another.
   */
  readonly viewFrame: number
  /** Its bounding box on `viewFrame`, % of the frame (two decimals). */
  readonly viewBox: { readonly leftPct: number; readonly topPct: number; readonly rightPct: number; readonly bottomPct: number }
  /**
   * The frames it is two regions or more on; absent when on none. A track in
   * two on most of its frames may be two subjects that never came apart.
   */
  readonly splitFrames?: number
}

export interface MaskTracking {
  /** Every track, in the order it starts. */
  readonly tracks: readonly MaskTrackInfo[]
  /** Per frame: each region's track id, by the region's bounding box (`maskRegionBoxKey`). */
  readonly regionTrack: ReadonlyArray<ReadonlyMap<string, number>>
}

/** A region's bounding box as a map key: no two regions of a frame share one. */
export function maskRegionBoxKey(box: MaskRegionBox): string {
  return `${box.top},${box.left},${box.bottom},${box.right}`
}

/** One region followed from frame to frame inside a track: at most one region a frame. */
interface Strand {
  /** The order it started in, among every strand of the mask. */
  readonly index: number
  track: OpenTrack
  /** Its box on `lastFrame`. */
  box: MaskRegionBox
  lastFrame: number
  /** The frames it is on, and its box on each. */
  readonly frames: number[]
  readonly boxes: MaskRegionBox[]
  /** Started as a further region of a track already seen: that track's frame before. Undefined: nothing before it. */
  readonly bornAfter: number | undefined
  /** The frames it was apart from every other region of its track. */
  apart: number
}

interface OpenTrack {
  /** Its strands; the first is the one it started with, and never leaves it. */
  strands: Strand[]
  /** The union of its regions' boxes on `lastFrame`. */
  box: MaskRegionBox
  /** `box` as it was before `lastFrame`'s regions: what a second region of the same frame is compared with. */
  before: MaskRegionBox
  lastFrame: number
  /** The frame it was seen on before `lastFrame`. */
  beforeFrame: number | undefined
  /** The frames it was last one region with a subject that then came away. */
  readonly fused: Set<number>
  /** Its place among the mask's tracks, once every frame is read. */
  id: number
}

const areaOf = (b: MaskRegionBox): number => (b.bottom - b.top + 1) * (b.right - b.left)

function overlapArea(a: MaskRegionBox, b: MaskRegionBox): number {
  const rows = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) + 1
  const columns = Math.min(a.right, b.right) - Math.max(a.left, b.left)
  return rows > 0 && columns > 0 ? rows * columns : 0
}

const unionBox = (a: MaskRegionBox, b: MaskRegionBox): MaskRegionBox => ({
  top: Math.min(a.top, b.top),
  bottom: Math.max(a.bottom, b.bottom),
  left: Math.min(a.left, b.left),
  right: Math.max(a.right, b.right),
})

const centreOf = (b: MaskRegionBox): { x: number; y: number } => ({ x: (b.left + b.right) / 2, y: (b.top + b.bottom + 1) / 2 })

/** A region with no overlap joins a track only of about its size (areas within this factor)… */
const MOVED_MAX_AREA_RATIO = 4
/** …whose centre is within this many of the larger box's longer sides. */
const MOVED_MAX_SIDES = 1

/**
 * The open track `box` continues: the largest overlap with where the track was
 * (before this frame's regions, so a second region of a split subject joins
 * it too); with none, the nearest track not yet seen on this frame that is
 * about its size and close enough to have moved here. Undefined: a new track.
 */
function continues(box: MaskRegionBox, open: readonly OpenTrack[], frame: number): OpenTrack | undefined {
  let best: OpenTrack | undefined
  let bestOverlap = 0
  for (const t of open) {
    const o = overlapArea(box, t.lastFrame === frame ? t.before : t.box)
    if (o > bestOverlap) {
      best = t
      bestOverlap = o
    }
  }
  if (best) return best
  const c = centreOf(box)
  const area = areaOf(box)
  let nearest: OpenTrack | undefined
  let nearestDistance = Infinity
  for (const t of open) {
    if (t.lastFrame === frame) continue
    const tArea = areaOf(t.box)
    if (Math.max(area, tArea) > MOVED_MAX_AREA_RATIO * Math.min(area, tArea)) continue
    const tc = centreOf(t.box)
    const distance = Math.hypot(c.x - tc.x, c.y - tc.y)
    const larger = area >= tArea ? box : t.box
    const side = Math.max(larger.right - larger.left, larger.bottom - larger.top + 1)
    if (distance <= MOVED_MAX_SIDES * side && distance < nearestDistance) {
      nearest = t
      nearestDistance = distance
    }
  }
  return nearest
}

const longerSide = (b: MaskRegionBox): number => Math.max(b.right - b.left, b.bottom - b.top + 1)

/** Whether two regions' boxes are farther apart than the halves of one split subject are (`MASK_TRACK_APART_SIDES`). */
function apart(a: MaskRegionBox, b: MaskRegionBox): boolean {
  const dx = Math.max(0, a.left - b.right, b.left - a.right)
  const dy = Math.max(0, a.top - (b.bottom + 1), b.top - (a.bottom + 1))
  return Math.hypot(dx, dy) > MASK_TRACK_APART_SIDES * Math.min(longerSide(a), longerSide(b))
}

/**
 * The strand of `track` that `box` continues on `frame`: the one not yet seen
 * on this frame it overlaps the most. With none: for the track's first region
 * of the frame, its nearest strand; for a further region, undefined (a strand
 * of its own).
 */
function strandOf(box: MaskRegionBox, track: OpenTrack, frame: number, gapLimit: number): Strand | undefined {
  const free = track.strands.filter((s) => s.lastFrame !== frame && frame - s.lastFrame <= gapLimit + 1)
  let best: Strand | undefined
  let bestOverlap = 0
  for (const s of free) {
    const o = overlapArea(box, s.box)
    if (o > bestOverlap) {
      best = s
      bestOverlap = o
    }
  }
  if (best || track.lastFrame === frame) return best
  const c = centreOf(box)
  let nearestDistance = Infinity
  for (const s of free) {
    const sc = centreOf(s.box)
    const distance = Math.hypot(c.x - sc.x, c.y - sc.y)
    if (distance < nearestDistance) {
      best = s
      nearestDistance = distance
    }
  }
  return best
}

/**
 * After a frame's regions: a strand apart from every other strand of its track
 * seen on this frame, for the `MASK_TRACK_APART_FRAMES`th time, leaves the
 * track as a track of its own, with every frame it was on. Never a track's
 * first strand, and never the only one left on the frame.
 */
function partSubjects(open: OpenTrack[], all: OpenTrack[], frame: number): void {
  for (const t of [...open]) {
    if (t.lastFrame !== frame || t.strands.length < 2) continue
    const seen = t.strands.filter((s) => s.lastFrame === frame)
    if (seen.length < 2) continue
    for (const s of seen) {
      if (s === t.strands[0]) continue
      const others = seen.filter((o) => o !== s && o.track === t)
      if (others.length === 0 || !others.every((o) => apart(s.box, o.box))) continue
      s.apart += 1
      if (s.apart < MASK_TRACK_APART_FRAMES) continue
      t.strands = t.strands.filter((x) => x !== s)
      if (s.bornAfter !== undefined) t.fused.add(s.bornAfter)
      t.box = others.map((o) => o.box).reduce(unionBox)
      const own: OpenTrack = { strands: [s], box: s.box, before: s.box, lastFrame: frame, beforeFrame: undefined, fused: new Set(), id: -1 }
      s.track = own
      all.push(own)
      open.push(own)
    }
  }
}

const pct = (value: number, of: number): number => Number(((100 * value) / of).toFixed(2))

/** One track's frames, first to last: its regions' union box on each, and how many regions it has there. */
function framesOf(track: OpenTrack): Array<{ readonly frame: number; readonly box: MaskRegionBox; readonly regions: number }> {
  const byFrame = new Map<number, { box: MaskRegionBox; regions: number }>()
  for (const s of track.strands) {
    for (let i = 0; i < s.frames.length; i++) {
      const at = byFrame.get(s.frames[i]!)
      if (at) {
        at.box = unionBox(at.box, s.boxes[i]!)
        at.regions += 1
      } else {
        byFrame.set(s.frames[i]!, { box: s.boxes[i]!, regions: 1 })
      }
    }
  }
  return [...byFrame.entries()].sort((a, b) => a[0] - b[0]).map(([frame, at]) => ({ frame, box: at.box, regions: at.regions }))
}

/** The frame to look at a track on among `frames` (`MaskTrackInfo.viewFrame`'s order; the first of equals). */
function viewOf(frames: ReadonlyArray<{ readonly frame: number; readonly box: MaskRegionBox }>, width: number, height: number): { readonly frame: number; readonly box: MaskRegionBox } {
  const edgeX = MASK_TRACK_VIEW_EDGE_SHARE * width
  const edgeY = MASK_TRACK_VIEW_EDGE_SHARE * height
  let clear: { frame: number; box: MaskRegionBox } | undefined
  let clearArea = 0
  let view: { frame: number; box: MaskRegionBox } | undefined
  let viewArea = 0
  let small = frames[0]!
  let smallArea = Infinity
  for (const at of frames) {
    const { box } = at
    const area = areaOf(box)
    const inView = box.right - box.left <= MASK_TRACK_VIEW_MAX_SHARE * width && box.bottom - box.top + 1 <= MASK_TRACK_VIEW_MAX_SHARE * height
    const isClear = box.left >= edgeX && box.right <= width - edgeX && box.top >= edgeY && box.bottom + 1 <= height - edgeY
    if (inView && isClear && area > clearArea) {
      clearArea = area
      clear = at
    }
    if (inView && area > viewArea) {
      viewArea = area
      view = at
    }
    if (area < smallArea) {
      smallArea = area
      small = at
    }
  }
  return clear ?? view ?? small
}

/** `list` without the items `drop` names, unless that leaves none. */
function without<T>(list: readonly T[], drop: (item: T) => boolean): readonly T[] {
  const kept = list.filter((item) => !drop(item))
  return kept.length > 0 ? kept : list
}

/**
 * The tracks of a mask's per-frame RLE. `cutFrames`: the frames a new shot
 * starts on (no track crosses one). `gapLimit`: the longest run of frames a
 * track may miss and still go on.
 */
export async function trackMaskRegions(
  rle: readonly string[],
  width: number,
  height: number,
  cutFrames: readonly number[],
  gapLimit: number,
): Promise<MaskTracking> {
  const cuts = new Set(cutFrames)
  const all: OpenTrack[] = []
  const strands: Strand[] = []
  let open: OpenTrack[] = []
  /** Per frame: each region's strand, by the region's box. */
  const regionStrand: Array<Map<string, number>> = []
  let sliceStart = performance.now()
  for (let f = 0; f < rle.length; f++) {
    const assigned = new Map<string, number>()
    regionStrand.push(assigned)
    if (cuts.has(f)) open = []
    if (rle[f] !== "") {
      open = open.filter((t) => f - t.lastFrame <= gapLimit + 1)
      const boxes = [...maskRegionsOf(rle[f]!, width, height).boxes].sort((a, b) => areaOf(b) - areaOf(a))
      for (const box of boxes) {
        let track = continues(box, open, f)
        let strand: Strand | undefined
        if (!track) {
          track = { strands: [], box, before: box, lastFrame: f, beforeFrame: undefined, fused: new Set(), id: -1 }
          all.push(track)
          open.push(track)
        } else {
          strand = strandOf(box, track, f, gapLimit)
          if (track.lastFrame === f) {
            track.box = unionBox(track.box, box)
          } else {
            track.before = track.box
            track.beforeFrame = track.lastFrame
            track.box = box
            track.lastFrame = f
          }
        }
        if (strand) {
          strand.box = box
          strand.lastFrame = f
          strand.frames.push(f)
          strand.boxes.push(box)
        } else {
          strand = { index: strands.length, track, box, lastFrame: f, frames: [f], boxes: [box], bornAfter: track.strands.length > 0 ? track.beforeFrame : undefined, apart: 0 }
          strands.push(strand)
          track.strands.push(strand)
        }
        assigned.set(maskRegionBoxKey(box), strand.index)
      }
      partSubjects(open, all, f)
    }
    sliceStart = await yieldIfDue(sliceStart)
  }
  // In the order each starts: a subject that came away from a track starts on the frame it was first a region of its own.
  all.sort((a, b) => a.strands[0]!.index - b.strands[0]!.index)
  const tracks = all.map((t, id): MaskTrackInfo => {
    t.id = id
    const frames = framesOf(t)
    const whole = without(without(frames, (at) => t.fused.has(at.frame)), (at) => at.regions > 1)
    const view = viewOf(whole, width, height)
    const splitFrames = frames.filter((at) => at.regions > 1).length
    return {
      id,
      fromFrame: frames[0]!.frame,
      toFrame: frames[frames.length - 1]!.frame,
      frames: frames.length,
      viewFrame: view.frame,
      viewBox: {
        leftPct: pct(view.box.left, width),
        topPct: pct(view.box.top, height),
        rightPct: pct(view.box.right, width),
        bottomPct: pct(view.box.bottom + 1, height),
      },
      ...(splitFrames > 0 ? { splitFrames } : {}),
    }
  })
  const regionTrack = regionStrand.map((assigned) => {
    const byTrack = new Map<string, number>()
    for (const [key, strand] of assigned) byTrack.set(key, strands[strand]!.track.id)
    return byTrack
  })
  return { tracks, regionTrack }
}

/**
 * The tracks a mask reports: at most `MASK_TRACKS_MAX_REPORTED`, the ones on
 * the most frames, in the order they start; `omitted` counts the rest. Pure.
 */
export function reportedMaskTracks(tracks: readonly MaskTrackInfo[], max: number = MASK_TRACKS_MAX_REPORTED): { readonly tracks: MaskTrackInfo[]; readonly omitted: number } {
  if (tracks.length <= max) return { tracks: [...tracks], omitted: 0 }
  const kept = new Set([...tracks].sort((a, b) => b.frames - a.frames || a.id - b.id).slice(0, max).map((t) => t.id))
  return { tracks: tracks.filter((t) => kept.has(t.id)), omitted: tracks.length - max }
}

/** A point on one frame of a mask (% of the frame): the track whose region it lies in is the one meant. */
export interface MaskTrackSeed {
  readonly frame: number
  readonly xPct: number
  readonly yPct: number
}

/**
 * The track each seed names: the one whose region on the seed's frame has the
 * point inside its bounding box (the smallest such box); with the point in
 * none (the middle of a subject the mask split in two), the region whose
 * centre is nearest. A seed on a frame with no region names none
 * (`unmatched`). Pure.
 */
export function tracksOfSeeds(
  rle: readonly string[],
  width: number,
  height: number,
  tracking: MaskTracking,
  seeds: readonly MaskTrackSeed[],
): { readonly ids: Set<number>; readonly unmatched: number } {
  const ids = new Set<number>()
  let unmatched = 0
  for (const seed of seeds) {
    const frame = rle[seed.frame]
    const assigned = tracking.regionTrack[seed.frame]
    let found: number | undefined
    if (frame !== undefined && frame !== "" && assigned) {
      const x = (width * seed.xPct) / 100
      const y = (height * seed.yPct) / 100
      let smallest = Infinity
      let nearest: number | undefined
      let nearestDistance = Infinity
      for (const box of maskRegionsOf(frame, width, height).boxes) {
        const id = assigned.get(maskRegionBoxKey(box))
        if (id === undefined) continue
        const c = centreOf(box)
        const distance = Math.hypot(c.x - x, c.y - y)
        if (distance < nearestDistance) {
          nearestDistance = distance
          nearest = id
        }
        if (x < box.left || x > box.right || y < box.top || y > box.bottom + 1) continue
        const area = areaOf(box)
        if (area < smallest) {
          smallest = area
          found = id
        }
      }
      found ??= nearest
    }
    if (found === undefined) unmatched += 1
    else ids.add(found)
  }
  return { ids, unmatched }
}
