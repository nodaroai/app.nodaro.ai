import { describe, it, expect, vi, beforeEach } from "vitest"
import { _resetRegistry } from "../../tasks.js"
import { buildServer, callTool, executeSession, listTools, stubRoute } from "./_helpers.js"

/**
 * Character references on the MCP video verb.
 *
 * `/v1/text-to-video` takes `characterReferences` (a portrait + description per
 * person — the identity input that keeps a face on Gemini Omni). The MCP verb
 * maps the snake_case argument onto the route's field and forwards it VERBATIM:
 * the route is the gate, so an unsupported model answers with a friendly 400
 * instead of the verb silently dropping the face lock.
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

const PORTRAIT = "https://cdn.nodaro.ai/uploads/portrait.png"
const BODY = "https://cdn.nodaro.ai/uploads/body.png"
const DESC = "A woman with short silver hair and a utility jacket"

describe("MCP generate_video — character_references", () => {
  it("maps character_references onto the route's characterReferences", async () => {
    const { fastify, received } = stubRoute("POST", "/v1/text-to-video", { jobId: "j-1" })
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify })

    await callTool(server, "generate_video", {
      prompt: "she speaks to camera",
      model: "gemini-omni-video",
      character_references: [
        { image_url: PORTRAIT, description: DESC, name: "Ava" },
        { image_url: PORTRAIT, body_image_url: BODY, description: DESC },
      ],
    })

    expect(received.body?.characterReferences).toEqual([
      { imageUrl: PORTRAIT, description: DESC, name: "Ava" },
      { imageUrl: PORTRAIT, bodyImageUrl: BODY, description: DESC },
    ])
  })

  it("forwards them for ANY model — the route is the gate, the verb never drops the face lock silently", async () => {
    const { fastify, received } = stubRoute("POST", "/v1/text-to-video", { jobId: "j-2" })
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify })

    await callTool(server, "generate_video", {
      prompt: "she speaks to camera",
      model: "seedance-2-5",
      character_references: [{ image_url: PORTRAIT, description: DESC }],
    })

    expect(received.body?.characterReferences).toHaveLength(1)
  })

  it("omits the field entirely when the caller passes none", async () => {
    const { fastify, received } = stubRoute("POST", "/v1/text-to-video", { jobId: "j-3" })
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify })

    await callTool(server, "generate_video", { prompt: "a street at dusk", model: "gemini-omni-video" })

    expect("characterReferences" in (received.body ?? {})).toBe(false)
  })

  it("advertises the argument on the tool surface, capped at 3", async () => {
    const { fastify } = stubRoute("POST", "/v1/text-to-video", { jobId: "j-4" })
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify })

    const tool = (await listTools(server)).find((t) => t.name === "generate_video")
    const props = (tool?.inputSchema as { properties?: Record<string, { maxItems?: number }> } | undefined)?.properties
    expect(props?.character_references?.maxItems).toBe(3)
  })

  it("maps a character's voice_preset onto the route's voice, and omits it when absent", async () => {
    const { fastify, received } = stubRoute("POST", "/v1/text-to-video", { jobId: "j-5" })
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify })

    await callTool(server, "generate_video", {
      prompt: "she speaks to camera",
      model: "gemini-omni-video",
      character_references: [
        { image_url: PORTRAIT, description: DESC, voice_preset: "kore" },
        { image_url: PORTRAIT, description: DESC },
      ],
    })

    expect(received.body?.characterReferences).toEqual([
      { imageUrl: PORTRAIT, description: DESC, voice: { preset: "kore" } },
      { imageUrl: PORTRAIT, description: DESC },
    ])
  })

  it("advertises voice_preset on the tool surface", async () => {
    const { fastify } = stubRoute("POST", "/v1/text-to-video", { jobId: "j-6" })
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify })

    const tool = (await listTools(server)).find((t) => t.name === "generate_video")
    const items = (tool?.inputSchema as { properties?: Record<string, { items?: { properties?: Record<string, unknown> } }> } | undefined)
      ?.properties?.character_references?.items
    expect(items?.properties).toHaveProperty("voice_preset")
  })
})
