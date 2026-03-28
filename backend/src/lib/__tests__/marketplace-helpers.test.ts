import { describe, it, expect } from "vitest"
import {
  sanitizeSlugBase,
  generateSlug,
} from "../marketplace-helpers.js"

describe("sanitizeSlugBase", () => {
  it("lowercases and hyphenates spaces", () => {
    expect(sanitizeSlugBase("My Cool Workflow")).toBe("my-cool-workflow")
  })

  it("strips trailing non-alphanumeric characters", () => {
    expect(sanitizeSlugBase("Hello World!!")).toBe("hello-world")
  })

  it("trims leading and trailing dashes", () => {
    expect(sanitizeSlugBase("---leading---")).toBe("leading")
  })

  it("lowercases uppercase input", () => {
    expect(sanitizeSlugBase("UPPERCASE")).toBe("uppercase")
  })

  it("replaces runs of special characters with a single dash", () => {
    expect(sanitizeSlugBase("special@#$chars")).toBe("special-chars")
  })

  it("returns empty string for empty input", () => {
    expect(sanitizeSlugBase("")).toBe("")
  })

  it("slices to 40 characters max", () => {
    const long = "a".repeat(50)
    const result = sanitizeSlugBase(long)
    expect(result).toHaveLength(40)
    expect(result).toBe("a".repeat(40))
  })

  it("trims surrounding spaces", () => {
    expect(sanitizeSlugBase("  spaces  ")).toBe("spaces")
  })

  it("preserves an already valid slug", () => {
    expect(sanitizeSlugBase("already-valid-slug")).toBe("already-valid-slug")
  })

  it("keeps leading digits", () => {
    expect(sanitizeSlugBase("123 Numbers")).toBe("123-numbers")
  })

  it("strips non-ascii characters and collapses resulting dashes", () => {
    // "caf\u00e9" -> 'caf' + \u00e9 becomes dash -> trailing dash trimmed
    expect(sanitizeSlugBase("caf\u00e9")).toBe("caf")
    // Full word with multiple non-ascii: "caf\u00e9 r\u00e9sum\u00e9"
    expect(sanitizeSlugBase("caf\u00e9 r\u00e9sum\u00e9")).toBe("caf-r-sum")
  })

  it("collapses runs of spaces into a single dash", () => {
    expect(sanitizeSlugBase("a  b   c")).toBe("a-b-c")
  })

  it("collapses runs of mixed non-alphanumeric into a single dash", () => {
    expect(sanitizeSlugBase("a@#b$%^c")).toBe("a-b-c")
  })
})

describe("generateSlug", () => {
  it("returns sanitized base with a 6-char alphanumeric suffix", () => {
    const slug = generateSlug("My Workflow")
    expect(slug).toMatch(/^my-workflow-[a-z0-9]{6}$/)
  })

  it("produces a short slug with correct pattern", () => {
    const slug = generateSlug("Test")
    expect(slug).toMatch(/^test-[a-z0-9]{6}$/)
  })

  it("produces different slugs on successive calls", () => {
    const a = generateSlug("Same Name")
    const b = generateSlug("Same Name")
    expect(a).not.toBe(b)
  })

  it("caps total length for long names (40 base + dash + 6 suffix)", () => {
    const slug = generateSlug("a".repeat(50))
    // base is sliced to 40, then "-" + 6 chars = 47 max
    expect(slug.length).toBeLessThanOrEqual(47)
    expect(slug).toMatch(new RegExp(`^a{40}-[a-z0-9]{6}$`))
  })

  it("handles empty name producing a dash-prefixed suffix", () => {
    const slug = generateSlug("")
    // sanitizeSlugBase("") = "", so slug = "-" + suffix
    expect(slug).toMatch(/^-[a-z0-9]{6}$/)
  })
})
