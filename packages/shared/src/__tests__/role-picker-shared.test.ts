/**
 * Unified Reference Roles — Phase D Task 1 (shared role-picker support).
 *
 * Two shared changes that back the editor role-picker (Tasks 2-3):
 *
 *  (A) Custom-role VERBATIM relaxation in the HYBRID resolvers — a free-form
 *      role typed in a mention's variant/role slot (e.g. `@kira:1:earrings`)
 *      that doesn't resolve to a real matched variant now survives verbatim
 *      ("the earrings from …") instead of collapsing to the source default
 *      ("the person from …"). Applies to character (image + video) and location.
 *
 *  (B) Location bare-slug ROLE parsing — a slash-less, non-mode 3rd segment now
 *      parses as a role (previously null → literal text). The F2 follow-up
 *      REMOVED the preset gate, so a CUSTOM slug (`@old-library:1:foobar`) parses
 *      as `role: "foobar"` too, mirroring the character parser. Legacy stays
 *      byte-identical NOT via the parser but via the resolver's `if (t.role)
 *      continue` guard — a role token (preset OR custom) is skipped in the legacy
 *      path, so it stays literal text with no bullet / phrase promotion.
 *      `normalizeRoleSlug` maps the slug back to the phrase key so the non-noun
 *      specials (`empty-background` → `empty background`) key `roleToPhrase`
 *      correctly; a custom slug passes through verbatim.
 *
 * Existing `@-mention` / variant / mode parsing + the legacy resolvers stay
 * byte-identical — those suites are the guard.
 */
import { describe, it, expect } from "vitest"
import { buildImagePrompt } from "../prompt-builder.js"
import { resolveVideoReferenceCore } from "../video-reference-resolver.js"
import { parseLocationMentionToken } from "../location-mention-slug.js"
import { normalizeRoleSlug } from "../reference-roles.js"
import type { ConnectedReference } from "../types.js"

const kira: ConnectedReference = {
  id: "k", defaultName: "Kira", source: "wired-character",
  url: "https://cdn/kira.png", characterSlug: "kira",
}
const library: ConnectedReference = {
  id: "l", defaultName: "Old Library", source: "wired-location",
  url: "https://cdn/library.png", locationSlug: "old-library",
}

describe("(A) character custom-role verbatim relaxation — image hybrid", () => {
  it("PRESET role-only @kira:1:clothes → 'the clothes from reference image A' (pin)", () => {
    const out = buildImagePrompt({
      provider: "nano-banana-pro",
      prompt: "@kira:1:clothes on a runway",
      connectedReferences: [kira],
      referenceFormat: "hybrid",
    })
    expect(out.prompt).toContain("the clothes from reference image A on a runway")
    expect(out.prompt).not.toContain("Use these characters:")
  })

  it("CUSTOM role @kira:1:earrings → 'the earrings from reference image A' (NOT 'person')", () => {
    const out = buildImagePrompt({
      provider: "nano-banana-pro",
      prompt: "@kira:1:earrings on a runway",
      connectedReferences: [kira],
      referenceFormat: "hybrid",
    })
    expect(out.prompt).toContain("the earrings from reference image A on a runway")
    expect(out.prompt).not.toContain("the person from reference image A")
    expect(out.referenceImageUrls).toContain("https://cdn/kira.png")
  })
})

describe("(A) character custom-role verbatim relaxation — video hybrid", () => {
  it("CUSTOM role @kira:1:earrings → 'the earrings from @image_1' (NOT 'person')", () => {
    const out = resolveVideoReferenceCore({
      prompt: "@kira:1:earrings spins", wiredCharRefs: [kira], hybridRoles: true,
    })
    expect(out.prompt).toContain("the earrings from @image_1 spins")
    expect(out.prompt).not.toContain("the person from @image_1")
    expect(out.additionalUrls).toContain("https://cdn/kira.png")
  })

  it("PRESET role @kira:1:face → 'the face from @image_1' (pin, unchanged)", () => {
    const out = resolveVideoReferenceCore({
      prompt: "@kira:1:face runs", wiredCharRefs: [kira], hybridRoles: true,
    })
    expect(out.prompt).toContain("the face from @image_1 runs")
  })
})

