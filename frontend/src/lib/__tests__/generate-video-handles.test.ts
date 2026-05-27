import { describe, expect, it } from "vitest"
import {
  isValidGenerateVideoConnection,
  GENERATE_VIDEO_INPUT_HANDLES,
} from "../generate-video-handles"

describe("generate-video-handles", () => {
  const isPicker = () => false

  it("prompt accepts text producers", () => {
    expect(isValidGenerateVideoConnection("prompt", "text-prompt", isPicker)).toBe(true)
    expect(isValidGenerateVideoConnection("prompt", "ai-writer", isPicker)).toBe(true)
  })

  it("startFrame accepts image producers but not video producers", () => {
    expect(isValidGenerateVideoConnection("startFrame", "generate-image", isPicker)).toBe(true)
    expect(isValidGenerateVideoConnection("startFrame", "generate-video", isPicker)).toBe(false)
  })

  it("imageReferences accepts image producers", () => {
    expect(isValidGenerateVideoConnection("imageReferences", "upload-image", isPicker)).toBe(true)
    expect(isValidGenerateVideoConnection("imageReferences", "generate-video", isPicker)).toBe(false)
  })

  it("videoReferences accepts video producers", () => {
    expect(isValidGenerateVideoConnection("videoReferences", "generate-video", isPicker)).toBe(true)
    expect(isValidGenerateVideoConnection("videoReferences", "image-to-video", isPicker)).toBe(true)
    expect(isValidGenerateVideoConnection("videoReferences", "upload-image", isPicker)).toBe(false)
  })

  it("audio and audioReferences accept audio producers", () => {
    expect(isValidGenerateVideoConnection("audio", "text-to-speech", isPicker)).toBe(true)
    expect(isValidGenerateVideoConnection("audioReferences", "generate-music", isPicker)).toBe(true)
  })

  it("assets accepts identity types", () => {
    expect(isValidGenerateVideoConnection("assets", "character", isPicker)).toBe(true)
    expect(isValidGenerateVideoConnection("assets", "location", isPicker)).toBe(true)
    expect(isValidGenerateVideoConnection("assets", "generate-image", isPicker)).toBe(false)
  })

  it("look accepts LOOK_PICKER_TYPES", () => {
    expect(isValidGenerateVideoConnection("look", "lens", isPicker)).toBe(true)
    expect(isValidGenerateVideoConnection("look", "camera-motion", isPicker)).toBe(true)
  })

  it("elements accepts ELEMENTS_PICKER_TYPES plus catch-all picker", () => {
    expect(isValidGenerateVideoConnection("elements", "person", isPicker)).toBe(true)
    expect(isValidGenerateVideoConnection("elements", "weird-picker", (t) => t === "weird-picker")).toBe(true)
  })

  it("returns false for unknown handle ids", () => {
    expect(isValidGenerateVideoConnection("unknown", "text-prompt", isPicker)).toBe(false)
  })

  it("GENERATE_VIDEO_INPUT_HANDLES has 11 entries", () => {
    expect(GENERATE_VIDEO_INPUT_HANDLES).toHaveLength(11)
  })

  it("negative rejects visual pickers (unlike prompt)", () => {
    const isLensPicker = (t: string) => t === "lens"
    expect(isValidGenerateVideoConnection("negative", "lens", isLensPicker)).toBe(false)
    // Sanity: prompt still accepts pickers
    expect(isValidGenerateVideoConnection("prompt", "lens", isLensPicker)).toBe(true)
  })

  it("audio rejects non-audio outputs (transcribe = text, merge-video-audio = video)", () => {
    expect(isValidGenerateVideoConnection("audio", "transcribe", () => false)).toBe(false)
    expect(isValidGenerateVideoConnection("audio", "merge-video-audio", () => false)).toBe(false)
  })

  it("videoReferences accepts lip-sync (backend canonical video producer)", () => {
    expect(isValidGenerateVideoConnection("videoReferences", "lip-sync", () => false)).toBe(true)
  })
})
