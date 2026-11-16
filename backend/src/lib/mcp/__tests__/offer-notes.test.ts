// @test-watches backend/skills/** .claude/skills/nodaro-film-director/SKILL.md backend/src/lib/mcp/__tests__/fixtures/served-document-names.json
/**
 * What the MCP lane's guides, recipes and node skills teach follows what the
 * session is offered (lib/mcp/offer-note.ts, decided 2026-11-16): on a
 * deployment that restricts what it offers, a served document that names a
 * tool the session is not listed or a model the deployment withholds opens
 * with a generated note saying which, read from the document itself; one that
 * names nothing withheld is served as it came; with nothing restricted every
 * document is its source (deployment-documents.test.ts).
 *
 * WHAT EACH DOCUMENT NAMES is pinned in fixtures/served-document-names.json,
 * independent of any profile: a new document, a renamed tool or a model newly
 * named shows up in review. Rewrite it with the change it belongs to:
 *   cd backend && UPDATE_SERVED_DOCUMENT_NAMES=1 npx vitest run src/lib/mcp/__tests__/offer-notes.test.ts
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import Fastify from "fastify"
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { dirname, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { ALL_SCOPES } from "../../scopes.js"

vi.hoisted(() => {
  for (const key of ["NODARO_SURFACE_PROFILE", "NODARO_PRICE_ANNOTATIONS", "DEPLOYMENT_WALLET_URL", "DEPLOYMENT_WALLET_TOKEN", "DEPLOYMENT_WALLET_SSO_PROVIDER"]) {
    process.env[key] = ""
  }
})

const h = vi.hoisted(() => ({ admins: new Set<string>() }))
vi.mock("../../supabase.js", async () => {
  const { fakeSupabaseFrom: from } = await import("./_amounts-harness.js")
  return { supabase: { from: from(() => ({})), rpc: async () => ({ data: null, error: null }) } }
})
vi.mock("../../admin-check.js", () => ({ checkIsAdmin: async (userId: string) => h.admins.has(userId), warmAdminCache: () => {} }))
vi.mock("../../config.js", async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>
  return { ...orig, hasCredits: () => true }
})

const { buildMcpServer } = await import("../server.js")
const { createMcpInvoker } = await import("../invoke.js")
const { NOT_READ_AS_MODELS, namedInText, namedInTool, offerNote, withOfferNote } = await import("../offer-note.js")
const { TOOL_NEEDS } = await import("../tool-needs.js")
const { resolveToolOffer } = await import("../tool-offer.js")
const { WORKFLOW_EDITOR_CONTENT, listAvailableNodeTypes, loadNodeSkillContent } = await import("../tools/skill-loaders.js")
const { loadRecipeCatalog, loadRecipe, loadRecipeFile } = await import("../tools/recipes.js")
const { loadVideoDirectorSkill } = await import("../tools/video-director.js")
const { FILM_DIRECTOR_SKILL_PATH, FALLBACK_SKILL_CONTENT } = await import("../tools/film-director.js")
const { __resetSurfaceProfileCacheForTests } = await import("../../surface-profile.js")
const { __resetAvailabilityOverridesForTests, __availabilityUniverseReadyForTests, storedNodesEnabled, GATEABLE_NODE_TYPES, GATEABLE_MODEL_IDS, KNOWN_NODE_TYPES } =
  await import("../../availability-override.js")
type ToolOffer = import("../tool-offer.js").ToolOffer

const here = dirname(fileURLToPath(import.meta.url))
const RECIPES_DIR = resolve(here, "../../../../skills/recipes")
const FIXTURE_PATH = resolve(here, "fixtures/served-document-names.json")

function setProfile(profile: object | null): void {
  if (profile === null) delete process.env.NODARO_SURFACE_PROFILE
  else process.env.NODARO_SURFACE_PROFILE = JSON.stringify(profile)
  __resetSurfaceProfileCacheForTests()
}

/** Every gateable node but `left` — an override saved in Admin → Availability leaving them off. */
function overrideLeavingOff(...left: string[]): Set<string> {
  return new Set(storedNodesEnabled([...GATEABLE_NODE_TYPES].filter((t) => !left.includes(t))))
}

/** The guides a plugin answers, as its routes would: each names a tool and models. */
const PLUGIN_MARKDOWN = {
  recast: "## Render\n\nRender each shot with `generate_video` on Seedance 2, never veo3.1.\n",
  studioSkill: "# Studio plan\n\nVoice each shot with `generate_speech`.\n",
  studioCatalog: "# Catalog\n\n| Model | Use |\n|---|---|\n| `veo3.1` | hero shots |\n| `gpt-image-2` | stills |\n",
  studioOperating: "# Operating\n\nCall `get_studio_production` to follow a production.\n",
} as const

