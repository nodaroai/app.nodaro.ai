import { describe, it, expect } from "vitest"
import { loadRecipeCatalog, loadRecipe, loadRecipeFile, parseRecipeFrontmatter } from "../recipes.js"

describe("recipe catalog", () => {
  it("lists the video-explainer recipe with frontmatter fields", () => {
    const catalog = loadRecipeCatalog()
    const entry = catalog.find((r) => r.name === "video-explainer")
    expect(entry).toBeTruthy()
    expect(entry!.description.length).toBeGreaterThan(0)
    expect(Array.isArray(entry!.triggers)).toBe(true)
    expect(entry!.triggers.length).toBeGreaterThan(0)
  })

  it("loads the full recipe body with frontmatter stripped", () => {
    const body = loadRecipe("video-explainer")
    expect(body).toBeTruthy()
    expect(body!.startsWith("---")).toBe(false) // frontmatter removed
    expect(body!).toContain("assemble_narrated_video")
  })

  it("returns null for an unknown recipe", () => {
    expect(loadRecipe("does-not-exist")).toBeNull()
  })

  it("rejects a malformed frontmatter block", () => {
    expect(() => parseRecipeFrontmatter("no frontmatter here")).toThrow()
  })

  it("blocks path traversal in loadRecipeFile", () => {
    // Attempts to escape the recipe's own folder and read a sibling
    // recipe's doctrine file — the resolved path must be rejected before
    // any read is attempted, regardless of whether the target exists.
    expect(loadRecipeFile("video-explainer", "../../video-director/doctrine.md")).toBeNull()
  })
})
