import { describe, it, expect } from "vitest"
import { buildVideoCreditModelIdentifier } from "../credit-identifiers.js"

describe("seedance-2 4k credit identifier", () => {
  it("4k no-ref → seedance-2:8s:4k (NOT clamped to 480p)", () => {
    expect(buildVideoCreditModelIdentifier("seedance-2", 8, false, "image-to-video", undefined, "4k", false))
      .toBe("seedance-2:8s:4k")
  })
  it("4k with video ref → seedance-2:8s:4k-ref", () => {
    expect(buildVideoCreditModelIdentifier("seedance-2", 8, false, "image-to-video", undefined, "4k", true))
      .toBe("seedance-2:8s:4k-ref")
  })
  it("4k on fast clamps to its top tier 720p (no fast 4k/1080p SKU)", () => {
    expect(buildVideoCreditModelIdentifier("seedance-2-fast", 8, false, "image-to-video", undefined, "4k", false))
      .toBe("seedance-2-fast:8s:720p")
  })
  it("1080p on fast clamps to 720p (no fast 1080p SKU)", () => {
    expect(buildVideoCreditModelIdentifier("seedance-2-fast", 8, false, "image-to-video", undefined, "1080p", false))
      .toBe("seedance-2-fast:8s:720p")
    expect(buildVideoCreditModelIdentifier("seedance-2-fast", 8, false, "image-to-video", undefined, "1080p", true))
      .toBe("seedance-2-fast:8s:720p-ref")
  })
})
