import { describe, it, expect, vi, beforeEach } from "vitest"
import { render } from "@testing-library/react"

/**
 * Smoke tests for the 5 thin environmental tab wrappers — Time of Day,
 * Weather, Seasons, Angles, Lighting. Each wrapper should render
 * preset list, and label.
 *
 * Mocks the shared `EnvironmentalAssetTab` so we can assert the exact props
 * the wrapper forwards — without having to wire React Query / fetch / API
 * mocks like the full `environmental-asset-tab.test.tsx` does.
 *
 * The preset arrays MUST match `VARIANTS` in
 * `backend/src/routes/generate-location-asset.ts` byte-for-byte, otherwise
 * the route's Zod enum will reject the request at generate-time. These tests
 * lock the preset list in place; if you change the backend VARIANTS map,
 * update BOTH the wrapper file AND the matching `expect` here.
 */

// Hoisted mock — capture props each render
const mockProps = vi.fn()
vi.mock("../environmental-asset-tab", () => ({
  EnvironmentalAssetTab: (props: unknown) => {
    mockProps(props)
    return null
  },
}))

import { TimeOfDayTab } from "../time-of-day-tab"
import { WeatherTab } from "../weather-tab"
import { SeasonsTab } from "../seasons-tab"
import { AnglesTab } from "../angles-tab"
import { LightingTab } from "../lighting-tab"
import type { LocationStudioState } from "../use-location-studio"

function makeStudio(): LocationStudioState {
  return {
    stagedData: null,
    isDirty: false,
    isSaving: false,
    isApprovingMainImage: false,
    setIsApprovingMainImage: vi.fn(),
    patch: vi.fn(),
    saveStaged: vi.fn().mockResolvedValue("loc-uuid-1"),
    ensureSavedBeforeGen: vi.fn().mockResolvedValue("loc-uuid-1"),
    approveMainImage: vi.fn().mockResolvedValue({
      sourceImageUrl: "https://example.com/approved.png",
      canonicalDescription: "",
    }),
  }
}

describe("environmental tab wrappers", () => {
  beforeEach(() => {
    mockProps.mockClear()
  })

  it("TimeOfDayTab forwards the 9 time-of-day presets", () => {
    const studio = makeStudio()
    render(<TimeOfDayTab studio={studio} />)
    expect(mockProps).toHaveBeenCalledTimes(1)
    expect(mockProps).toHaveBeenCalledWith(
      expect.objectContaining({
        studio,
        bucketName: "timeOfDay",
        iconLabel: expect.stringContaining("Time of Day"),
        presets: [
          "dawn",
          "morning",
          "noon",
          "afternoon",
          "golden hour",
          "dusk",
          "blue hour",
          "night",
          "midnight",
        ],
      }),
    )
  })

  it("WeatherTab forwards the 9 weather presets", () => {
    const studio = makeStudio()
    render(<WeatherTab studio={studio} />)
    expect(mockProps).toHaveBeenCalledTimes(1)
    expect(mockProps).toHaveBeenCalledWith(
      expect.objectContaining({
        studio,
        bucketName: "weather",
        iconLabel: expect.stringContaining("Weather"),
        presets: [
          "clear",
          "cloudy",
          "light rain",
          "heavy rain",
          "storm",
          "snow",
          "blizzard",
          "fog",
          "mist",
        ],
      }),
    )
  })

  it("SeasonsTab forwards the 4 seasons presets", () => {
    const studio = makeStudio()
    render(<SeasonsTab studio={studio} />)
    expect(mockProps).toHaveBeenCalledTimes(1)
    expect(mockProps).toHaveBeenCalledWith(
      expect.objectContaining({
        studio,
        bucketName: "seasons",
        iconLabel: expect.stringContaining("Seasons"),
        presets: ["spring", "summer", "autumn", "winter"],
      }),
    )
  })

  it("AnglesTab forwards the 8 angles presets", () => {
    const studio = makeStudio()
    render(<AnglesTab studio={studio} />)
    expect(mockProps).toHaveBeenCalledTimes(1)
    expect(mockProps).toHaveBeenCalledWith(
      expect.objectContaining({
        studio,
        bucketName: "angles",
        iconLabel: expect.stringContaining("Angles"),
        presets: [
          "wide",
          "medium",
          "closeup",
          "aerial",
          "low-angle",
          "eye-level",
          "bird's-eye",
          "dutch tilt",
        ],
      }),
    )
  })

  it("LightingTab forwards the 8 lighting presets", () => {
    const studio = makeStudio()
    render(<LightingTab studio={studio} />)
    expect(mockProps).toHaveBeenCalledTimes(1)
    expect(mockProps).toHaveBeenCalledWith(
      expect.objectContaining({
        studio,
        bucketName: "lighting",
        iconLabel: expect.stringContaining("Lighting"),
        presets: [
          "soft natural",
          "harsh sunlight",
          "golden",
          "blue hour",
          "neon",
          "candlelit",
          "cinematic",
          "dramatic chiaroscuro",
        ],
      }),
    )
  })
})
