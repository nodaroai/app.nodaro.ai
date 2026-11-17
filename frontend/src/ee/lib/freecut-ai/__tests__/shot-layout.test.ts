import { describe, expect, it } from "vitest"
import { framingOfPiece, regionFor, shotFramings, shotLayoutOps, shotsOf, splitFramesOf } from "../shot-layout"

type Box = { ms: number; x: number; y: number; w: number; h: number; score: number }
const face = (fromMs: number, toMs: number, cx: number, cy: number, h: number): { boxes: Box[] } => ({
  boxes: Array.from({ length: Math.floor((toMs - fromMs) / 500) }, (_, i) => ({ ms: fromMs + i * 500, x: cx - h * 0.2, y: cy - h / 2, w: h * 0.4, h, score: 0.9 })),
})

/**
 * A panel on a stage, as real face tracks show one: the picture changes shot
 * every few seconds between two people side by side, one guest alone, a wide
 * shot of four small faces, and two people with a third in a window.
 */
const PANEL = {
  sampleFps: 2,
  sources: [
    {
      cuts: [10_000, 20_000, 30_000, 30_800, 40_000],
      tracks: [
        // 0-10 s: two people side by side.
        face(0, 10_000, 0.3, 0.26, 0.15),
        face(0, 10_000, 0.71, 0.23, 0.16),
        // 10-20 s: one guest alone, close.
        face(10_000, 20_000, 0.5, 0.4, 0.34),
        // 20-30 s: the stage from far: four small faces.
        ...[0.34, 0.44, 0.65, 0.79].map((cx) => face(20_000, 30_000, cx, 0.24, 0.05)),
        // 30-30.8 s: a flash of one face. 30.8-40 s: two on stage and a guest in a window.
        face(30_000, 30_800, 0.5, 0.3, 0.2),
        face(30_800, 40_000, 0.18, 0.33, 0.1),
        face(30_800, 40_000, 0.48, 0.31, 0.11),
        face(30_800, 40_000, 0.82, 0.58, 0.34),
        // 40-50 s: the same two as the start, one of them lost and found again.
        face(40_000, 44_000, 0.3, 0.26, 0.15),
        face(45_000, 50_000, 0.31, 0.26, 0.15),
        face(40_000, 50_000, 0.71, 0.23, 0.16),
      ],
    },
  ],
}

const phone = { width: 1080, height: 1920 }
const source = { width: 1920, height: 1080 }

describe("the people in each shot", () => {
  const shots = shotsOf(PANEL)

  it("are counted shot by shot, at the cuts the tracks report", () => {
    expect(shots.map((s) => [s.fromMs, s.people.length])).toEqual([
      [0, 2],
      [10_000, 1],
      [20_000, 4],
      // Seen once only: nobody.
      [30_000, 0],
      [30_800, 3],
      [40_000, 2],
    ])
  })

  it("a person lost and found again inside a shot is one person", () => {
    expect(shots[5]!.people.map((p) => Math.round(p.cx * 10) / 10)).toEqual([0.3, 0.7])
  })

  it("a small face behind a large one is in the background", () => {
    const set = { sources: [{ cuts: [], tracks: [face(0, 10_000, 0.5, 0.4, 0.34), face(0, 10_000, 0.9, 0.2, 0.04)] }] }
    expect(shotsOf(set)[0]!.people).toHaveLength(1)
  })
})

