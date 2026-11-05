/**
 * Steady mask regions: follow the regions of a per-frame mask from frame to
 * frame, so a subject the model loses for a moment stays covered and a speck it
 * sees for a moment does not flash up.
 *
 * Each region joins the open track its bounding box overlaps the most, or, with
 * no overlap at all, one of about its size it can have moved from since the
 * frame before. A track seen on fewer than `STEADY_MIN_TRACK_FRAMES` frames, with
 * no surviving track on its box on the next frame, is a pop and its regions are
 * removed. A track that comes back, at about its size, within the gap limit has
 * the frames it missed filled with a still copy of its last frame before the gap.
 * The limit is longer for a track already seen on `STEADY_MIN_TRACK_FRAMES` frames,
 * over a gap whose every frame holds no region at all: an empty mask has nothing
 * else to go by, and a stray on a few scattered frames must not bridge them into a
 * solid patch. A track gone for longer is reported as `lost`, for the caller to look
 * at again. Nothing is followed across a shot cut.
 *
 * Only whole frames of RLE go in and out, so a frame nothing happened to keeps
 * its original string. Pure apart from yielding to the event loop.
 */

import { VIDEO_MASK_LIMITS } from "@nodaro/shared/media"
import { parseFrameRate } from "./ffmpeg-utils.js"
import { decodeMaskRle, maskRegionsOf, yieldIfDue, type MaskRegionBox, type MaskRegions } from "./video-mask.js"

/** The fewest frames with regions a track needs to count as real on its own (`popTracks`). Filled frames do not count. */
export const STEADY_MIN_TRACK_FRAMES = 3

/** The most lost faces one job looks for again: each look is a paid request. */
export const STEADY_MAX_EXTRA_REQUESTS = 3

/**
 * The longest gap filled at `frameRate` (an ffmpeg rational) while another
 * region shows on a frame of it: a third of a second of frames, at least one; an
 * unreadable rate counts as `FPS_BASIS`. Pure.
 */
export function steadyGapLimitFrames(frameRate: string): number {
  const fps = parseFrameRate(frameRate) ?? VIDEO_MASK_LIMITS.FPS_BASIS
  return Math.max(1, Math.round(fps / 3))
}

/**
 * One frame's pixels (width × height bytes, anything but 0 is white) as RLE in
 * the form `decodeMaskRle` reads: one-based, row-major `start length` pairs. An
 * empty frame is "". Pure.
 */
export function encodeMaskRle(pixels: Uint8Array, width: number, height: number): string {
  const total = width * height
  const runs: string[] = []
  let start = -1
  for (let p = 0; p < total; p++) {
    if (pixels[p] !== 0) {
      if (start < 0) start = p
    } else if (start >= 0) {
      runs.push(`${start + 1} ${p - start}`)
      start = -1
    }
  }
  if (start >= 0) runs.push(`${start + 1} ${total - start}`)
  return runs.join(" ")
}

/** A subject the mask lost and did not get back in time. */
export interface LostFace {
  /** The first frame without it. */
  readonly startFrame: number
  /** Exclusive: the next detection, cut or the clip's end. */
  readonly endFrame: number
  /** Its bounding box on the last frame it was seen. */
  readonly lastBox: MaskRegionBox
  /** Its pixels on its largest frame. */
  readonly peakPixels: number
}

export interface SteadyPlan {
  readonly width: number
  readonly height: number
  /** The frames where a new shot starts. */
  readonly cutFrames: readonly number[]
  /** The frames the model started afresh on: every chunk's startFrame. */
  readonly detectionFrames: readonly number[]
  /** The longest gap filled with another region on a frame of it (`steadyGapLimitFrames`). */
  readonly gapLimit: number
  /** The longest gap filled when none of its frames holds any region and the track had `STEADY_MIN_TRACK_FRAMES` frames before it (`holdMaxFrames`). */
  readonly emptyGapLimit: number
}

export interface SteadyResult {
  readonly rle: string[]
  /** Frames a fill added pixels to, each counted once however many tracks filled it. */
  readonly filledFrames: number
  /** Regions removed as pops, counted per frame. */
  readonly removedRegions: number
  readonly lost: readonly LostFace[]
}

/** Regions of one frame, by their index in `maskRegionsOf`, which labels the same string the same way every time. */
interface FrameRegions {
  readonly frame: number
  readonly regions: readonly number[]
}

/** The frames a returning track missed, [`start`, `end`), and what they copy. */
interface TrackGap {
  readonly source: FrameRegions
  readonly start: number
  readonly end: number
}

