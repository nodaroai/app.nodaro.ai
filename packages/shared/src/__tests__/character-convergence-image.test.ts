import { describe, it, expect } from "vitest"
import { buildImagePrompt } from "../prompt-builder.js"
import { expandExtraRefsToConnectedReferences } from "../extra-refs.js"
import { firstSightExtraRole } from "../reference-roles.js"
import type { ConnectedReference } from "../types.js"

const victoria: ConnectedReference = {
  id: "v", defaultName: "Victoria Hayes", source: "wired-character",
  url: "https://cdn/victoria.png", characterSlug: "victoria-hayes",
}

describe("character reference converges onto the image hybrid form", () => {
  it("@-mention with a 'face' role → 'the face from reference image A', no identity-lock by default, no legacy block", () => {
    const out = buildImagePrompt({
      provider: "nano-banana-pro",
      prompt: "@victoria-hayes:1:face standing on a rooftop",
      connectedReferences: [victoria],
      referenceFormat: "hybrid",
    })
    expect(out.prompt).toContain("the face from reference image A standing on a rooftop")
    expect(out.prompt).not.toContain("Lock the exact identity")
    expect(out.prompt).not.toContain("Use these characters:")
    expect(out.referenceImageUrls).toContain("https://cdn/victoria.png")
  })

  it("identity-lock OFF → phrase only, no lock line", () => {
    const out = buildImagePrompt({
      provider: "nano-banana-pro",
      prompt: "@victoria-hayes:1:person on a beach",
      connectedReferences: [{ ...victoria, identityLock: { enabled: false } }],
      referenceFormat: "hybrid",
    })
    expect(out.prompt).toContain("the person from reference image A on a beach")
    expect(out.prompt).not.toContain("Lock the exact identity")
    expect(out.prompt).not.toContain("Use these characters:")
  })

  it("elementInjection (held-prop/styling) survives as a scene directive", () => {
    const out = buildImagePrompt({
      provider: "nano-banana-pro",
      prompt: "@victoria-hayes:1:person in a cafe",
      connectedReferences: [{ ...victoria, elementInjection: "holding a smartphone" }],
      referenceFormat: "hybrid",
    })
    expect(out.prompt).toContain("the person from reference image A in a cafe")
    expect(out.prompt.toLowerCase()).toContain("holding a smartphone")
    expect(out.prompt).not.toContain("Use these characters:")
  })

  it("identity-lock ON (enabled:true) → phrase + lock line", () => {
    const out = buildImagePrompt({
      provider: "nano-banana-pro",
      prompt: "@victoria-hayes:1:person standing on a rooftop",
      connectedReferences: [{ ...victoria, identityLock: { enabled: true } }],
      referenceFormat: "hybrid",
    })
    expect(out.prompt).toContain("the person from reference image A")
    expect(out.prompt).toContain("Lock the exact identity of the person in reference image A")
  })

  it("unmentioned wired character → canonical hybrid phrase, no auto-lock (default off), no legacy block", () => {
    const out = buildImagePrompt({
      prompt: "a cinematic portrait",
      connectedReferences: [victoria],
      provider: "nano-banana-pro",
      referenceFormat: "hybrid",
    })
    expect(out.prompt).toContain("the person from reference image A")
    // identity-lock is opt-in (default OFF) — no lock line unless the ref enables it:
    expect(out.prompt).not.toContain("Lock the exact identity")
    expect(out.prompt).not.toContain("Use these characters:")
    expect(out.referenceImageUrls).toContain("https://cdn/victoria.png")
  })

  it("unmentioned wired character WITH elementInjection → canonical phrase + elementInjection survives (must NOT be silently dropped), no legacy block", () => {
    const out = buildImagePrompt({
      prompt: "a cinematic portrait",
      connectedReferences: [{ ...victoria, elementInjection: "holding a vintage camera" }],
      provider: "nano-banana-pro",
      referenceFormat: "hybrid",
    })
    expect(out.prompt).toContain("the person from reference image A")
    expect(out.prompt.toLowerCase()).toContain("vintage camera")
    expect(out.prompt).not.toContain("Use these characters:")
  })

  it("hybrid extra-ref attaches its URL and surfaces its description (no regression, no legacy block)", () => {
    const extra: ConnectedReference = {
      id: "x", defaultName: "Prop", source: "manual",
      url: "https://cdn/prop.png", description: "a brass lantern", isExtraRef: true,
    }
    const out = buildImagePrompt({
      prompt: "a still life",
      connectedReferences: [extra],
      provider: "nano-banana-pro",
      referenceFormat: "hybrid",
    })
    expect(out.referenceImageUrls).toContain("https://cdn/prop.png")
    expect(out.prompt.toLowerCase()).toContain("brass lantern")
    expect(out.prompt).not.toContain("Use these characters:")
  })

  it("first-sight extra-ref character WITH elementInjection → injection survives as a scene directive (must NOT be silently dropped), no legacy block", () => {
    // A character that appears ONLY as a first-sight extra-ref (not @-mentioned,
    // not a canonical fallback). `variantSlug` makes it a picked-variant extra,
    // which is what excludes it from `selectCanonicalFallbackRefs` (`if
    // (r.variantSlug) continue`) — so `renderExtraRefsHybrid`'s first-sight
    // branch is the ONLY surface for its `elementInjection`. A wired-character
    // extra-ref WITHOUT a variantSlug would also be auto-attached by the
    // canonical fallback (which already surfaces the injection), so it would not
    // exercise — nor genuinely guard — the extra-ref hole this covers.
    const kato: ConnectedReference = {
      id: "k", defaultName: "Kato", source: "wired-character",
      url: "https://cdn/kato.png", characterSlug: "kato", variantSlug: "alt",
      isExtraRef: true, elementInjection: "holding a katana",
      description: "in a dark alley",
    }
    const out = buildImagePrompt({
      provider: "nano-banana-pro",
      prompt: "a cinematic portrait",
      connectedReferences: [kato],
      referenceFormat: "hybrid",
    })
    expect(out.prompt.toLowerCase()).toContain("katana")
    expect(out.referenceImageUrls).toContain("https://cdn/kato.png")
    expect(out.prompt).not.toContain("Use these characters:")
  })

  it("first-sight extra-ref carrying a role (usageMode) → phrase uses THAT role, not the source default (Reference Roles F3)", () => {
    // A first-sight character extra whose per-ref usage-mode override ("style",
    // folded into `defaultUsageMode` by `expandExtraRefsToConnectedReferences`)
    // is a curated preset → the hybrid phrase must read "the style from …",
    // aligned UP to the video extras first-sight formula. Before F3 the image
    // side ALWAYS emitted the source default ("the person from …").
    const stylist: ConnectedReference = {
      id: "s", defaultName: "Kira / look", source: "wired-character",
      url: "https://cdn/kira-look.png", characterSlug: "kira", variantSlug: "look",
      defaultUsageMode: "style", isExtraRef: true,
    }
    const out = buildImagePrompt({
      provider: "nano-banana-pro",
      prompt: "a portrait",
      connectedReferences: [stylist],
      referenceFormat: "hybrid",
    })
    expect(out.prompt).toContain("the style from reference image A")
    expect(out.prompt).not.toContain("the person from reference image A")
    expect(out.prompt).not.toContain("Use these characters:")
  })

  it("first-sight extra-ref with NO role → source default phrase (unchanged)", () => {
    // No usage-mode override + a non-preset variant ("alt") → the source default
    // ("person"), byte-identical to the pre-F3 behavior for role-less extras.
    const plain: ConnectedReference = {
      id: "p", defaultName: "Kira / alt", source: "wired-character",
      url: "https://cdn/kira-alt.png", characterSlug: "kira", variantSlug: "alt",
      isExtraRef: true,
    }
    const out = buildImagePrompt({
      provider: "nano-banana-pro",
      prompt: "a portrait",
      connectedReferences: [plain],
      referenceFormat: "hybrid",
    })
    expect(out.prompt).toContain("the person from reference image A")
    expect(out.prompt).not.toContain("Use these characters:")
  })

  it("INVARIANT: image extra role reflects the COALESCED char-node default via the REAL expander, and diverges from the video RAW formula (Reference Roles F3 review)", () => {
    // Build the extra the way PRODUCTION does — a raw `ExtraRefInput` with NO
    // per-ref usageMode override — and run it through the REAL
    // `expandExtraRefsToConnectedReferences`, not a hand-built ConnectedReference.
    // The expander coalesces `usageMode` → char-node default → "identical" into
    // `defaultUsageMode`, so for a character extra that field is ALWAYS defined.
    // The RAW extra input as production produces it: character-sourced, no
    // per-ref usageMode override, a non-preset picked variant ("look").
    const rawExtra: { url: string; characterSlug: string; variantSlug: string; usageMode?: "style" } = {
      url: "https://cdn/kira-look.png",
      characterSlug: "kira",
      variantSlug: "look",
    }
    const expanded = expandExtraRefsToConnectedReferences(
      [rawExtra],
      (slug) => (slug === "kira" ? { defaultUsageMode: "style", displayName: "Kira" } : undefined),
    )
    // The char-node default was coalesced in — never undefined for a char extra,
    // which is exactly why the image call needs NO `?? variantSlug` fallback
    // (the dropped dead code could never have fired here).
    expect(expanded).toHaveLength(1)
    expect(expanded[0].defaultUsageMode).toBe("style")

    const out = buildImagePrompt({
      provider: "nano-banana-pro",
      prompt: "a portrait",
      connectedReferences: expanded,
      referenceFormat: "hybrid",
    })
    // IMAGE side reads the COALESCED `defaultUsageMode` → honors the char-node
    // default even though the extra carried no per-ref override.
    expect(out.prompt).toContain("the style from reference image A")
    expect(out.prompt).not.toContain("the person from reference image A")
    expect(out.prompt).not.toContain("Use these characters:")

    // DIVERGENCE PIN: the VIDEO extras path shares `firstSightExtraRole` but feeds
    // the RAW per-ref `usageMode ?? variantSlug` (here `undefined ?? "look"` →
    // "look", not a preset → the source default "person"). It does NOT inherit
    // the char-node default. Image === "style", video === "person" for the SAME
    // logical extra. True convergence is deferred (a live-prompt decision); this
    // asserts the current, intentional split so it can't silently change.
    const imageRole = firstSightExtraRole(expanded[0].defaultUsageMode, "wired-character")
    // Mirror the video resolver's exact input: RAW `usageMode ?? variantSlug`.
    const videoRole = firstSightExtraRole(rawExtra.usageMode ?? rawExtra.variantSlug, "wired-character")
    expect(imageRole).toBe("style")
    expect(videoRole).toBe("person")
    expect(imageRole).not.toBe(videoRole)
  })
})
