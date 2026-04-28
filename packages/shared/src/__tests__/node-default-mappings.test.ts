import { describe, it, expect } from "vitest"
import {
  NODE_DEFAULT_TYPES,
  mapQuality,
  mapAspectRatio,
  supportedDefaultDimensions,
  deriveLinkedFields,
  validateProviderForNodeType,
  getTargetField,
  getValidValues,
} from "../node-default-mappings.js"

describe("supportedDefaultDimensions", () => {
  it("image gen has both quality and aspect", () => {
    expect(supportedDefaultDimensions("generate-image")).toEqual({
      quality: true,
      aspectRatio: true,
    })
  })

  it("video gen has both quality and aspect", () => {
    expect(supportedDefaultDimensions("text-to-video")).toEqual({
      quality: true,
      aspectRatio: true,
    })
  })

  it("LLM nodes have neither", () => {
    expect(supportedDefaultDimensions("ai-writer")).toEqual({
      quality: false,
      aspectRatio: false,
    })
  })

  it("audio nodes have neither", () => {
    expect(supportedDefaultDimensions("text-to-speech")).toEqual({
      quality: false,
      aspectRatio: false,
    })
    expect(supportedDefaultDimensions("voice-design")).toEqual({
      quality: false,
      aspectRatio: false,
    })
  })

  it("lip-sync has neither", () => {
    expect(supportedDefaultDimensions("lip-sync")).toEqual({
      quality: false,
      aspectRatio: false,
    })
  })
})

describe("mapQuality", () => {
  it("maps nano-banana-pro 3 levels onto resolution", () => {
    expect(mapQuality("nano-banana-pro", "low")).toEqual({ field: "resolution", value: "1K" })
    expect(mapQuality("nano-banana-pro", "mid")).toEqual({ field: "resolution", value: "2K" })
    expect(mapQuality("nano-banana-pro", "high")).toEqual({ field: "resolution", value: "4K" })
  })

  it("collapses gpt-image low to medium on the quality field", () => {
    expect(mapQuality("gpt-image", "low")).toEqual({ field: "quality", value: "medium" })
    expect(mapQuality("gpt-image", "mid")).toEqual({ field: "quality", value: "medium" })
    expect(mapQuality("gpt-image", "high")).toEqual({ field: "quality", value: "high" })
  })

  it("flux caps at 2K on the resolution field", () => {
    expect(mapQuality("flux", "low")).toEqual({ field: "resolution", value: "1K" })
    expect(mapQuality("flux", "mid")).toEqual({ field: "resolution", value: "2K" })
    expect(mapQuality("flux", "high")).toEqual({ field: "resolution", value: "2K" })
  })

  it("gpt-image-2 maps to resolution (NOT quality) — its config panel uses 1K/2K/4K", () => {
    expect(mapQuality("gpt-image-2", "low")).toEqual({ field: "resolution", value: "1K" })
    expect(mapQuality("gpt-image-2", "mid")).toEqual({ field: "resolution", value: "2K" })
    expect(mapQuality("gpt-image-2", "high")).toEqual({ field: "resolution", value: "4K" })
  })

  it("seedream uses basic/high on the quality field", () => {
    expect(mapQuality("seedream", "low")).toEqual({ field: "quality", value: "basic" })
    expect(mapQuality("seedream", "mid")).toEqual({ field: "quality", value: "basic" })
    expect(mapQuality("seedream", "high")).toEqual({ field: "quality", value: "high" })
  })

  it("returns undefined for providers not in the map", () => {
    expect(mapQuality("not-a-real-provider", "high")).toBeUndefined()
  })
})

describe("mapAspectRatio", () => {
  it("auto returns undefined (caller omits the field)", () => {
    expect(mapAspectRatio("nano-banana-pro", "auto")).toBeUndefined()
  })

  it("16:9 passes through for known providers", () => {
    expect(mapAspectRatio("nano-banana-pro", "16:9")).toBe("16:9")
    expect(mapAspectRatio("kling", "16:9")).toBe("16:9")
  })

  it("returns the same value even for unknown providers (no fallback yet)", () => {
    expect(mapAspectRatio("unknown", "1:1")).toBe("1:1")
  })
})

describe("deriveLinkedFields", () => {
  it("derives model for generate-image with nano-banana-pro", () => {
    expect(deriveLinkedFields("generate-image", "nano-banana-pro")).toEqual({
      model: "gemini-2.5-flash-image",
    })
  })

  it("returns empty for unmapped providers", () => {
    expect(deriveLinkedFields("generate-image", "flux")).toEqual({})
  })

  it("returns empty for nodes without linked fields", () => {
    expect(deriveLinkedFields("ai-writer", "claude-sonnet-4.6")).toEqual({})
    expect(deriveLinkedFields("text-to-video", "kling")).toEqual({})
  })
})

describe("validateProviderForNodeType", () => {
  it("accepts valid image gen provider", () => {
    expect(validateProviderForNodeType("generate-image", "nano-banana-pro")).toBeNull()
    expect(validateProviderForNodeType("generate-image", "flux")).toBeNull()
  })

  it("rejects invalid image gen provider", () => {
    expect(validateProviderForNodeType("generate-image", "fake-provider")).toMatch(/not valid/)
  })

  it("accepts valid LLM model", () => {
    expect(validateProviderForNodeType("ai-writer", "claude-sonnet-4.6")).toBeNull()
  })

  it("rejects invalid LLM model", () => {
    expect(validateProviderForNodeType("ai-writer", "fake-model")).toMatch(/not valid/)
  })

  it("accepts both suno and minimax for music", () => {
    expect(validateProviderForNodeType("generate-music", "suno")).toBeNull()
    expect(validateProviderForNodeType("generate-music", "minimax")).toBeNull()
  })
})

describe("getTargetField", () => {
  it("image/video/audio/lip-sync use provider field", () => {
    expect(getTargetField("generate-image")).toBe("provider")
    expect(getTargetField("text-to-video")).toBe("provider")
    expect(getTargetField("text-to-speech")).toBe("provider")
    expect(getTargetField("lip-sync")).toBe("provider")
  })

  it("LLM nodes and voice-design use model field", () => {
    expect(getTargetField("ai-writer")).toBe("model")
    expect(getTargetField("voice-design")).toBe("model")
  })
})

describe("registry coverage", () => {
  it("every NODE_DEFAULT_TYPE has a registry entry", () => {
    for (const t of NODE_DEFAULT_TYPES) {
      expect(getValidValues(t).length).toBeGreaterThan(0)
    }
  })
})
