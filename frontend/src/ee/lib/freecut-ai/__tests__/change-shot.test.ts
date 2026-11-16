// @vitest-environment node
import { describe, expect, it } from "vitest"
import { peopleInRow, planShotChange } from "../change-shot"

const face = (fromMs: number, toMs: number, cx: number, h: number) => ({
  boxes: Array.from({ length: Math.floor((toMs - fromMs) / 500) }, (_, i) => ({ ms: fromMs + i * 500, x: cx - h * 0.2, y: 0.3 - h / 2, w: h * 0.4, h, score: 0.9 })),
})
// 0-10 s: two people side by side. 10-20 s: one person, far.
const SET = { sampleFps: 2, sources: [{ cuts: [10_000], tracks: [face(0, 10_000, 0.3, 0.15), face(0, 10_000, 0.71, 0.16), face(10_000, 20_000, 0.5, 0.08)] }] }

const tracks = [
  { id: "v1", order: 2 },
  { id: "v2", order: 1 },
]
const clip = (id: string, trackId: string, from: number, sourceStart: number, width = 2880) => ({ id, type: "video", trackId, from, durationInFrames: 300, mediaId: "take", sourceStart, sourceFps: 30, transform: { x: 0, y: 0, width, height: 1620 } })
// Laid out by the panel: two parts, then the whole picture over its backdrop.
const view = {
  fps: 30,
  durationInFrames: 600,
  width: 1080,
  height: 1920,
  tracks,
  media: [{ id: "take", fileName: "take.mp4", width: 1920, height: 1080 }],
  items: [clip("a", "v1", 0, 0), clip("a2", "v2", 0, 0), clip("b", "v1", 300, 300), clip("b2", "v2", 300, 300, 1080)],
}
const two = { kind: "two" as const, from: 0, to: 300 }
const far = { kind: "whole" as const, from: 300, to: 600 }

describe("a stretch of the layout shown another way", () => {
  it("knows how many people can be told apart in a stretch", () => {
    expect([peopleInRow(view, two, SET), peopleInRow(view, far, SET)]).toEqual([2, 1])
  })

  it("two parts become one person: the copy goes, the footage is cropped to the person chosen", () => {
    const plan = planShotChange(view, two, { as: "close", first: 1 }, SET, "stacked", (f) => f.kind)!
    expect(plan.copy).toEqual([])
    const ops = plan.place(new Map())
    expect(ops[0]).toEqual({ op: "removeItems", ids: ["a2"] })
    const crop = (ops.find((o) => o.op === "updateItem") as unknown as { id: string; updates: { crop: { left: number; right: number }; label: string } })!
    expect([crop.id, crop.updates.label]).toEqual(["a", "close"])
    // The person on the right: more is cut from the left than from the right.
    expect(crop.updates.crop.left).toBeGreaterThan(crop.updates.crop.right)
    expect(ops.at(-1)).toEqual({ op: "blurItems", ids: ["a"], radius: 0 })
  })

  it("the same people the other way round: nothing is copied or dropped, the person on the right goes above the seam", () => {
    const plan = planShotChange(view, two, { as: "two", first: 1 }, SET, "stacked")!
    expect(plan.copy).toEqual([])
    const ops = plan.place(new Map())
    expect(ops.some((o) => o.op === "removeItems")).toBe(false)
    const crops = ops.filter((o) => o.op === "updateItem") as unknown as Array<{ id: string; updates: { crop: { left: number } } }>
    expect(crops.map((c) => c.id)).toEqual(["a", "a2"])
    expect(crops[0]!.updates.crop.left).toBeGreaterThan(crops[1]!.updates.crop.left)
  })

  it("one person becomes the whole picture: the footage is copied once, blurred behind, and the copy is the picture", () => {
    const close = { ...view, items: [clip("a", "v1", 0, 0), clip("a2", "v2", 0, 0), clip("b", "v1", 300, 300)] }
    const plan = planShotChange(close, { kind: "close", from: 300, to: 600 }, { as: "whole", first: 0 }, SET, "stacked")!
    expect(plan.copy).toEqual([["b"]])
    const ops = plan.place(new Map([["b", ["b-new"]]]))
    expect((ops.filter((o) => o.op === "setTransform") as unknown as Array<{ id: string }>).map((o) => o.id)).toEqual(["b", "b-new"])
    expect(ops.at(-1)).toEqual({ op: "blurItems", ids: ["b"], radius: 40 })
  })

  it("leaves a stretch as it is when it has too few people for the parts asked for", () => {
    expect(planShotChange(view, far, { as: "two", first: 0 }, SET, "stacked")).toBeNull()
  })
})
