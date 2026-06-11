import { describe, it, expect, vi, beforeEach } from "vitest"
import { _resetRegistry } from "../../tasks.js"
import { buildServer, callTool, executeSession, stubRoute } from "./_helpers.js"

/**
 * image_to_image reference resolution. The tool has always advertised
 * "URLs or Nodaro asset ids" for reference_image_urls, but the route's
 * referenceImageUrls schema is URL-only (safeUrlSchema) — un-resolved asset
 * ids used to 400 the whole call. Refs must resolve MCP-side via the shared
 * resolveRefArray, exactly like generate_image and animate_image.
 */

vi.mock("../../asset-resolver.js", () => ({
  resolveAssetId: vi.fn(async ({ assetId }: { assetId: string }) =>
    assetId === "known-asset" ? "https://cdn.nodaro.ai/images/known-asset.png" : null,
  ),
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
})

describe("image_to_image reference resolution", () => {
  it("resolves asset-id refs into URLs alongside pass-through URLs", async () => {
    const { fastify, received } = stubRoute("POST", "/v1/image-to-image", { jobId: "j-i2i-1" })
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify })

    const result = await callTool(server, "image_to_image", {
      image_url: "https://cdn.nodaro.ai/uploads/source.png",
      prompt: "restyle",
      reference_image_urls: ["known-asset", "https://cdn.nodaro.ai/uploads/direct.png"],
    })

    expect(result.isError).toBeUndefined()
    expect(received.body?.referenceImageUrls).toEqual([
      "https://cdn.nodaro.ai/images/known-asset.png",
      "https://cdn.nodaro.ai/uploads/direct.png",
    ])
  })

  it("drops unresolvable asset ids instead of forwarding garbage to the URL-only route", async () => {
    const { fastify, received } = stubRoute("POST", "/v1/image-to-image", { jobId: "j-i2i-2" })
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify })

    const result = await callTool(server, "image_to_image", {
      image_url: "https://cdn.nodaro.ai/uploads/source.png",
      prompt: "restyle",
      reference_image_urls: ["missing-asset"],
    })

    expect(result.isError).toBeUndefined()
    expect(received.body?.referenceImageUrls).toBeUndefined()
  })
})