async function pluginRoutes() {
  const fastify = Fastify()
  fastify.get("/v1/video-analysis/authoring-skill", async () => ({ markdown: PLUGIN_MARKDOWN.recast }))
  fastify.get("/v1/studio/productions/skill", async () => ({
    data: { skill: PLUGIN_MARKDOWN.studioSkill, catalog: PLUGIN_MARKDOWN.studioCatalog, operating: PLUGIN_MARKDOWN.studioOperating, schema: { type: "object" } },
  }))
  await fastify.ready()
  return fastify
}

async function session(userId = "u1") {
  const server = await buildMcpServer({ userId, scopes: [...ALL_SCOPES], clientName: "Claude", fastify: await pluginRoutes() })
  return createMcpInvoker(server)
}

/** The note's first and last lines, around the lines that name what is withheld. */
const NOTE_HEAD = "> **Not offered on this deployment.** This document names tools or models this session cannot use.\n"
const NOTE_TAIL = "> Use only the tools in your tool list and the models `list_models` returns; do not plan with, or offer the user, anything named above.\n\n"

const textOf = (res: { content: { text?: string }[] }) => res.content.map((c) => c.text ?? "").join("\n")

/** The film director's doctrine as it is served with nothing restricted. */
const FILM_DIRECTOR = existsSync(FILM_DIRECTOR_SKILL_PATH) ? readFileSync(FILM_DIRECTOR_SKILL_PATH, "utf8") : FALLBACK_SKILL_CONTENT

/** Every recipe file a client can ask for by `file`: everything in the recipe folder but RECIPE.md. */
function recipeFiles(name: string): string[] {
  const base = resolve(RECIPES_DIR, name)
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(resolve(dir, e.name)) : [resolve(dir, e.name)]))
  return walk(base).map((p) => relative(base, p)).filter((p) => p !== "RECIPE.md").sort()
}

/** Every document this repository serves, by the call that serves it, as it is served with nothing restricted. */
function everyDocument(): Record<string, string> {
  const out: Record<string, string> = {}
  for (const type of listAvailableNodeTypes()) out[`get_node_skill ${type}`] = loadNodeSkillContent(type)!
  const catalog = loadRecipeCatalog()
  out["get_recipe"] = `Available recipes:\n${catalog.map((r) => `- **${r.name}** — ${r.description}\n  triggers: ${r.triggers.join(", ")}`).join("\n")}`
  for (const { name } of catalog) {
    out[`get_recipe ${name}`] = loadRecipe(name)!
    for (const file of recipeFiles(name)) out[`get_recipe ${name} ${file}`] = loadRecipeFile(name, file)!
  }
  out["start_workflow_editor"] = WORKFLOW_EDITOR_CONTENT
  out["start_video_director"] = loadVideoDirectorSkill()
  out["start_film_director"] = FILM_DIRECTOR
  return out
}

/** One line per document: what it names, as the fixture records it. */
function namesLine(text: string): string {
  const { tools, models } = namedInText(text)
  return `tools: ${tools.join(" ") || "-"} | models: ${models.map((m) => (m.label ? `${m.id}="${m.label}"` : m.id)).join(" ") || "-"}`
}

/** An offer that withholds exactly the named tools and models. */
function fakeOffer(tools: readonly string[], models: readonly string[] = []): ToolOffer {
  return {
    viewer: { admin: false },
    refusalOf: (t) => (tools.includes(t) ? { code: "node_not_available", message: "x" } : undefined),
    nodeOffered: () => true,
    modelOffered: (id) => !models.includes(id),
  }
}

beforeAll(async () => {
  await __availabilityUniverseReadyForTests()
}, 120_000)

afterEach(() => {
  setProfile(null)
  __resetAvailabilityOverridesForTests()
  h.admins = new Set()
})

