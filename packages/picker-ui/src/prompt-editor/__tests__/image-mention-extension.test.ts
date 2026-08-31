import { describe, it, expect, vi } from "vitest"
import { generateText, type JSONContent } from "@tiptap/core"
import { Document } from "@tiptap/extension-document"
import { Paragraph } from "@tiptap/extension-paragraph"
import { Text } from "@tiptap/extension-text"

/**
 * Contract tests for the NAME-addressed `@<name-slug>:<index>[:<role>]` media
 * mention pill — the sibling of the POSITIONAL `{image:N}` `imageRef` pill.
 *
 * The load-bearing invariant is the same one the character / location / video /
 * audio pills carry: the pill is a PURE DISPLAY layer, so
 *
 *   serialize(node) → the exact token text → parse → the same node attrs
 *
 * must be lossless against the SHARED grammar (`packages/shared/src/
 * image-mention-slug.ts`). Two assertion surfaces:
 *
 *   - `generateText` over a real ProseMirror doc, which exercises the node's
 *     own `renderText` (what `editor.getText()` emits and what is persisted to
 *     `node.data.prompt`);
 *   - `resolvePromotableAttrs`, the exact decision function BOTH the input rule
 *     and the paste rule call, so the promotion gate is tested faithfully
 *     without driving TipTap end-to-end in jsdom (mirroring
 *     `location-ref-extension-legacy-role-gate.test.ts`).
 *
 * The reference-format constant is mocked through a hoisted holder so this one
 * file can drive BOTH formats — the module reads the live binding at call time,
 * so flipping `fmt.value` between tests is enough.
 */
const fmt = vi.hoisted(() => ({ value: "hybrid" as "legacy" | "hybrid" }))

vi.mock("../lib/image-reference-format", () => ({
  get IMAGE_REFERENCE_FORMAT() {
    return fmt.value
  },
}))

// eslint-disable-next-line import/first
import { ImageMentionExtension, resolvePromotableAttrs } from "../image-mention-extension"
// eslint-disable-next-line import/first
import { imageMentionSlugForItem, knownImageMentionSlugs } from "../lib/image-mention-refs"
// eslint-disable-next-line import/first
import { collectTokens, type KnownSlugSets } from "../index"
// eslint-disable-next-line import/first
import type { RefImageItem } from "../editor-types"

const EXTENSIONS = [Document, Paragraph, Text, ImageMentionExtension]

/** Serialize one pill through its real `renderText`. */
function serialize(attrs: Record<string, unknown>): string {
  const doc: JSONContent = {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "imageMention", attrs }] }],
  }
  return generateText(doc, EXTENSIONS, { blockSeparator: "\n" })
}

const KNOWN = new Set(["town", "barn"])

const item = (over: Partial<RefImageItem>): RefImageItem =>
  ({ url: "https://x/i.png", label: "Town", source: "wired", index: 1, defaultLabel: "", ...over })

const known = (over?: Partial<KnownSlugSets>): KnownSlugSets => ({
  characters: new Set<string>(),
  locations: new Set<string>(),
  images: KNOWN,
  snippets: [],
  ...over,
})

