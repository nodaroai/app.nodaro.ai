import { describe, it, expect, vi, beforeEach } from "vitest"
import Fastify from "fastify"
import { _resetRegistry } from "../../tasks.js"
import { buildServer, callTool, executeSession } from "./_helpers.js"

/**
 * The person's saved video defaults (`profiles.mcp_preferences.video`, written
 * through PATCH /v1/user/settings `mcpPreferences.video`) as `generate_video`
 * and `animate_image` read them. Each lever: the value the call names, else
 * the saved one, else the catalog's (the ratio: 16:9, or the model's first).
 *
 * The saved ratio used to be dead: the ratio helper fills an unset value with
 * 16:9, so its `?? saved` alternative was never reached.
 */

let savedVideo: Record<string, string | number | undefined> = {}

vi.mock("../../user-preferences.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../user-preferences.js")>()),
  getUserMcpPreferences: vi.fn(async () => ({ video: savedVideo })),
}))

vi.mock("../../asset-resolver.js", () => ({ resolveAssetId: vi.fn(async () => null) }))

vi.mock("../../supabase.js", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: null, error: null }),
          single: async () => ({ data: { mcp_preferences: {} }, error: null }),
        }),
      }),
    }),
  },
}))

const { registerVerbs } = await import("../verbs.js")
const { textToVideoBody } = await import("../../../../routes/text-to-video.js")
const { generateVideoBody } = await import("../../../../routes/generate-video.js")

const START = "https://cdn.nodaro.ai/uploads/start.png"

/** Both video lanes stubbed; answers the body the verb sent. */
async function call(tool: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const fastify = Fastify()
  let body: Record<string, unknown> | undefined
  for (const url of ["/v1/text-to-video", "/v1/generate-video"]) {
    fastify.post(url, async (req) => {
      body = req.body as Record<string, unknown>
      return { jobId: "j-video" }
    })
  }
  const server = buildServer()
  registerVerbs({ server, session: executeSession(), fastify })
  const result = await callTool(server, tool, args)
  expect(result.isError).toBeUndefined()
  return body ?? {}
}

const VERBS = [
  ["generate_video", (args: Record<string, unknown>) => call("generate_video", { prompt: "a lighthouse at dusk", ...args })],
  ["animate_image", (args: Record<string, unknown>) => call("animate_image", { image_url: START, prompt: "the waves roll in", ...args })],
] as const

beforeEach(() => {
  _resetRegistry()
  savedVideo = {}
})

describe.each(VERBS)("%s — the ratio: named, else saved, else the fallback", (_verb, run) => {
  it("uses the saved ratio when the call names none", async () => {
    savedVideo = { aspectRatio: "9:16" }
    expect((await run({})).aspectRatio).toBe("9:16")
  })

  it("a named ratio beats the saved one", async () => {
    savedVideo = { aspectRatio: "9:16" }
    expect((await run({ aspect_ratio: "1:1" })).aspectRatio).toBe("1:1")
  })

  it("a blank named ratio names nothing: the saved one applies", async () => {
    savedVideo = { aspectRatio: "4:3" }
    expect((await run({ aspect_ratio: "" })).aspectRatio).toBe("4:3")
  })

  it("with neither, keeps the fallback (16:9)", async () => {
    expect((await run({})).aspectRatio).toBe("16:9")
  })

  it("a saved ratio the model lacks moves to its nearest listed one", async () => {
    // seedance-2-fast (the default) lists 3:4 and 9:16, not 2:3.
    savedVideo = { aspectRatio: "2:3" }
    expect((await run({})).aspectRatio).toBe("3:4")
    // VEO 3.1 lists only 16:9 and 9:16.
    expect((await run({ model: "veo3.1" })).aspectRatio).toBe("9:16")
  })

  it("the saved ratio is fitted to the saved model", async () => {
    savedVideo = { model: "veo3.1", aspectRatio: "1:1" }
    const body = await run({})
    expect(body.provider).toBe("veo3.1")
    expect(["16:9", "9:16"]).toContain(body.aspectRatio)
  })
})