interface Track {
  /** The union of its regions' boxes on `last.frame`. */
  box: MaskRegionBox
  last: FrameRegions
  frames: number
  peakPixels: number
  /** Its frames up to the minimum length: all that a pop has to give back. */
  readonly early: FrameRegions[]
  readonly gaps: TrackGap[]
  /** A region at least half of `box` has lain on it since this track was last seen: the two have merged. */
  covered: boolean
  /** The tracks on `box` on the frame right after `last`: empty while this one is still seen, and across a cut. */
  after: readonly Track[]
}

/** The pixels two boxes share (rows inclusive, columns right-exclusive). */
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

/**
 * The open track a region continues: the largest overlap. A tie goes to the
 * track seen most recently, then to the older one. That tie matters after two
 * faces merge: a piece splitting off lies wholly inside the merged track's box,
 * so it ties with the absorbed track's old box, and letting that track return
 * would paint its stale pixels over the frames of the merge.
 */
function pickTrack(open: readonly Track[], box: MaskRegionBox): Track | undefined {
  let best: Track | undefined
  let bestArea = 0
  for (const track of open) {
    const area = overlapArea(track.box, box)
    if (area === 0) continue
    if (area > bestArea || (area === bestArea && track.last.frame > best!.last.frame)) {
      best = track
      bestArea = area
    }
  }
  return best
}

/** A box grown on every side by its own larger side: how far a face can have got in one frame. */
function reachOf(box: MaskRegionBox): MaskRegionBox {
  const side = Math.max(box.right - box.left, box.bottom - box.top + 1)
  return { top: box.top - side, bottom: box.bottom + side, left: box.left - side, right: box.right + side }
}

const boxArea = (box: MaskRegionBox): number => (box.right - box.left) * (box.bottom - box.top + 1)

/** A moving face keeps its size from frame to frame; a speck does not. */
function similarSize(a: MaskRegionBox, b: MaskRegionBox): boolean {
  const areaA = boxArea(a)
  const areaB = boxArea(b)
  return areaA * 2 >= areaB && areaB * 2 >= areaA
}

/** How far a region lies within where a face in `from` can have moved to; 0 when it cannot be that face. */
function movedOverlap(from: MaskRegionBox, box: MaskRegionBox): number {
  return similarSize(from, box) ? overlapArea(reachOf(from), box) : 0
}

/**
 * Regions no track's box overlaps, matched to the tracks they may have moved
 * from: a face moving further than its own size each frame shares no pixel of
 * box with its last frame, and without this every frame of it would open a
 * one-frame track and be removed as a pop. Only a track seen on the frame just
 * before and with no region on this one qualifies, so this never crosses a gap
 * and never fills, and the region's box must be between half and twice the
 * track's in area, so a stray speck on the frame a face blinks does not take
 * the face's track. Each region and each track is matched once, largest overlap
 * with the track's reach first; on a tie, the older track, then the region
 * listed first. Pure.
 */
function matchMovedRegions(
  unpicked: readonly number[],
  boxes: readonly MaskRegionBox[],
  open: readonly Track[],
  picked: ReadonlyMap<Track, unknown>,
  frame: number,
): Map<number, Track> {
  const candidates: { readonly region: number; readonly track: Track; readonly area: number }[] = []
  for (const region of unpicked) {
    for (const track of open) {
      if (track.last.frame !== frame - 1 || picked.has(track)) continue
      const area = movedOverlap(track.box, boxes[region]!)
      if (area > 0) candidates.push({ region, track, area })
    }
  }
  candidates.sort((a, b) => b.area - a.area)
  const moved = new Map<number, Track>()
  const taken = new Set<Track>()
  for (const { region, track } of candidates) {
    if (moved.has(region) || taken.has(track)) continue
    moved.set(region, track)
    taken.add(track)
  }
  return moved
}

/**
 * The regions that open tracks on one frame, grouped: regions whose boxes
 * intersect, directly or through one another, are one track. A face can be in
 * pieces on the frame it is first seen, just as on any later frame.
 */
function openingGroups(ids: readonly number[], boxes: readonly MaskRegionBox[]): number[][] {
  const left = [...ids]
  const groups: number[][] = []
  while (left.length > 0) {
    const group = [left.shift()!]
    for (let i = 0; i < group.length; i++) {
      for (let j = left.length - 1; j >= 0; j--) {
        if (overlapArea(boxes[group[i]!]!, boxes[left[j]!]!) > 0) group.push(left.splice(j, 1)[0]!)
      }
    }
    groups.push(group)
  }
  return groups
}

