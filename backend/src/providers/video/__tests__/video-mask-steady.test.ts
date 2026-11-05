import { describe, it, expect } from "vitest"
import { decodeMaskRle } from "../video-mask.js"
import {
  STEADY_MAX_EXTRA_REQUESTS,
  STEADY_MIN_TRACK_FRAMES,
  encodeMaskRle,
  mergeRecoveredFace,
  pickLostFaces,
  steadyGapLimitFrames,
  steadyMaskPass,
  type LostFace,
  type SteadyPlan,
} from "../video-mask-steady.js"

const W = 100
const H = 100

/** A rectangle's RLE: one 1-based row-major `start length` pair a row. */
function rect(x: number, y: number, w: number, h: number, width: number = W): string {
  const runs: string[] = []
  for (let r = 0; r < h; r++) runs.push(`${(y + r) * width + x + 1} ${w}`)
  return runs.join(" ")
}

const join = (...parts: string[]): string => parts.filter((p) => p !== "").join(" ")

const plan = (over: Partial<SteadyPlan> = {}): SteadyPlan => ({
  width: W, height: H, cutFrames: [], detectionFrames: [0], gapLimit: 8, emptyGapLimit: 24, ...over,
})

/** The white pixels of one frame's RLE inside a rectangle. */
function pixelsIn(rle: string, x: number, y: number, w: number, h: number): number {
  const frame = new Uint8Array(W * H)
  decodeMaskRle(rle, frame)
  let n = 0
  for (let r = y; r < y + h; r++) for (let c = x; c < x + w; c++) if (frame[r * W + c] !== 0) n++
  return n
}

const pixelsOf = (rle: string): number => pixelsIn(rle, 0, 0, W, H)

function drawn(rle: string): Uint8Array {
  const frame = new Uint8Array(W * H)
  decodeMaskRle(rle, frame)
  return frame
}

const FACE_A = { x: 10, y: 10, w: 10, h: 10 }
const FACE_B = { x: 50, y: 50, w: 10, h: 10 }
const A = rect(FACE_A.x, FACE_A.y, FACE_A.w, FACE_A.h)
const B = rect(FACE_B.x, FACE_B.y, FACE_B.w, FACE_B.h)
const AB = join(A, B)
const hasA = (rle: string): boolean => pixelsIn(rle, FACE_A.x, FACE_A.y, FACE_A.w, FACE_A.h) === 100
const hasB = (rle: string): boolean => pixelsIn(rle, FACE_B.x, FACE_B.y, FACE_B.w, FACE_B.h) === 100
const noB = (rle: string): boolean => pixelsIn(rle, FACE_B.x, FACE_B.y, FACE_B.w, FACE_B.h) === 0

const repeat = (rle: string, frames: number): string[] => Array<string>(frames).fill(rle)