describe("imageMention — renderText (pill → token)", () => {
  it("serializes a 2-part mention", () => {
    expect(serialize({ imageSlug: "town", imageIndex: 3, role: null })).toBe("@town:3")
  })

  it("serializes a 3-part role mention", () => {
    expect(serialize({ imageSlug: "town", imageIndex: 3, role: "background" }))
      .toBe("@town:3:background")
  })

  it("emits the lock sentinel LAST, after every colon segment", () => {
    expect(serialize({ imageSlug: "town", imageIndex: 1, role: null, lock: true })).toBe("@town:1~lock")
    expect(serialize({ imageSlug: "town", imageIndex: 1, role: null, lock: false })).toBe("@town:1~nolock")
    expect(serialize({ imageSlug: "town", imageIndex: 2, role: "background", lock: true }))
      .toBe("@town:2:background~lock")
  })

  it("a lock-less pill emits NO sentinel (byte-identical to a hand-typed token)", () => {
    expect(serialize({ imageSlug: "town", imageIndex: 1, role: null, lock: undefined })).toBe("@town:1")
  })

  it("keeps surrounding text and multiple pills byte-exact", () => {
    const doc: JSONContent = {
      type: "doc",
      content: [{
        type: "paragraph",
        content: [
          { type: "text", text: "put " },
          { type: "imageMention", attrs: { imageSlug: "town", imageIndex: 1, role: null } },
          { type: "text", text: " behind " },
          { type: "imageMention", attrs: { imageSlug: "barn", imageIndex: 2, role: "background" } },
        ],
      }],
    }
    expect(generateText(doc, EXTENSIONS, { blockSeparator: "\n" }))
      .toBe("put @town:1 behind @barn:2:background")
  })
})

describe("resolvePromotableAttrs — token → pill attrs (the promotion gate)", () => {
  it("promotes a known 2-part token", () => {
    expect(resolvePromotableAttrs("@town:3", KNOWN))
      .toEqual({ imageSlug: "town", imageIndex: 3, role: null })
  })

  it("promotes a known 3-part role token, carrying the role", () => {
    expect(resolvePromotableAttrs("@town:3:background", KNOWN))
      .toEqual({ imageSlug: "town", imageIndex: 3, role: "background" })
  })

  it("carries the tri-state lock, and gains NO lock key without a sentinel", () => {
    expect(resolvePromotableAttrs("@town:1~lock", KNOWN)).toEqual({ imageSlug: "town", imageIndex: 1, role: null, lock: true })
    expect(resolvePromotableAttrs("@town:1~nolock", KNOWN)).toEqual({ imageSlug: "town", imageIndex: 1, role: null, lock: false })
    expect(resolvePromotableAttrs("@town:1", KNOWN)).not.toHaveProperty("lock")
  })

  it("leaves an UNKNOWN slug literal (the other grammars' tokens stay theirs)", () => {
    expect(resolvePromotableAttrs("@kira:1", KNOWN)).toBe(false)
    expect(resolvePromotableAttrs("@kira:1:smile", KNOWN)).toBe(false)
  })

  it("never promotes a 4-part token (a character mention is not an image mention)", () => {
    expect(resolvePromotableAttrs("@town:1:smile:face", KNOWN)).toBe(false)
  })

  it("rejects a malformed token", () => {
    expect(resolvePromotableAttrs("@town", KNOWN)).toBe(false)
    expect(resolvePromotableAttrs("@town:0", KNOWN)).toBe(false)
    expect(resolvePromotableAttrs("town:1", KNOWN)).toBe(false)
  })

  it("applies the SLASH GUARD — a location bucket/variant token stays literal", () => {
    // `@town:1:weather` immediately followed by `/rain` is the LOCATION
    // grammar; promoting the prefix would strand `/rain` in the prompt.
    expect(resolvePromotableAttrs("@town:1:weather", KNOWN, {
      input: "@town:1:weather/rain", tokenEnd: "@town:1:weather".length,
    })).toBe(false)
  })

  it("a plain `/` separating two mentions is NOT the slash guard", () => {
    expect(resolvePromotableAttrs("@town:1", KNOWN, {
      input: "@town:1/@barn:2", tokenEnd: "@town:1".length,
    })).toMatchObject({ imageSlug: "town", imageIndex: 1 })
  })

  it("LEGACY promotes nothing — there is no legacy image-mention resolver", () => {
    fmt.value = "legacy"
    try {
      expect(resolvePromotableAttrs("@town:3", KNOWN)).toBe(false)
      expect(resolvePromotableAttrs("@town:3:background", KNOWN)).toBe(false)
    } finally {
      fmt.value = "hybrid"
    }
  })
})

