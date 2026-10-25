import { describe, it, expect, vi, beforeEach } from "vitest"
import Fastify from "fastify"
import { _resetRegistry } from "../../tasks.js"
import { buildServer, callTool, executeSession, listTools, stubRoute } from "./_helpers.js"

// suno_separate_stems reads the source job's row for Suno ids (resolveSunoIds)
// before it falls back to the asset resolver, so this file mocks both: a row
// per job id below, and a resolver that turns any other id into an upload URL.
const db = vi.hoisted(() => ({
  jobs: {} as Record<string, Record<string, unknown>>,
  resolverCalls: [] as Array<{ assetId: string; userId: string; expectedKind: string }>,
}))

vi.mock("../../asset-resolver.js", () => ({
  resolveAssetId: vi.fn(async (opts: { assetId: string; userId: string; expectedKind: string }) => {
    db.resolverCalls.push(opts)
    if (opts.assetId === "missing") throw new Error(`Asset ${opts.assetId} not found`)
    return `https://cdn.example/uploads/${opts.assetId}.mp3`
  }),
}))

vi.mock("../../../supabase.js", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: (_col: string, id: string) => ({
          // `.is("deleted_at", null)`: no job here is in the Trash.
          is() { return this },
          maybeSingle: async () => ({ data: db.jobs[id] ?? null, error: null }),
          single: async () => ({ data: { mcp_preferences: {} }, error: null }),
        }),
      }),
    }),
  },
}))

const { registerVerbs } = await import("../verbs.js")

beforeEach(() => {
  _resetRegistry()
  db.jobs = {}
  db.resolverCalls.length = 0
})

