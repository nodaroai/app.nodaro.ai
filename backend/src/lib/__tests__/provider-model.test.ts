/**
 * `providerModelOf` / `providerIsItsModel`: which model a node's `provider`
 * runs, as a model restriction judges it (lib/provider-model.ts). Each answer
 * is read from the source the node's dispatch reads, never typed out here.
 */
import { describe, it, expect } from "vitest"
import { PROVIDER_MODEL_OF_NODE, providerIsItsModel, providerModelOf } from "../provider-model.js"
import { resolvedModelOfJob } from "../job-resolved-model.js"
import { llmFeatureDefault } from "../run-model.js"
import { MUSIC_PROVIDERS, MOTION_TRANSFER_PROVIDERS, SCRIPT_PROVIDERS, VIDEO_UPSCALE_PROVIDERS } from "@nodaro/shared/models"
import { SCRIPT_LEGACY_PROVIDER_MODELS } from "@nodaro/shared/llm-models"
import { MODEL_CATALOG } from "@nodaro/shared/model-catalog"

describe("an engine name is mapped to the model it runs", () => {
  it("Generate Music's engines run no catalog model (the catalog's minimax is a video model)", () => {
    expect(MODEL_CATALOG.minimax?.kind).toBe("video")
    for (const p of MUSIC_PROVIDERS) {
      expect(providerModelOf("generate-music", p)).toBeNull()
      expect(providerIsItsModel(["generate-music"], p)).toBe(false)
    }
  })

  it("Motion Transfer's options run what its handler runs", () => {
    for (const p of MOTION_TRANSFER_PROVIDERS) expect(providerModelOf("motion-transfer", p)).toBe(resolvedModelOfJob("motion-transfer", { provider: p }))
    expect(providerModelOf("motion-transfer", "kling")).toBe("motion-transfer")
    expect(providerIsItsModel(["motion-transfer"], "kling")).toBe(false)
  })

  it("Generate Script's legacy providers run the LLM the script resolves", () => {
    for (const p of SCRIPT_PROVIDERS) {
      expect(providerModelOf("generate-script", p)).toBe(SCRIPT_LEGACY_PROVIDER_MODELS[p])
      expect(providerModelOf("generate-script", p, { llmModel: "gpt-5.5" })).toBe("gpt-5.5")
    }
  })

  it("Video Upscale's Topaz is the catalog's topaz-video; its other options are their own ids", () => {
    for (const p of VIDEO_UPSCALE_PROVIDERS) expect(providerModelOf("video-upscale", p)).toBe(resolvedModelOfJob("video-upscale", { provider: p }))
    expect(providerModelOf("video-upscale", "topaz")).toBe("topaz-video")
  })

  it("Text to Speech's legacy elevenlabs runs as Turbo; a named model is itself", () => {
    expect(providerModelOf("text-to-speech", "elevenlabs")).toBe(resolvedModelOfJob("text-to-speech", { provider: "elevenlabs" }))
    expect(providerIsItsModel(["text-to-speech"], "elevenlabs-v4")).toBe(true)
  })

  it("QA Check's vendor alias names no model: it runs llmModel, else its feature default", () => {
    expect(providerModelOf("qa-check", "claude")).toBe(llmFeatureDefault("qa-check"))
    expect(providerModelOf("qa-check", "claude", { llmModel: "gpt-5.5" })).toBe("gpt-5.5")
  })

  it("a node type that names its model in provider is judged on it, as before", () => {
    expect(providerModelOf("generate-video", "seedance-2-fast")).toBe("seedance-2-fast")
    expect(providerIsItsModel(["generate-video"], "seedance-2-fast")).toBe(true)
    expect(Object.hasOwn(PROVIDER_MODEL_OF_NODE, "generate-video")).toBe(false)
  })
})
