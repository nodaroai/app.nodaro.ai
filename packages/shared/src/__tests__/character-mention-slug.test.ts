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
  it("parses @kira as character-only", () => {
    expect(parseCharacterMentionToken("@kira")).toEqual({ characterSlug: "kira", variantSlug: null })
  })
  it("parses @kira:smile with colon separator", () => {
    expect(parseCharacterMentionToken("@kira:smile")).toEqual({ characterSlug: "kira", variantSlug: "smile" })
  })
  it("parses multi-word character + variant slugs unambiguously via the colon", () => {
    // No knownCharacterSlugs needed — the colon is the unambiguous boundary.
    expect(parseCharacterMentionToken("@young-kira:soft-smile")).toEqual({
      characterSlug: "young-kira",
      variantSlug: "soft-smile",
    })
  })
  it("returns null for trailing-colon token with no variant", () => {
    expect(parseCharacterMentionToken("@kira:")).toBeNull()
  })
  it("returns null for non-mention input", () => {
    expect(parseCharacterMentionToken("kira:smile")).toBeNull()
    expect(parseCharacterMentionToken("@123")).toBeNull()
  })
  it("treats dash-only token as bare character slug (no variant)", () => {
    // Without a colon there is no variant — the whole rest is the character slug.
    expect(parseCharacterMentionToken("@kira-smile")).toEqual({
      characterSlug: "kira-smile",
      variantSlug: null,
    })
  })
})

describe("findCharacterMentionTokens", () => {
  it("finds all @mentions in a prompt with colon separator", () => {
    const tokens = findCharacterMentionTokens(
      "Hi @kira:smile, please @adam wave at @kira:walking",
      ["kira", "adam"]
    )
    expect(tokens).toEqual([
      { token: "@kira:smile", characterSlug: "kira", variantSlug: "smile", offset: 3 },
      { token: "@adam", characterSlug: "adam", variantSlug: null, offset: 23 },
      { token: "@kira:walking", characterSlug: "kira", variantSlug: "walking", offset: 37 },
    ])
  })
  it("returns empty for prompt with no @mentions", () => {
    expect(findCharacterMentionTokens("just a prompt", ["kira"])).toEqual([])
  })
  it("ignores @mentions that don't match a known character slug", () => {
    expect(findCharacterMentionTokens("@unknown:thing", ["kira", "adam"])).toEqual([])
  })
  it("handles email-like text without false matches", () => {
    expect(findCharacterMentionTokens("send to user@example.com", ["user"])).toEqual([])
  })
  it("does not parse a dash-form as a variant token", () => {
    // @kira-smile is the bare slug "kira-smile" — not a (kira + smile) pair.
    // Since "kira-smile" is not in knownCharacterSlugs it gets filtered out.
    expect(findCharacterMentionTokens("@kira-smile waves", ["kira"])).toEqual([])
  })
})
