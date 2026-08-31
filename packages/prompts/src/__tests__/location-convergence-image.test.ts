import { describe, it, expect } from "vitest"
import { buildImagePrompt } from "../prompt-builder.js"
import type { ConnectedReference } from "@nodaro/shared"

// Location token format is `@slug:N(:bucket/variant)?(:mode)?` per
// `findLocationMentionTokens` — the canonical mention is just `@slug:N`.
const library: ConnectedReference = {
  id: "l", defaultName: "Old Library", source: "wired-location",
  url: "https://cdn/library.png", locationSlug: "old-library",
}

describe("location reference converges onto the image hybrid form", () => {
  // The DEFAULT role for a wired location became "location" (2026-08-05) — a
  // place, not a backdrop to paste. This assertion previously pinned "the
  // background from …", the wording measured to produce cut-out composites.
  // The explicit `:background` token below is unaffected and still renders it.
  it("wired location (canonical) → 'the location from reference image A', no legacy block", () => {
    const out = buildImagePrompt({
      prompt: "a detective at her desk", connectedReferences: [library],
      provider: "nano-banana-pro", referenceFormat: "hybrid",
    })
    expect(out.prompt).toContain("the location from reference image A")
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

  // A PLACE, NOT A BACKDROP — the `identical` usage mode (which IS
  // `DEFAULT_LOCATION_USAGE_MODE`, i.e. what a bare `@old-library:1` resolves to)
  // used to render "the background from reference image A". That is the exact
  // wording measured on gpt-image-2 to produce cut-out composites, and the reason
  // `DEFAULT_LABEL_BY_SOURCE["wired-location"]` became "location" on 2026-08-05;
  // the mode map missed that fix. An EXPLICIT `:background` token still renders
  // the backdrop wording (pinned in the Phase-D guard below).
  it("bare @-mention (identical = the default mode) → 'the location from reference image A'", () => {
    const out = buildImagePrompt({
      prompt: "@old-library:1 a chase scene",
      connectedReferences: [library],
      provider: "nano-banana-pro", referenceFormat: "hybrid",
    })
    expect(out.prompt).toContain("the location from reference image A")
    expect(out.prompt).not.toContain("the background from reference image")
    expect(out.prompt).not.toContain("Use these locations:")
  })

  it("explicit :identical mode → the same 'the location from …' phrase", () => {
    const out = buildImagePrompt({
      prompt: "@old-library:1:identical a chase scene",
      connectedReferences: [library],
      provider: "nano-banana-pro", referenceFormat: "hybrid",
    })
    expect(out.prompt).toContain("the location from reference image A")
    expect(out.prompt).not.toContain("the background from reference image")
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
    expect(locked.prompt).toContain("the location from reference image A")
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

/**
 * Phase D restored-legacy guard (the review blocker). Pre-Phase-D the bare-slug
 * ROLE tokens — `@old-library:1:background` / `:atmosphere` / `:as-is` /
 * `:empty-background` / `:lighting` — did NOT parse, so they stayed literal text
 * on the prod-default LEGACY path. The additive Phase-D parser now PARSES them
 * (with `role` set), but `resolveLocationMentions` (legacy) must STILL leave them
 * untouched so legacy stays byte-identical. The HYBRID resolver SHOULD resolve
 * them to the inline role phrase — pinned here so the two paths can't silently
 * converge again. (`layout`/`style` were already usage modes → unaffected.)
 */
describe("Phase D legacy guard: bare-slug ROLE location tokens", () => {
  it("LEGACY: @old-library:1:background stays literal — no bullet, no inline swap, no hybrid phrase", () => {
    const out = buildImagePrompt({
      prompt: "@old-library:1:background a scene",
      connectedReferences: [library],
      provider: "nano-banana-pro",
      // no referenceFormat → legacy (the prod default)
    })
    // The role token is left verbatim (literal text exactly as pre-Phase-D).
    expect(out.prompt).toContain("@old-library:1:background")
    // No legacy mention bullet claimed by the role token.
    expect(out.prompt).not.toContain("Use these locations:")
    // No hybrid role phrase leaking onto the legacy path.
    expect(out.prompt).not.toContain("the background from reference image")
  })

  it("LEGACY: the other four role slugs (:atmosphere/:as-is/:empty-background/:lighting) also stay literal", () => {
    for (const slug of ["atmosphere", "as-is", "empty-background", "lighting"]) {
      const token = `@old-library:1:${slug}`
      const out = buildImagePrompt({
        prompt: `${token} a scene`,
        connectedReferences: [library],
        provider: "nano-banana-pro",
      })
      expect(out.prompt).toContain(token)
      expect(out.prompt).not.toContain("Use these locations:")
    }
  })

  it("HYBRID counterpart still resolves the role → 'the background from reference image A'", () => {
    const out = buildImagePrompt({
      prompt: "@old-library:1:background a scene",
      connectedReferences: [library],
      provider: "nano-banana-pro",
      referenceFormat: "hybrid",
    })
    expect(out.prompt).toContain("the background from reference image A")
    // Token consumed by the inline phrase, not left raw.
    expect(out.prompt).not.toContain("@old-library:1:background")
    expect(out.prompt).not.toContain("Use these locations:")
    expect(out.referenceImageUrls).toContain("https://cdn/library.png")
  })
})
