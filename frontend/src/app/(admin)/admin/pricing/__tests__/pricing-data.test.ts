import { describe, it, expect } from "vitest"
import {
  SUBSCRIPTION_TIERS,
  TOPUP_PACKAGES,
  LLM_MODELS,
  FFMPEG_NODES,
  CATEGORY_LABELS,
  CATEGORY_COLORS,
  CREDIT_VALUE_USD,
  MODEL_REFERENCE,
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
      expect(typeof tier.estimatedCost).toBe("number")
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

describe("LLM_MODELS", () => {
  it("has at least 1 model", () => {
    expect(LLM_MODELS.length).toBeGreaterThanOrEqual(1)
  })

  it("every model has required fields", () => {
    for (const m of LLM_MODELS) {
      expect(m.model).toBeTruthy()
      expect(m.inputCost).toBeTruthy()
      expect(m.outputCost).toBeTruthy()
      expect(m.perRequest).toBeTruthy()
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
    expect(detectCategory("sora2-pro")).toBe("video")
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

describe("CREDIT_VALUE_USD", () => {
  it("is 0.02", () => {
    expect(CREDIT_VALUE_USD).toBe(0.02)
  })
})

describe("MODEL_REFERENCE", () => {
  it("has at least 20 models", () => {
    expect(Object.keys(MODEL_REFERENCE).length).toBeGreaterThanOrEqual(20)
  })

  it("every model has provider, providerCostUsd, and markupPct", () => {
    for (const [, ref] of Object.entries(MODEL_REFERENCE)) {
      expect(ref.provider).toBeTruthy()
      expect(typeof ref.markupPct).toBe("number")
      expect(ref.providerCostUsd === null || typeof ref.providerCostUsd === "number").toBe(true)
    }
  })

  it("self-hosted models have 0 markup", () => {
    expect(MODEL_REFERENCE["ffmpeg"].markupPct).toBe(0)
    expect(MODEL_REFERENCE["render-video"].markupPct).toBe(0)
  })

  it("KIE.ai video models have numeric providerCostUsd", () => {
    expect(typeof MODEL_REFERENCE["runway-kie"].providerCostUsd).toBe("number")
    expect(typeof MODEL_REFERENCE["runway-aleph"].providerCostUsd).toBe("number")
  })

  it("has ideogram-v3 entry", () => {
    expect(MODEL_REFERENCE["ideogram-v3"]).toBeDefined()
    expect(MODEL_REFERENCE["ideogram-v3"].provider).toBeTruthy()
  })

  it("has kling-3.0-motion entry", () => {
    expect(MODEL_REFERENCE["kling-3.0-motion"]).toBeDefined()
    expect(MODEL_REFERENCE["kling-3.0-motion"].provider).toBeTruthy()
  })

  it("has topaz-image-upscale entry", () => {
    expect(MODEL_REFERENCE["topaz-image-upscale"]).toBeDefined()
    expect(MODEL_REFERENCE["topaz-image-upscale"].provider).toBeTruthy()
  })

  it("has sora-watermark-remove entry", () => {
    expect(MODEL_REFERENCE["sora-watermark-remove"]).toBeDefined()
    expect(MODEL_REFERENCE["sora-watermark-remove"].provider).toBeTruthy()
  })

  it("has speech-to-video entry", () => {
    expect(MODEL_REFERENCE["speech-to-video"]).toBeDefined()
    expect(MODEL_REFERENCE["speech-to-video"].provider).toBeTruthy()
  })

  it("has sora-storyboard entry", () => {
    expect(MODEL_REFERENCE["sora-storyboard"]).toBeDefined()
    expect(MODEL_REFERENCE["sora-storyboard"].provider).toBeTruthy()
  })

  it("has suno-mashup entry", () => {
    expect(MODEL_REFERENCE["suno-mashup"]).toBeDefined()
    expect(MODEL_REFERENCE["suno-mashup"].provider).toBeTruthy()
  })

  it("has suno-replace-section entry", () => {
    expect(MODEL_REFERENCE["suno-replace-section"]).toBeDefined()
    expect(MODEL_REFERENCE["suno-replace-section"].provider).toBeTruthy()
  })

  it("has suno-style-boost entry", () => {
    expect(MODEL_REFERENCE["suno-style-boost"]).toBeDefined()
    expect(MODEL_REFERENCE["suno-style-boost"].provider).toBeTruthy()
  })

  it("has suno-add-instrumental entry", () => {
    expect(MODEL_REFERENCE["suno-add-instrumental"]).toBeDefined()
    expect(MODEL_REFERENCE["suno-add-instrumental"].provider).toBeTruthy()
  })

  it("has suno-add-vocals entry", () => {
    expect(MODEL_REFERENCE["suno-add-vocals"]).toBeDefined()
    expect(MODEL_REFERENCE["suno-add-vocals"].provider).toBeTruthy()
  })

  it("has suno-convert-wav entry", () => {
    expect(MODEL_REFERENCE["suno-convert-wav"]).toBeDefined()
    expect(MODEL_REFERENCE["suno-convert-wav"].provider).toBeTruthy()
  })

  it("has suno-upload-extend entry", () => {
    expect(MODEL_REFERENCE["suno-upload-extend"]).toBeDefined()
    expect(MODEL_REFERENCE["suno-upload-extend"].provider).toBeTruthy()
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
