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
    // Strong directive for the canonical fallback. The numeric index now ALSO
    // gets prefixed on canonical fallback bullets so the model can correlate
    // the ref position with the named character ("Image 1 in the input array
    // is Kira"). Position is 1 because this is the only ref and there are no
    // pre-existing refs.
    expect(result.prompt).toContain("Image 1 (Kira)")
    expect(result.prompt).toContain("auburn shoulder-length hair")
    expect(result.prompt).toContain("The subject must remain exactly the same person")
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
    // Both characters get strong directives with numeric prefixes in the same
    // "Use these characters:" block. Kira is mention #1 so emits at Image 1;
    // Adam's canonical fallback lands at Image 2 (1 mention URL + 1 fallback).
    expect(result.prompt).toContain("Use these characters:")
    expect(result.prompt).toContain("Image 1 (Kira)")
    expect(result.prompt).toContain("Image 2 (Adam)")
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
    expect(result.prompt).toContain("The subject must remain exactly the same person")
    expect(result.prompt).toContain("preserve 100% facial identity")
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

  // Reproduces the user-reported scenario from the bug report: a character
  // "shira" with two expression variants (smile, laughing), the user typing a
  // prompt that mentions both variants. The fix in `execute-node.ts` ensures
  // image-to-image / modify-image build a full `connectedReferences` array so
  // this scenario actually reaches Phase 0 (it was previously bypassed). This
  // test guards the underlying Phase 0 resolution path that the executor now
  // routes through.
  // -------------------------------------------------------------------------
  // Usage-mode tests — per-mention slug override + character-node default
  // propagation through ConnectedReference.defaultUsageMode.
  // -------------------------------------------------------------------------

  it("@kira:1:face emits face-only directive (no canonical description)", () => {
    const result = buildImagePrompt({
      prompt: "@kira:1:face waving",
      provider: "nano-banana-pro",
      connectedReferences: [kiraCanonical],
    })
    expect(result.prompt).toContain("Take ONLY the facial features")
    expect(result.prompt).toContain("Adopt clothing, hair styling, and posture")
    // Face-only deliberately drops the canonical-description prefix so the
    // model isn't anchored to body proportions when only the face is wanted.
    expect(result.prompt).not.toContain("auburn shoulder-length hair")
    expect(result.prompt).toContain("Image 1 (Kira)")
    expect(result.referenceImageUrls).toContain("https://r2/kira-portrait.png")
  })

  it("@kira:1:smile:face combines variant URL with face-only directive", () => {
    const result = buildImagePrompt({
      prompt: "show @kira:1:smile:face dancing",
      provider: "nano-banana-pro",
      connectedReferences: [kiraCanonical, kiraSmile],
    })
    expect(result.referenceImageUrls).toEqual(["https://r2/kira-smile.png"])
    expect(result.prompt).toContain("Take ONLY the facial features")
    expect(result.prompt).toContain("Image 1 (Kira)")
  })

  it("@kira:1:style emits style-only directive", () => {
    const result = buildImagePrompt({
      prompt: "redo @kira:1:style as a comic panel",
      provider: "nano-banana-pro",
      connectedReferences: [kiraCanonical],
    })
    expect(result.prompt).toContain("Take only the visual style and tone")
    expect(result.prompt).not.toContain("auburn shoulder-length hair")
  })

  it("@kira:1:emotion emits emotion-only directive", () => {
    const result = buildImagePrompt({
      prompt: "@kira:1:emotion expressed by another character",
      provider: "nano-banana-pro",
      connectedReferences: [kiraCanonical],
    })
    expect(result.prompt).toContain("Take only the emotional expression")
    expect(result.prompt).toContain("transfer only the emotional cue")
  })

  it("@kira:1:face-pose emits face + pose directive AND keeps canonical description", () => {
    const result = buildImagePrompt({
      prompt: "@kira:1:face-pose in a different outfit",
      provider: "nano-banana-pro",
      connectedReferences: [kiraCanonical],
    })
    expect(result.prompt).toContain("Take the facial features AND body pose")
    expect(result.prompt).toContain("Adopt clothing and styling")
    // face-pose deliberately keeps the canonical description so the model
    // holds the underlying identity while reposing.
    expect(result.prompt).toContain("auburn shoulder-length hair")
  })

  it("falls back to character node's defaultUsageMode when slug has no mode", () => {
    const kiraFace: ConnectedReference = {
      ...kiraCanonical,
      defaultUsageMode: "face",
    }
    const result = buildImagePrompt({
      prompt: "@kira:1 happy",
      provider: "nano-banana-pro",
      connectedReferences: [kiraFace],
    })
    // No slug-level mode; falls through to node default "face".
    expect(result.prompt).toContain("Take ONLY the facial features")
    // Canonical description omitted because face mode drops it.
    expect(result.prompt).not.toContain("auburn shoulder-length hair")
  })

  it("slug mode overrides character node's defaultUsageMode", () => {
    const kiraFace: ConnectedReference = {
      ...kiraCanonical,
      defaultUsageMode: "face",
    }
    const result = buildImagePrompt({
      prompt: "@kira:1:style as a wood carving",
      provider: "nano-banana-pro",
      connectedReferences: [kiraFace],
    })
    expect(result.prompt).toContain("Take only the visual style and tone")
    expect(result.prompt).not.toContain("Take ONLY the facial features")
  })

  it("canonical fallback (no @-mention) uses character node's defaultUsageMode", () => {
    const kiraFace: ConnectedReference = {
      ...kiraCanonical,
      defaultUsageMode: "face",
    }
    const result = buildImagePrompt({
      prompt: "a portrait with no mention",
      provider: "nano-banana-pro",
      connectedReferences: [kiraFace],
    })
    // Canonical fallback triggers — directive uses the node's default mode.
    expect(result.prompt).toContain("Take ONLY the facial features")
    expect(result.referenceImageUrls).toContain("https://r2/kira-portrait.png")
  })

  it("canonical fallback without defaultUsageMode emits the default 'identical' directive", () => {
    const result = buildImagePrompt({
      prompt: "just a scene",
      provider: "nano-banana-pro",
      connectedReferences: [kiraCanonical],
    })
    // Default mode is "identical" — directive comes from usageModeDirective("identical").
    expect(result.prompt).toContain("The subject must remain exactly the same person")
    expect(result.prompt).toContain("preserve 100% facial identity")
  })

  it("user scenario: shira with smile + laughing variants — both URLs attach, canonical skipped", () => {
    const shiraCanonical: ConnectedReference = {
      id: "char-shira",
      defaultName: "shira",
      source: "wired-character",
      url: "https://r2/shira/laughing.png", // defaultAssetUrl per ★ button
      characterSlug: "shira",
      variantSlug: undefined,
      characterCanonicalDescription: "young woman, brown eyes",
      variantDescription: null,
      variantDisplayName: "canonical",
    }
    const shiraSmile: ConnectedReference = {
      id: "char-shira-smile",
      defaultName: "shira / smile",
      source: "wired-character",
      url: "https://r2/shira/smile.png",
      characterSlug: "shira",
      variantSlug: "smile",
      characterCanonicalDescription: "young woman, brown eyes",
      variantDescription: null,
      variantDisplayName: "smile",
    }
    const shiraLaughing: ConnectedReference = {
      id: "char-shira-laughing",
      defaultName: "shira / laughing",
      source: "wired-character",
      url: "https://r2/shira/laughing.png",
      characterSlug: "shira",
      variantSlug: "laughing",
      characterCanonicalDescription: "young woman, brown eyes",
      variantDescription: null,
      variantDisplayName: "laughing",
    }
    const result = buildImagePrompt({
      prompt:
        "@shira:1:smile with a friend, drinking coffee, @shira:2:laughing laughs when her friend say something to her ear",
      provider: "nano-banana-pro",
      connectedReferences: [shiraCanonical, shiraSmile, shiraLaughing],
    })
    // Both mentioned variant URLs must be in the references list.
    expect(result.referenceImageUrls).toEqual(
      expect.arrayContaining(["https://r2/shira/smile.png", "https://r2/shira/laughing.png"]),
    )
    // Canonical (laughing URL via defaultAssetUrl) should NOT be in refs as a
    // standalone canonical attachment — though note that the laughing variant
    // URL coincidentally matches `defaultAssetUrl` here, that's OK because
    // it's attached as the LAUGHING VARIANT, not as the canonical fallback.
    // The expected behavior is: 2 unique URLs (smile + laughing), no triple-
    // attach of the canonical with the same URL as the laughing variant.
    expect(result.referenceImageUrls).toHaveLength(2)
    // Tokens replaced — no literal `@shira:N:variant` survives.
    expect(result.prompt).not.toMatch(/@shira:1:smile\b/)
    expect(result.prompt).not.toMatch(/@shira:2:laughing\b/)
  })
})

