/**
 * shot_cuts (POST /v1/shot-cuts): core and keyless, listed beside split_media,
 * unlisted while the deployment does not offer the Shot Cuts node to its users.
 * The node's type comes from the unit that declares the tool.
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
    return `https://cdn.example/resolved/${opts.assetId}.mp4`
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

describe("shot_cuts", () => {
  it("posts { videoUrl, frames, mcp_client, userId } to /v1/shot-cuts and returns the job id", async () => {
    const { fastify, received } = stubRoute("POST", "/v1/shot-cuts", { jobId: "j-sc" })
    const result = await callTool(serverWith(fastify), "shot_cuts", { video_url: "https://cdn.example/ad.mp4", frames: true })
    expect(result.isError).toBeUndefined()
    expect((result.structuredContent as Record<string, unknown>)?.jobId).toBe("j-sc")
    expect(received.body).toEqual({ videoUrl: "https://cdn.example/ad.mp4", frames: true, mcp_client: "Claude", userId: "u1" })
  })

  it("sends no frames it was not given", async () => {
    const { fastify, received } = stubRoute("POST", "/v1/shot-cuts", { jobId: "j-sc2" })
    await callTool(serverWith(fastify), "shot_cuts", { video_url: "https://cdn.example/ad.mp4" })
    expect(Object.keys(received.body ?? {}).sort()).toEqual(["mcp_client", "userId", "videoUrl"])
  })

  it("resolves video_asset_id as a video", async () => {
    const { fastify, received } = stubRoute("POST", "/v1/shot-cuts", { jobId: "j-sc3" })
    await callTool(serverWith(fastify), "shot_cuts", { video_asset_id: "job-42" })
    expect(h.resolves).toEqual([expect.objectContaining({ assetId: "job-42", expectedKind: "video" })])
    expect(received.body?.videoUrl).toBe("https://cdn.example/resolved/job-42.mp4")
  })

  it.each([
    ["no video", {}, /Pass video_url or video_asset_id/],
    ["an asset id with no video", { video_asset_id: "missing" }, /no video found for missing/],
    ["an asset id that fails to resolve", { video_asset_id: "broken" }, /video_asset_id: Asset broken not found/],
  ])("refuses %s before any request", async (_name, args, message) => {
    const { fastify, received } = stubRoute("POST", "/v1/shot-cuts", { jobId: "never" })
    const result = await callTool(serverWith(fastify), "shot_cuts", args)
    expect(result.isError).toBe(true)
    expect(JSON.stringify(result.content)).toMatch(message)
    expect(received.body).toBeUndefined()
  })

  it("declares its parameters and states its charged price and the 30-minute limit", async () => {
    const tool = (await listTools(serverWith())).find((t) => t.name === "shot_cuts")
    expect(Object.keys((tool?.inputSchema as { properties: Record<string, unknown> }).properties).sort()).toEqual(["frames", "video_asset_id", "video_url"])
    expect(tool?.description).toContain(`${statedPrices().credits("shot-cuts")} cr per run`)
    expect(tool?.description).toMatch(/up to 30 minutes/)
  })

  it("is not listed for a caller the node is denied to; split_media still is", async () => {
    h.denied = new Set(["shot-cuts"])
    const names = (await listTools(serverWith())).map((t) => t.name)
    expect(names).not.toContain("shot_cuts")
    expect(names).toContain("split_media")
  })

  it("is not listed without workflows:execute", async () => {
    const session = newSession({ userId: "u1", scopes: ["jobs:read"] as Scope[], clientName: "Claude" })
    expect((await listTools(serverWith(undefined, session))).map((t) => t.name)).not.toContain("shot_cuts")
  })
})
