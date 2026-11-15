/**
 * The MCP tool list follows what the deployment offers (lib/mcp/tool-offer.ts,
 * decided 2026-11-11): on a deployment that restricts what it offers, a
 * session is offered exactly the tools whose every need is offered to its
 * viewer, a call to any other answers the run's coded refusal before anything
 * happens, and the answer follows the deployment as it changes.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"
import { ALL_SCOPES } from "../../scopes.js"

const h = vi.hoisted(() => ({ admins: new Set<string>(), from: null as unknown as ReturnType<typeof vi.fn<(...args: unknown[]) => unknown>> }))
vi.mock("../../supabase.js", () => {
  h.from = vi.fn<(...args: unknown[]) => unknown>()
  return { supabase: { from: (...args: unknown[]) => h.from(...args) } }
})
vi.mock("../../admin-check.js", () => ({ checkIsAdmin: async (userId: string) => h.admins.has(userId) }))

const { buildMcpServer } = await import("../server.js")
const { createMcpInvoker } = await import("../invoke.js")
const { TOOL_NEEDS } = await import("../tool-needs.js")
const { resolveToolOffer } = await import("../tool-offer.js")
const { __resetSurfaceProfileCacheForTests } = await import("../../surface-profile.js")
const { __resetAvailabilityOverridesForTests, __availabilityUniverseReadyForTests, storedNodesEnabled, GATEABLE_NODE_TYPES } = await import(
  "../../availability-override.js"
)

/** The small offer the decision was made for: four nodes, no feature, no link imports. */
const SMALL_OFFER = { nodes: { allow: ["generate-image", "generate-video", "text-to-speech", "upload-image"] }, imports: { links: false } }

/**
 * The tools those four nodes run. (Site Capture is not gated by omission —
 * NOT_OVERRIDE_GATED_NODE_TYPES — so a whitelist that leaves it out still runs
 * it; but every capture is of a page on another site, so capture_site needs
 * link imports, which this offer turns off.) Nothing else in the table needs only these.
 */
const RUN_BY_THE_SMALL_OFFER = ["animate_image", "generate_image", "generate_speech", "generate_video"]

/** Studio is a world with no node of its own: offered while the profile names no worlds. */
const STUDIO_TOOLS = Object.entries(TOOL_NEEDS)
  .filter(([, need]) => need.world === "studio")
  .map(([name]) => name)

const NEED_NOTHING = new Set(
  Object.entries(TOOL_NEEDS)
    .filter(([, need]) => need.none !== undefined)
    .map(([name]) => name),
)

function setProfile(profile: object | null): void {
  if (profile === null) delete process.env.NODARO_SURFACE_PROFILE
  else process.env.NODARO_SURFACE_PROFILE = JSON.stringify(profile)
  __resetSurfaceProfileCacheForTests()
}

/** Every gateable node but `left` — an override saved in Admin → Availability leaving them off. */
function overrideLeavingOff(...left: string[]): Set<string> {
  return new Set(storedNodesEnabled([...GATEABLE_NODE_TYPES].filter((t) => !left.includes(t))))
}

/** A Fastify that counts every request a tool makes to it. */
function countingApp(): { app: FastifyInstance; hits: () => number } {
  const app = Fastify()
  let hits = 0
  app.addHook("onRequest", async () => {
    hits++
  })
  return { app, hits: () => hits }
}

async function session(userId = "u1", app: FastifyInstance = Fastify()) {
  const server = await buildMcpServer({ userId, scopes: [...ALL_SCOPES], clientName: "Claude", fastify: app })
  return createMcpInvoker(server)
}

async function names(userId = "u1"): Promise<string[]> {
  return (await (await session(userId)).listTools()).map((t) => t.name).sort()
}

const textOf = (res: { content: { text?: string }[] }) => res.content.map((c) => c.text ?? "").join("\n")

let unrestricted: string[] = []

beforeAll(async () => {
  await __availabilityUniverseReadyForTests()
  setProfile(null)
  __resetAvailabilityOverridesForTests()
  unrestricted = await names()
}, 120_000)

