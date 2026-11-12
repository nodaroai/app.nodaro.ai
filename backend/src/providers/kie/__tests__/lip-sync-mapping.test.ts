import { describe, it, expect } from "vitest"
import { buildLipSyncInput } from "../video.js"
import { KIE_LIP_SYNC_MODELS } from "../models.js"

// OmniHuman 1.5 has distinct KIE param names vs the other avatars:
// output_resolution ("720"|"1080") + pe_fast_mode + seed. The generic
// buildLipSyncInput must map them from config, and must NOT leak those onto
// providers (kling-avatar) that don't declare the mapping fields.
describe("buildLipSyncInput — omnihuman-1-5 param mapping", () => {
  const omni = KIE_LIP_SYNC_MODELS["omnihuman-1-5"]
  const kling = KIE_LIP_SYNC_MODELS["kling-avatar"]

  it("maps 1080p → output_resolution '1080' and emits no bare resolution", () => {
    const input = buildLipSyncInput(omni, { imageUrl: "i", audioUrl: "a", resolution: "1080p" })
    expect(input.output_resolution).toBe("1080")
    expect(input.resolution).toBeUndefined()
  })

  it("maps 720p and 480p both → '720'", () => {
    expect(buildLipSyncInput(omni, { imageUrl: "i", audioUrl: "a", resolution: "720p" }).output_resolution).toBe("720")
    expect(buildLipSyncInput(omni, { imageUrl: "i", audioUrl: "a", resolution: "480p" }).output_resolution).toBe("720")
  })

  it("defaults to '1080' when no resolution is supplied", () => {
    expect(buildLipSyncInput(omni, { imageUrl: "i", audioUrl: "a" }).output_resolution).toBe("1080")
  })

  it("emits pe_fast_mode + seed from options", () => {
    const input = buildLipSyncInput(omni, { imageUrl: "i", audioUrl: "a", options: { fastMode: true, seed: 42 } })
    expect(input.pe_fast_mode).toBe(true)
    expect(input.seed).toBe(42)
  })

  it("omits seed when negative (random)", () => {
    const input = buildLipSyncInput(omni, { imageUrl: "i", audioUrl: "a", options: { seed: -1 } })
    expect(input.seed).toBeUndefined()
  })

  it("always sets a prompt (default or provided)", () => {
    expect(buildLipSyncInput(omni, { imageUrl: "i", audioUrl: "a" }).prompt).toBe("A person speaking naturally")
    expect(buildLipSyncInput(omni, { imageUrl: "i", audioUrl: "a", prompt: "sing confidently" }).prompt).toBe("sing confidently")
  })

  it("leaves kling-avatar untouched — bare resolution, no output_resolution/pe_fast_mode/seed", () => {
    const input = buildLipSyncInput(kling, {
      imageUrl: "i",
      audioUrl: "a",
      resolution: "720p",
      options: { fastMode: true, seed: 1 },
    })
    expect(input.resolution).toBe("720p")
    expect(input.output_resolution).toBeUndefined()
    expect(input.pe_fast_mode).toBeUndefined()
    expect(input.seed).toBeUndefined()
  })
})

// OmniHuman 2.0 (KIE `omnihuman-2-0`, schema read 2026-11-11): exactly four
// keys — `image_urls` (ONE image, as a one-element array), `audio_url`,
// `prompt` (≤ 300 chars), `enable_watermark` (TRUE upstream by default, so
// always sent false). None of 1.5's levers ever reaches it.
describe("buildLipSyncInput — omnihuman-2-0 body", () => {
  const omni2 = KIE_LIP_SYNC_MODELS["omnihuman-2-0"]
  const omni15 = KIE_LIP_SYNC_MODELS["omnihuman-1-5"]

  it("sends exactly the four keys, the image as a one-element array, the watermark off", () => {
    const input = buildLipSyncInput(omni2, { imageUrl: "https://m.test/face.png", audioUrl: "https://m.test/voice.mp3", prompt: "a museum guide" })
    expect(input).toEqual({
      image_urls: ["https://m.test/face.png"],
      audio_url: "https://m.test/voice.mp3",
      prompt: "a museum guide",
      enable_watermark: false,
    })
    expect(omni2.model).toBe("omnihuman-2-0")
  })

  it("drops a resolution, fast mode or seed a node kept from 1.5", () => {
    const input = buildLipSyncInput(omni2, {
      imageUrl: "i",
      audioUrl: "a",
      resolution: "1080p",
      options: { fastMode: true, seed: 42 },
    })
    expect(Object.keys(input).sort()).toEqual(["audio_url", "enable_watermark", "image_urls", "prompt"])
  })

  it("cuts a prompt past 300 characters to its first 300 (code points), never sends it whole", () => {
    expect(omni2.maxPromptChars).toBe(300)
    const long = "é".repeat(299) + "🙂🙂"
    const prompt = buildLipSyncInput(omni2, { imageUrl: "i", audioUrl: "a", prompt: long }).prompt as string
    expect(Array.from(prompt)).toHaveLength(300)
    expect(prompt.endsWith("🙂")).toBe(true)
  })

  it("leaves 1.5's body as it was: a string image_url, its levers, no watermark key", () => {
    const input = buildLipSyncInput(omni15, { imageUrl: "i", audioUrl: "a", resolution: "1080p", options: { fastMode: true, seed: 3 } })
    expect(input).toEqual({ image_url: "i", audio_url: "a", prompt: "A person speaking naturally", output_resolution: "1080", pe_fast_mode: true, seed: 3 })
  })
})
