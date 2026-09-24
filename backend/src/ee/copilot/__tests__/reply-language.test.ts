import { describe, it, expect } from "vitest"
import { replyLanguageLine, withReplyLanguage } from "../reply-language.js"

describe("copilot reply language", () => {
  it("names the language the interface is read in and asks for replies in it", () => {
    const line = replyLanguageLine("he")
    expect(line).toContain("Hebrew (he)")
    expect(line).toContain("Write every reply in Hebrew")
    // Identifiers stay verbatim — a translated node name would break every tool call that names it.
    expect(line).toContain("exactly as they are")
  })

  it("adds nothing for English, an unknown locale, or no locale — the turn stays byte-identical", () => {
    expect(replyLanguageLine("en")).toBeNull()
    expect(replyLanguageLine("zz")).toBeNull()
    expect(replyLanguageLine(null)).toBeNull()
    expect(replyLanguageLine(undefined)).toBeNull()
    expect(withReplyLanguage("<ctx/>", "en")).toBe("<ctx/>")
  })

  it("appends the line AFTER the fenced context, never inside the user-authored region", () => {
    const out = withReplyLanguage("<workflow-context nonce=\"x\">user stuff</workflow-context>", "he")
    expect(out.startsWith("<workflow-context")).toBe(true)
    expect(out.indexOf("</workflow-context>")).toBeLessThan(out.indexOf("<reply-language>"))
  })
})
