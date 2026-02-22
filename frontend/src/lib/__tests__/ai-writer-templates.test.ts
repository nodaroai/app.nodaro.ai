import { describe, it, expect } from "vitest"
import { AI_WRITER_TEMPLATES, getAIWriterTemplate } from "../ai-writer-templates"

describe("AI_WRITER_TEMPLATES", () => {
  it("has exactly 4 templates", () => {
    expect(AI_WRITER_TEMPLATES).toHaveLength(4)
  })

  it("template IDs are photo-shoot, product-catalog, storyboard, custom", () => {
    expect(AI_WRITER_TEMPLATES.map((t) => t.id)).toEqual([
      "photo-shoot",
      "product-catalog",
      "storyboard",
      "custom",
    ])
  })

  it("every template has required fields", () => {
    for (const tmpl of AI_WRITER_TEMPLATES) {
      expect(tmpl.id).toBeTruthy()
      expect(tmpl.label).toBeTruthy()
      expect(tmpl.description).toBeTruthy()
      expect(typeof tmpl.systemPrompt).toBe("string")
      expect(tmpl.placeholderInput).toBeTruthy()
    }
  })

  it("custom template has an empty system prompt", () => {
    const custom = AI_WRITER_TEMPLATES.find((t) => t.id === "custom")!
    expect(custom.systemPrompt).toBe("")
  })

  it("non-custom templates have non-empty system prompts", () => {
    for (const tmpl of AI_WRITER_TEMPLATES.filter((t) => t.id !== "custom")) {
      expect(tmpl.systemPrompt.length).toBeGreaterThan(0)
    }
  })

  it("photo-shoot template has defaultInput and defaultMaxTokens", () => {
    const photoShoot = AI_WRITER_TEMPLATES.find((t) => t.id === "photo-shoot")!
    expect(photoShoot.defaultInput).toBeTruthy()
    expect(photoShoot.defaultMaxTokens).toBe(16384)
  })
})

describe("getAIWriterTemplate", () => {
  it("returns the correct template for a known ID", () => {
    const tmpl = getAIWriterTemplate("storyboard")
    expect(tmpl).toBeDefined()
    expect(tmpl!.id).toBe("storyboard")
    expect(tmpl!.label).toBe("Storyboard Writer")
  })

  it("returns the custom template", () => {
    const tmpl = getAIWriterTemplate("custom")
    expect(tmpl).toBeDefined()
    expect(tmpl!.systemPrompt).toBe("")
  })

  it("returns undefined for an unknown ID", () => {
    expect(getAIWriterTemplate("nonexistent")).toBeUndefined()
  })

  it("returns undefined for empty string", () => {
    expect(getAIWriterTemplate("")).toBeUndefined()
  })
})
