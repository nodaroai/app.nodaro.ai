import { describe, it, expect } from "vitest"
import {
  PROVIDERS_CONFIG,
  getProviders,
  getProviderLabel,
  getModels,
  getFirstProvider,
  getFirstModel,
} from "../providers-config"
import type { ProviderCategory } from "../providers-config"

describe("PROVIDERS_CONFIG", () => {
  it("has exactly 4 categories", () => {
    expect(Object.keys(PROVIDERS_CONFIG)).toHaveLength(4)
  })

  it("has image, video, voice, script categories", () => {
    expect(Object.keys(PROVIDERS_CONFIG).sort()).toEqual(
      ["image", "script", "video", "voice"]
    )
  })

  it("image category has providers", () => {
    expect(Object.keys(PROVIDERS_CONFIG.image).length).toBeGreaterThan(0)
  })

  it("video category has providers", () => {
    expect(Object.keys(PROVIDERS_CONFIG.video).length).toBeGreaterThan(0)
  })

  it("voice category has providers", () => {
    expect(Object.keys(PROVIDERS_CONFIG.voice).length).toBeGreaterThan(0)
  })

  it("script category has providers", () => {
    expect(Object.keys(PROVIDERS_CONFIG.script).length).toBeGreaterThan(0)
  })

  it("every provider has a label and at least one model", () => {
    for (const category of Object.values(PROVIDERS_CONFIG)) {
      for (const [, info] of Object.entries(category)) {
        expect(info.label).toBeTruthy()
        expect(info.models.length).toBeGreaterThan(0)
      }
    }
  })
})

describe("getProviders", () => {
  it("returns provider keys for image category", () => {
    const providers = getProviders("image")
    expect(providers.length).toBeGreaterThan(0)
    expect(providers).toContain("flux")
    expect(providers).toContain("dalle")
  })

  it("returns provider keys for video category", () => {
    const providers = getProviders("video")
    expect(providers).toContain("kling")
    expect(providers).toContain("runway")
  })

  it("returns provider keys for voice category", () => {
    const providers = getProviders("voice")
    expect(providers.length).toBeGreaterThan(0)
  })

  it("returns provider keys for script category", () => {
    const providers = getProviders("script")
    expect(providers).toContain("claude")
    expect(providers).toContain("gpt")
  })
})

describe("getProviderLabel", () => {
  it("returns label for a known provider", () => {
    expect(getProviderLabel("image", "flux")).toBe("Flux")
  })

  it("returns label for dalle", () => {
    expect(getProviderLabel("image", "dalle")).toBe("DALL-E")
  })

  it("returns the provider key as fallback for unknown provider", () => {
    expect(getProviderLabel("image", "unknown-provider")).toBe("unknown-provider")
  })
})

describe("getModels", () => {
  it("returns models for a known provider", () => {
    const models = getModels("image", "flux")
    expect(models).toContain("flux-pro")
    expect(models).toContain("flux-dev")
  })

  it("returns empty array for unknown provider", () => {
    expect(getModels("image", "nonexistent")).toEqual([])
  })

  it("returns models for video kling provider", () => {
    const models = getModels("video", "kling")
    expect(models.length).toBeGreaterThan(0)
  })
})

describe("getFirstProvider", () => {
  it("returns first provider for image", () => {
    const first = getFirstProvider("image")
    expect(first).toBe(Object.keys(PROVIDERS_CONFIG.image)[0])
  })

  it("returns a non-empty string for all categories", () => {
    const categories: ProviderCategory[] = ["image", "video", "voice", "script"]
    for (const cat of categories) {
      expect(getFirstProvider(cat)).toBeTruthy()
    }
  })
})

describe("getFirstModel", () => {
  it("returns first model for a known provider", () => {
    const firstProvider = getFirstProvider("image")
    const firstModel = getFirstModel("image", firstProvider)
    expect(firstModel).toBe(PROVIDERS_CONFIG.image[firstProvider].models[0])
  })

  it("returns empty string for unknown provider", () => {
    expect(getFirstModel("image", "nonexistent")).toBe("")
  })
})
