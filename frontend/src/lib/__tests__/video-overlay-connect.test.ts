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
