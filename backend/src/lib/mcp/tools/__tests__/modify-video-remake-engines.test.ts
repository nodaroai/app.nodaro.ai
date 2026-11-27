import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import type { FastifyInstance } from "fastify"
import type { Scope } from "../../../scopes.js"
import { _resetPluginSupportsForTests, setPluginSupports } from "../../../private-plugins/supports-registry.js"
import { buildServer, callTool, listTools } from "./_helpers.js"

/**
 * `modify_video` offers Video Remake's two engines as models, where `video_remake` is offered.
 *
 * The contracts under test:
 *  - a call that names `nodaro-prism` or `nodaro-pulse` is QUOTED through `video_remake`'s own
 *    path (`/v1/video-remake/estimate`: the clip, the prompt as `postPrompt`, no role, the engine)
 *    and starts nothing, whatever it sends: the answer is `video_remake`'s quote, and names the
 *    `video_remake` call that runs it;
 *  - `resolution` and `draft` are Video Remake's own and are sent; this tool's other levers are not;
 *    the reference lists are refused rather than dropped;
 *  - the two are listed first, and only where `video_remake` is offered: off Nodaro Cloud, and on a
 *    deployment that withholds the `cast-swap` node, they are not listed and a call that names one
 *    is refused with a code, before anything is sent;
 *  - a call that names no model is still a Seedance 2.5 edit.
 *
 * The numbers are neutral on purpose: this repo is publicly mirrored.
 */
const h = vi.hoisted(() => ({ credits: true }))

vi.mock("../../../supabase.js", () => ({ supabase: { from: vi.fn() } }))
vi.mock("../../../config.js", async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>
  return { ...orig, hasCredits: () => h.credits }
})
vi.mock("../../user-preferences.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../user-preferences.js")>()),
  getUserMcpPreferences: vi.fn(async () => ({})),
}))

const { registerVideoVerbs } = await import("../verbs-video.js")
const { newSession } = await import("../../session.js")
const { resolveToolOffer } = await import("../../tool-offer.js")
const { __resetSurfaceProfileCacheForTests } = await import("../../../surface-profile.js")
const { __resetAvailabilityOverridesForTests, __availabilityUniverseReadyForTests } = await import("../../../availability-override.js")

interface InjectCall {
  method?: string
  url?: string
  payload?: Record<string, unknown>
}

/** A fastify stand-in answering one reply per exact URL, recording every call. */
function stubFastify(routes: Record<string, { statusCode: number; body: unknown }>) {
  const calls: InjectCall[] = []
  const fastify = {
    inject: async (opts: InjectCall) => {
      calls.push(opts)
      const res = routes[opts.url ?? ""]
      if (!res) return { statusCode: 404, body: JSON.stringify({ message: `Route POST:${opts.url} not found`, error: "Not Found" }) }
      return { statusCode: res.statusCode, body: JSON.stringify(res.body) }
    },
  } as unknown as FastifyInstance
  return { fastify, calls }
}

function setProfile(profile: object | null): void {
  if (profile === null) delete process.env.NODARO_SURFACE_PROFILE
  else process.env.NODARO_SURFACE_PROFILE = JSON.stringify(profile)
  __resetSurfaceProfileCacheForTests()
}

/** The video verbs for a session judged as `buildMcpServer` judges it (its offer, where the deployment restricts). */
async function serverWith(fastify: FastifyInstance) {
  const server = buildServer()
  const session = newSession({ userId: "u1", scopes: ["workflows:execute"] as Scope[], clientName: "test", offer: await resolveToolOffer("u1") })
  registerVideoVerbs({ server, session, fastify })
  return server
}

const QUOTE = { totalCredits: 12, expectedCredits: 9, breakdown: { base: 5, motion: 7, references: 0 }, settlesLower: false }
const ESTIMATE = "/v1/video-remake/estimate"
const CLIP = "https://cdn.example/clip.mp4"
const textOf = (res: { content: { text?: string }[] }) => res.content.map((c) => c.text ?? "").join("\n")

