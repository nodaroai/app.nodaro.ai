import { describe, it, expect } from "vitest"
import { getEntranceStyle, getExitStyle, getWipeClipPath } from "../mg-motion.js"

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
})
