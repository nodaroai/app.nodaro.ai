import { describe, it, expect } from "vitest"

import { resolveGeminiOmniI2vInputs } from "../gemini-omni-inputs.js"

/**
 * Gemini Omni i2v input resolution — the flat `image_urls` sibling of the
 * seedance-2 resolver. The stakes: an unbound image list reads as loose
 * context to a multimodal model (field finding 2026-08-14 — identity refs
 * rode every keyframes call and the cast still drifted), and an unbudgeted
 * list trips KIE's 7-input hard reject.
 */
describe("resolveGeminiOmniI2vInputs", () => {
  const FIRST = "https://r2/anchor.png"
  const refs = (n: number) => Array.from({ length: n }, (_, i) => `https://r2/ref-${i + 1}.png`)

  it("binds the roles: image 1 is the opening frame, the rest are identities — not frames", () => {
    const r = resolveGeminiOmniI2vInputs({ prompt: "a walk on the beach", firstFrameUrl: FIRST, refImageUrls: refs(3) })
    expect(r.imageUrls).toEqual([FIRST, ...refs(3)])
    expect(r.promptSuffix).toBe(
      "Use @image_1 as the opening (first) frame of the video. " +
        "@image_2 through @image_4 are identity references for this shot's subjects — match each subject's exact appearance; they are not frames.",
    )
    expect(r.droppedRefImages).toBe(0)
  })

  it("a single reference gets the singular sentence", () => {
    const r = resolveGeminiOmniI2vInputs({ firstFrameUrl: FIRST, refImageUrls: refs(1) })
    expect(r.promptSuffix).toContain("@image_2 is an identity reference")
    expect(r.promptSuffix).not.toContain("through")
  })

  it("no references ⇒ byte-identical plain i2v: single image, no suffix", () => {
    const r = resolveGeminiOmniI2vInputs({ prompt: "p", firstFrameUrl: FIRST })
    expect(r).toEqual({ imageUrls: [FIRST], promptSuffix: "", droppedRefImages: 0 })
  })

  it("drops TRAILING references to fit the 7-input quota — the start frame is never the one that goes", () => {
    const r = resolveGeminiOmniI2vInputs({ firstFrameUrl: FIRST, refImageUrls: refs(9) })
    expect(r.imageUrls).toHaveLength(7)
    expect(r.imageUrls[0]).toBe(FIRST)
    expect(r.imageUrls.at(-1)).toBe("https://r2/ref-6.png")
    expect(r.droppedRefImages).toBe(3)
    // The binding names exactly the kept span.
    expect(r.promptSuffix).toContain("@image_2 through @image_7")
  })

  it("a connected source video eats two slots (images + 2×videos ≤ 7)", () => {
    const r = resolveGeminiOmniI2vInputs({ firstFrameUrl: FIRST, refImageUrls: refs(9), videoConnected: true })
    expect(r.imageUrls).toHaveLength(5)
    expect(r.droppedRefImages).toBe(5)
  })

  it("suppresses the opening-frame sentence when the prompt already binds it, keeping the identity sentence", () => {
    const r = resolveGeminiOmniI2vInputs({
      prompt: "use @image_1 as the first frame, it is the last keyframe of @video_1",
      firstFrameUrl: FIRST,
      refImageUrls: refs(2),
    })
    expect(r.promptSuffix).not.toContain("opening (first) frame")
    expect(r.promptSuffix).toContain("identity references")
  })

  it("skips empty/undefined reference entries without burning slots", () => {
    const r = resolveGeminiOmniI2vInputs({ firstFrameUrl: FIRST, refImageUrls: [undefined, "", ...refs(2)] })
    expect(r.imageUrls).toEqual([FIRST, ...refs(2)])
    expect(r.droppedRefImages).toBe(0)
  })
})
