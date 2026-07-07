import { describe, it, expect } from "vitest"
import {
  SUBSCRIPTION_TIERS,
  TOPUP_PACKAGES,
  FFMPEG_NODES,
  CATEGORY_LABELS,
  CATEGORY_COLORS,
  detectCategory,
} from "../pricing-data"
import type { DBCategory } from "../pricing-data"

describe("SUBSCRIPTION_TIERS", () => {
  it("has exactly 5 tiers", () => {
    expect(SUBSCRIPTION_TIERS).toHaveLength(5)
  })

  it("tiers are Free, Basic, Standard, Pro, Business", () => {
    expect(SUBSCRIPTION_TIERS.map((t) => t.name)).toEqual([
      "Free", "Basic", "Standard", "Pro", "Business",
    ])
  })

  it("every tier has required fields", () => {
    for (const tier of SUBSCRIPTION_TIERS) {
      expect(tier.name).toBeTruthy()
      expect(typeof tier.priceMonthly).toBe("number")
      expect(typeof tier.priceAnnual).toBe("number")
      expect(typeof tier.credits).toBe("number")
      expect(tier.llmRequests).toBeTruthy()
    }
  })

  it("free tier has zero prices", () => {
    expect(SUBSCRIPTION_TIERS[0].priceMonthly).toBe(0)
    expect(SUBSCRIPTION_TIERS[0].priceAnnual).toBe(0)
  })

  it("credits increase with tier level", () => {
    for (let i = 1; i < SUBSCRIPTION_TIERS.length; i++) {
      expect(SUBSCRIPTION_TIERS[i].credits).toBeGreaterThan(SUBSCRIPTION_TIERS[i - 1].credits)
    }
  })

  it("business tier has unlimited LLM requests", () => {
    expect(SUBSCRIPTION_TIERS[4].llmRequests).toBe("Unlimited")
  })
})

describe("TOPUP_PACKAGES", () => {
  it("has exactly 4 packages", () => {
    expect(TOPUP_PACKAGES).toHaveLength(4)
  })

  it("credits increase with price", () => {
    for (let i = 1; i < TOPUP_PACKAGES.length; i++) {
      expect(TOPUP_PACKAGES[i].credits).toBeGreaterThan(TOPUP_PACKAGES[i - 1].credits)
      expect(TOPUP_PACKAGES[i].price).toBeGreaterThan(TOPUP_PACKAGES[i - 1].price)
    }
  })
})

describe("FFMPEG_NODES", () => {
  it("has at least 5 nodes", () => {
    expect(FFMPEG_NODES.length).toBeGreaterThanOrEqual(5)
  })

  it("every node has name and description", () => {
    for (const node of FFMPEG_NODES) {
      expect(node.name).toBeTruthy()
      expect(node.description).toBeTruthy()
    }
  })
})

describe("detectCategory", () => {
  it("detects image models", () => {
    expect(detectCategory("nano-banana")).toBe("image")
    expect(detectCategory("flux-pro")).toBe("image")
    expect(detectCategory("gpt-image")).toBe("image")
    expect(detectCategory("grok")).toBe("image")
  })

  it("detects video models", () => {
    expect(detectCategory("veo3")).toBe("video")
    expect(detectCategory("kling-3.0")).toBe("video")
    expect(detectCategory("minimax")).toBe("video")
    expect(detectCategory("runway")).toBe("video")
  })

  it("detects audio models", () => {
    expect(detectCategory("suno-generate")).toBe("audio")
    expect(detectCategory("elevenlabs-turbo")).toBe("audio")
  })

  it("detects processing models", () => {
    expect(detectCategory("ffmpeg")).toBe("processing")
    expect(detectCategory("topaz")).toBe("processing")
  })

  it("returns 'other' for unknown models", () => {
    expect(detectCategory("unknown-model")).toBe("other")
    expect(detectCategory("")).toBe("other")
  })

  it("is case-insensitive", () => {
    expect(detectCategory("FLUX-PRO")).toBe("image")
    expect(detectCategory("VEO3")).toBe("video")
    expect(detectCategory("SUNO")).toBe("audio")
  })
})

describe("CATEGORY_LABELS", () => {
  it("has labels for all 5 categories", () => {
    const categories: DBCategory[] = ["image", "video", "audio", "processing", "other"]
    for (const cat of categories) {
      expect(CATEGORY_LABELS[cat]).toBeTruthy()
    }
  })
})

describe("CATEGORY_COLORS", () => {
  it("has colors for all 5 categories", () => {
    const categories: DBCategory[] = ["image", "video", "audio", "processing", "other"]
    for (const cat of categories) {
      expect(CATEGORY_COLORS[cat]).toMatch(/^text-/)
    }
  })
})

describe("detectCategory — new models", () => {
  it("detects speech-to-video as video", () => {
    expect(detectCategory("speech-to-video")).toBe("video")
  })

  it("detects suno-mashup as audio", () => {
    expect(detectCategory("suno-mashup")).toBe("audio")
  })

  it("detects ideogram-v3 as image", () => {
    expect(detectCategory("ideogram-v3")).toBe("image")
  })

  it("detects topaz-image-upscale as image", () => {
    expect(detectCategory("topaz-image-upscale")).toBe("image")
  })
})
