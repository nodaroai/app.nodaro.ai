// @test-watches backend/skills/** .claude/skills/nodaro-film-director/SKILL.md
/**
 * What the MCP document tools serve (decided 2026-11-15): the node skills,
 * the recipes, the workflow editor, the video and film directors, and the
 * Studio and Recast authoring guides a plugin answers.
 *
 * With nothing configured (no unit, no external wallet, self-serve on) every
 * one of them serves its source text unchanged: the file on disk, the
 * recipe's body, the markdown the route answered. Held here against the
 * source itself, never against a recording of it, so regenerating the skills
 * moves nothing in this test.
 */
import { describe, it, expect, vi, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"
import { EVERY_SCOPE, USER_ID } from "./_amounts-harness.js"

vi.hoisted(() => {
  for (const key of ["NODARO_SURFACE_PROFILE", "NODARO_PRICE_ANNOTATIONS", "DEPLOYMENT_WALLET_URL", "DEPLOYMENT_WALLET_TOKEN", "DEPLOYMENT_WALLET_SSO_PROVIDER"]) {
    process.env[key] = ""
  }
})

vi.mock("../../supabase.js", async () => {
  const { fakeSupabaseFrom: from } = await import("./_amounts-harness.js")
  return { supabase: { from: from(() => ({})), rpc: async () => ({ data: null, error: null }) } }
})
vi.mock("../../config.js", async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>
  return { ...orig, hasCredits: () => true }
})

const { buildMcpServer } = await import("../server.js")
const { callTool } = await import("../tools/__tests__/_helpers.js")
const { WORKFLOW_EDITOR_CONTENT, listAvailableNodeTypes, loadNodeSkillContent } = await import("../tools/skill-loaders.js")
const { loadRecipeCatalog, loadRecipe, loadRecipeFile } = await import("../tools/recipes.js")
const { loadVideoDirectorSkill } = await import("../tools/video-director.js")
const { FILM_DIRECTOR_SKILL_PATH } = await import("../tools/film-director.js")
const { __resetSurfaceProfileCacheForTests } = await import("../../surface-profile.js")

import { readdirSync, readFileSync, existsSync } from "node:fs"
import { resolve, dirname, relative } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const RECIPES_DIR = resolve(here, "../../../../skills/recipes")

/** A plugin's authoring guides, as its routes answer them: figures in credits, annotated and not. */
const PLUGIN_MARKDOWN = {
  recast: "## Budget\n\nA 60 s movie is about 2970 credits; each shot ~495cr. A render costs 55 credits<!-- credits: render-video -->.\n",
  studioSkill: "# Studio plan\n\nA keyframe costs 22 credits<!-- credits: video-overlay --> and a clip ≈110cr.\n",
  studioCatalog: "# Catalog\n\n| Model | Credits |\n|---|---|\n| a | 83 |\n",
  studioOperating: "# Operating\n\nEach take is charged 138 credits; nothing here is free.\n",
} as const

async function pluginRoutes(): Promise<FastifyInstance> {
  const fastify = Fastify()
  fastify.get("/v1/video-analysis/authoring-skill", async () => ({ markdown: PLUGIN_MARKDOWN.recast }))
  fastify.get("/v1/studio/productions/skill", async () => ({
    data: { skill: PLUGIN_MARKDOWN.studioSkill, catalog: PLUGIN_MARKDOWN.studioCatalog, operating: PLUGIN_MARKDOWN.studioOperating, schema: { type: "object", title: "Plan" } },
  }))
  await fastify.ready()
  return fastify
}

async function documentServer(fastify?: FastifyInstance) {
  return buildMcpServer({ userId: USER_ID, scopes: EVERY_SCOPE, clientName: "Claude", fastify: fastify ?? (await pluginRoutes()), conversation: { client: "claude", key: null } })
}

