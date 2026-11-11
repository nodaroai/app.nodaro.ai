import { describe, it, expect } from "vitest"
import { kling4InputProblem } from "../kling4-inputs.js"

const base = {
  durationSec: 5,
  hasStartFrame: false,
  hasEndFrame: false,
  referenceImageCount: 0,
  referenceVideoCount: 0,
  referenceAudioCount: 0,
  characterCount: 0,
}

describe("kling4InputProblem", () => {
  it("ignores every other provider", () => {
    expect(kling4InputProblem({ ...base, provider: "vidu-q4", referenceImageCount: 99 })).toBeNull()
    expect(kling4InputProblem({ ...base, provider: undefined, referenceImageCount: 99 })).toBeNull()
  })

  describe("kling-4-keyframes — the duration's frame cap (KIE: 3s → 4 … 9s or longer → 10)", () => {
    const kf = { ...base, provider: "kling-4-keyframes" }
    it("accepts a full set at the cap and refuses one more (the live 422 shape)", () => {
      expect(kling4InputProblem({ ...kf, durationSec: 3, hasStartFrame: true, hasEndFrame: true, referenceImageCount: 2 })).toBeNull()
      const over = kling4InputProblem({ ...kf, durationSec: 3, hasStartFrame: true, hasEndFrame: true, referenceImageCount: 3 })
      expect(over?.code).toBe("validation_error")
      expect(over?.message).toMatch(/at most 4 frames.*3s.*5 are connected/)
    })
    it("9s or longer takes 10 frames, and never more than 8 in-between", () => {
      expect(kling4InputProblem({ ...kf, durationSec: 30, hasStartFrame: true, hasEndFrame: true, referenceImageCount: 8 })).toBeNull()
      expect(kling4InputProblem({ ...kf, durationSec: 30, referenceImageCount: 9 })?.message).toMatch(/at most 8 in-between/)
    })
    it("an omitted duration is the 5s default (6 frames)", () => {
      expect(kling4InputProblem({ ...kf, durationSec: undefined, referenceImageCount: 6 })).toBeNull()
      expect(kling4InputProblem({ ...kf, durationSec: undefined, hasStartFrame: true, referenceImageCount: 6 })).not.toBeNull()
    })
  })

  describe("kling-4 — 15 materials in all", () => {
    const k = { ...base, provider: "kling-4" }
    it("accepts 15 and refuses 16 (a start frame counts as an image)", () => {
      expect(kling4InputProblem({ ...k, referenceImageCount: 4, hasStartFrame: true, referenceVideoCount: 5, characterCount: 3, referenceAudioCount: 2 })).toBeNull()
      expect(kling4InputProblem({ ...k, referenceImageCount: 5, hasStartFrame: true, referenceVideoCount: 5, characterCount: 3, referenceAudioCount: 2 })?.message).toMatch(/at most 15 materials.*16/)
    })
  })

  describe("kling-4-flash — 15 materials, voice clips ride their characters", () => {
    const f = { ...base, provider: "kling-4-flash" }
    it("accepts 15 and refuses 16; voice clips and an end frame take no seat", () => {
      expect(kling4InputProblem({ ...f, referenceImageCount: 6, hasStartFrame: true, referenceVideoCount: 5, characterCount: 3, referenceAudioCount: 7, hasEndFrame: true })).toBeNull()
      const over = kling4InputProblem({ ...f, referenceImageCount: 7, hasStartFrame: true, referenceVideoCount: 5, characterCount: 3 })
      expect(over?.code).toBe("validation_error")
      expect(over?.message).toMatch(/Kling 4\.0 Flash takes at most 15 materials.*16/)
    })
    it("has no frame cap of its own: a start frame alone (the keyframe endpoint) and any duration pass", () => {
      expect(kling4InputProblem({ ...f, hasStartFrame: true, durationSec: 3 })).toBeNull()
      expect(kling4InputProblem({ ...f, hasStartFrame: true, hasEndFrame: true, durationSec: 20, referenceImageCount: 8 })).toBeNull()
    })
  })
})