/** Each region's pixels on this frame, by region. */
function regionPixels(regions: MaskRegions): number[] {
  const pixels = Array<number>(regions.boxes.length).fill(0)
  for (let i = 0; i < regions.row.length; i++) pixels[regions.region[i]!]! += regions.x1[i]! - regions.x0[i]!
  return pixels
}

/** Follow every region through the clip. Frames are only read here. */
async function buildTracks(rle: readonly string[], plan: SteadyPlan): Promise<Track[]> {
  const { width, height, gapLimit, emptyGapLimit } = plan
  const cuts = new Set(plan.cutFrames)
  const tracks: Track[] = []
  let open: Track[] = []
  // The last frame before this one with any region: a track last seen there has seen nothing but empty frames since.
  let lastOccupied = -1
  let sliceStart = performance.now()
  for (let f = 0; f < rle.length; f++) {
    // Closed at a cut, or once absent for more than the limit its gap has so far. Only a track long enough to be real gets
    // the long limit: its `frames` cannot change while it is absent, so this reads them as they were when the gap opened.
    open = cuts.has(f)
      ? []
      : open.filter((t) => {
        const absent = f - t.last.frame - 1
        return absent <= gapLimit || (absent <= emptyGapLimit && t.last.frame === lastOccupied && t.frames >= STEADY_MIN_TRACK_FRAMES)
      })
    const regions = maskRegionsOf(rle[f]!, width, height)
    const pixels = regionPixels(regions)
    const boxOf = (ids: readonly number[]): MaskRegionBox => ids.map((r) => regions.boxes[r]!).reduce(unionBox)
    const pixelsOf = (ids: readonly number[]): number => ids.reduce((sum, r) => sum + pixels[r]!, 0)

    // Every region picks from the tracks open before this frame, so the order regions are listed in decides nothing.
    const picked = new Map<Track, number[]>()
    const unpicked: number[] = []
    for (const [r, box] of regions.boxes.entries()) {
      const track = pickTrack(open, box)
      if (!track) unpicked.push(r)
      else if (picked.has(track)) picked.get(track)!.push(r)
      else picked.set(track, [r])
    }
    // Back after a gap, a face keeps about its size: anything else lying on its old box is something new, and the track stays absent.
    for (const [track, ids] of picked) {
      if (f - track.last.frame > 1 && !similarSize(track.box, boxOf(ids))) {
        picked.delete(track)
        unpicked.push(...ids)
      }
    }
    const moved = matchMovedRegions(unpicked, regions.boxes, open, picked, f)
    for (const [r, track] of moved) picked.set(track, [r])

    for (const [track, ids] of picked) {
      if (f - track.last.frame > 1) track.gaps.push({ source: track.last, start: track.last.frame + 1, end: f })
      track.box = boxOf(ids)
      track.last = { frame: f, regions: ids }
      track.covered = false
      track.after = []
      track.frames++
      track.peakPixels = Math.max(track.peakPixels, pixelsOf(ids))
      if (track.early.length < STEADY_MIN_TRACK_FRAMES) track.early.push(track.last)
    }

    // A region of real size on an absent track's box belongs to another track: the two have merged. A speck there says nothing.
    for (const track of open) {
      if (track.last.frame === f || track.covered) continue
      track.covered = regions.boxes.some((box) => overlapArea(box, track.box) > 0 && boxArea(box) * 2 >= boxArea(track.box))
    }

    for (const ids of openingGroups(unpicked.filter((r) => !moved.has(r)), regions.boxes)) {
      const last = { frame: f, regions: ids }
      const track: Track = { box: boxOf(ids), last, frames: 1, peakPixels: pixelsOf(ids), early: [last], gaps: [], covered: false, after: [] }
      tracks.push(track)
      open.push(track)
    }

    const seen = open.filter((t) => t.last.frame === f)
    for (const track of open) {
      if (track.last.frame === f - 1) track.after = seen.filter((t) => overlapArea(t.box, track.box) > 0)
    }
    if (regions.boxes.length > 0) lastOccupied = f
    sliceStart = await yieldIfDue(sliceStart)
  }
  return tracks
}

/**
 * The tracks to remove: too short, and with no surviving track on their box on
 * the frame after they end. A face seen in pieces on its first frames opens a
 * track for each, and when they join, all but one of those tracks end there: what
 * they held was the face, not a speck. A short track that a kept one goes on from
 * survives too, so this settles only when nothing more changes. Pure.
 */
