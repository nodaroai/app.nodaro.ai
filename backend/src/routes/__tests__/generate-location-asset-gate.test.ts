import { describe, it, expect } from "vitest"
import { locationAssetGate } from "../generate-location-asset.js"

describe("locationAssetGate", () => {
  it("passes when not attaching to a location", () => {
    expect(locationAssetGate(undefined, null)).toEqual({ ok: true })
  })
  it("404s when the location row is missing (not owned / deleted)", () => {
    expect(locationAssetGate("loc-1", null)).toEqual({ ok: false, code: "location_not_found" })
  })
  it("400s main_image_required when the location has no approved source image", () => {
    expect(locationAssetGate("loc-1", { source_image_url: null })).toEqual({ ok: false, code: "main_image_required" })
  })
  it("passes when the location has an approved source image", () => {
    expect(locationAssetGate("loc-1", { source_image_url: "https://r2/x.png" })).toEqual({ ok: true })
  })
})
