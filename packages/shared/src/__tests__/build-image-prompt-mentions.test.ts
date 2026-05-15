import { describe, it, expect } from "vitest"
import { buildImagePrompt } from "../prompt-builder.js"
import type { ConnectedReference } from "../types.js"

const kiraCanonical: ConnectedReference = {
  id: "ref-kira",
  defaultName: "Kira",
  source: "wired-character",
  description: "young woman with warm smile",
  url: "https://r2/kira-portrait.png",
  characterSlug: "kira",
  variantSlug: undefined,
  characterCanonicalDescription: "young woman, brown eyes, auburn shoulder-length hair, athletic build",
  variantDescription: null,
  variantDisplayName: "canonical",
}

const kiraSmile: ConnectedReference = {
  id: "ref-kira-smile",
  defaultName: "Kira / smile",
  source: "wired-character",
  description: "warm closed-mouth smile",
  url: "https://r2/kira-smile.png",
  characterSlug: "kira",
  variantSlug: "smile",
  characterCanonicalDescription: "young woman, brown eyes, auburn shoulder-length hair, athletic build",
  variantDescription: "warm closed-mouth smile, eyes slightly crinkled",
  variantDisplayName: "smile",
}

describe("buildImagePrompt with @-mentions", () => {
  it("resolves @kira:smile to URL + appends variant description", () => {
    const result = buildImagePrompt({
      prompt: "make her dance, @kira:smile",
      provider: "nano-banana-pro",
      connectedReferences: [kiraCanonical, kiraSmile],
    })
    expect(result.referenceImageUrls).toContain("https://r2/kira-smile.png")
    expect(result.prompt).toContain("warm closed-mouth smile")
    expect(result.prompt).not.toMatch(/@kira:smile\b/)
  })

  it("resolves bare @kira to canonical entry", () => {
    const result = buildImagePrompt({
      prompt: "feature @kira prominently",
      provider: "nano-banana-pro",
      connectedReferences: [kiraCanonical, kiraSmile],
    })
    expect(result.referenceImageUrls).toContain("https://r2/kira-portrait.png")
    expect(result.prompt).toContain("auburn shoulder-length hair")
  })

  it("dedupes canonical description when character appears in multiple tokens", () => {
    const result = buildImagePrompt({
      prompt: "@kira looks at her own @kira:smile",
      provider: "nano-banana-pro",
      connectedReferences: [kiraCanonical, kiraSmile],
    })
    const matches = (result.prompt.match(/auburn shoulder-length hair/g) || []).length
    expect(matches).toBe(1)
    expect(result.referenceImageUrls).toEqual(
      expect.arrayContaining(["https://r2/kira-portrait.png", "https://r2/kira-smile.png"])
    )
  })

  it("leaves @<slug> as literal when no match", () => {
    const result = buildImagePrompt({
      prompt: "make @unknown wave",
      provider: "nano-banana-pro",
      connectedReferences: [kiraCanonical],
    })
    expect(result.prompt).toContain("@unknown")
  })
})