describe("suno_separate_stems", () => {
  it("suno_separate_stems accepts audio_url and an uploaded (non-Suno) asset", async () => {
    const byUrl = stubRoute("POST", "/v1/suno/separate", { jobId: "j-url" })
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify: byUrl.fastify })
    const urlResult = await callTool(server, "suno_separate_stems", {
      audio_url: "https://cdn.example/song.mp3",
      type: "split_stem_advanced",
      stem_name: "Piano",
      fallback_to_demucs: true,
    })
    expect(urlResult.isError).toBeUndefined()
    expect(byUrl.received.body).toEqual({
      audioUrl: "https://cdn.example/song.mp3",
      type: "split_stem_advanced",
      stemName: "Piano",
      fallbackToDemucs: true,
      mcp_client: "Claude",
      userId: "u1",
    })
    expect(db.resolverCalls).toEqual([])

    const byAsset = stubRoute("POST", "/v1/suno/separate", { jobId: "j-asset" })
    const server2 = buildServer()
    registerVerbs({ server: server2, session: executeSession(), fastify: byAsset.fastify })
    const assetResult = await callTool(server2, "suno_separate_stems", { audio_asset_id: "upload-1" })
    expect(assetResult.isError).toBeUndefined()
    expect(byAsset.received.body).toEqual({
      audioUrl: "https://cdn.example/uploads/upload-1.mp3",
      type: "separate_vocal",
      mcp_client: "Claude",
      userId: "u1",
    })
    expect(db.resolverCalls).toEqual([{ assetId: "upload-1", userId: "u1", expectedKind: "audio" }])
  })

  it("a Suno generation still sends its ids, and only its ids (they win over a URL everywhere)", async () => {
    db.jobs["suno-job"] = {
      user_id: "u1",
      is_public: false,
      status: "completed",
      output_data: { sunoTaskId: "task-1", sunoTrackId: "track-1", audioUrl: "https://cdn.example/suno.mp3" },
    }
    const { fastify, received } = stubRoute("POST", "/v1/suno/separate", { jobId: "j-ids" })
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify })
    const result = await callTool(server, "suno_separate_stems", { audio_asset_id: "suno-job", type: "split_stem" })
    expect(result.isError).toBeUndefined()
    expect(received.body).toEqual({
      taskId: "task-1",
      audioId: "track-1",
      type: "split_stem",
      mcp_client: "Claude",
      userId: "u1",
    })
    // The ids came from the job row — the strict own-asset resolver is never
    // asked, so another user's public Suno track keeps working.
    expect(db.resolverCalls).toEqual([])
  })

  it("another user's public Suno track is separated by its ids", async () => {
    db.jobs["public-suno"] = {
      user_id: "someone-else",
      is_public: true,
      status: "completed",
      output_data: { sunoTaskId: "task-p", sunoTrackId: "track-p" },
    }
    const { fastify, received } = stubRoute("POST", "/v1/suno/separate", { jobId: "j-pub" })
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify })
    const result = await callTool(server, "suno_separate_stems", { audio_asset_id: "public-suno" })
    expect(result.isError).toBeUndefined()
    expect(received.body).toMatchObject({ taskId: "task-p", audioId: "track-p" })
    expect(received.body).not.toHaveProperty("audioUrl")
  })

  it("passes stem_name through as a string; the route's refusal, listing the valid names, reaches the agent", async () => {
    // stem_name is a plain string on the wire (the 98-name enum cost every
    // session ~1.2 KB of tools/list); the route's Zod enum is the check.
    const routeMessage = 'stemName: Invalid option: expected one of "Lead Vocal"|"Drum Kit"|"Piano"'
    const fastify = Fastify()
    let body: Record<string, unknown> | undefined
    fastify.post("/v1/suno/separate", async (req, reply) => {
      body = req.body as Record<string, unknown>
      return reply.status(400).send({ error: { code: "validation_error", message: routeMessage } })
    })
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify })
    const result = await callTool(server, "suno_separate_stems", {
      audio_url: "https://cdn.example/song.mp3",
      type: "split_stem_advanced",
      stem_name: "Kazoo",
    })
    expect(body?.stemName).toBe("Kazoo")
    expect(result.isError).toBe(true)
    expect((result.content[0] as { text: string }).text).toContain(routeMessage)
    const tool = (await listTools(server)).find((t) => t.name === "suno_separate_stems")!
    const stemSchema = (tool.inputSchema as { properties: Record<string, { type?: string; enum?: unknown }> }).properties.stem_name
    expect(stemSchema.type).toBe("string")
    expect(stemSchema.enum).toBeUndefined()
  })

  it("needs exactly one of audio_url and audio_asset_id", async () => {
    const { fastify, received } = stubRoute("POST", "/v1/suno/separate", { jobId: "never" })
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify })
    const neither = await callTool(server, "suno_separate_stems", {})
    expect(neither.isError).toBe(true)
    const both = await callTool(server, "suno_separate_stems", {
      audio_url: "https://cdn.example/song.mp3",
      audio_asset_id: "upload-1",
    })
    expect(both.isError).toBe(true)
    expect((both.content[0] as { text: string }).text).toBe("Pass exactly one of audio_url or audio_asset_id.")
    expect(received.url).toBeUndefined()
  })

  it("an asset that does not resolve is an error naming the input — nothing is dispatched", async () => {
    const { fastify, received } = stubRoute("POST", "/v1/suno/separate", { jobId: "never" })
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify })
    const result = await callTool(server, "suno_separate_stems", { audio_asset_id: "missing" })
    expect(result.isError).toBe(true)
    expect((result.content[0] as { text: string }).text).toBe("audio_asset_id: Asset missing not found")
    expect(received.url).toBeUndefined()
  })

  it("no longer tells the model that non-Suno audio cannot be separated", async () => {
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify: stubRoute("POST", "/x", {}).fastify })
    const tools = await listTools(server)
    const stems = tools.find((t) => t.name === "suno_separate_stems")!
    expect(stems.description).not.toMatch(/cannot be separated/i)
    expect(stems.description).toMatch(/any audio/i)
    const demucs = tools.find((t) => t.name === "separate_audio")!
    expect(demucs.description).not.toMatch(/no Suno track is\s+needed/i)
  })
})
