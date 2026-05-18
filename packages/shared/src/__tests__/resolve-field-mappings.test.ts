/**
 * Tests for shared field-resolver helpers in `resolve-field-mappings.ts`.
 *
 * `resolveLocationFields(loc)` flattens a location's anchor image plus every
 * variant bucket (timeOfDay/weather/seasons/angles/lighting/atmosphereMotions)
 * into a single `Array<{ key, label, url }>` for picker UIs and ref-resolvers.
 */

import { describe, it, expect } from "vitest"
import { resolveLocationFields } from "../resolve-field-mappings.js"

describe("resolveLocationFields", () => {
  it("returns just the main image entry when no buckets are set", () => {
    const loc = { sourceImageUrl: "https://r2/loc/main.png" }
    const result = resolveLocationFields(loc)
    expect(result).toEqual([
      { key: "sourceImageUrl", label: "Main image", url: "https://r2/loc/main.png" },
    ])
  })

  it("flattens every bucket into key/label/url entries with per-bucket indices", () => {
    const loc = {
      sourceImageUrl: "https://r2/loc/main.png",
      timeOfDay: [
        { name: "dawn", url: "https://r2/loc/dawn.png" },
        { name: "dusk", url: "https://r2/loc/dusk.png" },
      ],
      weather: [{ name: "rainy", url: "https://r2/loc/rainy.png" }],
      seasons: [{ name: "winter", url: "https://r2/loc/winter.png" }],
      angles: [{ name: "wide", url: "https://r2/loc/wide.png" }],
      lighting: [{ name: "neon", url: "https://r2/loc/neon.png" }],
      atmosphereMotions: [
        { name: "smoke", url: "https://r2/loc/smoke.png" },
        { name: "rain-fall", url: "https://r2/loc/rain-fall.png" },
      ],
    }
    const result = resolveLocationFields(loc)
    expect(result).toEqual([
      { key: "sourceImageUrl", label: "Main image", url: "https://r2/loc/main.png" },
      { key: "timeOfDay[0]", label: "timeOfDay / dawn", url: "https://r2/loc/dawn.png" },
      { key: "timeOfDay[1]", label: "timeOfDay / dusk", url: "https://r2/loc/dusk.png" },
      { key: "weather[0]", label: "weather / rainy", url: "https://r2/loc/rainy.png" },
      { key: "seasons[0]", label: "seasons / winter", url: "https://r2/loc/winter.png" },
      { key: "angles[0]", label: "angles / wide", url: "https://r2/loc/wide.png" },
      { key: "lighting[0]", label: "lighting / neon", url: "https://r2/loc/neon.png" },
      { key: "atmosphereMotions[0]", label: "atmosphereMotions / smoke", url: "https://r2/loc/smoke.png" },
      { key: "atmosphereMotions[1]", label: "atmosphereMotions / rain-fall", url: "https://r2/loc/rain-fall.png" },
    ])
  })

  it("skips sourceImageUrl when missing", () => {
    const loc = {
      seasons: [{ name: "spring", url: "https://r2/loc/spring.png" }],
    }
    const result = resolveLocationFields(loc)
    expect(result).toEqual([
      { key: "seasons[0]", label: "seasons / spring", url: "https://r2/loc/spring.png" },
    ])
  })

  it("treats missing buckets and non-array buckets as empty", () => {
    const loc = {
      sourceImageUrl: "https://r2/loc/main.png",
      // bucket omitted entirely
      weather: undefined,
      // non-array values should not throw
      seasons: null as unknown as Array<{ name: string; url: string }>,
    }
    const result = resolveLocationFields(loc)
    expect(result).toEqual([
      { key: "sourceImageUrl", label: "Main image", url: "https://r2/loc/main.png" },
    ])
  })

  it("returns an empty array when the location has no fields at all", () => {
    expect(resolveLocationFields({})).toEqual([])
  })
})
