/**
 * What the listed tools say follows what the session is offered (decided
 * 2026-11-16): on a deployment that restricts what it offers, a listed tool
 * whose description or arguments name a tool the session is not listed or a
 * model the deployment withholds ends its description with a generated note
 * naming exactly those (lib/mcp/offer-note.ts, at the `tools/list` exit in
 * lib/mcp/tool-offer.ts). Its schema stays as it registered: a model enum
 * cannot be narrowed through one funnel without emptying the enum of a tool
 * that stays listed (below), and a call naming a withheld model is refused by
 * the run's own model door. With nothing restricted the list is the recorded
 * one (tool-list-wire.test.ts).
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

vi.hoisted(() => {
  for (const key of ["NODARO_SURFACE_PROFILE", "NODARO_PRICE_ANNOTATIONS", "SITE_CAPTURE_ENABLED"]) process.env[key] = ""
})

vi.mock("../../supabase.js", () => {
  const chain: Record<string, unknown> = {}
  const self = () => chain
  for (const k of ["select", "eq", "in", "is", "order", "limit", "update", "upsert", "delete", "gte", "lte", "neq", "or", "filter", "range"]) chain[k] = self
  chain.single = async () => ({ data: { id: "job-1" }, error: null })
  chain.maybeSingle = async () => ({ data: null, error: null })
  chain.then = (ok: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(ok)
  chain.insert = () => ({ select: () => ({ single: async () => ({ data: { id: "job-1" }, error: null }) }) })
  return { supabase: { from: () => chain, rpc: async () => ({ data: null, error: null }), auth: { getUser: async () => ({ data: { user: { id: "u1" } }, error: null }) } } }
})
vi.mock("../../queue.js", () => ({ videoQueue: { add: vi.fn().mockResolvedValue({ id: "q-1" }) }, redis: {} }))
vi.mock("../../admin-check.js", () => ({ warmAdminCache: vi.fn(), checkIsAdmin: vi.fn().mockResolvedValue(false) }))

const { buildMcpServer } = await import("../server.js")
const { createMcpInvoker } = await import("../invoke.js")
const { GATEABLE_MODEL_IDS, __availabilityUniverseReadyForTests } = await import("../../availability-override.js")
const { __resetSurfaceProfileCacheForTests } = await import("../../surface-profile.js")
const { LLM_MODELS } = await import("@nodaro/shared/llm-models")
const { textToSpeechRoutes } = await import("../../../routes/text-to-speech.js")
const { videoQueue } = await import("../../queue.js")

type Listed = { name: string; description?: string; inputSchema?: unknown }

function setProfile(profile: object | null): void {
  if (profile === null) delete process.env.NODARO_SURFACE_PROFILE
  else process.env.NODARO_SURFACE_PROFILE = JSON.stringify(profile)
  __resetSurfaceProfileCacheForTests()
}

async function session(fastify: FastifyInstance = Fastify()) {
  const server = await buildMcpServer({ userId: "u1", scopes: ["workflows:read", "workflows:write", "workflows:execute", "jobs:read", "assets:read", "assets:write", "credits:read", "apps:read"], clientName: "Claude", fastify })
  return createMcpInvoker(server)
}

async function listed(): Promise<Map<string, Listed>> {
  return new Map(((await (await session()).listTools()) as Listed[]).map((t) => [t.name, t]))
}

/** The note a description ends with, or undefined. */
const noteOf = (t: Listed | undefined) => /\n\nNot offered on this deployment: .*$/s.exec(t?.description ?? "")?.[0].slice(2)

let unrestricted: Map<string, Listed>

beforeAll(async () => {
  await __availabilityUniverseReadyForTests()
  setProfile(null)
  unrestricted = await listed()
}, 120_000)

afterEach(() => setProfile(null))

/** A deployment that offers image and video generation only, on two models. */
const IMAGE_AND_VIDEO_TWO_MODELS = { nodes: { allow: ["generate-image", "generate-video"] }, models: { allow: ["gpt-image-2", "seedance-2"] } }

