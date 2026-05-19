import { describe, it, expect } from "vitest"
import { parseLocationRefMatch } from "../prompt-editor/location-ref-extension"
import { collectTokens, type KnownSlugSets } from "../prompt-editor"

/**
 * Tests for the slice 3 (Phase 2 #2) location @-mention plumbing in the
 * PromptEditor. These exercise the two pure helpers that the rest of the
 * editor wiring depends on:
 *
 *   - `parseLocationRefMatch` — single-token parser used by the extension's
 *     input/paste rules and the editor's `valueToDoc` scanner. Mirrors the
 *     shape of `parseLocationMentionToken` from `@nodaro/shared` so the pill
 *     ↔ raw-text round trip is lossless.
 *
 *   - `collectTokens` — line-level scanner that converts a raw prompt string
 *     into ProseMirror JSON nodes, deciding which `@<slug>:N`-shaped tokens
 *     get promoted to violet character pills, cyan location pills, or stay
 *     as plain text (when the slug isn't known to the editor).
 */

function known(opts: { chars?: string[]; locs?: string[] } = {}): KnownSlugSets {
  return {
    characters: new Set(opts.chars ?? []),
    locations: new Set(opts.locs ?? []),
  }
}

describe("parseLocationRefMatch", () => {
  describe("accepts all 4 supported slug shapes", () => {
    it("parses 2-part canonical @<slug>:N", () => {
      const attrs = parseLocationRefMatch("@oldlibrary:1")
      expect(attrs).toEqual({
        locationSlug: "oldlibrary",
        imageIndex: 1,
        bucket: null,
        variant: null,
        usageMode: null,
      })
    })

    it("parses 3-part mode-only @<slug>:N:<mode>", () => {
      const attrs = parseLocationRefMatch("@oldlibrary:1:layout")
      expect(attrs).toEqual({
        locationSlug: "oldlibrary",
        imageIndex: 1,
        bucket: null,
        variant: null,
        usageMode: "layout",
      })
    })

    it("parses 3-part bucket/variant @<slug>:N:<bucket>/<variant>", () => {
      const attrs = parseLocationRefMatch("@oldlibrary:1:weather/rain")
      expect(attrs).toEqual({
        locationSlug: "oldlibrary",
        imageIndex: 1,
        bucket: "weather",
        variant: "rain",
        usageMode: null,
      })
    })

    it("parses 4-part bucket/variant + mode @<slug>:N:<bucket>/<variant>:<mode>", () => {
      const attrs = parseLocationRefMatch("@oldlibrary:1:weather/rain:style")
      expect(attrs).toEqual({
        locationSlug: "oldlibrary",
        imageIndex: 1,
        bucket: "weather",
        variant: "rain",
        usageMode: "style",
      })
    })
  })

  describe("rejection cases", () => {
    it("returns null for an unknown mode in the 3-part form", () => {
      // Third segment is a bare slug but not a valid LocationUsageMode.
      expect(parseLocationRefMatch("@oldlibrary:1:foo")).toBeNull()
    })

    it("returns null for an unknown mode in the 4-part form", () => {
      expect(parseLocationRefMatch("@oldlibrary:1:weather/rain:bogus")).toBeNull()
    })

    it("returns null for a 4-part token without a bucket/variant 3rd segment", () => {
      // 4-part shape requires the 3rd segment to be bucket/variant — a bare
      // mode keyword as 3rd + another segment after is invalid.
      expect(parseLocationRefMatch("@oldlibrary:1:layout:style")).toBeNull()
    })

    it("returns null for missing leading @", () => {
      expect(parseLocationRefMatch("oldlibrary:1")).toBeNull()
    })

    it("returns null for a zero or negative index", () => {
      expect(parseLocationRefMatch("@oldlibrary:0")).toBeNull()
    })

    it("returns null for character-only modes (face / pose / etc.)", () => {
      // Character modes that don't apply to scenes — 4-mode subset enforced
      // by `isLocationUsageMode`.
      expect(parseLocationRefMatch("@oldlibrary:1:face")).toBeNull()
      expect(parseLocationRefMatch("@oldlibrary:1:weather/rain:pose")).toBeNull()
    })
  })
})

