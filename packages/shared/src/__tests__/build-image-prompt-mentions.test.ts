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

const kiraWalking: ConnectedReference = {
  id: "ref-kira-walking",
  defaultName: "Kira / walking",
  source: "wired-character",
  description: "walking pose",
  url: "https://r2/kira-walking.png",
  characterSlug: "kira",
  variantSlug: "walking",
  characterCanonicalDescription: "young woman, brown eyes, auburn shoulder-length hair, athletic build",
  variantDescription: "mid-stride walking pose",
  variantDisplayName: "walking",
}

const adamCanonical: ConnectedReference = {
  id: "ref-adam",
  defaultName: "Adam",
  source: "wired-character",
  description: "older man",
  url: "https://r2/adam-portrait.png",
  characterSlug: "adam",
  variantSlug: undefined,
  characterCanonicalDescription: "older man, grey hair, broad shoulders",
  variantDescription: null,
  variantDisplayName: "canonical",
}

describe("buildImagePrompt with @-mentions", () => {
  it("resolves @kira:1:smile to URL + appends variant description + Image 1 (Kira) subject", () => {
    const result = buildImagePrompt({
      prompt: "make her dance, @kira:1:smile",
      provider: "nano-banana-pro",
      connectedReferences: [kiraCanonical, kiraSmile],
    })
    expect(result.referenceImageUrls).toContain("https://r2/kira-smile.png")
    expect(result.prompt).toContain("warm closed-mouth smile")
    expect(result.prompt).not.toMatch(/@kira:1:smile\b/)
    // Numeric index in the directive matches the user-typed slug.
    expect(result.prompt).toContain("Image 1 (Kira)")
  })

  it("resolves @kira:1 (no variant) to canonical entry", () => {
    const result = buildImagePrompt({
      prompt: "feature @kira:1 prominently",
      provider: "nano-banana-pro",
      connectedReferences: [kiraCanonical, kiraSmile],
    })
    expect(result.referenceImageUrls).toContain("https://r2/kira-portrait.png")
    expect(result.prompt).toContain("auburn shoulder-length hair")
    expect(result.prompt).toContain("Image 1 (Kira)")
  })

  it("dedupes canonical description when character appears in multiple tokens", () => {
    const result = buildImagePrompt({
      prompt: "@kira:1 looks at her own @kira:2:smile",
      provider: "nano-banana-pro",
      connectedReferences: [kiraCanonical, kiraSmile],
    })
    const matches = (result.prompt.match(/auburn shoulder-length hair/g) || []).length
    expect(matches).toBe(1)
    expect(result.referenceImageUrls).toEqual(
      expect.arrayContaining(["https://r2/kira-portrait.png", "https://r2/kira-smile.png"]),
    )
  })

  it("leaves @<slug>:<index> as literal when no character match", () => {
    const result = buildImagePrompt({
      prompt: "make @unknown:1 wave",
      provider: "nano-banana-pro",
      connectedReferences: [kiraCanonical],
    })
    expect(result.prompt).toContain("@unknown:1")
  })

  // Fix A (default fallback): wired character with no @-mention → canonical attached.
  it("ATTACHES canonical URL when character is wired but not @-mentioned", () => {
    const result = buildImagePrompt({
      prompt: "just a dragon flying",
      provider: "nano-banana-pro",
      connectedReferences: [kiraCanonical, kiraSmile],
    })
    expect(result.referenceImageUrls).toContain("https://r2/kira-portrait.png")
    // No variant auto-attaches.
    expect(result.referenceImageUrls ?? []).not.toContain("https://r2/kira-smile.png")
    // Strong directive for the canonical fallback (no numeric index — reserved
    // for explicit user mentions).
    expect(result.prompt).toContain("auburn shoulder-length hair")
    expect(result.prompt).toMatch(/Match exactly\. Maintain perfect likeness/)
  })

  it("attaches ONLY mentioned variant URL when character IS @-mentioned (no canonical fallback)", () => {
    const result = buildImagePrompt({
      prompt: "show @kira:1:smile dancing",
      provider: "nano-banana-pro",
      connectedReferences: [kiraCanonical, kiraSmile],
    })
    expect(result.referenceImageUrls).toEqual(["https://r2/kira-smile.png"])
    // No canonical attached because the character was explicitly mentioned.
    expect(result.referenceImageUrls).not.toContain("https://r2/kira-portrait.png")
  })

  it("two wired characters, only one @-mentioned → mentioned-one gets variant, unmentioned gets canonical", () => {
    const result = buildImagePrompt({
      prompt: "@kira:1:smile and her friend talking",
      provider: "nano-banana-pro",
      connectedReferences: [kiraCanonical, kiraSmile, adamCanonical],
    })
    // Kira (mentioned) → smile variant only.
    expect(result.referenceImageUrls).toContain("https://r2/kira-smile.png")
    expect(result.referenceImageUrls).not.toContain("https://r2/kira-portrait.png")
    // Adam (not mentioned) → canonical fallback.
    expect(result.referenceImageUrls).toContain("https://r2/adam-portrait.png")
    // Both characters get strong directives in the same "Use these characters:" block.
    expect(result.prompt).toContain("Use these characters:")
    expect(result.prompt).toContain("Image 1 (Kira)")
    expect(result.prompt).toContain("Adam")
  })

  it("multiple mentions of same character pick the right variant per token", () => {
    const result = buildImagePrompt({
      prompt: "@kira:1:smile waves, then @kira:2:walking",
      provider: "nano-banana-pro",
      connectedReferences: [kiraCanonical, kiraSmile, kiraWalking],
    })
    expect(result.referenceImageUrls).toEqual(
      expect.arrayContaining(["https://r2/kira-smile.png", "https://r2/kira-walking.png"]),
    )
    // Canonical NOT attached because the character was @-mentioned.
    expect(result.referenceImageUrls).not.toContain("https://r2/kira-portrait.png")
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
    // Manual ref auto-attaches; character ref ALSO auto-attaches now via the
    // default-fallback (per Fix A).
    expect(result.referenceImageUrls).toContain("https://r2/manual.png")
    expect(result.referenceImageUrls).toContain("https://r2/kira-portrait.png")
  })

  it("emits a strengthened identity directive when a character is mentioned", () => {
    const result = buildImagePrompt({
      prompt: "@kira:1 dancing in the rain",
      provider: "nano-banana-pro",
      connectedReferences: [kiraCanonical],
    })
    expect(result.prompt).toMatch(/Match exactly\. Maintain perfect likeness/)
    expect(result.prompt).toMatch(/face, body proportions, distinctive features/)
    expect(result.prompt).toContain("Image 1 (Kira)")
  })

  it("strengthens directive for non-character refs labeled 'person' (numeric index)", () => {
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
    // Per-image directive folds in identity-preservation language; numeric index.
    expect(result.prompt).toContain("Image 1 (person")
    expect(result.prompt).toContain("match exactly. Maintain perfect likeness (face, body proportions, distinctive features)")
  })
})
