import { describe, it, expect } from "vitest"
import {
  LOCATION_ASSET_TYPES,
  LOCATION_ATTACH_COLUMNS,
  buildLocationMotionPrompt,
  type LocationAssetType,
  type LocationAttachColumn,
} from "../entity-prompts"

describe("location entity-prompts constants", () => {
  it("LOCATION_ASSET_TYPES has 6 values", () => {
    expect(LOCATION_ASSET_TYPES).toEqual([
      "timeOfDay", "weather", "seasons", "angles", "lighting", "custom"
    ])
  })
  it("LOCATION_ATTACH_COLUMNS has the snake_case DB column names (incl. reference-sheet buckets)", () => {
    expect(LOCATION_ATTACH_COLUMNS).toEqual([
      "time_of_day", "weather", "seasons", "angles", "lighting", "atmosphere_motions",
      // Reference-sheet buckets (migration 200) — locations get sheets + detail_closeups.
      "sheets", "detail_closeups",
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

describe("buildLocationMotionPrompt", () => {
  it("uses canonicalDescription when present", () => {
    const result = buildLocationMotionPrompt({
      name: "Old Library",
      motionPrompt: "slow dolly-in",
      canonicalDescription: "A dimly-lit Victorian library with leather-bound books, brass fixtures, warm golden light.",
    })
    expect(result).toContain("A dimly-lit Victorian library")
    expect(result).toContain("Camera move: slow dolly-in")
    expect(result).toContain("Slow, ambient, cinematic")
  })

  it("falls back to category + name when canonicalDescription absent", () => {
    const result = buildLocationMotionPrompt({
      name: "Subway Tunnel",
      category: "interior",
      motionPrompt: "static atmospheric",
    })
    expect(result).toContain("interior")
    expect(result).toContain("Subway Tunnel")
    expect(result).toContain("Camera move: static atmospheric")
  })

  it("uses 'A generic location' fallback when all scene fields empty", () => {
    const result = buildLocationMotionPrompt({
      name: "",
      motionPrompt: "drone fly-over",
    })
    expect(result).toContain("A generic location")
    expect(result).toContain("Camera move: drone fly-over")
  })

  it("defaults style to 'realistic'", () => {
    const result = buildLocationMotionPrompt({
      name: "X",
      motionPrompt: "y",
    })
    expect(result).toContain("realistic style")
  })

  it("honors explicit style", () => {
    const result = buildLocationMotionPrompt({
      name: "X",
      motionPrompt: "y",
      style: "anime",
    })
    expect(result).toContain("anime style")
  })
})
