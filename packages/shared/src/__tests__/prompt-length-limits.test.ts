import { describe, it, expect } from "vitest"
import {
  IMAGE_PROMPT_MAX,
  VIDEO_PROMPT_MAX,
  PROMPT_HARD_CEILING,
  NEGATIVE_PROMPT_MAX,
  TTS_TEXT_MAX,
  SUNO_TITLE_MAX,
  MAX_IMAGE_PROMPT_CHARS_BY_PROVIDER,
  MAX_VIDEO_PROMPT_CHARS_BY_PROVIDER,
  MAX_NEGATIVE_PROMPT_CHARS_BY_PROVIDER,
  MAX_TTS_CHARS_BY_PROVIDER,
  getMaxImagePromptChars,
  getMaxVideoPromptChars,
  getMaxNegativePromptChars,
  getMaxTtsChars,
  getMaxSunoPromptChars,
  getMaxSunoStyleChars,
  IMAGE_GEN_PROVIDERS,
  IMAGE_I2I_PROVIDERS,
  IMAGE_EDIT_PROVIDERS,
  VIDEO_GEN_PROVIDERS,
  VIDEO_TO_VIDEO_PROVIDERS,
  EXTEND_VIDEO_PROVIDERS,
} from "../model-constants.js"

describe("per-model prompt length limits", () => {
  describe("getMaxImagePromptChars", () => {
    it("returns the verified higher caps (provider supports more than 5000)", () => {
      expect(getMaxImagePromptChars("nano-banana-2")).toBe(20000)
      expect(getMaxImagePromptChars("nano-banana-2-lite")).toBe(20000)
      expect(getMaxImagePromptChars("nano-banana-pro")).toBe(20000)
      expect(getMaxImagePromptChars("gpt-image-2-i2i")).toBe(20000)
    })
    it("returns the verified LOWER caps (over-send risk if left at 5000)", () => {
      expect(getMaxImagePromptChars("seedream")).toBe(3000)
      expect(getMaxImagePromptChars("seedream-5-lite")).toBe(1000)
      expect(getMaxImagePromptChars("qwen")).toBe(3000)
      expect(getMaxImagePromptChars("qwen-edit")).toBe(2000)
    })
    it("siblings differ — does not copy the t2i number to i2i/edit", () => {
      // seedream t2i 3000, 5-lite t2i 1000 but its i2i is 3000
      expect(getMaxImagePromptChars("seedream-5-lite-i2i")).toBe(3000)
    })
    it("falls back to IMAGE_PROMPT_MAX for verified-default + unknown providers", () => {
      expect(getMaxImagePromptChars("flux")).toBe(IMAGE_PROMPT_MAX)
      expect(getMaxImagePromptChars("imagen4")).toBe(IMAGE_PROMPT_MAX)
      expect(getMaxImagePromptChars("seedream-5-pro")).toBe(IMAGE_PROMPT_MAX) // verified 5000 in KIE schema
      expect(getMaxImagePromptChars("seedream-5-pro-i2i")).toBe(IMAGE_PROMPT_MAX) // verified 5000 in KIE schema
      expect(getMaxImagePromptChars("grok-i2i")).toBe(IMAGE_PROMPT_MAX) // 390000 doc = sanity-capped
      expect(getMaxImagePromptChars("flux-kontext")).toBe(IMAGE_PROMPT_MAX) // UNVERIFIED
      expect(getMaxImagePromptChars(undefined)).toBe(IMAGE_PROMPT_MAX)
      expect(getMaxImagePromptChars("totally-made-up")).toBe(IMAGE_PROMPT_MAX)
    })
  })

  describe("getMaxVideoPromptChars", () => {
    it("returns verified per-model caps (mostly far below the old flat 8000)", () => {
      expect(getMaxVideoPromptChars("kling")).toBe(1000)
      expect(getMaxVideoPromptChars("kling-turbo")).toBe(2500)
      expect(getMaxVideoPromptChars("kling-master")).toBe(5000)
      expect(getMaxVideoPromptChars("minimax")).toBe(1500)
      expect(getMaxVideoPromptChars("runway-kie")).toBe(1800)
      expect(getMaxVideoPromptChars("grok-imagine-video-1.5")).toBe(4096)
    })
    it("returns verified higher caps", () => {
      expect(getMaxVideoPromptChars("seedance-2")).toBe(20000)
      expect(getMaxVideoPromptChars("gemini-omni-video")).toBe(20000)
      expect(getMaxVideoPromptChars("bytedance-pro")).toBe(10000)
    })
    it("falls back to VIDEO_PROMPT_MAX for UNVERIFIED + unknown providers", () => {
      expect(getMaxVideoPromptChars("veo3")).toBe(VIDEO_PROMPT_MAX) // no limit in schema
      expect(getMaxVideoPromptChars("kling-3.0")).toBe(VIDEO_PROMPT_MAX)
      expect(getMaxVideoPromptChars(undefined)).toBe(VIDEO_PROMPT_MAX)
    })
  })

  describe("getMaxNegativePromptChars", () => {
    it("returns verified native negative caps", () => {
      expect(getMaxNegativePromptChars("ideogram-v3")).toBe(500)
      expect(getMaxNegativePromptChars("qwen")).toBe(500)
      expect(getMaxNegativePromptChars("kling-master")).toBe(500)
      expect(getMaxNegativePromptChars("imagen4")).toBe(5000)
    })
    it("defaults to NEGATIVE_PROMPT_MAX otherwise", () => {
      expect(getMaxNegativePromptChars("flux")).toBe(NEGATIVE_PROMPT_MAX)
      expect(getMaxNegativePromptChars(undefined)).toBe(NEGATIVE_PROMPT_MAX)
    })
  })

  describe("getMaxTtsChars", () => {
    it("returns verified per-model TTS caps", () => {
      expect(getMaxTtsChars("elevenlabs-turbo")).toBe(40000)
      expect(getMaxTtsChars("elevenlabs-multilingual")).toBe(10000)
      expect(getMaxTtsChars("elevenlabs-v3")).toBe(3000) // conservative
      expect(getMaxTtsChars("elevenlabs-dialogue")).toBe(2000)
    })
    it("defaults to TTS_TEXT_MAX for the legacy/unknown provider", () => {
      expect(getMaxTtsChars("elevenlabs")).toBe(TTS_TEXT_MAX)
      expect(getMaxTtsChars(undefined)).toBe(TTS_TEXT_MAX)
    })
  })

  describe("Suno per-version caps", () => {
    it("prompt: 500 non-custom; 3000 V4 custom; 5000 V4.5+/V5 custom", () => {
      expect(getMaxSunoPromptChars("V4", false)).toBe(500)
      expect(getMaxSunoPromptChars("V5", false)).toBe(500)
      expect(getMaxSunoPromptChars("V4", true)).toBe(3000)
      expect(getMaxSunoPromptChars("V4_5", true)).toBe(5000)
      expect(getMaxSunoPromptChars("V5", true)).toBe(5000)
      expect(getMaxSunoPromptChars("V5_5", true)).toBe(5000)
    })
    it("style: 200 for V4, 1000 for V4.5+; title 80", () => {
      expect(getMaxSunoStyleChars("V4")).toBe(200)
      expect(getMaxSunoStyleChars("V5")).toBe(1000)
      expect(SUNO_TITLE_MAX).toBe(80)
    })
  })

  describe("drift guards (registry hygiene)", () => {
    const imageProviders = new Set<string>([
      ...IMAGE_GEN_PROVIDERS,
      ...IMAGE_I2I_PROVIDERS,
      ...IMAGE_EDIT_PROVIDERS,
    ])
    const videoProviders = new Set<string>([
      ...VIDEO_GEN_PROVIDERS,
      ...VIDEO_TO_VIDEO_PROVIDERS,
      ...EXTEND_VIDEO_PROVIDERS,
    ])

    it("every image-cap key is a real image provider id", () => {
      for (const key of Object.keys(MAX_IMAGE_PROMPT_CHARS_BY_PROVIDER)) {
        expect(imageProviders.has(key), `${key} is not a known image provider`).toBe(true)
      }
    })
    it("every video-cap key is a real video provider id", () => {
      for (const key of Object.keys(MAX_VIDEO_PROMPT_CHARS_BY_PROVIDER)) {
        expect(videoProviders.has(key), `${key} is not a known video provider`).toBe(true)
      }
    })
    it("all caps are positive integers within the hard ceiling", () => {
      const all = [
        ...Object.values(MAX_IMAGE_PROMPT_CHARS_BY_PROVIDER),
        ...Object.values(MAX_VIDEO_PROMPT_CHARS_BY_PROVIDER),
        ...Object.values(MAX_NEGATIVE_PROMPT_CHARS_BY_PROVIDER),
      ]
      for (const v of all) {
        expect(Number.isInteger(v) && v > 0).toBe(true)
        expect(v).toBeLessThanOrEqual(PROMPT_HARD_CEILING)
      }
    })
    it("TTS caps are positive integers (turbo may exceed the image/video ceiling)", () => {
      for (const v of Object.values(MAX_TTS_CHARS_BY_PROVIDER)) {
        expect(Number.isInteger(v) && v > 0).toBe(true)
      }
    })
  })
})
