import { describe, it, expect } from "vitest"
import {
  DEFAULT_TEMPLATE_CATEGORY,
  LEGACY_TEMPLATE_CATEGORIES,
  TEMPLATE_CATEGORIES,
  isTemplateCategory,
  normalizeTemplateCategory,
  resolveTemplateCategory,
  templateCategoryStoredValues,
} from "../template-categories.js"

describe("template categories", () => {
  it("is the nine use cases, each once", () => {
    expect(TEMPLATE_CATEGORIES).toHaveLength(9)
    expect(new Set(TEMPLATE_CATEGORIES).size).toBe(9)
    expect(isTemplateCategory(DEFAULT_TEMPLATE_CATEGORY)).toBe(true)
  })

  it("files MCP-built workflows under their own use case, with no legacy value", () => {
    expect(isTemplateCategory("mcp")).toBe(true)
    expect(normalizeTemplateCategory("mcp")).toBe("mcp")
    expect(templateCategoryStoredValues("mcp")).toEqual(["mcp"])
  })

  it("every legacy value lands on a current category", () => {
    for (const [legacy, home] of Object.entries(LEGACY_TEMPLATE_CATEGORIES)) {
      expect(isTemplateCategory(legacy), `${legacy} is not a legacy value any more`).toBe(false)
      expect(isTemplateCategory(home), `${legacy} → ${home}`).toBe(true)
    }
  })

  it("resolves a current value as is, a legacy one as its home, anything else as nothing", () => {
    expect(resolveTemplateCategory("video-ads")).toBe("video-ads")
    expect(resolveTemplateCategory("video-production")).toBe("video-ads")
    expect(resolveTemplateCategory("nonsense")).toBeUndefined()
    expect(resolveTemplateCategory(null)).toBeUndefined()
    expect(resolveTemplateCategory(undefined)).toBeUndefined()
  })

  it("normalizes the unknown to the default bucket", () => {
    expect(normalizeTemplateCategory("nonsense")).toBe(DEFAULT_TEMPLATE_CATEGORY)
    expect(normalizeTemplateCategory(null)).toBe(DEFAULT_TEMPLATE_CATEGORY)
    expect(normalizeTemplateCategory("social-media")).toBe("social-creatives")
  })

  it("lists the stored values a category matches, the category first", () => {
    expect(templateCategoryStoredValues("video-ads")).toEqual(["video-ads", "video-production"])
    expect(templateCategoryStoredValues("social-creatives")).toEqual(["social-creatives", "audio-music", "social-media"])
    expect(templateCategoryStoredValues("static-ads")).toEqual(["static-ads"])
  })
})
