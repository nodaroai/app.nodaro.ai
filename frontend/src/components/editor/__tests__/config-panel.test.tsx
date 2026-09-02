import { describe, it, expect, vi } from "vitest"

// ---------------------------------------------------------------------------
// config-panel.tsx has many heavy transitive imports (Supabase, Zustand,
// config-panel components, etc.). The display-name lookup is imported from
// config-panel-label.ts (its real home); the two type Sets are still
// duplicated here and tested in isolation — they are top-level constants
// with no runtime deps.
// ---------------------------------------------------------------------------

// The display-name table + getNodeTypeDisplayName are imported from their
// real, dependency-light home (config-panel-label.ts) — no copy to drift.
import { getNodeTypeDisplayName } from "../config-panel-label"

const GENERATE_BUTTON_TYPES = new Set([
  "generate-script", "generate-image", "edit-image", "image-to-image",
  "image-to-video", "video-to-video", "text-to-video", "text-to-speech",
  "text-to-audio", "audio-isolation", "text-to-dialogue", "voice-changer", "dubbing", "voice-remix", "voice-design", "forced-alignment", "generate-music", "motion-transfer", "lip-sync", "speech-to-video",
  "video-upscale", "extend-video", "suno-generate", "suno-cover", "suno-extend",
  "suno-lyrics", "suno-separate", "suno-music-video",
  "suno-mashup", "suno-replace-section", "suno-style-boost", "suno-add-instrumental", "suno-add-vocals", "suno-convert-wav", "suno-upload-extend",
  "llm-chat",
  "video-composer", "after-effects", "lottie-overlay", "3d-title", "motion-graphics",
  "image-to-text", "qa-check", "transcribe",
  "render-video",
  "instagram-post", "tiktok-post", "youtube-upload", "linkedin-post", "x-post", "facebook-post",
])

const RUN_BUTTON_TYPES = new Set([
  "merge-video-audio", "combine-videos", "trim-audio", "trim-video",
  "speed-ramp", "loop-video", "fade-video", "transcode-video", "manual-edit", "resize-video", "social-media-format", "adjust-volume",
  "add-captions", "mix-audio", "composite",
  "sub-workflow",
])

const RUN_FROM_HERE_TYPES = new Set([
  "combine-text", "split-text", "extract-field", "json-process", "filter-list",
  "deduplicate", "merge-lists", "sort-list", "selector", "router",
  "preview", "list",
])

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("getNodeTypeDisplayName", () => {
  it("returns the hardcoded name for 'generate-image'", () => {
    expect(getNodeTypeDisplayName("generate-image")).toBe("Generate Image")
  })

  it("returns the hardcoded name for 'text-prompt'", () => {
    expect(getNodeTypeDisplayName("text-prompt")).toBe("Text")
  })

  it("returns the hardcoded name for 'audio-isolation' (Voice Extractor)", () => {
    expect(getNodeTypeDisplayName("audio-isolation")).toBe("Voice Extractor")
  })

  it("returns the hardcoded name for 'llm-chat' (Generate Text)", () => {
    expect(getNodeTypeDisplayName("llm-chat")).toBe("Generate Text")
  })

  it("returns the hardcoded name for 'image-to-text' (Describe Image)", () => {
    expect(getNodeTypeDisplayName("image-to-text")).toBe("Describe Image")
  })

  it("returns the hardcoded name for 'speed-ramp' (Adjust Speed)", () => {
    expect(getNodeTypeDisplayName("speed-ramp")).toBe("Adjust Speed")
  })

  it("falls back to capitalized hyphen-split for unknown types", () => {
    expect(getNodeTypeDisplayName("unknown-type")).toBe("Unknown Type")
  })

  it("handles single-word unknown type", () => {
    expect(getNodeTypeDisplayName("custom")).toBe("Custom")
  })

  it("handles multi-word unknown type with many hyphens", () => {
    expect(getNodeTypeDisplayName("my-custom-node-type")).toBe(
      "My Custom Node Type",
    )
  })
})

describe("GENERATE_BUTTON_TYPES", () => {
  it("is a Set", () => {
    expect(GENERATE_BUTTON_TYPES).toBeInstanceOf(Set)
  })

  it("contains core AI nodes", () => {
    const expected = [
      "generate-image",
      "llm-chat",
      "text-to-speech",
      "image-to-video",
      "text-to-video",
      "video-to-video",
      "generate-music",
      "video-composer",
      "after-effects",
      "lottie-overlay",
      "3d-title",
      "motion-graphics",
      "image-to-text",
      "qa-check",
      "transcribe",
      "render-video",
    ]
    for (const type of expected) {
      expect(GENERATE_BUTTON_TYPES.has(type)).toBe(true)
    }
  })

  it("contains social post nodes", () => {
    const socialTypes = [
      "instagram-post", "tiktok-post", "youtube-upload",
      "linkedin-post", "x-post", "facebook-post",
    ]
    for (const type of socialTypes) {
      expect(GENERATE_BUTTON_TYPES.has(type)).toBe(true)
    }
  })

  it("does NOT contain zero-cost processing nodes", () => {
    const processingTypes = [
      "combine-videos",
      "trim-video",
      "merge-video-audio",
      "trim-audio",
      "add-captions",
      "composite",
    ]
    for (const type of processingTypes) {
      expect(GENERATE_BUTTON_TYPES.has(type)).toBe(false)
    }
  })

  it("contains at least 40 node types", () => {
    expect(GENERATE_BUTTON_TYPES.size).toBeGreaterThanOrEqual(40)
  })
})

describe("RUN_BUTTON_TYPES", () => {
  it("is a Set", () => {
    expect(RUN_BUTTON_TYPES).toBeInstanceOf(Set)
  })

  it("contains core processing nodes", () => {
    const expected = [
      "combine-videos",
      "trim-video",
      "merge-video-audio",
      "trim-audio",
      "mix-audio",
      "add-captions",
      "composite",
    ]
    for (const type of expected) {
      expect(RUN_BUTTON_TYPES.has(type)).toBe(true)
    }
  })

  it("does NOT contain auto-execute nodes (they use Run From Here)", () => {
    for (const type of RUN_FROM_HERE_TYPES) {
      expect(RUN_BUTTON_TYPES.has(type)).toBe(false)
    }
  })

  it("does NOT contain AI or credit-costing nodes", () => {
    const nonRunTypes = [
      "generate-image",
      "llm-chat",
      "text-to-speech",
      "image-to-video",
      "text-to-video",
      "render-video",
      "instagram-post",
    ]
    for (const type of nonRunTypes) {
      expect(RUN_BUTTON_TYPES.has(type)).toBe(false)
    }
  })
})

describe("GENERATE_BUTTON_TYPES and RUN_BUTTON_TYPES", () => {
  it("have no overlap", () => {
    const overlap: string[] = []
    for (const type of GENERATE_BUTTON_TYPES) {
      if (RUN_BUTTON_TYPES.has(type)) {
        overlap.push(type)
      }
    }
    expect(overlap).toEqual([])
  })
})