function popTracks(tracks: readonly Track[]): Set<Track> {
  const pops = new Set(tracks.filter((t) => t.frames < STEADY_MIN_TRACK_FRAMES))
  for (let settled = false; !settled;) {
    settled = true
    for (const track of pops) {
      if (track.after.some((t) => !pops.has(t))) {
        pops.delete(track)
        settled = false
      }
    }
  }
  return pops
}

/**
 * The tracks to look for again: long enough to be real, gone with no return
 * for longer than the limit before the next chance to see them anyway, not
 * simply out of the picture, and not merged into another track. A window opening
 * on a cut is no window: the track lasted to the end of its shot, and the frames
 * after the cut are another picture. Nor is one opening on a detection: the model
 * has just started afresh on that frame and did not see the face.
 */
function lostFaces(tracks: readonly Track[], plan: SteadyPlan, totalFrames: number): LostFace[] {
  const { width, height, gapLimit } = plan
  const cuts = [...plan.cutFrames].sort((a, b) => a - b)
  const detections = [...plan.detectionFrames].sort((a, b) => a - b)
  const lost: LostFace[] = []
  for (const track of tracks) {
    if (track.frames < STEADY_MIN_TRACK_FRAMES || track.covered) continue
    const { box } = track
    if (box.top === 0 || box.left === 0 || box.right === width || box.bottom === height - 1) continue
    const startFrame = track.last.frame + 1
    const shotEnd = cuts.find((c) => c >= startFrame) ?? totalFrames
    const nextDetection = detections.find((d) => d >= startFrame) ?? totalFrames
    const endFrame = Math.min(shotEnd, nextDetection)
    if (endFrame - startFrame > gapLimit) lost.push({ startFrame, endFrame, lastBox: box, peakPixels: track.peakPixels })
  }
  return lost
}

/** Walk a frame's row-runs for the given regions as [from, to) pixel ranges. */
function forEachRun(regions: MaskRegions, ids: readonly number[], width: number, visit: (from: number, to: number) => void): void {
  for (let i = 0; i < regions.row.length; i++) {
    if (!ids.includes(regions.region[i]!)) continue
    const rowStart = regions.row[i]! * width
    visit(rowStart + regions.x0[i]!, rowStart + regions.x1[i]!)
  }
}

/**
 * One clip's steady pass: removes pops, fills short gaps and reports lost
 * faces. Returns a new array and leaves `rle` alone; a frame with nothing to
 * change keeps its original string (also when a fill would only cover pixels
 * the frame already holds). Yields to the event loop as it goes. Throws like
 * `decodeMaskRle` for a run that leaves the frame.
 */
export async function steadyMaskPass(rle: readonly string[], plan: SteadyPlan): Promise<SteadyResult> {
  const { width, height, gapLimit, emptyGapLimit } = plan
  const tracks = await buildTracks(rle, plan)

  const removals = new Map<number, number[]>()
  const fills = new Map<number, FrameRegions[]>()
  let removedRegions = 0
  const pops = popTracks(tracks)
  for (const track of tracks) {
    if (pops.has(track)) {
      for (const { frame, regions } of track.early) {
        removals.set(frame, [...(removals.get(frame) ?? []), ...regions])
        removedRegions += regions.length
      }
      continue
    }
    for (const gap of track.gaps) {
      for (let f = gap.start; f < gap.end; f++) fills.set(f, [...(fills.get(f) ?? []), gap.source])
    }
  }

  const out = [...rle]
  let filledFrames = 0
  if (removals.size > 0 || fills.size > 0) {
    const pixels = new Uint8Array(width * height)
    // A gap's frames share their source, so its labelling is kept for as long as a gap can run.
    const labelled = new Map<number, MaskRegions>()
    const regionsOf = (frame: number): MaskRegions => {
      let regions = labelled.get(frame)
      if (!regions) {
        regions = maskRegionsOf(rle[frame]!, width, height)
        labelled.set(frame, regions)
      }
      return regions
    }
    let sliceStart = performance.now()
    for (let f = 0; f < rle.length; f++) {
      const removal = removals.get(f)
      const fill = fills.get(f)
      if (removal || fill) {
        decodeMaskRle(rle[f]!, pixels)
        if (removal) forEachRun(regionsOf(f), removal, width, (from, to) => pixels.fill(0, from, to))
        let added = 0
        for (const source of fill ?? []) {
          forEachRun(regionsOf(source.frame), source.regions, width, (from, to) => {
            for (let p = from; p < to; p++) {
              if (pixels[p] === 0) {
                pixels[p] = 255
                added++
              }
            }
          })
        }
        if (added > 0) filledFrames++
        if (removal || added > 0) out[f] = encodeMaskRle(pixels, width, height)
        for (const frame of labelled.keys()) if (frame < f - Math.max(gapLimit, emptyGapLimit)) labelled.delete(frame)
      }
      sliceStart = await yieldIfDue(sliceStart)
    }
  }

  return { rle: out, filledFrames, removedRegions, lost: lostFaces(tracks, plan, rle.length) }
}

