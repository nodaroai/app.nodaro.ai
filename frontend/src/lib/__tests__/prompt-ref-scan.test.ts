import { describe, it, expect } from "vitest"
import { RESERVED_TEMPLATE_VARS } from "@nodaro/shared"
import { isExcludedToken, referencedRefs, hasEmptyInjection, classifyPromptToken } from "../prompt-ref-scan"

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
  it("extracts the parsed name for {Label || default} refs", () => {
    const r = referencedRefs({ prompt: "a {person || man} b" }, ["prompt"])
    expect(r.has("person")).toBe(true)
    expect(r.has("person || man")).toBe(false)
  })
})
describe("hasEmptyInjection", () => {
  it("detects literal {} (which NODE_REF_PATTERN ignores)", () => {
    expect(hasEmptyInjection({ prompt: "x {} y" }, ["prompt"])).toBe(true)
    expect(hasEmptyInjection({ prompt: "x {Hero} y" }, ["prompt"])).toBe(false)
  })
})
describe("classifyPromptToken", () => {
  const labels = new Set(["Setting", "Hero (2)"])
  it("wired when the label has a matching upstream", () => {
    expect(classifyPromptToken("Setting", labels)).toBe("wired")
    expect(classifyPromptToken("Hero (2)", labels)).toBe("wired") // duplicate-suffix labels match exactly
  })
  it("missing when no upstream matches (case-sensitive, exact)", () => {
    expect(classifyPromptToken("Style Guide", labels)).toBe("missing")
    expect(classifyPromptToken("setting", labels)).toBe("missing")
  })
  it("reserved for system template vars regardless of upstream", () => {
    expect(RESERVED_TEMPLATE_VARS.size).toBeGreaterThan(0)
    for (const name of RESERVED_TEMPLATE_VARS) {
      expect(classifyPromptToken(name, labels)).toBe("reserved")
      expect(classifyPromptToken(name, new Set())).toBe("reserved")
    }
  })
  it("skip for empty and image-ref-shaped names", () => {
    expect(classifyPromptToken("", labels)).toBe("skip")
    expect(classifyPromptToken("image:1", labels)).toBe("skip")
    expect(classifyPromptToken("image:2:person", labels)).toBe("skip")
  })
  it("null label set suppresses amber: labels classify unknown (rendered cyan)", () => {
    expect(classifyPromptToken("Anything", null)).toBe("unknown")
    expect(classifyPromptToken("name", null)).toBe("reserved")
    expect(classifyPromptToken("image:1", null)).toBe("skip")
  })
})