describe("reading what a text names", () => {
  it("a tool with an underscore counts wherever it stands, never inside a longer name", () => {
    expect(namedInText("Call mix_audio, then `silence_detect`.").tools).toEqual(["mix_audio", "silence_detect"])
    expect(namedInText("mcp__nodaro__mix_audio and remix_audio_x and mix_audio_extra").tools).toEqual([])
  })

  it("a one-word tool counts only where the text writes it as code: it is also a word and a node type", () => {
    expect(namedInText("Do not transcribe lyrics; an agent-made slideshow; reduce noise.").tools).toEqual([])
    expect(namedInText("Run `transcribe` on it, or `reduce(…)`; \"slideshow\".").tools).toEqual(["reduce", "slideshow", "transcribe"])
  })

  it("a model id is read whole: never inside a longer id, and a full stop after it ends the sentence", () => {
    const ids = (t: string) => namedInText(t).models.map((m) => m.id)
    expect(ids("Use veo3.1 here")).toEqual(["veo3.1"])
    expect(ids("Use seedance-2-fast or seedance-2.5")).toEqual(["seedance-2-fast"])
    expect(ids("Prefer seedance-2.")).toEqual(["seedance-2"])
    expect(ids("veo3_lite and veo3")).toEqual(["veo3", "veo3_lite"])
    expect(ids("https://example.com/seedance-2/x and fal/seedance-2")).toEqual([])
  })

  it("a label is read longest first: a shorter label never counts inside a longer one", () => {
    expect(namedInText("Gemini Omni Flash 1.2 beats Gemini Omni Flash").models).toEqual([
      { id: "gemini-omni-flash", label: "Gemini Omni Flash" },
      { id: "gemini-omni-flash-1-2", label: "Gemini Omni Flash 1.2" },
    ])
    expect(namedInText("Gemini Omni first").models).toEqual([{ id: "gemini-omni-video", label: "Gemini Omni" }])
  })

  it("a plain-word id or label counts only as code", () => {
    expect(namedInText("the suno prompt; fast whisper; Whisper").models).toEqual([])
    expect(namedInText('`whisper` and "suno"').models.map((m) => m.id)).toEqual(["suno", "whisper"])
  })

  it("an id that is a node type or a tool name is read as that, never as a model (held both ways)", () => {
    const colliding = [...GATEABLE_MODEL_IDS].filter((id) => KNOWN_NODE_TYPES.has(id) || Object.hasOwn(TOOL_NEEDS, id)).sort()
    expect(Object.keys(NOT_READ_AS_MODELS).sort()).toEqual(colliding)
    for (const why of Object.values(NOT_READ_AS_MODELS)) expect(why.length).toBeGreaterThan(20)
    expect(namedInText("- `motion-transfer` — Motion Transfer\n- `video-audit` — AI Audit").models).toEqual([])
  })
})

describe("reading what a listed tool names", () => {
  it("reads its description, its arguments' descriptions and the model ids its enums, constants and defaults offer", () => {
    const tool = {
      description: "Call `mix_audio` after.",
      inputSchema: {
        type: "object",
        properties: {
          model: { type: "string", enum: ["elevenlabs-v3", "not-a-model"], default: "elevenlabs-v4" },
          engine: { anyOf: [{ const: "whisper" }, { type: "string", description: "e.g. veo3.1" }] },
          // A mode enum that shares spellings with node types names no model.
          mode: { type: "string", enum: ["t2v", "motion-transfer", "video-audit"] },
        },
      },
    }
    expect(namedInTool(tool)).toEqual({
      tools: ["mix_audio"],
      models: [{ id: "elevenlabs-v3" }, { id: "elevenlabs-v4" }, { id: "veo3.1" }, { id: "whisper" }],
    })
  })
})

describe("the note", () => {
  it("names exactly what is withheld; a text that names nothing withheld gets none", () => {
    const text = "Use `mix_audio` and generate_image with veo3.1 or ElevenLabs v4."
    expect(withOfferNote(text, fakeOffer([]))).toBe(text)
    expect(withOfferNote(text, fakeOffer(["silence_detect"], ["seedance-2"]))).toBe(text)
    expect(withOfferNote(text, fakeOffer(["mix_audio"], ["veo3.1", "elevenlabs-v4"]))).toBe(
      "> **Not offered on this deployment.** This document names tools or models this session cannot use.\n" +
        "> Tools not in your tool list: `mix_audio`.\n" +
        "> Models not offered here: ElevenLabs v4 (`elevenlabs-v4`), `veo3.1`.\n" +
        "> Use only the tools in your tool list and the models `list_models` returns; do not plan with, or offer the user, anything named above.\n\n" +
        text,
    )
  })

  it("goes after a document's frontmatter, so the document still opens with it", () => {
    const text = "---\nname: x\n---\n\n# Title\n\nCall `mix_audio`.\n"
    const noted = withOfferNote(text, fakeOffer(["mix_audio"]))
    expect(noted.startsWith("---\nname: x\n---\n> **Not offered on this deployment.**")).toBe(true)
    expect(noted.endsWith("\n\n\n# Title\n\nCall `mix_audio`.\n")).toBe(true)
  })

  it("names no figure and no credits", () => {
    expect(offerNote({ tools: ["mix_audio"], models: [{ id: "veo3.1" }] })).not.toMatch(/credit|\d+\s*cr\b/i)
  })
})

