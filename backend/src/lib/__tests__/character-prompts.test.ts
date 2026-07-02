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

  it("weaves injectedAssets after the seed, before the scaffolding", () => {
    // Element/asset injection: wired-in text composed by the editor.
    const prompt = buildPortraitPrompt({ seedPrompt: "young woman", injectedAssets: "wearing a leather jacket" })
    expect(prompt).toContain("young woman, wearing a leather jacket")
    expect(prompt.indexOf("wearing a leather jacket")).toBeLessThan(prompt.indexOf(PORTRAIT_SCAFFOLDING))
  })

  it("is a no-op when injectedAssets is empty / whitespace / absent", () => {
    const base = buildPortraitPrompt({ seedPrompt: "young woman" })
    expect(buildPortraitPrompt({ seedPrompt: "young woman", injectedAssets: "" })).toBe(base)
    expect(buildPortraitPrompt({ seedPrompt: "young woman", injectedAssets: "   " })).toBe(base)
  })

  it("defaults the subject to clothed (a face-referenced studio shot renders nude/underwear otherwise)", () => {
    // No outfit picked → nothing specifies clothing → the model fills a bare body.
    // The scaffolding carries a clothed floor so an outfit-less portrait is dressed.
    expect(PORTRAIT_SCAFFOLDING).toMatch(/clothed/i)
    expect(buildPortraitPrompt({ seedPrompt: "young woman" })).toMatch(/clothed/i)
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

  it("inserts the assetType framing fragment for poses", () => {
    const prompt = buildAssetPromptText({
      canonicalDescription: "Kira",
      assetDescription: "walking confidently",
      variantOrPrompt: "walking",
      assetType: "poses",
    })
    expect(prompt).toContain("full body visible including feet")
  })

  it("defaults full-body assets to clothed (the 'full body' framing renders nude/underwear otherwise)", () => {
    // poses/bodyAngles/lighting demand a full body; without a clothed default the
    // model dresses it in underwear or nothing. The still scaffolding fixes it.
    expect(ASSET_STILL_SCAFFOLDING).toMatch(/clothed/i)
    const prompt = buildAssetPromptText({
      canonicalDescription: "Kira",
      assetDescription: "standing",
      variantOrPrompt: "front",
      assetType: "poses",
    })
    expect(prompt).toMatch(/clothed/i)
  })

  it("omits framing for unknown assetType (e.g. custom)", () => {
    const prompt = buildAssetPromptText({
      canonicalDescription: "Kira",
      assetDescription: "warm smile",
      variantOrPrompt: "smile",
      assetType: "custom",
    })
    expect(prompt).not.toContain("portrait headshot")
    expect(prompt).not.toContain("full body")
  })

  it("strips trailing periods from fragments so the output has no double-periods", () => {
    const prompt = buildAssetPromptText({
      canonicalDescription: "Kira: late 20s.",
      assetDescription: "warm smile.",
      variantOrPrompt: "smile",
      assetType: "expressions",
    })
    expect(prompt).not.toMatch(/\.\s*\./)
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

  it("strips trailing periods from motion fragments", () => {
    const prompt = buildMotionPromptText({
      canonicalDescription: "Kira.",
      assetDescription: "walking.",
      motionDescription: "smooth stride.",
      variantOrPrompt: "walking",
    })
    expect(prompt).not.toMatch(/\.\s*\./)
  })
})
