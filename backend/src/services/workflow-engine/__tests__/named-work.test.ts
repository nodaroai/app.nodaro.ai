import { describe, expect, it } from "vitest"
import { isFrozenLottieOverride, namedWorkNodeIds } from "../named-work.js"

const LOTTIE = { planType: "lottie-graphic" }

const graph = () => [
  { id: "wh", type: "webhook-trigger", data: {} },
  { id: "tg", type: "telegram-trigger", data: {} },
  { id: "up", type: "upload-image", data: { imageUrl: "https://r2/a.png" } },
  { id: "md", type: "mood", data: { mood: "calm" } },
  { id: "grp", type: "group", data: {} },
  { id: "img", type: "generate-image", data: { prompt: "a cat" } },
  { id: "old", type: "image-to-image", data: {} },
  { id: "frz", type: "generate-image", data: { skipped: true } },
  { id: "mg", type: "motion-graphics", data: { motionPlan: LOTTIE } },
]

describe("namedWorkNodeIds", () => {
  it("keeps only the named nodes the engine executes, in the order sent, once", () => {
    expect(namedWorkNodeIds(graph(), ["img", "wh", "tg", "up", "md", "grp", "old", "img", "gone"], undefined)).toEqual(["img", "old"])
  })

  it("leaves out a node frozen on the saved graph, and one the run's overrides freeze", () => {
    expect(namedWorkNodeIds(graph(), ["frz", "img"], undefined)).toEqual(["img"])
    expect(namedWorkNodeIds(graph(), ["frz", "img"], { img: { skipped: true } })).toEqual([])
    // An override can thaw one too: the merged graph decides.
    expect(namedWorkNodeIds(graph(), ["frz"], { frz: { skipped: false } })).toEqual(["frz"])
  })

  it("leaves out a lottie node frozen by its motionPlan override, never one without that override", () => {
    expect(namedWorkNodeIds(graph(), ["mg"], undefined)).toEqual(["mg"])
    expect(namedWorkNodeIds(graph(), ["mg"], { mg: { motionPlan: { ...LOTTIE, slotValues: {} } } })).toEqual([])
  })

  it("names nothing when nothing is sent", () => {
    expect(namedWorkNodeIds(graph(), [], { img: { skipped: true } })).toEqual([])
  })
})

describe("isFrozenLottieOverride", () => {
  it("needs a motion-graphics node, a lottie plan and a motionPlan key in its override", () => {
    const mg = { id: "mg", type: "motion-graphics", data: { motionPlan: LOTTIE } }
    expect(isFrozenLottieOverride(mg, { mg: { motionPlan: LOTTIE } })).toBe(true)
    expect(isFrozenLottieOverride(mg, { mg: { other: 1 } })).toBe(false)
    expect(isFrozenLottieOverride(mg, undefined)).toBe(false)
    expect(isFrozenLottieOverride({ ...mg, data: { motionPlan: { planType: "remotion" } } }, { mg: { motionPlan: {} } })).toBe(false)
    expect(isFrozenLottieOverride({ ...mg, type: "generate-image" }, { mg: { motionPlan: LOTTIE } })).toBe(false)
  })
})