describe("what each served document names (pinned)", () => {
  it("is recorded in fixtures/served-document-names.json", () => {
    const actual = Object.fromEntries(Object.entries(everyDocument()).map(([call, text]) => [call, namesLine(text)]))
    if (process.env.UPDATE_SERVED_DOCUMENT_NAMES === "1") {
      writeFileSync(FIXTURE_PATH, `${JSON.stringify(actual, null, 1)}\n`)
      return
    }
    const recorded = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as Record<string, string>
    expect(
      actual,
      "what a served document names changed — if that is intended, rewrite fixtures/served-document-names.json " +
        "(UPDATE_SERVED_DOCUMENT_NAMES=1, see the top of this file) in the same change",
    ).toEqual(recorded)
  })
})

// ── through the server, on a deployment that restricts what it offers ─────

/** A deployment that offers image and video generation only. */
const IMAGE_AND_VIDEO = { nodes: { allow: ["generate-image", "generate-video"] } }

/** The note the film director's doctrine opens with on that deployment. */
const FILM_NOTE_IMAGE_AND_VIDEO =
  "> **Not offered on this deployment.** This document names tools or models this session cannot use.\n" +
  "> Tools not in your tool list: `combine_videos`, `extract_frame`, `generate_music`, `generate_speech`, `generate_text`, `image_to_image`, `merge_video_audio`, `mix_audio`, `pitch_tempo`, `silence_detect`, `transcribe`, `trim_audio`, `trim_video`, `video_analysis`.\n" +
  "> Use only the tools in your tool list and the models `list_models` returns; do not plan with, or offer the user, anything named above."

describe("the film director's doctrine on a deployment that offers image and video generation only", () => {
  it("opens with the note (after its frontmatter); the doctrine itself is unchanged", async () => {
    setProfile(IMAGE_AND_VIDEO)
    const served = textOf(await (await session()).callTool("start_film_director", {}))
    expect(served).toBe(withOfferNote(FILM_DIRECTOR, fakeOffer(FILM_NOTE_TOOLS)))
    expect(served).toContain(FILM_NOTE_IMAGE_AND_VIDEO)
    expect(served.replace(`${FILM_NOTE_IMAGE_AND_VIDEO}\n\n`, "")).toBe(FILM_DIRECTOR)
  })

  it("with models restricted too, it names the models the doctrine prefers that are withheld", async () => {
    setProfile({ ...IMAGE_AND_VIDEO, models: { allow: ["gpt-image-2", "seedance-2"] } })
    const served = textOf(await (await session()).callTool("start_film_director", {}))
    expect(served).toContain(
      "> Models not offered here: ElevenLabs STT (`elevenlabs-stt`), ElevenLabs v4 (`elevenlabs-v4`), `gemini-3.8-flash`, Gemini Omni Flash 1.2 (`gemini-omni-flash-1-2`), Gemini Omni (`gemini-omni-video`), `gpt-image-2-6-sunburst`, `veo3.1`.\n",
    )
    // Offered: named in the doctrine, never in the note.
    expect(served.split("\n\n")[0]).not.toMatch(/`gpt-image-2`|`seedance-2`/)
  })
})

/** The tools the film director's doctrine names that the image-and-video deployment does not list. */
const FILM_NOTE_TOOLS = [
  "combine_videos", "extract_frame", "generate_music", "generate_speech", "generate_text", "image_to_image", "merge_video_audio",
  "mix_audio", "pitch_tempo", "silence_detect", "transcribe", "trim_audio", "trim_video", "video_analysis",
]

describe("every document tool on a restricted deployment", () => {
  it("serves exactly its source with the note the session's own offer calls for", async () => {
    setProfile({ ...IMAGE_AND_VIDEO, models: { allow: ["gpt-image-2", "seedance-2"] } })
    const mcp = await session()
    const offer = (await resolveToolOffer("u1"))!
    const docs = everyDocument()
    const calls: Array<[string, string, Record<string, unknown>]> = [
      ["start_video_director", "start_video_director", {}],
      ["start_film_director", "start_film_director", {}],
      ["get_recipe", "get_recipe", {}],
      ...loadRecipeCatalog().map((r): [string, string, Record<string, unknown>] => [`get_recipe ${r.name}`, "get_recipe", { recipe: r.name }]),
      ["get_node_skill generate-image", "get_node_skill", { node_type: "generate-image" }],
      ["get_node_skill generate-video", "get_node_skill", { node_type: "generate-video" }],
    ]
    let noted = 0
    for (const [key, tool, args] of calls) {
      const expected = withOfferNote(docs[key]!, offer)
      if (expected !== docs[key]) noted++
      expect(textOf(await mcp.callTool(tool, args)), key).toBe(expected)
    }
    expect(noted).toBeGreaterThan(3)
    // The workflow editor's catalog leaves out the withheld nodes, then the rest is read.
    const { workflowEditorContentFor } = await import("../tools/skill-loaders.js")
    expect(textOf(await mcp.callTool("start_workflow_editor", {}))).toBe(withOfferNote(workflowEditorContentFor({ offer }), offer))
  })

  it("a document that names nothing withheld is served as it came", async () => {
    setProfile({ models: { deny: ["veo3.1"] } })
    const mcp = await session()
    for (const type of ["text-prompt", "generate-image"]) {
      const source = loadNodeSkillContent(type)!
      expect(namedInText(source).models.map((m) => m.id), type).not.toContain("veo3.1")
      expect(textOf(await mcp.callTool("get_node_skill", { node_type: type })), type).toBe(source)
    }
  })
})

