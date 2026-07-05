import { describe, it, expect } from "vitest"
import { modelsWithFeature } from "@nodaro/shared"

// Guards the catalog `reference-image` feature against the actual provider
// transport. A video model that advertises `reference-image` lets the editor
// attach reference images AND suppresses the "references will be ignored"
// warning — so advertising it without a working backend path silently drops
// the user's references (the grok-imagine-video-1.5 bug, 2026-06-28 audit).
describe("video reference-image capability (catalog)", () => {
  const refModels = modelsWithFeature("reference-image")

  // grok-imagine-video-1.5 takes a single image_url (the i2v start frame) at
  // KIE — there is no reference transport (no `maxRefImages`, no special path),
  // so it must NOT advertise the feature.
  it("excludes grok-imagine-video-1.5 (no reference transport)", () => {
    expect(refModels).not.toContain("grok-imagine-video-1.5")
  })

  // The video models that genuinely forward references — verified against the
  // backend provider paths in the 2026-06-28 audit (Seedance resolver,
  // gemini-omni image_urls merge, VEO REFERENCE_2_VIDEO endpoint, kling-3-omni
  // Replicate reference_images, and the `maxRefImages` merge for grok-i2v /
  // happyhorse-ref2v) — must keep advertising it. Subset check, so wiring a
  // NEW ref-capable model doesn't fail here; only breaking a wired one does.
  it("includes the wired reference-capable video models", () => {
    for (const id of [
      "veo3",
      "veo3.1",
      "veo3_lite",
      "gemini-omni-video",
      "kling-3-omni",
      "grok-i2v",
      "happyhorse-ref2v",
      "seedance-2",
      "seedance-2-fast",
      "seedance-2-mini",
    ]) {
      expect(refModels).toContain(id)
    }
  })
})
