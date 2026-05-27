import { describe, it, expect } from "vitest"
import { ltxCameraMotionFromUpstream } from "../ltx-camera-motion.js"

describe("ltxCameraMotionFromUpstream", () => {
  it("maps dolly-in to dolly_in", () => {
    expect(ltxCameraMotionFromUpstream([{ nodeType: "camera-motion", data: { cameraMotion: "dolly-in" } }])).toBe("dolly_in")
  })
  it("maps truck-left to dolly_left", () => {
    expect(ltxCameraMotionFromUpstream([{ nodeType: "camera-motion", data: { cameraMotion: "truck-left" } }])).toBe("dolly_left")
  })
  it("maps pedestal-up to jib_up", () => {
    expect(ltxCameraMotionFromUpstream([{ nodeType: "camera-motion", data: { cameraMotion: "pedestal-up" } }])).toBe("jib_up")
  })
  it("maps rack-focus to focus_shift", () => {
    expect(ltxCameraMotionFromUpstream([{ nodeType: "camera-motion", data: { cameraMotion: "rack-focus" } }])).toBe("focus_shift")
  })
  it("returns undefined when no camera-motion upstream", () => {
    expect(ltxCameraMotionFromUpstream([{ nodeType: "mood", data: { cameraMotion: "dolly-in" } }])).toBeUndefined()
  })
  it("returns undefined when catalog ID does not map (orbit, handheld, etc.)", () => {
    expect(ltxCameraMotionFromUpstream([{ nodeType: "camera-motion", data: { cameraMotion: "orbit-cw" } }])).toBeUndefined()
  })
  it("returns undefined when cameraMotion is empty", () => {
    expect(ltxCameraMotionFromUpstream([{ nodeType: "camera-motion", data: {} }])).toBeUndefined()
  })
})
