import { describe, it, expect } from "vitest"
import { buildImagePrompt } from "../prompt-builder.js"
import type { ConnectedReference } from "../types.js"

// Location token format is `@slug:N(:bucket/variant)?(:mode)?` per
// `findLocationMentionTokens` — the canonical mention is just `@slug:N`.
const library: ConnectedReference = {
  id: "l", defaultName: "Old Library", source: "wired-location",
  url: "https://cdn/library.png", locationSlug: "old-library",
}

describe("location reference converges onto the image hybrid form", () => {
  it("wired location (canonical) → 'the background from reference image A', no legacy block", () => {
    const out = buildImagePrompt({
      prompt: "a detective at her desk", connectedReferences: [library],
      provider: "nano-banana-pro", referenceFormat: "hybrid",
    })
    expect(out.prompt).toContain("the background from reference image A")
    expect(out.prompt).not.toContain("Use these locations:")
    expect(out.referenceImageUrls).toContain("https://cdn/library.png")
  })

  it("@-mention with style mode (location node default) → 'the style from reference image A'", () => {
    const out = buildImagePrompt({
      prompt: "@old-library:1 a chase scene",
      connectedReferences: [{ ...library, defaultUsageMode: "style" } as ConnectedReference],
      provider: "nano-banana-pro", referenceFormat: "hybrid",
    })
    expect(out.prompt).toContain("the style from reference image A")
    expect(out.prompt).not.toContain("Use these locations:")
    expect(out.referenceImageUrls).toContain("https://cdn/library.png")
  })

  it("@-mention with explicit :layout mode → 'the layout from reference image A'", () => {
    const out = buildImagePrompt({
      prompt: "@old-library:1:layout a chase scene",
      connectedReferences: [library],
      provider: "nano-banana-pro", referenceFormat: "hybrid",
    })
    expect(out.prompt).toContain("the layout from reference image A")
    expect(out.prompt).not.toContain("Use these locations:")
  })

  it("opt-in identity lock surfaces a lock line; default OFF emits none", () => {
    const locked = buildImagePrompt({
      prompt: "@old-library:1 a chase scene",
      connectedReferences: [{
        ...library,
        identityLock: { enabled: true, text: "Lock the exact setting in {ref}." },
      } as ConnectedReference],
      provider: "nano-banana-pro", referenceFormat: "hybrid",
    })
    expect(locked.prompt).toContain("the background from reference image A")
    expect(locked.prompt).toContain("Lock the exact setting in reference image A.")

    const unlocked = buildImagePrompt({
      prompt: "@old-library:1 a chase scene", connectedReferences: [library],
      provider: "nano-banana-pro", referenceFormat: "hybrid",
    })
    expect(unlocked.prompt).not.toContain("Lock the exact setting")
  })

  it("LEGACY (no referenceFormat) unchanged → still the block, not the hybrid phrase", () => {
    const out = buildImagePrompt({
      prompt: "@old-library:1 scene", connectedReferences: [library], provider: "nano-banana-pro",
    })
    // legacy still uses the location block / legacy directive form
    expect(out.prompt).not.toContain("the background from reference image A")
  })
})
