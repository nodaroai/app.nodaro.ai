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

  // Fix 2: character refs that aren't @-mentioned should NOT contribute URLs.
  it("does NOT attach character URLs when no @-mention is present", () => {
    const result = buildImagePrompt({
      prompt: "just a dragon flying",
      provider: "nano-banana-pro",
      connectedReferences: [kiraCanonical, kiraSmile],
    })
    expect(result.referenceImageUrls ?? []).not.toContain("https://r2/kira-portrait.png")
    expect(result.referenceImageUrls ?? []).not.toContain("https://r2/kira-smile.png")
    // Sanity: no character directive either, since no mention was made.
    expect(result.prompt).not.toContain("auburn shoulder-length hair")
  })

  it("attaches ONLY mentioned variant URLs (not canonical, not other variants)", () => {
    const result = buildImagePrompt({
      prompt: "show @kira:smile dancing",
      provider: "nano-banana-pro",
      connectedReferences: [kiraCanonical, kiraSmile],
    })
    expect(result.referenceImageUrls).toEqual(["https://r2/kira-smile.png"])
  })

  it("attaches non-character refs (manual / wired-image) even without @-mention", () => {
    const manualRef: ConnectedReference = {
      id: "ref-manual-1",
      defaultName: "Image 1",
      source: "manual",
      url: "https://r2/manual.png",
    }
    const result = buildImagePrompt({
      prompt: "a scene with the object",
      provider: "nano-banana-pro",
      connectedReferences: [kiraCanonical, manualRef],
    })
    // Manual ref auto-attaches; character ref does NOT.
    expect(result.referenceImageUrls).toContain("https://r2/manual.png")
    expect(result.referenceImageUrls ?? []).not.toContain("https://r2/kira-portrait.png")
  })

  // Fix 4: strengthened character directive folds identity-preservation
  // language directly into the bullet — no global trailing clause needed.
  it("emits a strengthened identity directive when a character is mentioned", () => {
    const result = buildImagePrompt({
      prompt: "@kira dancing in the rain",
      provider: "nano-banana-pro",
      connectedReferences: [kiraCanonical],
    })
    // Phase 0 character directive folds in identity-preservation language.
    expect(result.prompt).toMatch(/Match exactly\. Maintain perfect likeness/)
    expect(result.prompt).toMatch(/face, body proportions, distinctive features/)
  })

  it("strengthens directive for non-character refs labeled 'person'", () => {
    const personRef: ConnectedReference = {
      id: "ref-face",
      defaultName: "Sarah",
      source: "wired-face",
      url: "https://r2/sarah.png",
      description: "tall, red hair",
    }
    const result = buildImagePrompt({
      prompt: "{image:1:person} smiling",
      provider: "nano-banana-pro",
      connectedReferences: [personRef],
    })
    // Per-image directive folds in identity-preservation language.
    expect(result.prompt).toContain("match exactly. Maintain perfect likeness (face, body proportions, distinctive features)")
  })
})
