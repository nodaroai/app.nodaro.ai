/**
 * Mask tracks: the regions of a per-frame mask grouped into one track per
 * subject, so a caller can name a subject ("the person seen from frame 70 to
 * 94") and Mask Erase can drop that subject whole, on every frame it is on.
 *
 * A region joins the open track its bounding box overlaps the most; with no
 * overlap at all, the nearest open track of about its size it can have moved
 * from. A track stays open over a gap of at most `gapLimit` frames and never
 * across a shot cut. Two regions that join the same track on one frame (a
 * subject the mask split in two) are both that track's.
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
   * smallest.
   */
  readonly viewFrame: number
  /** Its bounding box on `viewFrame`, % of the frame (two decimals). */
  readonly viewBox: { readonly leftPct: number; readonly topPct: number; readonly rightPct: number; readonly bottomPct: number }
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

interface OpenTrack {
  readonly id: number
  readonly fromFrame: number
  /** The union of its regions' boxes on `lastFrame`. */
  box: MaskRegionBox
  /** `box` as it was before `lastFrame`'s regions: what a second region of the same frame is compared with. */
  before: MaskRegionBox
  lastFrame: number
  frames: number
  /** The largest box within the view share and clear of the edges so far (area 0: none yet). */
  clearFrame: number
  clearBox: MaskRegionBox
  clearArea: number
  /** The largest box within the view share so far (area 0: none yet). */
  viewFrame: number
  viewBox: MaskRegionBox
  viewArea: number
  /** The smallest box so far: the view when none is within the share. */
  smallFrame: number
  smallBox: MaskRegionBox
  smallArea: number
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

const pct = (value: number, of: number): number => Number(((100 * value) / of).toFixed(2))

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
  let open: OpenTrack[] = []
  const regionTrack: Array<Map<string, number>> = []
  let sliceStart = performance.now()
  for (let f = 0; f < rle.length; f++) {
    const assigned = new Map<string, number>()
    regionTrack.push(assigned)
    if (cuts.has(f)) open = []
    if (rle[f] !== "") {
      open = open.filter((t) => f - t.lastFrame <= gapLimit + 1)
      const boxes = [...maskRegionsOf(rle[f]!, width, height).boxes].sort((a, b) => areaOf(b) - areaOf(a))
      for (const box of boxes) {
        let track = continues(box, open, f)
        if (!track) {
          track = { id: all.length, fromFrame: f, box, before: box, lastFrame: f, frames: 1, clearFrame: f, clearBox: box, clearArea: 0, viewFrame: f, viewBox: box, viewArea: 0, smallFrame: f, smallBox: box, smallArea: Infinity }
          all.push(track)
          open.push(track)
        } else if (track.lastFrame === f) {
          track.box = unionBox(track.box, box)
        } else {
          track.before = track.box
          track.box = box
          track.lastFrame = f
          track.frames += 1
        }
        assigned.set(maskRegionBoxKey(box), track.id)
      }
      for (const t of open) {
        if (t.lastFrame !== f) continue
        const area = areaOf(t.box)
        const inView = t.box.right - t.box.left <= MASK_TRACK_VIEW_MAX_SHARE * width && t.box.bottom - t.box.top + 1 <= MASK_TRACK_VIEW_MAX_SHARE * height
        const edgeX = MASK_TRACK_VIEW_EDGE_SHARE * width
        const edgeY = MASK_TRACK_VIEW_EDGE_SHARE * height
        const clear = t.box.left >= edgeX && t.box.right <= width - edgeX && t.box.top >= edgeY && t.box.bottom + 1 <= height - edgeY
        if (inView && clear && area > t.clearArea) {
          t.clearArea = area
          t.clearFrame = f
          t.clearBox = t.box
        }
        if (inView && area > t.viewArea) {
          t.viewArea = area
          t.viewFrame = f
          t.viewBox = t.box
        }
        if (area < t.smallArea) {
          t.smallArea = area
          t.smallFrame = f
          t.smallBox = t.box
        }
      }
    }
    sliceStart = await yieldIfDue(sliceStart)
  }
  const tracks = all.map((t): MaskTrackInfo => {
    const [viewFrame, box] = t.clearArea > 0 ? [t.clearFrame, t.clearBox] : t.viewArea > 0 ? [t.viewFrame, t.viewBox] : [t.smallFrame, t.smallBox]
    return {
      id: t.id,
      fromFrame: t.fromFrame,
      toFrame: t.lastFrame,
      frames: t.frames,
      viewFrame,
      viewBox: {
        leftPct: pct(box.left, width),
        topPct: pct(box.top, height),
        rightPct: pct(box.right, width),
        bottomPct: pct(box.bottom + 1, height),
      },
    }
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