describe("steadyMaskPass: gaps", () => {
  // A on every frame; B on, on, off, on, off, off…
  const blink = [AB, AB, A, AB, A, A, A, A, A, A]

  it("fills a one-frame blink when another face stays masked", async () => {
    const result = await steadyMaskPass(blink, plan())
    expect(hasB(result.rle[2]!)).toBe(true)
    expect(hasA(result.rle[2]!)).toBe(true)
    expect(result.filledFrames).toBe(1)
    expect(result.removedRegions).toBe(0)
  })

  it("does not fill past the last frame the face was seen", async () => {
    const result = await steadyMaskPass(blink, plan())
    for (const f of [4, 5, 6, 7, 8, 9]) expect(noB(result.rle[f]!)).toBe(true)
  })

  it("does not fill a gap longer than the limit", async () => {
    const rle = [...repeat(AB, 3), ...repeat(A, 9), ...repeat(AB, 3)]
    const result = await steadyMaskPass(rle, plan())
    for (let f = 3; f < 12; f++) expect(noB(result.rle[f]!)).toBe(true)
    expect(result.filledFrames).toBe(0)
  })

  it("fills a gap exactly at the limit", async () => {
    const rle = [...repeat(AB, 3), ...repeat(A, 8), ...repeat(AB, 3)]
    const result = await steadyMaskPass(rle, plan())
    for (let f = 3; f < 11; f++) expect(hasB(result.rle[f]!)).toBe(true)
    expect(result.filledFrames).toBe(8)
  })

  it("fills wholly empty frames only when the face returns", async () => {
    const back = await steadyMaskPass([...repeat(A, 3), "", "", "", ...repeat(A, 3)], plan())
    for (const f of [3, 4, 5]) expect(hasA(back.rle[f]!)).toBe(true)
    expect(back.filledFrames).toBe(3)

    const gone = await steadyMaskPass([...repeat(A, 3), "", "", ""], plan())
    for (const f of [3, 4, 5]) expect(gone.rle[f]).toBe("")
    expect(gone.filledFrames).toBe(0)
  })

  it("copies the face from its last frame before the gap, without movement", async () => {
    const moved = rect(12, 10, 10, 10)
    const result = await steadyMaskPass([A, A, moved, "", moved], plan())
    expect(result.rle[3]).toBe(encodeMaskRle(drawn(moved), W, H))
  })

  it("adds the copy to what the frame already holds", async () => {
    const result = await steadyMaskPass([...repeat(AB, 3), A, ...repeat(AB, 3)], plan())
    expect(pixelsOf(result.rle[3]!)).toBe(200)
  })

  describe("a speck is not the face returning", () => {
    const speck = rect(12, 12, 2, 2)
    const gone = repeat("", 4)

    it("leaves the gap empty and removes a one-frame speck on the face's box", async () => {
      const result = await steadyMaskPass([...repeat(A, 41), ...gone, speck, ...repeat("", 15)], plan())
      for (const f of [41, 42, 43, 44]) expect(result.rle[f]).toBe("")
      expect(result.rle[45]).toBe("")
      expect(result.filledFrames).toBe(0)
      expect(result.removedRegions).toBe(1)
    })

    it("keeps a speck that lasts, as a track of its own, and still leaves the gap empty", async () => {
      const result = await steadyMaskPass([...repeat(A, 41), ...gone, ...repeat(speck, 4), ...repeat("", 11)], plan())
      for (const f of [41, 42, 43, 44]) expect(result.rle[f]).toBe("")
      for (const f of [45, 46, 47, 48]) expect(pixelsOf(result.rle[f]!)).toBe(4)
      expect(result.filledFrames).toBe(0)
      expect(result.removedRegions).toBe(0)
    })

    it("leaves the track absent, so the face itself can still return after the speck", async () => {
      const result = await steadyMaskPass([...repeat(A, 41), "", "", speck, "", "", ...repeat(A, 5)], plan())
      for (const f of [41, 42, 43, 44, 45]) expect(hasA(result.rle[f]!)).toBe(true)
      expect(result.filledFrames).toBe(5)
      expect(result.removedRegions).toBe(1)
    })

    it("still reports the face lost, from where it went and with its own box", async () => {
      const faceBox = { top: 10, bottom: 19, left: 10, right: 20 }
      const once = await steadyMaskPass([...repeat(A, 41), ...gone, speck, ...repeat("", 15)], plan())
      expect(once.lost).toEqual([{ startFrame: 41, endFrame: 61, lastBox: faceBox, peakPixels: 100 }])
      // A speck that lasts is a track of its own, and it lies on the box for as long as it is there.
      const lasting = await steadyMaskPass([...repeat(A, 41), ...gone, ...repeat(speck, 4), ...repeat("", 11)], plan())
      expect(lasting.lost.find((l) => l.startFrame === 41)).toEqual({ startFrame: 41, endFrame: 60, lastBox: faceBox, peakPixels: 100 })
    })

    it("counts a return of exactly half the box's area, and not one just under", async () => {
      const half = rect(10, 10, 10, 5)
      const under = rect(10, 10, 7, 7)
      const atHalf = await steadyMaskPass([...repeat(A, 5), "", ...repeat(half, 3)], plan())
      expect(hasA(atHalf.rle[5]!)).toBe(true)
      const below = await steadyMaskPass([...repeat(A, 5), "", ...repeat(under, 3)], plan())
      expect(below.rle[5]).toBe("")
    })

    it("judges a face returning in pieces by the box around them all", async () => {
      // Neither piece is half the box alone; together they span all of it.
      const pieces = join(rect(10, 10, 10, 2), rect(10, 18, 10, 2))
      const result = await steadyMaskPass([...repeat(A, 5), "", ...repeat(pieces, 3)], plan())
      expect(hasA(result.rle[5]!)).toBe(true)
      expect(result.filledFrames).toBe(1)
    })

    it("does not count a larger region returning either", async () => {
      const huge = rect(5, 5, 40, 40)
      const result = await steadyMaskPass([...repeat(A, 5), "", ...repeat(huge, 3)], plan())
      expect(result.rle[5]).toBe("")
      expect(result.filledFrames).toBe(0)
    })
  })

  describe("a lone face, in an empty mask, at 24 fps with a detection every 24 frames", () => {
    const every24 = { detectionFrames: [0, 24, 48, 72] }
    /** The face on every frame of the clip but those from `gone` up to `back`. */
    const lone = (face: string, gone: number, back: number, total = 96): string[] =>
      Array.from({ length: total }, (_, f) => (f >= gone && f < back ? "" : face))

    it.each([
      ["a chunk that misses it whole", 24, 48],
      ["a short drop inside a chunk", 20, 30],
      ["a drop across a detection", 18, 40],
      ["a drop of exactly the limit across a detection", 16, 40],
    ])("covers every frame: %s", async (_name, gone, back) => {
      const result = await steadyMaskPass(lone(A, gone, back), plan(every24))
      expect(result.rle.every(hasA)).toBe(true)
      expect(result.filledFrames).toBe(back - gone)
      expect(result.lost).toEqual([])
    })

    it("covers every frame of a head touching the top edge", async () => {
      const head = rect(10, 0, 10, 10)
      const result = await steadyMaskPass(lone(head, 30, 44), plan(every24))
      for (const rle of result.rle) expect(pixelsIn(rle, 10, 0, 10, 10)).toBe(100)
      expect(result.filledFrames).toBe(14)
      expect(result.lost).toEqual([])
    })

    it("does not fill a gap one frame past the limit, and reports the face lost", async () => {
      const result = await steadyMaskPass(lone(A, 30, 55), plan(every24))
      for (let f = 30; f < 55; f++) expect(result.rle[f]).toBe("")
      expect(result.filledFrames).toBe(0)
      expect(result.lost.map((l) => [l.startFrame, l.endFrame])).toEqual([[30, 48]])
    })

    it("does not fill when the face never comes back", async () => {
      const result = await steadyMaskPass(lone(A, 30, 96), plan(every24))
      for (let f = 30; f < 96; f++) expect(result.rle[f]).toBe("")
      expect(result.filledFrames).toBe(0)
      expect(result.lost.map((l) => [l.startFrame, l.endFrame])).toEqual([[30, 48]])
    })

    it("does not fill across a cut", async () => {
      const rle = lone(A, 30, 40)
      const result = await steadyMaskPass(rle, plan({ cutFrames: [35], detectionFrames: [0, 24, 35, 59, 83] }))
      for (let f = 30; f < 40; f++) expect(result.rle[f]).toBe("")
      expect(result.filledFrames).toBe(0)
    })

    it("does not fill when something other than the face returns", async () => {
      const speck = rect(12, 12, 2, 2)
      const rle = [...lone(A, 30, 96, 44), ...repeat(speck, 5), ...repeat("", 47)]
      const result = await steadyMaskPass(rle, plan(every24))
      for (let f = 30; f < 44; f++) expect(result.rle[f]).toBe("")
      expect(result.filledFrames).toBe(0)
    })

    it("keeps a fill to the frames that were empty and to its own source", async () => {
      const moved = rect(12, 10, 10, 10)
      const result = await steadyMaskPass([...repeat(A, 30), moved, ...repeat("", 20), ...repeat(moved, 45)], plan(every24))
      expect(result.rle[31]).toBe(encodeMaskRle(drawn(moved), W, H))
      expect(result.filledFrames).toBe(20)
    })

    describe("with another region on a frame of the gap", () => {
      const withB = (rle: string[], ...frames: number[]): string[] => rle.map((frame, f) => (frames.includes(f) ? B : frame))

      it("keeps the shorter limit, whichever frame of the gap holds it", async () => {
        for (const other of [30, 37, 44]) {
          const result = await steadyMaskPass(withB(lone(A, 30, 45), other), plan(every24))
          for (let f = 30; f < 45; f++) expect(hasA(result.rle[f]!)).toBe(false)
        }
      })

      it("still fills up to the shorter limit", async () => {
        const result = await steadyMaskPass(withB(lone(A, 30, 38), 34), plan(every24))
        for (let f = 30; f < 38; f++) expect(hasA(result.rle[f]!)).toBe(true)
      })

      it("does not fill one frame past the shorter limit", async () => {
        const result = await steadyMaskPass(withB(lone(A, 30, 39), 34), plan(every24))
        for (let f = 30; f < 39; f++) expect(hasA(result.rle[f]!)).toBe(false)
      })

      it("counts a second face arriving on the frame the first returns as no region in the gap", async () => {
        const rle = lone(A, 30, 45).map((frame, f) => (f === 45 ? join(frame, B) : frame))
        const result = await steadyMaskPass(rle, plan(every24))
        for (let f = 30; f < 45; f++) expect(hasA(result.rle[f]!)).toBe(true)
      })
    })

    describe("a stray on a few scattered frames is not a face", () => {
      /** `total` frames, holding `region` on the frames listed and nothing on the rest. */
      const on = (region: string, total: number, ...frames: number[]): string[] =>
        Array.from({ length: total }, (_, f) => (frames.includes(f) ? region : ""))
      const stray = rect(40, 40, 12, 12)
      const speck = rect(40, 40, 2, 2)

      it("removes a region seen once a detection, with no fill and no lost report", async () => {
        const result = await steadyMaskPass(on(stray, 96, 0, 24, 48, 72), plan(every24))
        expect(result.filledFrames).toBe(0)
        expect(result.removedRegions).toBe(4)
        expect(result.lost).toEqual([])
        expect(result.rle.every((frame) => frame === "")).toBe(true)
      })

      it("does not bridge a speck on frames 10, 11 and 30", async () => {
        const result = await steadyMaskPass(on(speck, 96, 10, 11, 30), plan(every24))
        expect(result.filledFrames).toBe(0)
        for (let f = 12; f < 30; f++) expect(result.rle[f]).toBe("")
      })

      it("removes a region on frames 0 and 24", async () => {
        const result = await steadyMaskPass(on(stray, 96, 0, 24), plan(every24))
        expect(result.filledFrames).toBe(0)
        expect(result.removedRegions).toBe(2)
        expect(result.lost).toEqual([])
        expect(result.rle.every((frame) => frame === "")).toBe(true)
      })

      it("gives a track of exactly 3 frames before an empty gap the long limit", async () => {
        const result = await steadyMaskPass([...repeat(A, 3), ...repeat("", 20), ...repeat(A, 3)], plan(every24))
        expect(result.rle.every(hasA)).toBe(true)
        expect(result.filledFrames).toBe(20)
        expect(result.removedRegions).toBe(0)
      })

      it("keeps a track of exactly 2 frames before an empty gap to the shorter limit", async () => {
        const result = await steadyMaskPass([...repeat(A, 2), ...repeat("", 20), ...repeat(A, 3)], plan(every24))
        for (let f = 2; f < 22; f++) expect(result.rle[f]).toBe("")
        expect(result.filledFrames).toBe(0)
        expect(result.removedRegions).toBe(2)
      })

      it("still fills a track of 2 frames within the shorter limit", async () => {
        const result = await steadyMaskPass([...repeat(A, 2), ...repeat("", 8), ...repeat(A, 3)], plan(every24))
        expect(result.filledFrames).toBe(8)
        expect(result.rle.every(hasA)).toBe(true)
      })
    })

    it("fills two faces that drop together and come back together", async () => {
      const rle = Array.from({ length: 60 }, (_, f) => (f >= 20 && f < 40 ? "" : AB))
      const result = await steadyMaskPass(rle, plan())
      for (const frame of result.rle) {
        expect(hasA(frame)).toBe(true)
        expect(hasB(frame)).toBe(true)
      }
      expect(result.lost).toEqual([])
    })

    it("never fills past the shorter limit when the two limits are the same", async () => {
      const result = await steadyMaskPass(lone(A, 30, 39), plan({ ...every24, emptyGapLimit: 8 }))
      expect(result.filledFrames).toBe(0)
    })
  })

  it("keeps a face that flickers at a size filter", async () => {
    const rle = [...repeat(A, 4), "", "", ...repeat(A, 4), "", "", ...repeat(A, 4)]
    const result = await steadyMaskPass(rle, plan())
    expect(result.rle.every(hasA)).toBe(true)
    expect(result.filledFrames).toBe(4)
    expect(result.removedRegions).toBe(0)
  })
})

