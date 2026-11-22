import { describe, expect, it } from "vitest"
import {
  ELEVENLABS_DUBBING_USD_PER_MINUTE,
  ELEVENLABS_DUBBING_WATERMARKED_USD_PER_MINUTE,
  ELEVENLABS_PROJECT_DUBBING_USD_PER_MINUTE,
  elevenlabsDubbingCostUsd,
} from "../elevenlabs-dubbing-cost.js"

describe("what a dub costs the platform", () => {
  it("the started minutes the run is held for × the dubbing API's rate", () => {
    expect(elevenlabsDubbingCostUsd("elevenlabs-dubbing", 30)).toBe(ELEVENLABS_DUBBING_USD_PER_MINUTE)
    expect(elevenlabsDubbingCostUsd("elevenlabs-dubbing", 60.03)).toBe(ELEVENLABS_DUBBING_USD_PER_MINUTE)
    expect(elevenlabsDubbingCostUsd("elevenlabs-dubbing", 180)).toBeCloseTo(3 * ELEVENLABS_DUBBING_USD_PER_MINUTE, 10)
  })

  it("the project API (Hebrew) at its own rate", () => {
    expect(elevenlabsDubbingCostUsd("elevenlabs-dubbing-v2", 30)).toBe(ELEVENLABS_PROJECT_DUBBING_USD_PER_MINUTE)
    expect(elevenlabsDubbingCostUsd("elevenlabs-dubbing-v2", 180)).toBeCloseTo(3 * ELEVENLABS_PROJECT_DUBBING_USD_PER_MINUTE, 10)
  })

  it("a dub that asked for the service's own watermark at its lower rate (the project API has no such rate)", () => {
    expect(elevenlabsDubbingCostUsd("elevenlabs-dubbing", 60, { watermark: true })).toBe(ELEVENLABS_DUBBING_WATERMARKED_USD_PER_MINUTE)
    expect(elevenlabsDubbingCostUsd("elevenlabs-dubbing-v2", 60, { watermark: true })).toBe(ELEVENLABS_PROJECT_DUBBING_USD_PER_MINUTE)
  })

  it("no length, no cost", () => {
    expect(elevenlabsDubbingCostUsd("elevenlabs-dubbing", 0)).toBe(0)
    expect(elevenlabsDubbingCostUsd("elevenlabs-dubbing", Number.NaN)).toBe(0)
  })
})
