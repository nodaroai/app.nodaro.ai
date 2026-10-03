import { describe, it, expect } from "vitest"
import { DEFAULT_OWN_MOTION, ownMotionHint } from "../video-own-motion.js"

describe("ownMotionHint", () => {
  const on = { motionEnabled: true, motion: "dynamic" }

  it("gives legacy Image to Video and Generate Video their own Motion clause", () => {
    expect(ownMotionHint("image-to-video", on)).toBe("dynamic motion")
    expect(ownMotionHint("generate-video", on)).toBe("dynamic motion")
  })

  it("gives none to a node type without the setting", () => {
    expect(ownMotionHint("text-to-video", on)).toBeUndefined()
    expect(ownMotionHint("video-to-video", on)).toBeUndefined()
  })

  it("gives none while the setting is off", () => {
    expect(ownMotionHint("generate-video", { motionEnabled: false, motion: "dynamic" })).toBeUndefined()
    expect(ownMotionHint("generate-video", { motion: "dynamic" })).toBeUndefined()
  })

  it("runs an enabled setting with no step stored as the step the panel shows", () => {
    expect(ownMotionHint("generate-video", { motionEnabled: true })).toBe(`${DEFAULT_OWN_MOTION} motion`)
    expect(ownMotionHint("image-to-video", { motionEnabled: true, motion: "" })).toBe(`${DEFAULT_OWN_MOTION} motion`)
  })
})
