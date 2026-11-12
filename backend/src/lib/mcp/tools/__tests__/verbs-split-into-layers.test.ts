/**
 * split_into_layers (POST /v1/split-into-layers): listed beside generate_mask,
 * unlisted while the deployment does not offer the Split into Layers node to
 * its users. The node's type comes from the unit that declares the tool.
 */
import Fastify, { type FastifyInstance } from "fastify"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { Scope } from "../../../scopes.js"
import { newSession } from "../../session.js"
import { _resetRegistry } from "../../tasks.js"
import { buildServer, callTool, executeSession, listTools, stubRoute } from "./_helpers.js"

const h = vi.hoisted(() => ({ denied: new Set<string>(), resolves: [] as Array<{ assetId: string; expectedKind: string }> }))
vi.mock("../../../surface-deny.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../surface-deny.js")>()),
  isNodeDenied: (type: string) => h.denied.has(type),
}))
vi.mock("../../asset-resolver.js", () => ({
  resolveAssetId: vi.fn(async (opts: { assetId: string; expectedKind: string }) => {
    h.resolves.push(opts)
    if (opts.assetId === "missing") return null
    if (opts.assetId === "broken") throw new Error("Asset broken not found")
    return `https://cdn.example/resolved/${opts.assetId}.png`
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
const { statedPrices } = await import("../../../../ee/billing/stated-prices.js")

beforeEach(() => {
  _resetRegistry()
  h.denied = new Set()
  h.resolves = []
})

function serverWith(fastify?: FastifyInstance, session = executeSession()) {
  const server = buildServer()
  registerVerbs({ server, session, fastify: fastify ?? (Fastify() as unknown as FastifyInstance) })
  return server
}

describe("split_into_layers", () => {
  it("posts { imageUrl, maxLayers, size, prompt, mcp_client, userId } to /v1/split-into-layers and returns the job id", async () => {
    const { fastify, received } = stubRoute("POST", "/v1/split-into-layers", { jobId: "j-sil" })
    const result = await callTool(serverWith(fastify), "split_into_layers", {
      image_url: "https://cdn.example/poster.png",
      max_layers: 5,
      size: "2K",
      prompt: "the title, the car",
    })
    expect(result.isError).toBeUndefined()
    const structured = result.structuredContent as Record<string, unknown>
    expect(structured?.jobId).toBe("j-sil")
    expect(structured?.model).toBe("split-into-layers")
    expect(received.body).toEqual({
      imageUrl: "https://cdn.example/poster.png",
      maxLayers: 5,
      size: "2K",
      prompt: "the title, the car",
      mcp_client: "Claude",
      userId: "u1",
    })
  })

  it("sends no lever it was not given (the route's defaults apply), and no blank prompt", async () => {
    const { fastify, received } = stubRoute("POST", "/v1/split-into-layers", { jobId: "j-sil2" })
    await callTool(serverWith(fastify), "split_into_layers", { image_url: "https://cdn.example/poster.png", prompt: "   " })
    expect(Object.keys(received.body ?? {}).sort()).toEqual(["imageUrl", "mcp_client", "userId"])
  })

  it("resolves image_asset_id as an image", async () => {
    const { fastify, received } = stubRoute("POST", "/v1/split-into-layers", { jobId: "j-sil3" })
    await callTool(serverWith(fastify), "split_into_layers", { image_asset_id: "job-42" })
    expect(h.resolves).toEqual([expect.objectContaining({ assetId: "job-42", expectedKind: "image" })])
    expect(received.body?.imageUrl).toBe("https://cdn.example/resolved/job-42.png")
  })

  it.each([
    ["no image", {}, /Pass image_url or image_asset_id/],
    ["an asset id with no image", { image_asset_id: "missing" }, /no image found for missing/],
    ["an asset id that fails to resolve", { image_asset_id: "broken" }, /image_asset_id: Asset broken not found/],
  ])("refuses %s before any request", async (_name, args, message) => {
    const { fastify, received } = stubRoute("POST", "/v1/split-into-layers", { jobId: "never" })
    const result = await callTool(serverWith(fastify), "split_into_layers", args)
    expect(result.isError).toBe(true)
    expect(JSON.stringify(result.content)).toMatch(message)
    expect(received.body).toBeUndefined()
  })

  it.each([
    ["max_layers 0", { max_layers: 0 }],
    ["max_layers 100", { max_layers: 100 }],
    ["a size the route does not take", { size: "4K" }],
    ["a prompt past 2,000 characters", { prompt: "x".repeat(2001) }],
  ])("refuses %s at the schema, before any request", async (_name, extra) => {
    const { fastify, received } = stubRoute("POST", "/v1/split-into-layers", { jobId: "never" })
    const result = await callTool(serverWith(fastify), "split_into_layers", { image_url: "https://cdn.example/poster.png", ...extra })
    expect(result.isError).toBe(true)
    expect(received.body).toBeUndefined()
  })

  it("declares its parameters and states the output shape, the layer-pixel caveat and its charged default price", async () => {
    const tool = (await listTools(serverWith())).find((t) => t.name === "split_into_layers")
    expect(Object.keys((tool?.inputSchema as { properties: Record<string, unknown> }).properties).sort()).toEqual([
      "image_asset_id",
      "image_url",
      "max_layers",
      "prompt",
      "size",
    ])
    const description = tool?.description ?? ""
    expect(description).toContain(`${statedPrices().credits("split-into-layers")} cr`)
    expect(description).toMatch(/layerData/)
    expect(description).toMatch(/BASE's pixels/)
    expect(description).toMatch(/scale it to its `box`/)
    expect(description).toMatch(/charged only for the images it returns/)
  })

  it("the default hold it states is the hold of the default run (9 layers at 1K: 10 images)", () => {
    expect(statedPrices().credits("split-into-layers")).toBe(statedPrices().credits("split-into-layers:1k:10"))
  })

  it("is not listed for a caller the node is denied to; generate_mask still is", async () => {
    h.denied = new Set(["split-into-layers"])
    const names = (await listTools(serverWith())).map((t) => t.name)
    expect(names).not.toContain("split_into_layers")
    expect(names).toContain("generate_mask")
  })

  it("is not listed without workflows:execute", async () => {
    const session = newSession({ userId: "u1", scopes: ["jobs:read"] as Scope[], clientName: "Claude" })
    expect((await listTools(serverWith(undefined, session))).map((t) => t.name)).not.toContain("split_into_layers")
  })
})