describe("steadyMaskPass: pops", () => {
  it("removes a one-frame and a two-frame pop", async () => {
    const C = rect(70, 10, 5, 5)
    const D = rect(10, 70, 5, 5)
    const E = rect(70, 70, 5, 5)
    const rle = [
      join(A, C), A, join(A, D), join(A, D), A,
      join(A, E), join(A, E), join(A, E), A, A,
    ]
    const result = await steadyMaskPass(rle, plan())
    expect(STEADY_MIN_TRACK_FRAMES).toBe(3)
    expect(result.removedRegions).toBe(3)
    expect(result.rle.slice(0, 5)).toEqual(repeat(encodeMaskRle(drawn(A), W, H), 5))
    expect(pixelsIn(result.rle[5]!, 70, 70, 5, 5)).toBe(25)
    expect(pixelsIn(result.rle[7]!, 70, 70, 5, 5)).toBe(25)
  })

  it("counts a region at the shot's first or last frame like any other", async () => {
    const atStart = await steadyMaskPass([B, B, ...repeat(A, 6)], plan())
    expect(atStart.removedRegions).toBe(2)
    expect(noB(atStart.rle[0]!)).toBe(true)
    expect(noB(atStart.rle[1]!)).toBe(true)

    const atEnd = await steadyMaskPass([...repeat(A, 6), AB, AB], plan())
    expect(atEnd.removedRegions).toBe(2)
    expect(noB(atEnd.rle[7]!)).toBe(true)
  })

  it("does not count filled frames toward a track's length", async () => {
    // On, off, on: two frames with the region, however short the gap. Removed, and the gap stays empty.
    const result = await steadyMaskPass([join(A, B), A, join(A, B), A, A], plan())
    expect(result.removedRegions).toBe(2)
    expect(result.filledFrames).toBe(0)
    expect(result.rle.every(noB)).toBe(true)
  })

  it("removes a pop and fills a gap on the same frame", async () => {
    const pop = rect(70, 70, 5, 5)
    const result = await steadyMaskPass([...repeat(A, 3), pop, ...repeat(A, 3)], plan())
    expect(result.rle[3]).toBe(A)
    expect(result.removedRegions).toBe(1)
    expect(result.filledFrames).toBe(1)
  })

  describe("a piece of a face is not a pop", () => {
    // Two pieces whose boxes do not touch, each its own track on the frame they open, and the face they join into.
    const left = rect(10, 10, 10, 20)
    const right = rect(22, 10, 10, 20)
    const pieces = join(left, right)
    const whole = rect(10, 10, 22, 20)
    const hasBothPieces = (rle: string): boolean => pixelsIn(rle, 10, 10, 10, 20) === 200 && pixelsIn(rle, 22, 10, 10, 20) === 200

    it("keeps both pieces when they join after one frame", async () => {
      const result = await steadyMaskPass([pieces, ...repeat(whole, 9)], plan())
      expect(result.removedRegions).toBe(0)
      expect(result.rle.every(hasBothPieces)).toBe(true)
    })

    it("keeps both pieces when they join after two frames", async () => {
      const result = await steadyMaskPass([pieces, pieces, ...repeat(whole, 8)], plan())
      expect(result.removedRegions).toBe(0)
      expect(result.rle.every(hasBothPieces)).toBe(true)
    })

    it("keeps a piece whose track went into another short one that survives", async () => {
      // b goes into a's track on frame 1, and a's goes into c's on frame 2 (c's box is the wider): only c's lasts.
      const a = rect(10, 10, 10, 10)
      const b = rect(22, 10, 10, 10)
      const c = rect(34, 10, 30, 10)
      const ab = rect(10, 10, 22, 10)
      const all = rect(10, 10, 54, 10)
      const result = await steadyMaskPass([join(a, b, c), join(ab, c), ...repeat(all, 8)], plan())
      expect(result.removedRegions).toBe(0)
      for (const rle of result.rle) {
        expect(pixelsIn(rle, 10, 10, 10, 10)).toBe(100)
        expect(pixelsIn(rle, 22, 10, 10, 10)).toBe(100)
        expect(pixelsIn(rle, 34, 10, 30, 10)).toBe(300)
      }
    })

    it("still removes a pop no surviving track overlaps on the next frame", async () => {
      const pop = rect(70, 70, 5, 5)
      const result = await steadyMaskPass([...repeat(A, 3), join(A, pop), ...repeat(A, 6)], plan())
      expect(result.removedRegions).toBe(1)
      expect(pixelsIn(result.rle[3]!, 70, 70, 5, 5)).toBe(0)
    })

    it("still removes a pop only another pop overlaps on the next frame", async () => {
      // Two pops join and are gone a frame later: one track of 1 frame and one of 2, and nothing that lasts lies on them.
      const pop1 = rect(60, 60, 5, 5)
      const pop2 = rect(70, 60, 5, 5)
      const joined = rect(60, 60, 15, 5)
      const result = await steadyMaskPass([...repeat(A, 3), join(A, pop1, pop2), join(A, joined), ...repeat(A, 6)], plan())
      expect(result.removedRegions).toBe(3)
      for (const f of [3, 4]) expect(pixelsOf(result.rle[f]!)).toBe(100)
    })

    it("looks only at the frame right after a track ends", async () => {
      // Two frames later the face has reached the pop's box: too late to speak for it.
      const pop = rect(40, 40, 10, 10)
      const far = rect(20, 40, 18, 10)
      const near = rect(24, 40, 18, 10)
      const rle = [...repeat(far, 3), join(far, pop), far, ...repeat(near, 5)]
      const result = await steadyMaskPass(rle, plan())
      expect(result.removedRegions).toBe(1)
      expect(pixelsIn(result.rle[3]!, 40, 40, 10, 10)).toBe(0)
    })

    it("does not look across a cut", async () => {
      // The face goes on as one region after the cut, on the short piece's box: another picture.
      const rle = [...repeat(left, 6), pieces, pieces, ...repeat(whole, 8)]
      const result = await steadyMaskPass(rle, plan({ cutFrames: [8] }))
      expect(result.removedRegions).toBe(2)
      for (const f of [6, 7]) expect(pixelsIn(result.rle[f]!, 22, 10, 10, 20)).toBe(0)
    })

    it("does not keep a track for what overlapped it before it came back and ended", async () => {
      // p is seen on frames 0 and 2, and the clip ends there. On frame 1 the face q lay on p's box: not the frame after p's end.
      const p = rect(10, 10, 10, 10)
      const qFar = rect(22, 10, 10, 10)
      const qNear = rect(18, 10, 10, 10)
      const result = await steadyMaskPass([join(p, qFar), qNear, join(p, qFar)], plan())
      expect(result.removedRegions).toBe(2)
      for (const f of [0, 2]) expect(pixelsIn(result.rle[f]!, 10, 10, 10, 10)).toBe(0)
    })
  })

  it("leaves nothing when every region was a pop", async () => {
    const result = await steadyMaskPass([A, A, "", ""], plan())
    expect(result.rle).toEqual(["", "", "", ""])
    expect(result.removedRegions).toBe(2)
    expect(result.lost).toEqual([])
  })
})

