import { describe, it, expect } from "vitest"
import {
  characterMentionSlug,
  parseCharacterMentionToken,
  findCharacterMentionTokens,
} from "../character-mention-slug.js"

describe("characterMentionSlug", () => {
  it("lowercases and dash-separates", () => {
    expect(characterMentionSlug("Kira")).toBe("kira")
    expect(characterMentionSlug("Young Kira")).toBe("young-kira")
  })
  it("strips non-alphanumeric", () => {
    expect(characterMentionSlug("Kira O'Brien")).toBe("kira-o-brien")
    expect(characterMentionSlug("  Smile!  ")).toBe("smile")
  })
  it("collapses runs of dashes", () => {
    expect(characterMentionSlug("a   b---c")).toBe("a-b-c")
  })
  it("returns empty for empty input", () => {
    expect(characterMentionSlug("")).toBe("")
    expect(characterMentionSlug("   ")).toBe("")
  })
})

describe("parseCharacterMentionToken", () => {
  it("parses @kira:1 as character + index (no variant, no mode)", () => {
    expect(parseCharacterMentionToken("@kira:1")).toEqual({
      characterSlug: "kira",
      imageIndex: 1,
      variantSlug: null,
      usageMode: null,
    })
  })
  it("parses @kira:1:smile with character + index + variant (no mode)", () => {
    expect(parseCharacterMentionToken("@kira:1:smile")).toEqual({
      characterSlug: "kira",
      imageIndex: 1,
      variantSlug: "smile",
      usageMode: null,
    })
  })
  it("parses multi-word character + variant slugs unambiguously", () => {
    expect(parseCharacterMentionToken("@young-kira:2:soft-smile")).toEqual({
      characterSlug: "young-kira",
      imageIndex: 2,
      variantSlug: "soft-smile",
      usageMode: null,
    })
  })
  it("accepts multi-digit indices", () => {
    expect(parseCharacterMentionToken("@kira:12:smile")).toEqual({
      characterSlug: "kira",
      imageIndex: 12,
      variantSlug: "smile",
      usageMode: null,
    })
  })
  it("rejects bare @kira (no index)", () => {
    // Format change: the index segment is now required.
    expect(parseCharacterMentionToken("@kira")).toBeNull()
  })
  it("rejects @kira: (trailing colon with no index)", () => {
    expect(parseCharacterMentionToken("@kira:")).toBeNull()
  })
  it("rejects @kira:smile (no index — variant in place of index)", () => {
    expect(parseCharacterMentionToken("@kira:smile")).toBeNull()
  })
  it("rejects @kira:0 (index must be positive)", () => {
    expect(parseCharacterMentionToken("@kira:0")).toBeNull()
  })
  it("returns null for non-mention input", () => {
    expect(parseCharacterMentionToken("kira:1:smile")).toBeNull()
    expect(parseCharacterMentionToken("@123")).toBeNull()
  })
  it("treats dash-only token as not-a-mention (no index segment)", () => {
    // Without `:<index>` the parser rejects — no fallback to bare-slug form.
    expect(parseCharacterMentionToken("@kira-smile")).toBeNull()
  })

  // -----------------------------------------------------------------------
  // Usage-mode parsing — 3rd segment ambiguity + 4-part variant+mode form.
  // -----------------------------------------------------------------------

  it("3-part: @kira:1:face — recognizes a usage-mode keyword as the mode (no variant)", () => {
    expect(parseCharacterMentionToken("@kira:1:face")).toEqual({
      characterSlug: "kira",
      imageIndex: 1,
      variantSlug: null,
      usageMode: "face",
    })
  })

  it("3-part: @kira:1:style — same disambiguation for other modes", () => {
    expect(parseCharacterMentionToken("@kira:1:style")).toEqual({
      characterSlug: "kira",
      imageIndex: 1,
      variantSlug: null,
      usageMode: "style",
    })
  })

  it("3-part: @kira:1:face-pose — multi-word mode keyword wins over variant", () => {
    expect(parseCharacterMentionToken("@kira:1:face-pose")).toEqual({
      characterSlug: "kira",
      imageIndex: 1,
      variantSlug: null,
      usageMode: "face-pose",
    })
  })

  it("3-part: @kira:1:smile — non-mode segment is treated as variant (default mode)", () => {
    expect(parseCharacterMentionToken("@kira:1:smile")).toEqual({
      characterSlug: "kira",
      imageIndex: 1,
      variantSlug: "smile",
      usageMode: null,
    })
  })

  it("4-part: @kira:1:smile:face — variant + explicit mode override", () => {
    expect(parseCharacterMentionToken("@kira:1:smile:face")).toEqual({
      characterSlug: "kira",
      imageIndex: 1,
      variantSlug: "smile",
      usageMode: "face",
    })
  })

  it("4-part: @kira:1:walking:emotion — different variant + different mode", () => {
    expect(parseCharacterMentionToken("@kira:1:walking:emotion")).toEqual({
      characterSlug: "kira",
      imageIndex: 1,
      variantSlug: "walking",
      usageMode: "emotion",
    })
  })

  it("4-part: @kira:1:smile:invalid — invalid mode rejects the entire token", () => {
    expect(parseCharacterMentionToken("@kira:1:smile:invalid")).toBeNull()
  })

  it("4-part: @kira:1:smile:smile — variant-shaped 4th segment still rejects (must be a mode)", () => {
    expect(parseCharacterMentionToken("@kira:1:smile:smile")).toBeNull()
  })

  it("rejects 5-part tokens", () => {
    expect(parseCharacterMentionToken("@kira:1:smile:face:extra")).toBeNull()
  })

  it("rejects empty trailing segments", () => {
    expect(parseCharacterMentionToken("@kira:1:smile:")).toBeNull()
    expect(parseCharacterMentionToken("@kira:1::face")).toBeNull()
  })
})

