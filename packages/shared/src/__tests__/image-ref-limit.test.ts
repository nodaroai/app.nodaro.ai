import { describe, expect, it } from "vitest"
import {
  imageReferenceLimit,
  MODELS_WITH_REFERENCE_IMAGE_SUPPORT,
  REF_IMAGE_MAX_LIMITS,
  DEFAULT_REF_IMAGE_MAX,
  T2I_TO_I2I_VARIANT,
} from "../model-constants.js"

describe("imageReferenceLimit", () => {
  // The exact models Studio's curated Framing menu exposes (platform brief).
  // Values mirror the platform's product cap (REF_IMAGE_MAX_LIMITS), resolved
  // through the T2I→i2i auto-route when the picked id is a text-to-image model.
  const EXPECTED: Record<string, number> = {
    "nano-banana-pro": 8,
    "flux-2-max": 8,
    "gpt-image-2": 16, // → gpt-image-2-i2i
    "seedream-5-lite": 16, // → seedream-5-lite-i2i
    "nano-banana-2": 4,
    flux: 4, // → flux-pro-i2i
    "flux-2-klein": 1, // product cap (schema array slices at 5)
    "flux-2-pro": 4, // product cap (BFL schema accepts 8)
    "flux-flex": 4, // → flux-i2i
    "flux-kontext": 1,
    "flux-kontext-max": 1,
    grok: 1, // → grok-i2i
    qwen: 1, // → qwen-i2i
    "wan-2.7": 9,
  }

  it.each(Object.entries(EXPECTED))(
    "%s advertises %i reference image(s)",
    (provider, cap) => {
      expect(imageReferenceLimit(provider)).toBe(cap)
    },
  )

  it("returns 0 for image models with no reference-image support", () => {
    for (const p of [
      "imagen4",
      "imagen4-fast",
      "imagen4-ultra",
      "ideogram-v3",
      "z-image",
    ]) {
      expect(imageReferenceLimit(p)).toBe(0)
    }
  })

  it("returns 0 for undefined / empty / unknown provider", () => {
    expect(imageReferenceLimit(undefined)).toBe(0)
    expect(imageReferenceLimit("")).toBe(0)
    expect(imageReferenceLimit("not-a-real-model")).toBe(0)
  })

  it("resolves every T2I provider to its auto-routed i2i sibling's cap", () => {
    // A T2I provider's advertised cap is its i2i sibling's cap (the endpoint
    // that actually consumes the references) — never the t2i id's own default.
    for (const [t2i, i2i] of Object.entries(T2I_TO_I2I_VARIANT)) {
      const expected = REF_IMAGE_MAX_LIMITS[i2i] ?? DEFAULT_REF_IMAGE_MAX
      expect(imageReferenceLimit(t2i)).toBe(expected)
    }
  })

  it("every reference-capable model advertises a positive cap", () => {
    for (const p of MODELS_WITH_REFERENCE_IMAGE_SUPPORT) {
      expect(imageReferenceLimit(p)).toBeGreaterThanOrEqual(1)
    }
  })

  it("`> 0` is an exact supports-references gate", () => {
    // Callers use `imageReferenceLimit(p) > 0` to show/hide the chip (mirrors
    // videoReferenceSupported). It must agree with the support set exactly.
    for (const p of MODELS_WITH_REFERENCE_IMAGE_SUPPORT) {
      expect(imageReferenceLimit(p) > 0).toBe(true)
    }
  })
})
