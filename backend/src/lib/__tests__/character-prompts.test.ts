import { describe, it, expect } from "vitest"
import {
  buildPortraitPrompt,
  buildAssetPromptText,
  buildMotionPromptText,
  PORTRAIT_SCAFFOLDING,
  ASSET_STILL_SCAFFOLDING,
  ASSET_MOTION_SCAFFOLDING,
} from "../character-prompts.js"

describe("buildPortraitPrompt", () => {
  it("appends portrait scaffolding to the seed prompt", () => {
    const prompt = buildPortraitPrompt({ seedPrompt: "young woman, designer glasses, warm smile" })
    expect(prompt).toContain("young woman, designer glasses, warm smile")
    expect(prompt).toContain(PORTRAIT_SCAFFOLDING)
  })

  it("does NOT include canonical description even when provided", () => {
    // canonical_description is anchored to the OLD portrait — must not bias re-gens
    const prompt = buildPortraitPrompt({ seedPrompt: "young woman" })
    expect(prompt).not.toContain("canonical")
  })
})

describe("buildAssetPromptText", () => {
  it("composes canonical + asset + variant + scaffolding", () => {
    const prompt = buildAssetPromptText({
      canonicalDescription: "Kira: late 20s, Indian, dark hair, brown eyes, designer glasses, warm presence",
      assetDescription: "warm closed-mouth smile, slight eye crinkle",
      variantOrPrompt: "smile",
      assetType: "expressions",
    })
    expect(prompt).toContain("Kira: late 20s")
    expect(prompt).toContain("warm closed-mouth smile")
    expect(prompt).toContain(ASSET_STILL_SCAFFOLDING)
  })

  it("omits canonical when null/empty", () => {
    const prompt = buildAssetPromptText({
      canonicalDescription: null,
      assetDescription: "smile",
      variantOrPrompt: "smile",
      assetType: "expressions",
    })
    expect(prompt).not.toContain("undefined")
    expect(prompt).not.toContain("null")
  })

  it("uses motion scaffolding for motions and includes motionDescription when provided", () => {
    const prompt = buildMotionPromptText({
      canonicalDescription: "Kira: …",
      assetDescription: "walking confidently forward",
      motionDescription: "smooth stride, head held high, eyes forward",
      variantOrPrompt: "walking",
    })
    expect(prompt).toContain("walking confidently forward")
    expect(prompt).toContain("smooth stride")
    expect(prompt).toContain(ASSET_MOTION_SCAFFOLDING)
  })
})
