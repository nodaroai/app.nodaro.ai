import { describe, expect, it } from "vitest"
import type { FaceBox } from "../face-mesh-filters.js"
import { FaceMeshTracker, type MeshedFace } from "../face-mesh-smooth.js"
import {
  FACE_MESH_LOOKAHEAD_FRAMES,
  FACE_MESH_MIN_FOUND_FRAMES,
  FACE_MESH_TRACK_MAX_APART,
  FaceMeshLookahead,
  FoundFaceTracks,
  facesToDraw,
} from "../face-mesh-tracks.js"

// Two places in the frame (fractions), far apart, and the same face moved a little.
const A: FaceBox = { x: 0.4, y: 0.3, w: 0.1, h: 0.18 }
const B: FaceBox = { x: 0.7, y: 0.3, w: 0.1, h: 0.18 }
const moved = (b: FaceBox, dx: number): FaceBox => ({ ...b, x: b.x + dx })

/** A clip of `length` frames: each frame holds the boxes found in it, listed per place (`found[place]` = its frames). */
function clip(length: number, found: ReadonlyArray<readonly [FaceBox, readonly number[]]>): FaceBox[][] {
  return Array.from({ length }, (_, f) => found.filter(([, frames]) => frames.includes(f)).map(([box]) => box))
}

/** The frames on which the face at `place` is drawn (whole clip). */
function drawnAt(frames: readonly (readonly FaceBox[])[], place: FaceBox): number[] {
  const draw = facesToDraw(frames)
  return frames.flatMap((boxes, f) => (boxes.some((b, i) => b === place && draw[f]![i]) ? [f] : []))
}

/** The same clip through the streaming lookahead: per frame, in the order released, the boxes drawn. */
function streamed(frames: readonly (readonly FaceBox[])[]): { order: number[]; drawn: FaceBox[][]; heldAfterPush: number[] } {
  const look = new FaceMeshLookahead<number, { box: FaceBox }>()
  const order: number[] = []
  const drawn: FaceBox[][] = []
  const heldAfterPush: number[] = []
  const take = (out: ReadonlyArray<{ item: number; drawn: readonly { box: FaceBox }[] }>) => {
    for (const o of out) {
      order.push(o.item)
      drawn.push(o.drawn.map((f) => f.box))
    }
  }
  frames.forEach((boxes, f) => {
    take(look.push(f, boxes.map((box) => ({ box }))))
    heldAfterPush.push(look.held)
  })
  take(look.flush())
  return { order, drawn, heldAfterPush }
}

const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i)

describe("the rule's values", () => {
  it("a face is drawn when found in at least 3 frames of its track; a track links frames at most 2 apart; a frame waits 4 frames for its decision", () => {
    expect(FACE_MESH_MIN_FOUND_FRAMES).toBe(3)
    expect(FACE_MESH_TRACK_MAX_APART).toBe(2)
    // A face found at n is decided once n + 4 is read: found at n, n + 2 and n + 4 is the latest a third find can come.
    expect(FACE_MESH_LOOKAHEAD_FRAMES).toBe((FACE_MESH_MIN_FOUND_FRAMES - 1) * FACE_MESH_TRACK_MAX_APART)
  })
})

