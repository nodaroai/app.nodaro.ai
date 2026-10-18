import { describe, it, expect } from "vitest"
import { placeFramesAfterReferences } from "../frame-reference-slots.js"

const R = (n: number) => Array.from({ length: n }, (_, i) => `r${i + 1}`)

describe("placeFramesAfterReferences", () => {
  it("puts the caller's references first and the frames after them, bound by seat", () => {
    const r = placeFramesAfterReferences({ firstFrameUrl: "F", lastFrameUrl: "L", refImageUrls: R(2), imageCap: 9 })
    expect(r.imageUrls).toEqual(["r1", "r2", "F", "L"])
    expect(r.firstFrameOrdinal).toBe(3)
    expect(r.lastFrameOrdinal).toBe(4)
    expect(r.promptSuffix).toBe("Use @image_3 as the opening (first) frame and @image_4 as the closing (last) frame of the video.")
    expect(r.droppedRefImages).toBe(0)
  })

  it("keeps the frames at the cap and drops trailing caller references", () => {
    const r = placeFramesAfterReferences({ firstFrameUrl: "F", lastFrameUrl: "L", refImageUrls: R(3), imageCap: 3 })
    expect(r.imageUrls).toEqual(["r1", "F", "L"])
    expect(r.droppedRefImages).toBe(2)
  })

  it("writes the binding in the provider's own syntax", () => {
    const grok = placeFramesAfterReferences({ firstFrameUrl: "F", refImageUrls: R(2), imageCap: 7, syntax: "@image(n)", bindIdentities: true })
    expect(grok.promptSuffix).toBe(
      "Use @image(3) as the opening (first) frame of the video. @image(1) through @image(2) are identity references for this shot's subjects — match each subject's exact appearance; they are not frames.",
    )
    const hh = placeFramesAfterReferences({ firstFrameUrl: "F", refImageUrls: R(1), imageCap: 9, syntax: "[Image N]", bindIdentities: true })
    expect(hh.promptSuffix).toBe(
      "Use [Image 2] as the opening (first) frame of the video. [Image 1] is an identity reference for this shot's subjects — match its subject's exact appearance; it is not a frame.",
    )
  })

  it("skips the opening sentence when the prompt already binds it (@image_N form)", () => {
    const r = placeFramesAfterReferences({ prompt: "use @image_2 as the first frame", firstFrameUrl: "F", refImageUrls: R(1), imageCap: 9 })
    expect(r.promptSuffix).toBe("")
  })

  it("binds nothing with no frame, and emits no identity sentence without one", () => {
    const r = placeFramesAfterReferences({ refImageUrls: R(2), imageCap: 9, bindIdentities: true })
    expect(r.imageUrls).toEqual(["r1", "r2"])
    expect(r.promptSuffix).toBe("")
  })
})