describe.each(VERBS)("%s — the saved model, duration and size", (_verb, run) => {
  it("uses each saved value when the call names none", async () => {
    savedVideo = { model: "veo3.1", duration: 6, resolution: "1080p" }
    const body = await run({})
    expect(body.provider).toBe("veo3.1")
    expect(body.duration).toBe(6)
    expect(body.resolution).toBe("1080p")
  })

  it("named values beat the saved ones", async () => {
    savedVideo = { model: "veo3.1", duration: 6, resolution: "1080p" }
    const body = await run({ model: "seedance-2-fast", duration: 10, resolution: "720p" })
    expect(body.provider).toBe("seedance-2-fast")
    expect(body.duration).toBe(10)
    expect(body.resolution).toBe("720p")
  })

  it("a saved duration the model lacks snaps to its nearest", async () => {
    savedVideo = { model: "veo3.1", duration: 7 }
    expect([6, 8]).toContain((await run({})).duration)
  })

  it("with neither, the model's own defaults apply", async () => {
    const body = await run({})
    expect(body.provider).toBe("seedance-2-fast")
    expect(body.duration).toBeUndefined()
    // The cheapest listed size (catalog order is low to high).
    expect(body.resolution).toBe("480p")
  })
})

/**
 * The saved video model is any string PATCH /v1/user/settings took. A call
 * runs it only when the route it sends it to takes it (`savedVideoModel`):
 * `generate_video`'s prompt-only run goes to /v1/text-to-video, `animate_image`
 * to /v1/generate-video. Any other id (an image model saved there, an
 * image-to-video id the text-to-video route lacks) is ignored and the default
 * runs. Each body is checked against the route's own schema.
 */
describe("the saved video model: used only when the route takes it", () => {
  const routeTakes = (url: string, body: Record<string, unknown>) => {
    const { userId: _userId, mcp_client: _client, ...sent } = body
    return (url === "/v1/text-to-video" ? textToVideoBody : generateVideoBody).safeParse(sent).success
  }

  it.each(["gpt-image-2", "gpt-image-2-6-flare-i2i", "not-a-model"])("a saved %s runs the default on both verbs", async (saved) => {
    savedVideo = { model: saved }
    const t2v = await run("generate_video", {})
    expect(t2v.body.provider).toBe("seedance-2-fast")
    expect(routeTakes(t2v.url, t2v.body)).toBe(true)
    const i2v = await run("animate_image", {})
    expect(i2v.body.provider).toBe("seedance-2-fast")
    expect(routeTakes(i2v.url, i2v.body)).toBe(true)
  })

  it("an image-to-video id /v1/text-to-video does not take runs generate_video's default, and animate_image as saved", async () => {
    savedVideo = { model: "grok-i2v" }
    const t2v = await run("generate_video", {})
    expect(t2v.url).toBe("/v1/text-to-video")
    expect(t2v.body.provider).toBe("seedance-2-fast")
    expect(routeTakes(t2v.url, t2v.body)).toBe(true)
    const i2v = await run("animate_image", {})
    expect(i2v.body.provider).toBe("grok-i2v")
    expect(routeTakes(i2v.url, i2v.body)).toBe(true)
  })

  it("a retired id runs as the model that replaced it", async () => {
    savedVideo = { model: "seedance" }
    expect((await run("generate_video", {})).body.provider).toBe("seedance-2-mini")
  })

  it("a saved video model the route takes is used, and a named one still wins", async () => {
    savedVideo = { model: "kling-4" }
    const t2v = await run("generate_video", {})
    expect(t2v.body.provider).toBe("kling-4")
    expect(routeTakes(t2v.url, t2v.body)).toBe(true)
    expect((await run("generate_video", { model: "veo3.1" })).body.provider).toBe("veo3.1")
    expect((await run("animate_image", { model: "veo3.1" })).body.provider).toBe("veo3.1")
  })

  async function run(tool: "generate_video" | "animate_image", args: Record<string, unknown>) {
    const fastify = Fastify()
    let body: Record<string, unknown> = {}
    let url = ""
    for (const path of ["/v1/text-to-video", "/v1/generate-video"]) {
      fastify.post(path, async (req) => {
        body = req.body as Record<string, unknown>
        url = path
        return { jobId: "j-video" }
      })
    }
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify })
    const base = tool === "generate_video" ? { prompt: "a lighthouse at dusk" } : { image_url: START, prompt: "the waves roll in" }
    const result = await callTool(server, tool, { ...base, ...args })
    expect(result.isError).toBeUndefined()
    return { body, url }
  }
})
