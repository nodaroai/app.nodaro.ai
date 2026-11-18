/**
 * Mask tracks (providers/video/video-mask-tracks.ts): a mask's regions grouped
 * into one track per subject, the tracks a mask reports, the track a seed
 * names, and Mask Erase dropping whole tracks (`eraseMaskTracks`).
 */
import { describe, expect, it } from "vitest"
import { eraseMaskTracks, grayFrameToRle } from "../mask-erase.js"
import { reportedMaskTracks, trackMaskRegions, tracksOfSeeds, type MaskTrackInfo } from "../video-mask-tracks.js"

const W = 40
const H = 20

/** A frame (W × H) with white squares at [x, y, size]. */
function rleOf(squares: Array<[number, number, number]>): string {
  const f = new Uint8Array(W * H)
  for (const [x, y, n] of squares) for (let r = y; r < y + n; r++) f.fill(255, r * W + x, r * W + x + n)
  return grayFrameToRle(f)
}

const track = (rle: string[], cuts: number[] = [], gap = 2) => trackMaskRegions(rle, W, H, cuts, gap)

describe("trackMaskRegions", () => {
  it("follows two subjects as two tracks while each moves a little every frame", async () => {
    const rle = [0, 1, 2, 3].map((f) => rleOf([[2 + f, 2, 4], [30 - f, 10, 4]]))
    const { tracks } = await track(rle)
    expect(tracks.map((t) => [t.id, t.fromFrame, t.toFrame, t.frames])).toEqual([[0, 0, 3, 4], [1, 0, 3, 4]])
  })

  it("reports the frame to look at a track on: its largest box within the view share, in % of the frame", async () => {
    // 8 rows of 20 is the share exactly (40 %); 12 rows is past it.
    const rle = [rleOf([[4, 4, 2]]), rleOf([[4, 4, 8]]), rleOf([[4, 4, 12]]), rleOf([[4, 4, 4]])]
    const { tracks } = await track(rle)
    expect(tracks).toHaveLength(1)
    expect(tracks[0]!.viewFrame).toBe(1)
    expect(tracks[0]!.viewBox).toEqual({ leftPct: 10, topPct: 20, rightPct: 30, bottomPct: 60 })
  })

  it("prefers a frame where the subject is clear of the frame's edges to a larger one where it is cut off", async () => {
    // Frame 1: larger, but against the top edge. Frame 0: smaller, whole.
    const { tracks } = await track([rleOf([[10, 4, 4]]), rleOf([[10, 0, 8]])])
    expect(tracks[0]!.viewFrame).toBe(0)
    // Never clear of the edges: the largest within the share.
    const edge = await track([rleOf([[10, 0, 4]]), rleOf([[10, 0, 8]])])
    expect(edge.tracks[0]!.viewFrame).toBe(1)
  })

  it("looks at a track that is always past the view share on its smallest frame", async () => {
    const { tracks } = await track([rleOf([[4, 2, 14]]), rleOf([[4, 2, 10]]), rleOf([[4, 2, 16]])])
    expect(tracks[0]!.viewFrame).toBe(1)
  })

  it("keeps a track over a gap within the limit and starts a new one after a longer gap", async () => {
    const seen = rleOf([[10, 5, 4]])
    const short = await track([seen, "", "", seen])
    expect(short.tracks.map((t) => [t.fromFrame, t.toFrame, t.frames])).toEqual([[0, 3, 2]])
    const long = await track([seen, "", "", "", seen])
    expect(long.tracks.map((t) => [t.fromFrame, t.toFrame])).toEqual([[0, 0], [4, 4]])
  })

  it("never follows a subject across a shot cut, even at the same place", async () => {
    const seen = rleOf([[10, 5, 4]])
    const { tracks } = await track([seen, seen, seen, seen], [2])
    expect(tracks.map((t) => [t.fromFrame, t.toFrame])).toEqual([[0, 1], [2, 3]])
  })

  it("gives both halves of a subject the mask split in two to the same track", async () => {
    const whole = rleOf([[10, 4, 8]])
    const split = rleOf([[10, 4, 3], [15, 4, 3]])
    const { tracks, regionTrack } = await track([whole, split])
    expect(tracks).toHaveLength(1)
    expect([...regionTrack[1]!.values()]).toEqual([0, 0])
  })

  it("follows a small subject that jumped clear of its last box, and not one far away", async () => {
    const near = await track([rleOf([[10, 5, 3]]), rleOf([[13, 5, 3]])])
    expect(near.tracks).toHaveLength(1)
    const far = await track([rleOf([[2, 2, 3]]), rleOf([[34, 15, 3]])])
    expect(far.tracks).toHaveLength(2)
  })
})

