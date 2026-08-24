import { describe, it, expect } from "vitest"
import { progressToStepLabel } from "../video-director-page"

describe("progressToStepLabel", () => {
  it("returns authoring step at 10", () => {
    expect(progressToStepLabel(10)).toBe("vd.stepAuthoring")
  })

  it("returns speech step at 30", () => {
    expect(progressToStepLabel(30)).toBe("vd.stepSpeech")
  })

  it("returns alignment step at 50", () => {
    expect(progressToStepLabel(50)).toBe("vd.stepCaptions")
  })

  it("returns resolve step at 70", () => {
    expect(progressToStepLabel(70)).toBe("vd.stepShots")
  })

  it("returns rendering step at 80", () => {
    expect(progressToStepLabel(80)).toBe("vd.stepRendering")
  })

  it("returns finishing step at 100", () => {
    expect(progressToStepLabel(100)).toBe("vd.stepFinishing")
  })

  it("returns authoring step at 0", () => {
    expect(progressToStepLabel(0)).toBe("vd.stepAuthoring")
  })

  it("returns correct step for values between buckets", () => {
    expect(progressToStepLabel(20)).toBe("vd.stepSpeech")
    expect(progressToStepLabel(45)).toBe("vd.stepCaptions")
    expect(progressToStepLabel(60)).toBe("vd.stepShots")
    expect(progressToStepLabel(75)).toBe("vd.stepRendering")
    expect(progressToStepLabel(99)).toBe("vd.stepFinishing")
  })
})
