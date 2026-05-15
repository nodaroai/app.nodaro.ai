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
  it("parses @kira:1 as character + index (no variant)", () => {
    expect(parseCharacterMentionToken("@kira:1")).toEqual({
      characterSlug: "kira",
      imageIndex: 1,
      variantSlug: null,
    })
  })
  it("parses @kira:1:smile with character + index + variant", () => {
    expect(parseCharacterMentionToken("@kira:1:smile")).toEqual({
      characterSlug: "kira",
      imageIndex: 1,
      variantSlug: "smile",
    })
  })
  it("parses multi-word character + variant slugs unambiguously", () => {
    expect(parseCharacterMentionToken("@young-kira:2:soft-smile")).toEqual({
      characterSlug: "young-kira",
      imageIndex: 2,
      variantSlug: "soft-smile",
    })
  })
  it("accepts multi-digit indices", () => {
    expect(parseCharacterMentionToken("@kira:12:smile")).toEqual({
      characterSlug: "kira",
      imageIndex: 12,
      variantSlug: "smile",
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
})

describe("findCharacterMentionTokens", () => {
  it("finds all @mentions with index", () => {
    const tokens = findCharacterMentionTokens(
      "Hi @kira:1:smile, please @adam:2 wave at @kira:3:walking",
      ["kira", "adam"],
    )
    expect(tokens).toEqual([
      { token: "@kira:1:smile", characterSlug: "kira", imageIndex: 1, variantSlug: "smile", offset: 3 },
      { token: "@adam:2", characterSlug: "adam", imageIndex: 2, variantSlug: null, offset: 25 },
      { token: "@kira:3:walking", characterSlug: "kira", imageIndex: 3, variantSlug: "walking", offset: 41 },
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
})