/** The lost faces worth looking for again: the `max` largest, largest first. Pure. */
export function pickLostFaces(lost: readonly LostFace[], max: number = STEADY_MAX_EXTRA_REQUESTS): LostFace[] {
  return [...lost].sort((a, b) => b.peakPixels - a.peakPixels).slice(0, max)
}

/**
 * The regions continuing a face last in `from`: every one its box overlaps (a
 * face can come back in pieces). With none, the one it can have moved to, but
 * only when the answer held the face on the frame before, where `previousOthers`
 * says what else it held: a region lying on one of those is that region going on,
 * a neighbour and not this face. Before the face is found and after a blink there
 * is no such record, so a neighbour would pass for the face, and only real overlap
 * counts.
 */
function followRegions(
  boxes: readonly MaskRegionBox[],
  from: MaskRegionBox,
  previousOthers: readonly MaskRegionBox[] | undefined,
): number[] {
  const overlapping = [...boxes.keys()].filter((r) => overlapArea(from, boxes[r]!) > 0)
  if (overlapping.length > 0 || !previousOthers) return overlapping
  let best: number | undefined
  let bestArea = 0
  for (const [r, box] of boxes.entries()) {
    if (previousOthers.some((other) => overlapArea(other, box) > 0)) continue
    const area = movedOverlap(from, box)
    if (area > bestArea) {
      best = r
      bestArea = area
    }
  }
  return best === undefined ? [] : [best]
}

/**
 * Add what a second detection found of a lost face to the clip's frames.
 * `answer[0]` is the frame `lost.startFrame`. The face is followed from
 * `lost.lastBox` (`followRegions`) for as long as its box does not touch a region
 * the clip already holds there (the clip's own track has taken over, and the two
 * must not be painted twice), and the window lasts: it ends at the next cut, and
 * the answer is not trusted to. Up to `gapLimit` frames in a row may miss the face,
 * before it is first found as well as after; more end the follow for good. A
 * missed frame is left as it is: where the face is found again after it, the gap is
 * within the limit and the steady pass that runs after the merge fills it. Other
 * regions of the answer are ignored, and the clip's own regions are not changed.
 *
 * Returns a new array and leaves `rle` alone; a frame nothing is added to keeps
 * its original string. Yields to the event loop as it goes. Throws like
 * `decodeMaskRle` for a run that leaves the frame, so a caller reads a malformed
 * answer as a failed request.
 */
export async function mergeRecoveredFace(
  rle: readonly string[],
  lost: LostFace,
  answer: readonly string[],
  size: { width: number; height: number },
  gapLimit: number,
): Promise<{ readonly rle: string[]; readonly found: boolean }> {
  const { width, height } = size
  const out = [...rle]
  const pixels = new Uint8Array(width * height)
  const frames = Math.min(answer.length, lost.endFrame - lost.startFrame, rle.length - lost.startFrame)
  let box = lost.lastBox
  let previousOthers: readonly MaskRegionBox[] | undefined
  let found = false
  let missed = 0
  let sliceStart = performance.now()
  for (let i = 0; i < frames; i++) {
    const regions = maskRegionsOf(answer[i]!, width, height)
    const followed = followRegions(regions.boxes, box, previousOthers)
    if (followed.length === 0) {
      if (++missed > gapLimit) break
      previousOthers = undefined
      sliceStart = await yieldIfDue(sliceStart)
      continue
    }
    missed = 0
    box = followed.map((r) => regions.boxes[r]!).reduce(unionBox)
    const frame = lost.startFrame + i
    const existing = maskRegionsOf(rle[frame]!, width, height).boxes
    if (existing.some((other) => overlapArea(other, box) > 0)) break
    decodeMaskRle(rle[frame]!, pixels)
    forEachRun(regions, followed, width, (from, to) => pixels.fill(255, from, to))
    out[frame] = encodeMaskRle(pixels, width, height)
    found = true
    previousOthers = regions.boxes.filter((_, r) => !followed.includes(r))
    sliceStart = await yieldIfDue(sliceStart)
  }
  return { rle: out, found }
}