describe("collectTokens", () => {
  it("returns no tokens for plain text", () => {
    const out = collectTokens("just some words here", known())
    expect(out).toEqual([])
  })

  it("converts a {image:N:label} token into an imageRef node", () => {
    const out = collectTokens("see {image:2:dragon} here", known())
    expect(out).toHaveLength(1)
    expect(out[0].node.type).toBe("imageRef")
    expect(out[0].node.attrs).toEqual({ imageIndex: 2, label: "dragon" })
  })

  it("leaves a typed @<slug>:N alone when the slug is in neither known set", () => {
    // No `kira` in characters and no `kira` in locations — the @-mention
    // should NOT auto-promote. This is the conflict-avoidance gate.
    const out = collectTokens("hello @kira:1 world", known())
    expect(out).toEqual([])
  })

  it("promotes a known character slug to a characterRef node", () => {
    const out = collectTokens("hello @kira:1 world", known({ chars: ["kira"] }))
    expect(out).toHaveLength(1)
    expect(out[0].node.type).toBe("characterRef")
    expect(out[0].node.attrs).toMatchObject({
      characterSlug: "kira",
      imageIndex: 1,
      variantSlug: null,
      usageMode: null,
    })
  })

  it("promotes a known location slug to a locationRef node (2-part)", () => {
    const out = collectTokens(
      "scene @oldlibrary:1 night",
      known({ locs: ["oldlibrary"] }),
    )
    expect(out).toHaveLength(1)
    expect(out[0].node.type).toBe("locationRef")
    expect(out[0].node.attrs).toMatchObject({
      locationSlug: "oldlibrary",
      imageIndex: 1,
      bucket: null,
      variant: null,
      usageMode: null,
    })
  })

  it("promotes a known location slug to a locationRef node (3-part bucket/variant)", () => {
    const out = collectTokens(
      "@oldlibrary:1:weather/rain at dusk",
      known({ locs: ["oldlibrary"] }),
    )
    expect(out).toHaveLength(1)
    expect(out[0].node.type).toBe("locationRef")
    expect(out[0].node.attrs).toMatchObject({
      locationSlug: "oldlibrary",
      imageIndex: 1,
      bucket: "weather",
      variant: "rain",
      usageMode: null,
    })
  })

  it("promotes a known location slug to a locationRef node (4-part bucket/variant + mode)", () => {
    const out = collectTokens(
      "@oldlibrary:1:weather/rain:layout please",
      known({ locs: ["oldlibrary"] }),
    )
    expect(out).toHaveLength(1)
    expect(out[0].node.type).toBe("locationRef")
    expect(out[0].node.attrs).toMatchObject({
      locationSlug: "oldlibrary",
      imageIndex: 1,
      bucket: "weather",
      variant: "rain",
      usageMode: "layout",
    })
  })

  it("interleaves character, location, and image tokens by document order", () => {
    const line = "@kira:1 visits {image:2:relic} at @oldlibrary:1"
    const out = collectTokens(
      line,
      known({ chars: ["kira"], locs: ["oldlibrary"] }),
    )
    expect(out).toHaveLength(3)
    // Ordered by `start` offset.
    expect(out.map((t) => t.node.type)).toEqual(["characterRef", "imageRef", "locationRef"])
  })

  it("disambiguates a 2-part @<slug>:N to LOCATION when the slug is in locations only", () => {
    // The slug exists ONLY in the locations set — must NOT become a character pill.
    const out = collectTokens(
      "@oldlibrary:1",
      known({ chars: ["kira"], locs: ["oldlibrary"] }),
    )
    expect(out).toHaveLength(1)
    expect(out[0].node.type).toBe("locationRef")
  })

  it("disambiguates a 2-part @<slug>:N to CHARACTER when the slug is in characters only", () => {
    const out = collectTokens(
      "@kira:1",
      known({ chars: ["kira"], locs: ["oldlibrary"] }),
    )
    expect(out).toHaveLength(1)
    expect(out[0].node.type).toBe("characterRef")
  })

  it("dedupes overlapping matches (prefers the first match — location)", () => {
    // When the same slug is in BOTH sets (unusual but defensive), the
    // location matcher runs first (matchAll above the character matcher),
    // and the dedup step drops the character entry that maps to the same
    // span. This keeps the doc well-formed even with conflicting known
    // sets.
    const out = collectTokens(
      "@ambiguous:1",
      known({ chars: ["ambiguous"], locs: ["ambiguous"] }),
    )
    expect(out).toHaveLength(1)
    expect(out[0].node.type).toBe("locationRef")
  })

  it("promotes the full bucket/variant form to a location pill when the slug is a location", () => {
    // `@oldlibrary:1:weather/rain` is a valid LOCATION token shape. When
    // the slug is known as a location, the full bucket/variant is captured
    // into one cyan pill.
    const out = collectTokens(
      "@oldlibrary:1:weather/rain",
      known({ locs: ["oldlibrary"] }),
    )
    expect(out).toHaveLength(1)
    expect(out[0].node.type).toBe("locationRef")
    expect(out[0].node.attrs).toMatchObject({
      bucket: "weather",
      variant: "rain",
    })
  })

  it("falls back to character pill (variant=weather) when slug is character-only — trailing /rain stays as text", () => {
    // When `@kira:1:weather/rain` is encountered with `kira` known as a
    // character but NOT as a location, the character regex matches
    // `@kira:1:weather` (variant="weather") and the trailing `/rain`
    // remains as plain text. This documents the parser's behavior — it's
    // an unusual input shape (mixing the character grammar with a slash)
    // but the dedup step keeps the output well-formed.
    const out = collectTokens(
      "@kira:1:weather/rain",
      known({ chars: ["kira"] }),
    )
    expect(out).toHaveLength(1)
    expect(out[0].node.type).toBe("characterRef")
    expect(out[0].node.attrs).toMatchObject({
      characterSlug: "kira",
      imageIndex: 1,
      variantSlug: "weather",
    })
  })
})
