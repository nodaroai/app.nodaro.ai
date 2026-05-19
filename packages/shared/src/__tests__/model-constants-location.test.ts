import { describe, it, expect } from "vitest"
import { LOCATION_ATMOSPHERE_PROVIDERS, type LocationAtmosphereProvider } from "../model-constants.js"

describe("LOCATION_ATMOSPHERE_PROVIDERS", () => {
  it("has 6 i2v providers", () => {
    expect(LOCATION_ATMOSPHERE_PROVIDERS).toEqual([
      "kling",
      "kling-turbo",
      "kling-3.0",
      "wan-i2v",
      "wan-2.7-i2v",
      "seedance-2",
    ])
  })

  it("LocationAtmosphereProvider union derives from the constant", () => {
    const x: LocationAtmosphereProvider = "kling-3.0"
    expect(LOCATION_ATMOSPHERE_PROVIDERS.includes(x)).toBe(true)
  })
})
