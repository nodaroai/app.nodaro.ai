import { describe, expect, it } from "vitest"
import Fastify from "fastify"
import { newSession } from "../../session.js"
import type { Scope } from "../../../scopes.js"
import { registerReplaceAudioTools, replaceAudioRefusal } from "../verbs-replace-audio.js"
import { buildServer, callTool, listTools } from "./_helpers.js"

// replace_audio is a client of POST /v1/replace-audio (the Nodaro Cloud plugin's route):
// it sends the body as the route takes it and reads a deployment that does not serve it honestly.

const VIDEO = "https://cdn.example.com/v.mp4"

function session(scopes: Scope[]) {
  return newSession({ userId: "u1", scopes, clientName: "Claude" })
}

function stubApp(answer: { status: number; body: unknown } = { status: 202, body: { jobId: "job-7" } }) {
  const fastify = Fastify()
  const received: Array<{ body: Record<string, unknown>; key?: unknown }> = []
  fastify.post("/v1/replace-audio", async (req, reply) => {
    received.push({ body: req.body as Record<string, unknown>, key: req.headers["idempotency-key"] })
    return reply.status(answer.status).send(answer.body)
  })
  return { fastify, received }
}

describe("replace_audio", () => {
  it("is offered to a session that may run workflows, and only to it", async () => {
    const withScope = buildServer()
    registerReplaceAudioTools({ server: withScope, session: session(["workflows:execute"]), fastify: Fastify() })
    expect((await listTools(withScope)).map((t) => t.name)).toContain("replace_audio")
    const without = buildServer()
    registerReplaceAudioTools({ server: without, session: session(["assets:read"]), fastify: Fastify() })
    expect((await listTools(without)).map((t) => t.name)).not.toContain("replace_audio")
  })

  it("sends a music file and the levers as the route takes them, keyed by the client's request id", async () => {
    const server = buildServer()
    const stub = stubApp()
    registerReplaceAudioTools({ server, session: session(["workflows:execute"]), fastify: stub.fastify })
    const res = await callTool(server, "replace_audio", {
      video_url: VIDEO, music_url: "https://cdn.example.com/m.mp3", music_volume: 60, duck_amount: 40, client_request_id: "req-123456789",
    })
    expect(res.isError).toBeFalsy()
    expect(stub.received[0]!.body).toMatchObject({ videoUrl: VIDEO, musicUrl: "https://cdn.example.com/m.mp3", musicVolume: 60, duckAmount: 40, userId: "u1" })
    expect(stub.received[0]!.body).not.toHaveProperty("musicPrompt")
    expect(String(stub.received[0]!.key)).toContain("req-123456789")
  })

  it("sends a prompt instead of a file, and a mode", async () => {
    const server = buildServer()
    const stub = stubApp()
    registerReplaceAudioTools({ server, session: session(["workflows:execute"]), fastify: stub.fastify })
    await callTool(server, "replace_audio", { video_url: VIDEO, music_prompt: "  warm lo-fi piano ", mode: "replace-all" })
    expect(stub.received[0]!.body).toMatchObject({ videoUrl: VIDEO, musicPrompt: "warm lo-fi piano", mode: "replace-all" })
  })

  it("refuses no music source, or two, before any call", async () => {
    const server = buildServer()
    const stub = stubApp()
    registerReplaceAudioTools({ server, session: session(["workflows:execute"]), fastify: stub.fastify })
    for (const args of [{ video_url: VIDEO }, { video_url: VIDEO, music_url: "https://x/m.mp3", music_prompt: "jazz" }]) {
      const res = await callTool(server, "replace_audio", args)
      expect(res.isError).toBe(true)
    }
    expect((await callTool(server, "replace_audio", { music_prompt: "jazz" })).isError).toBe(true)
    expect(stub.received).toHaveLength(0)
  })

  it("reads a deployment that does not serve the route as not available, and a route refusal as the route said", async () => {
    expect(replaceAudioRefusal(404, "{\"message\":\"Route POST:/v1/replace-audio not found\"}")).toMatch(/Nodaro Cloud/)
    expect(replaceAudioRefusal(404, "not json")).toMatch(/Nodaro Cloud/)
    expect(replaceAudioRefusal(404, JSON.stringify({ error: { code: "not_found", message: "no such job" } }))).toBeNull()
    expect(replaceAudioRefusal(413, JSON.stringify({ error: { code: "media_duration_exceeds_limit", message: "too long" } }))).toBeNull()

    const server = buildServer()
    const stub = stubApp({ status: 404, body: { message: "Route POST:/v1/replace-audio not found" } })
    registerReplaceAudioTools({ server, session: session(["workflows:execute"]), fastify: stub.fastify })
    const res = await callTool(server, "replace_audio", { video_url: VIDEO, music_prompt: "jazz" })
    expect(res.isError).toBe(true)
    expect(JSON.stringify(res.content)).toMatch(/runs on Nodaro Cloud/)
  })
})
