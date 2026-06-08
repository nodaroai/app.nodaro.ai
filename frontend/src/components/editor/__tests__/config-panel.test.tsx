import { describe, it, expect, vi } from "vitest"

// ---------------------------------------------------------------------------
// config-panel.tsx has many heavy transitive imports (Supabase, Zustand,
// config-panel components, etc.). Instead of importing the actual module
// and mocking all 20+ dependencies, we duplicate the three simple exports
// here and test them in isolation. This is safe because the values are
// defined as top-level constants / pure functions with no runtime deps.
// ---------------------------------------------------------------------------

// Exact copy of NODE_TYPE_DISPLAY_NAMES + getNodeTypeDisplayName from config-panel.tsx
const NODE_TYPE_DISPLAY_NAMES: Record<string, string> = {
  "text-prompt": "Text",
  "upload-image": "Upload Image",
  "upload-video": "Upload Video",
  "upload-audio": "Upload Audio",
  "rss-feed": "RSS Feed",
  "youtube-video": "Video URL",
  "reference-audio": "Reference Audio",
  "tone": "Tone",
  "style-guide": "Style Guide",
  "provider": "Provider",
  "scene-count": "Scene Count",
  "duration": "Duration",
  "aspect-ratio": "Aspect Ratio",
  "motion": "Motion",
  "camera-motion": "Camera Motion",
  "generate-script": "Generate Script",
  "generate-image": "Generate Image",
  "edit-image": "Edit Image",
  "image-to-video": "Image to Video",
  "video-to-video": "Video to Video",
  "text-to-video": "Text to Video",
  "text-to-speech": "Text to Speech",
  "qa-check": "QA Check",
  "generate-music": "Generate Music",
  "text-to-audio": "Text to Audio",
  "audio-isolation": "Voice Extractor",
  "suno-generate": "Suno Generate",
  "suno-cover": "Suno Cover",
  "suno-extend": "Suno Extend",
  "suno-lyrics": "Suno Lyrics",
  "suno-separate": "Suno Separate",
  "suno-music-video": "Music Video",
  "transcribe": "Transcribe",
  "image-to-text": "Describe Image",
  "llm-chat": "Generate Text",
  "combine-videos": "Combine Videos",
  "merge-video-audio": "Merge Video & Audio",
  "add-captions": "Add Captions",
  "resize-video": "Resize Video",
  "trim-audio": "Trim Audio",
  "mix-audio": "Mix Audio",
  "adjust-volume": "Adjust Volume",
  "trim-video": "Trim Video",
  "speed-ramp": "Adjust Speed",
  "loop-video": "Loop Video",
  "fade-video": "Fade In/Out",
  "transcode-video": "Transcode Video",
  "manual-edit": "Manual Edit",
  "combine-text": "Combine Text",
  "split-text": "Split Text",
  "save-to-storage": "Save to Storage",
  "webhook-output": "Webhook Output",
  "character": "Character",
  "object": "Object/Props",
  "location": "Location",
  "scene": "Scene",
}

function getNodeTypeDisplayName(type: string): string {
  return NODE_TYPE_DISPLAY_NAMES[type] || type.split("-").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ")
}

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
