import { describe, it, expect } from "vitest"
import { isExcludedToken, referencedRefs, hasEmptyInjection } from "../prompt-ref-scan"

describe("isExcludedToken", () => {
  it("excludes empty, image:, reserved", () => {
    expect(isExcludedToken("")).toBe(true)
    expect(isExcludedToken("image:0")).toBe(true)
    expect(isExcludedToken("name")).toBe(true) // RESERVED_TEMPLATE_VARS
  })
  it("keeps normal labels", () => expect(isExcludedToken("Hero")).toBe(false))
})
describe("referencedRefs", () => {
  it("collects non-excluded {labels} across fields, trimmed", () => {
    const r = referencedRefs({ prompt: "a {Hero} b {Sky}", negativePrompt: "{name}" }, ["prompt", "negativePrompt"])
    expect(r.has("Hero")).toBe(true); expect(r.has("Sky")).toBe(true); expect(r.has("name")).toBe(false)
  })
  it("matches duplicate-suffixed labels like {Hero (2)}", () => {
    expect(referencedRefs({ prompt: "{Hero (2)}" }, ["prompt"]).has("Hero (2)")).toBe(true)
  })
})
describe("hasEmptyInjection", () => {
  it("detects literal {} (which NODE_REF_PATTERN ignores)", () => {
    expect(hasEmptyInjection({ prompt: "x {} y" }, ["prompt"])).toBe(true)
    expect(hasEmptyInjection({ prompt: "x {Hero} y" }, ["prompt"])).toBe(false)
  })
})
