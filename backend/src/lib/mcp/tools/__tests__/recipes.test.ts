import { readFileSync, readdirSync, existsSync, statSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join, resolve } from "node:path"
import { describe, it, expect, vi, beforeEach } from "vitest"
import { listRecipes, loadAnyRecipe, loadRecipeCatalog, loadRecipe, loadRecipeFile, parseRecipeFrontmatter, registerRecipeTool } from "../recipes.js"

vi.mock("../../../private-plugins/recipe-registry.js", () => ({ getPluginRecipes: () => mockRecipes }))
let mockRecipes: Record<string, { description: string; triggers: string[]; library?: boolean; body: string; files: Record<string, string> }> = {}
const session = (firstParty = false) => ({ firstParty }) as never

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

  it("product-photoshoot teaches the ownership fork", () => {
    const body = loadRecipe("product-photoshoot")
    expect(body).toBeTruthy()
    // The load-bearing distinction: a foreign photo may only feed the
    // describe node — never any generate node's references input.
    expect(body!).toContain("Is the photo YOUR product")
    expect(body!).toContain("the foreign photo touches ONLY the describe node")
  })

  it("song-from-reference leads with the ownership fork — analysis, never a cover, for foreign songs", () => {
    const body = loadRecipe("song-from-reference")
    expect(body).toBeTruthy()
    // The load-bearing lesson (incident 2026-08-25: a released song wired
    // into suno-cover was refused by catalog matching AFTER the pipeline ran).
    expect(body!).toContain("whose recording is it?")
    expect(body!).toContain("Do NOT build a cover from it")
    // The v4 lesson (owner's correct example): the analysis emits a FILM
    // JSON, so an llm-chat DISTILLER sits between analyzer and composer,
    // with its name-scrubbing system prompt shipped as a reference file.
    expect(body!).toContain("Never wire it")
    expect(body!).toContain("references/style-brief-system-prompt.md")
  })

  it("bundled reference files load through loadRecipeFile", () => {
    for (const [recipe, rel] of [
      ["one-character-any-scene", "references/prompts.md"],
      ["camera-coverage", "references/coverage-brief.md"],
      ["multi-reference-control", "references/prompt-walkthrough.md"],
      ["instagram-carousel", "references/system-prompt.md"],
      ["product-photoshoot", "references/shot-list.md"],
      ["song-from-reference", "references/style-brief-system-prompt.md"],
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

describe("plugin recipe seam", () => {
  beforeEach(() => {
    mockRecipes = {
      "cloud-flow": { description: "A cloud flow", triggers: ["cloud"], body: "FLOW", files: { "ref.md": "REF" } },
      "cloud-lib": { description: "lib", triggers: ["lib"], library: true, body: "LIB", files: {} },
      "video-explainer": { description: "shadow", triggers: ["x"], body: "SHADOW", files: {} },
    }
  })
  it("lists plugin recipes but not libraries", () => {
    const names = listRecipes(session()).map((r) => r.name)
    expect(names).toContain("cloud-flow")
    expect(names).not.toContain("cloud-lib")
  })
  it("a local recipe wins a name collision", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined)
    expect(loadAnyRecipe("video-explainer")).not.toBe("SHADOW")
    expect(listRecipes(session()).filter((r) => r.name === "video-explainer")).toHaveLength(1)
    expect(warnSpy.mock.calls.flat().join(" ")).toContain("video-explainer")
    warnSpy.mockRestore()
  })
  it("loads a plugin recipe body, a plugin file, and a library by name", () => {
    expect(loadAnyRecipe("cloud-flow")).toBe("FLOW")
    expect(loadAnyRecipe("cloud-flow", "ref.md")).toBe("REF")
    expect(loadAnyRecipe("cloud-lib")).toBe("LIB")
  })
  it.each(["../ref.md", "/etc/passwd", "..\\ref.md", "%2e%2e/ref.md"])("path-shaped file key %s is a plain miss", (f) => {
    expect(loadAnyRecipe("cloud-flow", f)).toBeNull()
  })
  it.each(["constructor", "__proto__"])("prototype-shaped recipe name %s is a plain miss", (n) => {
    expect(loadAnyRecipe(n)).toBeNull()
    expect(loadAnyRecipe(n, "x.md")).toBeNull()
  })
  it("constructor is a miss even with no plugins registered", () => {
    mockRecipes = {}
    expect(loadAnyRecipe("constructor")).toBeNull()
    expect(loadAnyRecipe("constructor", "x.md")).toBeNull()
  })
  it("first-party (copilot) sessions see no plugin recipes", () => {
    expect(listRecipes(session(true)).map((r) => r.name)).not.toContain("cloud-flow")
  })
  it("localOnly makes every plugin recipe, file and library a miss; local recipes still load", () => {
    expect(loadAnyRecipe("cloud-flow", undefined, { localOnly: true })).toBeNull()
    expect(loadAnyRecipe("cloud-flow", "ref.md", { localOnly: true })).toBeNull()
    expect(loadAnyRecipe("cloud-lib", undefined, { localOnly: true })).toBeNull()
    expect(loadAnyRecipe("video-explainer", undefined, { localOnly: true })).toBe(loadRecipe("video-explainer"))
    expect(loadAnyRecipe("video-explainer", "references/prompts.md", { localOnly: true })).toBe(
      loadRecipeFile("video-explainer", "references/prompts.md"),
    )
  })
  describe("get_recipe handler", () => {
    type ToolResult = { isError?: boolean; content: { type: string; text: string }[] }
    const handlerFor = (firstParty: boolean) => {
      let handler: ((args: { recipe?: string; file?: string }) => Promise<ToolResult>) | undefined
      const server = { registerTool: (_n: string, _c: unknown, h: typeof handler) => { handler = h } }
      registerRecipeTool(server as never, session(firstParty))
      if (!handler) throw new Error("get_recipe was not registered")
      return handler
    }
    it("a first-party (copilot) session cannot load a plugin recipe, library or file by name", async () => {
      const get = handlerFor(true)
      const body = await get({ recipe: "cloud-flow" })
      expect(body.isError).toBe(true)
      expect(body.content[0].text).toContain("No recipe 'cloud-flow'")
      expect(body.content[0].text).not.toContain("FLOW")
      const lib = await get({ recipe: "cloud-lib" })
      expect(lib.isError).toBe(true)
      expect(lib.content[0].text).toContain("No recipe 'cloud-lib'")
      const file = await get({ recipe: "cloud-flow", file: "ref.md" })
      expect(file.isError).toBe(true)
      expect(file.content[0].text).not.toContain("REF")
    })
    it("a first-party (copilot) session still loads local recipes and their files", async () => {
      const get = handlerFor(true)
      const body = await get({ recipe: "video-explainer" })
      expect(body.isError).toBeUndefined()
      expect(body.content[0].text).toBe(loadRecipe("video-explainer"))
      const file = await get({ recipe: "video-explainer", file: "references/prompts.md" })
      expect(file.isError).toBeUndefined()
      expect(file.content[0].text).toBe(loadRecipeFile("video-explainer", "references/prompts.md"))
    })
    it("a third-party session loads plugin recipes and files", async () => {
      const get = handlerFor(false)
      expect((await get({ recipe: "cloud-flow" })).content[0].text).toBe("FLOW")
      expect((await get({ recipe: "cloud-flow", file: "ref.md" })).content[0].text).toBe("REF")
      expect((await get({ recipe: "cloud-lib" })).content[0].text).toBe("LIB")
    })
  })
  it("with no plugins the listing equals the local catalog", () => {
    mockRecipes = {}
    expect(listRecipes(session()).map((r) => r.name)).toEqual(loadRecipeCatalog().map((r) => r.name))
  })
})
