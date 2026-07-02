import { describe, it, expect, vi } from "vitest"

// Stub out module-level side effects before importing the component file
vi.mock("remotion", () => ({
  useCurrentFrame: () => 0,
  useVideoConfig: () => ({ fps: 30, width: 1920, height: 1080, durationInFrames: 300 }),
}))
vi.mock("../../lib/font-registry", () => ({
  FONT_MAP: { Montserrat: "Montserrat, sans-serif" },
  SUPPORTED_FONTS: ["Montserrat"],
}))

import { panCamera, PAN_FRACTION_OF_LEG } from "../spatial-pan-stations"

const DURATION = 240
const STATIONS = 4

describe("panCamera", () => {
  it("opens holding on station 0", () => {
    const s = panCamera(0, DURATION, STATIONS)
    expect(s.legIndex).toBe(0)
    expect(s.cameraPos).toBe(0)
    expect(s.arrived).toBe(true)
    expect(s.worldX).toBe(-0)
  })

  it("worldX is monotonically non-increasing — the pan only ever moves forward", () => {
    let prev = Infinity
    for (let f = 0; f <= DURATION; f++) {
      const { worldX } = panCamera(f, DURATION, STATIONS)
      expect(worldX).toBeLessThanOrEqual(prev + 1e-9)
      prev = worldX
    }
  })

  it("holds exactly on each station center once the leg's pan completes", () => {
    const segLen = DURATION / STATIONS
    for (let k = 1; k < STATIONS; k++) {
      const restFrame = Math.ceil(k * segLen + segLen * PAN_FRACTION_OF_LEG) + 1
      const s = panCamera(restFrame, DURATION, STATIONS)
      expect(s.cameraPos).toBe(k)
      expect(s.arrived).toBe(true)
    }
  })

  it("is mid-pan (not arrived, fractional position) during a leg's travel window", () => {
    const segLen = DURATION / STATIONS
    const midPan = Math.round(1 * segLen + segLen * PAN_FRACTION_OF_LEG * 0.5)
    const s = panCamera(midPan, DURATION, STATIONS)
    expect(s.arrived).toBe(false)
    expect(s.cameraPos).toBeGreaterThan(0)
    expect(s.cameraPos).toBeLessThan(1)
  })

  it("visits every station across the window and holds the last to the end", () => {
    const seen = new Set<number>()
    for (let f = 0; f <= DURATION; f++) {
      const s = panCamera(f, DURATION, STATIONS)
      if (s.arrived) seen.add(Math.round(s.cameraPos))
    }
    expect([...seen].sort()).toEqual([0, 1, 2, 3])
    const end = panCamera(DURATION, DURATION, STATIONS)
    expect(end.cameraPos).toBe(STATIONS - 1)
    expect(end.arrived).toBe(true)
  })

  it("legIndex identifies the current segment", () => {
    const segLen = DURATION / STATIONS
    expect(panCamera(Math.round(0.5 * segLen), DURATION, STATIONS).legIndex).toBe(0)
    expect(panCamera(Math.round(1.5 * segLen), DURATION, STATIONS).legIndex).toBe(1)
    expect(panCamera(DURATION - 1, DURATION, STATIONS).legIndex).toBe(STATIONS - 1)
  })
})
