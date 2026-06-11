import { describe, it, expect } from "vitest"
import {
  FACTORY_SNIPPETS,
  getFactorySnippets,
  SNIPPET_MEDIA_VALUES,
} from "../factory-snippets/index.js"

describe("FACTORY_SNIPPETS catalog invariants", () => {
  it("has unique ids and unique names", () => {
    const ids = FACTORY_SNIPPETS.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
    const names = FACTORY_SNIPPETS.map((s) => s.name.toLowerCase())
    expect(new Set(names).size).toBe(names.length)
  })

  it("every snippet has valid shape", () => {
    for (const s of FACTORY_SNIPPETS) {
      expect(s.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/)
      expect(s.name.trim().length).toBeGreaterThan(0)
      expect(s.name.length).toBeLessThanOrEqual(80)
      expect(s.text.trim()).toBe(s.text) // no leading/trailing whitespace
      expect(s.text.length).toBeGreaterThan(0)
      expect(s.text.length).toBeLessThanOrEqual(600)
      expect(["prompt", "negative"]).toContain(s.target)
      expect(s.media.length).toBeGreaterThan(0)
      for (const m of s.media) expect(SNIPPET_MEDIA_VALUES).toContain(m)
      expect(s.category.trim().length).toBeGreaterThan(0)
    }
  })

  it("snippet text never collides with mention/variable token parsing", () => {
    // `{`/`}` would form {Label} variable tokens; `@` would form @slug mentions;
    // newlines would break the per-line pill matcher (collectTokens is per-line).
    for (const s of FACTORY_SNIPPETS) {
      expect(s.text).not.toMatch(/[{}@\n]/)
    }
  })

  it("negative-target snippets are bare comma lists (never 'no X' phrasing)", () => {
    for (const s of FACTORY_SNIPPETS.filter((x) => x.target === "negative")) {
      expect(s.text.toLowerCase().startsWith("no ")).toBe(false)
      expect(s.text.toLowerCase()).not.toContain(" don't ")
    }
  })

  it("getFactorySnippets filters by target + media", () => {
    const imgPrompt = getFactorySnippets("prompt", "image")
    expect(imgPrompt.length).toBeGreaterThan(20)
    expect(imgPrompt.every((s) => s.target === "prompt" && s.media.includes("image"))).toBe(true)
    const vidNeg = getFactorySnippets("negative", "video")
    expect(vidNeg.length).toBeGreaterThanOrEqual(4)
    expect(vidNeg.every((s) => s.target === "negative" && s.media.includes("video"))).toBe(true)
    // Audio/text catalogs are deliberately empty in v1 — menu shows user snippets only.
    expect(getFactorySnippets("prompt", "audio")).toEqual([])
  })

  it("no snippet text is a substring of another (keeps the pill matcher unambiguous)", () => {
    for (const a of FACTORY_SNIPPETS) {
      for (const b of FACTORY_SNIPPETS) {
        if (a.id === b.id) continue
        expect(
          b.text.includes(a.text),
          `"${a.id}" text is contained in "${b.id}" text`,
        ).toBe(false)
      }
    }
  })
})
