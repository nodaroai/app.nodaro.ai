import { describe, it, expect } from "vitest"

import {
  getKieModelConfig,
  isKieSupported,
  getKieCost,
  getAllowedDurations,
  supportsEndFrame,
  getEndFrameParam,
  KIE_IMAGE_MODELS,
  KIE_MOTION_TRANSFER_MODELS,
  KIE_SPEECH_TO_VIDEO_MODELS,
} from "../models.js"

describe("getKieModelConfig", () => {
  it("returns config for image model nano-banana", () => {
    const config = getKieModelConfig("image", "nano-banana")
    expect(config).not.toBeNull()
    expect(config!.model).toBe("nano-banana-pro")
    expect(config!.credits).toBe(4)
    expect(config!.cost).toBe(0.02)
  })

  it("returns config for video model veo3", () => {
    const config = getKieModelConfig("video", "veo3")
    expect(config).not.toBeNull()
    expect(config!.model).toBe("veo3")
    expect(config!.credits).toBe(250)
    expect(config!.cost).toBe(1.25)
    expect(config!.allowedDurations).toEqual([4, 6, 8])
  })

  it("returns config for tts model elevenlabs-turbo", () => {
    const config = getKieModelConfig("tts", "elevenlabs-turbo")
    expect(config).not.toBeNull()
    expect(config!.model).toBe("elevenlabs/text-to-speech-turbo-2-5")
    expect(config!.credits).toBe(6)
  })

  it("returns null for unknown category/provider", () => {
    expect(getKieModelConfig("image", "nonexistent-model")).toBeNull()
    expect(getKieModelConfig("video", "nonexistent-model")).toBeNull()
    expect(getKieModelConfig("tts", "nonexistent-model")).toBeNull()
    // @ts-expect-error -- testing invalid category at runtime
    expect(getKieModelConfig("bogus-category", "nano-banana")).toBeNull()
  })
})

describe("isKieSupported", () => {
  it("returns true for a known model", () => {
    expect(isKieSupported("image", "nano-banana")).toBe(true)
    expect(isKieSupported("video", "kling")).toBe(true)
    expect(isKieSupported("music", "suno")).toBe(true)
  })

  it("returns false for an unknown model", () => {
    expect(isKieSupported("image", "nonexistent")).toBe(false)
    expect(isKieSupported("video", "nonexistent")).toBe(false)
    expect(isKieSupported("tts", "nonexistent")).toBe(false)
  })
})

describe("getKieCost", () => {
  it("returns cost for a known model", () => {
    expect(getKieCost("image", "nano-banana")).toBe(0.02)
    expect(getKieCost("video", "veo3")).toBe(1.25)
    expect(getKieCost("music", "suno")).toBe(0.06)
  })

  it("returns 0 for an unknown model", () => {
    expect(getKieCost("image", "nonexistent")).toBe(0)
    expect(getKieCost("video", "nonexistent")).toBe(0)
  })
})

describe("getAllowedDurations", () => {
  it("returns [5, 10] for kling video", () => {
    expect(getAllowedDurations("video", "kling")).toEqual([5, 10])
  })

  it("returns [4, 6, 8] for veo3 video", () => {
    expect(getAllowedDurations("video", "veo3")).toEqual([4, 6, 8])
  })
})

describe("supportsEndFrame", () => {
  it("returns true for minimax and veo3, false for kling and grok-i2v", () => {
    expect(supportsEndFrame("video", "minimax")).toBe(true)
    expect(supportsEndFrame("video", "veo3")).toBe(true)
    expect(supportsEndFrame("video", "veo3.1")).toBe(true)
    expect(supportsEndFrame("video", "kling")).toBe(false)
    expect(supportsEndFrame("video", "grok-i2v")).toBe(false)
  })
})

describe("getEndFrameParam", () => {
  it("returns correct param name per model, or undefined for array-format models", () => {
    expect(getEndFrameParam("video", "minimax")).toBe("end_image_url")
    expect(getEndFrameParam("video", "kling-turbo")).toBe("tail_image_url")
    // veo3 uses imageUrls array format -- no separate endFrameParam
    expect(getEndFrameParam("video", "veo3")).toBeUndefined()
  })
})

describe("KIE_IMAGE_MODELS — ideogram-v3", () => {
  it("exists with correct model ID", () => {
    const config = KIE_IMAGE_MODELS["ideogram-v3"]
    expect(config).toBeDefined()
    expect(config.model).toBe("ideogram/v3-text-to-image")
  })

  it("is accessible via getKieModelConfig", () => {
    const config = getKieModelConfig("image", "ideogram-v3")
    expect(config).not.toBeNull()
    expect(config!.model).toBe("ideogram/v3-text-to-image")
  })
})

describe("KIE_MOTION_TRANSFER_MODELS — kling-3.0", () => {
  it("exists with correct model ID", () => {
    const config = KIE_MOTION_TRANSFER_MODELS["kling-3.0"]
    expect(config).toBeDefined()
    expect(config.model).toBe("kling-3.0/motion-control")
  })

  it("is accessible via getKieModelConfig", () => {
    const config = getKieModelConfig("motion-transfer", "kling-3.0")
    expect(config).not.toBeNull()
    expect(config!.model).toBe("kling-3.0/motion-control")
  })
})

describe("KIE_SPEECH_TO_VIDEO_MODELS — wan-s2v", () => {
  it("exists with correct model ID", () => {
    const config = KIE_SPEECH_TO_VIDEO_MODELS["wan-s2v"]
    expect(config).toBeDefined()
    expect(config.model).toBe("wan/2-2-a14b-speech-to-video-turbo")
  })

  it("is accessible via getKieModelConfig", () => {
    const config = getKieModelConfig("speech-to-video", "wan-s2v")
    expect(config).not.toBeNull()
    expect(config!.model).toBe("wan/2-2-a14b-speech-to-video-turbo")
  })
})

