/**
 * stripAudioTags runs on the API and orchestrator event loops (the credit
 * counter strips before any validation can reject a request), so it must be
 * linear in the text — an unclosed `[` run used to cost quadratic time — and
 * it must strip exactly what the original pattern did.
 */
import { describe, it, expect } from "vitest"
import { stripAudioTags } from "../audio-tags.js"

/** The behaviour being preserved, verbatim. */
const reference = (text: string) => text.replace(/\[[^\]]+\]/g, "").replace(/\s{2,}/g, " ").trim()

describe("stripAudioTags", () => {
  it.each([
    ["", ""],
    ["no tags here", "no tags here"],
    ["[laughs] hello", "hello"],
    ["hello [whispers] there", "hello there"],
    ["[a][b] x", "x"],
    ["[] stays", "[] stays"],
    ["[[a] b", "b"],
    ["open [ never closed", "open [ never closed"],
    ["a ] b", "a ] b"],
    ["line one\n\n[pause]\n\nline two", "line one line two"],
  ])("%j -> %j", (input, expected) => {
    expect(stripAudioTags(input)).toBe(expected)
  })

  it("matches the original pattern on every short string over its alphabet", () => {
    const alphabet = ["[", "]", "a", " ", "\n"]
    const walk = (prefix: string, depth: number) => {
      expect(stripAudioTags(prefix), JSON.stringify(prefix)).toBe(reference(prefix))
      if (depth === 0) return
      for (const ch of alphabet) walk(prefix + ch, depth - 1)
    }
    walk("", 7)
  })

  it("is linear on text with no closing bracket (40,000 unclosed '[')", () => {
    for (const text of ["[".repeat(40000), "[a".repeat(20000), "[ ".repeat(20000)]) {
      const started = performance.now()
      stripAudioTags(text)
      expect(performance.now() - started).toBeLessThan(150)
    }
  })

  it("is linear on a long run of '[]' pairs, a long whitespace run and many closed tags", () => {
    for (const text of ["[]".repeat(20000), " ".repeat(40000) + "x", "[a]".repeat(13000)]) {
      const started = performance.now()
      stripAudioTags(text)
      expect(performance.now() - started).toBeLessThan(150)
    }
  })
})