/** What the list says of the tool: its description, its `model` argument, and the whole definition as sent. */
async function modelText(fastify: FastifyInstance) {
  const def = (await listTools(await serverWith(fastify))).find((t) => t.name === "modify_video")!
  const model = (def.inputSchema as { properties: Record<string, { description?: string }> }).properties.model!.description ?? ""
  return { description: def.description ?? "", model, whole: JSON.stringify(def) }
}

beforeAll(async () => {
  await __availabilityUniverseReadyForTests()
})

// An engine that runs both (an older one runs Nodaro Prism only: below).
beforeEach(() => setPluginSupports({ castSwap: { engines: ["nodaro-prism", "nodaro-pulse"], engineAliases: true } as never }))

afterEach(() => {
  _resetPluginSupportsForTests()
  h.credits = true
  setProfile(null)
  __resetAvailabilityOverridesForTests()
})

describe("modify_video with a Video Remake engine", () => {
  it.each([
    ["nodaro-prism", "Nodaro Prism"],
    ["nodaro-pulse", "Nodaro Pulse"],
  ])("%s is quoted through video_remake's estimate, with the prompt as its instruction, and runs nothing", async (model, engineName) => {
    const { fastify, calls } = stubFastify({ [ESTIMATE]: { statusCode: 200, body: { ...QUOTE, engine: model } } })
    const res = await callTool(await serverWith(fastify), "modify_video", { prompt: "make her jacket red", video_url: CLIP, model })

    expect(res.isError).toBeFalsy()
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([`POST ${ESTIMATE}`])
    // The internal engine id, as `video_remake` sends it; no role, no art style.
    expect(calls[0]!.payload).toEqual({ videoUrl: CLIP, roles: [], postPrompt: "make her jacket red", engine: model === "nodaro-prism" ? "seedance-2-5" : "kling-4" })
    const run = { video_url: CLIP, roles: [], post_prompt: "make her jacket red", engine: model }
    // ONE key: the quote as `video_remake` gives it, and the call that runs it. No job.
    expect(res.structuredContent).toEqual({
      videoRemake: {
        quote: { engine: model, engineName, totalCredits: 12, expectedCredits: 9, breakdown: { base: 5, motion: 7, references: 0 }, settlesLower: false, confirmed: false },
        arguments: run,
        // The price sentence alone, for the tool's card.
        summary: `This ${engineName} run costs about 9 credits (up to 12 held while it runs).`,
      },
    })
    const text = textOf(res)
    expect(text).toContain(`This ${engineName} run costs about 9 credits (up to 12 held while it runs).`)
    expect(text).toContain("modify_video runs nothing for this model.")
    expect(text).toContain(`call video_remake with confirm: true and these arguments: ${JSON.stringify(run)}.`)
    expect(text).toContain("preview: true")
  })

  it("the quote is the one video_remake gives for the arguments it names", async () => {
    const { registerCastSwapTools } = await import("../cast-swap.js")
    const viaModify = stubFastify({ [ESTIMATE]: { statusCode: 200, body: QUOTE } })
    const modified = await callTool(await serverWith(viaModify.fastify), "modify_video", { prompt: "night", video_url: CLIP, model: "nodaro-prism", resolution: "720p" })
    const { quote, arguments: named } = (modified.structuredContent as { videoRemake: { quote: unknown; arguments: unknown } }).videoRemake

    const direct = stubFastify({ [ESTIMATE]: { statusCode: 200, body: QUOTE } })
    const server = buildServer()
    registerCastSwapTools({ server, session: newSession({ userId: "u1", scopes: ["workflows:execute"] as Scope[], clientName: "test" }), fastify: direct.fastify })
    const remade = await callTool(server, "video_remake", named)

    expect(direct.calls[0]!.payload).toEqual(viaModify.calls[0]!.payload)
    expect(remade.structuredContent).toEqual(quote)
  })

  it("starts nothing even when the caller sends confirm: the run is video_remake's", async () => {
    const { fastify, calls } = stubFastify({ [ESTIMATE]: { statusCode: 200, body: QUOTE }, "/v1/video-remake": { statusCode: 202, body: { jobId: "j-1" } } })
    const res = await callTool(await serverWith(fastify), "modify_video", { prompt: "night", video_url: CLIP, model: "nodaro-prism", confirm: true })
    expect(calls.map((c) => c.url)).toEqual([ESTIMATE])
    expect(res.structuredContent).toMatchObject({ videoRemake: { quote: { confirmed: false } } })
    expect(res.structuredContent).not.toHaveProperty("jobId")
  })

  it("sends resolution and draft, Video Remake's own, and none of this tool's other levers", async () => {
    const { fastify, calls } = stubFastify({ [ESTIMATE]: { statusCode: 200, body: QUOTE } })
    const res = await callTool(await serverWith(fastify), "modify_video", {
      prompt: "night", video_url: CLIP, model: "nodaro-prism",
      resolution: "480p", draft: true,
      duration: "10", aspect_ratio: "16:9", audio: true, multi_shots: true, seed: 7,
    })
    expect(res.isError).toBeFalsy()
    expect(calls[0]!.payload).toEqual({ videoUrl: CLIP, roles: [], postPrompt: "night", engine: "seedance-2-5", resolution: "480p", draft: true })
    expect((res.structuredContent as { videoRemake: { arguments: unknown } }).videoRemake.arguments).toEqual({
      video_url: CLIP, roles: [], post_prompt: "night", engine: "nodaro-prism", resolution: "480p", draft: true,
    })
  })

  it("sends 4K, the size delivered, to Video Remake, and refuses it for this tool's own models but Seedance 2.5 before anything is sent", async () => {
    const { fastify, calls } = stubFastify({ [ESTIMATE]: { statusCode: 200, body: QUOTE } })
    const server = await serverWith(fastify)
    const quoted = await callTool(server, "modify_video", { prompt: "night", video_url: CLIP, model: "nodaro-pulse", resolution: "4k" })
    expect(quoted.isError).toBeFalsy()
    expect(calls[0]!.payload).toEqual({ videoUrl: CLIP, roles: [], postPrompt: "night", engine: "kling-4", resolution: "4k" })
    calls.length = 0
    // Seedance 2.5 renders 4K itself (decided 2026-11-25); another model of this tool's own refuses it.
    const edit = await callTool(server, "modify_video", { prompt: "night", video_url: CLIP, model: "wan-videoedit", resolution: "4k" })
    expect(edit.isError).toBe(true)
    expect(calls).toEqual([])
  })

  it("names the engines' sizes as video_remake does: only the sizes offered here, the engine's own, or none", async () => {
    const { fastify } = stubFastify({})
    const resolutionWith = async (videoRemakeSizes: Parameters<typeof registerVideoVerbs>[0]["videoRemakeSizes"]) => {
      const server = buildServer()
      const session = newSession({ userId: "u1", scopes: ["workflows:execute"] as Scope[], clientName: "test", offer: await resolveToolOffer("u1") })
      registerVideoVerbs({ server, session, fastify, videoRemakeSizes })
      const def = (await listTools(server)).find((t) => t.name === "modify_video")!
      const resolution = (def.inputSchema as { properties: Record<string, { description?: string; enum?: string[] }> }).properties.resolution!
      // Only the engines' clause (this tool's own models' sizes come first, Seedance's 4K among them).
      return { ...resolution, description: (resolution.description ?? "").split("happyhorse-edit (720p/1080p); ")[1] ?? "" }
    }
    const all = await resolutionWith({ kind: "delivered", resolutions: { "nodaro-prism": ["720p", "1080p", "4k"], "nodaro-pulse": ["720p", "1080p", "4k"], "nodaro-prism-flash": ["720p", "1080p"], "nodaro-pulse-flash": ["720p", "1080p"] } })
    expect(all.description).toContain("delivered: nodaro-prism and nodaro-pulse 720p (default)/1080p/4k")
    expect(all.description).not.toContain("flash:")
    const noFourK = await resolutionWith({ kind: "delivered", resolutions: { "nodaro-prism": ["720p", "1080p"], "nodaro-pulse": ["720p", "1080p"], "nodaro-prism-flash": ["720p"], "nodaro-pulse-flash": ["720p"] } })
    expect(noFourK.description).not.toMatch(/4k/i)
    // The enum stays every size: a size not offered is the route's refusal.
    expect(noFourK.enum).toContain("4k")
    const engine = await resolutionWith({ kind: "engine" })
    expect(engine.description).toContain("the engine's size: nodaro-prism 480p (default)/720p/1080p, nodaro-pulse 720p (default)/1080p")
    expect(engine.description).not.toMatch(/4k/i)
    for (const here of [{ kind: "unread" as const }, undefined]) {
      const unread = await resolutionWith(here)
      expect(unread.description).toContain("nodaro-prism / nodaro-pulse: the size delivered, as offered here")
      expect(unread.description).not.toMatch(/4k/i)
    }
  })

  it.each([
    ["reference_image_url", "https://cdn.example/a.png"],
    ["reference_image_urls", ["https://cdn.example/a.png"]],
    ["reference_video_urls", ["https://cdn.example/b.mp4"]],
    ["reference_audio_urls", ["https://cdn.example/c.mp3"]],
  ])("refuses %s instead of quoting a run without it", async (key, value) => {
    const { fastify, calls } = stubFastify({ [ESTIMATE]: { statusCode: 200, body: QUOTE } })
    const res = await callTool(await serverWith(fastify), "modify_video", { prompt: "night", video_url: CLIP, model: "nodaro-pulse", [key]: value })
    expect(res.isError).toBe(true)
    expect(textOf(res)).toContain("Call video_remake instead")
    expect(calls).toEqual([])
  })

  it("the route's refusal of the quote comes back as video_remake's", async () => {
    const { fastify } = stubFastify({ [ESTIMATE]: { statusCode: 400, body: { error: { code: "invalid_duration", message: "The clip must be 4 to 30 seconds long." } } } })
    const res = await callTool(await serverWith(fastify), "modify_video", { prompt: "night", video_url: CLIP, model: "nodaro-prism" })
    expect(res.isError).toBe(true)
    expect(textOf(res)).toContain("The clip must be 4 to 30 seconds long.")
  })

  it("nodaro-pulse where the loaded engine does not run it is refused as video_remake refuses it, sending nothing", async () => {
    _resetPluginSupportsForTests()
    const { fastify, calls } = stubFastify({ [ESTIMATE]: { statusCode: 200, body: QUOTE } })
    const res = await callTool(await serverWith(fastify), "modify_video", { prompt: "night", video_url: CLIP, model: "nodaro-pulse" })
    expect(res.isError).toBe(true)
    expect(textOf(res)).toContain("engine_unavailable")
    expect(calls).toEqual([])
  })

  it("an older engine id is not this tool's: it goes to the route as any model, which refuses one it does not know", async () => {
    const { fastify, calls } = stubFastify({ "/v1/video-to-video": { statusCode: 400, body: { error: { code: "validation_error", message: "Invalid provider" } } } })
    const res = await callTool(await serverWith(fastify), "modify_video", { prompt: "night", video_url: CLIP, model: "motion-pro" })
    expect(res.isError).toBe(true)
    expect(calls.map((c) => c.url)).toEqual(["/v1/video-to-video"])
    expect(calls[0]!.payload).toMatchObject({ provider: "motion-pro" })
  })
})

