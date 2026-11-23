import { describe, it, expect, vi, beforeEach } from "vitest"
import Fastify from "fastify"
import type { FastifyRequest } from "fastify"
import { _resetRegistry } from "../../tasks.js"
import { buildServer, callTool, executeSession } from "./_helpers.js"

/**
 * LTX 2.5 through MCP: `generate_video` (prompt only → /v1/text-to-video) and
 * `animate_image` (a start frame → /v1/generate-video) forward `fps` to the
 * route, which resolves it (`videoFrameRateFor`) and holds Fast's long-clip
 * limit. Every body is checked against the route's own schema.
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

beforeEach(() => {
  _resetRegistry()
  savedVideo = {}
})

type Tool = "generate_video" | "animate_image"

/** Both lanes stubbed; answers what the verb sent, where, and the tool's own result. */
async function run(tool: Tool, args: Record<string, unknown>) {
  const fastify = Fastify()
  const hits: Array<{ url: string; body: Record<string, unknown> }> = []
  for (const url of ["/v1/text-to-video", "/v1/generate-video"]) {
    fastify.post(url, async (req) => {
      hits.push({ url, body: req.body as Record<string, unknown> })
      return { jobId: "j-video" }
    })
  }
  const server = buildServer()
  registerVerbs({ server, session: executeSession(), fastify })
  const base = tool === "generate_video" ? { prompt: "a lighthouse at dusk" } : { image_url: START, prompt: "the waves roll in" }
  const result = await callTool(server, tool, { ...base, ...args })
  return { result, hits, hit: hits[0] }
}

/** The body as the route's schema reads it (the session's own keys are the dispatcher's). */
function sent(body: Record<string, unknown>): Record<string, unknown> {
  const { userId: _userId, mcp_client: _client, ...rest } = body
  return rest
}

describe("LTX 2.5 — the frame rate through MCP", () => {
  it("generate_video sends the model and its fps to /v1/text-to-video, in the route's own schema", async () => {
    const { hit } = await run("generate_video", { model: "ltx-2.5-fast", fps: 50, duration: 20, resolution: "720p", aspect_ratio: "2:3" })
    expect(hit!.url).toBe("/v1/text-to-video")
    expect(hit!.body).toMatchObject({ provider: "ltx-2.5-fast", fps: 50, aspectRatio: "2:3", resolution: "720p" })
    expect(textToVideoBody.safeParse(sent(hit!.body)).success).toBe(true)
  })

  it("animate_image sends the model and its fps to /v1/generate-video", async () => {
    const { hit } = await run("animate_image", { model: "ltx-2.5-pro", fps: 25, duration: 8 })
    expect(hit!.url).toBe("/v1/generate-video")
    expect(hit!.body).toMatchObject({ provider: "ltx-2.5-pro", fps: 25, imageUrl: START })
    expect(generateVideoBody.safeParse(sent(hit!.body)).success).toBe(true)
  })

  it("a numeric-string or fractional fps is forwarded as given; the route resolves it", async () => {
    for (const fps of ["48", 29.97]) {
      const { hit } = await run("generate_video", { model: "ltx-2.5-fast", fps })
      expect(hit!.body.fps).toBe(fps)
      expect(textToVideoBody.safeParse(sent(hit!.body)).success).toBe(true)
    }
  })

  it("no fps argument, no fps field — and no lever filled in, so the route runs the model's own 1080p / 10 s / 24 fps", async () => {
    const { hit } = await run("generate_video", { model: "ltx-2.5-fast" })
    expect("fps" in hit!.body).toBe(false)
    expect(hit!.body.resolution ?? "1080p").toBe("1080p")
    expect(hit!.body.duration ?? 10).toBe(10)
  })
})