describe("round-trip: token → attrs → token is lossless", () => {
  for (const token of ["@town:1", "@town:3:background", "@barn:2~lock", "@barn:9:style~nolock"]) {
    it(`round-trips ${token}`, () => {
      const attrs = resolvePromotableAttrs(token, KNOWN)
      expect(attrs).not.toBe(false)
      expect(serialize(attrs as unknown as Record<string, unknown>)).toBe(token)
    })
  }
})

describe("collectTokens — raw-typed token re-pills on parse (valueToDoc path)", () => {
  it("promotes a known image mention to an imageMention node", () => {
    expect(collectTokens("a shot of @town:3 at dusk", known())).toEqual([
      {
        start: 10,
        end: 17,
        node: {
          type: "imageMention",
          attrs: { imageSlug: "town", imageIndex: 3, role: null, lock: undefined },
        },
      },
    ])
  })

  it("carries the role segment (dropping it would silently rewrite the prompt)", () => {
    const [tok] = collectTokens("@town:3:background", known())
    expect(tok.node.attrs).toMatchObject({ imageSlug: "town", imageIndex: 3, role: "background" })
  })

  it("leaves an unknown slug as plain text", () => {
    expect(collectTokens("@nowhere:1 here", known())).toEqual([])
  })

  it("CHARACTER precedence: a slug known to both resolves as the character", () => {
    // Mirrors the prompt-builder's pass order (character → location → image):
    // the character pass splices its token first, so the image pass never sees
    // it. The editor's dedup-by-offset reproduces that here.
    const rows = collectTokens("@town:1", known({ characters: new Set(["town"]) }))
    expect(rows).toHaveLength(1)
    expect(rows[0].node.type).toBe("characterRef")
  })

  it("LEGACY leaves the token as plain text (no text→pill flip on reload)", () => {
    fmt.value = "legacy"
    try {
      expect(collectTokens("a shot of @town:3", known())).toEqual([])
    } finally {
      fmt.value = "hybrid"
    }
  })
})

describe("imageMentionSlugForItem — the mentionable-ref gate", () => {
  it("derives the slug from the ref's NAME via the shared slugify", () => {
    expect(imageMentionSlugForItem(item({ label: "Town Square" }))).toBe("town-square")
    expect(imageMentionSlugForItem(item({ label: "Town", source: "uploaded" }))).toBe("town")
  })

  it("drops a name whose slug the GRAMMAR cannot express (leading digit)", () => {
    // "3D Render" slugs to the non-empty but unparseable "3d-render" —
    // emptiness is not the gate.
    expect(imageMentionSlugForItem(item({ label: "3D Render" }))).toBeNull()
  })

  it("drops non-media sources (they have their own mention grammars)", () => {
    expect(imageMentionSlugForItem(item({ source: "character", characterSlug: "kira" }))).toBeNull()
    expect(imageMentionSlugForItem(item({ source: "location", locationSlug: "lib" }))).toBeNull()
    expect(imageMentionSlugForItem(item({ source: "video" }))).toBeNull()
  })

  it("drops an EXTRA ref — it emits its own body line, so a mention would double-emit", () => {
    expect(imageMentionSlugForItem(item({ isExtraRef: true }))).toBeNull()
  })

  it("drops a ref with no URL or no name", () => {
    expect(imageMentionSlugForItem(item({ url: "" }))).toBeNull()
    expect(imageMentionSlugForItem(item({ label: "" }))).toBeNull()
  })

  it("knownImageMentionSlugs dedupes and skips the dropped refs", () => {
    expect(knownImageMentionSlugs([
      item({ label: "Town" }),
      item({ label: "Town" }),
      item({ label: "Barn" }),
      item({ label: "3D Render" }),
      item({ label: "Extra", isExtraRef: true }),
    ])).toEqual(new Set(["town", "barn"]))
  })
})
