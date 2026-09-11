import { describe, it, expect, vi, beforeEach } from "vitest"
import { _resetRegistry } from "../../tasks.js"
import { buildServer, callTool, executeSession, listTools, stubRoute } from "./_helpers.js"

/**
 * Rail captions on the MCP video verb.
 *
 * `/v1/text-to-video` and `/v1/generate-video` have long taken
 * `referenceVideoCaptions` — one sentence per `referenceVideoUrls` seat,
 * rendered `@video_N: <caption>.` — and the SDK exposes it, but the MCP verb
 * did not, so an agent could attach a Scene3D clay clip and had no way to say
 * what it was for. That is exactly the seat the Scene3D layout-scoping line
 * rides on every other surface.
 *
 * A caption binds a SEAT, so the two facts under test are: it reaches the
 * route's own field unchanged, and it can never name a seat the payload does
 * not ship.
 */

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

beforeEach(() => {
  _resetRegistry()
})

const CLIP = "https://cdn.nodaro.ai/uploads/clay.mp4"
const CLIP2 = "https://cdn.nodaro.ai/uploads/clay-2.mp4"
const SCOPING =
  "a LAYOUT reference only: subject positions and blocking, framing, camera angle and motion"

describe("MCP generate_video — referenceVideoCaptions", () => {
  it("forwards captions to /v1/text-to-video, index-aligned with the clips", async () => {
    const { fastify, received } = stubRoute("POST", "/v1/text-to-video", { jobId: "j-1" })
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify })

    await callTool(server, "generate_video", {
      prompt: "a photoreal street at dusk",
      model: "seedance-2-5",
      reference_video_urls: [CLIP, CLIP2],
      reference_video_captions: [SCOPING, "the second angle"],
    })

    expect(received.body?.referenceVideoUrls).toEqual([CLIP, CLIP2])
    expect(received.body?.referenceVideoCaptions).toEqual([SCOPING, "the second angle"])
  })

  it("never binds a seat the payload does not ship — extra captions are dropped", async () => {
    const { fastify, received } = stubRoute("POST", "/v1/text-to-video", { jobId: "j-2" })
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify })

    await callTool(server, "generate_video", {
      prompt: "a photoreal street at dusk",
      model: "seedance-2-5",
      reference_video_urls: [CLIP],
      reference_video_captions: [SCOPING, "a clip that was never attached"],
    })

    expect(received.body?.referenceVideoUrls).toEqual([CLIP])
    expect(received.body?.referenceVideoCaptions).toEqual([SCOPING])
  })

  it("sends no caption field when there is no video reference to caption", async () => {
    const { fastify, received } = stubRoute("POST", "/v1/text-to-video", { jobId: "j-3" })
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify })

    await callTool(server, "generate_video", {
      prompt: "a photoreal street at dusk",
      model: "seedance-2-5",
      reference_video_captions: [SCOPING],
    })

    expect(received.body?.referenceVideoUrls).toBeUndefined()
    expect(received.body?.referenceVideoCaptions).toBeUndefined()
  })

  it("omits the field entirely when the caller passes none", async () => {
    const { fastify, received } = stubRoute("POST", "/v1/text-to-video", { jobId: "j-4" })
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify })

    await callTool(server, "generate_video", {
      prompt: "a photoreal street at dusk",
      model: "seedance-2-5",
      reference_video_urls: [CLIP],
    })

    expect(received.body?.referenceVideoUrls).toEqual([CLIP])
    expect("referenceVideoCaptions" in (received.body ?? {})).toBe(false)
  })

  it("advertises the argument on the tool surface", async () => {
    const { fastify } = stubRoute("POST", "/v1/text-to-video", { jobId: "j-5" })
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify })

    const tool = (await listTools(server)).find((t) => t.name === "generate_video")
    expect(tool).toBeDefined()
    const props = (tool?.inputSchema as { properties?: Record<string, unknown> } | undefined)?.properties
    expect(props && "reference_video_captions" in props).toBe(true)
  })
})