/** Every recipe file a client can ask for by `file`: everything in the recipe folder but RECIPE.md. */
function recipeFiles(name: string): string[] {
  const base = resolve(RECIPES_DIR, name)
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(resolve(dir, e.name)) : [resolve(dir, e.name)]))
  return walk(base).map((p) => relative(base, p)).filter((p) => p !== "RECIPE.md").sort()
}

const textOf = (res: { content?: Array<{ text?: string }> }) => res.content?.[0]?.text ?? ""

afterEach(() => {
  process.env.NODARO_SURFACE_PROFILE = ""
  __resetSurfaceProfileCacheForTests()
})

describe("nothing configured: every document is served exactly as its source", () => {
  it("get_node_skill serves each node's file byte for byte", async () => {
    const s = await documentServer()
    const types = listAvailableNodeTypes()
    expect(types.length).toBeGreaterThan(200)
    for (const type of types) {
      const res = await callTool(s, "get_node_skill", { node_type: type })
      expect(res.isError, type).toBeUndefined()
      expect(textOf(res), type).toBe(loadNodeSkillContent(type))
    }
  })

  it("start_workflow_editor serves workflow-editor.md", async () => {
    expect(textOf(await callTool(await documentServer(), "start_workflow_editor", {}))).toBe(WORKFLOW_EDITOR_CONTENT)
  })

  it("start_video_director and start_film_director serve their doctrine", async () => {
    const s = await documentServer()
    expect(textOf(await callTool(s, "start_video_director", {}))).toBe(loadVideoDirectorSkill())
    const film = textOf(await callTool(s, "start_film_director", {}))
    if (existsSync(FILM_DIRECTOR_SKILL_PATH)) expect(film).toBe(readFileSync(FILM_DIRECTOR_SKILL_PATH, "utf8"))
    expect(film.length).toBeGreaterThan(1000)
  })

  it("get_recipe serves the listing, each recipe's body and each of its files", async () => {
    const s = await documentServer()
    const catalog = loadRecipeCatalog()
    expect(catalog.length).toBeGreaterThan(5)
    const list = catalog.map((r) => `- **${r.name}** — ${r.description}\n  triggers: ${r.triggers.join(", ")}`).join("\n")
    expect(textOf(await callTool(s, "get_recipe", {}))).toBe(`Available recipes:\n${list}`)
    for (const { name } of catalog) {
      expect(textOf(await callTool(s, "get_recipe", { recipe: name })), name).toBe(loadRecipe(name))
      for (const file of recipeFiles(name)) {
        expect(textOf(await callTool(s, "get_recipe", { recipe: name, file })), `${name}/${file}`).toBe(loadRecipeFile(name, file))
      }
    }
  })

  it("the Recast and Studio guides a plugin answers are relayed as the route answered them", async () => {
    const s = await documentServer()
    expect(textOf(await callTool(s, "get_recast_authoring_skill", {}))).toBe(PLUGIN_MARKDOWN.recast)
    expect(textOf(await callTool(s, "get_studio_production_skill", {}))).toBe(PLUGIN_MARKDOWN.studioOperating)
    expect(textOf(await callTool(s, "get_studio_production_skill", { part: "authoring" }))).toBe(PLUGIN_MARKDOWN.studioSkill)
    expect(textOf(await callTool(s, "get_studio_production_skill", { part: "catalog" }))).toBe(PLUGIN_MARKDOWN.studioCatalog)
  })
})

// ── on a deployment in its own terms ───────────────────────────────────────

/** The deployment's unit here: 0.25 points per credit, two decimals. */
const UNIT = { unitLabel: "points", unitRate: 0.25, unitDecimals: 2 }

function setProfile(billing: Record<string, unknown>) {
  process.env.NODARO_SURFACE_PROFILE = JSON.stringify({ billing })
  __resetSurfaceProfileCacheForTests()
}