describe("what a client reads of modify_video's answer", () => {
  it("a quote fits the output schema the list publishes (a closed object): no jobId required, and every key it carries is listed", async () => {
    const { fastify } = stubFastify({ [ESTIMATE]: { statusCode: 200, body: QUOTE } })
    const server = await serverWith(fastify)
    const def = (await listTools(server)).find((t) => t.name === "modify_video")!
    const out = (def as unknown as { outputSchema: { required?: string[]; properties: Record<string, unknown>; additionalProperties?: unknown } }).outputSchema
    expect(out.required ?? []).not.toContain("jobId")
    const res = await callTool(server, "modify_video", { prompt: "night", video_url: CLIP, model: "nodaro-prism" })
    for (const key of Object.keys(res.structuredContent as object)) expect(Object.keys(out.properties)).toContain(key)
  })
})

describe("modify_video lists the engines where video_remake is offered", () => {
  it("first among the models, in the description and the model argument", async () => {
    const { description, model } = await modelText(stubFastify({}).fastify)
    expect(model).toContain("Options: nodaro-prism, nodaro-pulse, ")
    expect(model).toContain("No model: a Video Remake quote on `nodaro-prism` (nothing runs)")
    expect(model).not.toContain("Default `seedance-2-5`")
    // Video Remake first, as the recommended way; then the models that run at once.
    const recommended = description.indexOf("**Recommended: Video Remake**")
    const direct = description.indexOf("**Direct edit, runs at once**")
    expect(recommended).toBeGreaterThan(-1)
    expect(description.indexOf("`nodaro-prism` / `nodaro-pulse`")).toBeGreaterThan(recommended)
    expect(direct).toBeGreaterThan(description.indexOf("`nodaro-prism` / `nodaro-pulse`"))
    expect(description.indexOf("`seedance-2-5`", direct)).toBeGreaterThan(direct)
    expect(description).not.toContain("(default)")
    expect(description).toContain("returns the PRICE QUOTE only and runs nothing")
  })

  it("not off Nodaro Cloud, where a call that names one is refused before anything is sent", async () => {
    h.credits = false
    const { fastify, calls } = stubFastify({ [ESTIMATE]: { statusCode: 200, body: QUOTE } })
    // Nothing of the definition names them: no description, argument or output key.
    expect((await modelText(fastify)).whole).not.toMatch(/nodaro-prism|nodaro-pulse|Nodaro Prism|Nodaro Pulse|videoRemake/)

    const res = await callTool(await serverWith(fastify), "modify_video", { prompt: "night", video_url: CLIP, model: "nodaro-prism" })
    expect(res.isError).toBe(true)
    expect(textOf(res)).toContain("(404 not_available)")
    expect(calls).toEqual([])
  })

  it("not on a deployment that withholds the cast-swap node, where a call that names one answers node_not_available", async () => {
    setProfile({ nodes: { deny: ["cast-swap"] } })
    const { fastify, calls } = stubFastify({ [ESTIMATE]: { statusCode: 200, body: QUOTE } })
    // Nothing of the definition names them: no description, argument or output key.
    expect((await modelText(fastify)).whole).not.toMatch(/nodaro-prism|nodaro-pulse|Nodaro Prism|Nodaro Pulse|videoRemake/)

    const res = await callTool(await serverWith(fastify), "modify_video", { prompt: "night", video_url: CLIP, model: "nodaro-pulse" })
    expect(res.isError).toBe(true)
    expect(textOf(res)).toContain("(403 node_not_available)")
    expect(calls).toEqual([])
  })

})

