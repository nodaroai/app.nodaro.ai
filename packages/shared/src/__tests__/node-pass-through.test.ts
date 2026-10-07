import { describe, expect, it } from "vitest"
import { captionPlanPassThrough, combineVideosPassThrough, videoOverlayPassThrough } from "../node-pass-through.js"

describe("pass-through rules (R14)", () => {
  it("one resolved video passes Combine Videos through; two or none do not", () => {
    expect(combineVideosPassThrough(["https://cdn.example/a.mp4"])).toEqual({ videoUrl: "https://cdn.example/a.mp4", warning: "single_input" })
    expect(combineVideosPassThrough(["https://cdn.example/a.mp4", "", null])).toEqual({ videoUrl: "https://cdn.example/a.mp4", warning: "single_input" })
    expect(combineVideosPassThrough(["https://cdn.example/a.mp4", "https://cdn.example/b.mp4"])).toBeNull()
    expect(combineVideosPassThrough([])).toBeNull()
  })
  it("an empty wired layer plan with no other layer passes Video Overlay through", () => {
    expect(videoOverlayPassThrough({ videoUrl: "https://cdn.example/v.mp4", planWired: true, layerCount: 0 })).toEqual({ videoUrl: "https://cdn.example/v.mp4", warning: "no_layers" })
    expect(videoOverlayPassThrough({ videoUrl: "https://cdn.example/v.mp4", planWired: true, layerCount: 1 })).toBeNull()
    // No plan wired: an empty overlay is still the validator's no_layers error, never a silent pass-through.
    expect(videoOverlayPassThrough({ videoUrl: "https://cdn.example/v.mp4", planWired: false, layerCount: 0 })).toBeNull()
    expect(videoOverlayPassThrough({ videoUrl: undefined, planWired: true, layerCount: 0 })).toBeNull()
  })
  it("a wired caption plan with no segments passes Add Captions through", () => {
    expect(captionPlanPassThrough({ videoUrl: "https://cdn.example/v.mp4", planWired: true, segmentCount: 0 })).toEqual({ videoUrl: "https://cdn.example/v.mp4", warning: "no_captions" })
    expect(captionPlanPassThrough({ videoUrl: "https://cdn.example/v.mp4", planWired: true, segmentCount: 2 })).toBeNull()
    expect(captionPlanPassThrough({ videoUrl: "https://cdn.example/v.mp4", planWired: false, segmentCount: 0 })).toBeNull()
  })
})
