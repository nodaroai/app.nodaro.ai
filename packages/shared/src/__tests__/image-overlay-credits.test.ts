/**
 * The worked examples here are repeated verbatim in
 * docs/nodes/processing-video/image-overlay.md — change both or neither.
 */
import { describe, it, expect } from "vitest"
import { imageOverlayCredits, imageOverlayBillableVariants, IMAGE_OVERLAY_BASE_CREDITS, IMAGE_OVERLAY_VARIANT_CREDITS } from "../credit-estimators/image-overlay"
import { OVERLAY_PLATFORM_IDS } from "../image-overlay-platforms"

describe("imageOverlayCredits", () => {
  it("base + 2 per extra platform: 0 → 10, 2 → 14, all twelve → 34", () => {
    expect(IMAGE_OVERLAY_BASE_CREDITS).toBe(10)
    expect(IMAGE_OVERLAY_VARIANT_CREDITS).toBe(2)
    expect(imageOverlayCredits(undefined)).toBe(10)
    expect(imageOverlayCredits([])).toBe(10)
    expect(imageOverlayCredits(["instagram-post", "youtube-thumbnail"])).toBe(14)
    expect(OVERLAY_PLATFORM_IDS.length).toBe(12)
    expect(imageOverlayCredits(OVERLAY_PLATFORM_IDS)).toBe(34)
  })

  it("counts only distinct, real platform ids — duplicates and junk are free because they are not rendered", () => {
    expect(imageOverlayBillableVariants(["instagram-post", "instagram-post", 7, "not-a-platform", "x-header"])).toEqual(["instagram-post", "x-header"])
    expect(imageOverlayCredits(["instagram-post", "instagram-post", 7, "not-a-platform", "x-header"])).toBe(14)
  })
})