describe("steadyMaskPass: tracks", () => {
  // A face that opens as one region, then splits in two inside its own box.
  const whole = rect(10, 10, 30, 20)
  const left = rect(10, 10, 12, 20)
  const right = rect(26, 10, 14, 20)
  const pieces = join(left, right)

  it("keeps a face split in two pieces as one track", async () => {
    // In two pieces from the first frame: an L and a block in its open corner, boxes intersecting, pixels apart.
    const corner = join(rect(10, 10, 5, 20), rect(15, 25, 15, 5))
    const block = rect(20, 12, 8, 8)
    const rle = [...repeat(join(corner, block), 3), "", "", ...repeat(corner, 3)]
    const result = await steadyMaskPass(rle, plan())
    for (const f of [3, 4]) {
      expect(pixelsOf(result.rle[f]!)).toBe(175 + 64)
      expect(pixelsIn(result.rle[f]!, 20, 12, 8, 8)).toBe(64)
    }
    expect(result.filledFrames).toBe(2)
    expect(result.removedRegions).toBe(0)
    expect(result.lost).toEqual([])
  })

  it("keeps a face that splits after it opens as one track", async () => {
    // The piece that comes back is half the box around both, the least that counts as the face returning.
    const back = rect(10, 10, 15, 20)
    const rle = [whole, whole, pieces, pieces, "", "", back, back, back]
    const result = await steadyMaskPass(rle, plan())
    // The gap holds the track's whole last frame, not only the piece that came back.
    for (const f of [4, 5]) {
      expect(pixelsIn(result.rle[f]!, 10, 10, 12, 20)).toBe(240)
      expect(pixelsIn(result.rle[f]!, 26, 10, 14, 20)).toBe(280)
    }
    expect(result.filledFrames).toBe(2)
    expect(result.removedRegions).toBe(0)
  })

  it("keeps regions opening apart as separate tracks", async () => {
    // Boxes that do not intersect, on the frame they open: each is judged alone.
    const result = await steadyMaskPass([AB, AB, AB, ...repeat(A, 23)], plan())
    expect(result.lost.map((l) => l.lastBox.left)).toEqual([FACE_B.x])
  })

  it("follows a region to the track it overlaps the most", async () => {
    // The moved region touches both boxes, and a's more: it continues a, so a has no gap to fill and b does.
    const a = rect(10, 10, 20, 10)
    const b = rect(40, 10, 20, 10)
    const moved = rect(15, 10, 30, 10)
    const after = rect(15, 10, 20, 10)
    const rle = [join(a, b), join(a, b), join(a, b), moved, join(after, b), join(after, b)]
    const result = await steadyMaskPass(rle, plan())
    expect(pixelsIn(result.rle[3]!, 45, 10, 15, 10)).toBe(150)
    expect(pixelsIn(result.rle[3]!, 10, 10, 5, 10)).toBe(0)
    expect(result.filledFrames).toBe(1)
  })

  describe("a face moving faster than its boxes overlap", () => {
    it("keeps every region of a face moving further than its own width each frame", async () => {
      // 10 px wide, 12 px a frame: no two boxes in a row share a pixel.
      const WIDE = 200
      const rle = Array.from({ length: 10 }, (_, f) => rect(10 + 12 * f, 40, 10, 10, WIDE))
      const result = await steadyMaskPass(rle, plan({ width: WIDE }))
      expect(result.removedRegions).toBe(0)
      expect(result.filledFrames).toBe(0)
      expect(result.lost).toEqual([])
      expect(result.rle).toEqual(rle)
    })

    it("does not follow it across a gap", async () => {
      // Absent for one frame, then beside where it was: within reach, but a new region, and a pop.
      const beside = rect(22, 10, 10, 10)
      const result = await steadyMaskPass([...repeat(A, 3), "", beside, ""], plan())
      expect(result.removedRegions).toBe(1)
      expect(result.filledFrames).toBe(0)
      expect(result.rle[3]).toBe("")
      expect(result.rle[4]).toBe("")
    })

    it("does not join a new region to a track that already matched this frame", async () => {
      // A's size and within its reach: only that A has already matched this frame keeps it apart.
      const beside = rect(22, 10, 10, 10)
      const result = await steadyMaskPass([...repeat(A, 3), join(A, beside), ...repeat(A, 3)], plan())
      expect(result.removedRegions).toBe(1)
      expect(result.rle[3]).toBe(A)
    })

    it("gives the track to the region that overlaps its reach the most", async () => {
      // Both are within reach of the face's box and near its size. The stray is listed first, and the larger overlap still wins.
      const stray = rect(25, 25, 10, 6)
      const moved = rect(22, 40, 10, 10)
      const face = rect(10, 40, 10, 10)
      const rle = [...repeat(face, 3), join(stray, moved), moved, moved]
      const result = await steadyMaskPass(rle, plan())
      expect(result.removedRegions).toBe(1)
      expect(pixelsIn(result.rle[3]!, 25, 25, 10, 6)).toBe(0)
      expect(pixelsOf(result.rle[3]!)).toBe(100)
    })

    describe("when two tracks can reach one region", () => {
      const left = rect(10, 40, 10, 10)
      const right = rect(50, 40, 10, 10)
      const leftBox = { top: 40, bottom: 49, left: 10, right: 20 }
      const rightBox = { top: 40, bottom: 49, left: 50, right: 60 }
      const run = (region: string) => steadyMaskPass([...repeat(join(left, right), 3), region, ...repeat("", 20)], plan())
      const lastSeen = (lost: readonly { lastBox: { left: number }; startFrame: number }[], x: number) =>
        lost.find((l) => l.lastBox.left === x)?.startFrame

      it("continues the one whose reach it overlaps more", async () => {
        // 3 columns into the left track's reach, 7 into the right's, and on neither box.
        const result = await run(rect(27, 40, 20, 10))
        expect(result.removedRegions).toBe(0)
        expect(result.lost).toHaveLength(2)
        expect(result.lost.find((l) => l.startFrame === 3)!.lastBox).toEqual(leftBox)
        expect(lastSeen(result.lost, 27)).toBe(4)
        expect(result.lost.some((l) => l.lastBox.left === rightBox.left)).toBe(false)
      })

      it("continues the older one on a tie", async () => {
        // 5 columns into each reach.
        const result = await run(rect(25, 40, 20, 10))
        expect(result.lost.find((l) => l.startFrame === 3)!.lastBox).toEqual(rightBox)
        expect(lastSeen(result.lost, 25)).toBe(4)
      })
    })

    describe("the size a moved region may have", () => {
      // The track's box is 100 px². Each region lies within its reach and off its box.
      const face = rect(40, 40, 10, 10)
      const removedFor = async (region: string): Promise<number> =>
        (await steadyMaskPass([face, face, face, region], plan())).removedRegions

      it("takes a region of exactly half the box's area", async () => {
        expect(await removedFor(rect(52, 40, 10, 5))).toBe(0)
      })

      it("takes a region of exactly twice the box's area", async () => {
        expect(await removedFor(rect(52, 40, 20, 10))).toBe(0)
      })

      it("refuses a region just under half", async () => {
        expect(await removedFor(rect(52, 40, 7, 7))).toBe(1)
      })

      it("refuses a region just over twice", async () => {
        expect(await removedFor(rect(52, 10, 3, 67))).toBe(1)
      })
    })

    it("fills the face and removes a speck that appears on the frame it blinks", async () => {
      const face = rect(40, 40, 10, 10)
      const speck = rect(55, 40, 3, 3)
      const result = await steadyMaskPass([...repeat(face, 10), speck, ...repeat(face, 49)], plan())
      expect(result.rle[10]).toBe(face)
      expect(pixelsIn(result.rle[10]!, 55, 40, 3, 3)).toBe(0)
      expect(result.filledFrames).toBe(1)
      expect(result.removedRegions).toBe(1)
      expect(result.lost).toEqual([])
    })

    it("reaches as far as the box's larger side, and no further", async () => {
      // 10 × 4 box: reach 10 px every way. Just inside continues the face; just outside opens a one-frame pop.
      const face = rect(30, 40, 10, 4)
      const inside = rect(49, 40, 10, 4)
      const outside = rect(50, 40, 10, 4)
      const reached = await steadyMaskPass([face, face, face, inside], plan())
      expect(reached.removedRegions).toBe(0)
      const missed = await steadyMaskPass([face, face, face, outside], plan())
      expect(missed.removedRegions).toBe(1)
    })
  })

  it("never fills or follows across a cut", async () => {
    const rle = [...repeat("", 7), ...repeat(A, 3), "", ...repeat(A, 4), ...repeat("", 15)]
    const result = await steadyMaskPass(rle, plan({ cutFrames: [10], detectionFrames: [0, 10] }))
    expect(result.rle[10]).toBe("")
    expect(result.filledFrames).toBe(0)
    expect(result.removedRegions).toBe(0)
    // Only the right side's window: the left side was seen up to the cut.
    expect(result.lost.map((l) => [l.startFrame, l.endFrame])).toEqual([[15, 30]])
  })

  it("judges each side of a cut alone", async () => {
    // Two frames each side: four frames in all, two pops.
    const rle = [...repeat("", 8), A, A, A, A, ...repeat("", 8)]
    const result = await steadyMaskPass(rle, plan({ cutFrames: [10] }))
    expect(result.removedRegions).toBe(4)
    expect(result.rle.every((f) => f === "")).toBe(true)
  })

  it("does not mutate the frames it is given", async () => {
    const rle = [...repeat(A, 3), "", ...repeat(A, 3), B]
    const copy = [...rle]
    await steadyMaskPass(rle, plan())
    expect(rle).toEqual(copy)
  })
})

