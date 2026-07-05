import { describe, it, expect } from "vitest"
import { buildImagePrompt } from "../prompt-builder.js"
import type { ConnectedReference } from "@nodaro/shared"

// Minimal wired refs — only id/defaultName/source/url are required on
// ConnectedReference; everything else is optional and irrelevant to the
// canonical hybrid render (it reads source + url + defaultUsageMode +
// elementInjection + identityLock).
const sword: ConnectedReference = {
  id: "o", defaultName: "Sword", source: "wired-object", url: "https://cdn/sword.png",
}
const dragon: ConnectedReference = {
  id: "c", defaultName: "Dragon", source: "wired-creature", url: "https://cdn/dragon.png",
}

const occurrences = (haystack: string, needle: string): number =>
  haystack.split(needle).length - 1

describe("object/creature reference converges onto the image hybrid form", () => {
  it("wired object (no token) → 'the object from reference image A', no legacy wrap", () => {
    const out = buildImagePrompt({
      prompt: "a hero on a battlefield", connectedReferences: [sword],
      provider: "nano-banana-pro", referenceFormat: "hybrid",
    })
    expect(out.prompt).toContain("the object from reference image A")
    expect(out.prompt).not.toContain("Use these references")
    expect(out.referenceImageUrls).toContain("https://cdn/sword.png")
  })

  it("wired creature (no token) → 'the creature from reference image A'", () => {
    const out = buildImagePrompt({
      prompt: "a knight rides into battle", connectedReferences: [dragon],
      provider: "nano-banana-pro", referenceFormat: "hybrid",
    })
    expect(out.prompt).toContain("the creature from reference image A")
    expect(out.referenceImageUrls).toContain("https://cdn/dragon.png")
  })

  it("object referenced via {image:1:object} token renders ONCE (coveredUrls guard)", () => {
    const out = buildImagePrompt({
      prompt: "a hero holding {image:1:object}", connectedReferences: [sword],
      provider: "nano-banana-pro", referenceFormat: "hybrid",
    })
    // The token expands inline; the canonical render must NOT ALSO emit the
    // same phrase as a trailing directive (double-emit).
    expect(occurrences(out.prompt, "the object from reference image A")).toBe(1)
    // And exactly one reference to slot A overall.
    expect(occurrences(out.prompt, "reference image A")).toBe(1)
  })

  it("creature opt-in identity lock surfaces a lock line; default OFF emits none; object has no default lock", () => {
    // Creature opt-in, built-in wording (no custom text).
    const lockedCreature = buildImagePrompt({
      prompt: "a knight rides into battle",
      connectedReferences: [{ ...dragon, identityLock: { enabled: true } } as ConnectedReference],
      provider: "nano-banana-pro", referenceFormat: "hybrid",
    })
    expect(lockedCreature.prompt).toContain("the creature from reference image A")
    expect(lockedCreature.prompt).toContain("Lock the exact identity of the creature in reference image A")

    // Creature default (no identityLock) → no lock line.
    const unlockedCreature = buildImagePrompt({
      prompt: "a knight rides into battle", connectedReferences: [dragon],
      provider: "nano-banana-pro", referenceFormat: "hybrid",
    })
    expect(unlockedCreature.prompt).not.toContain("Lock the exact identity of the creature")

    // Object opt-in enabled but NO custom text → NO lock line (object has no
    // built-in wording); the phrase still renders.
    const objectEnabledNoText = buildImagePrompt({
      prompt: "a hero on a battlefield",
      connectedReferences: [{ ...sword, identityLock: { enabled: true } } as ConnectedReference],
      provider: "nano-banana-pro", referenceFormat: "hybrid",
    })
    expect(objectEnabledNoText.prompt).toContain("the object from reference image A")
    expect(objectEnabledNoText.prompt).not.toContain("Lock the exact")
  })

  it("LEGACY (no referenceFormat) unchanged → still the block, not the hybrid phrase", () => {
    const out = buildImagePrompt({
      prompt: "a hero on a battlefield", connectedReferences: [sword], provider: "nano-banana-pro",
    })
    expect(out.prompt).not.toContain("the object from reference image A")
  })
})

describe("location coveredUrls guard (C1 review Minor regression)", () => {
  const library: ConnectedReference = {
    id: "l", defaultName: "Old Library", source: "wired-location",
    url: "https://cdn/library.png", locationSlug: "old-library",
  }

  it("location BOTH unmentioned AND {image:N}-tokened → renders ONCE (not also canonical)", () => {
    const out = buildImagePrompt({
      prompt: "a chase {image:1:location}", connectedReferences: [library],
      provider: "nano-banana-pro", referenceFormat: "hybrid",
    })
    // Token expands inline to "the location from reference image A"; the
    // canonical render must be suppressed (else "the background from reference
    // image A" would ALSO appear → slot A referenced twice).
    expect(out.prompt).toContain("the location from reference image A")
    expect(out.prompt).not.toContain("the background from reference image A")
    expect(occurrences(out.prompt, "reference image A")).toBe(1)
  })
})