beforeEach(() => {
  h.admins = new Set()
  h.from.mockReset()
})

afterEach(() => {
  setProfile(null)
  __resetAvailabilityOverridesForTests()
})

describe("a deployment that restricts nothing", () => {
  it("judges no tool", async () => {
    expect(await resolveToolOffer("u1")).toBeUndefined()
    expect(unrestricted.length).toBeGreaterThan(250)
    expect(await names()).toEqual(unrestricted)
  })

  it("an override that leaves nothing off restricts nothing", async () => {
    __resetAvailabilityOverridesForTests({ nodes: overrideLeavingOff() })
    expect(await resolveToolOffer("u1")).toBeUndefined()
    expect(await names()).toEqual(unrestricted)
  })
})

describe("the small offer: generate-image, generate-video, text-to-speech, upload-image; no feature; link imports off", () => {
  it("lists exactly the tools those nodes run, the Studio world's (no worlds named) and the tools that need nothing", async () => {
    setProfile(SMALL_OFFER)
    const expected = unrestricted.filter((t) => NEED_NOTHING.has(t) || RUN_BY_THE_SMALL_OFFER.includes(t) || STUDIO_TOOLS.includes(t))
    expect(await names()).toEqual(expected)
  })

  it("with the worlds narrowed too, exactly the tools those nodes run and the tools that need nothing", async () => {
    setProfile({ ...SMALL_OFFER, worlds: { allow: ["image", "video"] } })
    expect(await names()).toEqual(unrestricted.filter((t) => NEED_NOTHING.has(t) || RUN_BY_THE_SMALL_OFFER.includes(t)))
  })

  it.each([
    ["a node", ["generate_music", "suno_generate", "extract_frame", "transcribe"]],
    ["every lane of a tool", ["modify_video", "edit_image"]],
    ["a feature (Nodaro Motion, the film pipeline, the Video Director)", ["cast_swap", "run_trend", "list_trends", "full_quality", "start_pipeline", "create_explainer"]],
    ["a node a plan or quote prepares", ["resolve_shot_sequence", "import_recast_script", "estimate_use_case"]],
    ["link imports", ["download_youtube_audio", "capture_site"]],
  ])("withholds what needs %s", async (_class, tools) => {
    setProfile(SMALL_OFFER)
    const listed = await names()
    for (const t of tools) {
      expect(unrestricted, `${t} is a tool of this build`).toContain(t)
      expect(listed, t).not.toContain(t)
    }
  })

  it("keeps the read tools of a withheld feature: work already made can still be followed", async () => {
    setProfile(SMALL_OFFER)
    const listed = await names()
    for (const t of ["get_pipeline_status", "get_recast_status", "stop_video_pro", "get_dubbing", "list_studio_productions"]) expect(listed, t).toContain(t)
  })
})

describe("a call to a withheld tool", () => {
  it("answers the run's coded refusal, before any request, read or reservation", async () => {
    setProfile(SMALL_OFFER)
    const { app, hits } = countingApp()
    const mcp = await session("u1", app)
    h.from.mockReset()
    const res = await mcp.callTool("generate_music", { prompt: "a calm piano piece" })
    expect(res.isError).toBe(true)
    expect(textOf(res)).toMatch(/\(403 node_not_available\): .*not available on this deployment: generate-music/)
    expect(hits()).toBe(0)
    expect(h.from).not.toHaveBeenCalled()
  })

  it("is refused whatever its arguments: it is never validated", async () => {
    setProfile(SMALL_OFFER)
    const res = await (await session()).callTool("suno_generate", { not: "an argument it takes" })
    expect(textOf(res)).toMatch(/403 node_not_available/)
  })

  it("names the refusal of its class", async () => {
    setProfile({ ...SMALL_OFFER, worlds: { allow: ["image"] } })
    const mcp = await session()
    expect(textOf(await mcp.callTool("download_youtube_audio", { youtube_url: "https://www.youtube.com/watch?v=x" }))).toMatch(/403 link_imports_disabled/)
    expect(textOf(await mcp.callTool("create_studio_production", {}))).toMatch(/403 world_not_available/)
    expect(textOf(await mcp.callTool("cast_swap", {}))).toMatch(/403 node_not_available\): .*cast-swap/)
  })

  it("of a model family the deployment withholds every model of answers model_not_available", async () => {
    setProfile({ nodes: { allow: ["suno-generate", "suno-lyrics"] }, models: { allow: ["gpt-image-2"] } })
    const mcp = await session()
    const listed = (await mcp.listTools()).map((t) => t.name)
    expect(listed).not.toContain("suno_generate")
    // A Suno route that runs no model is judged by its node alone.
    expect(listed).toContain("suno_lyrics")
    expect(textOf(await mcp.callTool("suno_generate", { prompt: "x" }))).toMatch(/403 model_not_available/)
  })

  it("leaves a name that is no tool to the SDK, as before", async () => {
    setProfile(SMALL_OFFER)
    const res = await (await session()).callTool("no_such_tool", {})
    expect(textOf(res)).toMatch(/Tool no_such_tool not found/)
  })
})