describe("how each shot is shown", () => {
  const framings = shotFramings(shotsOf(PANEL), "stacked", phone, source)

  it("two people get a part each, one person seen close fills the frame, a crowd of small faces is shown whole", () => {
    expect(framings.map((f) => [f.fromMs, f.toMs, f.kind, f.slots.length])).toEqual([
      [0, 10_000, "parts", 2],
      [10_000, 20_000, "close", 1],
      // The whole picture over its blurred copy: two layers.
      [20_000, 30_800, "whole", 2],
      [30_800, 40_000, "parts", 3],
      [40_000, 50_000, "parts", 2],
    ])
  })

  it("the parts of a phone frame meet on one seam: the first person above it, the others below", () => {
    const [top, bottom] = framings[0]!.slots
    expect([top!.y, top!.h, bottom!.y, bottom!.h]).toEqual([0, 1152, 1152, 768])
    const three = framings[3]!.slots
    expect(three.map((r) => [r.x, r.y, r.w])).toEqual([
      [0, 0, 1080],
      [0, 1152, 540],
      [540, 1152, 540],
    ])
  })

  it("a shot shown whole is the picture at the frame's width, ending just above the seam, over a backdrop that fills the frame", () => {
    const whole = framings[2]!
    expect(whole.backdrop).toBe(true)
    expect(whole.slots[0]).toEqual({ x: 0, y: 0, w: 1080, h: 1920 })
    // 1080 wide of a 16:9 picture is 608 tall (rounded), ending at 55% of the frame.
    expect(whole.slots[1]).toEqual({ x: 0, y: 1056 - 608, w: 1080, h: 608 })
    expect(whole.regions[1]).toEqual({ x: 0, y: 0, w: 1, h: 1 })
  })

  it("one person seen from far is shown whole, not enlarged into a strip", () => {
    const set = { sources: [{ cuts: [], tracks: [face(0, 10_000, 0.55, 0.3, 0.084)] }] }
    expect(shotFramings(shotsOf(set), "stacked", phone, source)[0]!.kind).toBe("whole")
  })

  it("a frame as wide as the picture shows a whole shot as it is, with no backdrop", () => {
    const wide = shotFramings(shotsOf(PANEL), "side", source, source)[2]!
    expect([wide.kind, wide.slots.length, wide.backdrop]).toEqual(["whole", 1, undefined])
  })

  it("a shot too short to read keeps the framing of the shot before it", () => {
    // The 0.8 s flash at 30 s is part of the framing that started at 20 s.
    expect(framings.some((f) => f.fromMs === 30_000)).toBe(false)
  })

  it("each part holds its own person: the slot's shape, inside the picture, the neighbour left out", () => {
    const [left, right] = framings[0]!.regions
    for (const [i, r] of [left!, right!].entries()) {
      expect(r.x).toBeGreaterThanOrEqual(0)
      expect(r.x + r.w).toBeLessThanOrEqual(1.0001)
      expect(r.y + r.h).toBeLessThanOrEqual(1.0001)
      const slot = framings[0]!.slots[i]!
      expect((r.w * source.width) / (r.h * source.height)).toBeCloseTo(slot.w / slot.h, 2)
    }
    expect(left!.x + left!.w).toBeLessThan(0.6)
    expect(right!.x).toBeGreaterThan(0.4)
  })

  it("a part is never enlarged past what the picture can take, and a person alone on a phone keeps the frame's full height", () => {
    // The part above the seam (1152 px) from a 1080 px picture: at least 1152 / 1.5 px of it.
    expect(framings[0]!.regions[0]!.h).toBeGreaterThanOrEqual(1152 / 1.5 / 1080 - 0.001)
    expect(framings[1]!.regions[0]!.h).toBe(1)
    expect(framings[1]!.regions[0]!.x + framings[1]!.regions[0]!.w / 2).toBeCloseTo(0.5, 1)
  })

  it("puts the eyes a third from the top of a region that is not the whole height", () => {
    const person = { cx: 0.5, cy: 0.5, w: 0.08, h: 0.2 }
    const r = regionFor(person, { x: 0, y: 0, w: 1080, h: 960 }, source, false)
    expect((person.cy - person.h * 0.1 - r.y) / r.h).toBeCloseTo(1 / 3, 2)
  })

  it("people sitting close together are shown together, not in parts", () => {
    const set = { sources: [{ cuts: [], tracks: [face(0, 10_000, 0.45, 0.3, 0.12), face(0, 10_000, 0.55, 0.3, 0.12)] }] }
    expect(shotFramings(shotsOf(set), "stacked", phone, source)[0]!.kind).toBe("whole")
  })
})

describe("the shots on the timeline", () => {
  const framings = shotFramings(shotsOf(PANEL), "stacked", phone, source)
  // The source is 23.976 fps on a 30 fps timeline, and its first 5 seconds were cut off.
  const sourceFps = 24000 / 1001
  const piece = { id: "a", from: 0, durationInFrames: 45 * 30, sourceStart: Math.round(5 * sourceFps), sourceEnd: Math.round(50 * sourceFps), sourceFps }

  it("the video is split where the framing changes, in timeline frames, whatever the source's frame rate", () => {
    // Framings change at 10, 20, 30.8 and 40 s of the source: 5, 15, 25.8 and 35 s of the timeline.
    expect(splitFramesOf([piece], framings, 30)).toEqual([150, 450, 774, 1050])
  })

  it("each piece takes the framing of the shot it shows", () => {
    const second = { ...piece, id: "b", from: 150, durationInFrames: 300, sourceStart: Math.round(10 * sourceFps) }
    expect(framingOfPiece(second, framings, 30)?.fromMs).toBe(10_000)
  })

  it("a piece is cropped to its shot's first part, and its copies fill the parts after", () => {
    const first = { ...piece, durationInFrames: 150 }
    const ops = shotLayoutOps(phone, source, [first], framings, 30, new Map([["a", ["a-copy"]]]))
    expect(ops[0]).toEqual({ op: "setCanvas", width: 1080, height: 1920 })
    const placed = ops.filter((o) => o.op === "setTransform") as unknown as Array<{ id: string; transform: { y: number } }>
    expect(placed.map((o) => o.id)).toEqual(["a", "a-copy"])
    // The first part is the top half, the copy the bottom half.
    expect(placed[0]!.transform.y).toBeLessThan(placed[1]!.transform.y)
    expect(ops.filter((o) => o.op === "updateItem")).toHaveLength(2)
  })

  it("a shot with one part needs no copy", () => {
    const alone = { ...piece, id: "b", from: 150, durationInFrames: 300, sourceStart: Math.round(10 * sourceFps) }
    const ops = shotLayoutOps(phone, source, [alone], framings, 30, new Map())
    expect(ops.filter((o) => o.op === "setTransform")).toHaveLength(1)
    expect(ops.some((o) => o.op === "blurItems")).toBe(false)
  })

  it("a shot shown whole blurs the clip behind and leaves its copy sharp, and each clip is named for its framing", () => {
    const far = { ...piece, id: "c", from: 450, durationInFrames: 300, sourceStart: Math.round(20 * sourceFps) }
    const ops = shotLayoutOps(phone, source, [far], framings, 30, new Map([["c", ["c-copy"]]]), (f) => f.kind)
    expect(ops.filter((o) => o.op === "blurItems")).toEqual([{ op: "blurItems", ids: ["c"], radius: 40 }])
    const named = ops.filter((o) => o.op === "updateItem") as unknown as Array<{ updates: { label: string } }>
    expect(named.map((o) => o.updates.label)).toEqual(["whole", "whole"])
  })
})