describe("buildImagePrompt with extra reference images (isExtraRef)", () => {
  it("emits 'same subject as Image M' for a character extra whose character is canonically attached", () => {
    const kiraExtra: ConnectedReference = {
      id: "extra-kira-stand",
      defaultName: "Kira / standing",
      source: "wired-character",
      description: "full body, standing, facing right",
      url: "https://r2/kira-standing.png",
      characterSlug: "kira",
      variantSlug: "standing",
      variantDescription: "full body, standing, facing right",
      variantDisplayName: "standing",
      defaultUsageMode: "identical",
      isExtraRef: true,
    }
    const result = buildImagePrompt({
      prompt: "a busy street market",
      provider: "nano-banana-pro",
      connectedReferences: [kiraCanonical, kiraExtra],
    })
    // Kira (canonical) attaches at position 1; extra at position 2.
    expect(result.referenceImageUrls).toEqual([
      "https://r2/kira-portrait.png",
      "https://r2/kira-standing.png",
    ])
    // Pair-back directive uses the exact "Image 2 is the same subject as
    // Image 1, …" phrasing called out in the spec.
    expect(result.prompt).toContain(
      "Image 2 is the same subject as Image 1, full body, standing, facing right.",
    )
    // Canonical fallback bullet for Kira now leads with the numeric prefix
    // ("Image 1 (Kira) — …") so the model can correlate ref position with
    // the named character. Without the prefix the bullet was a floating
    // "Kira — …" with no link back to a specific reference slot.
    expect(result.prompt).toContain("Image 1 (Kira) — young woman, brown eyes, auburn shoulder-length hair, athletic build")
  })

  it("emits canonical-style directive for a character extra of a previously-unseen character", () => {
    const danielExtra: ConnectedReference = {
      id: "extra-daniel-1",
      defaultName: "Daniel",
      source: "wired-character",
      description: "looking right, hands in pockets",
      url: "https://r2/daniel-1.png",
      characterSlug: "daniel",
      variantSlug: "look-right",
      variantDescription: "looking right, hands in pockets",
      variantDisplayName: "look-right",
      defaultUsageMode: "identical",
      isExtraRef: true,
    }
    const result = buildImagePrompt({
      prompt: "a busy street market",
      provider: "nano-banana-pro",
      connectedReferences: [danielExtra],
    })
    expect(result.referenceImageUrls).toEqual(["https://r2/daniel-1.png"])
    // First-sight extra: canonical-style directive with the per-ref
    // description as the descriptor.
    expect(result.prompt).toContain("Image 1 (Daniel) — looking right, hands in pockets. The subject must remain exactly the same person")
  })

  it("emits 'Image N (reference): <description>.' for a manual upload extra", () => {
    const manualExtra: ConnectedReference = {
      id: "extra-style",
      defaultName: "Image 1",
      source: "manual",
      description: "warm cinematic color palette",
      url: "https://r2/style-ref.png",
      isExtraRef: true,
    }
    const result = buildImagePrompt({
      prompt: "a portrait",
      provider: "nano-banana-pro",
      connectedReferences: [manualExtra],
    })
    expect(result.referenceImageUrls).toEqual(["https://r2/style-ref.png"])
    expect(result.prompt).toContain(
      "Image 1 (reference): warm cinematic color palette.",
    )
  })

  it("matches the spec's example shape — Kira mention + standing extra", () => {
    const kiraExtra: ConnectedReference = {
      id: "extra-kira-stand",
      defaultName: "Kira / standing",
      source: "wired-character",
      description: "full body, standing, facing right",
      url: "https://r2/kira-standing.png",
      characterSlug: "kira",
      variantSlug: "standing",
      variantDescription: "full body, standing, facing right",
      variantDisplayName: "standing",
      defaultUsageMode: "identical",
      isExtraRef: true,
    }
    // Both mention-driven AND canonical-fallback bullets now include the
    // numeric `Image N (Name)` prefix so the model can correlate any bullet
    // to its position in the ref array. The `@kira:1` mention drives the
    // primary bullet at Image 1.
    const result = buildImagePrompt({
      prompt: "@kira:1 outside a coffee shop",
      provider: "nano-banana-pro",
      connectedReferences: [kiraCanonical, kiraExtra],
    })
    // Block opens with "Use these characters:"
    expect(result.prompt.startsWith("Use these characters:\n")).toBe(true)
    // Mention emits the numeric prefix.
    expect(result.prompt).toContain("Image 1 (Kira)")
    expect(result.prompt).toContain(
      "Image 2 is the same subject as Image 1, full body, standing, facing right.",
    )
    // User prompt is preserved at the bottom.
    expect(result.prompt).toContain("outside a coffee shop")
  })

  it("pairs an extra back to a canonical-fallback character with numeric prefix on both", () => {
    // Even without a `@kira:N` mention, the canonical fallback bullet now
    // leads with "Image 1 (Kira) — …" so the model can link the canonical
    // ref to the named character. The extra's "same subject as Image 1"
    // resolves cleanly: position 1 in the ref array IS the canonical URL.
    const kiraExtra: ConnectedReference = {
      id: "extra-kira-stand",
      defaultName: "Kira / standing",
      source: "wired-character",
      description: "full body, standing, facing right",
      url: "https://r2/kira-standing.png",
      characterSlug: "kira",
      variantSlug: "standing",
      variantDescription: "full body, standing, facing right",
      variantDisplayName: "standing",
      defaultUsageMode: "identical",
      isExtraRef: true,
    }
    const result = buildImagePrompt({
      prompt: "outside a coffee shop",
      provider: "nano-banana-pro",
      connectedReferences: [kiraCanonical, kiraExtra],
    })
    // Position 1 = canonical Kira URL; position 2 = extra URL.
    expect(result.referenceImageUrls).toEqual([
      "https://r2/kira-portrait.png",
      "https://r2/kira-standing.png",
    ])
    // Canonical fallback bullet now includes the numeric prefix.
    expect(result.prompt).toContain("Image 1 (Kira) — young woman, brown eyes")
    // Pair-back to "Image 1" still emitted.
    expect(result.prompt).toContain(
      "Image 2 is the same subject as Image 1, full body, standing, facing right.",
    )
  })

  it("does NOT double-emit when extras coexist with existing positional refs", () => {
    const manualPositional: ConnectedReference = {
      id: "pos-1",
      defaultName: "Image 1",
      source: "manual",
      url: "https://r2/positional.png",
      // No description / no isExtraRef — legacy positional ref.
    }
    const manualExtra: ConnectedReference = {
      id: "extra-1",
      defaultName: "Image 2",
      source: "manual",
      description: "warm light",
      url: "https://r2/extra.png",
      isExtraRef: true,
    }
    const result = buildImagePrompt({
      prompt: "a portrait",
      provider: "nano-banana-pro",
      connectedReferences: [manualPositional, manualExtra],
    })
    // Only the extra produces its dedicated reference bullet; the
    // positional ref doesn't (it has no description and no isExtraRef).
    const refBullets = (result.prompt.match(/Image \d+ \(reference\)/g) || []).length
    expect(refBullets).toBe(1)
    // Both URLs are in the final list, no duplicates.
    expect(result.referenceImageUrls).toEqual(
      expect.arrayContaining(["https://r2/positional.png", "https://r2/extra.png"]),
    )
  })

  it("respects per-ref usageMode override on a character extra", () => {
    const kiraExtraStyleMode: ConnectedReference = {
      id: "extra-kira-style",
      defaultName: "Kira / look",
      source: "wired-character",
      description: "1970s film grain look",
      url: "https://r2/kira-look.png",
      characterSlug: "kira",
      variantSlug: "look",
      variantDescription: "1970s film grain look",
      variantDisplayName: "look",
      // Per-ref override resolved at construction time.
      defaultUsageMode: "style",
      isExtraRef: true,
    }
    const result = buildImagePrompt({
      prompt: "a portrait",
      provider: "nano-banana-pro",
      connectedReferences: [kiraExtraStyleMode],
    })
    // "style" mode directive should be emitted (and identity-lock language
    // suppressed) because this is a first-sight character extra.
    expect(result.prompt).toContain("Take only the visual style and tone")
    expect(result.prompt).not.toContain("The subject must remain exactly the same person")
  })

  it("leaves empty-extras workflows unchanged (no Use these characters: prefix)", () => {
    const result = buildImagePrompt({
      prompt: "a portrait",
      provider: "nano-banana-pro",
      connectedReferences: [],
    })
    expect(result.prompt).not.toMatch(/^Use these characters:/)
  })
})
