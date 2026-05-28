import { describe, it, expect } from "vitest"
import { isValidVideoSfxConnection } from "../video-sfx-handles"

const isPicker = (t: string) => new Set([
  "person", "mood", "setting", "look", "pose", "lens", "lighting", "atmosphere", "styling", "framing", "color-look", "temporal",
]).has(t)

describe("isValidVideoSfxConnection", () => {
  it("prompt handle accepts text producers", () => {
    expect(isValidVideoSfxConnection("prompt", "text-prompt", isPicker)).toBe(true)
    expect(isValidVideoSfxConnection("prompt", "ai-writer", isPicker)).toBe(true)
  })
  it("prompt handle accepts visual pickers", () => {
    expect(isValidVideoSfxConnection("prompt", "mood", isPicker)).toBe(true)
  })
  it("prompt handle rejects video producers", () => {
    expect(isValidVideoSfxConnection("prompt", "generate-video", isPicker)).toBe(false)
  })
  it("negative handle behaves identically to prompt", () => {
    expect(isValidVideoSfxConnection("negative", "text-prompt", isPicker)).toBe(true)
    expect(isValidVideoSfxConnection("negative", "generate-video", isPicker)).toBe(false)
  })
  it("video handle accepts video producers", () => {
    expect(isValidVideoSfxConnection("video", "generate-video", isPicker)).toBe(true)
    // Note: actual VIDEO_PRODUCER_TYPES member is "upload-video" (not "upload-video-widget").
    expect(isValidVideoSfxConnection("video", "upload-video", isPicker)).toBe(true)
    expect(isValidVideoSfxConnection("video", "loop-video", isPicker)).toBe(true)
  })
  it("video handle rejects text producers", () => {
    expect(isValidVideoSfxConnection("video", "text-prompt", isPicker)).toBe(false)
  })
  it("video handle rejects image producers", () => {
    expect(isValidVideoSfxConnection("video", "generate-image", isPicker)).toBe(false)
  })
  it("unknown handle returns false", () => {
    expect(isValidVideoSfxConnection("nonexistent", "text-prompt", isPicker)).toBe(false)
  })
})
