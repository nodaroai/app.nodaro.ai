import { describe, it, expect } from "vitest"
import {
  imageMentionSlug,
  parseImageMentionToken,
  findImageMentionTokens,
  knownImageSlugsFromRefs,
} from "../image-mention-slug.js"
import type { ConnectedReference } from "../types.js"

/**
 * Named-image mentions — `@<name-slug>:<index>[:<role>]`.
 *
 * Mirrors `location-mention-slug.test.ts`, minus everything locations have and
 * media references don't (buckets, variants, usage modes). The load-bearing
 * assertions here are the two that keep this parser from colliding with the
 * other two grammars: a 4-part token is NEVER claimed, and the known-slug set
 * drops grammar-invalid slugs.
 */

const media = (over: Partial<ConnectedReference> = {}): ConnectedReference => ({
  id: "img-1",
  defaultName: "Town",
  source: "wired-image",
  url: "https://cdn/town.png",
  ...over,
})

describe("imageMentionSlug", () => {
  it("lowercases and dash-joins", () => {
    expect(imageMentionSlug("Town")).toBe("town")
    expect(imageMentionSlug("Old Town Square")).toBe("old-town-square")
  })

  it("collapses punctuation runs and strips leading/trailing dashes", () => {
    expect(imageMentionSlug("  Town -- Square!! ")).toBe("town-square")
    expect(imageMentionSlug("--town--")).toBe("town")
  })

  it("keeps digits, including a leading one (emptiness is NOT the grammar gate)", () => {
    // Non-empty yet UNPARSEABLE — the leading digit fails IMAGE_SLUG_PATTERN.
    // `knownImageSlugsFromRefs` is what must drop it, not this function.
    expect(imageMentionSlug("3D Render")).toBe("3d-render")
  })

  it("returns empty for a name with no latin alphanumerics", () => {
    expect(imageMentionSlug("עיר")).toBe("")
    expect(imageMentionSlug("🎬🎬")).toBe("")
  })

  it("is byte-identical to the character/location slug algorithm", () => {
    for (const name of ["Kira", "Old Library", "A  B", "Ünï-cödé 12"]) {
      expect(imageMentionSlug(name)).toBe(
        name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, ""),
      )
    }
  })
})

describe("parseImageMentionToken — rejects", () => {
  it("rejects text that is not a token at all", () => {
    expect(parseImageMentionToken("town:1")).toBeNull()   // no @
    expect(parseImageMentionToken("@")).toBeNull()
    expect(parseImageMentionToken("@town")).toBeNull()    // no index segment
    expect(parseImageMentionToken("@town:")).toBeNull()   // empty index
  })

  it("rejects a non-positive or non-numeric index", () => {
    expect(parseImageMentionToken("@town:0")).toBeNull()
    expect(parseImageMentionToken("@town:x")).toBeNull()
    expect(parseImageMentionToken("@town:1x")).toBeNull()
  })

  it("rejects out-of-grammar slugs", () => {
    expect(parseImageMentionToken("@Town:1")).toBeNull()  // uppercase
    expect(parseImageMentionToken("@3d:1")).toBeNull()    // leading digit
    expect(parseImageMentionToken("@-town:1")).toBeNull() // leading dash
  })

  it("rejects a FOUR-part token — the collision guard against character mentions", () => {
    expect(parseImageMentionToken("@town:1:a:b")).toBeNull()
    expect(parseImageMentionToken("@kira:1:smile:face")).toBeNull()
  })

  it("rejects an empty or out-of-grammar role segment", () => {
    expect(parseImageMentionToken("@town:1:")).toBeNull()
    expect(parseImageMentionToken("@town:1:Bad")).toBeNull()
    expect(parseImageMentionToken("@town:1:1st")).toBeNull()
  })
})

describe("parseImageMentionToken — accepts", () => {
  it("parses a bare 2-part token and emits NO role key", () => {
    const parsed = parseImageMentionToken("@town:3")
    expect(parsed).toEqual({ imageSlug: "town", imageIndex: 3 })
    // Shape rule: a 2-part token must stay shape-identical to a role-less parser.
    expect(parsed && "role" in parsed).toBe(false)
    expect(parsed && "lock" in parsed).toBe(false)
  })

  it("parses a curated role in the 3rd segment", () => {
    expect(parseImageMentionToken("@town:3:background")).toEqual({
      imageSlug: "town",
      imageIndex: 3,
      role: "background",
    })
  })

  it("passes a CUSTOM role through verbatim", () => {
    expect(parseImageMentionToken("@town:3:my-custom-role")).toEqual({
      imageSlug: "town",
      imageIndex: 3,
      role: "my-custom-role",
    })
  })

  it("parses the ~lock / ~nolock sentinels as a tri-state", () => {
    expect(parseImageMentionToken("@town:3~lock")).toEqual({
      imageSlug: "town", imageIndex: 3, lock: true,
    })
    expect(parseImageMentionToken("@town:3~nolock")).toEqual({
      imageSlug: "town", imageIndex: 3, lock: false,
    })
    expect(parseImageMentionToken("@town:3:background~nolock")).toEqual({
      imageSlug: "town", imageIndex: 3, role: "background", lock: false,
    })
  })

  it("accepts a multi-segment slug and a large index", () => {
    expect(parseImageMentionToken("@old-town-square:12")).toEqual({
      imageSlug: "old-town-square",
      imageIndex: 12,
    })
  })
})

