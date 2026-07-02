import { describe, it, expect } from "vitest"
import { getEntranceStyle, getExitStyle, getWipeClipPath, EASING_MAP } from "../mg-motion.js"

describe("mg-motion helpers", () => {
  it("fade entrance sets opacity to progress", () => {
    expect(getEntranceStyle(0.5, { type: "fade" })).toEqual({ opacity: 0.5 })
  })

  it("none / draw-path entrances return empty (no opacity)", () => {
    expect(getEntranceStyle(0.5, { type: "none" })).toEqual({})
    expect(getEntranceStyle(0.5, { type: "draw-path" })).toEqual({})
  })

  it("wipe-in returns a clip path and no opacity", () => {
    const style = getEntranceStyle(0.5, { type: "wipe-in", direction: "left" })
    expect(style.opacity).toBeUndefined()
    expect(style.clipPath).toContain("inset(")
  })

  it("getWipeClipPath maps direction", () => {
    expect(getWipeClipPath(0, "right")).toBe("inset(0 100% 0 0)")
  })

  it("exit fade sets opacity to progress; unimplemented types no-op", () => {
    expect(getExitStyle(0.25, { type: "fade" })).toEqual({ opacity: 0.25 })
  })

  it("spring easing does not overshoot (bouncy demoted)", () => {
    for (let i = 0; i <= 20; i++) {
      const t = i / 20
      expect(EASING_MAP.spring(t)).toBeLessThanOrEqual(1.02)
    }
    expect(EASING_MAP.spring(1)).toBeCloseTo(1, 2)
  })
})

describe("inverse-zoom entrance (arrival: large → normal)", () => {
  it("progress 0 → starts ~2.5x, invisible", () => {
    expect(getEntranceStyle(0, { type: "inverse-zoom" })).toEqual({ transform: "scale(2.5)", opacity: 0 })
  })
  it("progress 1 → settled at scale 1, opaque", () => {
    expect(getEntranceStyle(1, { type: "inverse-zoom" })).toEqual({ transform: "scale(1)", opacity: 1 })
  })
  it("progress 0.5 → midway (scale 1.75, opacity 0.5)", () => {
    expect(getEntranceStyle(0.5, { type: "inverse-zoom" })).toEqual({ transform: "scale(1.75)", opacity: 0.5 })
  })
})

describe("zoom-through exit (fly toward camera: normal → large)", () => {
  it("exit progress 1 (start) → scale 1, opaque", () => {
    expect(getExitStyle(1, { type: "zoom-through" })).toEqual({ transform: "scale(1)", opacity: 1 })
  })
  it("exit progress 0 (gone) → ~2.5x, invisible", () => {
    expect(getExitStyle(0, { type: "zoom-through" })).toEqual({ transform: "scale(2.5)", opacity: 0 })
  })
})

describe("regression: existing motions unchanged", () => {
  it("scale-up entrance still scales from progress", () => {
    expect(getEntranceStyle(0.5, { type: "scale-up" })).toEqual({ transform: "scale(0.5)", opacity: 0.5 })
  })
  it("fade exit unchanged", () => {
    expect(getExitStyle(0.5, { type: "fade" })).toEqual({ opacity: 0.5 })
  })
})