describe("findCharacterMentionTokens", () => {
  it("finds all @mentions with index (no mode in slug)", () => {
    const tokens = findCharacterMentionTokens(
      "Hi @kira:1:smile, please @adam:2 wave at @kira:3:walking",
      ["kira", "adam"],
    )
    expect(tokens).toEqual([
      { token: "@kira:1:smile", characterSlug: "kira", imageIndex: 1, variantSlug: "smile", usageMode: null, offset: 3 },
      { token: "@adam:2", characterSlug: "adam", imageIndex: 2, variantSlug: null, usageMode: null, offset: 25 },
      { token: "@kira:3:walking", characterSlug: "kira", imageIndex: 3, variantSlug: "walking", usageMode: null, offset: 41 },
    ])
  })
  it("finds 4-part tokens with mode override", () => {
    const tokens = findCharacterMentionTokens(
      "@kira:1:smile:face waves at @kira:2:style",
      ["kira"],
    )
    expect(tokens).toEqual([
      { token: "@kira:1:smile:face", characterSlug: "kira", imageIndex: 1, variantSlug: "smile", usageMode: "face", offset: 0 },
      { token: "@kira:2:style", characterSlug: "kira", imageIndex: 2, variantSlug: null, usageMode: "style", offset: 28 },
    ])
  })
  it("returns empty for prompt with no @mentions", () => {
    expect(findCharacterMentionTokens("just a prompt", ["kira"])).toEqual([])
  })
  it("ignores @mentions that don't match a known character slug", () => {
    expect(findCharacterMentionTokens("@unknown:1:thing", ["kira", "adam"])).toEqual([])
  })
  it("handles email-like text without false matches", () => {
    expect(findCharacterMentionTokens("send to user@example.com", ["user"])).toEqual([])
  })
  it("does not match bare @kira (no index)", () => {
    expect(findCharacterMentionTokens("@kira waves", ["kira"])).toEqual([])
  })
  it("does not parse a dash-form as a variant token", () => {
    expect(findCharacterMentionTokens("@kira-smile waves", ["kira"])).toEqual([])
  })
  it("4-part with invalid mode is dropped (matches regex but parser rejects)", () => {
    // The regex matches structurally but `parseCharacterMentionToken` rejects
    // the 4th segment as an invalid mode, so the token is filtered out.
    expect(findCharacterMentionTokens("@kira:1:smile:bogus waves", ["kira"])).toEqual([])
  })
})
