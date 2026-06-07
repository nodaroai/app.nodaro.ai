import { describe, it, expect } from "vitest"
import {
  OBJECT_ASSET_VARIANTS,
  LOCATION_ASSET_VARIANTS,
  CHARACTER_ASSET_VARIANTS,
} from "../entity-prompts.js"

describe("hoisted entity variant value-lists", () => {
  it("object variants match the values currently in generate-object-asset.ts", () => {
    expect(OBJECT_ASSET_VARIANTS.angles).toEqual(["front", "side", "top", "back", "three-quarter"])
    expect(OBJECT_ASSET_VARIANTS.materials).toEqual(["wood", "metal", "glass", "plastic", "fabric", "stone"])
    expect(OBJECT_ASSET_VARIANTS.variations).toEqual(["clean", "weathered", "damaged", "ornate", "minimal"])
  })
  it("location variants match the values currently in generate-location-asset.ts", () => {
    expect(LOCATION_ASSET_VARIANTS.timeOfDay).toEqual([
      "dawn", "morning", "noon", "afternoon", "golden hour", "dusk", "blue hour", "night", "midnight",
    ])
    expect(LOCATION_ASSET_VARIANTS.weather).toEqual([
      "clear", "cloudy", "light rain", "heavy rain", "storm", "snow", "blizzard", "fog", "mist",
    ])
    expect(LOCATION_ASSET_VARIANTS.seasons).toEqual(["spring", "summer", "autumn", "winter"])
    expect(LOCATION_ASSET_VARIANTS.angles).toEqual([
      "wide", "medium", "closeup", "aerial", "low-angle", "eye-level", "bird's-eye", "dutch tilt",
    ])
    expect(LOCATION_ASSET_VARIANTS.lighting).toEqual([
      "soft natural", "harsh sunlight", "golden", "blue hour", "neon", "candlelit", "cinematic", "dramatic chiaroscuro",
    ])
  })
  it("character variants are still present (unchanged)", () => {
    expect(CHARACTER_ASSET_VARIANTS.angles).toContain("3/4 left")
    expect(CHARACTER_ASSET_VARIANTS.expressions).toHaveLength(11)
  })
})
