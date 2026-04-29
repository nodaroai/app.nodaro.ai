import { describe, it, expect } from "vitest"
import { sanitizeSlug, dedupeSlugs } from "../slug-sanitizer.js"

describe("sanitizeSlug", () => {
  it("lowercases + replaces non-[a-z0-9_]", () => {
    expect(sanitizeSlug("Marketing Video Generator")).toBe("marketing_video_generator")
    expect(sanitizeSlug("Foo-Bar.Baz!")).toBe("foo_bar_baz")
  })
  it("collapses repeated underscores", () => {
    expect(sanitizeSlug("a   b")).toBe("a_b")
    expect(sanitizeSlug("a___b")).toBe("a_b")
  })
  it("trims leading/trailing underscores", () => {
    expect(sanitizeSlug("  Hello  ")).toBe("hello")
  })
  it("truncates at 32 chars", () => {
    expect(sanitizeSlug("a".repeat(50)).length).toBeLessThanOrEqual(32)
  })
  it("returns 'unnamed' if input collapses to empty", () => {
    expect(sanitizeSlug("...")).toBe("unnamed")
    expect(sanitizeSlug("")).toBe("unnamed")
  })
})

describe("dedupeSlugs", () => {
  it("appends _2, _3 to collisions", () => {
    expect(dedupeSlugs(["foo", "bar", "foo", "foo"])).toEqual(["foo", "bar", "foo_2", "foo_3"])
  })
  it("preserves order of first appearance", () => {
    expect(dedupeSlugs(["a", "b", "a"])).toEqual(["a", "b", "a_2"])
  })
  it("is a no-op for unique inputs", () => {
    expect(dedupeSlugs(["one", "two", "three"])).toEqual(["one", "two", "three"])
  })
})
