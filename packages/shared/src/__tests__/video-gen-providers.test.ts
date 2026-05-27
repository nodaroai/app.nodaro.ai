import { describe, expect, it } from "vitest"
import {
  IMAGE_TO_VIDEO_PROVIDERS,
  TEXT_TO_VIDEO_PROVIDERS,
  VIDEO_GEN_PROVIDERS,
  type VideoGenProvider,
} from "../model-constants.js"

describe("VIDEO_GEN_PROVIDERS", () => {
  it("includes every IMAGE_TO_VIDEO_PROVIDERS entry", () => {
    for (const p of IMAGE_TO_VIDEO_PROVIDERS) {
      expect(VIDEO_GEN_PROVIDERS).toContain(p)
    }
  })
  it("includes every TEXT_TO_VIDEO_PROVIDERS entry", () => {
    for (const p of TEXT_TO_VIDEO_PROVIDERS) {
      expect(VIDEO_GEN_PROVIDERS).toContain(p)
    }
  })
  it("has no duplicates", () => {
    const set = new Set(VIDEO_GEN_PROVIDERS)
    expect(set.size).toBe(VIDEO_GEN_PROVIDERS.length)
  })
  it("VideoGenProvider type narrows correctly", () => {
    const p: VideoGenProvider = "kling"
    expect(VIDEO_GEN_PROVIDERS).toContain(p)
  })
})
