// @vitest-environment node
import { describe, it, expect } from "vitest"
import { videoOverlayConnectPatch } from "../video-overlay-connect"

describe("videoOverlayConnectPatch (D3)", () => {
  it("wiring overlay3 clears layers[2].imageUrl and nothing else", () => {
    const layers = [{ imageUrl: "https://x/0.png", start: 0 }, null, { imageUrl: "https://x/2.png", start: 2, preset: "card" as const }]
    expect(videoOverlayConnectPatch({ layers }, "overlay3")).toEqual({
      layers: [{ imageUrl: "https://x/0.png", start: 0 }, null, { start: 2, preset: "card" }],
    })
  })
  it("returns null for the base handle, an unknown handle, a slot without a URL, or no layers", () => {
    const layers = [{ start: 0 }]
    expect(videoOverlayConnectPatch({ layers }, "video")).toBeNull()
    expect(videoOverlayConnectPatch({ layers }, "layerPlan")).toBeNull()
    expect(videoOverlayConnectPatch({ layers }, "overlay")).toBeNull()
    expect(videoOverlayConnectPatch({}, "overlay")).toBeNull()
  })
})

/**
 * A wire whose kind differs from what the slot was before (its earlier wire,
 * else its own stored source) drops the settings that belonged to that other
 * kind: `animate` returns to the new kind's default (on for an image, off for
 * a video), and `sound` — a video layer's only — goes when the slot is now an
 * image. A wire of the same kind, or one whose kind is not known yet, keeps them.
 */
describe("videoOverlayConnectPatch — a wire that changes the slot's kind", () => {
  it("a video wired over a stored image: the image goes, its explicit fade goes (a video layer does not fade by default)", () => {
    const layers = [{ imageUrl: "https://x/0.png", start: 1, animate: true }]
    expect(videoOverlayConnectPatch({ layers }, "overlay", { next: "video" })).toEqual({ layers: [{ start: 1 }] })
  })
  it("an image wired where a video was wired: its sound and its fade setting go", () => {
    const layers = [{ start: 1, animate: false, sound: { volume: 0.5 }, opacity: 0.8 }]
    expect(videoOverlayConnectPatch({ layers }, "overlay", { previous: "video", next: "image" })).toEqual({ layers: [{ start: 1, opacity: 0.8 }] })
  })
  it("a video wired where a video was: the layer keeps its sound and its fade", () => {
    const layers = [{ start: 1, animate: true, sound: { volume: 0.5 } }]
    expect(videoOverlayConnectPatch({ layers }, "overlay", { previous: "video", next: "video" })).toBeNull()
  })
  it("a stored video source counts as the slot's kind; a layer with sound but no source was a video", () => {
    expect(videoOverlayConnectPatch({ layers: [{ videoUrl: "https://x/v.mp4", start: 0, sound: { volume: 1 } }] }, "overlay", { next: "video" })).toEqual({
      layers: [{ start: 0, sound: { volume: 1 } }],
    })
    expect(videoOverlayConnectPatch({ layers: [{ start: 0, sound: { volume: 1 }, animate: true }] }, "overlay", { next: "video" })).toBeNull()
    expect(videoOverlayConnectPatch({ layers: [{ start: 0, sound: { volume: 1 }, animate: true }] }, "overlay", { next: "image" })).toEqual({ layers: [{ start: 0 }] })
  })
  it("a layer with no source read as an image: a video wired in resets its fade", () => {
    expect(videoOverlayConnectPatch({ layers: [{ start: 0, animate: true }] }, "overlay", { next: "video" })).toEqual({ layers: [{ start: 0 }] })
    expect(videoOverlayConnectPatch({ layers: [{ start: 0, animate: false }] }, "overlay", { next: "image" })).toBeNull()
  })
  it("a wire whose kind is not known yet changes nothing beyond clearing the stored source", () => {
    expect(videoOverlayConnectPatch({ layers: [{ imageUrl: "https://x/0.png", start: 0, animate: true }] }, "overlay", { next: "unknown" })).toEqual({
      layers: [{ start: 0, animate: true }],
    })
    expect(videoOverlayConnectPatch({ layers: [{ start: 0, animate: true }] }, "overlay", { previous: "unknown", next: "video" })).toBeNull()
  })
})
