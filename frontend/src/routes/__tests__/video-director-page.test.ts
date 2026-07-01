import { describe, it, expect } from "vitest"
import { progressToStepLabel } from "../video-director-page"

describe("progressToStepLabel", () => {
  it("returns authoring step at 10", () => {
    expect(progressToStepLabel(10)).toBe("Authoring script…")
  })

  it("returns speech step at 30", () => {
    expect(progressToStepLabel(30)).toBe("Generating speech…")
  })

  it("returns alignment step at 50", () => {
    expect(progressToStepLabel(50)).toBe("Aligning captions…")
  })

  it("returns resolve step at 70", () => {
    expect(progressToStepLabel(70)).toBe("Resolving shot sequence…")
  })

  it("returns rendering step at 80", () => {
    expect(progressToStepLabel(80)).toBe("Rendering video…")
  })

  it("returns finishing step at 100", () => {
    expect(progressToStepLabel(100)).toBe("Finishing up…")
  })

  it("returns authoring step at 0", () => {
    expect(progressToStepLabel(0)).toBe("Authoring script…")
  })

  it("returns correct step for values between buckets", () => {
    expect(progressToStepLabel(20)).toBe("Generating speech…")
    expect(progressToStepLabel(45)).toBe("Aligning captions…")
    expect(progressToStepLabel(60)).toBe("Resolving shot sequence…")
    expect(progressToStepLabel(75)).toBe("Rendering video…")
    expect(progressToStepLabel(99)).toBe("Finishing up…")
  })
})