describe("the list follows the deployment as it changes", () => {
  it("an override saved mid-session withholds the tool from the next list and refuses its next call", async () => {
    const { app, hits } = countingApp()
    // A session opened before the save (the in-app assistant keeps one server per turn).
    const opened = await session("u1", app)
    expect((await opened.listTools()).map((t) => t.name)).toContain("suno_generate")

    __resetAvailabilityOverridesForTests({ nodes: overrideLeavingOff("suno-generate") })
    expect(await names()).not.toContain("suno_generate")
    const res = await opened.callTool("suno_generate", { prompt: "x" })
    expect(textOf(res)).toMatch(/403 node_not_available\): .*suno-generate/)
    expect(hits()).toBe(0)

    // Released again: back on the next list.
    __resetAvailabilityOverridesForTests({ nodes: overrideLeavingOff() })
    expect(await names()).toContain("suno_generate")
  })
})

describe("who is asking", () => {
  it("an admin keeps a tool the admin switch hides from users, as the run lets an admin run it", async () => {
    h.admins = new Set(["admin-1"])
    __resetAvailabilityOverridesForTests({ nodes: overrideLeavingOff("suno-generate", "cast-swap") })
    expect(await names("u1")).not.toContain("suno_generate")
    const forAdmin = await names("admin-1")
    expect(forAdmin).toContain("suno_generate")
    expect(forAdmin).toContain("cast_swap")
  })

  it("an admin is not handed back a node the profile itself removes", async () => {
    h.admins = new Set(["admin-1"])
    setProfile({ nodes: { deny: ["suno-generate"] } })
    expect(await names("admin-1")).not.toContain("suno_generate")
  })
})

describe("the node skills follow the offer", () => {
  it("get_node_skill answers a withheld node's skill with the run's refusal, an offered one's with its skill", async () => {
    setProfile(SMALL_OFFER)
    const mcp = await session()
    expect(textOf(await mcp.callTool("get_node_skill", { node_type: "generate-music" }))).toMatch(/403 node_not_available\): .*generate-music/)
    expect(textOf(await mcp.callTool("get_node_skill", { node_type: "generate-image" }))).toMatch(/generate-image/)
  })

  it("start_workflow_editor's catalog leaves out the nodes the viewer is not offered, and is the file itself where nothing is restricted", async () => {
    const { WORKFLOW_EDITOR_CONTENT } = await import("../tools/skill-loaders.js")
    expect(textOf(await (await session()).callTool("start_workflow_editor", {}))).toBe(WORKFLOW_EDITOR_CONTENT)
    setProfile(SMALL_OFFER)
    const catalog = textOf(await (await session()).callTool("start_workflow_editor", {}))
    expect(catalog).toContain("- `generate-image` — ")
    expect(catalog).not.toContain("- `generate-music` — ")
    expect(catalog).not.toContain("- `suno-generate` — ")
    // A node no whitelist gates by omission stays (a sticky note is a utility).
    expect(catalog).toContain("- `sticky-note` — ")
  })
})