describe("facesToDraw (the whole clip)", () => {
  it("a face found in one frame is never drawn", () => {
    expect(drawnAt(clip(10, [[A, [4]]]), A)).toEqual([])
  })

  it("a face found in two frames is never drawn, in a row or one frame apart", () => {
    expect(drawnAt(clip(10, [[A, [4, 5]]]), A)).toEqual([])
    expect(drawnAt(clip(10, [[A, [4, 6]]]), A)).toEqual([])
  })

  it("a face found in three frames in a row is drawn on all three", () => {
    expect(drawnAt(clip(10, [[A, [4, 5, 6]]]), A)).toEqual([4, 5, 6])
  })

  it("three finds with a frame missed between each are one track (2 apart): drawn; three 3 apart are three tracks: never drawn", () => {
    expect(drawnAt(clip(10, [[A, [2, 4, 6]]]), A)).toEqual([2, 4, 6])
    expect(drawnAt(clip(10, [[A, [0, 3, 6]]]), A)).toEqual([])
  })

  it("a long track with a one-frame dip: drawn wherever it is found, and the track is kept across the dip", () => {
    const frames = clip(12, [[A, [...range(0, 4), ...range(6, 10)]]])
    expect(drawnAt(frames, A)).toEqual([...range(0, 4), ...range(6, 10)])
    const tracks = new FoundFaceTracks()
    const linked = frames.map((boxes) => tracks.link(boxes))
    expect(linked[6]![0]).toBe(linked[4]![0]) // one track on both sides of the dip
    expect(linked[10]![0]!.found).toBe(10)
  })

  it("a long track with a two-frame dip, long on both sides: drawn wherever it is found", () => {
    const on = [...range(0, 4), ...range(7, 11)]
    expect(drawnAt(clip(12, [[A, on]]), A)).toEqual(on)
  })

  it("found in 5 frames, a two-frame dip, then found in 2: the 2 after the dip are a track of their own and not drawn (frames 3 apart are not linked)", () => {
    expect(drawnAt(clip(12, [[A, [...range(0, 4), 7, 8]]]), A)).toEqual(range(0, 4))
  })

  it("a false face found in one frame beside a real face: only the real one is drawn", () => {
    const frames = clip(10, [[A, range(0, 9)], [B, [5]]])
    expect(drawnAt(frames, A)).toEqual(range(0, 9))
    expect(drawnAt(frames, B)).toEqual([])
  })

  it("a face found only in the clip's last two frames is not drawn (it never reaches 3)", () => {
    expect(drawnAt(clip(10, [[A, [8, 9]]]), A)).toEqual([])
  })

  it("a face found in the clip's last three frames is drawn on all three", () => {
    expect(drawnAt(clip(10, [[A, [7, 8, 9]]]), A)).toEqual([7, 8, 9])
  })

  it("a face that moves keeps its track (box overlap, frame to frame); two faces that swap places in the list keep theirs", () => {
    const frames = range(0, 5).map((f) => (f % 2 === 0 ? [moved(A, 0.01 * f), moved(B, -0.01 * f)] : [moved(B, -0.01 * f), moved(A, 0.01 * f)]))
    const draw = facesToDraw(frames)
    expect(draw.every((d) => d.length === 2 && d.every(Boolean))).toBe(true)
    const tracks = new FoundFaceTracks()
    const linked = frames.map((boxes) => tracks.link(boxes))
    expect(linked[1]![1]).toBe(linked[0]![0]) // A, listed second in frame 1
    expect(linked[1]![0]).toBe(linked[0]![1]) // B, listed first
  })

  it("a box that overlaps a found face too little (under the smoothing's threshold) is another face", () => {
    const far = moved(A, 0.07) // IoU 0.03/0.17 ≈ 0.18 with A
    expect(drawnAt(clip(6, [[A, [0, 1]], [far, [2]]]), A)).toEqual([])
    expect(drawnAt(clip(6, [[A, [0, 1]], [far, [2]]]), far)).toEqual([])
  })

  it("the counts are those drawn: one entry per face found, in the frame's own order", () => {
    const frames = clip(8, [[A, range(0, 7)], [B, [3]]])
    const draw = facesToDraw(frames)
    expect(draw.map((d) => d.length)).toEqual(frames.map((f) => f.length))
    expect(draw.flat().filter(Boolean)).toHaveLength(8)
  })
})

