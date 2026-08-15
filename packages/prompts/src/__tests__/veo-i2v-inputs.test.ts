import { describe, it, expect } from "vitest"

import { resolveVeoI2vInputs } from "../veo-i2v-inputs.js"

/**
 * VEO 3.x i2v input resolution. VEO's API makes frame conditioning and
 * reference ingredients mutually exclusive (one imageUrls array, ≤3, whose
 * meaning flips with generationType) — so an anchored call that must carry
 * identity references moves to REFERENCE_2_VIDEO with the anchor in seat 1.
 * References win the seats (the 2026-08-14 standing rule: refs are a must,
 * frames additional): the end anchor is dropped in reference mode.
 */
describe("resolveVeoI2vInputs", () => {
  const FIRST = "https://r2/anchor.png"
  const refs = (n: number) => Array.from({ length: n }, (_, i) => `https://r2/ref-${i + 1}.png`)

  it("no references ⇒ plain frame mode, byte-identical: frames kept, no generationType, no suffix", () => {
    const r = resolveVeoI2vInputs({ prompt: "p", firstFrameUrl: FIRST, endFrameUrl: "https://r2/end.png" })
    expect(r).toEqual({
      imageUrls: [FIRST, "https://r2/end.png"],
      promptSuffix: "",
      droppedRefImages: 0,
      droppedEndFrame: false,
    })
  })

  it("references flip the call to REFERENCE_2_VIDEO with the anchor in seat 1, capped at 3", () => {
    const r = resolveVeoI2vInputs({ prompt: "p", firstFrameUrl: FIRST, refImageUrls: refs(4) })
    expect(r.generationType).toBe("REFERENCE_2_VIDEO")
    expect(r.imageUrls).toEqual([FIRST, "https://r2/ref-1.png", "https://r2/ref-2.png"])
    expect(r.droppedRefImages).toBe(2)
    expect(r.promptSuffix).toBe(
      "Use @image_1 as the opening (first) frame of the video. " +
        "@image_2 through @image_3 are identity references for this shot's subjects — match each subject's exact appearance; they are not frames.",
    )
  })

  it("the end anchor is DROPPED in reference mode — references win the seats", () => {
    const r = resolveVeoI2vInputs({ firstFrameUrl: FIRST, endFrameUrl: "https://r2/end.png", refImageUrls: refs(2) })
    expect(r.imageUrls).toEqual([FIRST, "https://r2/ref-1.png", "https://r2/ref-2.png"])
    expect(r.droppedEndFrame).toBe(true)
  })

  it("a single kept reference gets the singular sentence", () => {
    const r = resolveVeoI2vInputs({ firstFrameUrl: FIRST, refImageUrls: refs(1) })
    expect(r.promptSuffix).toContain("@image_2 is an identity reference")
  })

  it("suppresses the opening-frame sentence when the prompt already binds it", () => {
    const r = resolveVeoI2vInputs({
      prompt: "use @image_1 as the first frame, it is the last keyframe of @video_1",
      firstFrameUrl: FIRST,
      refImageUrls: refs(1),
    })
    expect(r.promptSuffix).not.toContain("opening (first) frame")
    expect(r.promptSuffix).toContain("identity reference")
  })
})
