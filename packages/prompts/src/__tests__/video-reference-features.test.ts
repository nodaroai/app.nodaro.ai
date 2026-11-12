import { describe, it, expect } from "vitest"
import { modelsWithFeature } from "@nodaro/shared/model-catalog"

// Guards the catalog `reference-image` feature against the actual provider
// transport. A video model that advertises `reference-image` lets the editor
// attach reference images AND suppresses the "references will be ignored"
// warning — so advertising it without a working backend path silently drops
// the user's references (the grok-imagine-video-1.5 bug, 2026-06-28 audit).
describe("video reference-image capability (catalog)", () => {
  const refModels = modelsWithFeature("reference-image")

  // grok-imagine-video-1.5 advertised the feature with no transport behind it
  // (the 2026-06-28 audit). It carries its Image References now, as in-between
  // FRAMES (KIE `keyframes`, backend kie/grok-video-15.ts), so it declares
  // `reference-image` together with `keyframes` — and never as loose references.
  it("grok-imagine-video-1.5 advertises its Image References as in-between frames", () => {
    expect(refModels).toContain("grok-imagine-video-1.5")
    expect(modelsWithFeature("keyframes")).toContain("grok-imagine-video-1.5")
  })

  // The video models that genuinely forward references — verified against the
  // backend provider paths in the 2026-06-28 audit (Seedance resolver,
  // gemini-omni image_urls merge, VEO REFERENCE_2_VIDEO endpoint, kling-3-omni
  // Replicate reference_images, and the `maxRefImages` merge for grok-i2v /
  // happyhorse-ref2v) — must keep advertising it. Subset check, so wiring a
  // NEW ref-capable model doesn't fail here; only breaking a wired one does.
  // VEO 3.1 QUALITY (`veo3`) is the mirror case, and a costlier one: it DID
  // advertise the feature, the adapter sent generationType:
  // "REFERENCE_2_VIDEO", and KIE answered "Reference to video only supports
  // the Veo Fast model and Veo Lite model." — a 422 after the credits were
  // reserved (production 2026-09-04, app-reports lane G). Reference-to-video
  // exists on the Fast and Lite SKUs only.
  it("excludes veo3 / VEO 3.1 Quality (KIE serves reference-to-video on Fast + Lite only)", () => {
    expect(refModels).not.toContain("veo3")
  })

  it("includes the wired reference-capable video models", () => {
    for (const id of [
      "veo3.1",
      "veo3_lite",
      "gemini-omni-video",
      "kling-3-omni",
      "grok-i2v",
      "happyhorse-ref2v",
      "seedance-2",
      "seedance-2-fast",
      "seedance-2-mini",
      "minimax-h3",
    ]) {
      expect(refModels).toContain(id)
    }
  })
})