describe("steadyMaskPass: lost faces", () => {
  const seenUntil = (frame: number, total: number): string[] => [...repeat(A, frame), ...repeat("", total - frame)]

  it("reports a lost face up to the next detection", async () => {
    const result = await steadyMaskPass(seenUntil(30, 60), plan({ detectionFrames: [0, 24, 48] }))
    expect(result.lost).toEqual([
      { startFrame: 30, endFrame: 48, lastBox: { top: 10, bottom: 19, left: 10, right: 20 }, peakPixels: 100 },
    ])
  })

  it("reports a face back after the limit as lost", async () => {
    // The other face keeps the gap from counting as an empty mask.
    const rle = [...repeat(AB, 30), ...repeat(B, 18), ...repeat(AB, 12)]
    const result = await steadyMaskPass(rle, plan({ detectionFrames: [0, 24, 48] }))
    expect(result.lost).toEqual([
      { startFrame: 30, endFrame: 48, lastBox: { top: 10, bottom: 19, left: 10, right: 20 }, peakPixels: 100 },
    ])
  })

  it("does not report a face whose window is within the limit", async () => {
    const result = await steadyMaskPass(seenUntil(44, 60), plan({ detectionFrames: [0, 24, 48] }))
    expect(result.lost).toEqual([])
  })

  it("ends a lost window at a cut or the clip's end", async () => {
    const atCut = await steadyMaskPass(seenUntil(30, 80), plan({ cutFrames: [45], detectionFrames: [0, 45] }))
    expect(atCut.lost.map((l) => [l.startFrame, l.endFrame])).toEqual([[30, 45]])

    const atEnd = await steadyMaskPass(seenUntil(30, 60), plan())
    expect(atEnd.lost.map((l) => [l.startFrame, l.endFrame])).toEqual([[30, 60]])
  })

  it("does not report a face seen right up to a cut", async () => {
    // Its window would start on the cut, and the next shot is another picture.
    const rle = [...repeat(A, 10), ...repeat("", 40)]
    const result = await steadyMaskPass(rle, plan({ cutFrames: [10], detectionFrames: [0, 10, 40] }))
    expect(result.lost).toEqual([])
  })

  it("does not report a face seen right up to a cut that is not a detection", async () => {
    // Only the cut can end this window: the next detection is far on, in the next shot.
    const rle = [...repeat(A, 10), ...repeat("", 40)]
    const result = await steadyMaskPass(rle, plan({ cutFrames: [10], detectionFrames: [0, 40] }))
    expect(result.lost).toEqual([])
  })

  it("ends a window at a cut that is not a detection", async () => {
    const result = await steadyMaskPass(seenUntil(30, 80), plan({ cutFrames: [45], detectionFrames: [0] }))
    expect(result.lost.map((l) => [l.startFrame, l.endFrame])).toEqual([[30, 45]])
  })

  it("does not report a face whose window opens on a detection", async () => {
    // Seen up to frame 23, and the model started afresh on frame 24 without it: it has just looked there.
    const result = await steadyMaskPass(seenUntil(24, 60), plan({ detectionFrames: [0, 24, 48] }))
    expect(result.lost).toEqual([])
  })

  it("does not report a face last seen touching the edge", async () => {
    const edges = [rect(0, 10, 10, 10), rect(10, 0, 10, 10), rect(90, 10, 10, 10), rect(10, 90, 10, 10)]
    for (const edge of edges) {
      const result = await steadyMaskPass([...repeat(edge, 30), ...repeat("", 30)], plan())
      expect(result.lost).toEqual([])
    }
  })

  it("does not report a track shorter than 3 frames", async () => {
    const result = await steadyMaskPass([A, A, ...repeat("", 30)], plan())
    expect(result.removedRegions).toBe(2)
    expect(result.lost).toEqual([])
  })

  it("does not report either face while their regions are merged", async () => {
    const a = rect(10, 10, 15, 20)
    const b = rect(30, 10, 15, 20)
    const merged = rect(10, 10, 35, 20)
    const rle = [
      ...repeat(join(a, b), 10),
      ...repeat(merged, 12),
      ...repeat(join(a, b), 10),
      ...repeat("", 2),
    ]
    const result = await steadyMaskPass(rle, plan())
    expect(result.lost).toEqual([])
    expect(result.filledFrames).toBe(0)
    for (let f = 10; f < 22; f++) expect(pixelsOf(result.rle[f]!)).toBe(35 * 20)
  })

  it("does not paint the absorbed face back after a short merge", async () => {
    // b opens first and a is larger, so the merged region continues a and leaves b absent. Its box holds b's whole
    // box, but its pixels leave out b's top and bottom rows. The piece splitting off then ties between the two
    // tracks: were it to return to b, those rows would be painted into the frames of the merge.
    const a = rect(8, 12, 20, 30)
    const b = rect(30, 10, 15, 20)
    const merged = join(rect(8, 12, 37, 16), rect(8, 28, 20, 14), rect(20, 10, 2, 2))
    const rle = [...repeat(join(a, b), 5), ...repeat(merged, 3), ...repeat(join(a, b), 5)]
    const result = await steadyMaskPass(rle, plan())
    expect(result.filledFrames).toBe(0)
    for (const f of [5, 6, 7]) {
      expect(pixelsIn(result.rle[f]!, 30, 10, 15, 2)).toBe(0)
      expect(pixelsIn(result.rle[f]!, 30, 28, 15, 2)).toBe(0)
    }
  })

  it("reads a region of at least half the absent face's box as a merge, and a smaller one as not", async () => {
    // A goes on frame 5. Its neighbour, overlapping its own last box the most, keeps its own track as it leans onto A's box.
    const lostStarts = async (w: number, h: number): Promise<number[]> => {
      const beside = rect(22, 10, w, h)
      const leaning = rect(19, 10, w, h)
      const rle = [...repeat(join(A, beside), 5), beside, leaning, ...repeat(beside, 30)]
      return (await steadyMaskPass(rle, plan())).lost.map((l) => l.startFrame)
    }
    expect(await lostStarts(5, 10)).toEqual([])
    expect(await lostStarts(7, 7)).toEqual([5])
  })

  it("does not read a region far larger than the absent face as anything but a merge", async () => {
    const huge = rect(5, 5, 40, 40)
    const result = await steadyMaskPass([...repeat(AB, 5), B, join(huge, B), ...repeat(B, 30)], plan())
    expect(result.lost.filter((l) => l.lastBox.left === FACE_A.x)).toEqual([])
  })

  it("reports the largest frame of a face that grew", async () => {
    const big = rect(10, 10, 20, 20)
    const small = rect(12, 12, 5, 5)
    const result = await steadyMaskPass([small, big, small, ...repeat("", 30)], plan())
    expect(result.lost).toHaveLength(1)
    expect(result.lost[0]!.peakPixels).toBe(400)
    expect(result.lost[0]!.lastBox).toEqual({ top: 12, bottom: 16, left: 12, right: 17 })
  })
})