describe("(B) location bare-slug role parsing — image hybrid", () => {
  it("@old-library:1:background → 'the background from reference image A', token replaced inline", () => {
    const out = buildImagePrompt({
      provider: "nano-banana-pro",
      prompt: "@old-library:1:background a chase scene",
      connectedReferences: [library],
      referenceFormat: "hybrid",
    })
    expect(out.prompt).toContain("the background from reference image A")
    // Token resolved → no literal slug left behind, no legacy block.
    expect(out.prompt).not.toContain("@old-library:1:background")
    expect(out.prompt).not.toContain("Use these locations:")
    expect(out.referenceImageUrls).toContain("https://cdn/library.png")
  })

  it("@old-library:1:empty-background → 'the background … (without its foreground objects)'", () => {
    const out = buildImagePrompt({
      provider: "nano-banana-pro",
      prompt: "@old-library:1:empty-background a chase scene",
      connectedReferences: [library],
      referenceFormat: "hybrid",
    })
    expect(out.prompt).toContain(
      "the background from reference image A (without its foreground objects)",
    )
    expect(out.prompt).not.toContain("@old-library:1:empty-background")
  })

  it("CUSTOM role @old-library:1:foobar → 'the foobar from reference image A' (verbatim, F2)", () => {
    const out = buildImagePrompt({
      provider: "nano-banana-pro",
      prompt: "@old-library:1:foobar a chase scene",
      connectedReferences: [library],
      referenceFormat: "hybrid",
    })
    expect(out.prompt).toContain("the foobar from reference image A")
    expect(out.prompt).not.toContain("@old-library:1:foobar")
    expect(out.prompt).not.toContain("Use these locations:")
    expect(out.referenceImageUrls).toContain("https://cdn/library.png")
  })
})

describe("(B) location parser additive change — direct", () => {
  it("@old-library:1:background parses as a role (slug stored verbatim)", () => {
    expect(parseLocationMentionToken("@old-library:1:background")).toEqual({
      locationSlug: "old-library", imageIndex: 1,
      bucket: null, variant: null, usageMode: null, role: "background",
    })
  })

  it("@old-library:1:empty-background parses as a role (slug form)", () => {
    expect(parseLocationMentionToken("@old-library:1:empty-background")).toEqual({
      locationSlug: "old-library", imageIndex: 1,
      bucket: null, variant: null, usageMode: null, role: "empty-background",
    })
  })

  it("real variant @old-library:1:weather/rain still parses as a variant (unchanged, no role)", () => {
    expect(parseLocationMentionToken("@old-library:1:weather/rain")).toEqual({
      locationSlug: "old-library", imageIndex: 1,
      bucket: "weather", variant: "rain", usageMode: null,
    })
  })

  it("CUSTOM bare slug @old-library:1:foobar now parses as a role (parser gate removed, F2)", () => {
    expect(parseLocationMentionToken("@old-library:1:foobar")).toEqual({
      locationSlug: "old-library", imageIndex: 1,
      bucket: null, variant: null, usageMode: null, role: "foobar",
    })
  })

  it("known mode @old-library:1:layout still parses as a usage mode (unchanged)", () => {
    expect(parseLocationMentionToken("@old-library:1:layout")).toEqual({
      locationSlug: "old-library", imageIndex: 1,
      bucket: null, variant: null, usageMode: "layout",
    })
  })
})

describe("normalizeRoleSlug (slug ↔ phrase key)", () => {
  it("maps the multi-word location preset slug back to its phrase key", () => {
    expect(normalizeRoleSlug("empty-background")).toBe("empty background")
  })
  it("passes single-token + hyphenated-key roles through unchanged", () => {
    expect(normalizeRoleSlug("background")).toBe("background")
    expect(normalizeRoleSlug("as-is")).toBe("as-is")
  })
  it("passes free-form custom slugs through unchanged", () => {
    expect(normalizeRoleSlug("rooftop-view")).toBe("rooftop-view")
  })
})

describe("legacy (no referenceFormat) is NOT affected by the relaxation", () => {
  it("legacy never emits the hybrid role phrase for char or location mentions", () => {
    const charOut = buildImagePrompt({
      provider: "nano-banana-pro",
      prompt: "@kira:1:earrings poses",
      connectedReferences: [kira],
    })
    expect(charOut.prompt).not.toContain("the earrings from reference image")

    const locOut = buildImagePrompt({
      provider: "nano-banana-pro",
      prompt: "@old-library:1:background scene",
      connectedReferences: [library],
    })
    expect(locOut.prompt).not.toContain("the background from reference image")
  })

  it("CUSTOM location role @old-library:1:foobar stays LITERAL in legacy (byte-identical, F2)", () => {
    // The parser now accepts `foobar` as a role, but the legacy resolver's
    // `if (t.role) continue` guard skips ANY role token (preset or custom): no
    // inline replacement, no bullet, no `Use these locations:` block — the raw
    // token survives verbatim exactly as it did pre-Phase-D (parser → null).
    const out = buildImagePrompt({
      provider: "nano-banana-pro",
      prompt: "@old-library:1:foobar a chase scene",
      connectedReferences: [library],
    })
    expect(out.prompt).toContain("@old-library:1:foobar")
    expect(out.prompt).not.toContain("Use these locations:")
    expect(out.prompt).not.toContain("the foobar from reference image")
  })
})
