import { describe, it, expect, vi, beforeEach } from "vitest"
import { _resetRegistry } from "../../tasks.js"
import { buildServer, callTool, executeSession, stubRoute } from "./_helpers.js"

/**
 * First-class structured references in MCP. The verb tools historically exposed
 * only flat `reference_image_urls`; a thin client (Studio) or an agent that
 * already has the editor's wired-reference shape can now pass `connected_references`
 * (+ `reference_order`) and the route assembles them server-side into per-ref
 * `@image_N` directives + `{image:N}` token resolution — parity with the canvas.
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

// A minimal valid `ConnectedReference` (id/defaultName/source/url required).
const CREF = [
  {
    id: "r1",
    defaultName: "Hero",
    source: "wired-character" as const,
    url: "https://cdn.nodaro.ai/uploads/hero.png",
    characterSlug: "hero",
  },
]

describe("MCP structured references (connected_references + reference_order)", () => {
  it("animate_image forwards connected_references + reference_order to /v1/generate-video", async () => {
    const { fastify, received } = stubRoute("POST", "/v1/generate-video", { jobId: "j-ai" })
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify })

    const result = await callTool(server, "animate_image", {
      prompt: "drift forward",
      image_url: "https://cdn.nodaro.ai/uploads/x.jpg",
      model: "seedance-2",
      connected_references: CREF,
      reference_order: ["r1"],
    })

    expect(result.isError).toBeUndefined()
    expect(received.body?.connectedReferences).toEqual(CREF)
    expect(received.body?.referenceOrder).toEqual(["r1"])
  })

  it("generate_video forwards connected_references + reference_order to /v1/text-to-video", async () => {
    const { fastify, received } = stubRoute("POST", "/v1/text-to-video", { jobId: "j-tv" })
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify })

    const result = await callTool(server, "generate_video", {
      prompt: "a sunset over the sea",
      model: "seedance-2",
      connected_references: CREF,
      reference_order: ["r1"],
    })

    expect(result.isError).toBeUndefined()
    expect(received.body?.connectedReferences).toEqual(CREF)
    expect(received.body?.referenceOrder).toEqual(["r1"])
  })

  it("generate_image forwards connected_references + reference_order to /v1/generate-image", async () => {
    const { fastify, received } = stubRoute("POST", "/v1/generate-image", { jobId: "j-img" })
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify })

    const result = await callTool(server, "generate_image", {
      prompt: "a hero shot",
      connected_references: CREF,
      reference_order: ["r1"],
    })

    expect(result.isError).toBeUndefined()
    expect(received.body?.connectedReferences).toEqual(CREF)
    expect(received.body?.referenceOrder).toEqual(["r1"])
  })
})

// A reference the caller can name and describe but has no image for.
const DESCRIBED = [{ name: "Natalie", description: "a tall woman in a red coat" }]

describe("MCP described references (described_references)", () => {
  it.each([
    ["animate_image", "/v1/generate-video", { image_url: "https://cdn.nodaro.ai/uploads/x.jpg", model: "seedance-2" }],
    ["generate_video", "/v1/text-to-video", { model: "seedance-2" }],
    ["generate_image", "/v1/generate-image", {}],
  ] as const)("%s forwards described_references to %s", async (verb, route, extra) => {
    const { fastify, received } = stubRoute("POST", route, { jobId: "j-desc" })
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify })

    const result = await callTool(server, verb, {
      prompt: "Natalie walks down the pier.",
      ...extra,
      described_references: DESCRIBED,
    })

    expect(result.isError).toBeUndefined()
    expect(received.body?.describedReferences).toEqual(DESCRIBED)
  })
})