describe("each document tool's note on the image-and-video deployment (exact lists)", () => {
  it("start_video_director names the shot-sequence tools it drives", async () => {
    setProfile(IMAGE_AND_VIDEO)
    const served = textOf(await (await session()).callTool("start_video_director", {}))
    expect(served).toBe(
      NOTE_HEAD + "> Tools not in your tool list: `forced_alignment`, `generate_speech`, `render_shot_sequence`, `resolve_shot_sequence`.\n" + NOTE_TAIL + loadVideoDirectorSkill(),
    )
  })

  it("the recipe listing names nothing withheld: no note", async () => {
    setProfile(IMAGE_AND_VIDEO)
    expect(textOf(await (await session()).callTool("get_recipe", {}))).toBe(everyDocument()["get_recipe"])
  })

  it("the podcast-editing recipe names the editing tools this deployment does not list", async () => {
    setProfile(IMAGE_AND_VIDEO)
    const served = textOf(await (await session()).callTool("get_recipe", { recipe: "podcast-editing" }))
    expect(served).toBe(
      NOTE_HEAD +
        "> Tools not in your tool list: `apply_edl`, `audio_sync`, `continue_use_case`, `make_chapters`, `make_clip_pack`, `make_trailer`, `mix_audio`, `plan_edit`, `silence_detect`, `speaker_layout`, `speaker_map`, `switch_cameras`, `tighten_episode`, `transcribe`.\n" +
        NOTE_TAIL +
        loadRecipe("podcast-editing"),
    )
  })

  it("the Studio guides a plugin answers: the tool and the model each names, after the deployment's own reading", async () => {
    setProfile({ ...IMAGE_AND_VIDEO, models: { allow: ["gpt-image-2", "seedance-2"] } })
    const mcp = await session()
    expect(textOf(await mcp.callTool("get_studio_production_skill", { part: "authoring" }))).toBe(
      NOTE_HEAD + "> Tools not in your tool list: `generate_speech`.\n" + NOTE_TAIL + PLUGIN_MARKDOWN.studioSkill,
    )
    expect(textOf(await mcp.callTool("get_studio_production_skill", { part: "catalog" }))).toBe(
      NOTE_HEAD + "> Models not offered here: `veo3.1`.\n" + NOTE_TAIL + PLUGIN_MARKDOWN.studioCatalog,
    )
    // Names only what this session is offered: no note.
    expect(textOf(await mcp.callTool("get_studio_production_skill", {}))).toBe(PLUGIN_MARKDOWN.studioOperating)
  })

  it("the Recast guide a plugin answers, where Recast is offered", async () => {
    setProfile({ nodes: { allow: ["generate-video-pro"] }, models: { allow: ["seedance-2"] } })
    expect(textOf(await (await session()).callTool("get_recast_authoring_skill", {}))).toBe(
      NOTE_HEAD + "> Tools not in your tool list: `generate_video`.\n> Models not offered here: `veo3.1`.\n" + NOTE_TAIL + PLUGIN_MARKDOWN.recast,
    )
  })
})

describe("who is asking", () => {
  it("an admin who is offered a node users are not reads no note for it; a user does", async () => {
    h.admins = new Set(["admin-1"])
    __resetAvailabilityOverridesForTests({ nodes: overrideLeavingOff("generate-music", "suno-generate") })
    const user = textOf(await (await session("u1")).callTool("start_film_director", {}))
    expect(user).toContain("> Tools not in your tool list: `generate_music`.\n")
    const admin = textOf(await (await session("admin-1")).callTool("start_film_director", {}))
    expect(admin).toBe(FILM_DIRECTOR)
  })
})
