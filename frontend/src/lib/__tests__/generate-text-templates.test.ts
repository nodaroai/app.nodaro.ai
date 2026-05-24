import { describe, it, expect } from "vitest"
import { GENERATE_TEXT_TEMPLATES, getGenerateTextTemplate } from "../generate-text-templates"

describe("GENERATE_TEXT_TEMPLATES", () => {
  it("has exactly 4 templates", () => {
    expect(GENERATE_TEXT_TEMPLATES).toHaveLength(4)
  })

  it("template IDs are photo-shoot, product-catalog, storyboard, custom", () => {
    expect(GENERATE_TEXT_TEMPLATES.map((t) => t.id)).toEqual([
      "photo-shoot",
      "product-catalog",
      "storyboard",
      "custom",
    ])
  })

  it("every template has required fields", () => {
    for (const tmpl of GENERATE_TEXT_TEMPLATES) {
      expect(tmpl.id).toBeTruthy()
      expect(tmpl.label).toBeTruthy()
      expect(tmpl.description).toBeTruthy()
      expect(typeof tmpl.systemPrompt).toBe("string")
      expect(tmpl.placeholderInput).toBeTruthy()
    }
  })

  it("custom template has an empty system prompt", () => {
    const custom = GENERATE_TEXT_TEMPLATES.find((t) => t.id === "custom")!
    expect(custom.systemPrompt).toBe("")
  })

  it("non-custom templates have non-empty system prompts", () => {
    for (const tmpl of GENERATE_TEXT_TEMPLATES.filter((t) => t.id !== "custom")) {
      expect(tmpl.systemPrompt.length).toBeGreaterThan(0)
    }
  })

  it("photo-shoot template has defaultInput and defaultMaxTokens", () => {
    const photoShoot = GENERATE_TEXT_TEMPLATES.find((t) => t.id === "photo-shoot")!
    expect(photoShoot.defaultInput).toBeTruthy()
    expect(photoShoot.defaultMaxTokens).toBe(16384)
  })

  it("the 3 image-prompt templates fan out and require an image ref", () => {
    for (const id of ["photo-shoot", "product-catalog", "storyboard"]) {
      const tmpl = getGenerateTextTemplate(id)
      expect(tmpl).toBeDefined()
      expect(tmpl!.fansOut).toBe(true)
      expect(tmpl!.requiresImageRef).toBe(true)
    }
  })

  it("custom template does not fan out and does not require an image ref", () => {
    expect(getGenerateTextTemplate("custom")?.fansOut).toBeFalsy()
    expect(getGenerateTextTemplate("custom")?.requiresImageRef).toBeFalsy()
  })
})

describe("getGenerateTextTemplate", () => {
  it("returns the correct template for a known ID", () => {
    const tmpl = getGenerateTextTemplate("storyboard")
    expect(tmpl).toBeDefined()
    expect(tmpl!.id).toBe("storyboard")
    expect(tmpl!.label).toBe("Storyboard Writer")
  })

  it("returns the custom template", () => {
    const tmpl = getGenerateTextTemplate("custom")
    expect(tmpl).toBeDefined()
    expect(tmpl!.systemPrompt).toBe("")
  })

  it("returns undefined for an unknown ID", () => {
    expect(getGenerateTextTemplate("nonexistent")).toBeUndefined()
  })

  it("returns undefined for empty string", () => {
    expect(getGenerateTextTemplate("")).toBeUndefined()
  })
})
