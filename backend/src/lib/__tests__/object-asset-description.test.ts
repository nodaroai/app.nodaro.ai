import { describe, expect, it } from "vitest"
import {
  OBJECT_ASSET_DESCRIPTION_SYSTEM_PROMPT,
  OBJECT_ASSET_DESCRIPTION_LLM_OPTIONS,
  buildObjectAssetDescriptionUserMessage,
} from "../object-asset-description.js"

describe("OBJECT_ASSET_DESCRIPTION_SYSTEM_PROMPT", () => {
  it("emphasizes object-shape concerns (material, surface, condition)", () => {
    expect(OBJECT_ASSET_DESCRIPTION_SYSTEM_PROMPT).toMatch(/material/i)
    expect(OBJECT_ASSET_DESCRIPTION_SYSTEM_PROMPT).toMatch(/condition/i)
    expect(OBJECT_ASSET_DESCRIPTION_SYSTEM_PROMPT).toMatch(/texture/i)
  })

  it("does NOT contain character/scene-leaning language", () => {
    expect(OBJECT_ASSET_DESCRIPTION_SYSTEM_PROMPT).not.toMatch(/pose|expression|facial muscle|body posture/i)
    expect(OBJECT_ASSET_DESCRIPTION_SYSTEM_PROMPT).not.toMatch(/landscape|scene|atmosphere/i)
  })

  it("constrains to 15-25 word output", () => {
    expect(OBJECT_ASSET_DESCRIPTION_SYSTEM_PROMPT).toMatch(/15[–-]25 words/i)
  })
})

describe("OBJECT_ASSET_DESCRIPTION_LLM_OPTIONS", () => {
  it("matches the character-leaning sibling's shape", () => {
    expect(OBJECT_ASSET_DESCRIPTION_LLM_OPTIONS).toEqual({
      maxTokens: 400,
      temperature: 0.8,
    })
  })
})

describe("buildObjectAssetDescriptionUserMessage", () => {
  it("uses variant for non-custom asset types", () => {
    const msg = buildObjectAssetDescriptionUserMessage({
      assetType: "materials",
      variant: "wood",
      userPrompt: "ignored",
    })
    expect(msg).toMatch(/Asset type: materials\./)
    expect(msg).toMatch(/Variant or prompt: "wood"/)
  })

  it("uses userPrompt for custom asset type (variant ignored)", () => {
    const msg = buildObjectAssetDescriptionUserMessage({
      assetType: "custom",
      variant: "custom",
      userPrompt: "ancient glowing energy",
    })
    expect(msg).toMatch(/Asset type: custom\./)
    expect(msg).toMatch(/Variant or prompt: "ancient glowing energy"/)
  })

  it("falls back to userPrompt when variant is missing on non-custom", () => {
    const msg = buildObjectAssetDescriptionUserMessage({
      assetType: "variations",
      userPrompt: "weathered antique",
    })
    expect(msg).toMatch(/Variant or prompt: "weathered antique"/)
  })

  it("emits empty quote when both variant + userPrompt are missing", () => {
    const msg = buildObjectAssetDescriptionUserMessage({ assetType: "angles" })
    expect(msg).toMatch(/Variant or prompt: ""/)
  })

  it("appends canonical with Object: label (not Character:)", () => {
    const msg = buildObjectAssetDescriptionUserMessage({
      assetType: "materials",
      variant: "marble",
      canonicalDescription: "An ornate brass goblet with intricate engravings",
    })
    expect(msg).toMatch(/\nObject: An ornate brass goblet/)
    expect(msg).not.toMatch(/\nCharacter:/)
  })

  it("omits the canonical line when canonicalDescription is null/undefined", () => {
    const msg = buildObjectAssetDescriptionUserMessage({
      assetType: "materials",
      variant: "wood",
    })
    expect(msg).not.toMatch(/\nObject:/)
  })
})