/** Every document a client can be served, by the call that serves it. */
async function everyDocument(): Promise<Array<{ call: string; text: string }>> {
  const s = await documentServer()
  const out: Array<{ call: string; text: string }> = []
  const serve = async (call: string, tool: string, args: Record<string, unknown>) => out.push({ call, text: textOf(await callTool(s, tool, args)) })
  for (const type of listAvailableNodeTypes()) await serve(`get_node_skill ${type}`, "get_node_skill", { node_type: type })
  await serve("get_recipe", "get_recipe", {})
  for (const { name } of loadRecipeCatalog()) {
    await serve(`get_recipe ${name}`, "get_recipe", { recipe: name })
    for (const file of recipeFiles(name)) await serve(`get_recipe ${name} ${file}`, "get_recipe", { recipe: name, file })
  }
  await serve("start_workflow_editor", "start_workflow_editor", {})
  await serve("start_video_director", "start_video_director", {})
  await serve("start_film_director", "start_film_director", {})
  await serve("get_recast_authoring_skill", "get_recast_authoring_skill", {})
  for (const part of ["operating", "authoring", "catalog"]) await serve(`get_studio_production_skill ${part}`, "get_studio_production_skill", { part })
  return out
}

/**
 * A raw credit figure, read more broadly than the funnel rewrites: a number
 * anywhere in the same clause before a credits word, or an annotation left.
 */
const RAW_FIGURE = /\d(?:[^\n.;:]|\.\d){0,40}?\b(?:credits?|cr)\b|<!--\s*credits/gi

/**
 * What the broad read finds that is not a figure in credits — each one looked
 * at. A new entry needs a reason; a new figure is not one.
 */
const NOT_A_FIGURE: Readonly<Record<string, readonly string[]>> = {
  // "a 400 before any credit is reserved": an HTTP status.
  "get_node_skill add-captions": ["400 before any credit"],
  "get_node_skill transcribe": ["400 before any credit"],
  // The per-run fee already in points, then its "(credit id `use-case-fee:…`)".
  "get_node_skill clip-pack": ["2.75 points** (credit"],
  "get_node_skill episode-trailer": ["2.75 points** (credit"],
  "get_node_skill tighten-episode": ["2.75 points** (credit"],
  // "kling-3.0 enabling audio raises the credit cost": a model version; "nearly 2× the credits": a ratio of two tiers.
  "get_node_skill generate-video": ["3.0 enabling audio raises the credit", "2× the credits"],
  "get_node_skill image-to-video": ["3.0 enabling audio raises the credit", "2× the credits"],
  "get_node_skill text-to-video": ["3.0 enabling audio raises the credit", "2× the credits"],
  // "GET /v1/credits/model-cost": a path.
  "get_node_skill speaker-view": ["1/credits"],
}

