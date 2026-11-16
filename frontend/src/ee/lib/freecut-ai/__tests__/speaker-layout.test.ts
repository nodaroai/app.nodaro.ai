// @vitest-environment node
import { describe, expect, it } from "vitest"
import { followPath, mainFaces } from "../crop-path"
import { facesOf, layoutSlots, peopleTracks, slotPlacement, speakersHeard, unlayOps } from "../speaker-layout"

type Box = { ms: number; x: number; y: number; w: number; h: number; score: number }
const boxes = (fromMs: number, toMs: number, cx: number, cy: number, w: number, h: number): Box[] =>
  Array.from({ length: Math.floor((toMs - fromMs) / 500) }, (_, i) => ({ ms: fromMs + i * 500, x: cx - w / 2 + 0.004 * Math.sin(i), y: cy - h / 2, w, h, score: 0.92 }))

/**
 * What a real recording's face tracks look like (one presenter, an edited
 * video): the presenter is lost and found again at every cut, so they are many
 * tracks in one place; other shots show small faces for a few seconds each.
 */
const ONE_PRESENTER = {
  sources: [
    {
      tracks: [
        { boxes: boxes(0, 60_000, 0.43, 0.36, 0.15, 0.35) },
        { boxes: boxes(62_000, 140_000, 0.44, 0.36, 0.15, 0.35) },
        { boxes: boxes(150_000, 260_000, 0.42, 0.37, 0.15, 0.36) },
        { boxes: boxes(270_000, 300_000, 0.43, 0.36, 0.14, 0.35) },
        // Another shot: two small faces on a screen, for twenty seconds.
        { boxes: boxes(140_000, 150_000, 0.86, 0.22, 0.04, 0.1) },
        { boxes: boxes(140_000, 150_000, 0.14, 0.25, 0.05, 0.13) },
      ],
    },
  ],
}

const TWO_PEOPLE = {
  sources: [{ tracks: [{ boxes: boxes(0, 120_000, 0.27, 0.36, 0.14, 0.24) }, { boxes: boxes(120_500, 300_000, 0.27, 0.36, 0.14, 0.24) }, { boxes: boxes(0, 300_000, 0.73, 0.36, 0.14, 0.24) }] }],
}

describe("the people in the picture", () => {
  it("one presenter found again at every cut is one person, and faces seen for a moment are nobody", () => {
    const people = facesOf(ONE_PRESENTER)
    expect(people).toHaveLength(1)
    expect(people[0]!.cx).toBeCloseTo(0.43, 1)
  })

  it("two people side by side are two, left to right, however many tracks each is", () => {
    const people = facesOf(TWO_PEOPLE)
    expect(people.map((p) => Math.round(p.cx * 100) / 100)).toEqual([0.27, 0.73])
  })

  it("never shows more people than voices were heard", () => {
    expect(facesOf(TWO_PEOPLE, 1)).toHaveLength(1)
    expect(facesOf(TWO_PEOPLE, 2)).toHaveLength(2)
  })

  it("the crop that follows the face follows the presenter only, never a face from another shot", () => {
    const path = followPath(mainFaces(peopleTracks(ONE_PRESENTER) as never))
    expect(Math.min(...path.map((p) => p.cx))).toBeGreaterThan(0.38)
    expect(Math.max(...path.map((p) => p.cx))).toBeLessThan(0.5)
    expect(path.some((p) => p.cut)).toBe(false)
  })

  it("counts a voice only when it talks for a real share of the video", () => {
    const w = (speaker: string, start: number, end: number) => ({ start, end, speaker })
    expect(speakersHeard([w("A", 0, 50), w("B", 50, 100), w("C", 100, 101)])).toEqual(["A", "B"])
    expect(speakersHeard([{ start: 0, end: 5 }])).toEqual([])
  })
})

describe("a speaker layout", () => {
  const phone = { width: 1080, height: 1920 }
  const source = { width: 1920, height: 1080 }

  it("gives each speaker a part: rows, columns, a grid, or one large with the others small", () => {
    expect(layoutSlots("stacked", 2, phone)).toEqual([{ x: 0, y: 0, w: 1080, h: 960 }, { x: 0, y: 960, w: 1080, h: 960 }])
    expect(layoutSlots("side", 2, source)).toEqual([{ x: 0, y: 0, w: 960, h: 1080 }, { x: 960, y: 0, w: 960, h: 1080 }])
    expect(layoutSlots("grid", 4, phone).map((s) => [s.x, s.y])).toEqual([[0, 0], [540, 0], [0, 960], [540, 960]])
    const pip = layoutSlots("pip", 2, phone)
    expect(pip[0]).toEqual({ x: 0, y: 0, w: 1080, h: 1920 })
    expect(pip[1]!.w).toBeLessThan(400)
  })

  it("places a region so it covers its part exactly", () => {
    const slot = { x: 0, y: 960, w: 1080, h: 960 }
    const region = { x: 0.5, y: 0.1, w: 0.45, h: 0.711 }
    const { crop, transform } = slotPlacement(region, slot, source, phone)
    expect(crop.left).toBeCloseTo(0.5)
    expect(crop.right).toBeCloseTo(0.05)
    // The region's center lands on the part's center (480 px below the canvas center).
    const regionCenterX = transform.x + (region.x + region.w / 2 - 0.5) * transform.width
    const regionCenterY = transform.y + (region.y + region.h / 2 - 0.5) * transform.height
    expect(Math.abs(regionCenterX - 0)).toBeLessThan(2)
    expect(Math.abs(regionCenterY - 480)).toBeLessThan(2)
    expect(region.w * transform.width).toBeGreaterThanOrEqual(slot.w - 1)
  })
})

describe("an earlier layout left on the timeline", () => {
  const item = (id: string, trackId: string, from: number) => ({ id, type: "video", trackId, from, durationInFrames: 100, mediaId: "m" })
  const tracks = [{ id: "copy2", order: -2 }, { id: "copy1", order: -1 }, { id: "footage", order: 0 }]

  it("is taken off: the copies go, the footage is whole again", () => {
    const ops = unlayOps({ tracks, items: [item("a", "footage", 0), item("b", "footage", 100), item("a1", "copy1", 0), item("b1", "copy1", 100), item("a2", "copy2", 0), item("b2", "copy2", 100)] }, "m")
    expect(ops[0]).toEqual({ op: "removeItems", ids: ["a1", "a2", "b1", "b2"] })
    expect(ops.filter((o) => o.op === "updateItem")).toEqual(["a", "b"].map((id) => ({ op: "updateItem", id, updates: { crop: { left: 0, right: 0, top: 0, bottom: 0 } } })))
  })

  it("leaves the footage sharp and under its file's name again", () => {
    const ops = unlayOps({ tracks, media: [{ id: "m", fileName: "take.mp4" }], items: [item("a", "footage", 0), item("a1", "copy1", 0)] }, "m")
    expect(ops[1]).toEqual({ op: "blurItems", ids: ["a"], radius: 0 })
    expect(ops.find((o) => o.op === "updateItem")).toEqual({ op: "updateItem", id: "a", updates: { crop: { left: 0, right: 0, top: 0, bottom: 0 }, label: "take.mp4" } })
  })

  it("touches nothing when the video is on the timeline once", () => {
    expect(unlayOps({ tracks, items: [item("a", "footage", 0), item("b", "footage", 100)] }, "m")).toEqual([])
  })
})