describe("steadyGapLimitFrames", () => {
  it("falls back to the basis rate for an unreadable frame rate", () => {
    expect(steadyGapLimitFrames("bad")).toBe(10)
    expect(steadyGapLimitFrames("24/1")).toBe(8)
    expect(steadyGapLimitFrames("30000/1001")).toBe(10)
    expect(steadyGapLimitFrames("6/1")).toBe(2)
  })

  it("is at least one frame", () => {
    expect(steadyGapLimitFrames("1/1")).toBe(1)
  })
})

describe("encodeMaskRle", () => {
  it("round-trips encodeMaskRle through decodeMaskRle", () => {
    const source = join(rect(0, 0, 3, 2), rect(97, 99, 3, 1), rect(40, 40, 7, 7))
    const encoded = encodeMaskRle(drawn(source), W, H)
    expect(drawn(encoded)).toEqual(drawn(source))
    expect(encodeMaskRle(new Uint8Array(W * H), W, H)).toBe("")
  })

  it("writes the frame's last pixel as a one-based start", () => {
    const frame = new Uint8Array(W * H)
    frame[W * H - 1] = 255
    expect(encodeMaskRle(frame, W, H)).toBe(`${W * H} 1`)
  })
})

describe("steadyMaskPass: nothing to change", () => {
  it("returns the same strings for a clip with nothing to change", async () => {
    const rle = [...repeat(AB, 12), ...repeat("", 2)]
    const result = await steadyMaskPass(rle, plan())
    expect(result.rle).not.toBe(rle)
    for (let f = 0; f < rle.length; f++) expect(result.rle[f]).toBe(rle[f])
    expect(result.filledFrames).toBe(0)
    expect(result.removedRegions).toBe(0)
    expect(result.lost).toEqual([])
  })

  it("keeps the original string when a fill adds no new pixel", async () => {
    // c is absent on frames 3 and 4 and back on 5. Frame 3's region (a's track) already covers c; frame 4's does not.
    const a = rect(10, 10, 30, 10)
    const c = rect(45, 10, 10, 10)
    // Runs out of order: re-encoding this frame would change its string, and that is what must not happen.
    const merged = rect(10, 10, 50, 10).split(" ").reduce<string[][]>((pairs, n, i) => {
      if (i % 2 === 0) pairs.unshift([n])
      else pairs[0]!.push(n)
      return pairs
    }, []).flat().join(" ")
    const rle = [...repeat(join(a, c), 3), merged, a, join(a, c), join(a, c)]
    const result = await steadyMaskPass(rle, plan())
    expect(result.rle[3]).toBe(merged)
    expect(pixelsOf(result.rle[4]!)).toBe(400)
    expect(result.filledFrames).toBe(1)
  })
})

describe("pickLostFaces", () => {
  const lostWith = (peakPixels: number): LostFace => ({
    startFrame: 0, endFrame: 20, lastBox: { top: 0, bottom: 1, left: 0, right: 1 }, peakPixels,
  })

  it("picks at most 3 lost faces, largest first", () => {
    const lost = [10, 50, 30, 40].map(lostWith)
    expect(STEADY_MAX_EXTRA_REQUESTS).toBe(3)
    expect(pickLostFaces(lost).map((l) => l.peakPixels)).toEqual([50, 40, 30])
    expect(lost.map((l) => l.peakPixels)).toEqual([10, 50, 30, 40])
  })

  it("takes a smaller limit when given one", () => {
    expect(pickLostFaces([10, 50, 30].map(lostWith), 1).map((l) => l.peakPixels)).toEqual([50])
  })
})