describe("FaceMeshLookahead (the drawer's stream)", () => {
  it("every frame comes out once, in order: the frame count is unchanged, a clip shorter than the lookahead too", () => {
    for (const length of [0, 1, 2, FACE_MESH_LOOKAHEAD_FRAMES, FACE_MESH_LOOKAHEAD_FRAMES + 1, 30]) {
      const { order } = streamed(clip(length, [[A, range(0, length - 1)]]))
      expect(order).toEqual(range(0, length - 1))
    }
  })

  it("holds at most FACE_MESH_LOOKAHEAD_FRAMES frames between pushes, and releases each exactly that many frames later", () => {
    const look = new FaceMeshLookahead<number, { box: FaceBox }>()
    for (let f = 0; f < 12; f++) {
      const out = look.push(f, [{ box: A }])
      expect(out.map((o) => o.item)).toEqual(f >= FACE_MESH_LOOKAHEAD_FRAMES ? [f - FACE_MESH_LOOKAHEAD_FRAMES] : [])
      expect(look.held).toBe(Math.min(f + 1, FACE_MESH_LOOKAHEAD_FRAMES))
    }
    expect(look.flush().map((o) => o.item)).toEqual(range(12 - FACE_MESH_LOOKAHEAD_FRAMES, 11))
    expect(look.held).toBe(0)
  })

  it("waits long enough: a face found at n, n + 2 and n + 4 is drawn at n, decided only once n + 4 is read", () => {
    const { drawn } = streamed(clip(9, [[A, [0, 2, 4]]]))
    expect(drawn[0]).toEqual([A])
    expect(drawn[2]).toEqual([A])
    expect(drawn[4]).toEqual([A])
  })

  it("decides exactly as the whole clip does, on any clip (random places, finds and dips)", () => {
    // A small deterministic generator (mulberry32): four places, two of them overlapping, each found with its own odds, jittered.
    let seed = 20261103
    const rand = () => {
      seed = (seed + 0x6d2b79f5) | 0
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
    const places = [A, B, { x: 0.1, y: 0.6, w: 0.05, h: 0.09 }, { x: 0.12, y: 0.62, w: 0.06, h: 0.1 }]
    for (let run = 0; run < 200; run++) {
      const odds = places.map(() => rand())
      const length = 1 + Math.floor(rand() * 40)
      const frames = Array.from({ length }, () =>
        places.flatMap((p, i) => (rand() < odds[i]! ? [moved(p, (rand() - 0.5) * 0.02)] : [])),
      )
      const whole = facesToDraw(frames).map((d, f) => frames[f]!.filter((_, i) => d[i]))
      const { order, drawn } = streamed(frames)
      expect(order).toEqual(range(0, length - 1))
      expect(drawn).toEqual(whole)
    }
  })

  it("the smoothing gets exactly the faces drawn, frame by frame: no jump where a stray is left out, and a face missed for a frame starts afresh as before", () => {
    // A face drifting slowly, shimmering by a pixel, missed at frame 9; a stray found once at frame 6, listed first,
    // its box beside the face's (an overlap under the threshold, as YuNet's NMS leaves two faces of one frame).
    const face = (f: number): MeshedFace => ({ box: moved(A, 0.002 * f), points: Float64Array.from([400 + 2 * f + (f % 2), 300, 450 + 2 * f, 350]) })
    const stray: MeshedFace = { box: moved(A, 0.09), points: Float64Array.from([490, 300, 540, 350]) }
    const foundIn = (f: number, withStray: boolean): MeshedFace[] => [...(withStray && f === 6 ? [stray] : []), ...(f === 9 ? [] : [face(f)])]
    // As the drawer does: every frame released, in order, its drawn faces (none on frame 9) to the smoothing.
    const look = new FaceMeshLookahead<number, MeshedFace>()
    const smoothing = new FaceMeshTracker(30)
    const got: Array<number[]> = []
    const draw = (frames: ReadonlyArray<{ item: number; drawn: readonly MeshedFace[] }>) => {
      for (const { drawn } of frames) got.push(smoothing.next(drawn).map((p) => p[0]!))
    }
    for (let f = 0; f < 14; f++) draw(look.push(f, foundIn(f, true)))
    draw(look.flush())
    // The same smoothing given the clip as if the stray had never been found.
    const reference = new FaceMeshTracker(30)
    const want = Array.from({ length: 14 }, (_, f) => reference.next(foundIn(f, false)).map((p) => p[0]!))
    expect(got).toEqual(want)
    expect(got[6]).toHaveLength(1) // the stray is not drawn
    expect(got[9]).toEqual([]) // the face is missed…
    expect(got[10]![0]).toBe(face(10).points[0]) // …and drawn again it starts afresh
  })
})
