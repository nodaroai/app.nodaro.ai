import { describe, it, expect, vi, beforeEach } from "vitest"
import Fastify from "fastify"
import { _resetRegistry } from "../../tasks.js"
import { newSession } from "../../session.js"
import type { Scope } from "../../../scopes.js"
import { buildServer, callTool, executeSession, listTools, stubRoute } from "./_helpers.js"

const resolver = vi.hoisted(() => ({ calls: [] as Array<{ assetId: string; userId: string; expectedKind: string }> }))

vi.mock("../../asset-resolver.js", () => ({
  resolveAssetId: vi.fn(async (opts: { assetId: string; userId: string; expectedKind: string }) => {
    resolver.calls.push(opts)
    if (opts.assetId === "missing") throw new Error(`Asset ${opts.assetId} not found`)
    return `https://cdn.example/resolved/${opts.assetId}.${opts.expectedKind === "video" ? "mp4" : "mp3"}`
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

describe("split_media", () => {
  it("maps snake_case args onto POST /v1/split-media and returns the job id", async () => {
    const { fastify, received } = stubRoute("POST", "/v1/split-media", { jobId: "j-split-1" })
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify })

    const result = await callTool(server, "split_media", {
      video_url: "https://cdn.example/talk.mp4",
      chunk_duration: 30,
      min_part_duration: 10,
      audio_format: "wav",
    })

    expect(result.isError).toBeUndefined()
    expect((result.structuredContent as Record<string, unknown>).jobId).toBe("j-split-1")
    expect(received.body).toEqual({
      videoUrl: "https://cdn.example/talk.mp4",
      chunkDuration: 30,
      minPartDuration: 10,
      audioFormat: "wav",
      mcp_client: "Claude",
      userId: "u1",
    })
  })

  it("sends a video and an audio together, resolving asset ids by kind, and leaves unset levers off the wire", async () => {
    const { fastify, received } = stubRoute("POST", "/v1/split-media", { jobId: "j-split-2" })
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify })

    await callTool(server, "split_media", { video_asset_id: "vid-job", audio_asset_id: "aud-job", chunk_duration: 60 })

    expect(received.body).toEqual({
      videoUrl: "https://cdn.example/resolved/vid-job.mp4",
      audioUrl: "https://cdn.example/resolved/aud-job.mp3",
      chunkDuration: 60,
      mcp_client: "Claude",
      userId: "u1",
    })
    expect(resolver.calls).toEqual([
      { assetId: "vid-job", userId: "u1", expectedKind: "video" },
      { assetId: "aud-job", userId: "u1", expectedKind: "audio" },
    ])
  })

  it("refuses with no source, before anything is dispatched", async () => {
    const { fastify, received } = stubRoute("POST", "/v1/split-media", { jobId: "never" })
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify })

    const result = await callTool(server, "split_media", { chunk_duration: 10 })
    expect(result.isError).toBe(true)
    expect(received.body).toBeUndefined()
  })

  it("refuses a minimum longer than the maximum, before anything is dispatched", async () => {
    const { fastify, received } = stubRoute("POST", "/v1/split-media", { jobId: "never" })
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify })

    const result = await callTool(server, "split_media", {
      audio_url: "https://cdn.example/a.mp3",
      chunk_duration: 5,
      min_part_duration: 6,
    })
    expect(result.isError).toBe(true)
    expect(received.body).toBeUndefined()
  })

  it("names the asset id it could not resolve", async () => {
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify: Fastify() })
    const result = await callTool(server, "split_media", { video_asset_id: "missing", chunk_duration: 10 })
    expect(result.isError).toBe(true)
    expect(JSON.stringify(result.content)).toContain("video_asset_id")
  })

  it("is omitted without workflows:execute", async () => {
    const server = buildServer()
    registerVerbs({
      server,
      session: newSession({ userId: "u1", scopes: ["workflows:read"] as Scope[], clientName: "Claude" }),
      fastify: Fastify(),
    })
    const tools = await listTools(server)
    expect(tools.map((t) => t.name)).not.toContain("split_media")
  })
})
