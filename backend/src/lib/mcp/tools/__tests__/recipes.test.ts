import { readFileSync, readdirSync, existsSync, statSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join, resolve } from "node:path"
import { describe, it, expect } from "vitest"
import { loadRecipeCatalog, loadRecipe, loadRecipeFile, parseRecipeFrontmatter } from "../recipes.js"

/** backend/skills/recipes, resolved from this test file's location. */
const RECIPES_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../../skills/recipes")

function recipeDirs(): string[] {
  return readdirSync(RECIPES_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort()
}

/** Every file shipped inside a recipe folder (RECIPE.md + references/*). */
function recipeFiles(name: string): string[] {
  const out: string[] = []
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const p = join(dir, entry)
      if (statSync(p).isDirectory()) walk(p)
      else out.push(p)
    }
  }
  walk(join(RECIPES_DIR, name))
  return out
}

describe("recipe catalog", () => {
  it("every recipe directory on disk parses and appears in the catalog", () => {
    // loadRecipeCatalog SKIPS malformed recipes by design (one broken folder
    // must not take the catalog down in production). This test is the flip
    // side: in CI a skipped recipe is a silently unshipped recipe, so every
    // directory that exists must round-trip into a catalog entry.
    const catalog = loadRecipeCatalog()
    const names = catalog.map((r) => r.name)
    for (const dir of recipeDirs()) {
      expect(names, `recipe '${dir}' is on disk but missing from the catalog (malformed frontmatter?)`).toContain(dir)
    }
    for (const entry of catalog) {
      expect(entry.description.length).toBeGreaterThan(0)
      expect(entry.triggers.length).toBeGreaterThan(0)
      expect(loadRecipe(entry.name)).toBeTruthy()
    }
  })

  it("no recipe file carries a URL, a uuid, or an emoji", () => {
    // Recipes are served content that teaches STRUCTURE and idioms — never an
    // address or a concrete asset. The copilot's media posture depends on ids
    // arriving from the user, not from prose it read; a URL in a recipe would
    // also rot the moment the asset moves.
    const urlRe = /https?:\/\//i
    const uuidRe = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
    const emojiRe = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u
    for (const dir of recipeDirs()) {
      for (const file of recipeFiles(dir)) {
        const text = readFileSync(file, "utf-8")
        expect(urlRe.test(text), `URL in ${file}`).toBe(false)
        expect(uuidRe.test(text), `uuid in ${file}`).toBe(false)
        expect(emojiRe.test(text), `emoji in ${file}`).toBe(false)
      }
    }
  })

  it("loads the full recipe body with frontmatter stripped", () => {
    const body = loadRecipe("video-explainer")
    expect(body).toBeTruthy()
    expect(body!.startsWith("---")).toBe(false) // frontmatter removed
    expect(body!).toContain("assemble_narrated_video")
  })

  it("one-character-any-scene teaches the token idiom", () => {
    const body = loadRecipe("one-character-any-scene")
    expect(body).toBeTruthy()
    // The load-bearing idiom the recipe exists to teach.
    expect(body!).toContain("{image:1:person} with {image:2:face}")
    expect(body!).toContain("references")
  })

  it("bundled reference files load through loadRecipeFile", () => {
    for (const [recipe, rel] of [
      ["one-character-any-scene", "references/prompts.md"],
      ["camera-coverage", "references/coverage-brief.md"],
      ["multi-reference-control", "references/prompt-walkthrough.md"],
      ["instagram-carousel", "references/system-prompt.md"],
    ] as const) {
      expect(loadRecipeFile(recipe, rel), `${recipe}/${rel}`).toBeTruthy()
    }
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

  it("sanity: the RECIPES_DIR this test scans is the directory the loader serves", () => {
    // If the relative resolution here ever drifts from resolveRecipesDir()'s,
    // the sweep above would scan nothing and pass vacuously.
    expect(existsSync(join(RECIPES_DIR, "video-explainer", "RECIPE.md"))).toBe(true)
    expect(recipeDirs().length).toBeGreaterThanOrEqual(8)
  })
})
