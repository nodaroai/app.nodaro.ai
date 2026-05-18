import { describe, it, expect } from "vitest"
import {
  LOCATION_ASSET_TYPES,
  LOCATION_ATTACH_COLUMNS,
  type LocationAssetType,
  type LocationAttachColumn,
} from "../entity-prompts"

describe("location entity-prompts constants", () => {
  it("LOCATION_ASSET_TYPES has 6 values", () => {
    expect(LOCATION_ASSET_TYPES).toEqual([
      "timeOfDay", "weather", "seasons", "angles", "lighting", "custom"
    ])
  })
  it("LOCATION_ATTACH_COLUMNS has 6 snake_case DB column names", () => {
    expect(LOCATION_ATTACH_COLUMNS).toEqual([
      "time_of_day", "weather", "seasons", "angles", "lighting", "atmosphere_motions"
    ])
  })
  it("LocationAssetType union derives from constant", () => {
    const x: LocationAssetType = "lighting"
    expect(LOCATION_ASSET_TYPES.includes(x)).toBe(true)
  })
  it("LocationAttachColumn union derives from constant", () => {
    const x: LocationAttachColumn = "atmosphere_motions"
    expect(LOCATION_ATTACH_COLUMNS.includes(x)).toBe(true)
  })
})
