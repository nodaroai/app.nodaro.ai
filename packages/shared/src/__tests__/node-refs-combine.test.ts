import { describe, it, expect } from "vitest"
import { extractReferencedLabels, combineSameLabelRefs, refHandleCategory } from "../node-refs.js"

describe("extractReferencedLabels", () => {
  it("collects {label} names across texts, strips ||fallback, skips reserved/image/empty", () => {
    const s = extractReferencedLabels(
      "a {Hero} in {City || town}",
      "no {Hero} {userPrompt} {image:1:subject} {}",
    )
    expect([...s].sort()).toEqual(["city", "hero"]) // canonical (lowercase), fallback stripped, dedup, no reserved/image/empty
  })
  it("ignores undefined / null / empty inputs", () => {
    expect(extractReferencedLabels(undefined, "", null).size).toBe(0)
  })
})

describe("refHandleCategory", () => {
  it("orders prompt(0) < elements(1) < look family(2); others -1", () => {
    expect(refHandleCategory("prompt")).toBe(0)
    expect(refHandleCategory("elements")).toBe(1)
    expect(refHandleCategory("look")).toBe(2)
    expect(refHandleCategory("cinematography")).toBe(2)
    expect(refHandleCategory("style")).toBe(2)
    expect(refHandleCategory("image")).toBe(-1)
    expect(refHandleCategory(null)).toBe(-1)
  })
})

describe("combineSameLabelRefs", () => {
  it("merges ≥2 same-label candidates ordered prompt→elements→look (input order ignored)", () => {
    const m = combineSameLabelRefs([
      { label: "X", output: "lookVal", category: 2 },
      { label: "X", output: "promptVal", category: 0 },
      { label: "X", output: "elemVal", category: 1 },
      { label: "Y", output: "solo", category: 1 }, // single → not combined
    ])
    expect(m.get("x")).toBe("promptVal, elemVal, lookVal") // canonical key
    expect(m.has("y")).toBe(false)
  })
  it("preserves edge order within a category (stable)", () => {
    const m = combineSameLabelRefs([
      { label: "X", output: "elem1", category: 1 },
      { label: "X", output: "elem2", category: 1 },
    ])
    expect(m.get("x")).toBe("elem1, elem2")
  })
  it("never combines non-combinable handles (category -1)", () => {
    const m = combineSameLabelRefs([
      { label: "X", output: "a", category: -1 },
      { label: "X", output: "b", category: -1 },
    ])
    expect(m.has("x")).toBe(false)
  })
})