const INSTEAD = 'To run an instruction edit at once instead, call modify_video again with model: "seedance-2-5" (or another edit model).'

describe("modify_video with no model", () => {
  it("where video_remake is offered: Video Remake's quote on Nodaro Prism, no job, and the direct alternative named", async () => {
    const { fastify, calls } = stubFastify({ [ESTIMATE]: { statusCode: 200, body: QUOTE }, "/v1/text-to-video": { statusCode: 202, body: { jobId: "j-x" } } })
    const res = await callTool(await serverWith(fastify), "modify_video", { prompt: "make it night", video_url: CLIP })

    expect(res.isError).toBeFalsy()
    expect(calls.map((c) => c.url)).toEqual([ESTIMATE])
    expect(calls[0]!.payload).toEqual({ videoUrl: CLIP, roles: [], postPrompt: "make it night", engine: "seedance-2-5" })
    const run = { video_url: CLIP, roles: [], post_prompt: "make it night", engine: "nodaro-prism" }
    expect(res.structuredContent).toEqual({
      videoRemake: {
        quote: { engine: "nodaro-prism", engineName: "Nodaro Prism", totalCredits: 12, expectedCredits: 9, breakdown: { base: 5, motion: 7, references: 0 }, settlesLower: false, confirmed: false },
        arguments: run,
        summary: "This Nodaro Prism run costs about 9 credits (up to 12 held while it runs).",
      },
    })
    const text = textOf(res)
    expect(text).toContain("modify_video runs nothing when no model is named.")
    expect(text).toContain(`call video_remake with confirm: true and these arguments: ${JSON.stringify(run)}.`)
    expect(text).toContain("preview: true")
    expect(text.endsWith(INSTEAD)).toBe(true)
  })

  it("the same answer as naming nodaro-prism, but for the sentences that say why and what else", async () => {
    const quoted = async (model?: string) => {
      const { fastify } = stubFastify({ [ESTIMATE]: { statusCode: 200, body: QUOTE } })
      return callTool(await serverWith(fastify), "modify_video", { prompt: "night", video_url: CLIP, ...(model ? { model } : {}) })
    }
    const [byDefault, named] = [await quoted(), await quoted("nodaro-prism")]
    expect(byDefault.structuredContent).toEqual(named.structuredContent)
    expect(textOf(named)).not.toContain(INSTEAD)
  })

  it("a refusal of the estimate comes back with the direct alternative, so the agent is not stuck", async () => {
    const { fastify, calls } = stubFastify({ [ESTIMATE]: { statusCode: 400, body: { error: { code: "invalid_duration", message: "The clip must be 4 to 30 seconds long." } } } })
    const res = await callTool(await serverWith(fastify), "modify_video", { prompt: "night", video_url: CLIP })
    expect(res.isError).toBe(true)
    expect(calls.map((c) => c.url)).toEqual([ESTIMATE])
    expect(textOf(res)).toContain("The clip must be 4 to 30 seconds long.")
    expect(textOf(res).endsWith(INSTEAD)).toBe(true)
    // A named engine's refusal is the route's alone.
    const named = await callTool(await serverWith(fastify), "modify_video", { prompt: "night", video_url: CLIP, model: "nodaro-prism" })
    expect(textOf(named)).not.toContain(INSTEAD)
  })

  it("reference lists are refused with the alternative too (Seedance takes them)", async () => {
    const { fastify, calls } = stubFastify({ [ESTIMATE]: { statusCode: 200, body: QUOTE } })
    const res = await callTool(await serverWith(fastify), "modify_video", { prompt: "night", video_url: CLIP, reference_image_urls: ["https://cdn.example/a.png"] })
    expect(res.isError).toBe(true)
    expect(textOf(res).endsWith(INSTEAD)).toBe(true)
    expect(calls).toEqual([])
  })

  it.each([
    ["off Nodaro Cloud", () => void (h.credits = false)],
    ["where the deployment withholds the cast-swap node", () => setProfile({ nodes: { deny: ["cast-swap"] } })],
  ])("%s: a Seedance 2.5 edit that runs at once, as before", async (_where, arrange) => {
    arrange()
    const { fastify, calls } = stubFastify({ [ESTIMATE]: { statusCode: 200, body: QUOTE }, "/v1/text-to-video": { statusCode: 202, body: { jobId: "j-default" } } })
    const { model, description } = await modelText(fastify)
    expect(model).toContain("Default `seedance-2-5`.")
    expect(description).toContain("**`seedance-2-5`** (default)")
    const res = await callTool(await serverWith(fastify), "modify_video", {
      prompt: "make it night",
      video_url: CLIP,
      // What a caller of an earlier default sent; the edit takes neither.
      duration: "10",
      multi_shots: true,
    })
    expect(res.isError).toBeFalsy()
    expect(calls.map((c) => c.url)).toEqual(["/v1/text-to-video"])
    expect(calls[0]!.payload).toMatchObject({
      provider: "seedance-2-5",
      prompt: "edit {video:1} as follows:\nmake it night",
      aspectRatio: "adaptive",
      duration: -1,
      resolution: "480p",
      referenceVideoUrls: [CLIP],
    })
    expect(calls[0]!.payload).not.toHaveProperty("multiShots")
    expect(res.structuredContent).toMatchObject({ jobId: "j-default" })
  })

  it("an explicit edit model runs at once where video_remake is offered", async () => {
    const { fastify, calls } = stubFastify({ "/v1/text-to-video": { statusCode: 202, body: { jobId: "j-edit" } }, "/v1/video-to-video": { statusCode: 202, body: { jobId: "j-wan" } } })
    const server = await serverWith(fastify)
    const edit = await callTool(server, "modify_video", { prompt: "night", video_url: CLIP, model: "seedance-2-5" })
    const wan = await callTool(server, "modify_video", { prompt: "night", video_url: CLIP, model: "wan" })
    expect(calls.map((c) => c.url)).toEqual(["/v1/text-to-video", "/v1/video-to-video"])
    expect(edit.structuredContent).toMatchObject({ jobId: "j-edit" })
    expect(wan.structuredContent).toMatchObject({ jobId: "j-wan" })
  })
})

