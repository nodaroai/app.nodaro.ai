// packages/shared/src/__tests__/character-default-role-image.test.ts
//
// Character node `defaultRole` (the hybrid role-dropdown pick) must be honored
// by ALL THREE image resolution paths — canonical fallback (wired, unmentioned),
// @-mention (un-roled token), and extras (first-sight) — with the precedence:
//   per-mention token role → node defaultRole → defaultUsageMode-derived → "person".
// Legacy format ignores `defaultRole` entirely (byte-identical guard).
import { describe, it, expect } from "vitest"
import { buildImagePrompt } from "../prompt-builder.js"
import type { ConnectedReference } from "../types.js"

const kira: ConnectedReference = {
  id: "k", defaultName: "Kira", source: "wired-character",
  url: "https://cdn/kira.png", characterSlug: "kira",
}

describe("image canonical fallback honors the node defaultRole", () => {
  it("unmentioned wired character with defaultRole 'clothes' → 'the clothes from reference image A'", () => {
    const out = buildImagePrompt({
      provider: "nano-banana-pro",
      prompt: "a cinematic portrait",
      connectedReferences: [{ ...kira, defaultRole: "clothes" }],
      referenceFormat: "hybrid",
    })
    expect(out.prompt).toContain("the clothes from reference image A")
    expect(out.prompt).not.toContain("the person from reference image A")
  })

  it("unmentioned wired character with defaultUsageMode 'style' (no defaultRole) → 'the style from …' (node default finally honored)", () => {
    const out = buildImagePrompt({
      provider: "nano-banana-pro",
      prompt: "a cinematic portrait",
      connectedReferences: [{ ...kira, defaultUsageMode: "style" }],
      referenceFormat: "hybrid",
    })
    expect(out.prompt).toContain("the style from reference image A")
    expect(out.prompt).not.toContain("the person from reference image A")
  })

  it("plain unmentioned wired character (neither field) → 'the person from …' (unchanged)", () => {
    const out = buildImagePrompt({
      provider: "nano-banana-pro",
      prompt: "a cinematic portrait",
      connectedReferences: [kira],
      referenceFormat: "hybrid",
    })
    expect(out.prompt).toContain("the person from reference image A")
  })

  it("a Custom defaultRole survives verbatim on the canonical path", () => {
    const out = buildImagePrompt({
      provider: "nano-banana-pro",
      prompt: "a cinematic portrait",
      connectedReferences: [{ ...kira, defaultRole: "earrings" }],
      referenceFormat: "hybrid",
    })
    expect(out.prompt).toContain("the earrings from reference image A")
  })
})

describe("image @-mention honors the node defaultRole for un-roled tokens", () => {
  it("un-roled '@kira:1' with defaultRole 'hair' → 'the hair from reference image A'", () => {
    const out = buildImagePrompt({
      provider: "nano-banana-pro",
      prompt: "@kira:1 walking in the rain",
      connectedReferences: [{ ...kira, defaultRole: "hair" }],
      referenceFormat: "hybrid",
    })
    expect(out.prompt).toContain("the hair from reference image A walking in the rain")
  })

  it("a per-mention token role still overrides the node defaultRole", () => {
    const out = buildImagePrompt({
      provider: "nano-banana-pro",
      prompt: "@kira:1:face walking in the rain",
      connectedReferences: [{ ...kira, defaultRole: "hair" }],
      referenceFormat: "hybrid",
    })
    expect(out.prompt).toContain("the face from reference image A walking in the rain")
    expect(out.prompt).not.toContain("the hair from")
  })

  it("un-roled '@kira:1' with only defaultUsageMode 'face' → 'the face from …' (derived fallback)", () => {
    const out = buildImagePrompt({
      provider: "nano-banana-pro",
      prompt: "@kira:1 at dawn",
      connectedReferences: [{ ...kira, defaultUsageMode: "face" }],
      referenceFormat: "hybrid",
    })
    expect(out.prompt).toContain("the face from reference image A at dawn")
  })

  it("un-roled '@kira:1' with defaultUsageMode 'identical' → 'the person from …' (non-preset collapses)", () => {
    const out = buildImagePrompt({
      provider: "nano-banana-pro",
      prompt: "@kira:1 at dawn",
      connectedReferences: [{ ...kira, defaultUsageMode: "identical" }],
      referenceFormat: "hybrid",
    })
    expect(out.prompt).toContain("the person from reference image A at dawn")
  })
})

describe("image extras honor the node defaultRole (first-sight)", () => {
  it("first-sight character extra with defaultRole 'hair' → 'the hair from reference image A'", () => {
    // variantSlug makes it a picked-variant extra → excluded from the canonical
    // fallback, so renderExtraRefsHybrid's first-sight branch is the only surface.
    const extra: ConnectedReference = {
      ...kira, id: "x", variantSlug: "look", isExtraRef: true, defaultRole: "hair",
    }
    const out = buildImagePrompt({
      provider: "nano-banana-pro",
      prompt: "a portrait",
      connectedReferences: [extra],
      referenceFormat: "hybrid",
    })
    expect(out.prompt).toContain("the hair from reference image A")
    expect(out.prompt).not.toContain("the person from reference image A")
  })

  it("extra with defaultUsageMode 'style' and NO defaultRole keeps the derived role (unchanged)", () => {
    const extra: ConnectedReference = {
      ...kira, id: "x", variantSlug: "look", isExtraRef: true, defaultUsageMode: "style",
    }
    const out = buildImagePrompt({
      provider: "nano-banana-pro",
      prompt: "a portrait",
      connectedReferences: [extra],
      referenceFormat: "hybrid",
    })
    expect(out.prompt).toContain("the style from reference image A")
  })
})

describe("lock-line dedup (same reference locked via two paths)", () => {
  it("an extra whose URL equals the wired canonical emits the lock line ONCE", () => {
    // The pair-back letter gate routes a same-URL extra into the first-sight
    // branch (same letter), which would re-emit an identical {ref}-bound lock
    // line — the assembler's Set-dedup must collapse it to one.
    const lock = { enabled: true, text: "Preserve the overall facial likeness of the subject in {ref}." }
    const canonical: ConnectedReference = { ...kira, identityLock: lock }
    const sameUrlExtra: ConnectedReference = {
      ...kira, id: "x", variantSlug: "look", isExtraRef: true, identityLock: lock,
    }
    const out = buildImagePrompt({
      provider: "nano-banana-pro",
      prompt: "a cinematic portrait",
      connectedReferences: [canonical, sameUrlExtra],
      referenceFormat: "hybrid",
    })
    const occurrences = out.prompt.split("overall facial likeness of the subject in reference image A").length - 1
    expect(occurrences).toBe(1)
  })
})

describe("legacy format ignores defaultRole (byte-identical guard)", () => {
  it("legacy assembly with a defaultRole-carrying ref emits the legacy block, no role phrase", () => {
    const out = buildImagePrompt({
      provider: "nano-banana-pro",
      prompt: "a cinematic portrait",
      connectedReferences: [{ ...kira, defaultRole: "clothes" }],
      referenceFormat: "legacy",
    })
    expect(out.prompt).not.toContain("the clothes from reference image A")
    expect(out.prompt).toContain("Use these characters:")
  })
})
