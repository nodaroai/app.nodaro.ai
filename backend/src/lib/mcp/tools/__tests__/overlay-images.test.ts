import { describe, it, expect, vi, beforeEach } from "vitest"
import Fastify from "fastify"
import { _resetRegistry } from "../../tasks.js"
import { buildServer, callTool, executeSession, listTools, stubRoute } from "./_helpers.js"

const resolver = vi.hoisted(() => ({ calls: [] as Array<{ assetId: string; userId: string; expectedKind: string }> }))

vi.mock("../../asset-resolver.js", () => ({
  resolveAssetId: vi.fn(async (opts: { assetId: string; userId: string; expectedKind: string }) => {
    resolver.calls.push(opts)
    if (opts.assetId === "missing") throw new Error(`Asset ${opts.assetId} not found`)
    return `https://cdn.example/resolved/${opts.assetId}.${opts.expectedKind === "video" ? "mp4" : "png"}`
  }),
}))

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
  resolver.calls.length = 0
})
const VIDEO = "https://cdn.example/base.mp4"
const IMG = "https://cdn.example/card.png"

describe("overlay_images", () => {
  it("maps url / asset_id layers and z_index onto the route body, resolving ids as images", async () => {
    const { fastify, received } = stubRoute("POST", "/v1/video-overlay", { jobId: "j-vo-1" })
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify })

    const result = await callTool(server, "overlay_images", {
      video_url: VIDEO,
      layers: [
        { url: IMG, start: 1.2, end: 2.6, preset: "card" },
        { asset_id: "img-job", start: 0, corner: "top-left", z_index: 5, opacity: 0.8 },
      ],
      output_aspect: "9:16",
      base_fit: "contain",
      background_color: "#101010",
    })

    expect(result.isError).toBeUndefined()
    expect((result.structuredContent as Record<string, unknown>).jobId).toBe("j-vo-1")
    expect(received.body).toEqual({
      videoUrl: VIDEO,
      layers: [
        { imageUrl: IMG, start: 1.2, end: 2.6, preset: "card" },
        { imageUrl: "https://cdn.example/resolved/img-job.png", start: 0, corner: "top-left", zIndex: 5, opacity: 0.8 },
      ],
      outputAspect: "9:16",
      baseFit: "contain",
      backgroundColor: "#101010",
      mcp_client: "Claude",
      userId: "u1",
    })
    expect(resolver.calls).toEqual([{ assetId: "img-job", userId: "u1", expectedKind: "image" }])
  })

  it("resolves video_asset_id as a video (an overlay or combine job id chains straight in)", async () => {
    const { fastify, received } = stubRoute("POST", "/v1/video-overlay", { jobId: "j-vo-2" })
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify })
    await callTool(server, "overlay_images", { video_asset_id: "vid-job", layers: [{ url: IMG, start: 0 }] })
    expect(received.body?.videoUrl).toBe("https://cdn.example/resolved/vid-job.mp4")
    expect(resolver.calls[0]).toEqual({ assetId: "vid-job", userId: "u1", expectedKind: "video" })
  })

  it("a layer asset id that fails to resolve is an error naming its position — nothing is dispatched", async () => {
    const { fastify, received } = stubRoute("POST", "/v1/video-overlay", { jobId: "never" })
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify })
    const result = await callTool(server, "overlay_images", {
      video_url: VIDEO,
      layers: [{ url: IMG, start: 0 }, { asset_id: "missing", start: 1 }],
    })
    expect(result.isError).toBe(true)
    expect((result.content[0] as { text: string }).text).toBe("layers[1]: Asset missing not found")
    expect(received.url).toBeUndefined()
  })

  it("a video_asset_id that fails to resolve is an error naming the input", async () => {
    const { fastify, received } = stubRoute("POST", "/v1/video-overlay", { jobId: "never" })
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify })
    const result = await callTool(server, "overlay_images", { video_asset_id: "missing", layers: [{ url: IMG, start: 0 }] })
    expect((result.content[0] as { text: string }).text).toBe("video_asset_id: Asset missing not found")
    expect(received.url).toBeUndefined()
  })

  it("refuses a missing base and a layer with neither url nor asset_id", async () => {
    const { fastify } = stubRoute("POST", "/v1/video-overlay", { jobId: "never" })
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify })
    const noBase = await callTool(server, "overlay_images", { layers: [{ url: IMG, start: 0 }] })
    expect((noBase.content[0] as { text: string }).text).toBe("Provide the base video as video_url or video_asset_id.")
    const noImage = await callTool(server, "overlay_images", { video_url: VIDEO, layers: [{ start: 0 }] })
    expect((noImage.content[0] as { text: string }).text).toBe("layers[0]: give the image as url or asset_id")
  })

  it("surfaces the route's validation message", async () => {
    const fastify = Fastify()
    fastify.post("/v1/video-overlay", async (_req, reply) =>
      reply.status(400).send({ error: { code: "validation_error", message: "layers[0]: end (4 s) must be after start (5 s)" } }),
    )
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify })
    const result = await callTool(server, "overlay_images", { video_url: VIDEO, layers: [{ url: IMG, start: 5, end: 4 }] })
    expect(result.isError).toBe(true)
    expect((result.content[0] as { text: string }).text).toContain("layers[0]: end (4 s) must be after start (5 s)")
  })

  it("is listed under workflows:execute with no price on the wire", async () => {
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify: Fastify() })
    const tool = (await listTools(server)).find((t) => t.name === "overlay_images")
    expect(tool).toBeDefined()
    expect(tool!.description).not.toMatch(/credit/i)
  })
})