describe("reportedMaskTracks", () => {
  const t = (id: number, frames: number): MaskTrackInfo => ({ id, fromFrame: id, toFrame: id + frames - 1, frames, viewFrame: id, viewBox: { leftPct: 0, topPct: 0, rightPct: 1, bottomPct: 1 } })

  it("reports every track when they fit", () => {
    expect(reportedMaskTracks([t(0, 3), t(1, 9)], 2)).toEqual({ tracks: [t(0, 3), t(1, 9)], omitted: 0 })
  })

  it("keeps the tracks on the most frames, in the order they start, and counts the rest", () => {
    const out = reportedMaskTracks([t(0, 1), t(1, 9), t(2, 5), t(3, 7)], 2)
    expect(out.tracks.map((x) => x.id)).toEqual([1, 3])
    expect(out.omitted).toBe(2)
  })
})

describe("tracksOfSeeds", () => {
  it("names the track whose region holds the point, and counts a seed on no region", async () => {
    const rle = [0, 1].map(() => rleOf([[2, 2, 4], [30, 10, 4]]))
    const tracking = await track(rle)
    // The second subject's middle on frame 1 (x 32 of 40, y 12 of 20), then a frame past the end.
    const { ids, unmatched } = tracksOfSeeds(rle, W, H, tracking, [{ frame: 1, xPct: 80, yPct: 60 }, { frame: 9, xPct: 80, yPct: 60 }])
    expect([...ids]).toEqual([1])
    expect(unmatched).toBe(1)
  })

  it("names the nearest region's track for a point between the halves of a split subject", async () => {
    const rle = [rleOf([[10, 4, 3], [15, 4, 3], [34, 14, 3]])]
    const tracking = await track(rle)
    // x 14 of 40, y 5.5 of 20: in the gap between the two halves.
    const { ids, unmatched } = tracksOfSeeds(rle, W, H, tracking, [{ frame: 0, xPct: 35, yPct: 27.5 }])
    expect(ids.size).toBe(1)
    expect(unmatched).toBe(0)
    expect([...ids][0]).not.toBe(tracking.regionTrack[0]!.get("14,34,16,37"))
  })
})

describe("eraseMaskTracks", () => {
  const geometry = { width: W, height: H, frameRate: "30/1" }

  it("drops the named subject on every frame it is on and keeps the other exactly", async () => {
    const rle = [0, 1, 2, 3].map((f) => rleOf([[2 + f, 2, 4], [30 - f, 10, 4]]))
    const out = await eraseMaskTracks(rle, geometry, [{ frame: 2, xPct: 15, yPct: 20 }])
    expect(out).toEqual({ droppedRegions: 4, erasedTracks: 1, unmatchedSeeds: 0 })
    expect(rle).toEqual([0, 1, 2, 3].map((f) => rleOf([[30 - f, 10, 4]])))
  })

  it("leaves the same place alone after a cut the mask was made with", async () => {
    const seen = rleOf([[10, 5, 4]])
    const rle = [seen, seen, seen, seen]
    const out = await eraseMaskTracks(rle, geometry, [{ frame: 0, xPct: 30, yPct: 35 }], [2])
    expect(out.droppedRegions).toBe(2)
    expect(rle).toEqual(["", "", seen, seen])
  })

  it("changes nothing when its seed is on a frame with no region", async () => {
    const seen = rleOf([[10, 5, 4]])
    const rle = [seen, seen, ""]
    expect(await eraseMaskTracks(rle, geometry, [{ frame: 2, xPct: 30, yPct: 35 }])).toEqual({ droppedRegions: 0, erasedTracks: 0, unmatchedSeeds: 1 })
    expect(rle).toEqual([seen, seen, ""])
  })
})