describe("findImageMentionTokens", () => {
  it("finds a known slug and reports its exact offset", () => {
    const prompt = "a shot of @town:3 at dusk"
    const [t] = findImageMentionTokens(prompt, ["town"])
    expect(t.token).toBe("@town:3")
    expect(t.imageSlug).toBe("town")
    expect(t.imageIndex).toBe(3)
    expect(prompt.slice(t.offset, t.offset + t.token.length)).toBe("@town:3")
  })

  it("matches a token at the very start of the prompt", () => {
    const [t] = findImageMentionTokens("@town:1 at dusk", ["town"])
    expect(t.offset).toBe(0)
    expect(t.token).toBe("@town:1")
  })

  it("filters out slugs that are not known", () => {
    expect(findImageMentionTokens("a shot of @town:3", [])).toEqual([])
    expect(findImageMentionTokens("a shot of @town:3", ["village"])).toEqual([])
  })

  it("does not match an email-like `a@town:1` (preceding alphanumeric)", () => {
    expect(findImageMentionTokens("mail a@town:1 now", ["town"])).toEqual([])
  })

  it("yields NO token for a 4-part CHARACTER token, even when the slug is a known image", () => {
    // The `(?![:a-z0-9-])` lookahead: without it this would be captured as the
    // 3-part `@kira:1:smile`, leaving `:face` dangling in the prompt.
    expect(findImageMentionTokens("@kira:1:smile:face poses", ["kira"])).toEqual([])
  })

  it("does not swallow `~locked` as a sentinel (byte-identical to the location finder)", () => {
    // The sentinel's own `(?![a-z0-9-])` rejects `~locked`, so the regex falls
    // back to the bare `@town:1` and the `~locked` text stays literal — exactly
    // what `findLocationMentionTokens` does for the same input.
    const [t] = findImageMentionTokens("@town:1~locked", ["town"])
    expect(t.token).toBe("@town:1")
    expect("lock" in t).toBe(false)
  })

  it("does claim the sentinel when it is well-formed", () => {
    const [t] = findImageMentionTokens("@town:1~lock", ["town"])
    expect(t.token).toBe("@town:1~lock")
    expect(t.lock).toBe(true)
  })

  it("finds several mentions in prompt order", () => {
    const tokens = findImageMentionTokens("@town:1 then @barn:2:background", ["town", "barn"])
    expect(tokens.map((t) => t.token)).toEqual(["@town:1", "@barn:2:background"])
    expect(tokens[1].role).toBe("background")
  })
})

describe("knownImageSlugsFromRefs", () => {
  it("includes wired-image and manual media refs", () => {
    expect(
      knownImageSlugsFromRefs([
        media(),
        media({ id: "m", defaultName: "My Upload", source: "manual", url: "https://cdn/u.png" }),
      ]),
    ).toEqual(["town", "my-upload"])
  })

  it("excludes every non-media source", () => {
    expect(
      knownImageSlugsFromRefs([
        media({ source: "wired-character", defaultName: "Kira" }),
        media({ source: "wired-location", defaultName: "Old Library" }),
        media({ source: "wired-object", defaultName: "Chair" }),
        media({ source: "wired-creature", defaultName: "Ember" }),
      ]),
    ).toEqual([])
  })

  it("excludes extra refs (they render through the extras path)", () => {
    expect(knownImageSlugsFromRefs([media({ isExtraRef: true })])).toEqual([])
  })

  it("excludes url-less and name-less refs", () => {
    expect(knownImageSlugsFromRefs([media({ url: "" })])).toEqual([])
    expect(knownImageSlugsFromRefs([media({ defaultName: "" })])).toEqual([])
  })

  it("drops a grammar-invalid slug even though it is non-empty", () => {
    // "3D Render" → "3d-render": truthy, but no token can ever match it.
    expect(knownImageSlugsFromRefs([media({ defaultName: "3D Render" })])).toEqual([])
    expect(knownImageSlugsFromRefs([media({ defaultName: "🎬" })])).toEqual([])
  })

  it("dedupes refs that slug to the same name", () => {
    expect(
      knownImageSlugsFromRefs([
        media({ id: "a", defaultName: "Upload Image", url: "https://cdn/a.png" }),
        media({ id: "b", defaultName: "Upload Image", url: "https://cdn/b.png" }),
      ]),
    ).toEqual(["upload-image"])
  })

  it("is the exact gate the finder uses (no slug in the set is unmatchable)", () => {
    const refs = [media(), media({ id: "b", defaultName: "3D Render", url: "https://cdn/b.png" })]
    const slugs = knownImageSlugsFromRefs(refs)
    for (const slug of slugs) {
      expect(findImageMentionTokens(`@${slug}:1`, slugs)).toHaveLength(1)
    }
  })
})
