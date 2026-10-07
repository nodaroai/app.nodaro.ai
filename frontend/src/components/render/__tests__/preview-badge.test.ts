import { describe, it, expect } from "vitest"
import { isPreviewOutput, isPreviewQuality } from "../preview-badge"

describe("isPreviewOutput — a job's or node's output is a Preview", () => {
  it("only for an Apply EDL output stamped proxy", () => {
    expect(isPreviewOutput("apply-edl", { videoUrl: "v", quality: "proxy" })).toBe(true)
    expect(isPreviewOutput("apply-edl", { videoUrl: "v", quality: "final" })).toBe(false)
    expect(isPreviewOutput("apply-edl", { videoUrl: "v" })).toBe(false)
  })
  it("never for another type, whatever its own `quality` means", () => {
    expect(isPreviewOutput("generate-video", { quality: "proxy" })).toBe(false)
    expect(isPreviewOutput(null, { quality: "proxy" })).toBe(false)
  })
  it("tolerates a missing output", () => {
    expect(isPreviewOutput("apply-edl", null)).toBe(false)
    expect(isPreviewOutput("apply-edl", undefined)).toBe(false)
  })
  it("isPreviewQuality reads the stamped quality only", () => {
    expect(isPreviewQuality({ quality: "proxy" })).toBe(true)
    expect(isPreviewQuality({ quality: "final" })).toBe(false)
    expect(isPreviewQuality(null)).toBe(false)
  })
})
