import { describe, it, expect } from "vitest"
import { entityActiveImageUrl } from "../entity-output-url"

describe("entityActiveImageUrl", () => {
  it("returns the active generated result url", () => {
    expect(entityActiveImageUrl({
      generatedResults: [{ url: "a" }, { url: "b" }],
      activeResultIndex: 1,
    })).toBe("b")
  })
  it("defaults activeResultIndex to 0", () => {
    expect(entityActiveImageUrl({ generatedResults: [{ url: "a" }] })).toBe("a")
  })
  it("falls back to sourceImageUrl when there are no results", () => {
    expect(entityActiveImageUrl({ sourceImageUrl: "src" })).toBe("src")
  })
  it("returns undefined when nothing is present", () => {
    expect(entityActiveImageUrl({})).toBeUndefined()
  })
})