describe("mergeRecoveredFace", () => {
  const SIZE = { width: W, height: H }
  const GAP = 8
  // Face A was last seen on frame 4; face B is masked on every frame.
  const LOST: LostFace = {
    startFrame: 5, endFrame: 15, lastBox: { top: 10, bottom: 19, left: 10, right: 20 }, peakPixels: 100,
  }
  const STRANGER = rect(80, 80, 10, 10)
  const hasStranger = (rle: string): boolean => pixelsIn(rle, 80, 80, 10, 10) > 0
  const clip = [...repeat(AB, 5), ...repeat(B, 15)]
  // F is the lost face (A's place); N is another face of its size, 8 px away and within F's reach.
  const N = rect(28, 10, 10, 10)
  const noN = (rle: string): boolean => pixelsIn(rle, 28, 10, 10, 10) === 0

  it("adds the followed face and only that face", async () => {
    const answer = repeat(join(A, STRANGER), 10)
    const result = await mergeRecoveredFace(clip, LOST, answer, SIZE, GAP)
    expect(result.found).toBe(true)
    for (let f = 5; f < 15; f++) {
      expect(hasA(result.rle[f]!)).toBe(true)
      expect(hasStranger(result.rle[f]!)).toBe(false)
    }
    // Only the lost window moved.
    for (const f of [0, 1, 2, 3, 4, 15, 16, 17, 18, 19]) expect(result.rle[f]).toBe(clip[f])
  })

  it("reports nothing found when the answer has no region near the face", async () => {
    const result = await mergeRecoveredFace(clip, LOST, repeat(STRANGER, 10), SIZE, GAP)
    expect(result.found).toBe(false)
    expect(result.rle).toEqual(clip)
  })

  it("reports nothing found for an empty answer", async () => {
    expect(await mergeRecoveredFace(clip, LOST, [], SIZE, GAP)).toEqual({ rle: clip, found: false })
    expect(await mergeRecoveredFace(clip, LOST, repeat("", 10), SIZE, GAP)).toEqual({ rle: clip, found: false })
  })

  it("stops following where the face meets an existing region", async () => {
    // The lost track's own face is back in the mask at answer frame 5, on top of what the answer found.
    const back = rect(12, 12, 10, 10)
    const rle = [...repeat(AB, 5), ...repeat(B, 5), ...repeat(join(back, B), 10)]
    const result = await mergeRecoveredFace(rle, LOST, repeat(A, 10), SIZE, GAP)
    expect(result.found).toBe(true)
    for (let i = 0; i < 5; i++) expect(hasA(result.rle[5 + i]!)).toBe(true)
    for (let f = 10; f < 20; f++) expect(result.rle[f]).toBe(rle[f])
  })

  it("does not start when the first frame already holds a region there", async () => {
    const rle = repeat(join(rect(12, 12, 10, 10), B), 20)
    const result = await mergeRecoveredFace(rle, LOST, repeat(A, 10), SIZE, GAP)
    expect(result.found).toBe(false)
    expect(result.rle).toEqual(rle)
  })

  it("does not change regions already in the frame", async () => {
    const result = await mergeRecoveredFace(clip, LOST, repeat(A, 10), SIZE, GAP)
    for (let f = 0; f < clip.length; f++) {
      const before = drawn(clip[f]!)
      const after = drawn(result.rle[f]!)
      for (let p = 0; p < before.length; p++) if (before[p] !== 0) expect(after[p]).not.toBe(0)
      expect(hasB(result.rle[f]!)).toBe(true)
    }
    expect(pixelsOf(result.rle[5]!)).toBe(200)
  })

  it("lets other work run while it merges", async () => {
    // Big frames and a long window: well past one slice of the event loop.
    const big = { width: 1000, height: 1000 }
    const frames = repeat("", 300)
    const face = Array.from({ length: 500 }, (_, r) => `${(r + 100) * 1000 + 101} 500`).join(" ")
    const lost: LostFace = { startFrame: 0, endFrame: 300, lastBox: { top: 100, bottom: 599, left: 100, right: 600 }, peakPixels: 1 }
    let turns = 0
    const ticker = setInterval(() => { turns++ }, 0)
    try {
      const result = await mergeRecoveredFace(frames, lost, repeat(face, 300), big, GAP)
      expect(result.found).toBe(true)
    } finally {
      clearInterval(ticker)
    }
    expect(turns).toBeGreaterThan(0)
  })

  it("leaves the frames it was given alone", async () => {
    const rle = [...clip]
    await mergeRecoveredFace(rle, LOST, repeat(A, 10), SIZE, GAP)
    expect(rle).toEqual(clip)
  })

  describe("a face that blinks in the answer", () => {
    const secondPass = async (rle: readonly string[]) => (await steadyMaskPass(rle, plan())).rle

    it("finds a face one frame late, and the second pass fills the frame before it", async () => {
      const answer = ["", ...repeat(A, 9)]
      const result = await mergeRecoveredFace(clip, LOST, answer, SIZE, GAP)
      expect(result.found).toBe(true)
      expect(result.rle[5]).toBe(clip[5])
      for (let f = 6; f < 15; f++) expect(hasA(result.rle[f]!)).toBe(true)
      const steady = await secondPass(result.rle)
      for (let f = 0; f < 15; f++) expect(hasA(steady[f]!)).toBe(true)
      for (let f = 15; f < 20; f++) expect(hasA(steady[f]!)).toBe(false)
    })

    it("starts as late as the limit, and no later", async () => {
      const atLimit = await mergeRecoveredFace(clip, LOST, [...repeat("", 2), ...repeat(A, 8)], SIZE, 2)
      expect(atLimit.found).toBe(true)
      expect(hasA(atLimit.rle[7]!)).toBe(true)
      const past = await mergeRecoveredFace(clip, LOST, [...repeat("", 3), ...repeat(A, 7)], SIZE, 2)
      expect(past.found).toBe(false)
      expect(past.rle).toEqual(clip)
    })

    it("does not start on a neighbour while it looks for the face", async () => {
      const result = await mergeRecoveredFace(clip, LOST, [N, join(A, N), ...repeat(join(A, N), 8)], SIZE, GAP)
      expect(result.rle[5]).toBe(clip[5])
      for (let f = 6; f < 15; f++) expect(hasA(result.rle[f]!)).toBe(true)
      for (const rle of result.rle) expect(noN(rle)).toBe(true)
    })

    it("recovers all 10 frames through a one-frame blink at the fourth, after the second pass", async () => {
      const answer = [A, A, A, "", ...repeat(A, 6)]
      const result = await mergeRecoveredFace(clip, LOST, answer, SIZE, GAP)
      expect(result.found).toBe(true)
      // Not painted by the merge: only the second pass fills it.
      expect(result.rle[8]).toBe(clip[8])
      const steady = await secondPass(result.rle)
      for (let f = 5; f < 15; f++) expect(hasA(steady[f]!)).toBe(true)
    })

    it("resumes after a blink of exactly the limit", async () => {
      const answer = [A, A, A, "", "", ...repeat(A, 5)]
      const result = await mergeRecoveredFace(clip, LOST, answer, SIZE, 2)
      for (const f of [5, 6, 7, 10, 11, 12, 13, 14]) expect(hasA(result.rle[f]!)).toBe(true)
      for (const f of [8, 9]) expect(result.rle[f]).toBe(clip[f])
    })

    it("stops at a blink longer than the limit, for good", async () => {
      const answer = [A, A, A, "", "", "", ...repeat(A, 4)]
      const result = await mergeRecoveredFace(clip, LOST, answer, SIZE, 2)
      expect(result.found).toBe(true)
      for (const f of [5, 6, 7]) expect(hasA(result.rle[f]!)).toBe(true)
      for (let f = 8; f < 20; f++) expect(result.rle[f]).toBe(clip[f])
    })

    it("counts each blink on its own", async () => {
      const answer = [A, "", "", A, "", "", A, "", "", A]
      const result = await mergeRecoveredFace(clip, LOST, answer, SIZE, 2)
      for (const f of [5, 8, 11, 14]) expect(hasA(result.rle[f]!)).toBe(true)
    })

    it("does not follow a fast move across a blink", async () => {
      // Fast enough for the fallback, and within reach of its last box, but the frame before held no face.
      const answer = [rect(12, 10, 10, 10), "", rect(24, 10, 10, 10), rect(36, 10, 10, 10)]
      const result = await mergeRecoveredFace(clip, LOST, answer, SIZE, GAP)
      expect(pixelsIn(result.rle[5]!, 12, 10, 10, 10)).toBe(100)
      for (let f = 6; f < 15; f++) expect(result.rle[f]).toBe(clip[f])
    })

    it("follows a fast move again once a real overlap has resumed the follow", async () => {
      const answer = [rect(12, 10, 10, 10), "", rect(14, 10, 10, 10), rect(26, 10, 10, 10)]
      const result = await mergeRecoveredFace(clip, LOST, answer, SIZE, GAP)
      expect(pixelsIn(result.rle[7]!, 14, 10, 10, 10)).toBe(100)
      expect(pixelsIn(result.rle[8]!, 26, 10, 10, 10)).toBe(100)
    })

    it("follows a fast move once a late face is found", async () => {
      const answer = ["", rect(12, 10, 10, 10), rect(24, 10, 10, 10)]
      const result = await mergeRecoveredFace(clip, LOST, answer, SIZE, GAP)
      expect(pixelsIn(result.rle[7]!, 24, 10, 10, 10)).toBe(100)
    })

    describe("a blink at 86 and the face gone from 88 to the end of 98 frames, beside another face, at 24 fps", () => {
      const main = Array.from({ length: 98 }, (_, f) => (f === 86 || f >= 88 ? B : AB))
      const chunked = plan({ detectionFrames: [0, 24, 48, 72] })
      const run = async (answer: readonly string[]) => {
        const first = await steadyMaskPass(main, chunked)
        const [face] = first.lost
        const merged = await mergeRecoveredFace(first.rle, face!, answer, SIZE, chunked.gapLimit)
        return { first, merged, second: await steadyMaskPass(merged.rle, chunked) }
      }

      it("fills the blink, and looks at the frames from 88 to the clip's end", async () => {
        const { first } = await run(repeat("", 10))
        expect(hasA(first.rle[86]!)).toBe(true)
        expect(first.filledFrames).toBe(1)
        expect(first.lost.map((l) => [l.startFrame, l.endFrame])).toEqual([[88, 98]])
      })

      it("covers the face to the end when the look holds it", async () => {
        const { merged, second } = await run(repeat(A, 10))
        expect(merged.found).toBe(true)
        expect(second.rle.every(hasA)).toBe(true)
        expect(second.rle.every(hasB)).toBe(true)
        expect(second.filledFrames).toBe(0)
      })

      it("fills what the look misses when it blinks too", async () => {
        const { second } = await run(["", A, A, A, "", A, A, A, A, A])
        expect(second.rle.every(hasA)).toBe(true)
        expect(second.filledFrames).toBe(2)
      })

      it("leaves the frames from 88 uncovered when the look holds nothing", async () => {
        const { merged, second } = await run(repeat("", 10))
        expect(merged.found).toBe(false)
        for (let f = 88; f < 98; f++) expect(hasA(second.rle[f]!)).toBe(false)
      })
    })

    it("still stops for good where the face meets an existing region, not as a blink", async () => {
      const back = rect(12, 12, 10, 10)
      const rle = [...repeat(AB, 5), join(back, B), ...repeat(B, 14)]
      const result = await mergeRecoveredFace(rle, LOST, repeat(A, 10), SIZE, GAP)
      expect(result.found).toBe(false)
      expect(result.rle).toEqual(rle)
    })

    it("still reports nothing found when the face was never there", async () => {
      const result = await mergeRecoveredFace(clip, LOST, repeat("", 10), SIZE, GAP)
      expect(result.found).toBe(false)
      expect(result.rle).toEqual(clip)
    })
  })

  it("follows the region across frames as it moves, leaving another that arrives at the old place", async () => {
    const answer = [0, 1, 2, 3].map((i) => {
      const moving = rect(10 + i * 5, 10, 10, 10)
      return i === 3 ? join(moving, rect(10, 10, 3, 3)) : moving
    })
    const result = await mergeRecoveredFace(clip, LOST, answer, SIZE, GAP)
    expect(pixelsIn(result.rle[8]!, 25, 10, 10, 10)).toBe(100)
    expect(pixelsIn(result.rle[8]!, 10, 10, 3, 3)).toBe(0)
  })

  it("adds every piece of a face returned in pieces", async () => {
    const small = rect(10, 10, 10, 4) // 40 px
    const large = rect(10, 15, 10, 5) // 50 px
    const answer = [join(small, large), join(small, large), join(small, large), large]
    const result = await mergeRecoveredFace(clip, LOST, answer, SIZE, GAP)
    for (const f of [5, 6, 7]) {
      expect(pixelsIn(result.rle[f]!, 10, 10, 10, 4)).toBe(40)
      expect(pixelsIn(result.rle[f]!, 10, 15, 10, 5)).toBe(50)
    }
    expect(pixelsIn(result.rle[8]!, 10, 15, 10, 5)).toBe(50)
    expect(pixelsIn(result.rle[8]!, 10, 10, 10, 4)).toBe(0)
  })

  it("stops where the union of a face's pieces meets an existing region", async () => {
    // The existing region lies in the corner the two pieces leave empty: it touches their union, and neither piece.
    const rle = [...repeat(AB, 5), ...repeat(join(rect(16, 10, 4, 4), B), 15)]
    const answer = repeat(join(rect(10, 10, 5, 4), rect(16, 15, 4, 5)), 10)
    const result = await mergeRecoveredFace(rle, LOST, answer, SIZE, GAP)
    expect(result.found).toBe(false)
    expect(result.rle).toEqual(rle)
  })

  it("never adds past the lost window, however long the answer", async () => {
    const answer = repeat(A, 15)
    const result = await mergeRecoveredFace(clip, LOST, answer, SIZE, GAP)
    for (let f = 5; f < 15; f++) expect(hasA(result.rle[f]!)).toBe(true)
    for (let f = 15; f < 20; f++) expect(result.rle[f]).toBe(clip[f])
    // Nor past the clip, on a window that runs to its end.
    const atEnd = await mergeRecoveredFace(clip.slice(0, 7), LOST, answer, SIZE, GAP)
    expect(atEnd.rle).toHaveLength(7)
    for (const f of [5, 6]) expect(hasA(atEnd.rle[f]!)).toBe(true)
  })

  it("does not move onto a neighbour when the face blinks, and resumes on the face", async () => {
    const answer = [join(A, N), join(A, N), join(A, N), N, join(A, N), join(A, N)]
    const result = await mergeRecoveredFace(clip, LOST, answer, SIZE, GAP)
    expect(result.found).toBe(true)
    for (const f of [5, 6, 7, 9, 10]) expect(hasA(result.rle[f]!)).toBe(true)
    expect(result.rle[8]).toBe(clip[8])
    for (let f = 11; f < 20; f++) expect(result.rle[f]).toBe(clip[f])
    for (const rle of result.rle) expect(noN(rle)).toBe(true)
  })

  it("does not move onto a neighbour for a blink longer than the limit either", async () => {
    const result = await mergeRecoveredFace(clip, LOST, [join(A, N), N, N, N, N], SIZE, 2)
    expect(hasA(result.rle[5]!)).toBe(true)
    for (let f = 6; f < 20; f++) expect(result.rle[f]).toBe(clip[f])
    for (const rle of result.rle) expect(noN(rle)).toBe(true)
  })

  it("does not paint a neighbour when the face was never in the answer", async () => {
    const result = await mergeRecoveredFace(clip, LOST, repeat(N, 10), SIZE, GAP)
    expect(result.found).toBe(false)
    expect(result.rle).toEqual(clip)
  })

  it("needs real overlap on the first frame, even for a face moving fast", async () => {
    const answer = [0, 1, 2].map((i) => rect(22 + i * 12, 10, 10, 10))
    const result = await mergeRecoveredFace(clip, LOST, answer, SIZE, GAP)
    expect(result.found).toBe(false)
    expect(result.rle).toEqual(clip)
  })

  it("follows a fast-moving face alone in the answer after the first frame", async () => {
    const xs = [12, 24, 36, 48]
    const answer = xs.map((x) => rect(x, 10, 10, 10))
    const result = await mergeRecoveredFace(clip, LOST, answer, SIZE, GAP)
    expect(result.found).toBe(true)
    xs.forEach((x, i) => expect(pixelsIn(result.rle[5 + i]!, x, 10, 10, 10)).toBe(100))
  })

  it("follows a fast-moving face past a region elsewhere in the picture", async () => {
    const xs = [12, 24, 36]
    const answer = xs.map((x) => join(rect(x, 10, 10, 10), rect(80, 80, 10, 10)))
    const result = await mergeRecoveredFace(clip, LOST, answer, SIZE, GAP)
    xs.forEach((x, i) => expect(pixelsIn(result.rle[5 + i]!, x, 10, 10, 10)).toBe(100))
    for (const rle of result.rle) expect(hasStranger(rle)).toBe(false)
  })

  it("does not move onto a region that continues another on the frame before", async () => {
    // F jumps away on frame 1, out of its own reach; N, in reach, was already there on frame 0.
    const answer = [join(A, N), N, N]
    const result = await mergeRecoveredFace(clip, LOST, answer, SIZE, GAP)
    expect(hasA(result.rle[5]!)).toBe(true)
    expect(result.rle[6]).toBe(clip[6])
    for (const rle of result.rle) expect(noN(rle)).toBe(true)
  })

  it("does not take a nearby region of another size for the face", async () => {
    const result = await mergeRecoveredFace(clip, LOST, repeat(rect(24, 10, 3, 3), 10), SIZE, GAP)
    expect(result.found).toBe(false)
    expect(result.rle).toEqual(clip)
  })
})