describe("a deployment in its own terms: no served document states a raw credit figure", () => {
  it("with its own unit: none in any document, what the broad read finds is pinned", async () => {
    setProfile({ ...UNIT, selfServe: false })
    const found: Record<string, string[]> = {}
    for (const { call, text } of await everyDocument()) {
      const hits = [...text.matchAll(RAW_FIGURE)].map((m) => m[0])
      if (hits.length > 0) found[call] = hits
    }
    expect(found).toEqual(NOT_A_FIGURE)
  })

  it("every node skill's price line becomes the pointer, and each skill has exactly one, in the generated block", () => {
    for (const type of listAvailableNodeTypes()) {
      const text = loadNodeSkillContent(type)!
      const lines = text.split("\n").filter((l) => /\*\*Credit cost:\*\*/.test(l))
      expect(lines.length, type).toBe(1)
      expect(lines[0], type).toMatch(/^\*\*Credit cost:\*\*/)
      const block = /<!-- AUTO-GEN:START node-data-shape -->([\s\S]*?)<!-- AUTO-GEN:END node-data-shape -->/.exec(text)?.[1] ?? ""
      expect(block, `${type}: the price line sits in the generated block`).toContain(lines[0])
    }
  })

  it("a node skill's figures: the price line a pointer, an exact figure converted, a rate the unit can not hold a pointer", async () => {
    setProfile({ ...UNIT })
    const s = await documentServer()
    const render = textOf(await callTool(s, "get_node_skill", { node_type: "render-video" }))
    expect(render).toContain("**Credit cost:** on this deployment, `list_models` (`priceIds`) and the description of the tool that runs this node state the price in points; this line names no figure.")
    // 55 credits → 13.75 points; 83 → 20.75; 138 → 34.5 (the annotation's comment dropped).
    expect(render).toContain("the base 13.75 points whatever its shape")
    expect(render).toContain("it is 20.75 points up to 5.12 megapixels and 34.5 above")
    expect(render).not.toMatch(/<!--\s*credits/)
    const llm = textOf(await callTool(s, "get_node_skill", { node_type: "llm-chat" }))
    expect(llm).toContain('**Credit cost:** on this deployment, `list_models` with `priceIds: ["llm-chat:<model id>"]` quotes a call in points')
    const speaker = textOf(await callTool(s, "get_node_skill", { node_type: "speaker-view" }))
    // 2.2 → 0.55 and 13.2 → 3.3 are exact at two decimals; 3.3 → 0.825 is not, so it points at its price id.
    expect(speaker).toContain("is charged 0.55 points a minute")
    expect(speaker).toContain("the figure `list_models` quotes in points for `speaker-view:complex:proxy` / 3.3 a minute")
    // A count times a figure carries no price id: never converted, the pointer.
    const sync = textOf(await callTool(s, "get_node_skill", { node_type: "audio-sync" }))
    expect(sync).toContain("Priced (sources − 1) × an amount `list_models` states in points.")
  })

  it("a recipe's figures, annotated and written as approximate, in the unit; approximate stays approximate", async () => {
    setProfile({ ...UNIT })
    const recipe = textOf(await callTool(await documentServer(), "get_recipe", { recipe: "video-explainer" }))
    expect(recipe).toContain("~123.75 points per 10s block ≈ 742.5 points/min of video")
    expect(recipe).toContain("a fixed ~42.5 points total via `create_explainer` (~50 points when")
    expect(recipe).toContain("Cost anchor: **123.75 points/block**")
    expect(recipe).toContain("6 blocks → 11 points, 24 blocks → 19.25 points, 60 blocks →\n35.75 points.")
  })

  it("the guides a plugin answers: every figure the docs price check reads as one, in the unit", async () => {
    setProfile({ ...UNIT })
    const s = await documentServer()
    expect(textOf(await callTool(s, "get_recast_authoring_skill", {}))).toBe(
      "## Budget\n\nA 60 s movie is about 742.5 points; each shot ~123.75 points. A render costs 13.75 points.\n",
    )
    expect(textOf(await callTool(s, "get_studio_production_skill", { part: "authoring" }))).toBe(
      "# Studio plan\n\nA keyframe costs 5.5 points and a clip ≈27.5 points.\n",
    )
    expect(textOf(await callTool(s, "get_studio_production_skill", { part: "catalog" }))).toBe("# Catalog\n\n| Model | Points |\n|---|---|\n| a | 20.75 |\n")
    expect(textOf(await callTool(s, "get_studio_production_skill", { part: "operating" }))).toBe("# Operating\n\nEach take is charged 34.5 points; nothing here is free.\n")
  })

  it("no unit, only the balance managed by the deployment: figures stay in credits, the price line still points at the deployment's own price", async () => {
    setProfile({ selfServe: false })
    const render = textOf(await callTool(await documentServer(), "get_node_skill", { node_type: "render-video" }))
    expect(render).toContain("state the price in credits; this line names no figure.")
    expect(render).not.toContain("Nodaro Cloud")
    expect(render).toContain("the base 55 credits whatever its shape")
    expect(render).not.toMatch(/<!--\s*credits/)
  })

  it("the rate is never stated", async () => {
    setProfile({ ...UNIT })
    for (const { call, text } of await everyDocument()) expect(text, call).not.toMatch(/\b0\.25\b/)
  })
})