describe("the listed tools' descriptions on a restricted deployment", () => {
  it("name, at their end, the sibling tools they mention that are not listed", async () => {
    setProfile(IMAGE_AND_VIDEO_TWO_MODELS)
    const tools = await listed()
    const film = tools.get("start_film_director")!
    expect(film.description!.startsWith(unrestricted.get("start_film_director")!.description!)).toBe(true)
    expect(noteOf(film)).toBe(
      "Not offered on this deployment: the tools `image_to_image` (not in your tool list). Use only the tools in your tool list and the models `list_models` returns.",
    )
    expect(noteOf(tools.get("start_video_director"))).toBe(
      "Not offered on this deployment: the tools `forced_alignment`, `generate_speech`, `render_shot_sequence`, `resolve_shot_sequence` (not in your tool list). Use only the tools in your tool list and the models `list_models` returns.",
    )
  })

  it("name the models they offer that the deployment withholds: a model list in an argument's description", async () => {
    setProfile(IMAGE_AND_VIDEO_TWO_MODELS)
    const video = (await listed()).get("generate_video")!
    const note = noteOf(video)!
    // Its description also names Video Upscale's tool, which this deployment does not list.
    expect(note).toMatch(/^Not offered on this deployment: the tools `video_upscale` \(not in your tool list\) and the models /)
    for (const id of ["veo3.1", "kling-3.0", "seedance-2-fast"]) expect(note, id).toContain(`\`${id}\``)
    for (const id of ["seedance-2", "gpt-image-2"]) expect(note, id).not.toMatch(new RegExp(`\`${id}\`(?![\\w.-])`))
  })

  it("name the withheld models of a model enum", async () => {
    setProfile({ models: { deny: ["elevenlabs-v3", "elevenlabs-turbo"] } })
    const speech = (await listed()).get("generate_speech")!
    expect(noteOf(speech)).toBe(
      "Not offered on this deployment: the models `elevenlabs-turbo`, `elevenlabs-v3`. Use only the tools in your tool list and the models `list_models` returns.",
    )
  })

  it("leave a tool that names nothing withheld exactly as registered, and every schema as registered", async () => {
    setProfile(IMAGE_AND_VIDEO_TWO_MODELS)
    const tools = await listed()
    expect(tools.get("ping")).toEqual(unrestricted.get("ping"))
    expect(tools.get("list_jobs")).toEqual(unrestricted.get("list_jobs"))
    for (const [name, tool] of tools) expect(tool.inputSchema, name).toEqual(unrestricted.get(name)!.inputSchema)
  })

  it("why the schema is not narrowed: a deployment that offers no language model still lists the tools whose node it offers", async () => {
    setProfile({ models: { allow: ["gpt-image-2"] } })
    const tools = await listed()
    const llmIds = new Set(LLM_MODELS.map((m) => m.id))
    for (const name of ["generate_text", "image_to_text", "analyze_prompt", "generate_prompt", "enhance_prompt"]) {
      const tool = tools.get(name)
      expect(tool, name).toBeDefined()
      const enumValues = JSON.stringify(tool!.inputSchema).match(/"enum":\[[^\]]*\]/g) ?? []
      const models = enumValues.flatMap((e) => (JSON.parse(`{${e}}`) as { enum: string[] }).enum).filter((v) => llmIds.has(v))
      expect(models.length, name).toBeGreaterThan(0)
      // Every model the enum offers is withheld: a narrowed enum would be empty on a listed tool.
      expect(models.every((id) => GATEABLE_MODEL_IDS.has(id)), name).toBe(true)
      expect(noteOf(tool), name).toContain("the models ")
    }
  })
})

describe("a call naming a model the description says is not offered", () => {
  it("is refused by the run's model door, as before (the schema still takes it)", async () => {
    setProfile({ models: { deny: ["elevenlabs-v3"] } })
    const app = Fastify({ logger: false })
    app.addHook("preHandler", async (req) => {
      const body = req.body as Record<string, unknown> | undefined
      if (typeof body?.userId === "string") req.userId = body.userId
    })
    await app.register(async (instance) => {
      await textToSpeechRoutes(instance)
    })
    await app.ready()
    const mcp = await session(app)
    const speech = ((await mcp.listTools()) as Listed[]).find((t) => t.name === "generate_speech")!
    expect(JSON.stringify(speech.inputSchema)).toContain('"elevenlabs-v3"')
    expect(noteOf(speech)).toContain("`elevenlabs-v3`")
    const res = await mcp.callTool("generate_speech", { text: "Hello there.", voice: "Rachel", model: "elevenlabs-v3" })
    expect(res.isError).toBe(true)
    expect(res.content.map((c) => c.text ?? "").join("\n")).toMatch(/403 model_not_available/)
    expect(videoQueue.add).not.toHaveBeenCalled()
    await app.close()
  })
})

describe("a description that names a sibling tool asks the session's offer", () => {
  it("siteCaptureOffered asks the offer, as the session's viewer, where there is one; as before where there is none", async () => {
    const { siteCaptureOffered } = await import("../tools/verbs-site-capture.js")
    const offer = (refused: boolean) => ({
      viewer: { admin: false },
      refusalOf: (t: string) => (refused && t === "capture_site" ? { code: "link_imports_disabled" as const, message: "x" } : undefined),
      nodeOffered: () => true,
      modelOffered: () => true,
    })
    expect(siteCaptureOffered({})).toBe(true)
    expect(siteCaptureOffered({ offer: offer(true) })).toBe(false)
    expect(siteCaptureOffered({ offer: offer(false) })).toBe(true)
  })

  it("create_launch_video names capture_site only where the session is offered it", async () => {
    const launch = async () => ((await (await session()).listTools()) as Listed[]).find((t) => t.name === "create_launch_video")!.description!
    expect(await launch()).toContain("`capture_site` captures a live page as screenshots.")
    setProfile({ imports: { links: false } })
    expect(await launch()).not.toContain("capture_site")
  })
})
