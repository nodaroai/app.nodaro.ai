import { describe, it, expect } from "vitest"
import {
  buildCharacterPrompt,
  buildObjectPrompt,
  buildLocationPrompt,
  buildFaceTemplateInputs,
} from "../entity-prompts.js"

describe("buildCharacterPrompt", () => {
  it("combines name, gender, description with outfit and style", () => {
    const prompt = buildCharacterPrompt({
      name: "Aria",
      gender: "female",
      description: "silver hair",
      baseOutfit: "leather armour",
      style: "anime",
    })
    expect(prompt).toContain("Aria, female, silver hair")
    expect(prompt).toContain("wearing leather armour")
    expect(prompt).toContain("anime style")
    expect(prompt).toContain("front view, looking at camera")
    expect(prompt).toContain("full body portrait")
  })

  it("defaults style to realistic when unset", () => {
    const prompt = buildCharacterPrompt({ name: "Bob" })
    expect(prompt).toContain("realistic style")
  })

  it("omits outfit clause when baseOutfit is empty", () => {
    const prompt = buildCharacterPrompt({ name: "Bob" })
    expect(prompt).not.toContain("wearing")
  })

  it("skips missing gender/description fields in description block", () => {
    const prompt = buildCharacterPrompt({ name: "Solo" })
    // Should just have "Solo," — no extra commas for missing fields
    expect(prompt).toMatch(/^Solo,/)
  })
})

describe("buildObjectPrompt", () => {
  it("uses category and product-photography suffix", () => {
    const prompt = buildObjectPrompt({
      name: "pistol",
      category: "weapon",
      description: "brass fittings",
      style: "realistic",
    })
    expect(prompt).toContain("Single weapon pistol")
    expect(prompt).toContain("brass fittings")
    expect(prompt).toContain("realistic art style")
    expect(prompt).toContain("product photography style")
  })

  it("defaults category to 'object' when unset", () => {
    const prompt = buildObjectPrompt({ name: "widget" })
    expect(prompt).toContain("Single object widget")
  })
})

describe("buildLocationPrompt", () => {
  it("uses scene framing with establishing-shot suffix", () => {
    const prompt = buildLocationPrompt({
      name: "Neo Tokyo",
      category: "urban",
      description: "rain-slick streets",
      style: "3d-pixar",
    })
    expect(prompt).toContain("urban scene")
    expect(prompt).toContain("Neo Tokyo")
    expect(prompt).toContain("rain-slick streets")
    expect(prompt).toContain("3d-pixar art style")
    expect(prompt).toContain("wide establishing shot")
    expect(prompt).toContain("no people")
  })

  it("defaults category to 'location' when unset", () => {
    const prompt = buildLocationPrompt({ name: "The Grove" })
    expect(prompt).toContain("location scene")
  })
})

describe("buildFaceTemplateInputs", () => {
  it("combines name and description into one description string", () => {
    const inputs = buildFaceTemplateInputs({
      name: "Elena",
      description: "high cheekbones",
      style: "realistic",
    })
    expect(inputs.description).toBe("Elena, high cheekbones")
    expect(inputs.style).toBe("realistic")
  })

  it("omits missing description fields", () => {
    const inputs = buildFaceTemplateInputs({ name: "Solo" })
    expect(inputs.description).toBe("Solo")
    expect(inputs.style).toBe("realistic")
  })
})