describe("the three lanes read alike", () => {
  const RECAST = "To recreate, reshoot or remix a whole video from zero (longer videos, a new cast and music, the motion itself changed), use `start_recast`, not this tool."

  async function descriptions(scopes: Scope[] = ["workflows:read", "workflows:write", "workflows:execute"] as Scope[]) {
    const { registerCastSwapTools } = await import("../cast-swap.js")
    const { registerRecastTools } = await import("../recast.js")
    const server = buildServer()
    const session = newSession({ userId: "u1", scopes, clientName: "test", offer: await resolveToolOffer("u1") })
    const fastify = stubFastify({}).fastify
    registerVideoVerbs({ server, session, fastify })
    if (h.credits) {
      registerCastSwapTools({ server, session, fastify })
      registerRecastTools({ server, session, fastify })
    }
    const tools = await listTools(server)
    return (name: string) => tools.find((t) => t.name === name)?.description ?? ""
  }

  it("modify_video and video_remake send a recreate / reshoot / remix to start_recast, in the same sentence", async () => {
    const d = await descriptions()
    expect(d("modify_video")).toContain(RECAST)
    expect(d("video_remake")).toContain(RECAST)
  })

  it("video_remake leads with edit, modify, restyle, remake, and carries motion transfer and motion control", async () => {
    const text = (await descriptions())("video_remake")
    expect(text.startsWith("Video Remake: the way to edit, modify, restyle or remake a video (a 4–30 s clip).")).toBe(true)
    expect(text).toContain("A prompt alone is enough")
    expect(text).toContain("motion transfer / motion control")
  })

  it("start_recast leads with recreate, reshoot, remix, from scratch, sends a clip edit to video_remake, and never says remake of itself", async () => {
    const text = (await descriptions())("start_recast")
    expect(text.startsWith("Recast: recreate, reshoot or remix a whole video from scratch: any length, your own cast, new music")).toBe(true)
    expect(text).toContain("To edit, modify, restyle or remake a clip (its motion kept), use `video_remake`, not this tool.")
    expect(text.replace("restyle or remake a clip (its motion kept), use `video_remake`", "")).not.toMatch(/remake/i)
  })

  it("motion_transfer recommends Video Remake and stays the direct call", async () => {
    expect((await descriptions())("motion_transfer")).toContain(
      "Recommended for transferring a clip's motion to your own cast: `video_remake` (Video Remake: a price quote first, then the run); this tool is the direct single-model call.",
    )
  })

  it.each([
    ["off Nodaro Cloud", () => void (h.credits = false)],
    ["where the deployment withholds the cast-swap node", () => setProfile({ nodes: { deny: ["cast-swap"] } })],
  ])("%s, modify_video and motion_transfer say nothing of Video Remake's lane", async (_where, arrange) => {
    arrange()
    const d = await descriptions()
    expect(d("modify_video")).not.toMatch(/Recommended|nodaro-prism|PRICE QUOTE/)
    expect(d("motion_transfer")).not.toMatch(/video_remake|Video Remake/)
    expect(d("start_recast")).not.toMatch(/video_remake/)
  })

  it("where Recast is withheld, no tool points at start_recast", async () => {
    setProfile({ nodes: { deny: ["generate-video-pro"] } })
    const d = await descriptions()
    expect(d("modify_video")).not.toContain("start_recast")
    expect(d("video_remake")).not.toContain("start_recast")
  })
})
