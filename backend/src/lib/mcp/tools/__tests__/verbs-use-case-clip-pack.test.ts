/**
 * `make_clip_pack` on several recordings and with a framing source (decided
 * 2026-10-17/20): the shared recordings fields (verbs-use-case-recordings.ts)
 * and `framing_source` (verbs-use-case-framing.ts), mapped by the one body
 * mapper each. The one-recording request is byte-identical to before.
 * (verbs-use-case.test.ts holds the rest of the verb; it is past its size.)
 */
import { describe, it, expect } from "vitest"
import Fastify from "fastify"
import { USE_CASE_NODE_TYPES, usecaseDescriptor } from "@nodaro/render-rules"
import { buildServer, callTool, executeSession, listTools } from "./_helpers.js"

const { registerUseCaseVerbs } = await import("../verbs-use-case.js")

async function setup(status = 202, body: unknown = { jobId: "job-1", executionId: "exec-1" }) {
  const fastify = Fastify()
  const seen: { url?: string; body?: Record<string, unknown> } = {}
  for (const url of USE_CASE_NODE_TYPES.map((t) => usecaseDescriptor(t).route)) {
    fastify.post(url, async (req, reply) => {
      seen.url = url
      seen.body = req.body as Record<string, unknown>
      return reply.code(status).send(body)
    })
  }
  await fastify.ready()
  const server = buildServer()
  registerUseCaseVerbs({ server, session: executeSession(), fastify })
  return { server, seen }
}
const textOf = (res: { content?: unknown }) => JSON.stringify(res.content)

describe("make_clip_pack on several recordings (decided 2026-10-17)", () => {
  it("posts the recordings in order, the Master audio and the Cameras settings camelCased, beside the pack's settings", async () => {
    const { server, seen } = await setup()
    const res = await callTool(server, "make_clip_pack", {
      media_urls: ["https://r2/a.mp4", "https://r2/b.mp4"],
      master_audio_url: "https://r2/m.wav",
      cameras: { already_synced: true, speaker_cameras: { "1": 2 } },
      count: 4,
    })
    expect(res.isError).toBeFalsy()
    expect(seen.url).toBe("/v1/clip-pack")
    expect(seen.body).toEqual({
      mediaUrls: ["https://r2/a.mp4", "https://r2/b.mp4"],
      masterAudioUrl: "https://r2/m.wav",
      cameras: { synced: true, speakerCameras: { "1": 2 } },
      count: 4,
      mcp_client: "Claude",
      userId: "u1",
    })
  })
  it("media_url alone is the one-recording request it always was; both or neither is a tool error before any request", async () => {
    const { server, seen } = await setup()
    await callTool(server, "make_clip_pack", { media_url: "https://r2/ep.mp4" })
    expect(seen.body).toEqual({ mediaUrls: ["https://r2/ep.mp4"], mcp_client: "Claude", userId: "u1" })
    const fresh = await setup()
    expect((await callTool(fresh.server, "make_clip_pack", { media_url: "https://r2/a.mp4", media_urls: ["https://r2/b.mp4"] })).isError).toBe(true)
    const neither = await callTool(fresh.server, "make_clip_pack", { count: 3 })
    expect(neither.isError).toBe(true)
    expect(textOf(neither)).toMatch(/Pass media_url/)
    expect(fresh.seen.url).toBeUndefined()
  })
  it("a refusal for a caller without Speaker Map reaches the agent with its code and message", async () => {
    const message = "Clip Pack on several recordings or with a Master audio is not available on this deployment yet. Send one recording."
    const { server } = await setup(403, { error: { code: "node_not_available", message } })
    const res = await callTool(server, "make_clip_pack", { media_urls: ["https://r2/a.mp4", "https://r2/b.mp4"] })
    expect(res.isError).toBe(true)
    expect(textOf(res)).toContain("node_not_available")
    expect(textOf(res)).toContain("Send one recording")
  })
  it("the description says several recordings need Speaker Map, names the cameras report and the framing source", async () => {
    const { server } = await setup()
    const tool = (await listTools(server)).find((t) => t.name === "make_clip_pack")
    expect(tool?.description).toMatch(/media_urls/)
    expect(tool?.description).toMatch(/Speaker Map/)
    expect(tool?.description).toContain("output_data.cameras")
    expect(tool?.description).toContain("framing_source")
  })
})

describe("make_clip_pack's framing source (decided 2026-10-17/20)", () => {
  it("sends framing_source as framingSource", async () => {
    for (const framing_source of ["auto", "static", "tracking"] as const) {
      const { server, seen } = await setup()
      await callTool(server, "make_clip_pack", { media_url: "https://r2/ep.mp4", framing_source })
      expect(seen.body).toEqual({ mediaUrls: ["https://r2/ep.mp4"], framingSource: framing_source, mcp_client: "Claude", userId: "u1" })
    }
  })
  it("an unknown value is a tool error before any request", async () => {
    const { server, seen } = await setup()
    expect((await callTool(server, "make_clip_pack", { media_url: "https://r2/ep.mp4", framing_source: "faces" })).isError).toBe(true)
    expect(seen.url).toBeUndefined()
  })
})
